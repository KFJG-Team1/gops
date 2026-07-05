import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChartAgentAccess } from "../../chart-engine/src/agentAccess";
import { normalizeAgentChatResponse } from "../../chart-engine/src/agentChat";
import { isChartDataRenderable } from "../../chart-engine/src/renderability";
import {
  buildAgentAnalysisRequest,
  buildAgentLayoutContext,
  formatAgentAnalysisReport,
  normalizeAgentAnalysisReport,
  shouldAutoApplyAgentLayoutProposal
} from "../src/agents/agentAnalysis";
import { parsePortfolioHoldingsApiResponse } from "../src/components/portfolioHoldingsApi";
import {
  DEFAULT_AGENT_DRAFT_SEED,
  isAgentChartReferenceAvailable,
  resolveAgentChartReference,
  resolveAgentSendContent
} from "../../chart-engine/src/agentReference";
import { applyCandleEvent, applySnapshotToCandles, candleKey } from "../../chart-engine/src/candleStore";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { findTargetChartPanel } from "../../chart-engine/src/chartPanelSelection";
import { executeChartCommand, executeChartCommandGroup, makeChartCommand, validateChartProposal } from "../../chart-engine/src/commands";
import { projectTrendLine } from "../../chart-engine/src/drawingGeometry";
import { applyDisplayContinuity } from "../../chart-engine/src/displayContinuity";
import { defaultVisibleBarsForInterval, maxRequestBarsForInterval, normalizeChartInterval } from "../../chart-engine/src/intervals";
import { isRealtimeControlPayload, isRealtimeLayerPayload, normalizeCandleEvent, normalizeCandleSnapshot, normalizeRealtimeLayerEvent } from "../../chart-engine/src/marketDataAdapter";
import { buildChartAgentContext, buildChartProposalRequest } from "../../chart-engine/src/proposals";
import { buildRenderScene } from "../../chart-engine/src/renderScene";
import { chartRuntimeReducer, createInitialChartRuntimeState } from "../../chart-engine/src/runtime";
import { createCoordinateTransform } from "../../chart-engine/src/scales";
import { DEFAULT_CHART_SYMBOL, defaultWatchlistSymbols, normalizeHotRankingPayload, normalizeSupportedSymbol, normalizeWatchlistPayload } from "../../chart-engine/src/symbols";
import type { CandleData, ChartPendingPreview, ChartProposal } from "../../chart-engine/src/types";
import { normalizeAgentEntityResolveResponse, normalizeAgentLayoutResolveResponse } from "../src/agent/agentAnalysisClient";
import {
  buildSemanticTimeline,
  semanticExpansionId,
  semanticNodeId,
  type SemanticExpansion
} from "../src/chart/semanticTimeline";
import type { CandleDto } from "../src/chart/types";
import {
  applyLayoutProposal,
  createInitialRuntimeState as createInitialLayoutRuntimeState,
  executeCommand as executeLayoutCommand,
  layoutPresentationSnapshotsEqual,
  layoutSnapshotsEqual,
  makeCommand as makeLayoutCommand
} from "../src/layout/commands";
import { createInitialTiledPanelState } from "../src/layout/panelLayout";
import { applyTiledAgentLayoutProposal, buildTiledAgentLayoutContext } from "../src/layout/tiledAgentLayout";
import {
  createPanelDropCommand,
  createPanelDropPreview,
  findMaxEmptyWorkspaceRect,
  findWorkspacePanelAtCell,
  getWorkspaceDropCell,
  PANEL_CATALOG_TYPES
} from "../src/layout/panelCatalogDrop";
import { getPanelDefinition } from "../src/layout/panelRegistry";
import { createPanelInstance, createPresetLayout } from "../src/layout/seed";
import type { PanelInstance, PanelPlacement, PanelType, WorkspaceLayout } from "../src/layout/types";
import {
  clampRightOffset,
  clampVisibleCount,
  dragDeltaToRightOffset,
  normalizeViewport,
  resolveViewportVisibleCount,
  zoomViewport
} from "../../chart-engine/src/viewport";

function target(panelId: string, chartDocumentId: string) {
  return { panelId, chartDocumentId };
}

function chartPanel(panelId: string, chartDocumentId: string, symbol = "AAPL"): PanelInstance {
  return {
    id: panelId,
    type: "chart",
    title: "Chart",
    placement: { group: "workspace", zone: "main", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    props: { symbol },
    chartDocumentId,
    variant: "standard",
    createdBy: "system",
    updatedAt: "2026-06-26T00:00:00.000Z"
  };
}

function testPlacement(col: number, row: number, colSpan = 1, rowSpan = 1): PanelPlacement {
  return {
    group: "workspace",
    zone: col === 4 && colSpan === 1 ? "context" : col + colSpan - 1 <= 3 ? "main" : "mainContext",
    col,
    row,
    colSpan,
    rowSpan
  };
}

function testPanel(id: string, type: PanelType, placement: PanelPlacement, pinned = false): PanelInstance {
  return {
    ...createPanelInstance(type, placement, "system", {}, id),
    layoutPinned: pinned
  };
}

function testLayout(panels: PanelInstance[], selectedPanelId = panels[0]?.id): WorkspaceLayout {
  return {
    version: 1,
    zones: {
      workspace: { columns: 4, rows: 5, mainColumns: 3, contextColumns: 1 },
      agentRail: { columns: 1, rows: 5 }
    },
    settings: {
      llmLayoutAutoApply: false,
      reflowMode: "auto"
    },
    panels,
    selectedPanelId
  };
}

function filledLayoutExcept(emptyCells: string[]): WorkspaceLayout {
  const empty = new Set(emptyCells);
  const panels: PanelInstance[] = [];
  for (let row = 1; row <= 5; row += 1) {
    for (let col = 1; col <= 4; col += 1) {
      if (!empty.has(`${col}:${row}`)) {
        panels.push(testPanel(`panel-${col}-${row}`, "aiSummary", testPlacement(col, row)));
      }
    }
  }
  return testLayout(panels);
}

function pickPlacement(placement?: PanelPlacement | null) {
  if (!placement) {
    return null;
  }

  return {
    col: placement.col,
    row: placement.row,
    colSpan: placement.colSpan,
    rowSpan: placement.rowSpan
  };
}

function fakeApiResponse(input: { ok: boolean; status: number; body: string; contentType?: string }) {
  return {
    ok: input.ok,
    status: input.status,
    statusText: "",
    headers: {
      get: (name: string) => name.toLowerCase() === "content-type" ? input.contentType ?? "application/json" : null
    },
    text: async () => input.body
  };
}

const initialLayoutRuntime = createInitialLayoutRuntimeState();
assert.equal(initialLayoutRuntime.layout.selectedPanelId, undefined);
assert.equal(createPresetLayout("chart").selectedPanelId, undefined);
assert.equal(createPresetLayout("overview").selectedPanelId, undefined);
assert.equal(getPanelDefinition("orderTicket").title, "주문");
assert.equal(getPanelDefinition("portfolioHoldings").title, "내 투자");
assert.equal(getPanelDefinition("hotRanking").title, "Hot Ranking");
assert.equal(getPanelDefinition("ontologyGraph").title, "온톨로지");
assert.deepEqual(PANEL_CATALOG_TYPES, ["chart", "newsFeed", "hotRanking", "indicatorCompare", "aiSummary", "portfolioHoldings", "orderTicket", "ontologyGraph"]);
const orderPanelInstance = createPanelInstance("orderTicket", testPlacement(4, 4, 1, 2), "system", {}, "test-order");
assert.equal(orderPanelInstance.type, "orderTicket");
assert.equal(orderPanelInstance.resourceRefs?.[0]?.kind, "orderTicket");
const portfolioPanelInstance = createPanelInstance("portfolioHoldings", testPlacement(1, 4, 1, 2), "system", {}, "test-portfolio");
assert.equal(portfolioPanelInstance.type, "portfolioHoldings");
assert.equal(portfolioPanelInstance.resourceRefs?.[0]?.kind, "portfolioView");
const ontologyPanelInstance = createPanelInstance("ontologyGraph", testPlacement(4, 1, 1, 2), "system", {}, "test-ontology");
assert.equal(ontologyPanelInstance.type, "ontologyGraph");
assert.equal(ontologyPanelInstance.resourceRefs?.[0]?.kind, "ontologyGraph");
const chartPresetPortfolioPanel = createPresetLayout("chart").panels.find((panel) => panel.id === "panel-portfolio");
assert.equal(chartPresetPortfolioPanel?.type, "portfolioHoldings");
assert.deepEqual(pickPlacement(chartPresetPortfolioPanel?.placement), { col: 1, row: 4, colSpan: 1, rowSpan: 2 });
const chartPresetOrderPanel = createPresetLayout("chart").panels.find((panel) => panel.id === "panel-order");
assert.equal(chartPresetOrderPanel?.type, "orderTicket");
assert.deepEqual(pickPlacement(chartPresetOrderPanel?.placement), { col: 4, row: 4, colSpan: 1, rowSpan: 2 });
const chartPresetHotPanel = createPresetLayout("chart").panels.find((panel) => panel.id === "panel-hot-ranking");
assert.equal(chartPresetHotPanel?.type, "hotRanking");
assert.deepEqual(pickPlacement(chartPresetHotPanel?.placement), { col: 2, row: 4, colSpan: 1, rowSpan: 2 });
const chartPresetRuntimeCopy = createPresetLayout("chart");
const chartPresetSavedCopy = createPresetLayout("chart");
assert.equal(layoutSnapshotsEqual(chartPresetRuntimeCopy, chartPresetSavedCopy), false);
assert.equal(layoutPresentationSnapshotsEqual(chartPresetRuntimeCopy, chartPresetSavedCopy), true);

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const fakeLocalStorageRecords = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => fakeLocalStorageRecords.get(key) ?? null,
    setItem: (key: string, value: string) => fakeLocalStorageRecords.set(key, value),
    removeItem: (key: string) => fakeLocalStorageRecords.delete(key),
    clear: () => fakeLocalStorageRecords.clear()
  }
});

try {
  const staleChartDefault = createPresetLayout("chart");
  const staleOrderPlacement = staleChartDefault.panels.find((panel) => panel.id === "panel-order")?.placement ?? testPlacement(4, 4, 1, 2);
  staleChartDefault.panels = staleChartDefault.panels.map((panel) =>
    panel.id === "panel-order"
      ? createPanelInstance("newsFeed", staleOrderPlacement, "system", { query: "stale default" }, "panel-stale-news")
      : panel
  );
  fakeLocalStorageRecords.set("gops.savedLayouts.v1", JSON.stringify([{
    id: "default-chart",
    name: "Chart",
    version: 1,
    savedAt: "2026-06-26T00:00:00.000Z",
    kind: "default",
    defaultKey: "chart",
    layout: staleChartDefault
  }]));

  const runtimeWithStaleDefault = createInitialLayoutRuntimeState();
  const mergedChartDefault = runtimeWithStaleDefault.savedLayouts.find((record) => record.kind === "default" && record.defaultKey === "chart");
  assert.equal(mergedChartDefault?.layout.panels.some((panel) => panel.id === "panel-order" && panel.type === "orderTicket"), true);
  assert.equal(mergedChartDefault?.layout.panels.some((panel) => panel.id === "panel-stale-news"), false);
} finally {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const selectedSavedPanel = testPanel("selected-saved-chart", "chart", testPlacement(1, 1));
const selectedSavedLayout = testLayout([selectedSavedPanel], selectedSavedPanel.id);
const loadedWithoutSelection = executeLayoutCommand(
  {
    ...initialLayoutRuntime,
    layout: testLayout([testPanel("active-before-load", "newsFeed", testPlacement(2, 1))]),
    savedLayouts: [{
      id: "saved-selected-layout",
      name: "Saved selected layout",
      version: 1,
      savedAt: "2026-06-26T00:00:00.000Z",
      kind: "user",
      layout: selectedSavedLayout
    }]
  },
  makeLayoutCommand("layout.load", "user", { savedLayoutId: "saved-selected-layout" })
);
assert.equal(loadedWithoutSelection.layout.selectedPanelId, undefined);

const documentA = createChartDocument("chart-doc-a", "AAPL", "1m");
const viewportCommand = makeChartCommand("chart.viewport.set", "user", target("panel-a", documentA.id), {
  visibleCount: 42,
  rightOffset: 3
});
const viewportResult = executeChartCommand(documentA, viewportCommand);

assert.equal(viewportResult.ok, true);
if (viewportResult.ok) {
  assert.equal(viewportResult.document.viewport.visibleCount, 42);
  assert.equal(viewportResult.document.viewport.rightOffset, 3);
  assert.equal(viewportResult.document.history.length, 1);

  const undoResult = executeChartCommand(
    viewportResult.document,
    makeChartCommand("chart.undo", "user", target("panel-a", documentA.id))
  );
  assert.equal(undoResult.ok, true);
  if (undoResult.ok) {
    assert.equal(undoResult.document.viewport.visibleCount, documentA.viewport.visibleCount);
    assert.equal(undoResult.document.future.length, 1);
  }
}

const noOpResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.viewport.set", "user", target("panel-a", documentA.id), documentA.viewport)
);
assert.equal(noOpResult.ok, true);
if (noOpResult.ok) {
  assert.equal(noOpResult.noOp, true);
  assert.equal(noOpResult.document.history.length, 0);
}

const unsupportedSymbolResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.symbol.set", "user", target("panel-a", documentA.id), { symbol: "BAD!" })
);
assert.equal(unsupportedSymbolResult.ok, false);

const supportedSymbolResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.symbol.set", "user", target("panel-a", documentA.id), { symbol: "NVDA" })
);
assert.equal(supportedSymbolResult.ok, true);
if (supportedSymbolResult.ok) {
  assert.equal(supportedSymbolResult.document.symbol, "NVDA");
}

const documentB = createChartDocument("chart-doc-b", "MSFT", "5m");
const documentBResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.layer.visibility.set", "user", target("panel-b", documentB.id), {
    layer: "ma20",
    visible: false
  })
);
assert.equal(documentBResult.ok, true);
assert.equal(documentA.history.length, 0);
if (documentBResult.ok) {
  assert.equal(documentBResult.document.history.length, 1);
}

const candleA: CandleData = {
  timestamp: "2026-06-25T13:30:00Z",
  open: 10,
  high: 11,
  low: 9,
  close: 10.5,
  volume: 100,
  isClosed: true
};
const candleB: CandleData = {
  timestamp: "2026-06-25T13:31:00Z",
  open: 10.5,
  high: 11.3,
  low: 10.1,
  close: 10.8,
  volume: 120,
  isClosed: false
};
const candleC: CandleData = {
  timestamp: "2026-06-25T13:32:00Z",
  open: 10.8,
  high: 11.5,
  low: 10.6,
  close: 11.1,
  volume: 130,
  isClosed: false
};
const correctedA: CandleData = { ...candleA, close: 10.9, high: 11.1 };
const expansionParentNodeId = semanticNodeId("AAPL", "1D", candleA.timestamp);
const emptyExpansionMessage = "Candle fill timed out before all sources finished.";
const emptyExpansion: SemanticExpansion = {
  id: semanticExpansionId(expansionParentNodeId),
  symbol: "AAPL",
  parentNodeId: expansionParentNodeId,
  parentTimestamp: candleA.timestamp,
  parentInterval: "1D",
  parentCandle: candleA as CandleDto,
  childInterval: "10m",
  from: candleA.timestamp,
  to: "2026-06-26T13:30:00Z",
  depth: 1,
  status: "empty",
  candles: [],
  message: emptyExpansionMessage,
  openedAt: "2026-06-25T13:30:01Z"
};
const emptyExpansionTimeline = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: [candleA as CandleDto],
  expansions: [emptyExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: 1,
  viewportStartIndex: 0,
  visibleSlotCount: 20
});
const emptyExpansionPlaceholder = emptyExpansionTimeline.units.find((unit) => unit.kind === "placeholder");
assert.equal(emptyExpansionPlaceholder?.message, emptyExpansionMessage);

const staleResult = applyCandleEvent([candleB], {
  type: "LIVE_CANDLE_UPDATE",
  symbol: "AAPL",
  interval: "1m",
  data: candleA
});
assert.equal(staleResult.applied, false);

const correctedResult = applyCandleEvent([candleA, candleB], {
  type: "CANDLE_CORRECTED",
  symbol: "AAPL",
  interval: "1m",
  data: correctedA
});
assert.equal(correctedResult.applied, true);
assert.equal(correctedResult.candles[0]?.close, correctedA.close);

const liveMutationResult = applyCandleEvent([candleA, candleB], {
  type: "LIVE_CANDLE_UPDATE",
  symbol: "AAPL",
  interval: "1m",
  data: { ...candleB, close: 11.2, high: 11.8, volume: 180 }
});
assert.equal(liveMutationResult.applied, true);
assert.equal(liveMutationResult.candles.length, 2);
assert.equal(liveMutationResult.candles[1]?.close, 11.2);
assert.equal(liveMutationResult.candles[1]?.volume, 180);
assert.equal(liveMutationResult.candles[1]?.timestamp, "2026-06-25T13:31:00.000Z");

const duplicateBucketResult = applyCandleEvent([candleB], {
  type: "LIVE_CANDLE_UPDATE",
  symbol: "AAPL",
  interval: "1m",
  data: { ...candleB, timestamp: "2026-06-25T13:31:00.000Z", close: 11.4 }
});
assert.equal(duplicateBucketResult.applied, true);
assert.equal(duplicateBucketResult.candles.length, 1);
assert.equal(duplicateBucketResult.candles[0]?.close, 11.4);
assert.deepEqual(
  applySnapshotToCandles({
    symbol: "AAPL",
    interval: "1m",
    source: "alpaca",
    feed: "sip",
    indicators: { ma: [5, 20, 60], volume: true },
    candles: [{ ...candleB, timestamp: "2026-06-25T13:31:00.000Z", close: 11.5 }]
  }, [candleB]).map((candle) => candle.close),
  [11.5]
);
const prependedSnapshotCandles = applySnapshotToCandles({
  symbol: "AAPL",
  interval: "1m",
  source: "alpaca",
  feed: "sip",
  indicators: { ma: [5, 20, 60], volume: true },
  candles: [
    { ...candleA, timestamp: "2026-06-25T13:29:00.000Z", close: 9.8 },
    { ...candleA, close: 10.7 }
  ]
}, [candleA, candleB]);
assert.deepEqual(prependedSnapshotCandles.map((candle) => candle.timestamp), [
  "2026-06-25T13:29:00.000Z",
  "2026-06-25T13:30:00.000Z",
  "2026-06-25T13:31:00.000Z"
]);
assert.equal(prependedSnapshotCandles[1]?.close, 10.7);
const overnightContinuity = applyDisplayContinuity([
  { ...candleA, timestamp: "2026-07-01T05:00:00.000Z", close: 101, marketSession: "overnight" },
  { ...candleB, timestamp: "2026-07-01T05:03:00.000Z", close: 102, marketSession: "overnight" }
], "1m");
assert.deepEqual(overnightContinuity.map((candle) => candle.timestamp), [
  "2026-07-01T05:00:00.000Z",
  "2026-07-01T05:01:00.000Z",
  "2026-07-01T05:02:00.000Z",
  "2026-07-01T05:03:00.000Z"
]);
assert.equal(overnightContinuity[1]?.displayOnly, true);
assert.equal(overnightContinuity[1]?.volume, 0);
assert.equal(overnightContinuity[1]?.close, 101);
const regularContinuity = applyDisplayContinuity([
  { ...candleA, timestamp: "2026-06-25T14:30:00.000Z", close: 201, marketSession: "regular" },
  { ...candleB, timestamp: "2026-06-25T14:33:00.000Z", close: 202, marketSession: "regular" }
], "1m");
assert.equal(regularContinuity.length, 2);

const invalidProposal: ChartProposal = {
  id: "proposal-invalid",
  title: "Invalid mixed actor",
  rationale: "Should fail validation",
  summary: "Invalid",
  target: target("panel-a", documentA.id),
  commands: [
    makeChartCommand("chart.viewport.set", "user", target("panel-a", documentA.id), {
      visibleCount: 50
    })
  ],
  insights: [],
  status: "pending",
  createdAt: new Date().toISOString(),
  createdByAgentId: "agent-01"
};

assert.match(validateChartProposal(invalidProposal) ?? "", /llm actor/);

const fixtureSnapshot = normalizeCandleSnapshot({
  symbol: "NVDA",
  interval: "5m",
  source: "alpaca",
  feed: "sip",
  candles: [candleA],
});
assert.equal(fixtureSnapshot.feed, "sip");

const legacyDailySnapshot = normalizeCandleSnapshot({
  symbol: "NVDA",
  interval: "1d",
  source: "alpaca",
  feed: "sip",
  candles: [candleA],
});
assert.equal(legacyDailySnapshot.interval, "1D");

const fixtureRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.snapshot.loaded",
  snapshot: fixtureSnapshot,
});
assert.equal(fixtureRuntime.dataStatusByKey[candleKey("NVDA", "5m")]?.state, "ready");
assert.equal(fixtureRuntime.candlesByKey[candleKey("NVDA", "5m")]?.length, 1);
assert.equal(fixtureRuntime.streamStatusByKey[candleKey("NVDA", "5m")], undefined);
const streamErrorThenSnapshotRuntime = chartRuntimeReducer(chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.stream.status",
  symbol: "NVDA",
  interval: "5m",
  status: "error",
  message: "Live stream is unavailable."
}), {
  kind: "chart.snapshot.loaded",
  snapshot: fixtureSnapshot,
});
assert.equal(streamErrorThenSnapshotRuntime.dataStatusByKey[candleKey("NVDA", "5m")]?.state, "ready");
assert.equal(streamErrorThenSnapshotRuntime.streamStatusByKey[candleKey("NVDA", "5m")], "error");
const streamIdleThenSnapshotRuntime = chartRuntimeReducer(chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.stream.status",
  symbol: "NVDA",
  interval: "5m",
  status: "idle",
  message: "Live stream is connected; waiting for market data."
}), {
  kind: "chart.snapshot.loaded",
  snapshot: fixtureSnapshot,
});
assert.equal(streamIdleThenSnapshotRuntime.dataStatusByKey[candleKey("NVDA", "5m")]?.state, "ready");
assert.equal(streamIdleThenSnapshotRuntime.streamStatusByKey[candleKey("NVDA", "5m")], "idle");
assert.equal(
  streamIdleThenSnapshotRuntime.streamMessageByKey?.[candleKey("NVDA", "5m")],
  "Live stream is connected; waiting for market data."
);
const liveRuntime = chartRuntimeReducer(fixtureRuntime, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "NVDA",
    interval: "5m",
    source: "alpaca",
    feed: "sip",
    data: { ...candleA, close: 11.4, high: 11.6 }
  }
});
assert.equal(liveRuntime.dataStatusByKey[candleKey("NVDA", "5m")]?.feed, "sip");

const heartbeatPayload = { type: "HEARTBEAT", symbol: "NVDA", interval: "1m" };
assert.equal(isRealtimeControlPayload(heartbeatPayload), true);
assert.throws(() => normalizeCandleEvent(heartbeatPayload), /missing type, symbol, interval, or data/);
const tradePayload = { type: "LIVE_TRADE_UPDATE", symbol: "NVDA", data: { price: "197.66", size: "20", timestamp: "2026-07-02T14:30:00Z" } };
assert.equal(isRealtimeLayerPayload(tradePayload), true);
const normalizedTrade = normalizeRealtimeLayerEvent(tradePayload);
if (normalizedTrade.type !== "LIVE_TRADE_UPDATE") {
  throw new Error("expected trade payload");
}
assert.equal(normalizedTrade.data.price, 197.66);
const tradeLayerRuntime = chartRuntimeReducer(liveRuntime, { kind: "chart.layer.live", event: normalizedTrade });
assert.equal(tradeLayerRuntime.liveTradesBySymbol?.NVDA?.price, 197.66);

assert.equal(isChartDataRenderable({
  state: "partial",
  message: "Sparse daily coverage should not render like a normal chart.",
  coverage: {
    state: "partial",
    reasonCode: "insufficient_source_bars",
    sourceInterval: "1D",
    renderable: false,
    minimumRenderableSourceBars: 60,
    storedCandleCount: 8
  },
  updatedAt: new Date().toISOString()
}), false);
assert.equal(isChartDataRenderable({
  state: "partial",
  message: "Sparse intraday gap can remain visible while gapfill repairs the range.",
  returnedCount: 120,
  coverage: {
    state: "partial",
    reasonCode: "returned_window_sparse",
    sourceInterval: "1m",
    renderable: false,
    returnedCount: 120,
    gapRanges: [{ start: "2026-06-30T15:22:00.000Z", end: "2026-06-30T15:31:00.000Z", missingCount: 9 }]
  },
  updatedAt: new Date().toISOString()
}), true);
assert.equal(isChartDataRenderable({
  state: "partial",
  message: "Enough partial intraday candles may still be inspectable.",
  coverage: {
    state: "partial",
    reasonCode: "backfill_succeeded_without_complete_coverage",
    sourceInterval: "1m",
    renderable: true,
    minimumRenderableSourceBars: 30,
    storedCandleCount: 99
  },
  updatedAt: new Date().toISOString()
}), true);

const emptyStatusRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.data.status",
  symbol: "AMD",
  interval: "1m",
  status: {
    state: "empty",
    message: "No candle data is available yet."
  }
});
assert.equal(emptyStatusRuntime.dataStatusByKey[candleKey("AMD", "1m")]?.state, "empty");
assert.equal(emptyStatusRuntime.streamStatusByKey[candleKey("AMD", "1m")], undefined);

const derivedSourceStatusRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.data.status",
  symbol: "AMD",
  interval: "1W",
  status: {
    state: "empty",
    message: "Weekly candles need daily source data.",
    sourceInterval: "1D"
  }
});
assert.equal(derivedSourceStatusRuntime.dataStatusByKey[candleKey("AMD", "1W")]?.sourceInterval, "1D");

const liveThenDataErrorRuntime = chartRuntimeReducer(liveRuntime, {
  kind: "chart.data.status",
  symbol: "NVDA",
  interval: "5m",
  status: {
    state: "error",
    message: "Snapshot unavailable while live socket remains separate.",
    updatedAt: new Date().toISOString()
  }
});
assert.equal(liveThenDataErrorRuntime.streamStatusByKey[candleKey("NVDA", "5m")], "live");

const partialFillSnapshot = normalizeCandleSnapshot({
  symbol: "INTC",
  interval: "1m",
  source: "alpaca",
  feed: "sip",
  dataStatus: "partial",
  requestedLimit: 390,
  returnedCount: 1,
  targetStoredCount: 5460,
  storedCandleCount: 1,
  hasMoreBefore: true,
  coverage: {
    state: "partial",
    reasonCode: "stored_range_incomplete",
    repairStatus: "gapfill_required",
    sourceInterval: "1m",
    returnedCount: 1,
    storedCandleCount: 1,
    targetStoredCount: 5460,
    renderable: false,
    minimumReturnedCount: 20,
    minimumRenderableSourceBars: 30
  },
  candles: [candleB]
});
assert.equal(partialFillSnapshot.dataStatus, "partial");
assert.equal(partialFillSnapshot.coverage?.reasonCode, "stored_range_incomplete");
assert.equal(partialFillSnapshot.coverage?.repairStatus, "gapfill_required");
assert.equal(partialFillSnapshot.coverage?.renderable, false);
const partialFillRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.snapshot.loaded",
  snapshot: partialFillSnapshot
});
const partialFillStatus = partialFillRuntime.dataStatusByKey[candleKey("INTC", "1m")];
assert.equal(partialFillStatus?.state, "partial");
assert.equal(partialFillStatus?.hasMoreBefore, true);
assert.equal(partialFillStatus?.targetStoredCount, 5460);
assert.equal(partialFillStatus?.coverage?.targetStoredCount, 5460);
assert.equal(partialFillStatus?.coverage?.repairStatus, "gapfill_required");

const agentContextWithStreamError = buildChartAgentContext({
  panelId: "panel-agent-context",
  document: createChartDocument("chart-doc-agent-context", "NVDA", "1m"),
  candles: [candleA, candleB],
  dataStatus: {
    state: "ready",
    updatedAt: new Date().toISOString()
  },
  streamStatus: "error",
  symbolUniverse: ["NVDA", "AMD"]
});
assert.equal(agentContextWithStreamError.dataStatus.state, "ready");
assert.equal(agentContextWithStreamError.dataStatus.candleCount, 2);
assert.equal(agentContextWithStreamError.dataStatus.hasVisibleCandles, true);
assert.equal(agentContextWithStreamError.streamStatus, "error");
assert.deepEqual(agentContextWithStreamError.entityFallback, {
  source: "selected-chart",
  panelId: "panel-agent-context",
  chartDocumentId: "chart-doc-agent-context",
  symbol: "NVDA"
});

const proposalScene = buildRenderScene({
  state: "ready",
  document: createChartDocument("chart-doc-proposal-scene", "NVDA", "1m"),
  candles: [candleA, candleB],
  width: 640,
  height: 320,
  streamStatus: "error"
});
const proposalRequestWithCandles = buildChartProposalRequest({
  panelId: "panel-proposal-scene",
  document: proposalScene.document,
  scene: proposalScene,
  streamStatus: "error",
  symbolUniverse: ["NVDA", "AMD"]
});
assert.equal(proposalRequestWithCandles.dataStatus.state, "ready");
assert.equal(proposalRequestWithCandles.dataStatus.candleCount, 2);
assert.equal(proposalRequestWithCandles.dataStatus.hasVisibleCandles, true);
assert.equal(proposalRequestWithCandles.streamStatus, "error");

const idleProposalScene = buildRenderScene({
  state: "ready",
  document: createChartDocument("chart-doc-idle-scene", "NVDA", "1m"),
  candles: [candleA, candleB],
  width: 640,
  height: 320,
  streamStatus: "idle"
});
assert.equal(idleProposalScene.labels.streamStatus, "idle");

const mergedSnapshotRuntime = chartRuntimeReducer(partialFillRuntime, {
  kind: "chart.snapshot.loaded",
  snapshot: normalizeCandleSnapshot({
    symbol: "INTC",
    interval: "1m",
    source: "alpaca",
    feed: "sip",
    dataStatus: "partial",
    candles: [candleA]
  })
});
assert.deepEqual(
  mergedSnapshotRuntime.candlesByKey[candleKey("INTC", "1m")]?.map((candle) => candle.timestamp),
  ["2026-06-25T13:30:00.000Z", "2026-06-25T13:31:00.000Z"]
);

const lifecyclePanelA = chartPanel("panel-lifecycle-a", "chart-doc-lifecycle-a", "AAPL");
const lifecyclePanelB = chartPanel("panel-lifecycle-b", "chart-doc-lifecycle-b", "MSFT");
const lifecyclePreview: ChartPendingPreview = {
  id: "preview-lifecycle-b",
  sourceProposalId: "proposal-lifecycle-b",
  drawings: [],
  comparisons: [],
  visible: true,
  createdAt: "2026-06-26T00:00:00.000Z"
};
let lifecycleState = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: [lifecyclePanelA, lifecyclePanelB]
});
lifecycleState = {
  ...lifecycleState,
  pendingPreviewByDocumentId: { [lifecyclePanelB.chartDocumentId ?? ""]: lifecyclePreview },
  pendingProposals: [{
    id: "proposal-lifecycle-b",
    title: "Stale proposal",
    rationale: "Panel B was removed.",
    summary: "Stale",
    target: target(lifecyclePanelB.id, lifecyclePanelB.chartDocumentId ?? ""),
    commands: [],
    insights: [],
    status: "pending",
    createdAt: "2026-06-26T00:00:00.000Z",
    createdByAgentId: "agent-01"
  }],
  errors: [
    { id: "error-lifecycle-b", message: "Stale chart error", chartDocumentId: lifecyclePanelB.chartDocumentId, createdAt: "2026-06-26T00:00:00.000Z" },
    { id: "error-global", message: "Global error", createdAt: "2026-06-26T00:00:00.000Z" }
  ]
};
const prunedLifecycleState = chartRuntimeReducer(lifecycleState, {
  kind: "chart.ensureDocuments",
  panels: [lifecyclePanelA]
});
assert.ok(prunedLifecycleState.documents[lifecyclePanelA.chartDocumentId ?? ""]);
assert.equal(prunedLifecycleState.documents[lifecyclePanelB.chartDocumentId ?? ""], undefined);
assert.equal(prunedLifecycleState.pendingPreviewByDocumentId[lifecyclePanelB.chartDocumentId ?? ""], undefined);
assert.equal(prunedLifecycleState.pendingProposals.length, 0);
assert.equal(prunedLifecycleState.errors.some((error) => error.id === "error-lifecycle-b"), false);
assert.equal(prunedLifecycleState.errors.some((error) => error.id === "error-global"), true);

assert.equal(normalizeSupportedSymbol(" nvda "), "NVDA");
assert.equal(normalizeSupportedSymbol("GOOG"), "GOOG");
assert.equal(normalizeSupportedSymbol("BAD!"), null);

assert.equal(normalizeChartInterval("1d"), "1D");
assert.equal(normalizeChartInterval("1w"), "1W");
assert.equal(normalizeChartInterval("1mo"), "1M");
assert.equal(normalizeChartInterval("bad"), null);
assert.equal(defaultVisibleBarsForInterval("1m"), 120);
assert.equal(defaultVisibleBarsForInterval("5m"), 120);
assert.equal(defaultVisibleBarsForInterval("10m"), 120);
assert.equal(defaultVisibleBarsForInterval("1D"), 120);
assert.equal(defaultVisibleBarsForInterval("1W"), 104);
assert.equal(defaultVisibleBarsForInterval("1M"), 36);
assert.equal(maxRequestBarsForInterval("1m"), 589680);
assert.equal(maxRequestBarsForInterval("5m"), 117936);
assert.equal(maxRequestBarsForInterval("10m"), 58968);
assert.equal(maxRequestBarsForInterval("1D"), 1512);
assert.equal(maxRequestBarsForInterval("1W"), 312);
assert.equal(maxRequestBarsForInterval("1M"), 72);
for (const timeframe of ["1D", "1W", "1M"]) {
  const timeframeDocument = createChartDocument(`chart-doc-${timeframe}`, "AAPL", "1m");
  const timeframeResult = executeChartCommand(
    timeframeDocument,
    makeChartCommand("chart.timeframe.set", "user", target("panel-timeframe", timeframeDocument.id), { timeframe })
  );
  assert.equal(timeframeResult.ok, true);
  if (timeframeResult.ok) {
    assert.equal(timeframeResult.document.timeframe, timeframe);
    assert.equal(timeframeResult.document.viewport.visibleCount, defaultVisibleBarsForInterval(timeframe));
  }
}

const watchlist = normalizeWatchlistPayload({
  symbols: [
    { symbol: "IBM", name: "International Business Machines", market: "NYSE", lastPrice: 190.12, changePercent: 1.2, volume: 1000 },
    { symbol: "ORCL", name: "Oracle", lastPrice: 1 }
  ]
});
assert.equal(watchlist.length, 2);
assert.equal(watchlist[0]?.symbol, "IBM");
assert.equal(watchlist[0]?.market, "NYSE");
assert.equal(watchlist[0]?.lastPrice, 190.12);
assert.equal(watchlist.find((item) => item.symbol === "ORCL")?.market, "US");

const seedWatchlist = normalizeWatchlistPayload({
  symbols: ["IBM", "ORCL"].map((symbol) => ({
    symbol,
    name: symbol,
    market: "US"
  }))
});
assert.deepEqual(seedWatchlist.map((item) => item.symbol), ["IBM", "ORCL"]);
assert.deepEqual(defaultWatchlistSymbols().map((item) => item.symbol), []);

const hotRanking = normalizeHotRankingPayload({
  ranking: { method: "current_session_dollar_volume", universe: "on-demand" },
  symbols: [
    { rank: 1, symbol: "ibm", name: "International Business Machines", market: "nyse", sessionDollarVolume: 123000000, changePercent: 1.2 },
    { symbol: "bad" }
  ]
});
assert.equal(hotRanking.length, 1);
assert.equal(hotRanking[0]?.symbol, "IBM");
assert.equal(hotRanking[0]?.rank, 1);
assert.equal(hotRanking[0]?.sessionDollarVolume, 123000000);

const frameCell = getWorkspaceDropCell({ left: 10, top: 20, width: 550, height: 500 }, 12, 24);
assert.deepEqual(frameCell, { col: 1, row: 1 });
const systemAreaCell = getWorkspaceDropCell({ left: 0, top: 0, width: 550, height: 500 }, 530, 20);
assert.equal(systemAreaCell, null);

const singleEmptyLayout = filledLayoutExcept(["4:5"]);
const singleEmptyRect = findMaxEmptyWorkspaceRect(singleEmptyLayout, { col: 4, row: 5 });
assert.deepEqual(singleEmptyRect && pickPlacement(singleEmptyRect), { col: 4, row: 5, colSpan: 1, rowSpan: 1 });

const twoByTwoEmptyLayout = filledLayoutExcept(["2:2", "3:2", "2:3", "3:3"]);
const twoByTwoRect = findMaxEmptyWorkspaceRect(twoByTwoEmptyLayout, { col: 2, row: 2 });
assert.deepEqual(twoByTwoRect && pickPlacement(twoByTwoRect), { col: 2, row: 2, colSpan: 2, rowSpan: 2 });

const lShapedEmptyLayout = filledLayoutExcept(["1:1", "2:1", "1:2"]);
const lShapedRect = findMaxEmptyWorkspaceRect(lShapedEmptyLayout, { col: 1, row: 1 });
assert.deepEqual(lShapedRect && pickPlacement(lShapedRect), { col: 1, row: 1, colSpan: 2, rowSpan: 1 });
assert.equal(findWorkspacePanelAtCell(lShapedEmptyLayout, { col: 3, row: 1 })?.id, "panel-3-1");

const emptyDropCommand = createPanelDropCommand({
  layout: singleEmptyLayout,
  panelType: "chart",
  activeSymbol: "NVDA",
  cell: { col: 4, row: 5 }
});
assert.equal(emptyDropCommand?.type, "layout.panel.add");
assert.equal((emptyDropCommand?.payload.props as Record<string, unknown> | undefined)?.symbol, "NVDA");
assert.deepEqual(pickPlacement(emptyDropCommand?.payload.placement as PanelPlacement), { col: 4, row: 5, colSpan: 1, rowSpan: 1 });
const emptyDropPreview = createPanelDropPreview({
  layout: singleEmptyLayout,
  panelType: "chart",
  activeSymbol: "NVDA",
  cell: { col: 4, row: 5 }
});
assert.equal(emptyDropPreview?.kind, "add");
assert.deepEqual(pickPlacement(emptyDropPreview?.placement), { col: 4, row: 5, colSpan: 1, rowSpan: 1 });

const replaceTarget = testPanel("replace-news", "newsFeed", testPlacement(2, 2, 2, 2));
const replaceLayout = testLayout([replaceTarget]);
const replaceCommand = createPanelDropCommand({
  layout: replaceLayout,
  panelType: "chart",
  activeSymbol: "MSFT",
  targetPanelId: replaceTarget.id
});
assert.equal(replaceCommand?.type, "layout.panel.replace");
const orderReplaceCommand = createPanelDropCommand({
  layout: replaceLayout,
  panelType: "orderTicket",
  activeSymbol: "MSFT",
  targetPanelId: replaceTarget.id
});
assert.equal(orderReplaceCommand?.type, "layout.panel.replace");
assert.equal(orderReplaceCommand?.payload.panelType, "orderTicket");
const replacePreview = createPanelDropPreview({
  layout: replaceLayout,
  panelType: "chart",
  activeSymbol: "MSFT",
  targetPanelId: replaceTarget.id
});
assert.equal(replacePreview?.kind, "replace");
if (replacePreview?.kind === "replace") {
  assert.equal(replacePreview.panelId, replaceTarget.id);
}
let replaceState = {
  ...createInitialLayoutRuntimeState(),
  layout: replaceLayout,
  history: [],
  future: [],
  journal: [],
  errors: []
};
replaceState = executeLayoutCommand(replaceState, replaceCommand ?? makeLayoutCommand("layout.reflow", "user"));
assert.equal(replaceState.layout.panels[0]?.id, replaceTarget.id);
assert.equal(replaceState.layout.panels[0]?.type, "chart");
assert.equal(replaceState.layout.panels[0]?.placement.colSpan, 2);
assert.equal(replaceState.layout.panels[0]?.props.symbol, "MSFT");
assert.ok(replaceState.layout.panels[0]?.chartDocumentId);
assert.equal(replaceState.history.length, 1);

const pinnedTarget = testPanel("pinned-news", "newsFeed", testPlacement(1, 1), true);
const pinnedLayout = testLayout([pinnedTarget]);
const pinnedPreview = createPanelDropPreview({
  layout: pinnedLayout,
  panelType: "chart",
  activeSymbol: "TSLA",
  targetPanelId: pinnedTarget.id
});
assert.equal(pinnedPreview?.kind, "blocked");
if (pinnedPreview?.kind === "blocked") {
  assert.match(pinnedPreview.reason, /Pinned/);
}
assert.equal(createPanelDropCommand({
  layout: pinnedLayout,
  panelType: "chart",
  activeSymbol: "TSLA",
  targetPanelId: pinnedTarget.id
}), null);
const pinnedState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: pinnedLayout,
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.replace", "user", { panelId: pinnedTarget.id, panelType: "chart", props: { symbol: "TSLA" } })
);
assert.equal(pinnedState.layout.panels[0]?.type, "newsFeed");
assert.equal(pinnedState.history.length, 0);
assert.equal(pinnedState.errors.length, 1);

const sameTypeTarget = testPanel("same-chart", "chart", testPlacement(1, 1), false);
const sameTypeLayout = testLayout([sameTypeTarget]);
const sameTypeState = {
  ...createInitialLayoutRuntimeState(),
  layout: sameTypeLayout,
  history: [],
  future: [],
  journal: [],
  errors: []
};
const sameTypeResult = executeLayoutCommand(
  sameTypeState,
  makeLayoutCommand("layout.panel.replace", "user", { panelId: sameTypeTarget.id, panelType: "chart", props: { symbol: "SPY" } })
);
assert.equal(sameTypeResult.history.length, 0);
assert.equal(sameTypeResult.journal.length, 0);
assert.equal(sameTypeResult.layout.panels[0]?.chartDocumentId, sameTypeTarget.chartDocumentId);

const priorityTarget = testPanel("priority-news", "newsFeed", testPlacement(1, 1), false);
const priorityState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([priorityTarget]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.priority.set", "user", { panelId: priorityTarget.id, layoutWeight: 100 })
);
assert.equal(priorityState.layout.panels[0]?.layoutWeight, 100);
assert.equal(priorityState.history.length, 1);

const resizeMoveTarget = testPanel("resize-move-order", "orderTicket", testPlacement(4, 4, 1, 2));
const resizeMoveState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([resizeMoveTarget]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.move", "user", {
    panelId: resizeMoveTarget.id,
    placement: testPlacement(1, 1, 3, 5)
  }, { panelId: resizeMoveTarget.id })
);
const resizedMovePanel = resizeMoveState.layout.panels.find((panel) => panel.id === resizeMoveTarget.id);
assert.deepEqual(resizedMovePanel && pickPlacement(resizedMovePanel.placement), { col: 1, row: 1, colSpan: 3, rowSpan: 5 });

const arrangeOrderPanel = testPanel("arrange-order", "orderTicket", testPlacement(4, 4, 1, 2));
const arrangeState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([
      testPanel("arrange-chart", "chart", testPlacement(1, 1, 3, 3)),
      testPanel("arrange-news", "newsFeed", testPlacement(1, 4, 2, 2)),
      testPanel("arrange-ontology", "ontologyGraph", testPlacement(4, 1, 1, 2)),
      arrangeOrderPanel
    ], arrangeOrderPanel.id),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panels.arrange", "user", {
    placements: [
      { panelId: arrangeOrderPanel.id, placement: testPlacement(1, 1, 3, 5), layoutWeight: 100 },
      { panelId: "arrange-chart", placement: testPlacement(4, 1), layoutWeight: 40 },
      { panelId: "arrange-news", placement: testPlacement(4, 2), layoutWeight: 40 },
      { panelId: "arrange-ontology", placement: testPlacement(4, 3), layoutWeight: 40 }
    ]
  })
);
const arrangedOrderPanel = arrangeState.layout.panels.find((panel) => panel.id === arrangeOrderPanel.id);
assert.deepEqual(arrangedOrderPanel && pickPlacement(arrangedOrderPanel.placement), { col: 1, row: 1, colSpan: 3, rowSpan: 5 });
assert.equal(arrangedOrderPanel?.layoutWeight, 100);
assert.equal(arrangeState.history.length, 1);

const pinnedArrangePanel = testPanel("pinned-arrange-news", "newsFeed", testPlacement(2, 2), true);
const pinnedArrangeState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([pinnedArrangePanel]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panels.arrange", "user", {
    placements: [
      { panelId: pinnedArrangePanel.id, placement: testPlacement(1, 1), layoutWeight: 100 }
    ]
  })
);
assert.deepEqual(pickPlacement(pinnedArrangeState.layout.panels[0]?.placement), { col: 2, row: 2, colSpan: 1, rowSpan: 1 });
assert.equal(pinnedArrangeState.history.length, 0);
assert.equal(pinnedArrangeState.errors.at(-1)?.message.includes("Pinned panel cannot be arranged"), true);

const autoProposalTarget = testPanel("auto-proposal-news", "newsFeed", testPlacement(1, 1), false);
const autoProposalBaseState = {
  ...createInitialLayoutRuntimeState(),
  layout: testLayout([autoProposalTarget]),
  history: [],
  future: [],
  journal: [],
  errors: [],
  pendingProposals: []
};
const autoProposalState = applyLayoutProposal(autoProposalBaseState, {
  id: "layout-proposal-auto",
  title: "Agent analysis workspace",
  rationale: "Test auto proposal.",
  autoApply: true,
  panelPriorities: [],
  commands: [
    makeLayoutCommand("layout.panel.priority.set", "llm", { panelId: autoProposalTarget.id, layoutWeight: 95 })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
});
assert.equal(autoProposalState.layout.panels[0]?.layoutWeight, 95);
assert.equal(autoProposalState.pendingProposals.length, 0);
assert.equal(autoProposalState.journal[0]?.status, "applied");

const failedProposalState = applyLayoutProposal(autoProposalBaseState, {
  id: "layout-proposal-fail",
  title: "Broken agent layout",
  rationale: "Test rollback.",
  autoApply: true,
  panelPriorities: [],
  commands: [
    makeLayoutCommand("layout.panel.priority.set", "llm", { panelId: autoProposalTarget.id, layoutWeight: 96 }),
    makeLayoutCommand("layout.panel.priority.set", "llm", { panelId: "missing-panel", layoutWeight: 97 })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
});
assert.equal(failedProposalState.layout.panels[0]?.layoutWeight, autoProposalTarget.layoutWeight);
assert.equal(failedProposalState.errors.length, 1);

const tiledViewport = { width: 1280, height: 800 };
const tiledState = createInitialTiledPanelState(tiledViewport);
const tiledContext = buildTiledAgentLayoutContext(tiledState, tiledViewport);
assert.equal((tiledContext.panels.find((panel) => panel.id === "slot-news") as { type?: string } | undefined)?.type, "newsFeed");
const tiledChartContext = tiledContext.panels.find((panel) => panel.id === "slot-chart") as
  | { layoutPinned?: boolean; minSpan?: { colSpan?: number; rowSpan?: number } }
  | undefined;
assert.equal(tiledChartContext?.layoutPinned, false);
assert.deepEqual(tiledChartContext?.minSpan, { colSpan: 4, rowSpan: 2 });
const originalOntologyRect = tiledState.slots.find((slot) => slot.id === "slot-ontology")?.rect;
const focusedOntologyState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled",
  title: "Focus ontology",
  rationale: "Test tiled focus.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-ontology", panelType: "ontologyGraph", layoutWeight: 100 }],
  commands: [
    makeLayoutCommand("layout.panel.priority.set", "llm", { panelId: "slot-ontology", layoutWeight: 100 }, { panelId: "slot-ontology" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const focusedOntologyRect = focusedOntologyState.slots.find((slot) => slot.id === "slot-ontology")?.rect;
assert.ok(focusedOntologyRect && originalOntologyRect && focusedOntologyRect.width > originalOntologyRect.width);
const arrangedOntologyState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled-arrange",
  title: "Arrange ontology",
  rationale: "Test tiled arrange.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-ontology", panelType: "ontologyGraph", layoutWeight: 100 }],
  commands: [
    makeLayoutCommand("layout.panels.arrange", "llm", {
      placements: [
        { panelId: "slot-ontology", placement: testPlacement(1, 1, 2, 3), layoutWeight: 100 },
        { panelId: "slot-chart", placement: testPlacement(1, 4, 4, 2), layoutWeight: 60 },
        { panelId: "slot-news", placement: testPlacement(3, 1, 1, 1), layoutWeight: 50 }
      ]
    }, { panelId: "slot-ontology" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const arrangedOntologyRect = arrangedOntologyState.slots.find((slot) => slot.id === "slot-ontology")?.rect;
assert.ok(arrangedOntologyRect && originalOntologyRect && arrangedOntologyRect.width > originalOntologyRect.width);
assert.ok(arrangedOntologyRect && originalOntologyRect && arrangedOntologyRect.height > originalOntologyRect.height);

const primaryChart = testPanel("primary-chart", "chart", testPlacement(1, 1, 2, 2), false);
const multiChartLayout = testLayout([primaryChart]);
const multiChartState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: multiChartLayout,
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.add", "user", {
    panelType: "chart",
    placement: testPlacement(3, 1, 1, 2),
    props: { symbol: "TSLA" }
  })
);
const chartPanels = multiChartState.layout.panels.filter((panel) => panel.type === "chart");
assert.equal(chartPanels.length, 2);
assert.notEqual(chartPanels[0]?.chartDocumentId, chartPanels[1]?.chartDocumentId);
let multiChartRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: multiChartState.layout.panels
});
assert.equal(multiChartRuntime.documents[chartPanels[0]?.chartDocumentId ?? ""]?.symbol, DEFAULT_CHART_SYMBOL);
assert.equal(multiChartRuntime.documents[chartPanels[1]?.chartDocumentId ?? ""]?.symbol, "TSLA");

const orderAddState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.add", "user", {
    panelType: "orderTicket",
    placement: testPlacement(4, 4, 1, 2)
  })
);
assert.equal(orderAddState.layout.panels[0]?.type, "orderTicket");
assert.equal(orderAddState.layout.panels[0]?.resourceRefs?.[0]?.kind, "orderTicket");

const portfolioAddState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.add", "user", {
    panelType: "portfolioHoldings",
    placement: testPlacement(1, 4, 1, 2)
  })
);
assert.equal(portfolioAddState.layout.panels[0]?.type, "portfolioHoldings");
assert.equal(portfolioAddState.layout.panels[0]?.resourceRefs?.[0]?.kind, "portfolioView");

assert.equal(clampRightOffset(120, 72, 160), 88);
assert.equal(dragDeltaToRightOffset(0, 18, 9, 72, 160), 2);
assert.equal(dragDeltaToRightOffset(8, -27, 9, 72, 160), 5);
assert.equal(resolveViewportVisibleCount(400, 180), 50);
assert.equal(clampVisibleCount(180, 160, 400), 50);
assert.equal(clampVisibleCount(1, 160, 400), 6);
assert.deepEqual(normalizeViewport({ visibleCount: 180, rightOffset: 120 }, 160, 400), {
  visibleCount: 50,
  rightOffset: 110
});
assert.deepEqual(zoomViewport({ visibleCount: 8, rightOffset: 0 }, -8, 160, 400), {
  visibleCount: 6,
  rightOffset: 0
});
assert.deepEqual(zoomViewport({ visibleCount: 180, rightOffset: 0 }, -8, 160, 400), {
  visibleCount: 42,
  rightOffset: 0
});
assert.deepEqual(zoomViewport({ visibleCount: 180, rightOffset: 120 }, -8, 160, 400), {
  visibleCount: 42,
  rightOffset: 118
});

const detachedDocument = createChartDocument("chart-doc-detached", "AAPL", "1m");
detachedDocument.viewport = { visibleCount: 1, rightOffset: 1 };
const detachedState = {
  ...createInitialChartRuntimeState(),
  documents: { [detachedDocument.id]: detachedDocument },
  candlesByKey: { [candleKey("AAPL", "1m")]: [candleA, candleB] }
};
const detachedLiveState = chartRuntimeReducer(detachedState, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "AAPL",
    interval: "1m",
    data: candleC
  }
});
assert.equal(detachedLiveState.documents[detachedDocument.id]?.viewport.rightOffset, 2);

const followDocument = createChartDocument("chart-doc-follow", "AAPL", "1m");
followDocument.viewport = { visibleCount: 1, rightOffset: 0 };
const followState = {
  ...createInitialChartRuntimeState(),
  documents: { [followDocument.id]: followDocument },
  candlesByKey: { [candleKey("AAPL", "1m")]: [candleA, candleB] }
};
const followLiveState = chartRuntimeReducer(followState, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "AAPL",
    interval: "1m",
    data: candleC
  }
});
assert.equal(followLiveState.documents[followDocument.id]?.viewport.rightOffset, 0);

const sharedCachePanelA = chartPanel("shared-panel-a", "shared-doc-a", "AAPL");
const sharedCachePanelB = chartPanel("shared-panel-b", "shared-doc-b", "AAPL");
let sharedCacheRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: [sharedCachePanelA, sharedCachePanelB]
});
sharedCacheRuntime = chartRuntimeReducer(sharedCacheRuntime, {
  kind: "chart.snapshot.loaded",
  snapshot: {
    symbol: "AAPL",
    interval: "1m",
    source: "alpaca",
    feed: "sip",
    indicators: { ma: [5, 20, 60], volume: true },
    candles: [candleA, candleB]
  }
});
assert.equal(Object.keys(sharedCacheRuntime.candlesByKey).filter((key) => key === candleKey("AAPL", "1m")).length, 1);
assert.equal(sharedCacheRuntime.candlesByKey[candleKey("AAPL", "1m")]?.length, 2);
sharedCacheRuntime = chartRuntimeReducer(sharedCacheRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.viewport.set", "user", target(sharedCachePanelA.id, "shared-doc-a"), {
    visibleCount: 1,
    rightOffset: 1
  })
});
assert.deepEqual(sharedCacheRuntime.documents["shared-doc-a"]?.viewport, { visibleCount: 6, rightOffset: 1 });
assert.deepEqual(sharedCacheRuntime.documents["shared-doc-b"]?.viewport, { visibleCount: defaultVisibleBarsForInterval("1m"), rightOffset: 0 });
sharedCacheRuntime = chartRuntimeReducer(sharedCacheRuntime, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "AAPL",
    interval: "1m",
    data: candleC
  }
});
assert.equal(sharedCacheRuntime.candlesByKey[candleKey("AAPL", "1m")]?.length, 3);
assert.equal(sharedCacheRuntime.documents["shared-doc-a"]?.viewport.rightOffset, 2);
assert.equal(sharedCacheRuntime.documents["shared-doc-b"]?.viewport.rightOffset, 0);

const chatResult = normalizeAgentChatResponse({
  reply: "Applying chart commands.",
  title: "Chat command",
  summary: "Change symbol",
  rationale: "User asked for a symbol change.",
  insights: [],
  commands: [
    {
      type: "chart.symbol.set",
      payload: {
        symbol: "NVDA",
        timeframe: null,
        visibleCount: null,
        rightOffset: null,
        layer: null,
        visible: null
      }
    }
  ]
}, target("panel-a", documentA.id));

assert.equal(chatResult.reply, "Applying chart commands.");
assert.equal(chatResult.proposal?.commands[0]?.type, "chart.symbol.set");
assert.equal(chatResult.proposal?.commands[0]?.actor, "llm");

const chatOnlyResult = normalizeAgentChatResponse({
  reply: "No chart command is needed.",
  title: "Chat only",
  summary: "No proposal",
  rationale: "The assistant answered without a chart action.",
  insights: [],
  commands: []
}, target("panel-a", documentA.id));
assert.equal(chatOnlyResult.reply, "No chart command is needed.");
assert.equal(chatOnlyResult.proposal, undefined);

const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf-8");
assert.match(appSource, /requestAgentAnalysis/);
assert.match(appSource, /resolveAgentLayoutCommand/);
assert.match(appSource, /isLikelyLayoutCommand/);
assert.match(appSource, /layoutResolutionMessage/);
assert.match(appSource, /chartCommandMode/);
assert.match(appSource, /login\(\)/);
assert.match(appSource, /showChart/);
assert.ok(appSource.indexOf("resolveAgentLayoutCommand") < appSource.indexOf("Agent가 분석을 시작했습니다."));

const bottomCommandBarSource = readFileSync(fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)), "utf-8");
assert.match(bottomCommandBarSource, /로그인\/프로필/);
assert.match(bottomCommandBarSource, /chart-agent-dev-toggle/);
assert.match(bottomCommandBarSource, /PortfolioHoldingsPanel/);
assert.match(bottomCommandBarSource, /알림설정/);

const agentAnalysisClientSource = readFileSync(fileURLToPath(new URL("../src/agent/agentAnalysisClient.ts", import.meta.url)), "utf-8");
assert.match(agentAnalysisClientSource, /\/api\/agents\/analyze/);
assert.match(agentAnalysisClientSource, /\/api\/agents\/layout\/resolve/);
assert.match(agentAnalysisClientSource, /\/api\/agents\/entities\/resolve/);
assert.match(agentAnalysisClientSource, /EventSource/);
assert.doesNotMatch(agentAnalysisClientSource, /\/api\/llm\/chat/);

const newsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/NewsPanel.tsx", import.meta.url)), "utf-8");
assert.match(newsPanelSource, /\/api\/market\/news\/latest/);
assert.match(newsPanelSource, /impactDirection/);

const panelContentRendererSource = readFileSync(fileURLToPath(new URL("../src/components/PanelContentRenderer.tsx", import.meta.url)), "utf-8");
assert.match(panelContentRendererSource, /NewsPanel/);
assert.match(panelContentRendererSource, /OrderTicket/);
assert.match(panelContentRendererSource, /PortfolioHoldingsPanel/);
assert.doesNotMatch(panelContentRendererSource, /workspace-panel-empty/);

const panelLayoutSource = readFileSync(fileURLToPath(new URL("../src/layout/panelLayout.ts", import.meta.url)), "utf-8");
assert.match(panelLayoutSource, /slot-trade/);
assert.match(panelLayoutSource, /trade: "주문"/);

const chartShortcutResolve = normalizeAgentEntityResolveResponse({
  status: "confirmed",
  chartShortcut: true,
  symbol: "NVDA",
  canonicalName: "NVIDIA Corporation",
  matchedText: "엔비디아",
  matchedAlias: "엔비디아",
  confidence: 0.98,
  entityType: "company",
  reason: "matched exact catalog alias"
});
assert.equal(chartShortcutResolve.status, "confirmed");
assert.equal(chartShortcutResolve.chartShortcut, true);
assert.equal(chartShortcutResolve.symbol, "NVDA");
assert.equal(chartShortcutResolve.canonicalName, "NVIDIA Corporation");
assert.equal(chartShortcutResolve.confidence, 0.98);

const unsupportedChartShortcutResolve = normalizeAgentEntityResolveResponse({ status: "confirmed", chartShortcut: false });
assert.equal(unsupportedChartShortcutResolve.status, "confirmed");
assert.equal(unsupportedChartShortcutResolve.chartShortcut, false);

const invalidChartShortcutResolve = normalizeAgentEntityResolveResponse({ status: "mystery", chartShortcut: true, symbol: "" });
assert.equal(invalidChartShortcutResolve.status, "unsupported");
assert.equal(invalidChartShortcutResolve.chartShortcut, true);

const layoutResolve = normalizeAgentLayoutResolveResponse({
  status: "ui_layout",
  summary: "변경했습니다.",
  route: { source: "ui-parser", intentType: "ui-layout", selectedRoles: [] },
  layoutProposal: {
    id: "layout-proposal-ui",
    title: "UI layout request",
    rationale: "Arranged ontology.",
    autoApply: true,
    panelPriorities: [],
    commands: [
      makeLayoutCommand("layout.panel.priority.set", "llm", { panelId: "slot-ontology", layoutWeight: 100 })
    ],
    createdAt: "2026-06-29T00:00:00.000Z"
  },
  agentTrace: { uiLayoutFastAck: true }
});
assert.equal(layoutResolve.status, "ui_layout");
assert.equal(layoutResolve.summary, "변경했습니다.");
assert.equal(layoutResolve.route?.intentType, "ui-layout");
assert.equal(layoutResolve.layoutProposal?.commands[0]?.type, "layout.panel.priority.set");

const invalidLayoutResolve = normalizeAgentLayoutResolveResponse({ status: "mystery", layoutProposal: null });
assert.equal(invalidLayoutResolve.status, "failed");
assert.equal(invalidLayoutResolve.layoutProposal, null);

const agentAnalysisRequest = buildAgentAnalysisRequest({
  messages: [{ id: "message-1", role: "user", content: "NVDA 급등 원인 알려줘", createdAt: "2026-06-29T00:00:00.000Z" }],
  symbol: "NVDA",
  intent: "NVDA 급등 원인 알려줘",
  chartContext: { chartDocument: { symbol: "NVDA", timeframe: "1m" } }
});
assert.deepEqual(agentAnalysisRequest, {
  messages: [{ role: "user", content: "NVDA 급등 원인 알려줘" }],
  symbol: "NVDA",
  intent: "NVDA 급등 원인 알려줘",
  chartContext: { chartDocument: { symbol: "NVDA", timeframe: "1m" } },
  routerMode: "hybrid",
  analysisMode: "auto",
  agentIds: []
});

const agentAnalysisMultiAgentRequest = buildAgentAnalysisRequest({
  messages: [{ role: "user", content: "NVDA 뉴스랑 차트 각각 분석해줘" }],
  symbol: "NVDA",
  intent: "NVDA 뉴스랑 차트 각각 분석해줘",
  chartContext: { chartDocument: { symbol: "NVDA", timeframe: "1m" } },
  analysisMode: "multi_agent",
  agentIds: ["agent-01", "agent-02"]
});
assert.equal(agentAnalysisMultiAgentRequest.analysisMode, "multi_agent");
assert.deepEqual(agentAnalysisMultiAgentRequest.agentIds, ["agent-01", "agent-02"]);

const agentLayoutContext = buildAgentLayoutContext(createPresetLayout("chart"));
const agentLayoutOrderPanel = (agentLayoutContext as { panels: Array<Record<string, unknown>> }).panels.find((panel) => panel.type === "orderTicket");
assert.equal(agentLayoutOrderPanel?.title, "주문");
assert.deepEqual(agentLayoutOrderPanel?.minSpan, { colSpan: 1, rowSpan: 2 });
assert.deepEqual(agentLayoutOrderPanel?.maxSpan, { colSpan: 4, rowSpan: 5 });
assert.equal(Array.isArray(agentLayoutOrderPanel?.aliases), true);
const agentLayoutPortfolioPanel = (agentLayoutContext as { panels: Array<Record<string, unknown>> }).panels.find((panel) => panel.type === "portfolioHoldings");
assert.equal(agentLayoutPortfolioPanel?.title, "내 투자");
assert.deepEqual(agentLayoutPortfolioPanel?.minSpan, { colSpan: 1, rowSpan: 2 });
assert.equal((agentLayoutPortfolioPanel?.aliases as string[] | undefined)?.includes("보유종목"), true);

const parsedHoldings = await parsePortfolioHoldingsApiResponse(fakeApiResponse({
  ok: true,
  status: 200,
  body: JSON.stringify({
    status: "ok",
    account: { market: "overseas", currency: "USD" },
    positions: [{ symbol: "MU" }]
  })
}));
assert.equal(parsedHoldings.positions[0]?.symbol, "MU");
await assert.rejects(
  () => parsePortfolioHoldingsApiResponse(fakeApiResponse({ ok: false, status: 503, body: "" })),
  /보유종목 API 오류 503/
);
await assert.rejects(
  () => parsePortfolioHoldingsApiResponse(fakeApiResponse({ ok: true, status: 200, body: "" })),
  /보유종목 API 응답이 비어 있습니다/
);

const agentAnalysisRequestWithLayout = buildAgentAnalysisRequest({
  messages: [{ role: "user", content: "뉴스 보여줘" }],
  symbol: "NVDA",
  intent: "뉴스 보여줘",
  chartContext: {},
  layoutContext: agentLayoutContext
});
assert.deepEqual((agentAnalysisRequestWithLayout as { layoutContext?: unknown }).layoutContext, agentLayoutContext);

const agentAnalysisReport = normalizeAgentAnalysisReport({
  analysisId: "analysis-1",
  symbol: "NVDA",
  status: "completed",
  summary: "NVDA has a watch price_surge signal.",
  route: {
    source: "rule",
    intentType: "market-move",
    selectedRoles: ["chart", "news"],
    confidence: 0.9,
    reason: "Matched intent keyword."
  },
  finalAnswer: {
    title: "NVDA 주가 변동 원인 분석",
    summary: "차트, 뉴스, 기업 관계 근거를 종합해 NVDA의 변동 원인을 정리했습니다.",
    sections: [{ title: "확인된 근거", bullets: ["Headline: News summary"] }],
    citations: [
      { provider: "news", title: "Headline", url: "https://example.com/news" },
      { provider: "ontology", title: "URL 없는 온톨로지 근거" }
    ],
    limitations: ["Macro provider not configured."]
  },
  findings: [
    { agentId: "chart-agent", role: "chart-analysis", summary: "Chart shows a visible breakout.", evidence: [] },
    { agentId: "news-agent", role: "news-analysis", summary: "news evidence not configured for NVDA.", evidence: [{ provider: "news", status: "no-data", summary: "News provider is not configured." }] },
    { agentId: "verification-guardrail-agent", role: "verification-guardrail", summary: "No trading-action guardrail violation detected.", evidence: [] }
  ],
  providerEvidence: [
    { provider: "news", status: "no-data", summary: "News provider is not configured." },
    { provider: "macro", status: "no-data", summary: "Macro provider is not configured." },
    {
      provider: "ontology",
      status: "no-data",
      summary: "GraphDB에서 NVDA의 직접 지배/자회사 관계 근거는 확인되지 않았습니다.",
      raw: { relationType: "no-direct-control" }
    }
  ],
  timing: {
    totalMs: 1120,
    cacheHit: true,
    cacheLayer: "analysis",
    newsFetchMs: 180,
    roleAnalysisMs: 820,
    finalAnswerMs: 120
  }
});
assert.equal(agentAnalysisReport.notificationDecision, null);
assert.equal(agentAnalysisReport.layoutProposal, null);
const agentAnalysisMessage = formatAgentAnalysisReport(agentAnalysisReport);
assert.match(agentAnalysisMessage, /NVDA 주가 변동 원인 분석/);
assert.match(agentAnalysisMessage, /차트, 뉴스, 기업 관계 근거를 종합/);
assert.match(agentAnalysisMessage, /Headline: News summary/);
assert.doesNotMatch(agentAnalysisMessage, /Agent findings:/);
assert.doesNotMatch(agentAnalysisMessage, /Chart Agent: Chart shows a visible breakout\./);
assert.match(agentAnalysisMessage, /뉴스 provider 미연결: News provider is not configured\./);
assert.match(agentAnalysisMessage, /거시 provider 미연결: Macro provider is not configured\./);
assert.match(agentAnalysisMessage, /확인되지 않은 내용:/);
assert.match(agentAnalysisMessage, /직접 지배\/자회사 관계 근거는 확인되지 않았습니다/);
assert.doesNotMatch(agentAnalysisMessage, /알림 판단:/);
assert.doesNotMatch(agentAnalysisMessage, /검증 결과: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /검증 경고: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /URL 없는 온톨로지 근거/);
assert.doesNotMatch(agentAnalysisMessage, /verification-guardrail:/);
assert.match(agentAnalysisMessage, /검색 0\.2초 \/ 전체 1\.1초/);
assert.doesNotMatch(agentAnalysisMessage, /캐시 사용/);
assert.throws(
  () => normalizeAgentAnalysisReport({ findings: [] }),
  /멀티에이전트 분석 응답 형식이 올바르지 않습니다\./
);

const compactNewsReport = normalizeAgentAnalysisReport({
  analysisId: "analysis-news-compact",
  symbol: "AAPL",
  status: "completed",
  summary: "뉴스를 가져왔습니다.",
  route: {
    source: "rule",
    intentType: "news",
    selectedRoles: ["news"],
    confidence: 0.9,
    reason: "News request."
  },
  finalAnswer: {
    title: "뉴스를 가져왔습니다",
    summary: "AAPL 관련 뉴스 1건을 가져왔습니다.",
    sections: [{ title: "핵심 뉴스", bullets: ["애플 서비스 성장: 서비스 매출이 개선됐습니다."] }],
    citations: [{ provider: "news", title: "애플 서비스 성장", url: "https://example.com/aapl" }],
    limitations: ["뉴스 provider에 저장된 기사 기준입니다."]
  },
  findings: [],
  providerEvidence: [{ provider: "news", status: "no-data", summary: "AAPL 관련 저장 뉴스가 없습니다." }],
  timing: { totalMs: 100, newsFetchMs: 10 }
});
const compactNewsMessage = formatAgentAnalysisReport(compactNewsReport);
assert.match(compactNewsMessage, /뉴스를 가져왔습니다/);
assert.match(compactNewsMessage, /애플 서비스 성장/);
assert.doesNotMatch(compactNewsMessage, /근거 링크/);
assert.doesNotMatch(compactNewsMessage, /제한 사항/);
assert.doesNotMatch(compactNewsMessage, /Provider status/);
assert.doesNotMatch(compactNewsMessage, /검색/);
assert.doesNotMatch(compactNewsMessage, /https:\/\/example\.com\/aapl/);

const agentNewsPanelReport = normalizeAgentAnalysisReport({
  analysisId: "analysis-news-panel",
  symbol: "NVDA",
  status: "completed",
  summary: "NVDA 뉴스 분석 완료",
  findings: [],
  providerEvidence: [],
  layoutProposal: {
    title: "Agent analysis workspace",
    rationale: "Show news panel.",
    commands: [
      {
        type: "layout.panel.add",
        payload: {
          panelType: "newsFeed",
          props: {
            symbol: "NVDA",
            dailySummaries: [
              {
                date: "2026-07-01",
                symbol: "NVDA",
                summary: "엔비디아 일일 뉴스 요약입니다.",
                keyPoints: ["AI 수요"],
                positivePoints: ["데이터센터 성장"],
                concerns: [],
                impactDirection: "positive",
                articleIds: ["nvda-daily-1"],
                articleCount: 1,
                mentionCount: 0,
                status: "final"
              }
            ],
            latestNews: [
              {
                title: "NVDA shares rise after earnings",
                summary: "Revenue beat expectations.",
                url: "https://example.com/nvda",
                source: "alpaca",
                publishedAt: "2026-06-30T01:02:03.000Z",
                symbol: "NVDA",
                symbols: ["NVDA"],
                eventType: "earnings",
                impactDirection: "positive",
                relevanceScore: 1,
                importanceScore: 0.95
              }
            ],
            majorNews: []
          }
        }
      }
    ]
  }
});
assert.equal(agentNewsPanelReport.layoutProposal?.commands[0]?.payload.panelType, "newsFeed");
assert.equal(shouldAutoApplyAgentLayoutProposal(agentNewsPanelReport, "auto"), true);
assert.equal(shouldAutoApplyAgentLayoutProposal(agentNewsPanelReport, "multi_agent"), false);
assert.equal(
  ((agentNewsPanelReport.layoutProposal?.commands[0]?.payload.props as Record<string, unknown>)?.latestNews as unknown[])?.length,
  1
);
assert.equal(agentNewsPanelReport.dailySummaries.length, 0);
assert.equal(
  ((agentNewsPanelReport.layoutProposal?.commands[0]?.payload.props as Record<string, unknown>)?.dailySummaries as unknown[])?.length,
  1
);

const agentNewsPanelUpdateReport = normalizeAgentAnalysisReport({
  analysisId: "analysis-news-panel-update",
  symbol: "NVDA",
  status: "completed",
  summary: "NVDA 뉴스 분석 완료",
  findings: [],
  providerEvidence: [],
  layoutProposal: {
    title: "Agent analysis workspace",
    rationale: "Update existing news panel.",
    commands: [
      {
        type: "layout.panel.props.update",
        target: { panelId: "panel-news" },
        payload: {
          panelId: "panel-news",
          props: {
            symbol: "NVDA",
            latestNews: [
              {
                title: "NVDA shares rise after earnings",
                symbols: ["NVDA"],
                impactDirection: "positive"
              }
            ],
            majorNews: []
          }
        }
      }
    ]
  }
});
assert.equal(agentNewsPanelUpdateReport.layoutProposal?.commands[0]?.type, "layout.panel.props.update");

const newsPropsPanel = testPanel("news-props", "newsFeed", testPlacement(2, 2, 2, 2));
const newsPropsState = executeLayoutCommand(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([newsPropsPanel]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  makeLayoutCommand("layout.panel.props.update", "system", {
    panelId: newsPropsPanel.id,
    props: {
      latestNews: [{ title: "NVDA shares rise", symbols: ["NVDA"], impactDirection: "positive" }],
      majorNews: []
    }
  })
);
assert.equal((newsPropsState.layout.panels[0]?.props.latestNews as unknown[])?.length, 1);
assert.equal(newsPropsState.history.length, 0);

const newsProposalPanel = testPanel("panel-news", "newsFeed", testPlacement(2, 2, 2, 2));
const newsProposalState = applyLayoutProposal(
  {
    ...createInitialLayoutRuntimeState(),
    layout: testLayout([newsProposalPanel]),
    history: [],
    future: [],
    journal: [],
    errors: []
  },
  agentNewsPanelUpdateReport.layoutProposal!
);
assert.equal((newsProposalState.layout.panels[0]?.props.latestNews as unknown[])?.length, 1);
assert.equal(newsProposalState.errors.length, 0);

assert.deepEqual(getChartAgentAccess([{ id: "agent-01" }]), { enabled: true, reason: "agent-01" });
assert.deepEqual(getChartAgentAccess([{ id: "agent-02" }]), { enabled: false, reason: "no-chart-agent" });
assert.deepEqual(getChartAgentAccess([{ id: "agent-01" }, { id: "agent-02" }]), { enabled: false, reason: "orchestration" });

const anchorA = { timestamp: candleA.timestamp, price: 10.4, paneId: "price", symbol: "AAPL", logicalIndex: 0 };
const anchorB = { timestamp: candleB.timestamp, price: 11.1, paneId: "price", symbol: "AAPL", logicalIndex: 1 };
const projectedRay = projectTrendLine({ x: 20, y: 80 }, { x: 40, y: 60 }, { left: 0, right: 100, top: 0, priceBottom: 100 }, "ray");
assert.deepEqual(projectedRay, [{ x: 20, y: 80 }, { x: 100, y: 0 }]);
const projectedLine = projectTrendLine({ x: 20, y: 80 }, { x: 40, y: 60 }, { left: 0, right: 100, top: 0, priceBottom: 100 }, "line");
assert.deepEqual(projectedLine, [{ x: 0, y: 100 }, { x: 100, y: 0 }]);

const trendLineResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.drawing.add", "user", target("panel-a", documentA.id), {
    drawingType: "trendLine",
    anchors: [anchorA, anchorB],
    style: { color: "#111111", lineWidth: 1.5, extension: "ray" },
    label: "Trend ray"
  })
);
assert.equal(trendLineResult.ok, true);
if (trendLineResult.ok) {
  assert.equal(trendLineResult.document.drawings[0]?.style.extension, "ray");
}

const trendToolResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.drawing.clearSelection", "system", target("panel-a", documentA.id), {
    mode: "draw-trendLine",
    trendLineExtension: "line"
  })
);
assert.equal(trendToolResult.ok, true);
if (trendToolResult.ok) {
  assert.equal(trendToolResult.document.interactionState.mode, "draw-trendLine");
  assert.equal(trendToolResult.document.interactionState.trendLineExtension, "line");
}

const regressionPanelA = createPanelInstance(
  "chart",
  testPlacement(1, 1, 2, 3),
  "system",
  { symbol: "AAPL" },
  "regression-chart-a"
);
const regressionPanelB = createPanelInstance(
  "chart",
  testPlacement(3, 1, 1, 3),
  "system",
  { symbol: "TSLA" },
  "regression-chart-b"
);
const regressionNewsPanel = createPanelInstance(
  "newsFeed",
  testPlacement(4, 1, 1, 1),
  "system",
  {},
  "regression-news"
);
const regressionLayout = testLayout([regressionPanelA, regressionPanelB, regressionNewsPanel], regressionPanelB.id);
const regressionDocAId = regressionPanelA.chartDocumentId ?? "";
const regressionDocBId = regressionPanelB.chartDocumentId ?? "";
assert.ok(regressionDocAId);
assert.ok(regressionDocBId);
assert.notEqual(regressionDocAId, regressionDocBId);

let regressionRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: regressionLayout.panels
});
assert.equal(regressionRuntime.documents[regressionDocAId]?.symbol, "AAPL");
assert.equal(regressionRuntime.documents[regressionDocBId]?.symbol, "TSLA");

assert.equal(findTargetChartPanel(regressionLayout.panels, regressionPanelB.id)?.id, regressionPanelB.id);
assert.equal(findTargetChartPanel(regressionLayout.panels, regressionNewsPanel.id)?.id, regressionPanelA.id);
assert.equal(findTargetChartPanel({ ...regressionLayout, selectedPanelId: undefined }.panels, undefined)?.id, regressionPanelA.id);
assert.equal(resolveAgentChartReference(regressionLayout.panels, regressionRuntime, undefined), null);
const referenceToA = { panelId: regressionPanelA.id, chartDocumentId: regressionDocAId, draftSeed: DEFAULT_AGENT_DRAFT_SEED };
const resolvedReferenceToA = resolveAgentChartReference(regressionLayout.panels, regressionRuntime, referenceToA);
assert.equal(resolvedReferenceToA?.panel.id, regressionPanelA.id);
assert.equal(resolvedReferenceToA?.document.id, regressionDocAId);
assert.equal(resolveAgentChartReference(regressionLayout.panels, regressionRuntime, {
  panelId: regressionNewsPanel.id,
  chartDocumentId: regressionDocAId
}), null);
assert.equal(isAgentChartReferenceAvailable(regressionLayout.panels, referenceToA), true);
assert.equal(isAgentChartReferenceAvailable(regressionLayout.panels.filter((panel) => panel.id !== regressionPanelA.id), referenceToA), false);
assert.equal(resolveAgentSendContent("", DEFAULT_AGENT_DRAFT_SEED), DEFAULT_AGENT_DRAFT_SEED);
assert.equal(resolveAgentSendContent("  MSFT도 비교해줘  ", DEFAULT_AGENT_DRAFT_SEED), "MSFT도 비교해줘");

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.symbol.set", "user", target(regressionPanelB.id, regressionDocBId), { symbol: "MSFT" }, undefined, "external")
});
assert.equal(regressionRuntime.documents[regressionDocAId]?.symbol, "AAPL");
assert.equal(regressionRuntime.documents[regressionDocBId]?.symbol, "MSFT");
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, { rightOffset: 0, visibleCount: defaultVisibleBarsForInterval("1m") });
assert.equal(regressionRuntime.documents[regressionDocAId]?.history.length, 0);
assert.equal(regressionRuntime.documents[regressionDocBId]?.history.length, 0);

const beforeViewportB = regressionRuntime.documents[regressionDocBId]?.viewport;
regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.viewport.set", "user", target(regressionPanelA.id, regressionDocAId), {
    visibleCount: 36,
    rightOffset: 7
  })
});
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, { visibleCount: 36, rightOffset: 7 });
assert.deepEqual(regressionRuntime.documents[regressionDocBId]?.viewport, beforeViewportB);
assert.equal(regressionRuntime.documents[regressionDocAId]?.history.length, 1);
assert.equal(regressionRuntime.documents[regressionDocBId]?.history.length, 0);

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.undo", "user", target(regressionPanelA.id, regressionDocAId))
});
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, { rightOffset: 0, visibleCount: defaultVisibleBarsForInterval("1m") });
assert.deepEqual(regressionRuntime.documents[regressionDocBId]?.viewport, beforeViewportB);
assert.equal(regressionRuntime.documents[regressionDocAId]?.future.length, 1);
assert.equal(regressionRuntime.documents[regressionDocBId]?.future.length, 0);

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.redo", "user", target(regressionPanelA.id, regressionDocAId))
});
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, { visibleCount: 36, rightOffset: 7 });
assert.deepEqual(regressionRuntime.documents[regressionDocBId]?.viewport, beforeViewportB);

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.comparison.add", "user", target(regressionPanelA.id, regressionDocAId), {
    comparison: {
      id: "comparison-msft-regression",
      symbol: "MSFT",
      label: "MSFT",
      scaleMode: "percent",
      base: { mode: "visibleRangeStart" },
      style: { color: "#2563eb" }
    }
  })
});
assert.equal(regressionRuntime.documents[regressionDocAId]?.comparisons.length, 1);
assert.equal(regressionRuntime.documents[regressionDocBId]?.comparisons.length, 0);

const regressionPreviewProposal: ChartProposal = {
  id: "proposal-regression-preview-a",
  title: "Regression preview A",
  rationale: "Preview should stay on chart A.",
  summary: "Preview isolation",
  target: target(regressionPanelA.id, regressionDocAId),
  commands: [
    makeChartCommand("chart.drawing.add", "llm", target(regressionPanelA.id, regressionDocAId), {
      drawingType: "horizontalLine",
      anchors: [anchorA],
      style: { color: "#111111" },
      label: "Chart A preview"
    }, "proposal-regression-preview-a")
  ],
  insights: [],
  status: "pending",
  createdAt: new Date().toISOString(),
  createdByAgentId: "agent-01"
};
regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.proposal.received",
  proposal: regressionPreviewProposal,
  autoApply: true
});
assert.equal(regressionRuntime.pendingPreviewByDocumentId[regressionDocAId]?.drawings.length, 1);
assert.equal(regressionRuntime.pendingPreviewByDocumentId[regressionDocBId], undefined);
assert.equal(regressionRuntime.documents[regressionDocAId]?.drawings.length, 0);
assert.equal(regressionRuntime.documents[regressionDocBId]?.drawings.length, 0);

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.toggle", "user", target(regressionPanelA.id, regressionDocAId), { previewVisible: false })
});
assert.equal(regressionRuntime.pendingPreviewByDocumentId[regressionDocAId]?.visible, false);
assert.equal(regressionRuntime.pendingPreviewByDocumentId[regressionDocBId], undefined);
regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.toggle", "user", target(regressionPanelA.id, regressionDocAId), { previewVisible: true })
});
regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.apply", "user", target(regressionPanelA.id, regressionDocAId))
});
assert.equal(regressionRuntime.pendingPreviewByDocumentId[regressionDocAId], undefined);
assert.equal(regressionRuntime.documents[regressionDocAId]?.drawings.length, 1);
assert.equal(regressionRuntime.documents[regressionDocBId]?.drawings.length, 0);

const regressionPendingProposalB: ChartProposal = {
  id: "proposal-regression-b",
  title: "Regression non-preview B",
  rationale: "Pending proposal should stay on chart B.",
  summary: "Pending isolation",
  target: target(regressionPanelB.id, regressionDocBId),
  commands: [
    makeChartCommand("chart.viewport.set", "llm", target(regressionPanelB.id, regressionDocBId), {
      visibleCount: 48,
      rightOffset: 2
    }, "proposal-regression-b")
  ],
  insights: [],
  status: "pending",
  createdAt: new Date().toISOString(),
  createdByAgentId: "agent-01"
};
regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.proposal.received",
  proposal: regressionPendingProposalB,
  autoApply: false
});
assert.equal(regressionRuntime.pendingProposals.length, 1);
assert.equal(regressionRuntime.pendingProposals[0]?.target.chartDocumentId, regressionDocBId);
assert.deepEqual(regressionRuntime.documents[regressionDocBId]?.viewport, beforeViewportB);

const regressionLayoutState = {
  ...createInitialLayoutRuntimeState(),
  layout: regressionLayout,
  history: [],
  future: [],
  journal: [],
  errors: []
};
const movedLayoutState = executeLayoutCommand(
  regressionLayoutState,
  makeLayoutCommand("layout.panel.move", "user", {
    panelId: regressionNewsPanel.id,
    placement: testPlacement(4, 2, 1, 1)
  }, { panelId: regressionNewsPanel.id, group: "workspace", zone: "context" })
);
assert.equal(movedLayoutState.history.length, 1);
assert.equal(regressionRuntime.documents[regressionDocAId]?.history.length, 3);
assert.equal(regressionRuntime.documents[regressionDocBId]?.history.length, 0);
const undoneLayoutState = executeLayoutCommand(movedLayoutState, makeLayoutCommand("layout.undo", "user"));
assert.equal(undoneLayoutState.layout.panels.find((panel) => panel.id === regressionNewsPanel.id)?.placement.row, 1);
assert.equal(regressionRuntime.documents[regressionDocAId]?.drawings.length, 1);
assert.equal(regressionRuntime.documents[regressionDocBId]?.comparisons.length, 0);

regressionRuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.set", "user", target(regressionPanelB.id, regressionDocBId), {
    preview: {
      id: "preview-regression-b",
      drawings: [{
        id: "preview-drawing-b",
        type: "horizontalLine",
        anchors: [{ ...anchorA, symbol: "MSFT" }],
        style: { color: "#8a1f1f" },
        label: "Chart B preview",
        createdAt: new Date().toISOString(),
        createdBy: "llm"
      }],
      comparisons: [],
      visible: true
    }
  })
});
regressionRuntime = {
  ...regressionRuntime,
  errors: [
    { id: "regression-error-a", message: "Chart A error", chartDocumentId: regressionDocAId, createdAt: "2026-06-26T00:00:00.000Z" },
    { id: "regression-error-b", message: "Chart B error", chartDocumentId: regressionDocBId, createdAt: "2026-06-26T00:00:00.000Z" },
    { id: "regression-error-global", message: "Global chart error", createdAt: "2026-06-26T00:00:00.000Z" }
  ]
};
const removedChartARuntime = chartRuntimeReducer(regressionRuntime, {
  kind: "chart.ensureDocuments",
  panels: regressionLayout.panels.filter((panel) => panel.id !== regressionPanelA.id)
});
assert.equal(removedChartARuntime.documents[regressionDocAId], undefined);
assert.ok(removedChartARuntime.documents[regressionDocBId]);
assert.equal(removedChartARuntime.pendingPreviewByDocumentId[regressionDocBId]?.id, "preview-regression-b");
assert.equal(removedChartARuntime.pendingProposals.length, 1);
assert.equal(removedChartARuntime.pendingProposals[0]?.target.chartDocumentId, regressionDocBId);
assert.equal(removedChartARuntime.errors.some((error) => error.chartDocumentId === regressionDocAId), false);
assert.equal(removedChartARuntime.errors.some((error) => error.chartDocumentId === regressionDocBId), true);
assert.equal(removedChartARuntime.errors.some((error) => error.id === "regression-error-global"), true);

const drawingAddResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.drawing.add", "user", target("panel-a", documentA.id), {
    drawingType: "horizontalLine",
    anchors: [anchorA],
    style: { color: "#111111" },
    label: "Support"
  })
);
assert.equal(drawingAddResult.ok, true);
if (drawingAddResult.ok) {
  assert.equal(drawingAddResult.document.drawings.length, 1);
  assert.equal(drawingAddResult.document.history.length, 1);
  const drawingId = drawingAddResult.document.drawings[0]?.id ?? "";
  const removeResult = executeChartCommand(
    drawingAddResult.document,
    makeChartCommand("chart.drawing.remove", "user", target("panel-a", documentA.id), { drawingId })
  );
  assert.equal(removeResult.ok, true);
  if (removeResult.ok) {
    assert.equal(removeResult.document.drawings.length, 0);
    assert.equal(removeResult.document.history.length, 2);
    const undoDrawing = executeChartCommand(removeResult.document, makeChartCommand("chart.undo", "user", target("panel-a", documentA.id)));
    assert.equal(undoDrawing.ok, true);
    if (undoDrawing.ok) {
      assert.equal(undoDrawing.document.drawings.length, 1);
    }
  }
}

const scopedUndoDocument = createChartDocument("chart-doc-scoped-undo", "AAPL", "1m");
const scopedAdd = executeChartCommand(
  scopedUndoDocument,
  makeChartCommand("chart.drawing.add", "user", target("panel-scoped", scopedUndoDocument.id), {
    drawingType: "horizontalLine",
    anchors: [anchorA],
    style: { color: "#111111" },
    label: "Scoped support"
  }, undefined, "chartPanel")
);
assert.equal(scopedAdd.ok, true);
if (scopedAdd.ok) {
  const externalSymbol = executeChartCommand(
    scopedAdd.document,
    makeChartCommand("chart.symbol.set", "user", target("panel-scoped", scopedUndoDocument.id), { symbol: "NVDA" }, undefined, "external")
  );
  assert.equal(externalSymbol.ok, true);
  if (externalSymbol.ok) {
    assert.equal(externalSymbol.document.symbol, "NVDA");
    assert.equal(externalSymbol.document.history.length, 1);
    const scopedUndo = executeChartCommand(
      externalSymbol.document,
      makeChartCommand("chart.undo", "user", target("panel-scoped", scopedUndoDocument.id))
    );
    assert.equal(scopedUndo.ok, true);
    if (scopedUndo.ok) {
      assert.equal(scopedUndo.document.symbol, "NVDA");
      assert.equal(scopedUndo.document.drawings.length, 0);
    }
  }
}

const clearAllDocument = createChartDocument("chart-doc-clear-all", "AAPL", "1m");
const firstDrawing = makeChartCommand("chart.drawing.add", "user", target("panel-clear", clearAllDocument.id), {
  drawingType: "horizontalLine",
  anchors: [anchorA],
  style: { color: "#111111" },
  label: "Level A"
});
const secondDrawing = makeChartCommand("chart.drawing.add", "user", target("panel-clear", clearAllDocument.id), {
  drawingType: "verticalMarker",
  anchors: [{ timestamp: candleB.timestamp, price: 10.8, paneId: "price", symbol: "AAPL", logicalIndex: 1 }],
  style: { color: "#dc2626" },
  label: "Event B"
});
const seededDrawings = executeChartCommandGroup(clearAllDocument, [firstDrawing, secondDrawing], "Seed drawings");
assert.equal(seededDrawings.ok, true);
if (seededDrawings.ok) {
  assert.equal(seededDrawings.document.drawings.length, 2);
  const removeCommands = seededDrawings.document.drawings.map((drawing) =>
    makeChartCommand("chart.drawing.remove", "user", target("panel-clear", clearAllDocument.id), { drawingId: drawing.id })
  );
  const clearResult = executeChartCommandGroup(seededDrawings.document, removeCommands, "Clear all drawings");
  assert.equal(clearResult.ok, true);
  if (clearResult.ok) {
    assert.equal(clearResult.document.drawings.length, 0);
    assert.equal(clearResult.document.history.length, 2);
    const undoClear = executeChartCommand(clearResult.document, makeChartCommand("chart.undo", "user", target("panel-clear", clearAllDocument.id)));
    assert.equal(undoClear.ok, true);
    if (undoClear.ok) {
      assert.equal(undoClear.document.drawings.length, 2);
    }
  }
}

const isolatedDrawingResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.drawing.add", "user", target("panel-b", documentB.id), {
    drawingType: "verticalMarker",
    anchors: [{ timestamp: candleB.timestamp, price: 10.8, paneId: "price", symbol: "MSFT", logicalIndex: 1 }],
    style: { color: "#dc2626" },
    label: "MSFT event"
  })
);
assert.equal(isolatedDrawingResult.ok, true);
if (isolatedDrawingResult.ok && drawingAddResult.ok) {
  assert.equal(isolatedDrawingResult.document.drawings.length, 1);
  assert.equal(isolatedDrawingResult.document.history.length, 1);
  assert.equal(drawingAddResult.document.drawings.length, 1);
  assert.equal(drawingAddResult.document.drawings[0]?.label, "Support");
  assert.notEqual(isolatedDrawingResult.document.id, drawingAddResult.document.id);
}

const priceOnlyHorizontalLineResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.drawing.add", "llm", target("panel-a", documentA.id), {
    drawingType: "horizontalLine",
    anchors: [{ timestamp: null, price: 141.2, paneId: "price", symbol: "AAPL", logicalIndex: null, value: null }],
    style: { color: "#3b82f6", fillColor: null, lineWidth: 2, textColor: null, lineDash: [] },
    label: "Last 141.20",
    comparison: null,
    comparisonId: null
  })
);
assert.equal(priceOnlyHorizontalLineResult.ok, true);

const comparisonResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.comparison.add", "user", target("panel-a", documentA.id), {
    comparison: {
      id: "comparison-spy-test",
      symbol: "SPY",
      label: "SPY",
      scaleMode: "percent",
      base: { mode: "visibleRangeStart" },
      style: { color: "#0f766e" }
    }
  })
);
assert.equal(comparisonResult.ok, true);
if (comparisonResult.ok) {
  assert.equal(comparisonResult.document.comparisons.length, 1);
}

const nvdaComparisonResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.comparison.add", "user", target("panel-a", documentA.id), {
    comparison: {
      id: "comparison-nvda-test",
      symbol: "NVDA",
      label: "NVDA",
      scaleMode: "percent",
      base: { mode: "visibleRangeStart" },
      style: { color: "#16a34a" }
    }
  })
);
assert.equal(nvdaComparisonResult.ok, true);

const unsupportedComparisonResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.comparison.add", "user", target("panel-a", documentA.id), {
    comparison: {
      id: "comparison-unsupported-test",
      symbol: "BAD!",
      label: "BAD!",
      scaleMode: "percent",
      base: { mode: "visibleRangeStart" },
      style: { color: "#111111" }
    }
  })
);
assert.equal(unsupportedComparisonResult.ok, false);

const sceneForAnchor = buildRenderScene({
  state: "ready",
  document: documentA,
  candles: [candleA, candleB],
  width: 640,
  height: 360,
  comparisonCandlesBySymbol: {
    SPY: [
      { ...candleA, close: 20, open: 20, high: 21, low: 19 },
      { ...candleB, close: 22, open: 20, high: 23, low: 19 }
    ]
  }
});
const transform = createCoordinateTransform(sceneForAnchor);
const anchorPoint = transform.anchorToPoint(anchorA);
assert.ok(anchorPoint);
assert.equal(transform.pointToAnchor(anchorPoint?.x ?? 0, anchorPoint?.y ?? 0, "AAPL")?.timestamp, candleA.timestamp);

const comparisonScene = buildRenderScene({
  state: "ready",
  document: comparisonResult.ok ? comparisonResult.document : documentA,
  candles: [candleA, candleB],
  width: 640,
  height: 360,
  comparisonCandlesBySymbol: {
    SPY: [
      { ...candleA, close: 20, open: 20, high: 21, low: 19 },
      { ...candleB, close: 22, open: 20, high: 23, low: 19 }
    ]
  }
});
assert.equal(comparisonScene.comparisonSeries.length, comparisonResult.ok ? 1 : 0);
assert.equal(comparisonScene.comparisonSeries[0]?.points[1]?.percent, 10);

const previewDocument = createChartDocument("chart-doc-preview", "AAPL", "1m");
let previewState = {
  ...createInitialChartRuntimeState(),
  documents: { [previewDocument.id]: previewDocument }
};
const previewProposal: ChartProposal = {
  id: "proposal-preview",
  title: "Preview drawing",
  rationale: "Show a level before applying.",
  summary: "Preview only",
  target: target("panel-preview", previewDocument.id),
  commands: [
    makeChartCommand("chart.drawing.add", "llm", target("panel-preview", previewDocument.id), {
      drawingType: "horizontalLine",
      anchors: [anchorA],
      style: { color: "#2563eb" },
      label: "Agent level"
    }, "proposal-preview"),
    makeChartCommand("chart.comparison.add", "llm", target("panel-preview", previewDocument.id), {
      comparison: {
        id: "comparison-spy-preview-test",
        symbol: "SPY",
        label: "SPY",
        scaleMode: "percent",
        base: { mode: "visibleRangeStart" },
        style: { color: "#0f766e", lineWidth: 1.5 }
      }
    }, "proposal-preview")
  ],
  insights: [],
  status: "pending",
  createdAt: new Date().toISOString(),
  createdByAgentId: "agent-01"
};
previewState = chartRuntimeReducer(previewState, {
  kind: "chart.proposal.received",
  proposal: previewProposal,
  autoApply: true
});
assert.equal(previewState.documents[previewDocument.id]?.drawings.length, 0);
assert.equal(previewState.pendingPreviewByDocumentId[previewDocument.id]?.drawings.length, 1);
assert.equal(previewState.pendingPreviewByDocumentId[previewDocument.id]?.comparisons.length, 1);
const previewComparisonScene = buildRenderScene({
  state: "ready",
  document: previewDocument,
  candles: [candleA, candleB],
  width: 640,
  height: 360,
  comparisonCandlesBySymbol: {
    SPY: [
      { ...candleA, close: 20, open: 20, high: 21, low: 19 },
      { ...candleB, close: 22, open: 20, high: 23, low: 19 }
    ]
  },
  pendingPreview: previewState.pendingPreviewByDocumentId[previewDocument.id]
});
assert.equal(previewComparisonScene.comparisonSeries.length, 1);
assert.deepEqual(previewComparisonScene.comparisonSeries[0]?.comparison.style.lineDash, [6, 4]);
assert.equal(previewComparisonScene.comparisonSeries[0]?.points[1]?.percent, 10);
previewState = chartRuntimeReducer(previewState, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.toggle", "user", target("panel-preview", previewDocument.id), { previewVisible: false })
});
assert.equal(previewState.pendingPreviewByDocumentId[previewDocument.id]?.visible, false);
const hiddenPreviewComparisonScene = buildRenderScene({
  state: "ready",
  document: previewDocument,
  candles: [candleA, candleB],
  width: 640,
  height: 360,
  comparisonCandlesBySymbol: {
    SPY: [
      { ...candleA, close: 20, open: 20, high: 21, low: 19 },
      { ...candleB, close: 22, open: 20, high: 23, low: 19 }
    ]
  },
  pendingPreview: previewState.pendingPreviewByDocumentId[previewDocument.id]
});
assert.equal(hiddenPreviewComparisonScene.comparisonSeries.length, 0);
previewState = chartRuntimeReducer(previewState, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.apply", "user", target("panel-preview", previewDocument.id))
});
assert.equal(previewState.documents[previewDocument.id]?.drawings.length, 0);
assert.ok(previewState.errors.some((error) => /Hidden chart preview/.test(error.message)));
previewState = chartRuntimeReducer(previewState, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.toggle", "user", target("panel-preview", previewDocument.id), { previewVisible: true })
});
previewState = chartRuntimeReducer(previewState, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.apply", "user", target("panel-preview", previewDocument.id))
});
assert.equal(previewState.pendingPreviewByDocumentId[previewDocument.id], undefined);
assert.equal(previewState.documents[previewDocument.id]?.drawings.length, 1);
assert.equal(previewState.documents[previewDocument.id]?.comparisons.length, 1);
assert.equal(previewState.documents[previewDocument.id]?.history.length, 1);

const loosePreviewDocument = createChartDocument("chart-doc-loose-preview", "AAPL", "1m");
let loosePreviewState = {
  ...createInitialChartRuntimeState(),
  documents: { [loosePreviewDocument.id]: loosePreviewDocument }
};
loosePreviewState = chartRuntimeReducer(loosePreviewState, {
  kind: "chart.proposal.received",
  proposal: {
    id: "proposal-loose-preview",
    title: "Loose preview",
    rationale: "LLM may omit optional drawing style details.",
    summary: "Normalize loose preview payloads",
    target: target("panel-loose-preview", loosePreviewDocument.id),
    commands: [
      makeChartCommand("chart.drawing.add", "llm", target("panel-loose-preview", loosePreviewDocument.id), {
        drawingType: "horizontalLine",
        anchors: [anchorA],
        style: null,
        label: "Loose level"
      }, "proposal-loose-preview"),
      makeChartCommand("chart.comparison.add", "llm", target("panel-loose-preview", loosePreviewDocument.id), {
        comparison: {
          id: "comparison-msft-loose-preview",
          symbol: "MSFT",
          label: "MSFT",
          scaleMode: "percent",
          base: { mode: "visibleRangeStart" },
          style: null
        }
      }, "proposal-loose-preview")
    ],
    insights: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    createdByAgentId: "agent-01"
  },
  autoApply: false
});
const loosePreview = loosePreviewState.pendingPreviewByDocumentId[loosePreviewDocument.id];
assert.equal(loosePreview?.drawings.length, 1);
assert.equal(loosePreview?.comparisons.length, 1);
assert.equal(loosePreview?.drawings[0]?.style.color, "#111111");
assert.equal(loosePreview?.drawings[0]?.style.lineWidth, 1.5);
assert.equal(loosePreview?.comparisons[0]?.style.color, "#111111");
const loosePreviewScene = buildRenderScene({
  state: "ready",
  document: loosePreviewDocument,
  candles: [candleA, candleB],
  width: 640,
  height: 360,
  comparisonCandlesBySymbol: {
    MSFT: [
      { ...candleA, close: 30, open: 30, high: 31, low: 29 },
      { ...candleB, close: 33, open: 30, high: 34, low: 29 }
    ]
  },
  pendingPreview: loosePreview
});
assert.equal(loosePreviewScene.comparisonSeries.length, 1);
assert.deepEqual(loosePreviewScene.comparisonSeries[0]?.comparison.style.lineDash, [6, 4]);

const directPreviewDocument = createChartDocument("chart-doc-direct-preview", "AAPL", "1m");
let directPreviewState = {
  ...createInitialChartRuntimeState(),
  documents: { [directPreviewDocument.id]: directPreviewDocument }
};
directPreviewState = chartRuntimeReducer(directPreviewState, {
  kind: "chart.command",
  command: makeChartCommand("chart.preview.set", "llm", target("panel-direct-preview", directPreviewDocument.id), {
    preview: {
      id: "direct-preview",
      drawings: [{
        id: "drawing-direct-preview",
        type: "horizontalLine",
        anchors: [anchorA],
        style: null,
        label: "Direct preview level"
      }],
      comparisons: [{
        id: "comparison-direct-preview",
        symbol: "MSFT",
        label: "MSFT",
        scaleMode: "percent",
        base: { mode: "visibleRangeStart" },
        style: null
      }]
    }
  }, "proposal-direct-preview")
});
const directPreview = directPreviewState.pendingPreviewByDocumentId[directPreviewDocument.id];
assert.equal(directPreview?.drawings.length, 1);
assert.equal(directPreview?.comparisons.length, 1);
assert.equal(directPreview?.drawings[0]?.style.color, "#111111");
assert.equal(directPreview?.comparisons[0]?.style.color, "#111111");
