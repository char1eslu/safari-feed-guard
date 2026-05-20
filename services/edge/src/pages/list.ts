// Public spam board — latest 100 human_confirmed accounts, polled every 30s
// against /v1/list. SSR-renders the shell; data is fetched client-side so the
// HTML stays trivial and Cloudflare's edge cache handles the JSON.
import { layout } from "./_layout";

const CSS = `
.head{padding:48px 0 28px;max-width:760px}
.head h1{font-size:32px;line-height:1.15;letter-spacing:-.015em;font-weight:700;margin-bottom:14px}
.head p{font-size:14px;color:#a3a8b3;line-height:1.6}
.head p+p{margin-top:8px}
.head .pulse{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#8b949e;margin-top:18px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.head .pulse .dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 0 0 rgba(16,185,129,.6);animation:pulse 2s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.6)}100%{box-shadow:0 0 0 10px rgba(16,185,129,0)}}
.aggr{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 26px}
.aggr .c{padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
.aggr .n{font-size:22px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.aggr .l{font-size:11.5px;color:#8b949e;margin-top:3px}
.list{display:flex;flex-direction:column;gap:8px}
.row{display:grid;grid-template-columns:40px 1fr auto;gap:14px;align-items:center;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);transition:background .15s,border-color .15s,transform .25s ease,opacity .25s ease}
.row:hover{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.1)}
.row.new{animation:slidein .3s ease-out both}
@keyframes slidein{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.row .av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1a2238,#2a1640);overflow:hidden;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:14px;font-weight:600}
.row .av img{width:100%;height:100%;object-fit:cover;display:block}
.row .meta{min-width:0}
.row .handle{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .handle a{color:#e6edf3}.row .handle a:hover{color:#38bdf8}
.row .sub{font-size:12px;color:#8b949e;margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.row .right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.row .right .rep{font-size:11px;color:#8b949e;font-variant-numeric:tabular-nums}
.row .ext{color:#6b7280;display:inline-flex;padding:6px;border-radius:6px;transition:background .15s,color .15s}
.row .ext:hover{background:rgba(255,255,255,.06);color:#e6edf3}
.row .ext svg{width:14px;height:14px}
.more{margin-top:18px;text-align:center}
.more button{padding:10px 18px;border-radius:10px;font-size:13px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#e6edf3}
.more button:hover{background:rgba(255,255,255,.08)}
.more button:disabled{opacity:.4;cursor:not-allowed}
.empty{padding:60px 20px;text-align:center;color:#8b949e;border:1px dashed rgba(255,255,255,.08);border-radius:14px}
.note{font-size:12px;color:#6b7280;margin-top:22px;line-height:1.6}
.note code{background:rgba(255,255,255,.06);padding:1px 6px;border-radius:4px;font-size:11px}
@media (max-width:640px){.head h1{font-size:26px}.aggr{grid-template-columns:1fr 1fr}.row{grid-template-columns:36px 1fr auto;gap:10px;padding:10px 12px}.row .av{width:36px;height:36px}}
`;

const ICON_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const SHELL = `
<section class="head">
  <h1>公开 spam 榜单</h1>
  <p>最近 100 个被 AI 高置信判定 <strong>且</strong> 至少 3 个独立 GitHub 用户共识的 X 账号。除公开数字 ID 外不存任何信息。</p>
  <p>如发现误判，请提 <a href="https://github.com/onenorthlab/x-spam-sentinel/issues/new" style="color:#38bdf8">申诉 issue</a>，48h 内复核移除。</p>
  <div class="pulse"><span class="dot"></span><span id="pulseLabel">实时同步中</span></div>
</section>

<div class="aggr">
  <div class="c"><div class="n" id="agCount">—</div><div class="l">已确认总数</div></div>
  <div class="c"><div class="n" id="agWeek">—</div><div class="l">本周新增</div></div>
  <div class="c"><div class="n" id="agDaily">—</div><div class="l">日均</div></div>
  <div class="c"><div class="n" id="agLatest">—</div><div class="l">最近一条</div></div>
</div>

<div class="list" id="list" role="list"><div class="empty">加载中…</div></div>

<div class="more"><button id="moreBtn" hidden>加载更早 100 条</button></div>

<p class="note">数据接口：<code>GET /v1/list?limit=100&amp;before=&lt;ms&gt;</code>，<code>Cache-Control: public, max-age=10, s-maxage=30</code>。</p>
`;

// Client behavior:
//  - First render: fetch /v1/list?limit=100
//  - Poll every 30s with ?since=<latestAt> → prepend any new rows with .new
//    fade-in (CSS animation), respect prefers-reduced-motion via CSS
//  - "Load more" pages with ?before=<oldest published_at>
//  - All rendering is innerHTML with esc; no DOM manipulation libraries
const SCRIPT = `
(function(){
  var listEl=document.getElementById('list'),moreBtn=document.getElementById('moreBtn'),pulseLabel=document.getElementById('pulseLabel');
  var rows=[],latestAt=null,oldestAt=null,exhausted=false,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<60)return s+'秒前';var m=Math.round(s/60);if(m<60)return m+'分钟前';var h=Math.round(m/60);if(h<24)return h+'小时前';return Math.round(h/24)+'天前'}
  function avatarHtml(r){
    var url=r.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(r.handle));
    var fallback=esc((r.handle||'?').slice(0,1).toUpperCase());
    return '<div class="av"><img src="'+esc(url)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\\'span\\'),{textContent:\\''+fallback+'\\'}))"/></div>';
  }
  function rowHtml(r,fresh){
    var lbl=r.verdict_label||'uncertain';
    var name=r.display_name?'<span class="muted" style="font-weight:400;font-size:12.5px">· '+esc(r.display_name)+'</span>':'';
    return '<div class="row'+(fresh?' new':'')+'" role="listitem" data-pt="'+r.published_at+'">'
      +avatarHtml(r)
      +'<div class="meta"><div class="handle"><a href="https://x.com/'+encodeURIComponent(r.handle)+'" target="_blank" rel="noopener noreferrer">@'+esc(r.handle)+'</a>'+name+'</div>'
      +'<div class="sub"><span class="tag '+esc(lbl)+'">'+esc(lbl)+'</span><span>'+ago(r.published_at)+'</span><span>· '+(r.reporters|0)+' 独立举报</span></div></div>'
      +'<div class="right"><span class="rep" title="AI confidence">'+(typeof r.confidence==='number'?(r.confidence*100|0)+'%':'')+'</span>'
      +'<a class="ext" href="https://x.com/'+encodeURIComponent(r.handle)+'" target="_blank" rel="noopener noreferrer" aria-label="去 X 主页">${ICON_EXT}</a></div></div>';
  }
  function render(){
    if(!rows.length){listEl.innerHTML='<div class="empty">还没有已确认条目。它会随着用户使用慢慢长出来。</div>';return}
    listEl.innerHTML=rows.map(function(r){return rowHtml(r,!1)}).join('');
  }
  function refreshAggr(meta){
    document.getElementById('agCount').textContent=fmt(meta.count);
    document.getElementById('agWeek').textContent=(meta.week>0?'+':'')+fmt(meta.week);
    document.getElementById('agDaily').textContent=fmt(Math.round((meta.week||0)/7));
    document.getElementById('agLatest').textContent=meta.generatedAt?ago(meta.generatedAt):'—';
  }
  function key(r){return (r.x_user_id||'')+'|'+r.handle}
  function load(){
    return fetch('/v1/list?limit=100').then(function(r){return r.json()}).then(function(j){
      rows=j.list||[];latestAt=j.latestAt;oldestAt=j.nextBefore;exhausted=!oldestAt;
      moreBtn.hidden=exhausted;render();
    })
  }
  function loadMore(){
    if(exhausted||!oldestAt)return;
    moreBtn.disabled=!0;moreBtn.textContent='加载中…';
    fetch('/v1/list?limit=100&before='+oldestAt).then(function(r){return r.json()}).then(function(j){
      var seen=Object.create(null);rows.forEach(function(r){seen[key(r)]=1});
      (j.list||[]).forEach(function(r){if(!seen[key(r)])rows.push(r)});
      oldestAt=j.nextBefore;exhausted=!oldestAt;moreBtn.hidden=exhausted;
      render();moreBtn.disabled=!1;moreBtn.textContent='加载更早 100 条'
    })
  }
  function poll(){
    if(!latestAt)return;
    fetch('/v1/list?limit=100&since='+latestAt).then(function(r){return r.json()}).then(function(j){
      var fresh=j.list||[];if(!fresh.length)return;
      var seen=Object.create(null);rows.forEach(function(r){seen[key(r)]=1});
      var added=fresh.filter(function(r){return !seen[key(r)]});if(!added.length)return;
      rows=added.concat(rows);latestAt=j.latestAt||latestAt;
      // Prepend new rows individually so only they get the fade-in.
      var frag=document.createDocumentFragment();
      added.forEach(function(r){
        var div=document.createElement('div');div.innerHTML=rowHtml(r,!reduced);frag.appendChild(div.firstElementChild);
      });
      listEl.insertBefore(frag,listEl.firstChild);
      pulseLabel.textContent='新增 '+added.length+' 条 · '+ago(Date.now())
    })
  }
  function refreshMeta(){fetch('/v1/list/meta').then(function(r){return r.json()}).then(refreshAggr).catch(function(){})}
  moreBtn.addEventListener('click',loadMore);
  load().then(refreshMeta);
  setInterval(poll,30000);
  setInterval(refreshMeta,60000);
})();
`;

export function listHtml(): string {
  return layout({
    title: "公开 spam 榜单 · x-spam-sentinel",
    current: "list",
    css: CSS,
    // Don't let search engines treat the public list as an indexed sitewide
    // blocklist; the source of truth is the JSON API + the appeal channel.
    head: `<meta name="robots" content="noindex,follow">`,
    body: SHELL,
    script: SCRIPT,
  });
}
