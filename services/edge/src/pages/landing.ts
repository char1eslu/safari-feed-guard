// Product landing — public, zero-PII, dark glass. Static HTML; the live
// stats strip fetches /v1/list/meta client-side and degrades silently.
import { LINKS, layout } from "./_layout";

const CSS = `
.hero{padding:72px 0 56px;text-align:left;max-width:760px}
.hero h1{font-size:44px;line-height:1.15;letter-spacing:-.02em;font-weight:700;margin:0 0 18px}
.hero h1 .accent{color:#38bdf8}
.hero .lede{font-size:17px;color:#a3a8b3;max-width:580px;margin-bottom:30px}
.hero .ctas{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.hero .meta{font-size:12px;color:#6b7280;letter-spacing:.3px}
.hero .meta span+span{margin-left:14px}
.hero .meta span::before{content:"·";margin-right:14px;color:#3a3f4b}.hero .meta span:first-child::before{content:""}
section.block{padding:48px 0;border-top:1px solid rgba(255,255,255,.06)}
section.block h2{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8b949e;font-weight:600;margin-bottom:24px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.step{padding:18px 18px 20px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
.step .n{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:7px;background:rgba(56,189,248,.12);color:#38bdf8;font-size:12px;font-weight:700;margin-bottom:12px}
.step h3{font-size:15px;font-weight:600;margin-bottom:6px}
.step p{font-size:13px;line-height:1.55;color:#a3a8b3}
.trust{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.trust .row{display:flex;gap:14px;align-items:flex-start;padding:18px 20px;border-radius:14px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05)}
.trust .row .ic{width:28px;height:28px;flex-shrink:0;color:#10b981;background:rgba(16,185,129,.1);border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
.trust .row .ic svg{width:16px;height:16px}
.trust .row h3{font-size:14px;font-weight:600;margin-bottom:4px}
.trust .row p{font-size:13px;line-height:1.55;color:#a3a8b3}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.stat{padding:20px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
.stat .n{font-size:30px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat .n.skel{display:inline-block;width:60px;height:34px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.1),rgba(255,255,255,.04));background-size:200% 100%;animation:shim 1.4s ease-in-out infinite;border-radius:6px;vertical-align:middle}
@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.stat .lbl{font-size:12px;color:#8b949e;margin-top:6px}
.install-note{margin-top:18px;font-size:13px;color:#a3a8b3;background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.2);border-radius:12px;padding:14px 16px;max-width:560px;display:none}
.install-note.open{display:block}
.install-note ol{margin:8px 0 0 18px}.install-note li{margin:4px 0}
.install-note code{background:rgba(255,255,255,.06);padding:1px 6px;border-radius:4px;font-size:12px}
@media (max-width:760px){.hero{padding:48px 0 40px}.hero h1{font-size:32px}.steps{grid-template-columns:1fr 1fr}.trust{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
@media (max-width:440px){.steps{grid-template-columns:1fr}.stats{grid-template-columns:1fr}}
`;

const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_GH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_DB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`;
const ICON_USER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const HERO = `
<section class="hero">
  <h1>替你拦下 X 上的<br><span class="accent">垃圾与色情机器人</span>。</h1>
  <p class="lede">被动检测 · AI 判定 · 社区共识 · 真·拉黑。完全开源（AGPL-3.0），不收集任何用户数据。</p>
  <div class="ctas">
    <a class="btn primary" href="${LINKS.RELEASE_URL}" id="installBtn">${ICON_DOWNLOAD}<span>安装到 Chrome</span></a>
    <a class="btn" href="${LINKS.GH_REPO}">${ICON_GH}<span>在 GitHub 上查看</span></a>
    <a class="btn" href="/list">${ICON_LIST}<span>看公榜</span></a>
  </div>
  <p class="meta"><span>AGPL-3.0</span><span>不收集 PII</span><span>不追踪</span><span>开源可审计</span></p>
  <div class="install-note" id="installNote">
    <strong>开发者模式安装（CWS 上架前的临时入口）：</strong>
    <ol>
      <li>下载并解压 GitHub Releases 的最新 <code>.zip</code></li>
      <li>打开 <code>chrome://extensions</code>，右上角开启「开发者模式」</li>
      <li>点击「加载已解压的扩展程序」，选择解压后的目录</li>
      <li>访问 x.com 即开始被动检测</li>
    </ol>
  </div>
</section>
`;

const HOW = `
<section class="block">
  <h2>它怎么工作</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>安装扩展</h3><p>Chrome 即用，Edge 兼容，Firefox 即将支持。无需注册。</p></div>
    <div class="step"><div class="n">2</div><h3>被动检测</h3><p>仅在你刷到的账号上做分析；从不主动爬取，从不代你操作。</p></div>
    <div class="step"><div class="n">3</div><h3>你举报 + 社区共识</h3><p>AI 判定 + 至少 3 个独立 GitHub 用户佐证，才进公开名单。</p></div>
    <div class="step"><div class="n">4</div><h3>真·拉黑</h3><p>驱动 X 自身屏蔽接口，多端同步生效，不是只是本地隐藏。</p></div>
  </div>
</section>
`;

const TRUST = `
<section class="block">
  <h2>四条治理铁律</h2>
  <div class="trust">
    <div class="row"><span class="ic">${ICON_SHIELD}</span><div><h3>AI 单独不能自动公开</h3><p>必须人工审核 或 ≥3 个独立 GitHub 上报人共识才入公榜，红线写进数据库状态机。</p></div></div>
    <div class="row"><span class="ic">${ICON_LOCK}</span><div><h3>不收集 PII</h3><p>服务端只存 X 公开数字 ID 与举报人 GitHub 数字 ID；扩展端默认不上传任何浏览数据。</p></div></div>
    <div class="row"><span class="ic">${ICON_DB}</span><div><h3>状态机锁红线</h3><p>auto_pending_review → human_confirmed 的状态转换只接受人工或社区共识，AI 触发会被路由层拒绝。</p></div></div>
    <div class="row"><span class="ic">${ICON_USER}</span><div><h3>GitHub 登录可写</h3><p>举报与拉黑确认需 GitHub Device Flow 登录，反滥用、可追溯；不强制注册账号。</p></div></div>
  </div>
</section>
`;

const LIVE = `
<section class="block">
  <h2>实时透明</h2>
  <div class="stats">
    <div class="stat"><div class="n" id="sCount"><span class="skel"></span></div><div class="lbl">已确认的 spam / bot 账号</div></div>
    <div class="stat"><div class="n" id="sWeek"><span class="skel"></span></div><div class="lbl">本周新增</div></div>
    <div class="stat"><div class="n" id="sPending"><span class="skel"></span></div><div class="lbl">待人工审核</div></div>
  </div>
  <p class="tiny" style="margin-top:14px">数据每 60 秒更新一次。<a href="/list" style="color:#38bdf8">查看完整公榜 →</a></p>
</section>
`;

const SCRIPT = `
(function(){
  var btn=document.getElementById('installBtn'),note=document.getElementById('installNote');
  if(btn&&note){btn.addEventListener('click',function(e){if(!note.classList.contains('open')){e.preventDefault();note.classList.add('open');setTimeout(function(){window.location=btn.href},900)}})}
  var fmt=function(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'};
  fetch('/v1/list/meta').then(function(r){return r.json()}).then(function(j){
    document.getElementById('sCount').textContent=fmt(j.count);
    document.getElementById('sWeek').textContent=(j.week>0?'+':'')+fmt(j.week);
    document.getElementById('sPending').textContent=fmt(j.pending)
  }).catch(function(){
    ['sCount','sWeek','sPending'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—'})
  })
})();
`;

export function landingHtml(): string {
  return layout({
    title: "x-spam-sentinel · 替你拦下 X 上的垃圾与色情机器人",
    current: "home",
    css: CSS,
    head: `<meta name="description" content="开源、半公开的 X(Twitter) 反垃圾扩展。AI 判定 + 社区共识，不收集 PII，AGPL-3.0。">`,
    body: HERO + HOW + TRUST + LIVE,
    script: SCRIPT,
  });
}
