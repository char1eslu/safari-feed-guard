import { isBlockedSync, warm as warmBlocklist, addBlocked } from "../lib/blocklist";
import { addBlockRecord, bumpStats } from "../lib/store";
import { type Cached, cacheGet, cacheSet, signalsHash } from "../lib/cache";
import {
  AUTO_THRESHOLD,
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  heuristic,
} from "../lib/detect";
import type { BgResponse, CurationRecord, Signals, Verdict } from "../lib/types";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createBadge,
  createBubble,
  createStatusBadge,
} from "../lib/ui";

const APPEAL_URL =
  "https://github.com/onenorthlab/x-spam-sentinel/issues/new?template=appeal.yml";

function send<T = unknown>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp: (BgResponse & { data?: T }) | undefined) =>
      r(resp ?? { ok: false }),
    ),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function articleOf(node: Element | null): HTMLElement | null {
  return (node?.closest("article") as HTMLElement) ?? null;
}

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
}

// X web's long-standing public bearer (same one the site itself uses).
const X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const ct0 = () => (document.cookie.match(/ct0=([^;]+)/)?.[1] ?? "");

/**
 * Real X block via the site's own authenticated endpoint, using the user's
 * existing session (same first-party request the Block button makes). This
 * is the user-initiated action they explicitly asked for: it blocks on
 * their X account so it syncs to every browser/client. Falls back to DOM
 * automation only if this fails.
 */
async function apiBlock(userId?: string, handle?: string): Promise<boolean> {
  try {
    const body = new URLSearchParams();
    if (userId && /^\d+$/.test(userId)) body.set("user_id", userId);
    else if (handle) body.set("screen_name", handle);
    else return false;
    const res = await fetch("https://x.com/i/api/1.1/blocks/create.json", {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: X_BEARER,
        "x-csrf-token": ct0(),
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fallback only: drive X's own block flow via DOM (caret → Block → confirm).
 * Brittle; used if the authenticated endpoint call fails.
 */
async function nativeBlock(anchor: HTMLElement): Promise<boolean> {
  try {
    const art = articleOf(anchor);
    const caret = art?.querySelector<HTMLElement>('[data-testid="caret"]');
    if (!caret) return false;
    caret.click();
    for (let i = 0; i < 20; i++) {
      await sleep(80);
      const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      const block = [...items].find((m) =>
        /\bblock\b|屏蔽|拉黑|封锁/i.test(m.innerText),
      );
      if (block) {
        block.click();
        for (let j = 0; j < 20; j++) {
          await sleep(80);
          const ok = document.querySelector<HTMLElement>(
            '[data-testid="confirmationSheetConfirm"]',
          );
          if (ok) {
            ok.click();
            return true;
          }
        }
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Each inline badge gets its own shadow host so X CSS can't touch it. */
function mountBadge(anchor: HTMLElement, build: () => HTMLElement) {
  const host = document.createElement("span");
  host.className = "xss-mount";
  host.style.display = "inline-flex";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  sr.append(st, build());
  anchor.appendChild(host);
}

function clearMounts(anchor: HTMLElement) {
  anchor
    .querySelectorAll(":scope > .xss-mount, :scope > .xss-pending")
    .forEach((n) => n.remove());
}

/** Lightweight "queued" marker — NOT a final mount, so scan() revisits it
 *  once the token bucket refills (newly loaded comments never get stuck). */
function mountStatus(anchor: HTMLElement, kind: "analyzing" | "pending") {
  const cls = kind === "pending" ? "xss-pending" : "xss-mount";
  if (anchor.querySelector(`:scope > .${cls}`)) return;
  const host = document.createElement("span");
  host.className = cls; // pending = NOT final, scan() will revisit
  host.style.display = "inline-flex";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  sr.append(st, createStatusBadge(kind));
  anchor.appendChild(host);
}
const mountPending = (a: HTMLElement) => mountStatus(a, "pending");

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
    const inflight = new Map<string, Promise<void>>(); // L0 in-flight de-dup
    const anchorByKey = new Map<string, HTMLElement>();
    const nodeKey = new WeakMap<HTMLElement, string>(); // virtualization-safe
    const findings: Finding[] = [];
    let active = 0;
    // Token bucket instead of a hard per-page cap: sustained ~20/min, burst
    // 40. Scrolling more keeps detecting (refills); never permanently stuck.
    // Cache + L0 de-dup keep repeats free, so this only bounds bursts.
    const TOK_CAP = 40;
    let tokens = TOK_CAP;
    setInterval(() => {
      tokens = Math.min(TOK_CAP, tokens + 1);
    }, 3000);
    const takeToken = () => (tokens > 0 ? (tokens--, true) : false);

    await warmBlocklist();
    const isReplyContext = () => /^\/[^/]+\/status\/\d+/.test(location.pathname);
    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

    function pushFinding(sig: Signals, v: Verdict) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = sig.userId || sig.handle;
      if (findings.some((f) => (f.userId || f.handle) === id)) return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        ...(sig.userId ? { userId: sig.userId } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(snippet ? { snippet } : {}),
      });
      if (!dismissed) bubbleApi?.update(findings);
    }

    async function blockAccount(key: string, sig: Signals) {
      const anchor = anchorByKey.get(key);
      await addBlocked(key); // fast short-circuit set
      if (sig.userId) await addBlocked(sig.userId);
      const f = findings.find((x) => (x.userId || x.handle) === (sig.userId || sig.handle));
      await addBlockRecord({
        id: key,
        handle: sig.handle,
        source: "manual",
        ts: Date.now(),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(f?.verdict ? { verdict: f.verdict, reason: f.verdict.reasons[0] } : {}),
      });
      await bumpStats({ blocks: 1 });
      // REAL X block on the user's account (syncs to every browser/client).
      const blocked = await apiBlock(sig.userId, sig.handle);
      if (!blocked && anchor) void nativeBlock(anchor); // DOM fallback only
      if (anchor) hideTweet(anchor); // also hide locally for instant feedback
      // User block = the human-confirm signal → eligible for the public DB
      // (governance: AI alone never auto-publishes).
      void send({ type: "confirm_spam", signals: sig });
      const i = findings.findIndex((f) => (f.userId || f.handle) === (sig.userId || sig.handle));
      if (i >= 0) findings.splice(i, 1);
      if (!dismissed) bubbleApi?.update(findings);
    }

    function badgeFor(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      v: Verdict | null,
      note?: string,
      source: BadgeSource = "fresh",
    ) {
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            onBlock: () => void blockAccount(key, sig),
            onHide: () => hideTweet(anchor),
            onReport: () => void send({ type: "confirm_spam", signals: sig }),
            onAppeal: () => window.open(APPEAL_URL, "_blank", "noopener"),
            onCheck: () => void classify(anchor, key, sig),
          },
          note,
          source,
        ),
      );
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict);
    }

    async function classify(anchor: HTMLElement, key: string, sig: Signals) {
      const running = inflight.get(key);
      if (running) return running;
      mountStatus(anchor, "analyzing"); // animated shimmer while AI works
      const p = (async () => {
        const { isProfile: _p, ...rest } = sig;
        const resp = await send<{ record: CurationRecord; idResolved: boolean }>({
          type: "classify",
          signals: rest,
        });
        if (!resp.ok || !resp.data) return;
        const { record, idResolved } = resp.data;
        badgeFor(anchor, key, sig, record.verdict, idResolved ? undefined : "数字ID未解析，handle 兜底", "fresh");
        pushFinding(sig, record.verdict);
        void bumpStats({ detections: 1, label: record.verdict.label });
        void cacheSet(key, {
          verdict: record.verdict,
          signalsHash: signalsHash(sig),
          model: record.model,
          ts: Date.now(),
          handle: sig.handle,
          ...(sig.displayName ? { displayName: sig.displayName } : {}),
          ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        });
      })();
      inflight.set(key, p);
      try {
        await p;
      } finally {
        inflight.delete(key);
      }
    }

    async function process(sig: Signals, anchor: HTMLElement) {
      const key = keyOf(sig);
      anchorByKey.set(key, anchor);

      // 0. Already blocked → hide, never render/analyze/request again.
      if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
        hideTweet(anchor);
        return;
      }

      // 1. Persistent cache (spam reused as-is; legit/uncertain only if signals
      //    unchanged so new evidence can still re-trigger).
      const cached = await cacheGet(key);
      if (cached) {
        const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
        if (spammy || cached.signalsHash === signalsHash(sig)) {
          renderCached(anchor, key, sig, cached);
          void bumpStats({ cacheHits: 1 }); // an LLM call saved
          return;
        }
      }

      // 2. Public/known list (no LLM).
      if (sig.userId) {
        const r = await send<{ hit: CurationRecord | null }>({
          type: "lookup",
          userId: sig.userId,
        });
        if (r.ok && r.data?.hit) {
          badgeFor(anchor, key, sig, r.data.hit.verdict, undefined, "list");
          pushFinding(sig, r.data.hit.verdict);
          return;
        }
      }

      // 3 + 4. New account → LLM (reply section: every replier; elsewhere only
      //        heuristic-positive). In-flight + budget guard cost.
      if (inflight.has(key)) return;
      const h = heuristic(sig);
      const wantAuto = h.score >= AUTO_THRESHOLD || isReplyContext();
      if (!wantAuto) {
        badgeFor(anchor, key, sig, null); // clean-looking → manual check
        return;
      }
      if (!takeToken()) {
        // Out of burst budget. Mark PENDING (not final) so the next scan /
        // periodic tick reprocesses it as tokens refill — newly loaded
        // comments are never permanently skipped.
        mountPending(anchor);
        return;
      }
      active++;
      bubbleApi?.setScanning(active);
      void classify(anchor, key, sig).finally(() => {
        active--;
        bubbleApi?.setScanning(active);
      });
    }

    function scan() {
      const p = extractProfile();
      if (p) {
        const el = document.querySelector<HTMLElement>('[data-testid="UserName"]');
        if (el) void process(p, el);
      }
      // Account-keyed, NOT node-tagged: X virtualizes the list and recycles
      // <article> nodes, so a permanent per-node flag would skip recycled
      // (new) spam. Re-evaluate a node when its account changed or our badge
      // is missing; account-level cache/in-flight keep it cheap.
      const topic = extractThreadTopic();
      for (const art of document.querySelectorAll<HTMLElement>(
        'article[data-testid="tweet"]',
      )) {
        const info = extractFromArticle(art);
        const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
        if (!info || !nameBlock) continue;
        if (topic && !info.threadTopic) info.threadTopic = topic;
        const key = keyOf(info);
        const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
        if (nodeKey.get(art) === key && hasMount) continue;
        if (nodeKey.get(art) !== key) clearMounts(nameBlock); // recycled node
        nodeKey.set(art, key);
        void process(info, nameBlock);
      }
    }

    const ui = await createShadowRootUi(ctx, {
      name: "xss-bubble",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const st = document.createElement("style");
        st.textContent = STYLE;
        container.appendChild(st);
        const bubble = createBubble({
          onBlockAll(fs: Finding[]) {
            // Sequential with spacing — each is a real X API block; don't
            // hammer the endpoint (rate limits).
            void (async () => {
              for (const f of fs) {
                const key = f.userId || `h:${f.handle}`;
                await blockAccount(key, {
                  isProfile: false,
                  handle: f.handle,
                  displayName: "",
                  bio: "",
                  hasDefaultAvatar: false,
                  recentTweets: [],
                  ...(f.userId ? { userId: f.userId } : {}),
                });
                await sleep(350);
              }
            })();
          },
          onBlockOne(f: Finding) {
            void blockAccount(f.userId || `h:${f.handle}`, {
              isProfile: false,
              handle: f.handle,
              displayName: "",
              bio: "",
              hasDefaultAvatar: false,
              recentTweets: [],
              ...(f.userId ? { userId: f.userId } : {}),
            });
          },
          onReviewEach() {
            const first = findings[0];
            if (first) {
              anchorByKey
                .get(first.userId || `h:${first.handle}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          },
          onDismiss() {
            dismissed = true;
          },
        });
        container.appendChild(bubble.el);
        bubbleApi = bubble;
        return bubble;
      },
    });
    ui.mount();

    let t: ReturnType<typeof setTimeout>;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(scan, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Periodic tick so the pending backlog drains as tokens refill, even
    // when the user stops scrolling (no new DOM mutations).
    setInterval(scan, 4000);
    scan();
  },
});
