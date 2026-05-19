import type { BgResponse, CurationRecord, Label } from "../../lib/types";

const TAG: Record<Label, string> = {
  spam: "t-danger",
  porn_bot: "t-danger",
  likely_spam: "t-warn",
  uncertain: "t-neutral",
  legit: "t-safe",
};
const ZH: Record<Label, string> = {
  spam: "垃圾",
  porn_bot: "色情bot",
  likely_spam: "疑似垃圾",
  uncertain: "不确定",
  legit: "正常",
};

function send<T = unknown>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp: (BgResponse & { data?: T }) | undefined) =>
      r(resp ?? { ok: false }),
    ),
  );
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

(async () => {
  const h = await send<{ records: number }>({ type: "health" });
  const dot = $("dot");
  const status = $("status");
  if (!h.ok || !h.data) {
    dot.className = "dot bad";
    status.className = "status bad";
    status.textContent = "本地服务未启动 — 运行 pnpm serve";
    return;
  }
  dot.className = "dot ok";
  status.className = "status ok";
  status.textContent = `服务在线 · 策展库 ${h.data.records} 条`;

  const r = await send<{ records: CurationRecord[] }>({ type: "records" });
  if (!r.ok || !r.data) return;
  const list = $("list");
  for (const rec of r.data.records.slice(0, 50)) {
    const li = document.createElement("li");
    const v = rec.verdict;
    li.innerHTML =
      `<span class="h">@${rec.handle}</span>` +
      `<span class="tag ${TAG[v.label]}">${ZH[v.label]} ${(v.confidence * 100).toFixed(0)}%</span>`;
    list.appendChild(li);
  }
})();

document.getElementById("panel")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
