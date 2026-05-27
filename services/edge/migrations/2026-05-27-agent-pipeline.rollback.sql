-- Rollback of 2026-05-27-agent-pipeline.sql
-- D1/SQLite has no native DROP COLUMN before 3.35; we leave the columns in
-- place (they're nullable, no consumer reads them once the agent endpoints
-- are removed). Drop the indexes that are cheap to recreate.

DROP INDEX IF EXISTS idx_accounts_last_decided_by;
DROP INDEX IF EXISTS idx_accounts_agent_id;
DROP INDEX IF EXISTS idx_accounts_agent_at;

-- To fully clear agent annotations from the surviving rows:
-- UPDATE accounts SET agent_id=NULL, agent_label=NULL, agent_confidence=NULL,
--                     agent_reasons=NULL, agent_signals=NULL, agent_evidence=NULL,
--                     agent_action=NULL, agent_model=NULL, agent_at=NULL,
--                     agent_signals_hash=NULL, agent_attempts=0, agent_error=NULL,
--                     last_decided_by=NULL, last_decided_at=NULL
--   WHERE agent_id IS NOT NULL;
--
-- And revert any agent-tier statuses back to auto_pending_review:
-- UPDATE accounts SET status='auto_pending_review'
--   WHERE status IN ('agent_blacklist','agent_whitelist','agent_pending');
