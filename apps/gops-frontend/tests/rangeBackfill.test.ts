import assert from "node:assert/strict";

import { historicalRangeReadRequest, historicalRangeRequestKey, normalizeBackfillStatusPayload, planHistoricalRangeLoad, rangeBackfillWindow, shouldRequestRangeBackfill } from "../../chart-engine/src/backfill";
import { drawChartScene } from "../../chart-engine/src/canvasRenderer";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import {
  minimumBackfillSourceBarsForInterval,
  rangeBackfillBufferMultiplier,
  rangeBackfillBufferMultiplierForInterval
} from "../../chart-engine/src/intervals";
import { normalizeCandleEvent, normalizeCandleSnapshot } from "../../chart-engine/src/marketDataAdapter";
import { chartRuntimeReducer, createInitialChartRuntimeState } from "../../chart-engine/src/runtime";
import { candleKey } from "../../chart-engine/src/candleStore";
import { buildTimeAxisLayout, formatAxisTickLabel, formatCrosshairTimestamp } from "../../chart-engine/src/time";
import { chartDevLogHighlights, createChartDevLogEntry, summarizeChartCoverage } from "../src/diagnostics/chartDevLog";
import { createInitialRuntimeState } from "../src/layout/commands";
import { PANEL_CATALOG_TYPES } from "../src/layout/panelCatalogDrop";
import { panelRegistry } from "../src/layout/panelRegistry";
import { createDefaultLayoutRecords, createPresetLayout } from "../src/layout/seed";
import type { SavedLayoutRecord } from "../src/layout/types";

assert.equal(rangeBackfillBufferMultiplier, 2);
assert.equal(rangeBackfillBufferMultiplierForInterval("1m"), 3);
assert.equal(rangeBackfillBufferMultiplierForInterval("5m"), 3);
assert.equal(rangeBackfillBufferMultiplierForInterval("10m"), 2.5);
assert.equal(rangeBackfillBufferMultiplierForInterval("1D"), 2.5);
assert.equal(rangeBackfillBufferMultiplierForInterval("1W"), 2);
assert.equal(rangeBackfillBufferMultiplierForInterval("1M"), 2);
assert.equal(minimumBackfillSourceBarsForInterval("1m"), 390);
assert.equal(minimumBackfillSourceBarsForInterval("1D"), 250);
assert.equal(panelRegistry.chartDevLog.title, "Chart Dev Log");
assert.deepEqual(panelRegistry.chartDevLog.defaultPlacement, {
  group: "workspace",
  zone: "context",
  col: 4,
  row: 3,
  colSpan: 1,
  rowSpan: 1
});
assert.equal(PANEL_CATALOG_TYPES.includes("chartDevLog"), true);
assert.equal(createPresetLayout("chart").panels.some((panel) => panel.type === "chartDevLog"), true);
assert.equal(
  createDefaultLayoutRecords()
    .find((record) => record.defaultKey === "chart")
    ?.layout.panels.some((panel) => panel.type === "chartDevLog"),
  true
);

const localStorageMemory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageMemory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageMemory.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageMemory.delete(key);
    },
    clear: () => {
      localStorageMemory.clear();
    }
  }
});
const staleChartLayout = createPresetLayout("chart");
const staleChartDefault: SavedLayoutRecord = {
  id: "default-chart",
  name: "차트",
  version: 1,
  savedAt: "2026-06-30T00:00:00.000Z",
  kind: "default",
  defaultKey: "chart",
  layout: {
    ...staleChartLayout,
    panels: staleChartLayout.panels.filter((panel) => panel.type !== "chartDevLog")
  }
};
localStorage.setItem("gops.savedLayouts.v1", JSON.stringify([staleChartDefault]));
const layoutRuntime = createInitialRuntimeState();
assert.equal(layoutRuntime.layout.panels.some((panel) => panel.type === "chartDevLog"), true);
assert.equal(
  layoutRuntime.savedLayouts
    .find((record) => record.defaultKey === "chart")
    ?.layout.panels.some((panel) => panel.type === "chartDevLog"),
  true
);
localStorage.clear();

const devLogEntry = createChartDevLogEntry({
  level: "info",
  category: "backfill",
  message: "Range backfill requested",
  symbol: "AAPL",
  interval: "1m",
  details: { requestKey: "AAPL:1m:before:test" }
});
assert.match(devLogEntry.id, /^chart-dev-log-/);
assert.equal(devLogEntry.category, "backfill");
assert.equal(devLogEntry.details?.requestKey, "AAPL:1m:before:test");

const coverageSummary = summarizeChartCoverage({
  state: "partial",
  reasonCode: "requested_range_incomplete",
  repairStatus: "gapfill_required",
  sourceInterval: "1D",
  returnedCount: 7,
  storedCandleCount: 7,
  expectedRequestedRangeBars: 10,
  availableFrom: "2026-06-22T00:00:00.000Z",
  availableTo: "2026-06-30T00:00:00.000Z",
  renderable: true
});
assert.equal(coverageSummary?.state, "partial");
assert.equal(coverageSummary?.expectedRequestedRangeBars, 10);

const backfillFlowHighlights = chartDevLogHighlights({
  level: "info",
  details: {
    sourceInterval: "1D",
    resultSummary: {
      source: "alpaca",
      rawRowCount: 6,
      materializedRowCount: 6,
      archiveStatus: "archived",
      gapRangeCount: 2,
      fetchRangeCount: 1,
      noDataBefore: "2016-01-04T00:00:00.000Z"
    },
    coverageSummary
  }
});
assert.deepEqual(
  backfillFlowHighlights.map((highlight) => [highlight.label, highlight.value]),
  [
    ["state", "gapfill_required"],
    ["source", "alpaca"],
    ["srcInt", "1D"],
    ["coverage", "partial requested_range_incomplete 7/10"],
    ["CH", "2026-06-22..2026-06-30"],
    ["rows", "6->6"],
    ["ranges", "g2/f1"],
    ["archive", "archived"],
    ["noDataBefore", "2016-01-04"]
  ]
);

const windowRange = rangeBackfillWindow("1m", "2026-06-29T14:00:00.000Z", 60);
assert.deepEqual(windowRange, {
  start: "2026-06-26T17:30:00.000Z",
  end: "2026-06-29T14:00:00.000Z"
});

const openRange = rangeBackfillWindow("5m", "2026-06-30T13:30:00.000Z", 12);
assert.deepEqual(openRange, {
  start: "2026-06-29T17:00:00.000Z",
  end: "2026-06-30T13:30:00.000Z"
});

const postHolidayOpenRange = rangeBackfillWindow("5m", "2026-07-06T13:30:00.000Z", 12);
assert.deepEqual(postHolidayOpenRange, {
  start: "2026-07-02T17:00:00.000Z",
  end: "2026-07-06T13:30:00.000Z"
});

const sourceBudgetRange = rangeBackfillWindow("1m", "2026-06-29T14:00:00.000Z", 60, { minimumSourceBars: 390 });
assert.deepEqual(sourceBudgetRange, {
  start: "2026-06-26T14:00:00.000Z",
  end: "2026-06-29T14:00:00.000Z"
});

const defaultMinuteBackfillRange = rangeBackfillWindow(
  "1m",
  "2026-06-29T20:00:00.000Z",
  390,
  { minimumSourceBars: minimumBackfillSourceBarsForInterval("1m") }
);
assert.deepEqual(defaultMinuteBackfillRange, {
  start: "2026-06-25T13:30:00.000Z",
  end: "2026-06-29T20:00:00.000Z"
});

const compactHistoricalKey = historicalRangeRequestKey({
  symbol: "AAPL",
  interval: "1m",
  before: "2026-06-29T20:00:00.000Z",
  pageLimit: 780,
  backfillRange: defaultMinuteBackfillRange
});
const widerHistoricalKey = historicalRangeRequestKey({
  symbol: "AAPL",
  interval: "1m",
  before: "2026-06-29T20:00:00.000Z",
  pageLimit: 1560,
  backfillRange: rangeBackfillWindow(
    "1m",
    "2026-06-29T20:00:00.000Z",
    780,
    { minimumSourceBars: minimumBackfillSourceBarsForInterval("1m") }
  )
});
assert.notEqual(compactHistoricalKey, widerHistoricalKey);

assert.equal(planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1m",
  candleCount: 780,
  oldestTimestamp: "2026-06-29T20:00:00.000Z",
  rightOffset: 0,
  visibleCount: 390,
  hasMoreBefore: true
}), null);

const lookaheadHistoricalPlan = planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1m",
  candleCount: 390,
  oldestTimestamp: "2026-06-29T20:00:00.000Z",
  rightOffset: 190,
  visibleCount: 90,
  hasMoreBefore: true
});
assert.equal(lookaheadHistoricalPlan?.isNearLoadedOldest, true);
assert.equal(lookaheadHistoricalPlan?.loadedOldestLookaheadCount, 113);
assert.equal(lookaheadHistoricalPlan?.pageLimit, 390);
assert.equal(lookaheadHistoricalPlan?.plannedBackfillRange?.start, "2026-06-29T13:30:00.000Z");

const pannedHistoricalPlan = planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1m",
  candleCount: 780,
  oldestTimestamp: "2026-06-29T20:00:00.000Z",
  rightOffset: 740,
  visibleCount: 390,
  hasMoreBefore: true
});
assert.equal(pannedHistoricalPlan?.isNearLoadedOldest, true);
assert.equal(pannedHistoricalPlan?.bufferMultiplier, 3);
assert.equal(pannedHistoricalPlan?.pageLimit, 1170);
assert.equal(pannedHistoricalPlan?.plannedBackfillRange?.start, "2026-06-25T13:30:00.000Z");
assert.match(pannedHistoricalPlan?.requestKey ?? "", /limit:1170:window:2026-06-25T13:30:00.000Z/);
assert.deepEqual(historicalRangeReadRequest(pannedHistoricalPlan!), {
  from: "2026-06-25T13:30:00.000Z",
  to: "2026-06-29T20:00:00.000Z",
  limit: 1170
});

assert.deepEqual(historicalRangeReadRequest({
  before: "2026-06-29T20:00:00.000Z",
  pageLimit: 780,
  plannedBackfillRange: null
}), {
  before: "2026-06-29T20:00:00.000Z",
  limit: 780
});

const zoomedHistoricalPlan = planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1m",
  candleCount: 500,
  oldestTimestamp: "2026-06-29T20:00:00.000Z",
  rightOffset: 0,
  visibleCount: 900,
  hasMoreBefore: true
});
assert.equal(zoomedHistoricalPlan?.isLookingPastLoadedRange, true);
assert.equal(zoomedHistoricalPlan?.pageLimit, 3100);

const weeklyDefaultNeedsOlderRange = planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1W",
  candleCount: 149,
  oldestTimestamp: "2026-06-29T00:00:00.000Z",
  rightOffset: 0,
  visibleCount: 260,
  hasMoreBefore: true,
  noDataBefore: "2020-07-06T00:00:00.000Z"
});
assert.equal(weeklyDefaultNeedsOlderRange?.isLookingPastLoadedRange, true);
assert.equal(weeklyDefaultNeedsOlderRange?.userZoomedPastDefault, false);
assert.equal(weeklyDefaultNeedsOlderRange?.pageLimit, 631);
assert.equal(weeklyDefaultNeedsOlderRange?.plannedBackfillRange?.start, "2020-07-06T00:00:00.000Z");

const monthlyDefaultNeedsOlderRange = planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1M",
  candleCount: 34,
  oldestTimestamp: "2023-09-01T00:00:00.000Z",
  rightOffset: 0,
  visibleCount: 120,
  hasMoreBefore: true,
  noDataBefore: "2020-07-01T00:00:00.000Z"
});
assert.equal(monthlyDefaultNeedsOlderRange?.isLookingPastLoadedRange, true);
assert.equal(monthlyDefaultNeedsOlderRange?.userZoomedPastDefault, false);
assert.equal(monthlyDefaultNeedsOlderRange?.pageLimit, 326);
assert.equal(monthlyDefaultNeedsOlderRange?.plannedBackfillRange?.start, "2020-07-01T00:00:00.000Z");

assert.equal(planHistoricalRangeLoad({
  symbol: "AAPL",
  interval: "1M",
  candleCount: 72,
  oldestTimestamp: "2020-07-01T00:00:00.000Z",
  rightOffset: 20,
  visibleCount: 120,
  hasMoreBefore: true,
  noDataBefore: "2020-07-01T00:00:00.000Z"
}), null);

const dailySourceBudgetRange = rangeBackfillWindow("1D", "2026-06-30T00:00:00.000Z", 10, { minimumSourceBars: 50 });
assert.deepEqual(dailySourceBudgetRange, {
  start: "2026-04-21T00:00:00.000Z",
  end: "2026-06-30T00:00:00.000Z"
});

const backfillStatus = normalizeBackfillStatusPayload({
  status: "succeeded",
  interval: "1W",
  sourceInterval: "1D",
  result: {
    source: "alpaca",
    materializedRowCount: 120,
    archiveStatus: "archived"
  }
});
assert.equal(backfillStatus.interval, "1W");
assert.equal(backfillStatus.sourceInterval, "1D");
assert.equal(backfillStatus.result?.materializedRowCount, 120);

const tradeBasedLiveEvent = normalizeCandleEvent({
  type: "LIVE_CANDLE_UPDATE",
  symbol: "AAPL",
  interval: "1m",
  sourceInterval: "trades",
  source: "alpaca.trades",
  data: {
    timestamp: "2026-06-30T21:08:00.000Z",
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 100,
    isClosed: false
  }
});

assert.equal(tradeBasedLiveEvent.sourceInterval, "1m");

const snapshot = normalizeCandleSnapshot({
  symbol: "AAPL",
  interval: "1m",
  source: "clickhouse",
  feed: "sip",
  dataStatus: "ready",
  repairStatus: "none",
  canBackfill: true,
  sourceInterval: "1m",
  requestedRange: { before: "2026-06-29T14:00:00.000Z" },
  hasMoreBefore: true,
  coverage: {
    state: "complete",
    reasonCode: "requested_range_renderable",
    repairStatus: "none",
    sourceInterval: "1m",
    renderable: true,
    expectedRequestedRangeBars: 1
  },
  candles: [
    {
      timestamp: "2026-06-29T13:59:00.000Z",
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 100,
      isClosed: true
    }
  ],
  indicators: { ma: [5, 20, 60], volume: true }
});

assert.equal(snapshot.repairStatus, "none");
assert.equal(snapshot.requestedRange?.before, "2026-06-29T14:00:00.000Z");
assert.equal(snapshot.coverage?.expectedRequestedRangeBars, 1);
assert.equal(shouldRequestRangeBackfill(snapshot), false);
for (const field of [`target${"Stored"}Count`, `target${"Range"}From`]) {
  assert.equal(field in snapshot, false);
}

let runtime = createInitialChartRuntimeState();
runtime = chartRuntimeReducer(runtime, { kind: "chart.snapshot.loaded", snapshot });

const emptyOlderRange = normalizeCandleSnapshot({
  symbol: "AAPL",
  interval: "1m",
  source: "clickhouse",
  feed: "sip",
  dataStatus: "empty",
  repairStatus: "gapfill_required",
  canBackfill: true,
  requestedRange: {
    before: "2026-06-29T13:59:00.000Z"
  },
  noDataBefore: "2026-06-29T13:59:00.000Z",
  hasMoreBefore: false,
  candles: [],
  indicators: { ma: [5, 20, 60], volume: true }
});

runtime = chartRuntimeReducer(runtime, { kind: "chart.snapshot.loaded", snapshot: emptyOlderRange });

const key = candleKey("AAPL", "1m");
assert.equal(runtime.candlesByKey[key]?.length, 1);
assert.equal(runtime.dataStatusByKey[key]?.state, "ready");
assert.equal(runtime.dataStatusByKey[key]?.hasMoreBefore, false);
assert.equal(runtime.dataStatusByKey[key]?.noDataBefore, "2026-06-29T13:59:00.000Z");
assert.equal(shouldRequestRangeBackfill(emptyOlderRange), false);

const emptyFromToRangeAtBoundary = normalizeCandleSnapshot({
  symbol: "AAPL",
  interval: "1D",
  source: "clickhouse",
  feed: "sip",
  dataStatus: "empty",
  repairStatus: "gapfill_required",
  canBackfill: true,
  requestedRange: {
    from: "2015-12-01T00:00:00.000Z",
    to: "2016-01-04T00:00:00.000Z"
  },
  noDataBefore: "2016-01-04T00:00:00.000Z",
  hasMoreBefore: false,
  candles: [],
  indicators: { ma: [5, 20, 60], volume: true }
});

assert.equal(shouldRequestRangeBackfill(emptyFromToRangeAtBoundary), false);

const emptyOlderRangeWithoutBoundary = normalizeCandleSnapshot({
  symbol: "AAPL",
  interval: "1m",
  source: "clickhouse",
  feed: "sip",
  dataStatus: "empty",
  repairStatus: "gapfill_required",
  canBackfill: true,
  requestedRange: {
    before: "2026-06-29T13:59:00.000Z"
  },
  candles: [],
  indicators: { ma: [5, 20, 60], volume: true }
});

assert.equal(shouldRequestRangeBackfill(emptyOlderRangeWithoutBoundary), true);

let runtimeWithoutBoundary = createInitialChartRuntimeState();
runtimeWithoutBoundary = chartRuntimeReducer(runtimeWithoutBoundary, { kind: "chart.snapshot.loaded", snapshot });
runtimeWithoutBoundary = chartRuntimeReducer(runtimeWithoutBoundary, {
  kind: "chart.snapshot.loaded",
  snapshot: emptyOlderRangeWithoutBoundary
});

assert.equal(runtimeWithoutBoundary.candlesByKey[key]?.length, 1);
assert.equal(runtimeWithoutBoundary.dataStatusByKey[key]?.state, "ready");
assert.equal(runtimeWithoutBoundary.dataStatusByKey[key]?.hasMoreBefore, true);

const partialSparseRange = normalizeCandleSnapshot({
  symbol: "AAPL",
  interval: "1m",
  source: "clickhouse",
  feed: "sip",
  dataStatus: "partial",
  repairStatus: "gapfill_required",
  canBackfill: true,
  requestedRange: {
    before: "2026-06-29T13:59:00.000Z"
  },
  coverage: {
    state: "partial",
    reasonCode: "returned_window_sparse",
    repairStatus: "gapfill_required",
    sourceInterval: "1m",
    renderable: false,
    returnedCount: 1,
    storedCandleCount: 1,
    minimumReturnedCount: 20,
    minimumRenderableSourceBars: 30,
    renderabilityReasonCode: "returned_window_sparse"
  },
  candles: [
    {
      timestamp: "2026-06-29T13:30:00.000Z",
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 100,
      isClosed: true
    }
  ],
  indicators: { ma: [5, 20, 60], volume: true }
});

assert.equal(shouldRequestRangeBackfill(partialSparseRange), true);

assert.equal(formatCrosshairTimestamp("2026-06-29T00:00:00.000Z", "1D"), "Jun 29, 2026");
assert.equal(formatCrosshairTimestamp("2026-06-29T00:00:00.000Z", "1W"), "Week of Jun 29, 2026");
assert.equal(formatCrosshairTimestamp("2026-06-01T00:00:00.000Z", "1M"), "Jun 2026");
assert.equal(formatCrosshairTimestamp("2026-06-29T13:30:00.000Z", "1m"), "Jun 29 09:30");

assert.equal(formatAxisTickLabel("2026-06-29T13:30:00.000Z", "1m"), "09:30");
assert.equal(formatAxisTickLabel("2026-06-29T13:35:00.000Z", "5m"), "09:35");
assert.equal(formatAxisTickLabel("2026-06-29T13:40:00.000Z", "10m"), "09:40");
assert.equal(formatAxisTickLabel("2026-06-29T00:00:00.000Z", "1D"), "Jun 29");
assert.equal(formatAxisTickLabel("2026-06-29T00:00:00.000Z", "1W"), "Jun 29");
assert.equal(formatAxisTickLabel("2026-06-01T00:00:00.000Z", "1M"), "Jun 2026");
assert.equal(formatCrosshairTimestamp("2026-01-02T00:00:00.000Z", "1D"), "Jan 2, 2026");
assert.equal(formatAxisTickLabel("2026-01-02T00:00:00.000Z", "1D"), "Jan 2");
assert.equal(formatAxisTickLabel("2026-01-01T00:00:00.000Z", "1M"), "Jan 2026");

const intradayDayBoundaryCandles = [
  {
    timestamp: "2026-06-29T19:59:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-06-30T13:30:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
];

for (const interval of ["1m", "5m", "10m"] as const) {
  const axis = buildTimeAxisLayout(intradayDayBoundaryCandles, interval, 600);
  assert.equal(axis.boundaries.length, 1);
  assert.equal(axis.boundaries[0].kind, "day");
  assert.equal(axis.boundaries[0].label, "Jun 30");
  assert.equal(axis.labels.some((label) => label.visibleIndex === axis.boundaries[0].visibleIndex && label.label === "Jun 30"), true);
}

const dailySameWeekAxis = buildTimeAxisLayout([
  {
    timestamp: "2026-06-29T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-06-30T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
], "1D", 80);
assert.equal(dailySameWeekAxis.boundaries.length, 0);

const dailyWeekAxis = buildTimeAxisLayout([
  {
    timestamp: "2026-06-26T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-06-29T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
], "1D", 80);
assert.equal(dailyWeekAxis.boundaries[0].kind, "week");
assert.equal(dailyWeekAxis.boundaries[0].label, "Jun 29");
assert.equal(dailyWeekAxis.labels.some((label) => label.visibleIndex === dailyWeekAxis.boundaries[0].visibleIndex && label.label === "Jun 29"), true);

const weeklyAxis = buildTimeAxisLayout([
  {
    timestamp: "2026-06-29T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-07-06T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
], "1W", 90);
assert.equal(weeklyAxis.boundaries[0].kind, "month");
assert.equal(weeklyAxis.boundaries[0].label, "Jul 2026");
assert.equal(weeklyAxis.labels.some((label) => label.visibleIndex === weeklyAxis.boundaries[0].visibleIndex && label.label === "Jul 2026"), true);

const monthlyAxis = buildTimeAxisLayout([
  {
    timestamp: "2025-12-01T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-01-01T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
], "1M", 100);
assert.equal(monthlyAxis.boundaries[0].kind, "year");
assert.equal(monthlyAxis.boundaries[0].label, "2026");
assert.equal(monthlyAxis.labels.some((label) => label.visibleIndex === monthlyAxis.boundaries[0].visibleIndex && label.label === "2026"), true);

const denseMonthlyCandles = Array.from({ length: 72 }, (_, index) => {
  const year = 2020 + Math.floor((index + 6) / 12);
  const month = ((index + 6) % 12) + 1;
  return {
    timestamp: `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  };
});
const denseMonthlyAxis = buildTimeAxisLayout(denseMonthlyCandles, "1M", 360);
assert.deepEqual(denseMonthlyAxis.boundaries.map((boundary) => boundary.label), ["2021", "2022", "2023", "2024", "2025", "2026"]);

const denseDailyAxis = buildTimeAxisLayout([
  {
    timestamp: "2026-06-26T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  },
  {
    timestamp: "2026-06-29T00:00:00.000Z",
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    isClosed: true
  }
], "1D", 10);
assert.equal(denseDailyAxis.boundaries[0].kind, "week");
assert.deepEqual(denseDailyAxis.labels.map((label) => label.label), ["Jun 29"]);

const boundaryCanvas = createCanvasRecorder();
const boundaryDocument = createChartDocument("boundary-test", "AAPL", "1m");
drawChartScene(boundaryCanvas.canvas, {
  state: "ready",
  width: 280,
  height: 220,
  document: boundaryDocument,
  candles: intradayDayBoundaryCandles,
  allCandles: intradayDayBoundaryCandles,
  visibleStartIndex: 0,
  visibleEndIndex: intradayDayBoundaryCandles.length,
  variant: "standard",
  plot: {
    left: 40,
    top: 20,
    right: 240,
    priceBottom: 130,
    volumeTop: 146,
    bottom: 180
  },
  scales: {
    minPrice: 0,
    maxPrice: 2,
    maxVolume: 1,
    minPercent: -1,
    maxPercent: 1,
    candleWidth: 8,
    gap: 2
  },
  comparisonSeries: [],
  labels: {
    symbol: "AAPL",
    timeframe: "1m"
  }
});
const dateBoundaryStroke = boundaryCanvas.strokes.find((stroke) =>
  stroke.path.length === 2 &&
  stroke.path[0]?.x === 190.5 &&
  stroke.path[1]?.x === 190.5 &&
  stroke.path[0]?.y === 20.5 &&
  stroke.path[1]?.y === 180.5
);
assert.ok(dateBoundaryStroke);
assert.deepEqual(dateBoundaryStroke.dash, []);
assert.equal(dateBoundaryStroke.lineWidth, 1);
assert.equal(dateBoundaryStroke.strokeStyle, "rgba(100, 116, 139, 0.28)");

function createCanvasRecorder() {
  type StrokeRecord = {
    path: Array<{ x: number; y: number }>;
    dash: number[];
    lineWidth: number;
    strokeStyle: unknown;
  };
  const strokes: StrokeRecord[] = [];
  const context = {
    lineWidth: 1,
    strokeStyle: "#000",
    fillStyle: "#000",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    path: [] as Array<{ x: number; y: number }>,
    dash: [] as number[],
    stack: [] as Array<{ lineWidth: number; strokeStyle: unknown; fillStyle: unknown; dash: number[]; globalAlpha: number }>,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    measureText(value: string) {
      return { width: value.length * 7 };
    },
    save() {
      this.stack.push({
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
        fillStyle: this.fillStyle,
        dash: [...this.dash],
        globalAlpha: this.globalAlpha
      });
    },
    restore() {
      const previous = this.stack.pop();
      if (!previous) {
        return;
      }
      this.lineWidth = previous.lineWidth;
      this.strokeStyle = previous.strokeStyle;
      this.fillStyle = previous.fillStyle;
      this.dash = [...previous.dash];
      this.globalAlpha = previous.globalAlpha;
    },
    beginPath() {
      this.path = [];
    },
    moveTo(x: number, y: number) {
      this.path.push({ x, y });
    },
    lineTo(x: number, y: number) {
      this.path.push({ x, y });
    },
    arc() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {
      strokes.push({
        path: [...this.path],
        dash: [...this.dash],
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle
      });
    },
    setLineDash(value: number[]) {
      this.dash = [...value];
    }
  };
  return {
    strokes,
    canvas: {
      width: 0,
      height: 0,
      style: {},
      getContext: () => context
    } as unknown as HTMLCanvasElement
  };
}
