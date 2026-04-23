-- =================================================================
-- Track which Cloudflare Workflow instance powers each ingestion_run
-- so the API can terminate it on demand (Cancel button).
-- =================================================================

ALTER TABLE ingestion_run ADD COLUMN workflow_instance_id TEXT;

CREATE INDEX idx_run_instance ON ingestion_run(workflow_instance_id);
