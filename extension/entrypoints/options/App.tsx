import { useEffect, useMemo, useState } from "react";
import { clearAllLocal, getGhLogin } from "../../lib/auth";
import { type Settings, getSettings, setSetting } from "../../lib/settings";
import {
  type BlockRecord,
  type CacheRow,
  getBlocklist,
  getCacheRows,
  getStats,
  removeBlock,
} from "../../lib/store";
import type { BgResponse, Label } from "../../lib/types";

const REPO = "https://github.com/onenorthlab/x-spam-sentinel";

function bg<T = Record<string, unknown>>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) => chrome.runtime.sendMessage(msg, (x) => r(x ?? { ok: false })));
}
const when = (ts: number) => new Date(ts).toLocaleString("zh-CN", { hour12: false });
const idTail = (id: string, h: string) =>
  /^\d+$/.test(id) && id !== h && !/^\d+$/.test(h) ? ` · ${id}` : "";

const TAG: Record<Label, [string, string]> = {
  spam: ["text-[#ef4444]", "垃圾"],
  porn_bot: ["text-[#ef4444]", "色情bot"],
  likely_spam: ["text-[#f59e0b]", "疑似垃圾"],
  uncertain: ["text-[#8b949e]", "不确定"],
  legit: ["text-[#22c55e]", "正常"],
};
const Tag = ({ label, conf }: { label: Label; conf?: number }) => {
  const [cls, zh] = TAG[label] ?? ["text-[#8b949e]", label];
  return (
    <span className={`rounded-full border border-current px-2 py-0.5 text-[11px] font-bold ${cls}`}>
      {zh}
      {conf !== undefined ? ` ${(conf * 100).toFixed(0)}%` : ""}
    </span>
  );
};
const Avatar = ({ url, name }: { url?: string; name?: string }) => {
  const mono = (name || "?").replace(/^@/, "").charAt(0).toUpperCase();
  return url ? (
    <img
      src={url}
      referrerPolicy="no-referrer"
      alt=""
      className="h-7 w-7 flex-none rounded-full bg-[#21262d] object-cover"
    />
  ) : (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#21262d] text-xs font-bold text-[#8b949e]">
      {mono}
    </span>
  );
};
const Page = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <main className="max-w-[1100px] flex-1 px-8 py-7">
    <h1 className="text-xl font-bold">{title}</h1>
    {sub && <div className="mb-5 mt-1 text-[13px] text-[#8b949e]">{sub}</div>}
    {children}
  </main>
);
const td = "border-b border-white/[0.06] px-2.5 py-2 align-middle whitespace-nowrap";
const th = `${td} text-xs font-semibold text-[#8b949e]`;

function Overview() {
  const [s, setS] = useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [bl, setBl] = useState(0);
  useEffect(() => {
    getStats().then(setS);
    getBlocklist().then((l) => setBl(l.length));
  }, []);
  if (!s) return <Page title="概览" sub="加载中…" />;
  const d = s.byLabel;
  const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
  const seg = (k: string, c: string) =>
    d[k] ? <i style={{ width: `${((d[k] / total) * 100).toFixed(1)}%`, background: c }} className="block h-full" /> : null;
  const Card = ({ n, l }: { n: number; l: string }) => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="text-2xl font-bold">{n}</div>
      <div className="mt-1 text-xs text-[#8b949e]">{l}</div>
    </div>
  );
  return (
    <Page title="概览" sub="本地统计 · 数据仅存于本机，无 PII">
      <div className="mb-6 grid grid-cols-4 gap-3.5">
        <Card n={s.detections} l="AI 检测总数" />
        <Card n={s.cacheHits} l="缓存命中 · 省下的 LLM 调用" />
        <Card n={bl} l="已拉黑账号" />
        <Card n={(d.spam ?? 0) + (d.porn_bot ?? 0)} l="判定为垃圾/色情bot" />
      </div>
      <h2 className="text-[15px] font-bold">检测类别分布</h2>
      <div className="my-2 flex h-2.5 overflow-hidden rounded-full">
        {seg("porn_bot", "#ef4444")}
        {seg("spam", "#ef4444")}
        {seg("likely_spam", "#f59e0b")}
        {seg("uncertain", "#8b949e")}
        {seg("legit", "#22c55e")}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#8b949e]">
        <span>● 色情/垃圾bot {(d.porn_bot ?? 0) + (d.spam ?? 0)}</span>
        <span>● 疑似 {d.likely_spam ?? 0}</span>
        <span>● 不确定 {d.uncertain ?? 0}</span>
        <span>● 正常 {d.legit ?? 0}</span>
      </div>
    </Page>
  );
}

function Blocklist() {
  const [list, setList] = useState<BlockRecord[]>([]);
  const [q, setQ] = useState("");
  const load = () => getBlocklist().then((l) => setList([...l].sort((a, b) => b.ts - a.ts)));
  useEffect(() => void load(), []);
  const rows = useMemo(
    () =>
      list.filter((r) =>
        `${r.handle} ${r.displayName ?? ""} ${r.reason ?? ""}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [list, q],
  );
  const src: Record<string, string> = { manual: "手动", block_all: "一键全部", list_hit: "名单命中" };
  return (
    <Page title="拉黑记录" sub={`共 ${list.length} 条 · 取消拉黑用于纠正误判（账号会重新可见）`}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索 @handle / 显示名 / 理由"
        className="mb-4 w-[320px] rounded-lg border border-white/[0.12] bg-white/5 px-3 py-2 text-[13px]"
      />
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>账号</th>
            <th className={th}>判定</th>
            <th className={th}>理由</th>
            <th className={th}>来源</th>
            <th className={th}>时间</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar url={r.avatarUrl} name={r.displayName || r.handle} />
                  <div className="min-w-0">
                    <div className="max-w-[220px] truncate font-semibold">
                      {r.displayName || `@${r.handle}`}
                    </div>
                    <div className="max-w-[220px] truncate text-xs text-[#8b949e]">
                      @{r.handle}
                      {idTail(r.id, r.handle)}
                    </div>
                  </div>
                </div>
              </td>
              <td className={td}>
                {r.verdict ? <Tag label={r.verdict.label} conf={r.verdict.confidence} /> : "—"}
              </td>
              <td className={`${td} max-w-[360px] whitespace-normal text-[#8b949e]`}>
                {r.reason || ""}
              </td>
              <td className={`${td} text-[#8b949e]`}>{src[r.source]}</td>
              <td className={`${td} text-[#8b949e]`}>{when(r.ts)}</td>
              <td className={td}>
                <button
                  type="button"
                  onClick={async () => {
                    await removeBlock(r.id);
                    load();
                  }}
                  className="cursor-pointer rounded-md border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-xs hover:bg-white/[0.12]"
                >
                  取消拉黑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <div className="py-10 text-center text-[#8b949e]">还没有拉黑记录</div>}
    </Page>
  );
}

function Cache() {
  const [rows, setRows] = useState<CacheRow[]>([]);
  useEffect(() => void getCacheRows().then(setRows), []);
  return (
    <Page title="检测缓存" sub={`共 ${rows.length} 条 · 同账号再出现直接用缓存，0 次 LLM`}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>账号</th>
            <th className={th}>判定</th>
            <th className={th}>理由</th>
            <th className={th}>模型</th>
            <th className={th}>时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <Avatar url={c.avatarUrl} name={c.displayName || c.handle} />
                  <div className="min-w-0">
                    <div className="max-w-[220px] truncate font-semibold">
                      {c.displayName || `@${c.handle}`}
                    </div>
                    <div className="text-xs text-[#8b949e]">@{c.handle}</div>
                  </div>
                </div>
              </td>
              <td className={td}>
                <Tag label={c.verdict.label} conf={c.verdict.confidence} />
              </td>
              <td className={`${td} max-w-[360px] whitespace-normal text-[#8b949e]`}>
                {c.verdict.reasons[0] ?? ""}
              </td>
              <td className={`${td} text-[#8b949e]`}>{c.model}</td>
              <td className={`${td} text-[#8b949e]`}>{when(c.ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="py-10 text-center text-[#8b949e]">缓存为空</div>}
    </Page>
  );
}

function Toggle({
  on,
  onChange,
  label,
  hint,
}: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={`mt-0.5 h-5 w-9 flex-none rounded-full transition ${on ? "bg-[#0ea5e9]" : "bg-white/15"}`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-[#8b949e]">{hint}</span>}
      </span>
    </label>
  );
}

function Settings() {
  const [login, setLogin] = useState("");
  const [flow, setFlow] = useState("");
  const [cleared, setCleared] = useState(false);
  const [st, setSt] = useState<Settings | null>(null);
  const refresh = () => getGhLogin().then(setLogin);
  useEffect(() => {
    refresh();
    getSettings().then(setSt);
  }, []);
  const save = async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    await setSetting(k, v);
    setSt((p) => (p ? { ...p, [k]: v } : p));
  };
  async function ghLogin() {
    setFlow("正在获取设备码…");
    const s = await bg<{ user_code: string; verification_uri: string; device_code: string; interval: number }>(
      { type: "gh_start" },
    );
    if (!s.ok || !s.data) {
      setFlow(`失败：${s.error ?? "请确认 OAuth App 已勾选 Enable Device Flow"}`);
      return;
    }
    const { user_code, verification_uri, device_code, interval } = s.data;
    window.open(verification_uri, "_blank", "noopener");
    setFlow(`在打开的页面输入码：${user_code}，授权后自动完成…`);
    const poll = async () => {
      const r = await bg<{ login?: string }>({ type: "gh_poll", deviceCode: device_code });
      if (r.ok && r.data?.login) {
        setFlow("");
        refresh();
        return;
      }
      setTimeout(poll, Math.max(5, interval || 5) * 1000);
    };
    setTimeout(poll, (interval || 5) * 1000);
  }
  return (
    <Page title="设置" sub="登录与配置仅存于本机">
      <div className="max-w-[680px] space-y-3 text-[#c9d1d9]">
        <p>
          <b>GitHub 登录</b> — 上报与服务端 AI 分析需要（防滥用）。
        </p>
        <p>
          {login ? (
            <>
              已登录 <code className="rounded bg-white/[0.06] px-1.5 py-0.5">@{login}</code> ·{" "}
              <button
                type="button"
                className="cursor-pointer text-[#38bdf8]"
                onClick={async () => {
                  await bg({ type: "gh_logout" });
                  refresh();
                }}
              >
                登出
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={ghLogin}
              className="cursor-pointer rounded-md border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-[13px] hover:bg-white/[0.12]"
            >
              用 GitHub 登录
            </button>
          )}
        </p>
        {flow && <p className="text-[#f59e0b]">{flow}</p>}

        {st && (
          <div className="pt-6">
            <p>
              <b>检测行为</b> — 改动在下次刷新页面后生效。
            </p>
            <Toggle
              on={st.enabled}
              onChange={(v) => save("enabled", v)}
              label="启用被动检测"
              hint="关闭后扩展在 X 上完全不工作"
            />
            <Toggle
              on={st.bubble}
              onChange={(v) => save("bubble", v)}
              label="显示角标气泡"
            />
            <Toggle
              on={st.bubblePos === "tr"}
              onChange={(v) => save("bubblePos", v ? "tr" : "br")}
              label="气泡位置：右上角"
              hint="关 = 右下角"
            />
            <Toggle
              on={st.replyAuto}
              onChange={(v) => save("replyAuto", v)}
              label="回复区逐个自动检查"
              hint="关闭可显著降低 LLM 调用 / 更克制"
            />
            <div className="pt-3 text-xs text-[#8b949e]">
              高级：服务端地址（留空=默认线上）
              <div className="mt-1 flex gap-2">
                <input
                  value={st.edgeBase}
                  onChange={(e) => setSt({ ...st, edgeBase: e.target.value })}
                  placeholder="https://…workers.dev"
                  className="w-[340px] rounded-lg border border-white/[0.12] bg-white/5 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => save("edgeBase", st.edgeBase.trim())}
                  className="cursor-pointer rounded-md border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-xs hover:bg-white/[0.12]"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="pt-6">
          <p>
            <b>数据与隐私</b> — 检测缓存、拉黑记录、统计、登录态均仅存于本机，无 PII。
          </p>
          <button
            type="button"
            onClick={async () => {
              if (!confirm("清除全部本地数据（缓存/拉黑记录/统计/登录）？不可恢复。")) return;
              await clearAllLocal();
              setCleared(true);
              refresh();
            }}
            className="mt-2 cursor-pointer rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-1.5 text-[13px] text-[#fca5a5] hover:bg-[#ef4444]/20"
          >
            清除本地数据
          </button>
          {cleared && <span className="ml-3 text-xs text-[#22c55e]">已清除</span>}
        </div>
      </div>
    </Page>
  );
}

const About = () => (
  <Page title="关于" sub="x-spam-sentinel · 公益、开源">
    <div className="max-w-[680px] space-y-2.5 leading-7 text-[#c9d1d9]">
      <p>基于 AI 的 X(Twitter) 反垃圾/色情机器人扩展。被动检测、本地优先、中心服务（Cloudflare）协同；用户一键拉黑即视为人工确认。</p>
      <p>
        许可证：<code className="rounded bg-white/[0.06] px-1.5 py-0.5">AGPL-3.0</code> · 仓库：{" "}
        <a href={REPO} target="_blank" rel="noopener" className="text-[#38bdf8]">
          github.com/onenorthlab/x-spam-sentinel
        </a>
      </p>
      <p>隐私：除公开的 X 数字 ID 外不存储任何 PII，数据默认仅在本机。</p>
      <p>
        治理：AI 判定永不自动公开，须人工确认；{" "}
        <a href={`${REPO}/blob/main/GOVERNANCE.md`} target="_blank" rel="noopener" className="text-[#38bdf8]">
          申诉与移除机制
        </a>
        。
      </p>
    </div>
  </Page>
);

const TABS = [
  ["overview", "概览", Overview],
  ["blocklist", "拉黑记录", Blocklist],
  ["cache", "检测缓存", Cache],
  ["settings", "设置", Settings],
  ["about", "关于", About],
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const Active = TABS.find((t) => t[0] === tab)?.[2] ?? Overview;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[210px] flex-none flex-col gap-4 border-r border-white/[0.08] p-[18px_14px]">
        <div className="flex items-center gap-2 text-[15px]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <b>x-spam-sentinel</b>
        </div>
        <nav className="flex flex-col gap-1">
          {TABS.map(([id, label]) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-left text-[13px] ${
                tab === id
                  ? "bg-[#0ea5e9]/15 text-[#38bdf8]"
                  : "text-[#8b949e] hover:bg-white/5 hover:text-[#e6edf3]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto text-[11px] text-[#8b949e]">
          v{chrome.runtime.getManifest().version}
        </div>
      </aside>
      <Active />
    </div>
  );
}
