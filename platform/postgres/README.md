# Postgres Platform Contract

PostgreSQL owns transactional latest-state projections. Canonical market time
series remain in ClickHouse.

```text
docker-compose postgres
systems/order/jobs/migrations
systems/agent-orchestration/jobs/chart-asset-migrations
```

## Chart Geometry Assets

The active Geometry subsystem uses PostgreSQL only for asset and build state.

```text
chart_assets.geometry_assets
chart_assets.geometry_build_jobs
chart_assets.geometry_build_items
```

`geometry_assets` stores exactly one latest JSONB projection per
`(symbol, interval)`. It stores no canonical candle, rejected-candidate ledger,
prompt, or provider response. `geometry_build_jobs` and
`geometry_build_items` own queue, status, progress, logs, attempts, and leases;
workers claim items with `FOR UPDATE SKIP LOCKED`.

There is no active `CHART_ASSET_STORAGE_MODE`, ClickHouse dual-write, parity
sync, or Redis job-status path. The runtime storage factory always selects
PostgreSQL. Older `001_create_chart_assets.sql` and
`002_expand_chart_asset_intervals.sql` files describe the retired
`analysis_assets` rollout; the current migration runner applies
`003_geometry_assets.sql`.

EKS uses `infra/k8s/base/job-chart-asset-migrations.yaml` and
`scripts/aws/run-chart-asset-migrations-job.sh`; runtime never creates the
schema. Canonical OHLCV and exact repair materialization remain in ClickHouse.
The authenticated development delete route removes explicit Geometry pairs
from PostgreSQL and is not a retention policy.

AWS/EKS can point `DATABASE_*` or `DATABASE_URL` at the in-cluster database or
RDS. Never commit real passwords or connection strings.
