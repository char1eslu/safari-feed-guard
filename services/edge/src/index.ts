import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { adminHtml } from "./pages/admin";
import { landingHtml } from "./pages/landing";
import { listHtml } from "./pages/list";

interface Env {
  DB: D1Database;
  // LLM provider config — ALL three are Worker secrets (NOT in wrangler.toml).
  // The provider URL + model name are treated as sensitive (so the project can
  // be open-sourced without doxxing the inference dependency); the API key
  // obviously also is.
  //   wrangler secret put LLM_API_BASE   (OpenAI-compatible /chat/completions)
  //   wrangler secret put LLM_API_MODEL  (model id)
  //   wrangler secret put LLM_API_KEY    (bearer token)
  LLM_API_BASE: string;
  LLM_API_MODEL: string;
  LLM_API_KEY: string;
  // "1" => enforce GitHub auth on classify/report/confirm. Default off so
  // deploying T6 doesn't break the still-anonymous shipped extension; flip
  // on once the extension's GitHub login ships.
  REQUIRE_AUTH?: string;
  ADMIN_TOKEN?: string; // bearer for the admin moderation endpoints
  // Wave 12b — fine-grained GitHub PAT scoped to Contents:Write on the
  // upstream repo, used by the scheduled handler to mirror the curated
  // whitelist / blacklist to data/*.json. Unset = mirror is disabled and
  // the cron is a no-op (the public /v1/whitelist endpoint still works).
  WHITELIST_SYNC_TOKEN?: string;
  WHITELIST_SYNC_REPO?: string; // "owner/repo", defaults to foru17/make-x-great-again
}

type Ctx = Context<{ Bindings: Env }>;

const AUTO_CONF = 0.9; // AI confidence floor for auto-publish
const AUTO_REPORTERS = 3; // distinct GitHub reporters required for auto-publish
// LUO-35 Wave 12a: GH accounts younger than this don't count toward the
// auto-publish reporter threshold. Their reports are still stored (audit /
// future re-evaluation), but a fresh throwaway account can't help flip
// status to human_confirmed. 90d is a common drive-by abuse cutoff.
const REPORTER_MIN_AGE_DAYS = 90;

interface Reporter {
  /** Stable id, namespaced. `gh:<numeric>` for GitHub, `anon` when enforcement off. */
  id: string;
  /** GH account age in days at the moment of this request. 0 for anon. */
  ageDays: number;
}

/** Verify a GitHub token → reporter id + account age.
 *  null = invalid identity (token rejected by GitHub). */
async function ghIdentity(req: Request): Promise<Reporter | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tok) return null;
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tok}`,
        "user-agent": "mxga",
        accept: "application/vnd.github+json",
      },
    });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: number; created_at?: string };
    if (!u.id) return null;
    const ageDays = u.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86_400_000))
      : 0;
    return { id: `gh:${u.id}`, ageDays };
  } catch {
    return null;
  }
}

/** Enforce identity only when REQUIRE_AUTH is on. Returns reporter id (or
 *  "anon" when enforcement is off and no token). null => reject. */
async function requireReporter(c: Ctx): Promise<Reporter | null> {
  const ident = await ghIdentity(c.req.raw);
  if (ident) return ident;
  return c.env.REQUIRE_AUTH === "1" ? null : { id: "anon", ageDays: 0 };
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
  const res = await fetch(`${env.LLM_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.LLM_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_API_MODEL,
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
  // LUO-35 Wave 12a: hard short-circuit for admin-curated whitelist —
  // skip the LLM AND ignore signals_hash drift. Whitelist beats heuristics.
  if (prev && prev.status === "whitelisted") {
    return c.json({
      cached: true,
      record: {
        verdict: { label: "legit", confidence: 1, reasons: ["whitelisted"] },
        status: "whitelisted",
      },
    });
  }
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
  // LUO-32 Wave 11 L2: high-confidence legit verdicts are cached but kept
  // out of the maintainer queue. /admin/queue still only selects
  // status='auto_pending_review', so auto_legit rows are invisible there
  // but the next /v1/classify hit still gets a free cache return.
  const writeStatus =
    verdict.label === "legit" && verdict.confidence >= 0.85 ? "auto_legit" : "auto_pending_review";
  await c.env.DB.prepare(
    `INSERT INTO accounts (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,model,status,source,signals_hash,first_seen,last_scored)
     VALUES (?,?,?,?,?,?,?,?, ?,'auto_scan', ?, ?, ?)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       verdict_label=excluded.verdict_label, confidence=excluded.confidence, reasons=excluded.reasons,
       model=excluded.model, signals_hash=excluded.signals_hash, last_scored=excluded.last_scored,
       avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url),
       status=CASE
                WHEN accounts.status IN ('human_confirmed','rejected','removed','whitelisted')
                  THEN accounts.status
                ELSE excluded.status
              END`,
  )
    .bind(
      uid,
      s.handle,
      s.displayName,
      s.avatarUrl ?? null,
      verdict.label,
      verdict.confidence,
      JSON.stringify(verdict.reasons),
      c.env.LLM_API_MODEL,
      writeStatus,
      h,
      now,
      now,
    )
    .run();
  return c.json({ cached: false, record: { verdict, status: writeStatus } });
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

  // Whitelist short-circuit — if maintainer has explicitly whitelisted the
  // target, ignore the report entirely (don't even store it). Avoids letting
  // a coordinated brigade pollute the audit trail against a trusted account.
  const cur = await c.env.DB.prepare(
    "SELECT status FROM accounts WHERE handle=? AND (x_user_id IS ? OR x_user_id=?)",
  )
    .bind(s.handle, uid, uid)
    .first<{ status: string }>();
  if (cur?.status === "whitelisted") {
    return c.json({ ok: true, status: "whitelisted", reporters: 0, auto: false });
  }

  // one report per (target, reporter); always store, even for "young" GH
  // accounts — they just don't count toward AUTO_REPORTERS.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reports
       (id,x_user_id,handle,reporter_fp,reporter_age_days,evidence,status,created_at)
     VALUES (?,?,?,?,?,?, 'pending', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      uid,
      s.handle,
      who.id,
      who.ageDays,
      JSON.stringify(s).slice(0, 4000),
      now,
    )
    .run();

  // Reporter count for auto-publish: only GH accounts older than
  // REPORTER_MIN_AGE_DAYS count. NULL age = legacy rows (pre-Wave-12) — treat
  // as eligible so existing maintainer history is preserved.
  const cnt = await c.env.DB.prepare(
    `SELECT count(DISTINCT reporter_fp) n FROM reports
       WHERE handle=? AND (x_user_id IS ? OR x_user_id=?)
         AND (reporter_age_days IS NULL OR reporter_age_days >= ?)`,
  )
    .bind(s.handle, uid, uid, REPORTER_MIN_AGE_DAYS)
    .first<{ n: number }>();
  const reporters = cnt?.n ?? (who.ageDays >= REPORTER_MIN_AGE_DAYS ? 1 : 0);

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
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       status=CASE
                WHEN accounts.status IN ('whitelisted','removed','rejected') THEN accounts.status
                ELSE excluded.status
              END,
       source=excluded.source,
       published_at=CASE
                      WHEN accounts.status IN ('whitelisted','removed','rejected') THEN accounts.published_at
                      ELSE excluded.published_at
                    END,
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
    )
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      uid,
      s.handle,
      auto ? "auto_confirm" : "report_queued",
      who.id,
      `${source} r=${reporters} age=${who.ageDays}d`,
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
    action: "approve" | "reject" | "remove" | "whitelist";
  };
  const status =
    action === "approve"
      ? "human_confirmed"
      : action === "remove"
        ? "removed"
        : action === "whitelist"
          ? "whitelisted"
          : "rejected";
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

// ---- Whitelist (LUO-35 Wave 12a) ----
// status='whitelisted' acts as a permanent override:
//   - /v1/classify short-circuits without calling the LLM
//   - /v1/confirm and /v1/report no-op (whitelisted target absorbs noise)
//   - removable via DELETE /v1/admin/whitelist (drops back to 'rejected'
//     so it stays out of the published list but the audit is preserved)
const WhitelistAdd = z.object({
  handle: z.string().min(1).max(64),
  xUserId: z.string().regex(/^\d+$/).optional(),
  displayName: z.string().max(120).default(""),
  avatarUrl: z.string().url().optional(),
  note: z.string().max(200).default(""),
});

app.post("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const body = WhitelistAdd.parse(await c.req.json());
  const uid = body.xUserId ?? null;
  const now = Date.now();
  const reasons = JSON.stringify(["whitelisted by admin", body.note].filter(Boolean));
  // Upsert as whitelisted. If a row already exists (auto_pending_review,
  // auto_legit, rejected, removed, even human_confirmed) the admin's
  // explicit action wins.
  await c.env.DB.prepare(
    `INSERT INTO accounts
       (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,
        status,source,signals_hash,first_seen,last_scored,published_at)
     VALUES (?,?,?,?,'legit',1.0,?, 'whitelisted','admin_whitelist', NULL, ?, ?, NULL)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       status='whitelisted',
       source='admin_whitelist',
       verdict_label='legit',
       confidence=1.0,
       reasons=excluded.reasons,
       published_at=NULL,
       last_scored=excluded.last_scored,
       display_name=COALESCE(excluded.display_name, accounts.display_name),
       avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url)`,
  )
    .bind(uid, body.handle, body.displayName, body.avatarUrl ?? null, reasons, now, now)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(uid, body.handle, "whitelist_add", "admin", body.note || "panel", now)
    .run();
  return c.json({ ok: true, handle: body.handle, status: "whitelisted" });
});

app.delete("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const handle = c.req.query("handle") ?? "";
  const xUserId = c.req.query("xUserId") || null;
  if (!handle) return c.json({ error: "handle_required" }, 400);
  const now = Date.now();
  // Drop back to 'rejected' rather than deleting the row — keeps the audit
  // trail intact and prevents the account from immediately re-entering the
  // public list if it gets re-reported.
  const r = await c.env.DB.prepare(
    `UPDATE accounts SET status='rejected', source='admin_whitelist', last_scored=?
       WHERE handle=? AND (x_user_id IS ? OR x_user_id=?) AND status='whitelisted'`,
  )
    .bind(now, handle, xUserId, xUserId)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(xUserId, handle, "whitelist_remove", "admin", "panel", now)
    .run();
  return c.json({ ok: true, changed: r.meta.changes ?? 0 });
});

app.get("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, display_name, avatar_url, reasons, last_scored
       FROM accounts
      WHERE status='whitelisted'
        AND (?1 IS NULL OR last_scored < ?1)
      ORDER BY last_scored DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      reasons: string;
      last_scored: number;
    }>();
  const list = rows.results ?? [];
  return c.json({
    list,
    nextBefore: list.length === limit ? list[list.length - 1].last_scored : null,
  });
});

// Maintainer view of the public blacklist (status='human_confirmed'). Like
// /v1/list but admin-scoped (returns more columns + uncacheable) so the
// /admin panel can iterate it for "moved here by mistake" cleanup.
app.get("/v1/admin/blacklist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.verdict_label, a.confidence, a.reasons, a.published_at,
            (SELECT count(DISTINCT r.reporter_fp) FROM reports r
              WHERE r.handle=a.handle
                AND ifnull(r.x_user_id,'')=ifnull(a.x_user_id,'')) reporters
       FROM accounts a
      WHERE a.status='human_confirmed'
        AND (?1 IS NULL OR a.published_at < ?1)
      ORDER BY a.published_at DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      verdict_label: string;
      confidence: number;
      reasons: string;
      published_at: number;
      reporters: number;
    }>();
  const list = rows.results ?? [];
  return c.json({
    list,
    nextBefore: list.length === limit ? list[list.length - 1].published_at : null,
  });
});

// Public read-only mirror for the (future) extension L0a cache. No PII,
// no avatars — just (handle, xUserId, sinceMs). Cached at the edge.
app.get("/v1/whitelist", async (c) => {
  const since = Number(c.req.query("since")) || 0;
  const limit = Math.min(2000, Math.max(1, Number(c.req.query("limit")) || 500));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, last_scored
       FROM accounts WHERE status='whitelisted' AND last_scored > ?
       ORDER BY last_scored ASC LIMIT ?`,
  )
    .bind(since, limit)
    .all<{ x_user_id: string | null; handle: string; last_scored: number }>();
  const list = rows.results ?? [];
  const latestAt = list.length ? list[list.length - 1].last_scored : since;
  c.header("Cache-Control", "public, max-age=300, s-maxage=600");
  return c.json({ list, latestAt, count: list.length });
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
// it never ships in the public extension. Page is noindex,nofollow.
app.get("/admin", (c) => {
  pageHeaders(c, 0);
  c.header("Cache-Control", "no-store");
  return c.html(adminHtml());
});

// Wave 12b — scheduled mirror of the curated whitelist/blacklist into the
// upstream GitHub repo as data/whitelist/v1.json and data/blacklist/v1.json.
// Bypasses needing to keep the extension hammering /v1/* on every install:
// users get a CDN-served JSON they can also audit by reading the repo.
//
// Disabled (no-op) when WHITELIST_SYNC_TOKEN is unset — the rest of the
// system works fine without it; this is purely an availability + audit
// enhancement. Cron trigger in wrangler.toml.
async function mirrorToGitHub(env: Env): Promise<void> {
  const token = env.WHITELIST_SYNC_TOKEN;
  if (!token) return; // PAT not provided yet — mirror disabled.
  const repo = env.WHITELIST_SYNC_REPO ?? "foru17/make-x-great-again";

  async function publish(path: string, data: unknown): Promise<void> {
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    // Need SHA of existing file (if any) for the upsert.
    let sha: string | undefined;
    const head = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "mxga-worker",
        accept: "application/vnd.github+json",
      },
    });
    if (head.ok) {
      const j = (await head.json()) as { sha?: string };
      sha = j.sha;
    }
    const body = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + "\n")));
    const put = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "mxga-worker",
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: `chore(data): sync ${path} from Worker`,
        content: body,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      console.warn(`mirror ${path} failed`, put.status, (await put.text()).slice(0, 200));
    }
  }

  const wl = await env.DB.prepare(
    `SELECT x_user_id, handle, last_scored FROM accounts WHERE status='whitelisted' ORDER BY last_scored DESC LIMIT 5000`,
  ).all<{ x_user_id: string | null; handle: string; last_scored: number }>();
  const bl = await env.DB.prepare(
    `SELECT x_user_id, handle, verdict_label, confidence, published_at
       FROM accounts WHERE status='human_confirmed' AND published_at IS NOT NULL
       ORDER BY published_at DESC LIMIT 10000`,
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    confidence: number;
    published_at: number;
  }>();
  const now = Date.now();
  await publish("data/whitelist/v1.json", {
    generatedAt: now,
    count: wl.results?.length ?? 0,
    list: wl.results ?? [],
  });
  await publish("data/blacklist/v1.json", {
    generatedAt: now,
    count: bl.results?.length ?? 0,
    list: bl.results ?? [],
  });
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      mirrorToGitHub(env).catch((e) => console.warn("mirror error", e)),
    );
  },
};
