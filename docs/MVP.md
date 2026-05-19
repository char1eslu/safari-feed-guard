# Local MVP — service + browser extension

The end-to-end local loop: a browser extension reads accounts you're already
viewing on X (passive), a local service classifies on demand, verdicts land in
the private curation store. Strictly passive — no scraping, no automation, no
extra requests to X, no action taken on your account.

```
你刷 X  →  扩展 content-script 读到可见账号(被动)
              │  你点「🛡 检查」按钮  (POST 127.0.0.1:8787/classify)
              ▼
        本地服务 (T3 分类器 + 策展库 + /lookup 黑名单查询)
              │  verdict
              ▼
        扩展内联渲染：⚠️徽标 + 悬浮理由 + [隐藏]（仅本页折叠，不操作账号）
```

## 1. Start the local service

```bash
cp .env.example .env   # fill in LLM_*
pnpm install
pnpm serve             # -> http://127.0.0.1:8787
```

Endpoints: `GET /health`, `GET /lookup?userId=`, `GET /records`,
`POST /classify`. Localhost-only; CORS is dev-permissive on purpose.

## 2. Load the extension (one-time, manual)

Chrome can only load an unpacked extension through its own UI — it's a
~20-second manual step (no CLI/file-dialog automation for this):

1. `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select this repo's `extension/` folder
4. Open/refresh `x.com`

## 3. Use

- Each tweet/reply gets a small **🛡 检查** button next to the name. Click it
  to classify that account on demand (manual trigger keeps LLM cost controlled).
- Accounts already in your local curation store get a verdict pill
  automatically via `/lookup` — **no LLM call** (passive blocklist check).
- A flagged account shows a **隐藏** button: collapses it on the current page
  only, reverts on reload. Nothing is ever done to your X account.
- The toolbar popup shows service status + recent curation records.

## Validated against live X (2026-05)

- Numeric `userId` extracted from the avatar URL
  (`pbs.twimg.com/profile_images/<id>/...`) on the real, current X DOM —
  the passive id source works without any API.
- Full chain with real data: `@elonmusk` → `legit` 0.86 (no false positive);
  porn-bot fixture → `porn_bot` 0.98.

## Known gaps (tracked)

- If an account uses a default avatar the numeric id can't be resolved; the
  record is kept handle-keyed with `idResolved: false`. Final key policy is
  owned by T1 (LUO-16).
- Selectors target the current X DOM and will need maintenance — expected for
  a passive content-script approach.
- Extension is plain MV3 JS (no build step) to stay runnable for the MVP.
