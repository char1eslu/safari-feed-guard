import { useEffect, useState } from "react";
import { getSettings } from "../../lib/settings";
import type { BgResponse } from "../../lib/types";

function bg<T = Record<string, unknown>>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp) => r(resp ?? { ok: false })),
  );
}

const Shield = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export function App() {
  const [status, setStatus] = useState<{ ok: boolean; n: number } | null>(null);
  const [edgeBase, setEdgeBase] = useState("https://x-spam-sentinel-edge.zuoluotv.workers.dev");

  useEffect(() => {
    bg<{ records: number }>({ type: "health" }).then((h) =>
      setStatus(h.ok && h.data ? { ok: true, n: h.data.records } : { ok: false, n: 0 }),
    );
    getSettings().then((s) => {
      if (s.edgeBase) setEdgeBase(s.edgeBase);
    });
  }, []);

  return (
    <div className="p-4">
      <header className="flex items-center gap-2">
        <span className="text-accent">
          <Shield />
        </span>
        <b className="text-[14px] font-semibold tracking-[0.01em]">x-spam-sentinel</b>
        <span
          aria-label={status === null ? "检查中" : status.ok ? "服务在线" : "服务不可达"}
          className={`ml-auto inline-flex h-2 w-2 rounded-full ${
            status === null ? "bg-fg-4" : status.ok ? "bg-ok" : "bg-danger"
          }`}
        />
      </header>

      <div
        className={`mt-3 flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs ${
          status?.ok
            ? "border-border bg-card text-fg"
            : status?.ok === false
              ? "border-danger/30 bg-danger-soft text-[#fca5a5]"
              : "border-border bg-card text-fg-3"
        }`}
      >
        {status === null ? (
          <span>检查服务…</span>
        ) : status.ok ? (
          <>
            <span className="text-fg-3">公共名单</span>
            <span className="font-variant-numeric:tabular-nums font-bold text-[15px]">
              {status.n.toLocaleString("zh-CN")}
              <span className="ml-1 text-[11px] font-normal text-fg-3">条</span>
            </span>
          </>
        ) : (
          <span>服务不可达 · 检查网络</span>
        )}
      </div>

      <button
        type="button"
        onClick={() =>
          chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })
        }
        className="mt-3 w-full cursor-pointer rounded-lg border border-transparent bg-fg px-3 py-2.5 text-[13px] font-semibold text-bg shadow-[0_0_0_1px_rgba(56,189,248,0.5),0_6px_18px_-8px_rgba(56,189,248,0.45)] transition hover:bg-white hover:shadow-[0_0_0_1px_rgba(56,189,248,0.65),0_8px_24px_-8px_rgba(56,189,248,0.55)] active:translate-y-px"
      >
        打开管理面板
      </button>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <a
          href={`${edgeBase}/list`}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border-2 bg-card px-2.5 py-1.5 text-center text-[12px] text-fg-2 transition hover:border-border-2 hover:bg-card-hi hover:text-fg"
        >
          看公榜
        </a>
        <a
          href="https://github.com/onenorthlab/x-spam-sentinel"
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border-2 bg-card px-2.5 py-1.5 text-center text-[12px] text-fg-2 transition hover:border-border-2 hover:bg-card-hi hover:text-fg"
        >
          GitHub
        </a>
      </div>

      <footer className="mt-3 border-t border-border pt-2.5 text-[11px] leading-[1.6] text-fg-3">
        <a
          href="https://github.com/onenorthlab/x-spam-sentinel/blob/main/docs/GOVERNANCE.md"
          target="_blank"
          rel="noopener"
          className="text-accent hover:underline"
        >
          为什么 / 治理
        </a>
        <span className="ml-1">— AI 判定永不自动公开，须人工或社区共识确认</span>
      </footer>
    </div>
  );
}
