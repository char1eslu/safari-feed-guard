# Running locally (T3 classifier spike)

This is the first runnable slice of [T3](https://github.com/onenorthlab/x-spam-sentinel)
— the local LLM classifier + private append-only curation store. The browser
extension采集 (DOM ingestion) and the public list publishing are separate tracks.

## Setup

```bash
cp .env.example .env   # fill in LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
pnpm install
```

`.env` is gitignored — never commit it or paste the key into a PR/issue.

The endpoint is any OpenAI-compatible `/chat/completions` provider.

## Use

```bash
pnpm classify fixtures/sample-porn-bot.json   # -> porn_bot
pnpm classify fixtures/sample-legit.json      # -> legit
pnpm classify fixtures/sample-porn-bot.json   # -> served from cache
pnpm classify <file> --force                  # ignore cache, re-score
```

A signals file is one `AccountSignals` object (see `src/schema.ts`): the X
**numeric userId** (the immutable blocklist key — never the @handle), handle,
displayName, bio, up to ~10 recent tweets, and the triggering comment.

## What it does / does NOT do

- Calls the model with a strict scope: spam / porn-advertising bots only,
  never viewpoints; prefers `uncertain` over a false accusation.
- Stores every verdict in `.curation-db/records.jsonl` (gitignored) as
  **`auto_pending_review`**. Governance red-line: an AI verdict is **never
  auto-public**. A human-review gate (later track) promotes records before
  anything reaches the public sharded list.
- Caches by `userId + signalsHash` so re-runs don't re-bill the model.

## Checks

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Schemas here are provisional — the final data contract is owned by T1 (LUO-16).
