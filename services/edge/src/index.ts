import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

interface Env {
  DB: D1Database;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  LLM_API_KEY: string;
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
  hash(JSON.stringify([s.handle, s.displayName, s.bio, s.recentTweets, s.hasDefaultAvatar ?? 0, s.accountAgeDays ?? -1]));

function userPrompt(s: Signals): string {
  const meta = [
    s.accountAgeDays !== undefined ? `accountAgeDays=${s.accountAgeDays}` : "",
    s.followersCount !== undefined ? `followers=${s.followersCount}` : "",
    s.hasDefaultAvatar !== undefined ? `hasDefaultAvatar=${s.hasDefaultAvatar}` : "",
  ].filter(Boolean).join(" ");
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
  const ids = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return c.json({ hits: {} });
  const ph = ids.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, verdict_label, confidence FROM accounts
     WHERE status='human_confirmed' AND x_user_id IN (${ph})`,
  ).bind(...ids).all<{ x_user_id: string; verdict_label: string; confidence: number }>();
  const hits: Record<string, { label: string; confidence: number }> = {};
  for (const r of rows.results ?? []) hits[r.x_user_id] = { label: r.verdict_label, confidence: r.confidence };
  return c.json({ hits });
});

app.post("/v1/classify", async (c) => {
  const s = Signals.parse(await c.req.json());
  const h = sigHash(s);
  const uid = s.userId ?? null;
  const prev = await c.env.DB.prepare(
    "SELECT verdict_label, confidence, reasons, model, signals_hash, status FROM accounts WHERE (x_user_id IS ? OR x_user_id=?) AND handle=?",
  ).bind(uid, uid, s.handle).first<{
    verdict_label: string; confidence: number; reasons: string; model: string; signals_hash: string; status: string;
  }>();
  if (prev && prev.signals_hash === h) {
    return c.json({
      cached: true,
      record: { verdict: { label: prev.verdict_label, confidence: prev.confidence, reasons: JSON.parse(prev.reasons || "[]") }, status: prev.status },
    });
  }
  const verdict = await classify(c.env, s);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO accounts (x_user_id,handle,display_name,verdict_label,confidence,reasons,model,status,source,signals_hash,first_seen,last_scored)
     VALUES (?,?,?,?,?,?,?, 'auto_pending_review','auto_scan', ?, ?, ?)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       verdict_label=excluded.verdict_label, confidence=excluded.confidence, reasons=excluded.reasons,
       model=excluded.model, signals_hash=excluded.signals_hash, last_scored=excluded.last_scored`,
  ).bind(uid, s.handle, s.displayName, verdict.label, verdict.confidence, JSON.stringify(verdict.reasons), c.env.LLM_MODEL, h, now, now).run();
  return c.json({ cached: false, record: { verdict, status: "auto_pending_review" } });
});

// User block/report = the human-confirm signal → eligible for the public list.
async function confirm(c: { env: Env; req: { json: () => Promise<unknown> } }, source: string) {
  const s = Signals.parse(await c.req.json());
  const uid = s.userId ?? null;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO accounts (x_user_id,handle,display_name,verdict_label,confidence,reasons,status,source,first_seen,last_scored,published_at)
     VALUES (?,?,?, 'spam', 0.99, '["user-confirmed"]', 'human_confirmed', ?, ?, ?, ?)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET status='human_confirmed', published_at=?, source=excluded.source`,
  ).bind(uid, s.handle, s.displayName, source, now, now, now, now).run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  ).bind(uid, s.handle, "confirm_spam", "user", source, now).run();
}
app.post("/v1/confirm", async (c) => { await confirm(c, "block"); return c.json({ ok: true }); });
app.post("/v1/report", async (c) => { await confirm(c, "report"); return c.json({ ok: true }); });

app.get("/v1/list/meta", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) n, max(published_at) latest FROM accounts WHERE status='human_confirmed'",
  ).first<{ n: number; latest: number }>();
  return c.json({ count: r?.n ?? 0, generatedAt: r?.latest ?? null, version: `d1-${r?.n ?? 0}` });
});

export default app;
