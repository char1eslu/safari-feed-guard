# Deploy the Cloudflare edge service

Code is ready. Deploying needs **your Cloudflare auth** (I can't log in for
you). One-time setup, then I run the rest.

## 1. Authenticate (you)

Option A — interactive (run in this session with the `!` prefix):

    ! cd ~/one-north/x-spam-sentinel/services/edge && npx wrangler login

Option B — API token (Workers + D1 edit). Create at
dash.cloudflare.com → My Profile → API Tokens, then:

    export CLOUDFLARE_API_TOKEN=...   # in the shell I use

## 2. Provision (I can run once authed)

    npm install
    npx wrangler d1 create xss-db          # paste database_id into wrangler.toml
    npm run db:init:remote                  # apply schema.sql to remote D1
    npx wrangler secret put LLM_API_KEY     # paste the LLM key (not committed)

## 3. Deploy

    npm run deploy
    # → https://x-spam-sentinel-edge.<your-subdomain>.workers.dev

## 4. Point the extension at it

Set the edge base URL in the extension config (replaces localhost:8787).
`/v1/health` should return `{ ok: true }`.

## Endpoints

`GET /v1/health` · `GET /v1/check?ids=` (public, human_confirmed only) ·
`POST /v1/classify` · `POST /v1/confirm` · `POST /v1/report` ·
`GET /v1/list/meta`

## Governance

D1 is the source of truth. `POST /v1/classify` only ever writes
`auto_pending_review` — an AI verdict is never public. `/v1/check` returns
**only** `human_confirmed` rows. A row becomes `human_confirmed` solely via
`/v1/confirm` or `/v1/report` (user block/report = the human-confirm signal).
No PII beyond the public numeric id.
