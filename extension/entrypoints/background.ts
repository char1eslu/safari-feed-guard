// The only place that talks to the service, so the page CSP/CORS never
// blocks us. Talks to the deployed Cloudflare edge Worker (/v1 API).
// Override at runtime via chrome.storage.local "xss:edgeBase" (e.g. point
// back to a local `pnpm serve` style shim during dev).
import type { BgRequest, BgResponse, CurationRecord } from "../lib/types";

const DEFAULT_BASE = "https://x-spam-sentinel-edge.zuoluotv.workers.dev";

async function base(): Promise<string> {
  try {
    const g = await chrome.storage.local.get("xss:edgeBase");
    return (g["xss:edgeBase"] as string) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch((await base()) + path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as Record<string, unknown>;
}

const jsonPost = (signals: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(signals),
});

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (
      msg: BgRequest,
      _s: chrome.runtime.MessageSender,
      sendResponse: (r: BgResponse) => void,
    ) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const h = await call("/v1/health");
            sendResponse({ ok: true, data: { records: (h.published as number) ?? 0 } });
          } else if (msg.type === "records") {
            // Recent-list lives in the local management panel now; the edge
            // only exposes published meta.
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "lookup") {
            const r = await call(`/v1/check?ids=${encodeURIComponent(msg.userId)}`);
            const hits = (r.hits as Record<string, { label: string; confidence: number }>) ?? {};
            const h = hits[msg.userId];
            const hit: CurationRecord | null = h
              ? {
                  userId: msg.userId,
                  handle: "",
                  verdict: { label: h.label as CurationRecord["verdict"]["label"], confidence: h.confidence, reasons: [] },
                  reviewStatus: "human_confirmed",
                  model: "",
                }
              : null;
            sendResponse({ ok: true, data: { hit } });
          } else if (msg.type === "classify") {
            const r = await call("/v1/classify", jsonPost(msg.signals));
            const rec = r.record as { verdict: CurationRecord["verdict"]; status: string };
            const s = msg.signals as { userId?: string; handle: string };
            const record: CurationRecord = {
              userId: s.userId ?? "",
              handle: s.handle,
              verdict: rec.verdict,
              reviewStatus: rec.status,
              model: "edge",
            };
            sendResponse({ ok: true, data: { record, idResolved: !!s.userId } });
          } else if (msg.type === "confirm_spam") {
            // User block/report = the human-confirm signal → public list.
            await call("/v1/confirm", jsonPost(msg.signals));
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
});
