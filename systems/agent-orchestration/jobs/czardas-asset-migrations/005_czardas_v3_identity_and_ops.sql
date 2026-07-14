ALTER TABLE chart_assets.czardas_latest
    ADD COLUMN IF NOT EXISTS input_contract_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS inference_config_digest TEXT NULL,
    ADD COLUMN IF NOT EXISTS sight_projection_id TEXT NULL;

CREATE INDEX IF NOT EXISTS czardas_build_jobs_active_pair_idx
    ON chart_assets.czardas_build_jobs (symbol, "interval", force_build, requested_by, submitted_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS czardas_build_jobs_owner_status_idx
    ON chart_assets.czardas_build_jobs (requested_by, status, submitted_at DESC);
