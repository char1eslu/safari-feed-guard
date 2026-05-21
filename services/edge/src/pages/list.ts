// Public spam board — latest 100 human_confirmed accounts, polled every 30s
// against /v1/list. SSR-renders the shell; data is fetched client-side so the
// HTML stays trivial and Cloudflare's edge cache handles the JSON.
import { layout } from "./_layout";

const CSS = `
.head{padding:48px 0 22px;max-width:760px}
.head h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;font-weight:700;margin-bottom:14px}
.head p{font-size:14px;color:var(--fg-2);line-height:1.65}
.head p+p{margin-top:8px}
.head .pulse{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--fg-2);margin-top:18px;padding:6px 12px;border-radius:999px;background:var(--card);border:1px solid var(--border)}
.head .pulse .dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(16,185,129,.55);animation:pulse 2.4s ease-out infinite}
.head .pulse strong{color:var(--ok);font-weight:600}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}100%{box-shadow:0 0 0 8px rgba(16,185,129,0)}}

/* Aggregate row — hero cell + 3 secondaries */
.aggr{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:12px;margin:14px 0 26px}
.aggr .c{position:relative;padding:16px 18px;border-radius:12px;background:var(--card);border:1px solid var(--border);overflow:hidden}
.aggr .c.hero{background:linear-gradient(180deg,rgba(56,189,248,.06),var(--card))}
.aggr .c.hero::before{content:"";position:absolute;top:0;left:14px;right:14px;height:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent)}
.aggr .n{font-size:24px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.1}
.aggr .c.hero .n{font-size:34px;background:linear-gradient(180deg,#fff,#a3a8b3);-webkit-background-clip:text;background-clip:text;color:transparent}
.aggr .l{font-size:11.5px;color:var(--fg-3);margin-top:6px}

/* List rows — tight, scannable, color-coded left edge by verdict */
.list{display:flex;flex-direction:column;gap:6px}
.row{position:relative;display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:center;padding:10px 14px 10px 16px;border-radius:11px;background:var(--card);border:1px solid var(--border);transition:background .15s,border-color .15s,transform .25s ease,opacity .25s ease}
.row::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 2px 2px 0;background:var(--ec,transparent)}
.row.spam,.row.likely_spam{--ec:var(--danger)}
.row.porn_bot{--ec:var(--violet)}
.row.uncertain{--ec:var(--fg-4)}
.row.legit{--ec:var(--ok)}
.row:hover{background:var(--card-hi);border-color:var(--border-2)}
.row.new{animation:slidein .3s ease-out both}
@keyframes slidein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.row .av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#1a2238,#2a1640);overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--fg-4);font-size:13px;font-weight:600;flex-shrink:0}
.row .av img{width:100%;height:100%;object-fit:cover;display:block}
.row .meta{min-width:0}
.row .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.row .handle{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.row .handle a{color:var(--fg)}
.row .handle a:hover{color:var(--accent)}
.row .name{font-size:12.5px;color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}
.row .fresh{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;color:var(--accent);padding:2px 7px;border-radius:6px;background:var(--accent-soft);letter-spacing:.04em}
.row .fresh::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
.row .sub{font-size:11.5px;color:var(--fg-3);margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.row .sub .sep{color:var(--fg-4);opacity:.6}
.row .right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.row .conf{display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:54px}
.row .conf .pct{font-size:11.5px;color:var(--fg-2);font-variant-numeric:tabular-nums;font-weight:500}
.row .conf .bar{width:50px;height:3px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}
.row .conf .bar i{display:block;height:100%;background:var(--ec,var(--fg-3));border-radius:2px;transition:width .3s ease}
.row .ext{color:var(--fg-4);display:inline-flex;padding:6px;border-radius:7px;transition:background .15s,color .15s}
.row .ext:hover{background:rgba(255,255,255,.08);color:var(--fg)}
.row .ext svg{width:14px;height:14px}

.more{margin-top:18px;text-align:center}
.empty{padding:60px 20px;text-align:center;color:var(--fg-3);border:1px dashed var(--border-2);border-radius:14px}
.note{font-size:12px;color:var(--fg-4);margin-top:22px;line-height:1.7;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.02)}
.note code{background:rgba(255,255,255,.06);padding:1px 6px;border-radius:4px;font-size:11px;color:#7dd3fc}

@media (max-width:760px){
  .head h1{font-size:26px}
  /* Hero (count) takes top, derived "日均" hidden, remaining 2 cards split a row */
  .aggr{grid-template-columns:1fr 1fr;gap:10px}
  .aggr .c.hero{grid-column:1/-1}
  .aggr .c.daily{display:none}
}
@media (max-width:480px){
  .row{grid-template-columns:32px 1fr auto;gap:10px;padding:9px 12px 9px 14px}
  .row .av{width:32px;height:32px}
  .row .handle{max-width:140px;font-size:13.5px}
  .row .name{display:none}
  .row .conf{min-width:46px}
  .row .conf .bar{width:42px}
}
`;

const ICON_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const SHELL = `
<section class="head">
  <h1>公开 spam 榜单</h1>
  <p>最近 100 个被 AI 高置信判定 <strong>且</strong> 至少 3 个独立 GitHub 用户共识的 X 账号。除公开数字 ID 外不存任何信息。</p>
  <p>如发现误判，请提 <a href="https://github.com/onenorthlab/x-spam-sentinel/issues/new" style="color:var(--accent)">申诉 issue</a>，48h 内复核移除。</p>
  <div class="pulse"><span class="dot" aria-hidden="true"></span><span id="pulseLabel">连接中…</span></div>
</section>

<div class="aggr">
  <div class="c hero"><div class="n" id="agCount">—</div><div class="l">已确认总数</div></div>
  <div class="c"><div class="n" id="agWeek">—</div><div class="l">本周新增</div></div>
  <div class="c daily"><div class="n" id="agDaily">—</div><div class="l">日均</div></div>
  <div class="c"><div class="n" id="agLatest">—</div><div class="l">最近一条</div></div>
</div>

<div class="list" id="list" role="list"><div class="empty">加载中…</div></div>

<div class="more"><button class="btn sm" id="moreBtn" hidden>加载更早 100 条</button></div>

<p class="note">数据接口：<code>GET /v1/list?limit=100&amp;before=&lt;ms&gt;</code> · 边缘缓存 <code>s-maxage=30</code> · 客户端每 30 秒轮询增量。</p>
`;

// Client behavior:
//  - First render: fetch /v1/list?limit=100
//  - Poll every 30s with ?since=<latestAt> → prepend new rows with .new fade-in
//  - "Load more" pages with ?before=<oldest published_at>
//  - Pulse label is actionable: "刚刚同步 / 无新增 N 秒前 / +M 条 · N 秒前"
const SCRIPT = `
(function(){
  var listEl=document.getElementById('list'),moreBtn=document.getElementById('moreBtn'),pulseLabel=document.getElementById('pulseLabel');
  var rows=[],latestAt=null,oldestAt=null,exhausted=false,lastPollAt=Date.now();
  var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FRESH_MS=5*60*1000;
  function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return typeof n==='number'?n.toLocaleString('zh-CN'):'—'}
  function ago(ms){if(!ms)return'';var d=Date.now()-ms,s=Math.round(d/1000);if(s<10)return'刚刚';if(s<60)return s+' 秒前';var m=Math.round(s/60);if(m<60)return m+' 分钟前';var h=Math.round(m/60);if(h<24)return h+' 小时前';return Math.round(h/24)+' 天前'}
  function avatarHtml(r){
    var url=r.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(r.handle));
    var fallback=esc((r.handle||'?').slice(0,1).toUpperCase());
    return '<div class="av"><img src="'+esc(url)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\\'span\\'),{textContent:\\''+fallback+'\\'}))"/></div>';
  }
  function rowHtml(r,fresh){
    var lbl=r.verdict_label||'uncertain';
    var conf=typeof r.confidence==='number'?Math.max(0,Math.min(100,Math.round(r.confidence*100))):0;
    var isFresh=r.published_at&&(Date.now()-r.published_at)<FRESH_MS;
    var name=r.display_name?'<span class="name">'+esc(r.display_name)+'</span>':'';
    var freshBadge=isFresh?'<span class="fresh">新</span>':'';
    return '<div class="row '+esc(lbl)+(fresh?' new':'')+'" role="listitem" data-pt="'+r.published_at+'">'
      +avatarHtml(r)
      +'<div class="meta">'
        +'<div class="top">'
          +'<span class="handle"><a href="https://x.com/'+encodeURIComponent(r.handle)+'" target="_blank" rel="noopener noreferrer">@'+esc(r.handle)+'</a></span>'
          +name
          +freshBadge
        +'</div>'
        +'<div class="sub">'
          +'<span class="tag '+esc(lbl)+'">'+esc(lbl)+'</span>'
          +'<span class="sep">·</span><span>'+ago(r.published_at)+'</span>'
          +'<span class="sep">·</span><span>'+(r.reporters|0)+' 独立举报</span>'
        +'</div>'
      +'</div>'
      +'<div class="right">'
        +'<div class="conf" title="AI confidence">'
          +'<span class="pct">'+conf+'%</span>'
          +'<div class="bar"><i style="width:'+conf+'%"></i></div>'
        +'</div>'
        +'<a class="ext" href="https://x.com/'+encodeURIComponent(r.handle)+'" target="_blank" rel="noopener noreferrer" aria-label="去 X 主页">${ICON_EXT}</a>'
      +'</div>'
      +'</div>';
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
  function setPulse(msg){pulseLabel.innerHTML=msg}
  function load(){
    return fetch('/v1/list?limit=100').then(function(r){return r.json()}).then(function(j){
      rows=j.list||[];latestAt=j.latestAt;oldestAt=j.nextBefore;exhausted=!oldestAt;
      moreBtn.hidden=exhausted;render();
      lastPollAt=Date.now();
      setPulse('<strong>已同步</strong>·共 '+fmt(rows.length)+' 条');
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
      lastPollAt=Date.now();
      var fresh=j.list||[];
      if(!fresh.length){setPulse('无新增·'+ago(lastPollAt));return}
      var seen=Object.create(null);rows.forEach(function(r){seen[key(r)]=1});
      var added=fresh.filter(function(r){return !seen[key(r)]});if(!added.length){setPulse('无新增·'+ago(lastPollAt));return}
      rows=added.concat(rows);latestAt=j.latestAt||latestAt;
      var frag=document.createDocumentFragment();
      added.forEach(function(r){
        var div=document.createElement('div');div.innerHTML=rowHtml(r,!reduced);frag.appendChild(div.firstElementChild);
      });
      listEl.insertBefore(frag,listEl.firstChild);
      setPulse('<strong>+'+added.length+' 新条目</strong>·'+ago(lastPollAt));
    }).catch(function(){setPulse('网络错误·'+ago(lastPollAt))})
  }
  function refreshMeta(){fetch('/v1/list/meta').then(function(r){return r.json()}).then(refreshAggr).catch(function(){})}
  moreBtn.addEventListener('click',loadMore);
  load().then(refreshMeta);
  setInterval(poll,30000);
  setInterval(refreshMeta,60000);
  // Keep relative timestamps from going stale
  setInterval(function(){if(rows.length)render();refreshMeta()},90000);
})();
`;

export function listHtml(): string {
  return layout({
    title: "公开 spam 榜单 · x-spam-sentinel",
    current: "list",
    css: CSS,
    head: `<meta name="robots" content="noindex,follow">`,
    body: SHELL,
    script: SCRIPT,
  });
}
