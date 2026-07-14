# GOPS Shared Chart Contract

This directory owns stable chart-command contracts and the Czardas pack schema shared by
backend validation, PostgreSQL delivery, chart-engine execution, and frontend rendering.

`chart-czardas-pack.schema.json` defines the Czardas v4 wire shape and Field schema 4. The
authoritative relational validator is
`gops_agents.czardas_assets.contract.validate_czardas_pack`; schema-valid JSON alone is not
sufficient to enter or leave storage. Both save and delivery validate identity, exact-240
coverage, timestamps, selection counts, mode/Basis/episode closure, PatternTrace anchors,
managed drawing provenance, and the 80/96 KiB limits.

One deterministic pack is stored per `(symbol, interval)`. It carries 240 current-snapshot
candle meanings, H-Line and Trend boundaries, plural Pattern relations, Field projection,
explanations, and editable managed drawings. It does not transport historical engine states.
Pattern drawings are relation-owned polylines; boundary drawings are candidate-owned lines.

The full Czardas contracts are:

- [`docs/czardas/ENGINE_SPEC.md`](../../docs/czardas/ENGINE_SPEC.md)
- [`docs/czardas/VERIFICATION.md`](../../docs/czardas/VERIFICATION.md)

Chart data storage and transport semantics are defined by
[`docs/CHART_DATA_ARCHITECTURE.md`](../../docs/CHART_DATA_ARCHITECTURE.md). This directory covers
wire and command shape; frontend code still reads market data through API/WebSocket only.

Current chart-command mirrors:

```text
apps/chart-engine/src/types.ts
apps/chart-engine/src/capabilities.ts
systems/api-server/pods/api-server/gops-backend/app/contracts/chart.py
```

Rules:

- LLM agents return `ChartProposal`; they do not mutate `ChartDocument` directly.
- UI and agents use the same `ChartCommand` vocabulary.
- Command payloads are JSON-serializable and invalid commands do not change chart state.
- Canonical intervals are `1m`, `5m`, `10m`, `1h`, `4h`, `1D`, `1W`, `1M`.
- Frontend readiness uses both `dataStatus` and detailed coverage.
- One accepted proposal becomes one undo/redo unit.
- Drawing proposals are preview-first and applied drawings remain editable.
- Drawing anchors and `sourceInterval` use canonical chart intervals.
- `parallelLineCount` is 2 through 10 and `fillOpacity` is 0 through 1.
- `riskRewardBox` uses `[entry, stop, target]`; stop and target remain on opposite sides of entry.
- `fibonacciRetracement` uses two swing anchors and fixed levels
  `0, 0.236, 0.382, 0.5, 0.618, 0.786, 1`.
- LLM chart proposals cannot create Czardas-managed provenance or polyline drawings.

Update every mirror and validator in the same change when these contracts change.
