import { readFileSync } from "node:fs";
import { z } from "zod";

/** Minimal .env loader — avoids a dotenv dependency for a spike. */
function loadDotEnv(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // env may come from the real environment instead
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const Env = z.object({
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Missing LLM config. Copy .env.example to .env and fill it in.\n",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const config = parsed.data;
