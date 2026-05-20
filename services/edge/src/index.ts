import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { landingHtml } from "./pages/landing";
import { listHtml } from "./pages/list";

interface Env {
  DB: D1Database;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  LLM_API_KEY: string;
  // "1" => enforce GitHub auth on classify/report/confirm. Default off so
  // deploying T6 doesn't break the still-anonymous shipped extension; flip
  // on once the extension's GitHub login ships.
  REQUIRE_AUTH?: string;
  ADMIN_TOKEN?: string; // bearer for the admin moderation endpoints
}

type Ctx = Context<{ Bindings: Env }>;

const AUTO_CONF = 0.9; // AI confidence floor for auto-publish
const AUTO_REPORTERS = 3; // distinct GitHub reporters required for auto-publish

/** Verify a GitHub token → stable reporter id. null = not a valid identity. */
async function ghIdentity(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tok) return null;
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tok}`,
        "user-agent": "x-spam-sentinel",
        accept: "application/vnd.github+json",
      },
    });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: number };
    return u.id ? `gh:${u.id}` : null;
  } catch {
    return null;
  }
}

/** Enforce identity only when REQUIRE_AUTH is on. Returns reporter id (or
 *  "anon" when enforcement is off and no token). null => reject. */
async function requireReporter(c: Ctx): Promise<string | null> {
  const id = await ghIdentity(c.req.raw);
  if (id) return id;
  return c.env.REQUIRE_AUTH === "1" ? null : "anon";
}

const Signals = z.object({
  userId: z.string().optional(),
  handle: z.string().min(1),
  displayName: z.string().default(""),
  bio: z.string().default(""),
  recentTweets: z.array(z.string()).max(20).default([]),
  triggeringComment: z.string().optional(),
  threadTopic: z.string().optional(),
  accountAgeDays: z.number().optional(),
  followersCount: z.number().optional(),
  followingCount: z.number().optional(),
  hasDefaultAvatar: z.boolean().optional(),
  avatarUrl: z.string().optional(),
});
type Signals = z.infer<typeof Signals>;

const Verdict = z.object({
  label: z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).min(1).max(6),
});
type Verdict = z.infer<typeof Verdict>;

const SYSTEM = `You classify X (Twitter) accounts ONLY for spam / porn-advertising-bot abuse.
- Judge ONLY commercial spam and pornographic-advertising bot behavior; NEVER viewpoints/politics/identity.
- Weight account age heavily: brand-new (<30d) + default avatar + near-zero followers + promo/escort/link wording => almost certainly a bot (may be high-confidence even without an explicit lewd post).
- An OLD established account (age>730d, real followers) leans legit unless blatant.
- If threadTopic is given and the reply is off-topic AND promotional/sexual/link-spam, that mismatch is a strong spam signal.
- LINKLESS REDIRECT BAIT (very common, do NOT rate this "uncertain"): a short
  reply that is sexual innuendo or solicitation ("她好涩", "我不行了", "约",
  "看主页", "主页能打", "sao货", "线下") PLUS an @mention redirecting to
  another account, often padded with garbled filler chars (a[ pz l' ~t !+ qw),
  and unrelated to the thread topic, is a porn/spam amplifier bot even with NO
  link and NO platform name → label porn_bot or spam, confidence >= 0.8.
  Repetition of the same template or same @target across replies corroborates.
- When genuinely unsure prefer "uncertain" over a false accusation — but the
  linkless-redirect-bait pattern above is NOT "unsure", it is spam.
Return ONLY JSON: {"label":"spam|porn_bot|likely_spam|uncertain|legit","confidence":<0..1>,"reasons":[1-6 short strings]}`;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const sigHash = (s: Signals) =>
  hash(
    JSON.stringify([
      s.handle,
      s.displayName,
      s.bio,
      s.recentTweets,
      s.hasDefaultAvatar ?? 0,
      s.accountAgeDays ?? -1,
    ]),
  );

function userPrompt(s: Signals): string {
  const meta = [
    s.accountAgeDays !== undefined ? `accountAgeDays=${s.accountAgeDays}` : "",
    s.followersCount !== undefined ? `followers=${s.followersCount}` : "",
    s.hasDefaultAvatar !== undefined ? `hasDefaultAvatar=${s.hasDefaultAvatar}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `handle: @${s.handle}
displayName: ${s.displayName || "(empty)"}
bio: ${s.bio || "(empty)"}
${meta ? `signals: ${meta}\n` : ""}threadTopic: ${s.threadTopic ?? "(none)"}
triggeringComment: ${s.triggeringComment ?? "(none)"}
recentTweets:
${s.recentTweets.map((t, i) => `  ${i + 1}. ${t}`).join("\n") || "  (none)"}`;
}

async function classify(env: Env, s: Signals): Promise<Verdict> {
  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.LLM_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(s) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  const txt = j.choices[0]?.message?.content ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON from model");
  return Verdict.parse(JSON.parse(m[0]));
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.get("/v1/health", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) n FROM accounts WHERE status='human_confirmed'",
  ).first<{ n: number }>();
  return c.json({ ok: true, published: r?.n ?? 0 });
});

// Public membership check — only human_confirmed (the public list).
app.get("/v1/check", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!ids.length) return c.json({ hits: {} });
  const ph = ids.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, verdict_label, confidence FROM accounts
     WHERE status='human_confirmed' AND x_user_id IN (${ph})`,
  )
    .bind(...ids)
    .all<{ x_user_id: string; verdict_label: string; confidence: number }>();
  const hits: Record<string, { label: string; confidence: number }> = {};
  for (const r of rows.results ?? [])
    hits[r.x_user_id] = { label: r.verdict_label, confidence: r.confidence };
  return c.json({ hits });
});

app.post("/v1/classify", async (c) => {
  // Cost endpoint — GitHub identity required (when enforcement is on).
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  const s = Signals.parse(await c.req.json());
  const h = sigHash(s);
  const uid = s.userId ?? null;
  const prev = await c.env.DB.prepare(
    "SELECT verdict_label, confidence, reasons, model, signals_hash, status FROM accounts WHERE (x_user_id IS ? OR x_user_id=?) AND handle=?",
  )
    .bind(uid, uid, s.handle)
    .first<{
      verdict_label: string;
      confidence: number;
      reasons: string;
      model: string;
      signals_hash: string;
      status: string;
    }>();
  if (prev && prev.signals_hash === h) {
    return c.json({
      cached: true,
      record: {
        verdict: {
          label: prev.verdict_label,
          confidence: prev.confidence,
          reasons: JSON.parse(prev.reasons || "[]"),
        },
        status: prev.status,
      },
    });
  }
  const verdict = await classify(c.env, s);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO accounts (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,model,status,source,signals_hash,first_seen,last_scored)
     VALUES (?,?,?,?,?,?,?,?, 'auto_pending_review','auto_scan', ?, ?, ?)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       verdict_label=excluded.verdict_label, confidence=excluded.confidence, reasons=excluded.reasons,
       model=excluded.model, signals_hash=excluded.signals_hash, last_scored=excluded.last_scored,
       avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url)`,
  )
    .bind(
      uid,
      s.handle,
      s.displayName,
      s.avatarUrl ?? null,
      verdict.label,
      verdict.confidence,
      JSON.stringify(verdict.reasons),
      c.env.LLM_MODEL,
      h,
      now,
      now,
    )
    .run();
  return c.json({ cached: false, record: { verdict, status: "auto_pending_review" } });
});

/**
 * A user block/report is a SIGNAL, not a verdict. Auto-publish only when
 * AI is high-confidence spam AND ≥3 *distinct GitHub reporters* corroborate
 * (the human signal — governance red line intact). Otherwise it queues for
 * admin review.
 */
async function submitReport(c: Ctx, source: string) {
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  const s = Signals.parse(await c.req.json());
  const uid = s.userId ?? null;
  const now = Date.now();

  // one report per (target, reporter)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reports (id,x_user_id,handle,reporter_fp,evidence,status,created_at)
     VALUES (?,?,?,?,?, 'pending', ?)`,
  )
    .bind(crypto.randomUUID(), uid, s.handle, who, JSON.stringify(s).slice(0, 4000), now)
    .run();

  const cnt = await c.env.DB.prepare(
    "SELECT count(DISTINCT reporter_fp) n FROM reports WHERE handle=? AND (x_user_id IS ? OR x_user_id=?)",
  )
    .bind(s.handle, uid, uid)
    .first<{ n: number }>();
  const reporters = cnt?.n ?? 1;

  // reuse a recent AI verdict if present, else classify now
  const prev = await c.env.DB.prepare(
    "SELECT verdict_label, confidence FROM accounts WHERE handle=? AND (x_user_id IS ? OR x_user_id=?)",
  )
    .bind(s.handle, uid, uid)
    .first<{ verdict_label: string; confidence: number }>();
  let vLabel: string;
  let vConf: number;
  if (prev) {
    vLabel = prev.verdict_label;
    vConf = prev.confidence;
  } else {
    const cl = await classify(c.env, s);
    vLabel = cl.label;
    vConf = cl.confidence;
  }

  const aiSpam = (vLabel === "spam" || vLabel === "porn_bot") && vConf >= AUTO_CONF;
  const auto = aiSpam && reporters >= AUTO_REPORTERS;
  const status = auto ? "human_confirmed" : "auto_pending_review";

  await c.env.DB.prepare(
    `INSERT INTO accounts (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,status,source,first_seen,last_scored,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET status=?, source=excluded.source, published_at=?,
       avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url)`,
  )
    .bind(
      uid,
      s.handle,
      s.displayName,
      s.avatarUrl ?? null,
      vLabel,
      vConf,
      '["reported"]',
      status,
      source,
      now,
      now,
      auto ? now : null,
      status,
      auto ? now : null,
    )
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      uid,
      s.handle,
      auto ? "auto_confirm" : "report_queued",
      who,
      `${source} r=${reporters}`,
      now,
    )
    .run();
  return c.json({ ok: true, status, reporters, auto });
}
app.post("/v1/confirm", (c) => submitReport(c, "block"));
app.post("/v1/report", (c) => submitReport(c, "report"));

// ---- Admin (守门员) ----
function admin(c: Ctx): boolean {
  const t = c.env.ADMIN_TOKEN;
  return !!t && c.req.raw.headers.get("x-admin-token") === t;
}
app.get("/v1/admin/queue", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url, a.verdict_label, a.confidence,
            a.last_scored,
            (SELECT count(DISTINCT reporter_fp) FROM reports r
              WHERE r.handle=a.handle) reporters
       FROM accounts a WHERE a.status='auto_pending_review'
       ORDER BY a.last_scored DESC LIMIT 200`,
  ).all();
  return c.json({ queue: rows.results ?? [] });
});
app.post("/v1/admin/decide", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const { handle, xUserId, action } = (await c.req.json()) as {
    handle: string;
    xUserId?: string;
    action: "approve" | "reject" | "remove";
  };
  const status =
    action === "approve" ? "human_confirmed" : action === "remove" ? "removed" : "rejected";
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE accounts SET status=?, published_at=? WHERE handle=? AND (x_user_id IS ? OR x_user_id=?)",
  )
    .bind(status, action === "approve" ? now : null, handle, xUserId ?? null, xUserId ?? null)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(xUserId ?? null, handle, action, "admin", "panel", now)
    .run();
  return c.json({ ok: true, status });
});

// Paginated AI/decision audit trail. Keyset pagination on the id PK
// (DESC) — O(limit), no OFFSET scan, cheap on D1 at any size.
app.get("/v1/admin/log", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(100, Number(c.req.query("limit")) || 50);
  const rows = await c.env.DB.prepare(
    `SELECT id, x_user_id, handle, action, actor, note, at
       FROM review_log
       WHERE (?1 IS NULL OR id < ?1)
       ORDER BY id DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all();
  const list = rows.results ?? [];
  return c.json({
    log: list,
    nextCursor: list.length === limit ? (list[list.length - 1] as { id: number }).id : null,
  });
});

app.get("/v1/list/meta", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT count(*) n,
            max(published_at) latest,
            sum(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS week,
            (SELECT count(*) FROM accounts WHERE status='auto_pending_review') AS pending
       FROM accounts WHERE status='human_confirmed'`,
  )
    .bind(Date.now() - 7 * 24 * 3600_000)
    .first<{ n: number; latest: number | null; week: number; pending: number }>();
  c.header("Cache-Control", "public, max-age=30, s-maxage=60");
  return c.json({
    count: r?.n ?? 0,
    week: r?.week ?? 0,
    pending: r?.pending ?? 0,
    generatedAt: r?.latest ?? null,
    version: `d1-${r?.n ?? 0}`,
  });
});

// Public paginated spam list — backs the /list page and any external mirror.
// Returns only human_confirmed (the published set). Keyset-paginates on
// published_at (DESC) — O(limit), no OFFSET. Edge-cached so polling clients
// don't hammer D1; weak ETag lets the page short-circuit when nothing changed.
//
//   GET /v1/list?limit=100               → latest 100
//   GET /v1/list?limit=100&before=<ms>   → 100 strictly older than <ms>
//   GET /v1/list?limit=100&since=<ms>    → up to 100 strictly newer than <ms> (poll)
//
// reporters = count of distinct GitHub reporters per target, joined from
// `reports`. At the data sizes we expect this WITH ... LEFT JOIN is fine;
// if it ever gets hot, denormalize a column.
app.get("/v1/list", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 100));
  const before = Number(c.req.query("before")) || null;
  const since = Number(c.req.query("since")) || null;
  const rows = await c.env.DB.prepare(
    `WITH rep AS (
       SELECT handle, x_user_id, count(DISTINCT reporter_fp) AS n
         FROM reports WHERE reporter_fp IS NOT NULL
        GROUP BY handle, x_user_id
     )
     SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.verdict_label, a.confidence, a.published_at,
            coalesce(rep.n, 0) AS reporters
       FROM accounts a
       LEFT JOIN rep ON rep.handle = a.handle
                    AND ifnull(rep.x_user_id,'') = ifnull(a.x_user_id,'')
      WHERE a.status='human_confirmed'
        AND a.published_at IS NOT NULL
        AND (?1 IS NULL OR a.published_at < ?1)
        AND (?2 IS NULL OR a.published_at > ?2)
      ORDER BY a.published_at DESC
      LIMIT ?3`,
  )
    .bind(before, since, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      verdict_label: string;
      confidence: number;
      published_at: number;
      reporters: number;
    }>();
  const list = rows.results ?? [];
  const nextBefore = list.length === limit ? list[list.length - 1].published_at : null;
  const latestAt = list[0]?.published_at ?? null;
  const etag = `W/"l${latestAt ?? 0}-n${list.length}-b${before ?? 0}-s${since ?? 0}"`;
  c.header("Cache-Control", "public, max-age=10, s-maxage=30");
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.json({ list, nextBefore, latestAt });
});

// CSP for the SSR HTML pages — strict by default, with X's avatar CDN +
// unavatar.io allow-listed for the public board. Inline style/script are
// required because we ship everything in one document; rotate to nonce if
// these pages ever import 3rd-party deps.
const PAGE_CSP =
  "default-src 'self'; " +
  "img-src 'self' data: https://pbs.twimg.com https://*.twimg.com https://unavatar.io; " +
  "style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'none'";

function pageHeaders(c: Ctx, cacheSeconds: number): void {
  c.header("Content-Security-Policy", PAGE_CSP);
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 2}`);
}

// Product landing — dark-glass marketing page, no PII, no external deps.
app.get("/", (c) => {
  pageHeaders(c, 60);
  return c.html(landingHtml());
});

// Public spam board — latest 100 human_confirmed accounts (polls /v1/list).
app.get("/list", (c) => {
  pageHeaders(c, 30);
  return c.html(listHtml());
});

// Standalone admin console (separate from the consumer extension). The
// ADMIN_TOKEN is entered here by the maintainer and kept in localStorage —
// it never ships in the public extension.
app.get("/admin", (c) =>
  c.html(`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>x-spam-sentinel · 审核台</title><style>
:root{color-scheme:dark}*{box-sizing:border-box;margin:0}
body{font:14px system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3;padding:28px 32px;max-width:1000px;margin:0 auto}
h1{font-size:20px}.sub{color:#8b949e;font-size:13px;margin:4px 0 20px}
input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#e6edf3;border-radius:8px;padding:8px 12px;font:13px system-ui;width:340px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:14px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap;vertical-align:middle}
th{color:#8b949e;font-size:12px}.tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.d{color:#ef4444}.w{color:#f59e0b}.btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e6edf3;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;margin-right:6px}
.btn:hover{background:rgba(255,255,255,.12)}.empty{color:#8b949e;padding:40px 0;text-align:center}a{color:#38bdf8}
#tabs button.on{color:#38bdf8;border-color:#38bdf8}
</style></head><body>
<h1>审核台 · 守门员</h1>
<div class="sub">仅维护者使用 · 通过=入公共名单，驳回/移除=不公开。治理见
<a href="https://github.com/onenorthlab/x-spam-sentinel/blob/main/GOVERNANCE.md" target="_blank">GOVERNANCE</a></div>
<p><input id="t" type="password" placeholder="ADMIN_TOKEN"> <button class="btn" onclick="save()">保存并加载</button>
<span id="s" style="color:#8b949e;margin-left:10px"></span></p>
<div id="tabs" style="margin:6px 0 4px">
<button class="btn on" data-v="queue" onclick="tab('queue')">待审队列</button>
<button class="btn" data-v="log" onclick="tab('log')">审计日志</button></div>
<div id="box"></div>
<script>
const E=s=>s.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
let TOK=localStorage.getItem('xss_admin')||'';let VIEW='queue';
document.getElementById('t').value=TOK?'********':'';
function tab(v){VIEW=v;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));load();}
function load(){return VIEW==='log'?loadLog():loadQueue();}
function save(){const v=document.getElementById('t').value;if(v&&v!=='********'){TOK=v;localStorage.setItem('xss_admin',v);}load();}
async function api(p,o){return fetch(p,{...o,headers:{'x-admin-token':TOK,...(o&&o.headers||{})}});}
async function loadQueue(){
 const s=document.getElementById('s');s.textContent='加载中…';
 const r=await api('/v1/admin/queue');
 if(r.status===403){s.textContent='令牌无效';document.getElementById('box').innerHTML='<div class=empty>ADMIN_TOKEN 不正确</div>';return;}
 const {queue}=await r.json();s.textContent='待审 '+queue.length+' 条';
 document.getElementById('box').innerHTML=queue.length?('<table><thead><tr><th>账号</th><th>AI 判定</th><th>上报</th><th></th></tr></thead><tbody>'+
  queue.map(a=>{const cls=a.confidence>=.9&&(a.verdict_label=='spam'||a.verdict_label=='porn_bot')?'d':'w';
  const av=a.avatar_url||('https://unavatar.io/twitter/'+encodeURIComponent(a.handle));
  return '<tr><td><div style="display:flex;align-items:center;gap:10px">'+
  '<img src="'+E(av)+'" referrerpolicy="no-referrer" width="36" height="36" style="border-radius:50%;flex:none;background:#21262d;object-fit:cover">'+
  '<div style="min-width:0"><b>'+E(a.display_name||('@'+a.handle))+'</b><br>'+
  '<a href="https://x.com/'+E(a.handle)+'" target="_blank" rel="noopener" style="color:#38bdf8;font-size:12px">@'+E(a.handle)+'↗</a>'+
  (a.x_user_id&&a.x_user_id!=a.handle?('<span style="color:#8b949e;font-size:12px"> · '+E(a.x_user_id)+'</span>'):'')+
  '</div></div></td>'+
  '<td><span class="tag '+cls+'">'+a.verdict_label+' '+Math.round(a.confidence*100)+'%</span></td>'+
  '<td style="color:#8b949e">'+a.reporters+' 人</td>'+
  '<td><button class=btn onclick="dec(this,\\''+E(a.handle)+'\\',\\''+(a.x_user_id||'')+'\\',\\'approve\\')">通过</button>'+
  '<button class=btn onclick="dec(this,\\''+E(a.handle)+'\\',\\''+(a.x_user_id||'')+'\\',\\'reject\\')">驳回</button>'+
  '<button class=btn onclick="dec(this,\\''+E(a.handle)+'\\',\\''+(a.x_user_id||'')+'\\',\\'remove\\')">移除</button></td></tr>';}).join('')+
  '</tbody></table>'):'<div class=empty>队列为空</div>';
}
async function dec(btn,handle,xUserId,action){btn.textContent='…';
 await api('/v1/admin/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle,xUserId:xUserId||undefined,action})});
 btn.closest('tr').remove();}
async function loadLog(more){
 const s=document.getElementById('s'),box=document.getElementById('box');
 if(!more){box.innerHTML='<table><thead><tr><th>时间</th><th>动作</th><th>角色</th><th>账号</th><th>备注</th></tr></thead><tbody id=lg></tbody></table><div style="text-align:center;padding:14px"><button class=btn id=lm onclick="loadLog(true)">加载更多</button></div>';loadLog.cur=null;}
 s.textContent='加载中…';
 const u='/v1/admin/log?limit=50'+(loadLog.cur?('&before='+loadLog.cur):'');
 const r=await api(u);
 if(r.status===403){s.textContent='令牌无效';box.innerHTML='<div class=empty>ADMIN_TOKEN 不正确</div>';return;}
 const {log,nextCursor}=await r.json();
 const tb=document.getElementById('lg');
 tb.insertAdjacentHTML('beforeend',log.map(e=>'<tr><td style="color:#8b949e">'+new Date(e.at).toLocaleString('zh-CN',{hour12:false})+
  '</td><td><b>'+E(e.action||'')+'</b></td><td style="color:#8b949e">'+E(e.actor||'')+
  '</td><td>'+(e.handle?('<a href="https://x.com/'+E(e.handle)+'" target="_blank" rel="noopener">@'+E(e.handle)+'</a>'):'—')+
  (e.x_user_id&&e.x_user_id!=e.handle?(' <span style="color:#8b949e">'+E(e.x_user_id)+'</span>'):'')+
  '</td><td style="color:#8b949e;white-space:normal;max-width:360px">'+E(e.note||'')+'</td></tr>').join(''));
 loadLog.cur=nextCursor;
 const lm=document.getElementById('lm');if(lm)lm.style.display=nextCursor?'':'none';
 s.textContent='审计日志'+(nextCursor?'（还有更多）':'（已到底）');
 if(!log.length&&!more)tb.innerHTML='<tr><td colspan=5 class=empty>暂无记录</td></tr>';
}
if(TOK)load();
</script></body></html>`),
);

export default app;
