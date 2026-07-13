# GOPS Shared Chart Contract

Shared chart-command and Czardas pack contracts for frontend runtime and
backend/agent code. `chart-czardas-pack.schema.json` mirrors the final v2 wire
shape. The authoritative relational validator is
`gops_agents.czardas_assets.contract.validate_czardas_pack`; both PostgreSQL
save and API delivery use that same validator, so schema-valid JSON alone is
not sufficient to enter or leave storage. Czardas stores one deterministic pack per
`(symbol, interval)` and the frontend compiles its H-Line, Trend, Triangle
relation, explanation, and Field without a Geometry compatibility adapter.
The v2 pack is one present-view interpretation of the completed exact-240
snapshot. It includes 240 compact candle meanings and revision-free
`inferenceId`/derivation provenance; it does not transport historical engine
states or reconstruct what Czardas would have decided at an earlier prefix.
Its 21 raw-factor and normalized-factor columns use the v2-locked scale 1000
and are exact 480-byte big-endian `int16` blobs. Its per-candle reason bitset is one exact 960-byte big-endian
`uint32` blob. The Python validator additionally enforces identity, timestamp,
selected-mode, Basis/episode, drawing, provenance closure, and the 80/96 KiB limits that JSON Schema
cannot express reliably.

Chart data storage and transport semantics are defined by
`docs/CHART_DATA_ARCHITECTURE.md`. This contract covers UI/chart command shape;
it must not reintroduce preset-universe preload, fake candle rendering, or direct
frontend access to Redis, S3, or ClickHouse.

Current mirrors:

```text
apps/chart-engine/src/types.ts
apps/chart-engine/src/capabilities.ts
systems/api-server/pods/api-server/gops-backend/app/contracts/chart.py
```

Rules:

- LLM agents return `ChartProposal`; they do not mutate `ChartDocument` directly.
- UI and agents use the same `ChartCommand` vocabulary.
- Command payloads must be JSON-serializable.
- Invalid commands must not change chart state.
- Canonical intervals are `1m`, `5m`, `10m`, `1h`, `4h`, `1D`, `1W`, `1M`.
- Candle readiness uses both `dataStatus` and detailed `coverage`.
- Backfill success does not mean a chart is renderable unless stored candle coverage is sufficient.
- Chart data layers are consumed independently: `candles`, `trades`, `quotes`,
  and `events`. Indicator layers such as moving averages and VWAP are calculated
  from candle/trade/quote data by the chart engine or explicit downstream code,
  not by a separate preload-only API.
- Frontend requests use API/WebSocket only. It must not connect directly to
  Redis, S3, or ClickHouse.
- One accepted proposal should become one undo/redo unit.
- Drawing proposals are preview-first; applying a preview turns it into an editable drawing.
- Drawing `anchor.interval` and `sourceInterval` use canonical chart intervals.
- `parallelLineCount` is an integer from 2 through 10, and drawing `fillOpacity`
  is a number from 0 through 1.
- `riskRewardBox` uses exactly three canonical anchors in `[entry, stop, target]`
  order. Target time is normalized to Stop time; Stop and Target must remain on
  opposite sides of Entry.
- `fibonacciRetracement` uses exactly two canonical swing anchors and fixed v1
  levels `0, 0.236, 0.382, 0.5, 0.618, 0.786, 1`.

Update every mirror in the same change when this contract changes.
