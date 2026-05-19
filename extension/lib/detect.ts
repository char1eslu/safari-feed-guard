// Passive DOM extraction + cheap local heuristic. Ported to TS from the MVP
// content script. Reads only what X already rendered — no scraping, no
// navigation, no extra requests to X.
import type { Signals } from "./types";

const PROMO_RE =
  /(约见|约炮|附近|同城|牵线|线下|对接|资源|上车|看我主页|入驻|女主播|安全可靠|大号|解锁|福利|楼凤|一夜|加微|私聊|私信|包养|外围|18\+|🔞|🍑|💋|💦|👇|👉)/;
const LINK_RE =
  /(https?:\/\/|\b[\w-]+\.(top|xyz|vip|club|icu|cn|cc|live|link|shop)\b|t\.co\/)/i;
const RANDOM_HANDLE_RE = /^[a-z]{2,}\d{4,}$|^[A-Za-z]+[A-Z][a-z]+\d{4,}$|^[a-z]{1,3}\d{4,}$/;

const NON_PROFILE = new Set([
  "home", "explore", "notifications", "messages", "i", "search", "settings",
  "compose", "hashtag", "bookmarks", "lists", "communities", "jobs", "tos",
  "privacy", "login", "signup",
]);

export function parseJoinDate(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const now = Date.now();
  let d: Date | undefined;
  const zh = text.match(/(\d{4})年(\d{1,2})月/);
  if (zh) d = new Date(Number(zh[1]), Number(zh[2]) - 1, 1);
  if (!d) {
    const en = text.match(/Joined\s+([A-Za-z]+)\s+(\d{4})/i);
    if (en) d = new Date(`${en[1]} 1, ${en[2]}`);
  }
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return Math.max(0, Math.round((now - d.getTime()) / 86_400_000));
}

export function parseCount(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/[, ]/g, "").match(/([\d.]+)\s*([万KkMm千]?)/);
  if (!m || m[1] === undefined) return undefined;
  const mult: Record<string, number> =
    { 万: 1e4, 千: 1e3, K: 1e3, k: 1e3, M: 1e6, m: 1e6 };
  return Math.round(Number.parseFloat(m[1]) * (mult[m[2] ?? ""] ?? 1));
}

function avatarInfo(scope: Element | Document) {
  const img = scope.querySelector<HTMLImageElement>('img[src*="profile_images/"]');
  const m = img?.src.match(/profile_images\/(\d+)\//);
  return { userId: m?.[1], hasDefaultAvatar: !img, avatarUrl: img?.src };
}

export interface FiberUser {
  bio?: string;
  userId?: string;
  followersCount?: number;
  followingCount?: number;
  accountAgeDays?: number;
}

/**
 * X loads each author's FULL profile (description / counts / created_at) into
 * the page's React data even in reply lists — it just doesn't render the bio.
 * We read that already-in-memory object. Zero extra requests, no hover, fully
 * passive. Best-effort: if X's internals change we return {} and fall back to
 * the visible signals (no regression).
 */
const fiberCache = new WeakMap<Element, FiberUser>();

export function readFiberUser(el: Element): FiberUser {
  const hit = fiberCache.get(el);
  if (hit) return hit;
  const out = readFiberUserUncached(el);
  fiberCache.set(el, out);
  return out;
}

function readFiberUserUncached(el: Element): FiberUser {
  try {
    const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fk) return {};
    // biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
    let node: any = (el as any)[fk];
    const seen = new Set<unknown>();
    const budget = { n: 4000 }; // hard cap: never let the walk hang the page
    for (let i = 0; node && i < 24; i++) {
      for (const bag of [node.memoizedProps, node.memoizedState]) {
        const u = findUser(bag, seen, 0, budget);
        if (u) {
          const legacy = u.legacy ?? u;
          const created = legacy.created_at
            ? Date.parse(legacy.created_at)
            : NaN;
          return {
            bio: typeof legacy.description === "string" ? legacy.description : "",
            userId: u.rest_id ?? legacy.id_str,
            followersCount: legacy.followers_count,
            followingCount: legacy.friends_count,
            accountAgeDays: Number.isNaN(created)
              ? undefined
              : Math.max(0, Math.round((Date.now() - created) / 86_400_000)),
          };
        }
      }
      node = node.return;
    }
  } catch {
    /* X internals changed → graceful empty */
  }
  return {};
}

// biome-ignore lint/suspicious/noExplicitAny: deep search over React internals
function findUser(o: any, seen: Set<unknown>, depth: number, b: { n: number }): any {
  if (!o || typeof o !== "object" || depth > 5 || seen.has(o)) return null;
  if (--b.n <= 0) return null; // global work budget — cannot hang the page
  if (o instanceof Node || o instanceof Window) return null; // skip DOM/window
  seen.add(o);
  try {
    const legacy = o.legacy ?? o;
    if (
      legacy &&
      typeof legacy === "object" &&
      typeof legacy.description === "string" &&
      ("followers_count" in legacy || "screen_name" in legacy)
    ) {
      return o;
    }
    for (const k of Object.keys(o)) {
      const r = findUser(o[k], seen, depth + 1, b);
      if (r) return r;
    }
  } catch {
    /* getter threw — skip this branch */
  }
  return null;
}

export function extractProfile(): Signals | null {
  const seg = location.pathname.split("/").filter(Boolean);
  if (seg.length !== 1 || NON_PROFILE.has(seg[0] ?? "")) return null;
  const nameEl = document.querySelector<HTMLElement>('[data-testid="UserName"]');
  if (!nameEl) return null;

  const lines = nameEl.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  const handle = (lines.find((s) => s.startsWith("@")) ?? `@${seg[0]}`).slice(1);
  const displayName = lines[0] && !lines[0].startsWith("@") ? lines[0] : "";
  const bioEl = document.querySelector<HTMLElement>('[data-testid="UserDescription"]');
  const joinEl = document.querySelector<HTMLElement>('[data-testid="UserJoinDate"]');

  let followers: number | undefined;
  let following: number | undefined;
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/follow"], a[href$="/verified_followers"]',
  )) {
    const href = a.getAttribute("href") ?? "";
    const val = parseCount(a.innerText);
    if (/\/following$/.test(href)) following = val;
    else if (/(verified_)?followers$/.test(href)) followers = val;
  }
  const scope =
    document.querySelector('[data-testid="primaryColumn"]') ?? document;
  const { userId, hasDefaultAvatar, avatarUrl } = avatarInfo(scope);

  return {
    isProfile: true,
    handle,
    displayName,
    bio: bioEl ? bioEl.innerText.trim() : "",
    hasDefaultAvatar,
    recentTweets: [],
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(userId ? { userId } : {}),
    ...(parseJoinDate(joinEl?.innerText) !== undefined
      ? { accountAgeDays: parseJoinDate(joinEl?.innerText) }
      : {}),
    ...(followers !== undefined ? { followersCount: followers } : {}),
    ...(following !== undefined ? { followingCount: following } : {}),
  };
}

export function extractFromArticle(article: HTMLElement): Signals | null {
  const { userId, hasDefaultAvatar, avatarUrl } = avatarInfo(article);
  const nameBlock = article.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!nameBlock) return null;
  let handle: string | undefined;
  let displayName = "";
  for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
    if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) handle = s[0];
  }
  const txt = nameBlock.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  if (txt.length) displayName = txt[0] ?? "";
  if (!handle) {
    const at = txt.find((s) => s.startsWith("@"));
    if (at) handle = at.slice(1);
  }
  if (!handle) return null;
  const tweetEl = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const tweetText = tweetEl ? tweetEl.innerText.trim() : "";
  // Pull the author's already-loaded profile (bio/counts/age) from X's React
  // data — automatic, no hover, zero extra requests.
  const fu = readFiberUser(article);
  return {
    isProfile: false,
    handle,
    displayName,
    bio: fu.bio ?? "",
    hasDefaultAvatar,
    recentTweets: tweetText ? [tweetText] : [],
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(userId || fu.userId ? { userId: userId ?? fu.userId } : {}),
    ...(tweetText ? { triggeringComment: tweetText } : {}),
    ...(fu.accountAgeDays !== undefined ? { accountAgeDays: fu.accountAgeDays } : {}),
    ...(fu.followersCount !== undefined ? { followersCount: fu.followersCount } : {}),
    ...(fu.followingCount !== undefined ? { followingCount: fu.followingCount } : {}),
  };
}

/** Root tweet text of the current thread (for off-topic relevance). */
export function extractThreadTopic(): string | undefined {
  if (!/^\/[^/]+\/status\/\d+/.test(location.pathname)) return undefined;
  const first = document.querySelector<HTMLElement>(
    'article[data-testid="tweet"] [data-testid="tweetText"]',
  );
  const t = first?.innerText.trim();
  return t ? t.slice(0, 400) : undefined;
}

export interface Heuristic {
  score: number;
  why: string[];
}

/** Cheap & local. Decides WHETHER to spend an LLM call — never the verdict. */
export function heuristic(s: Signals): Heuristic {
  let score = 0;
  const why: string[] = [];
  const blob = `${s.displayName} ${s.bio} ${s.recentTweets.join(" ")}`;
  if (s.hasDefaultAvatar) {
    score += 0.35;
    why.push("默认头像");
  }
  if (typeof s.accountAgeDays === "number") {
    if (s.accountAgeDays < 30) {
      score += 0.4;
      why.push("新注册账号(<30天)");
    } else if (s.accountAgeDays < 90) {
      score += 0.25;
      why.push("较新账号(<90天)");
    } else if (s.accountAgeDays > 730) {
      score -= 0.25;
      why.push("老账号(>2年)");
    }
  }
  if (typeof s.followersCount === "number" && s.followersCount <= 5) {
    score += 0.2;
    why.push("几乎无粉丝");
  }
  if (PROMO_RE.test(blob)) {
    score += 0.35;
    why.push("导流/性广告话术");
  }
  if (LINK_RE.test(blob)) {
    score += 0.2;
    why.push("外链/可疑域名");
  }
  if (RANDOM_HANDLE_RE.test(s.handle)) {
    score += 0.15;
    why.push("机器生成式 handle");
  }
  return { score: Math.max(0, Math.min(1, score)), why };
}

export const AUTO_THRESHOLD = 0.5;
