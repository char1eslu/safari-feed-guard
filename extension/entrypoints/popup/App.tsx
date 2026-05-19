import { useEffect, useState } from "react";
import type { BgResponse } from "../../lib/types";

function bg<T = Record<string, unknown>>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp) => r(resp ?? { ok: false })),
  );
}

const Shield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export function App() {
  const [status, setStatus] = useState<{ ok: boolean; n: number } | null>(null);

  useEffect(() => {
    bg<{ records: number }>({ type: "health" }).then((h) =>
      setStatus(h.ok && h.data ? { ok: true, n: h.data.records } : { ok: false, n: 0 }),
    );
  }, []);

  return (
    <div className="p-3.5 text-[13px] font-sans">
      <header className="flex items-center gap-2">
        <Shield />
        <b className="text-sm">x-spam-sentinel</b>
        <span
          className={`ml-auto h-2 w-2 rounded-full ${
            status === null ? "bg-[#8b949e]" : status.ok ? "bg-[#22c55e]" : "bg-[#ef4444]"
          }`}
        />
      </header>

      <p
        className={`my-2.5 rounded-lg px-2.5 py-2 text-xs ${
          status?.ok ? "bg-white/5 text-[#e6edf3]" : "bg-white/5 text-[#fca5a5]"
        }`}
      >
        {status === null
          ? "检查服务…"
          : status.ok
            ? `服务在线 · 公共名单 ${status.n} 条`
            : "服务不可达"}
      </p>

      <button
        type="button"
        onClick={() =>
          chrome.tabs.create({ url: chrome.runtime.getURL("options.html") })
        }
        className="w-full cursor-pointer rounded-lg bg-[#0ea5e9] py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
      >
        打开管理面板
      </button>

      <footer className="mt-3 flex flex-col gap-1 text-[11px]">
        <a
          href="https://github.com/onenorthlab/x-spam-sentinel/blob/main/GOVERNANCE.md"
          target="_blank"
          rel="noopener"
          className="text-[#38bdf8] hover:underline"
        >
          为什么 / 治理
        </a>
        <span className="text-[#8b949e]">AI 判定永不自动公开，须人工确认</span>
      </footer>
    </div>
  );
}
