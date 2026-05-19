# UX & interaction design

Status: **proposed**. Goal: turn the crude MVP extension into a polished,
non-intrusive product that sits tastefully on top of X's dark UI.

## 0. Requirement synthesis (梳理)

What the extension must do, organized:

1. **Passive detection** while you browse — never scrape, never act without
   a user gesture (governance red-line, see GOVERNANCE.md).
2. **Inline signal** — each suspicious account gets a refined badge on its
   tweet, with reasons on hover and per-account actions.
3. **Ambient summary** — an elegant **bottom-right bubble** that says
   "本页发现 N 个可疑账号" and offers **一键拉黑全部** (user-initiated, with
   preview + undo) and "逐个处理".
4. **Control surface** — a polished toolbar **popup**: service status,
   this-page / this-session counts, recent detections, settings,
   transparency link.
5. **Trustworthy by design** — looks like security tooling, not a gamer
   overlay; restrained motion; accessible; honest about uncertainty
   (低置信不报警、不诱导隐藏).

## 1. Scaffold recommendation: **WXT**

The current extension is hand-written MV3 JS — fine for the MVP, too crude
to scale UX. Adopt **[WXT](https://wxt.dev/)** (the 2026 consensus winner):

- Vite-powered, fast HMR, framework-agnostic (we'll use **vanilla + Shadow
  DOM** for the content UI — no framework weight injected into X's page).
- Auto manifest, cross-browser (Chrome/Firefox/Edge) from one codebase,
  ~400 KB output, actively maintained.
- vs **Plasmo** (Parcel, perceived maintenance-mode, ~800 KB) and **CRXJS**
  (Chrome-only, history of instability).

Sources: [framework comparison](https://redreamality.com/blog/the-2025-state-of-browser-extension-frameworks-a-comparative-analysis-of-plasmo-wxt-and-crxjs/),
[WXT compare](https://wxt.dev/guide/resources/compare), [WXT](https://github.com/wxt-dev/wxt).

**Critical:** render all in-page UI inside a **Shadow DOM** (WXT
`createShadowRootUi`) so X's CSS can't bleed in and ours can't leak out —
this is the root cause of "crude". Keep detection logic; only the UI layer
and packaging change.

## 2. Visual language

Sits on X dark UI as a distinct but quiet "security layer".

| Token | Value | Use |
|---|---|---|
| `--xss-surface` | `rgba(13,17,23,.85)` + `backdrop-filter: blur(12px)` | bubble/popover/popup |
| `--xss-border` | `rgba(255,255,255,.08)` | hairline edges |
| `--xss-shadow` | `0 8px 28px rgba(0,0,0,.45)` | float elevation |
| `--xss-text` / `--xss-muted` | `#E6EDF3` / `#8B949E` | text |
| `--xss-brand` | `#0EA5E9` | trust accent (shield) |
| `--xss-danger` | `#EF4444` | spam / porn_bot |
| `--xss-warn` | `#F59E0B` | likely_spam |
| `--xss-neutral` | `#8B949E` | uncertain (no alarm color) |
| `--xss-safe` | `#22C55E` | legit / success |
| radius | `14px` card · `999px` pill | — |
| font | `system-ui, -apple-system, "Segoe UI"` | native to X, no FOUT |
| motion | `180ms ease-out` in · `140ms ease-in` out · `translateY(8px)+opacity`; **fade-only under `prefers-reduced-motion`** | — |

**Icons: SVG only, no emoji.** Lucide, 1.75 stroke, 16px: `shield`,
`shield-alert`, `shield-x`, `shield-check`, `eye-off`, `flag`, `x`.
(The current 🛡 emoji is the single biggest "crude" tell — remove it.)

Palette derived from the design-system pass: "security blue + protected
green", adapted to dark (skill flagged light-mode/neon as anti-patterns —
we use restrained glass, minimal glow, not cyberpunk).

## 3. The bottom-right bubble (headline)

Default **resting = collapsed pill**; expands on hover/click. Never covers
X's compose box; coalesced, not spammy.

```
 collapsed (resting):                expanded (hover / new findings):
 ┌───────────┐                      ┌──────────────────────────────────┐
 │ ◈  3      │   ◄ click/hover ►    │ ◈  本页发现 3 个可疑账号        ✕ │
 └───────────┘                      │ ──────────────────────────────── │
   shield icon                      │  ● 2 色情bot   ● 1 疑似垃圾       │
   + live count                     │                                  │
                                    │  [ 一键拉黑全部 (3) ]  ← danger   │
                                    │  逐个查看处理      忽略本页        │
                                    └──────────────────────────────────┘
```

Behaviour:
- Appears only after a scan settles (debounce ~1.2s); count updates live but
  **coalesced** (no fl::icker per scroll).
- Auto-minimizes to the pill after ~8s idle; dismiss is **per-tab, persisted**.
- `role="status"`, `aria-live="polite"`, focusable, **Esc closes**,
  respects `prefers-reduced-motion`.
- **一键拉黑全部** is user-initiated: opens a 1-line confirm → runs X's
  native block per account with a progress row and a **5s undo** window.
  Never silent, never auto (governance + matches "不完全自动 block").
- Empty state: bubble simply never appears (no "0 found" noise).

## 4. Inline tweet badge

Replaces the crude emoji button. A compact pill on the author row:

```
 名字 @handle · 2h   ⬡ 色情bot 92%        ← danger fill, SVG shield-x
 名字 @handle · 5h   ⬡ 疑似 64%           ← warn outline
 名字 @handle · 1h   ⬡ 检查               ← ghost, for clean/unscanned (manual)
```

Hover/focus → **popover card** (Shadow DOM, not a native `title`): verdict,
confidence, bullet reasons, account-age/avatar signal chips, and actions
`拉黑 · 隐藏 · 上报 · 误判?`. `隐藏` only for spam classes ≥0.6 (already
shipped). `误判?` deep-links the appeal flow (governance).

## 5. Popup (toolbar)

360px, dark glass, three blocks: **status** (dot + "服务在线 · 名单 vN") ·
**本页/本会话计数** · **最近检测列表** (handle, verdict pill). Footer:
settings (auto-threshold slider, bubble on/off, scan scope) + a
"为什么/治理" transparency link to GOVERNANCE.md.

## 6. Toolbar icon states

Single shield mark, exported 16/32/48/128. Badge text = current-tab count
when >0, badge color = max severity (danger/warn). Idle = monochrome; active
findings = brand-tinted. (Designed as SVG → PNG, not emoji.)

## 7. Accessibility & performance checklist

- [ ] Contrast ≥ 4.5:1 on glass (verified for text on `--xss-surface`)
- [ ] Focus rings on all actions; full keyboard path; Esc closes overlays
- [ ] `prefers-reduced-motion` → fade only, no translate
- [ ] Color never the only signal (icon + label + color together)
- [ ] Shadow DOM isolation; z-index namespaced, below X's own modals
- [ ] Bubble never blocks compose / reply UI; coalesced updates
- [ ] No emoji as icons; SVG set consistent (Lucide 24 viewBox)
- [ ] Touch/click targets ≥ 32px in-page, ≥44px in popup

## 8. Scope / next step

This doc is the design. Implementation is a separate, sizeable step
(WXT migration + Shadow-DOM UI rebuild) — proposed under T2 (LUO-17),
pending the maintainer's go-ahead on the questions raised in the thread.
