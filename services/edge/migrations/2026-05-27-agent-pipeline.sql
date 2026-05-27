-- Side-channel agent pipeline.
--
-- Adds the data plane for off-platform agents (Hermes on mac mini being the
-- first one) to observe the admin queue, persist a structured verdict, and
-- transition items into agent-curated staging buckets — without ever writing
-- the public-list status (human_confirmed) on their own. The governance red
-- line "AI alone never auto-publishes" is preserved: agent decisions land in
-- the agent_* statuses below, and only humans (or the existing AI≥0.9 +
-- ≥3 GitHub reporters rule) can flip those to human_confirmed/whitelisted.
--
-- This migration only ADDS columns and is forward-compatible: the existing
-- /v1/classify / /v1/admin/queue / /v1/admin/decide paths keep working
-- without any awareness of agents.

-- 1) Agent annotation columns (one row per account; latest write wins).
ALTER TABLE accounts ADD COLUMN agent_id          TEXT;
ALTER TABLE accounts ADD COLUMN agent_label       TEXT;
ALTER TABLE accounts ADD COLUMN agent_confidence  REAL;
ALTER TABLE accounts ADD COLUMN agent_reasons     TEXT;   -- json array
ALTER TABLE accounts ADD COLUMN agent_signals     TEXT;   -- json array of fired-signal codes
ALTER TABLE accounts ADD COLUMN agent_evidence    TEXT;   -- json object (account_age_days, follower_count, ...)
ALTER TABLE accounts ADD COLUMN agent_action      TEXT;   -- approve_block | reject_legit | needs_human
ALTER TABLE accounts ADD COLUMN agent_model       TEXT;
ALTER TABLE accounts ADD COLUMN agent_at          INTEGER;
ALTER TABLE accounts ADD COLUMN agent_signals_hash TEXT;  -- snapshot of accounts.signals_hash when scored
ALTER TABLE accounts ADD COLUMN agent_attempts    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN agent_error       TEXT;

-- 2) Denormalized "who flipped this account last" for cheap filtering.
--    Values: NULL | 'human:<actor>' | 'agent:<agent_id>' | 'rule:<id>'
ALTER TABLE accounts ADD COLUMN last_decided_by   TEXT;
ALTER TABLE accounts ADD COLUMN last_decided_at   INTEGER;

CREATE INDEX IF NOT EXISTS idx_accounts_last_decided_by ON accounts(last_decided_by);
CREATE INDEX IF NOT EXISTS idx_accounts_agent_id        ON accounts(agent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_agent_at        ON accounts(agent_at);

-- 3) Status enum is TEXT (no CHECK constraint), so the three new agent-tier
--    statuses simply become valid values:
--      agent_blacklist  — agent confidently said spam; staged, NOT public
--      agent_whitelist  — agent confidently said legit; staged, NOT real WL
--      agent_pending    — agent saw it but abstained ("待定"); high-priority for human
--
--    The public list (status='human_confirmed') and the official whitelist
--    (status='whitelisted') remain reachable ONLY via human action or the
--    existing AI+reporters governance rule. The agent decision endpoint
--    enforces this with a hard refusal.
