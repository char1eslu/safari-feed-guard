// Shared shell for the public Worker pages (/ landing, /list public board).
// Everything self-contained — no external fonts / JS / CSS so the page is
// servable under a strict CSP and stays well under 1.5s LCP on cold edge.

const GH_REPO = "https://github.com/onenorthlab/x-spam-sentinel";
// Latest GitHub Release; the redirect resolves to the newest .zip asset.
const RELEASE_URL = `${GH_REPO}/releases/latest`;

/** Dark-glass design tokens + reusable utility classes; bytes are cheap. */
const CSS = `:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#0a0a0a;color:#e6edf3;font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh;background:
  radial-gradient(1200px 600px at 20% -10%,rgba(56,189,248,.07),transparent 60%),
  radial-gradient(800px 500px at 100% 10%,rgba(168,85,247,.05),transparent 55%),
  #0a0a0a}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
.nav{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.2px}
.brand svg{width:24px;height:24px}
.nav .links{display:flex;gap:22px;font-size:13px;color:#a3a8b3}
.nav .links a{transition:color .15s ease}
.nav .links a:hover,.nav .links a.on{color:#e6edf3}
.muted{color:#8b949e}
.tiny{font-size:12px;color:#8b949e}
.btn{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:500;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);backdrop-filter:blur(8px);transition:background .15s,border-color .15s,transform .15s}
.btn:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}
.btn.primary{background:#e6edf3;color:#0a0a0a;border-color:transparent}
.btn.primary:hover{background:#fff}
.btn svg{width:15px;height:15px;flex-shrink:0}
.card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:14px;backdrop-filter:blur(10px)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.2}
.tag.spam{color:#ef4444}.tag.porn_bot{color:#a855f7}.tag.likely_spam{color:#f59e0b}.tag.uncertain{color:#8b949e}.tag.legit{color:#10b981}
.foot{margin-top:80px;padding:32px 0 48px;border-top:1px solid rgba(255,255,255,.06);font-size:13px;color:#8b949e;display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px}
.foot a:hover{color:#e6edf3}
@media (max-width:640px){.wrap{padding:0 16px}.nav .links{gap:14px;font-size:12px}}
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
  <span>© 2026 OneNorth Lab · AGPL-3.0</span>
  <span>
    <a href="${GH_REPO}">仓库</a> ·
    <a href="${GH_REPO}/blob/main/docs/GOVERNANCE.md">治理</a> ·
    <a href="${GH_REPO}/blob/main/docs/PRIVACY.md">隐私</a> ·
    <a href="${GH_REPO}/issues">反馈</a>
  </span>
</footer>
${o.script ? `<script>${o.script}</script>` : ""}
</body></html>`;
}

export const LINKS = { GH_REPO, RELEASE_URL };
