-- Backfill last_decided_by / last_decided_at for rows that pre-date the
-- agent pipeline migration. Two-pass strategy to stay under D1's CPU
-- limit on big tables:
--   Pass A: cheap fallback — every BL/WL row without last_decided_by gets
--           'human:admin' (true for the vast majority pre-agent-era) and
--           a sensible timestamp from existing columns.
--   Pass B: per-handle audit lookup, scoped to rows whose review_log
--           actor differs from 'admin'. Falls into a small subset that
--           D1 can chew in one batch.
--
-- Run Pass A first; Pass B is a separate file because we only want to
-- run it after watching Pass A succeed.

-- Pass A — flat fill, no JOINs in the subquery.
UPDATE accounts
SET last_decided_by = 'human:admin',
    last_decided_at = COALESCE(published_at, last_scored)
WHERE last_decided_by IS NULL
  AND status IN ('human_confirmed', 'whitelisted');
