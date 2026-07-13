# ClickHouse Platform Contract

ClickHouse is the confirmed historical serving store for chart data.
Redis keeps only latest 120 candles and live state; S3 final/manifest is
durable recovery evidence.

## Current Chart Tables

```text
market_data.chart_candles
market_data.trade_ticks
market_data.quote_ticks
market_data.market_events
market_data.market_status_events
market_data.order_flow_profile_daily
market_data.backfill_jobs
market_data.storage_object_audit
market_data.load_audit
```

`trade_ticks` and `quote_ticks` retain 21 days and keep the newest 100,000
non-replicated insert-deduplication tokens per table. The tick loader derives a
token from Kafka topic/partition/offset metadata, commits only offsets included
in a successful insert, and keeps a bounded recent `sourceEventId` cache for
short replays that cross insert batch boundaries. `chart_candles` and
`order_flow_profile_daily` have no deletion TTL. Initialized environments may
still contain the legacy no-TTL `chart_analysis_assets` table. It is dormant:
runtime, migrations, APIs and operators must not read, write, recreate or use it
as fallback. Fresh environments do not create it; dropping existing data
requires a separate explicit operator migration. Existing
environments apply the tick TTL and deduplication window through the
operator-reviewed, idempotent migration:

```text
scripts/local/migrate-chart-tick-retention.sql
```

`chart_candles.bucket_policy` separates incompatible intraday bucket identities.
Legacy/native clock rows use `clock_aligned`; new US-equity derived rows use
`us_equity_regular_session`. Readers select only the latter for
`5m/10m/1h/4h`. The source `1m` and session-derived rows are both persisted, so
chart serving, Czardas, and SMA share the same OHLCV facts.

Fresh `chart_candles` tables include `canonical_version` and
`price_adjustment` in the `ReplacingMergeTree` sorting key. Runtime schema
ensure and rebuild scripts never issue `MODIFY ORDER BY` against a populated
table. Existing AWS tables must be audited with `SHOW CREATE TABLE`; upgrading
their key requires a separately reviewed table-copy migration, not a rollout
side effect. Until that migration, canonical repair uses a dedicated
`*-canonical-split-repair` feed profile so split/v2 rows remain physically
distinct under the legacy key. Existing rows and dormant Geometry tables are
not altered.

Czardas uses the dedicated `canonical_completed_rows()` read boundary. Its SQL
always filters `canonical_version=v2`, `price_adjustment=split`,
`market_session=regular`, `is_closed=1`, and the compatible bucket policy,
independent of permissive serving flags. A manual Czardas build audits the exact
latest 240 expected keys; bounded Alpaca repair writes only real missing rows and
the builder re-reads ClickHouse before inference. Weekly input is derived from
at most 1,300 canonical daily rows. Czardas pack/job state is PostgreSQL-only.

The operator migration and one-year rebuild entrypoint is:

```bash
APPLY=true WAIT_FOR_JOB=false scripts/aws/run-session-candle-rebuild-job.sh
```

The script adds the bucket-policy column idempotently before starting the rebuild
Job. It does not rewrite the sorting key or delete legacy rows; readers exclude
them by policy and a future table-copy migration requires separate approval.

Optional indicators and candle volume profile are calculated by the API and
cached in Redis; ClickHouse does not store request-hash artifacts. The retired
tick-volume-profile and derived-artifact tables are not created in fresh
environments. Existing tables are not dropped automatically.

`market_data.order_flow_profile_daily` is the daily bid/ask order-flow table.
DDL is maintained in both local and EKS init paths:

```text
infra/clickhouse/initdb/01-market-data.sql
infra/k8s/base/platform/clickhouse-initdb/01-market-data.sql
```

`scripts/local/check-chart-data-contracts.py` enforces normalized equality of
the two market-data DDL copies. Environment headers and the declared local-only
agent table are the only allowed difference.

## Dormant Chart Analysis Asset Table

Czardas reads canonical completed candles from `market_data.chart_candles` and
persists pack/job state only in PostgreSQL `chart_assets.czardas_*`. Existing
`market_data.chart_analysis_assets` rows are historical dormant data, not an
active, mirrored, or rollback source. The init DDL intentionally omits the
table. Do not add readers, writers or automatic creation back.

## SEC Fundamentals Tables

Financial Agent runtime reads the normalized SEC serving projection below. The
runtime must not call SEC APIs on user requests.

DDL is maintained in both local and EKS init paths:

```text
infra/clickhouse/initdb/02-sec-fundamentals.sql
infra/k8s/base/platform/clickhouse-initdb/02-sec-fundamentals.sql
```

```text
market_data.sec_company_tickers
market_data.sec_filing_events
market_data.sec_raw_artifacts
market_data.sec_financial_facts
market_data.sec_derived_metrics
market_data.sec_frames
market_data.sec_collection_runs
```

`market_data.sec_company_tickers` stores ticker/CIK mapping and
`is_active_universe_member`. S&P 500 membership comes from
`systems/market-data/config/sp500-universe.json`; when a company leaves the
universe, existing facts and metrics remain and only membership is updated.

`market_data.sec_financial_facts` stores normalized source facts.
`market_data.sec_derived_metrics` stores deterministic metrics such as margins,
YoY growth, liabilities ratios, total debt ratios, current ratio, FCF, and
interest coverage. `market_data.sec_frames` stores SEC frame rows as originally
reported, so frame values may differ from later corrected companyfacts rows.

Recommended engine for fact/metric projections is a replacing table keyed by
symbol, metric/concept, unit, fiscal period, period end, accession or synthetic
source hash, with `version_filed_at` as the revision version.

## Excluded From The Chart Contract

```text
market_data.market_quotes
```

Quote layer payloads are persisted to `market_data.quote_ticks`. Raw S3 backup
objects must not be loaded into ClickHouse by the normal chart path.
