// The only place that talks to the service / GitHub, so page CSP/CORS never
// blocks us. Edge Worker /v1 API + GitHub Device-Flow login + admin proxy.
import { GH_CLIENT_ID, getGhToken, setGh } from "../lib/auth";
import { BRAND } from "../lib/brand";
import { getSettings } from "../lib/settings";
import { bumpStat, getStats } from "../lib/stats";
import type { BgRequest, BgResponse, CurationRecord } from "../lib/types";
import { refreshWhitelist, whitelistStatus } from "../lib/whitelist-cache";

const DEFAULT_BASE = BRAND.edgeBase;

async function base(): Promise<string> {
  return (await getSettings()).edgeBase || DEFAULT_BASE;
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch((await base()) + path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as Record<string, unknown>;
}

/** POST JSON, attaching the GitHub token when present (gates write endpoints). */
async function authedPost(signals: unknown) {
  const tok = await getGhToken();
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
    },
    body: JSON.stringify(signals),
  };
}

// ---- GitHub Device Flow (background = cross-origin allowed via host perms) ----
async function ghStart() {
  const clientId = GH_CLIENT_ID;
  if (!clientId) throw new Error("未配置 GitHub OAuth App client_id（管理面板·设置）");
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
  });
  const j = (await r.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };
  return j;
}

async function ghPoll(deviceCode: string) {
  const clientId = GH_CLIENT_ID;
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!j.access_token) return { pending: j.error ?? "pending" };
  const u = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${j.access_token}`, "user-agent": "mxga" },
  });
  const user = (await u.json()) as { login?: string };
  await setGh(j.access_token, user.login ?? "github");
  return { login: user.login ?? "github" };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const h = await call("/v1/health");
            sendResponse({ ok: true, data: { records: (h.published as number) ?? 0 } });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "stats") {
            sendResponse({ ok: true, data: await getStats() });
          } else if (msg.type === "whitelist_status") {
            sendResponse({ ok: true, data: await whitelistStatus() });
          } else if (msg.type === "whitelist_refresh") {
            sendResponse({ ok: true, data: await refreshWhitelist(true) });
          } else if (msg.type === "lookup") {
            const r = await call(`/v1/check?ids=${encodeURIComponent(msg.userId)}`);
            const hits = (r.hits as Record<string, { label: string; confidence: number }>) ?? {};
            const h = hits[msg.userId];
            const hit: CurationRecord | null = h
              ? {
                  userId: msg.userId,
                  handle: "",
                  verdict: {
                    label: h.label as CurationRecord["verdict"]["label"],
                    confidence: h.confidence,
                    reasons: [],
                  },
                  reviewStatus: "human_confirmed",
                  model: "",
                }
              : null;
            // Only count a hit (not a miss) as a public-board win.
            if (hit) void bumpStat("hitPublic");
            sendResponse({ ok: true, data: { hit } });
          } else if (msg.type === "classify") {
            const r = await call("/v1/classify", await authedPost(msg.signals));
            const rec = r.record as { verdict: CurationRecord["verdict"]; status: string };
            const s = msg.signals as { userId?: string; handle: string };
            // Only count fresh LLM work, not cache returns (server tells us via `cached`).
            if (!r.cached) void bumpStat("scanned");
            sendResponse({
              ok: true,
              data: {
                record: {
                  userId: s.userId ?? "",
                  handle: s.handle,
                  verdict: rec.verdict,
                  reviewStatus: rec.status,
                  model: "edge",
                } satisfies CurationRecord,
                idResolved: !!s.userId,
              },
            });
          } else if (msg.type === "confirm_spam") {
            await call("/v1/confirm", await authedPost(msg.signals));
            void bumpStat("blocked");
            sendResponse({ ok: true });
          } else if (msg.type === "gh_start") {
            sendResponse({ ok: true, data: await ghStart() });
          } else if (msg.type === "gh_poll") {
            sendResponse({ ok: true, data: await ghPoll(msg.deviceCode) });
          } else if (msg.type === "gh_status") {
            const { getGhLogin } = await import("../lib/auth");
            sendResponse({ ok: true, data: { login: await getGhLogin() } });
          } else if (msg.type === "gh_logout") {
            const { clearGh } = await import("../lib/auth");
            await clearGh();
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: "unknown message" });
          }
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return true; // async response
    },
  );

  // Wave 12b — keep the local whitelist mirror fresh. Once on install,
  // once on every browser launch, and every 6h via chrome.alarms while
  // any tab is active. All errors swallowed (the cache is best-effort —
  // a miss just falls back to the normal classify path).
  const ALARM = "mxga_whitelist_sync";
  chrome.runtime.onInstalled.addListener(() => {
    void refreshWhitelist(true);
    chrome.alarms.create(ALARM, { periodInMinutes: 6 * 60 });
  });
  chrome.runtime.onStartup.addListener(() => {
    void refreshWhitelist(false);
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void refreshWhitelist(false);
  });
  // Service workers cold-start on first message — kick a refresh then too.
  void refreshWhitelist(false);
});
