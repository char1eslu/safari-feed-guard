import { config } from "./config.ts";
import { type AccountSignals, Verdict } from "./schema.ts";

const SYSTEM_PROMPT = `You classify X (Twitter) accounts ONLY for spam / porn-advertising-bot abuse.
You are part of a public-good anti-spam project. Scope is strict:

- Judge ONLY commercial spam and pornographic-advertising bot behavior.
- NEVER judge viewpoints, politics, opinions, language, or who someone is.
- Weight ACCOUNT AGE heavily. A brand-new account (accountAgeDays < 30) that
  also has a default avatar, near-zero followers, and promotional / escort /
  link-spam wording in name/bio/tweets is almost certainly a bot — you may
  return spam/porn_bot at high confidence even without an explicit lewd post.
- Conversely an OLD established account (accountAgeDays > 730, real followers)
  should lean legit unless the spam evidence is blatant and current.
- If a threadTopic is given and the reply is unrelated/off-topic AND
  promotional (links, contact handles, escort/sexual solicitation), that
  topic mismatch is itself a strong spam signal.
- LINKLESS REDIRECT BAIT (very common — do NOT rate "uncertain"): a short
  reply that is sexual innuendo/solicitation ("她好涩","我不行了","约","看主页",
  "主页能打","sao货","线下") PLUS an @mention redirecting to another account,
  often padded with garbled filler chars (a[ pz l' ~t !+ qw), unrelated to the
  thread topic, is a porn/spam amplifier bot even with NO link / NO platform
  name → porn_bot or spam, confidence >= 0.8. Same template or same @target
  repeated across replies corroborates.
- A thin profile ALONE (on an older account) is NOT enough — prefer uncertain.
- When genuinely unsure, prefer "uncertain" over a false accusation. Public
  false positives are harmful. (The linkless-redirect-bait pattern is NOT
  "unsure" — it is spam.)

Return ONLY a JSON object, no prose, no markdown fences:
{"label": "spam"|"porn_bot"|"likely_spam"|"uncertain"|"legit",
 "confidence": <number 0..1>,
 "reasons": [<1-6 short concrete evidence-grounded strings>]}`;

function buildUserPrompt(s: AccountSignals): string {
  const tweets =
    s.recentTweets.length > 0
      ? s.recentTweets.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
      : "  (none provided)";
  const meta = [
    s.accountAgeDays !== undefined ? `accountAgeDays=${s.accountAgeDays}` : null,
    s.followersCount !== undefined ? `followers=${s.followersCount}` : null,
    s.followingCount !== undefined ? `following=${s.followingCount}` : null,
    s.hasDefaultAvatar !== undefined ? `hasDefaultAvatar=${s.hasDefaultAvatar}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `Account under review (userId=${s.userId}):
handle: @${s.handle}
displayName: ${s.displayName || "(empty)"}
bio: ${s.bio || "(empty)"}
${meta ? `signals: ${meta}\n` : ""}threadTopic: ${s.threadTopic ?? "(none)"}
triggeringComment: ${s.triggeringComment ?? "(none)"}
recentTweets:
${tweets}

Classify per the rules.`;
}

/** Strip ```json fences / leading prose and pull the first JSON object. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no JSON object in model output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function chat(messages: { role: string; content: string }[]): Promise<ChatResponse> {
  const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.LLM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      temperature: 0,
      max_tokens: 600,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as ChatResponse;
}

export interface ClassifyResult {
  verdict: Verdict;
  usage: ChatResponse["usage"];
}

/** One classification call, with a single self-correcting retry on bad JSON. */
export async function classifyWithLlm(signals: AccountSignals): Promise<ClassifyResult> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(signals) },
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await chat(messages);
    const content = resp.choices[0]?.message?.content ?? "";
    try {
      const verdict = Verdict.parse(extractJson(content));
      return { verdict, usage: resp.usage };
    } catch (err) {
      lastErr = err;
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content:
            "That was not valid. Reply with ONLY the JSON object in the exact required shape.",
        },
      );
    }
  }
  throw new Error(`LLM did not return a valid verdict: ${String(lastErr)}`);
}
