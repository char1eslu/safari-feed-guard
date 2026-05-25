-- D1 curation store. Source of truth; published artifact derives from this.
-- Governance: AI verdict never auto-public; status flips to human_confirmed
-- only on a user block/report (the human-confirm signal).

CREATE TABLE IF NOT EXISTS accounts (
  x_user_id     TEXT,                       -- numeric id (immutable key); NULL if handle-only
  handle        TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  verdict_label TEXT NOT NULL,              -- spam|porn_bot|likely_spam|uncertain|legit
  confidence    REAL NOT NULL,
  reasons       TEXT,                       -- json array
  model         TEXT,
  status        TEXT NOT NULL DEFAULT 'auto_pending_review',
                                            -- auto_pending_review | human_confirmed | rejected
                                            -- | removed | auto_legit | whitelisted
  source        TEXT NOT NULL DEFAULT 'auto_scan', -- auto_scan|report|import|admin_whitelist
  signals_hash  TEXT,
  first_seen    INTEGER NOT NULL,
  last_scored   INTEGER NOT NULL,
  published_at  INTEGER,
  PRIMARY KEY (x_user_id, handle)
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_uid ON accounts(x_user_id);

CREATE TABLE IF NOT EXISTS reports (
  id                  TEXT PRIMARY KEY,     -- uuid
  x_user_id           TEXT,
  handle              TEXT,
  reporter_fp         TEXT,                 -- salted hash, anti-abuse, NO PII
  reporter_age_days   INTEGER,              -- GH account age at report time;
                                            -- NULL = legacy (treated as eligible)
  evidence            TEXT,                 -- json
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          INTEGER NOT NULL
);

-- one report per (target, reporter) — makes INSERT OR IGNORE dedupe
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique
  ON reports(handle, x_user_id, reporter_fp);
-- Partial index for the auto-promote eligibility query.
CREATE INDEX IF NOT EXISTS idx_reports_eligible
  ON reports(handle, x_user_id)
  WHERE reporter_age_days IS NULL OR reporter_age_days >= 90;

CREATE TABLE IF NOT EXISTS review_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id  TEXT,
  handle     TEXT,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,                 -- system|user|human
  note       TEXT,
  at         INTEGER NOT NULL
);
