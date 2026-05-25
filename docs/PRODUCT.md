# Product direction & management panel

Public product notes for shaping MXGA beyond a single "block helper".

## From feature → product

MXGA = **an X anti-spam + (later) account-reputation extension**,
three pillars:

1. **Protect** *(built, working)* — passive detection, inline badges,
   bottom-right bubble, one-click block, blocklist short-circuit, local
   verdict cache / de-dup.
2. **Manage** *(active)* — a management panel: overview, blocklist
   records, detection-cache browser, settings, about/license.
3. **Reputation** *(future)* — crowdsourced account scoring / aggregated
   takes on big accounts. This is kept as a direction note so the data model
   does not paint the project into a corner.

## Management panel

**Surface:** the extension **Options page** (full browser tab — room for a
data-dense panel). The toolbar popup stays a lightweight status chip with an
"打开管理面板" entry.

**IA (left nav):**

| 区 | 内容 | 操作 |
|---|---|---|
| 概览 Overview | stat 卡：检测总数 · 已拉黑 · 命中名单 · **缓存命中省下的 LLM 次数** · 本周新增；类别分布(色情bot/垃圾/疑似/正常)；最近活动 | — |
| 拉黑记录 Blocklist | 表：头像·显示名·@handle·userId·拉黑时间·来源(手动/一键全部/名单命中)·判定+理由 | 取消拉黑(误判恢复)·复制 ID·申诉·搜索/筛选/排序·导出 JSON/CSV·导入 |
| 检测缓存 Cache | L2 账号判定缓存浏览：头像·名·handle·判定·置信·模型·时间·TTL 剩余 | 重新检测(force)·拉黑·删除该条·清空·按 label 筛选；顶部显示缓存效益 |
| 设置 Settings | 自动阈值 · 每页 LLM 预算 · 气泡开关/位置 · 回复区自动检测开关 · LLM endpoint/model · 数据保留 TTL · 清空数据 | — |
| 关于 About(版权页) | 名称/版本 · AGPL-3.0 · 治理摘要+链接(GOVERNANCE.md) · 隐私声明(除公开数字 ID 外不存 PII) · 误判申诉入口 · 仓库/反馈链接 · 致谢 | — |

## Data-model notes

Today's storage is too thin for a useful panel — upgrade (backward-safe):

- **Blocklist** `xss:blocked`: `string[]` → records
  `{ id, handle, displayName, avatarUrl, verdict, reason, source, ts }`.
  Reading a legacy `string[]` auto-migrates.
- **Cache** `xss:v1:*`: keep verdict/hash/model/ts, **add**
  handle/displayName/avatarUrl for display.
- **Stats** new `xss:stats`: cumulative counters (detections, cache-hits =
  LLM calls saved, blocks, per-label) to power Overview cheaply.

All data stays local in `chrome.storage.local`. **No PII** beyond the public
numeric id. Governance red-lines unchanged (user-confirmed block = the
public-DB human-confirm signal; AI never auto-publishes).

## Visual

Reuse the extension's existing design system (`lib/ui.ts` tokens): dark-glass
surface, security blue `#0EA5E9` + protected green, danger/warn, system font,
Lucide SVG icons. The panel is the full-page member of the **same** system
(OLED-dark, blue data + sparing amber highlight, minimal glow, visible focus,
`prefers-reduced-motion`, no emoji icons). Consistency over novelty — no new
font (skill suggested Fira; we keep system-ui for cohesion with the in-page UI).

## Delivery slices

- **P0** Overview + Blocklist + About (minimal usable loop; needs the
  data-model upgrade + a shared `lib/store.ts`).
- **P1** Cache browser + export/import.
- **P2** Settings takes over the hard-coded constants / `.env` knobs.
- **Later** Reputation pillar.
