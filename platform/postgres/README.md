# Postgres Platform Contract

PostgreSQL owns transactional latest-state projections. Canonical market time
series remain in ClickHouse.

```text
docker-compose postgres
systems/order/jobs/migrations
systems/agent-orchestration/jobs/czardas-asset-migrations
```

## Czardas Assets

Czardas is the only active automatic drawing subsystem. PostgreSQL owns its
latest projection and queue:

```text
chart_assets.czardas_latest
chart_assets.czardas_build_jobs
chart_assets.czardas_build_items
```

`czardas_latest` stores one deterministic `CzardasPackContent` per explicit
`(symbol, interval)` pair. `generated_at` stays in the row/API envelope, not in
the pack. The v2 all-candle Field and pack are limited to 80/96 KiB. Czardas IDs use `cza-` and
workers use a lease plus same-pair advisory lock.

There is no `assetKind`, ClickHouse asset write, Redis job-status path, Kafka
asset topic, or cross-engine fallback. The Czardas migration runner applies
only `004_czardas_assets.sql`.

EKS uses `infra/k8s/base/job-czardas-asset-migrations.yaml` and
`scripts/aws/run-czardas-asset-migrations-job.sh`; runtime never creates the
schema. Canonical OHLCV and exact repair materialization remain in ClickHouse.
Local Compose includes `czardas-asset-migrations` as an unprofiled one-shot
dependency, and `czardas-asset-builder` starts only after it completes
successfully. The runner still applies only `004_czardas_assets.sql`.
The authenticated development delete route removes one explicit Czardas pair
and is not a retention policy.

Existing `chart_assets.geometry_*` tables may remain only as dormant historical
data. Current migrations, runtime, API and operations must not read, write,
recreate or use them as fallback. Dropping them requires a separate explicit
operator migration.

AWS/EKS can point `DATABASE_*` or `DATABASE_URL` at the in-cluster database or
RDS. Never commit real passwords or connection strings.
