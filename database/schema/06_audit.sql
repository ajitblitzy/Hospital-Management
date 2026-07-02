-- 06_audit.sql
-- Append-only, RANGE-partitioned (monthly by created_at) audit trail. Run after 00_extensions.sql.
-- NOTE: audit_log is append-only and intentionally has NO updated_at column and NO updated_at
-- trigger (it is never updated). It also intentionally has NO FK on user_id so audit records
-- survive deletion of the referenced user.

CREATE TABLE audit_log (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid,
  action      text NOT NULL,
  entity_type text,
  entity_id   uuid,
  ip_address  inet,
  user_agent  text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Initial monthly partitions. Subsequent months are added by ops/migrations
-- (e.g., a scheduled job creating audit_log_YYYY_MM ahead of time).
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');

CREATE TABLE audit_log_2026_02 PARTITION OF audit_log
  FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
