// Shared shell for the public Worker pages (/ landing, /list public board).
// Everything self-contained — no external fonts / JS / CSS so the page is
// servable under a strict CSP and stays well under 1.5s LCP on cold edge.

const GH_REPO = "https://github.com/onenorthlab/x-spam-sentinel";
// Latest GitHub Release; the redirect resolves to the newest .zip asset.
const RELEASE_URL = `${GH_REPO}/releases/latest`;

/** Dark-glass design tokens + reusable utility classes; bytes are cheap. */
const CSS = `:root{
  color-scheme:dark;
  --bg:#0a0a0a; --fg:#e6edf3; --fg-2:#a3a8b3; --fg-3:#8b949e; --fg-4:#6b7280;
  --border:rgba(255,255,255,.08); --border-2:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.035); --card-hi:rgba(255,255,255,.06);
  --accent:#38bdf8; --accent-soft:rgba(56,189,248,.14);
  --danger:#ef4444; --warn:#f59e0b; --ok:#10b981; --violet:#a855f7;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{min-height:100vh;background:
  radial-gradient(1200px 600px at 20% -10%,rgba(56,189,248,.08),transparent 60%),
  radial-gradient(900px 540px at 100% 10%,rgba(168,85,247,.055),transparent 55%),
  var(--bg)}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}

/* Keyboard focus — visible on all interactive surfaces */
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.btn:focus-visible,.tag:focus-visible{outline-offset:3px}

.wrap{max-width:1040px;margin:0 auto;padding:0 24px}

/* Top nav */
.nav{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.2px}
.brand svg{width:24px;height:24px;color:var(--accent)}
.nav .links{display:flex;gap:6px;font-size:13px;color:var(--fg-2)}
.nav .links a{padding:6px 12px;border-radius:8px;transition:color .15s,background .15s}
.nav .links a:hover{color:var(--fg);background:rgba(255,255,255,.04)}
.nav .links a.on{color:var(--fg);background:var(--accent-soft);box-shadow:inset 0 -1px 0 var(--accent)}

.muted{color:var(--fg-3)}
.tiny{font-size:12px;color:var(--fg-3)}

/* Button — three tiers: primary (light), default (glass), danger (red ghost) */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:500;line-height:1;border:1px solid var(--border-2);background:var(--card);backdrop-filter:blur(8px);transition:background .15s,border-color .15s,transform .12s,box-shadow .15s;white-space:nowrap}
.btn:hover{background:var(--card-hi);border-color:rgba(255,255,255,.22)}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:#fafafa;color:#0a0a0a;border-color:transparent;box-shadow:0 0 0 1px rgba(56,189,248,.5),0 6px 18px -8px rgba(56,189,248,.45)}
.btn.primary:hover{background:#fff;box-shadow:0 0 0 1px rgba(56,189,248,.65),0 8px 24px -8px rgba(56,189,248,.55)}
.btn.danger{color:#fca5a5;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.06)}
.btn.danger:hover{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.55);color:#fecaca}
.btn.sm{padding:6px 10px;font-size:12.5px;border-radius:8px}
.btn svg{width:15px;height:15px;flex-shrink:0}

/* Card */
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;backdrop-filter:blur(10px)}

/* Verdict tag — color tied to severity */
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.2;letter-spacing:.02em}
.tag.spam{color:var(--danger)}
.tag.porn_bot{color:var(--violet)}
.tag.likely_spam{color:var(--warn)}
.tag.uncertain{color:var(--fg-3)}
.tag.legit{color:var(--ok)}

/* Footer */
.foot{margin-top:80px;padding:32px 0 48px;border-top:1px solid var(--border);font-size:13px;color:var(--fg-3);display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px}
.foot a:hover{color:var(--fg)}
.foot .sep{color:var(--fg-4);margin:0 6px}

@media (max-width:640px){.wrap{padding:0 16px}.nav .links{gap:2px;font-size:12px}.nav .links a{padding:5px 9px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
`;

const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;

/** HTML-escape user-rendered strings. */
export function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface LayoutOpts {
  title: string;
  current: "home" | "list" | "github";
  /** Per-page CSS appended to the shared sheet. */
  css?: string;
  /** Extra <meta> / <link> tags injected into <head>. */
  head?: string;
  /** Body content. */
  body: string;
  /** Inline JS module (no external) appended at end of body. */
  script?: string;
}

export function layout(o: LayoutOpts): string {
  const navItem = (key: LayoutOpts["current"], href: string, label: string) =>
    `<a href="${href}"${o.current === key ? ' class="on"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(o.title)}</title>
${o.head ?? ""}
<style>${CSS}${o.css ?? ""}</style>
</head><body>
<header class="wrap nav" role="banner">
  <a class="brand" href="/" aria-label="x-spam-sentinel 首页">${LOGO_SVG}<span>x-spam-sentinel</span></a>
  <nav class="links" aria-label="主导航">
    ${navItem("list", "/list", "公榜")}
    ${navItem("github", GH_REPO, "GitHub")}
  </nav>
</header>
<main class="wrap" role="main">
${o.body}
</main>
<footer class="wrap foot" role="contentinfo">
  <span>© 2026 OneNorth Lab<span class="sep">·</span>AGPL-3.0</span>
  <span>
    <a href="${GH_REPO}">仓库</a><span class="sep">·</span>
    <a href="${GH_REPO}/blob/main/docs/GOVERNANCE.md">治理</a><span class="sep">·</span>
    <a href="${GH_REPO}/blob/main/docs/PRIVACY.md">隐私</a><span class="sep">·</span>
    <a href="${GH_REPO}/issues">反馈</a>
  </span>
</footer>
${o.script ? `<script>${o.script}</script>` : ""}
</body></html>`;
}

export const LINKS = { GH_REPO, RELEASE_URL };
