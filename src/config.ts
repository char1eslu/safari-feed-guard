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

const Env = z.object({
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
});

type EnvShape = z.infer<typeof Env>;

let cached: EnvShape | null = null;
function load(): EnvShape {
  if (cached) return cached;
  loadDotEnv();
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ") || "all";
    throw new Error(`Missing LLM config (${fields}). Copy .env.example to .env and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}

// Lazy proxy — module import is side-effect-free, so unit tests that touch
// pure helpers (signalsHash, etc.) don't blow up under `node --test` in CI
// where no .env exists. The check still fires the first time any
// `config.LLM_*` is read at runtime (LLM call sites).
export const config: EnvShape = new Proxy({} as EnvShape, {
  get(_t, k) {
    return load()[k as keyof EnvShape];
  },
});
