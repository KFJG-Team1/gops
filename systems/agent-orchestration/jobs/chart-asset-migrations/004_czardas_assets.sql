CREATE SCHEMA IF NOT EXISTS chart_assets;

CREATE TABLE IF NOT EXISTS chart_assets.czardas_latest (
    symbol TEXT NOT NULL,
    "interval" TEXT NOT NULL CHECK ("interval" IN ('1m', '5m', '10m', '1h', '4h', '1D', '1W')),
    last_candle_key TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    algorithm_version TEXT NOT NULL,
    config_version TEXT NOT NULL,
    time_contract_version TEXT NOT NULL,
    calendar_version TEXT NOT NULL,
    input_digest TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    drawing_count SMALLINT NOT NULL CHECK (drawing_count BETWEEN 0 AND 7),
    field_bytes INTEGER NOT NULL CHECK (field_bytes BETWEEN 0 AND 32768),
    payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 0 AND 65536),
    pack JSONB NOT NULL CHECK (NOT (pack ? 'generatedAt')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, "interval")
);

CREATE TABLE IF NOT EXISTS chart_assets.czardas_build_jobs (
    job_id TEXT PRIMARY KEY CHECK (job_id LIKE 'cza-%'),
    requested_by TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    "interval" TEXT NOT NULL CHECK ("interval" IN ('1m', '5m', '10m', '1h', '4h', '1D', '1W')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'canceled')),
    force_build BOOLEAN NOT NULL DEFAULT false,
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    repair JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT NULL,
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chart_assets.czardas_build_items (
    job_id TEXT PRIMARY KEY REFERENCES chart_assets.czardas_build_jobs(job_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    "interval" TEXT NOT NULL CHECK ("interval" IN ('1m', '5m', '10m', '1h', '4h', '1D', '1W')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'saved', 'unchanged', 'failed', 'skipped')),
    stage TEXT NOT NULL DEFAULT 'queued',
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
    worker_id TEXT NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    error TEXT NULL,
    reason TEXT NULL,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    created_entities SMALLINT NOT NULL DEFAULT 0 CHECK (created_entities BETWEEN 0 AND 7),
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, symbol, "interval")
);

CREATE INDEX IF NOT EXISTS czardas_build_items_claim_idx
    ON chart_assets.czardas_build_items (status, lease_expires_at, symbol, "interval")
    WHERE status IN ('pending', 'running');
