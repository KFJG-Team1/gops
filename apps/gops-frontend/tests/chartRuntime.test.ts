import assert from "node:assert/strict";
import { getChartAgentAccess } from "../../chart-engine/src/agentAccess";
import { normalizeAgentChatResponse } from "../../chart-engine/src/agentChat";
import { buildAgentAnalysisRequest, formatAgentAnalysisReport, normalizeAgentAnalysisReport } from "../src/agents/agentAnalysis";
import { isChartDataRenderable, isPreparingCandleData, normalizeBackfillStatusPayload, shouldForceBackfill, shouldRequestBackfill } from "../../chart-engine/src/backfill";
import {
  DEFAULT_AGENT_DRAFT_SEED,
  isAgentChartReferenceAvailable,
  resolveAgentChartReference,
  resolveAgentSendContent
} from "../../chart-engine/src/agentReference";
import { applyCandleEvent, candleKey } from "../../chart-engine/src/candleStore";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { findTargetChartPanel } from "../../chart-engine/src/chartPanelSelection";
import { executeChartCommand, executeChartCommandGroup, makeChartCommand, validateChartProposal } from "../../chart-engine/src/commands";
import { projectTrendLine } from "../../chart-engine/src/drawingGeometry";
import { backfillTargetBarsForInterval, defaultVisibleBarsForInterval, maxRequestBarsForInterval, normalizeChartInterval } from "../../chart-engine/src/intervals";
import { isRealtimeControlPayload, normalizeCandleEvent, normalizeCandleSnapshot } from "../../chart-engine/src/marketDataAdapter";
import { buildChartAgentContext, buildChartProposalRequest } from "../../chart-engine/src/proposals";
import { buildRenderScene } from "../../chart-engine/src/renderScene";
import { chartRuntimeReducer, createInitialChartRuntimeState } from "../../chart-engine/src/runtime";
import { createCoordinateTransform } from "../../chart-engine/src/scales";
import { DEFAULT_CHART_SYMBOL, normalizeSupportedSymbol, normalizeWatchlistPayload } from "../../chart-engine/src/symbols";
import type { CandleData, ChartPendingPreview, ChartProposal } from "../../chart-engine/src/types";
import {
  createInitialRuntimeState as createInitialLayoutRuntimeState,
  executeCommand as executeLayoutCommand,
  layoutPresentationSnapshotsEqual,
  layoutSnapshotsEqual,
  makeCommand as makeLayoutCommand
} from "../src/layout/commands";
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

const initialLayoutRuntime = createInitialLayoutRuntimeState();
assert.equal(initialLayoutRuntime.layout.selectedPanelId, undefined);
assert.equal(createPresetLayout("chart").selectedPanelId, undefined);
assert.equal(createPresetLayout("overview").selectedPanelId, undefined);
assert.equal(getPanelDefinition("orderTicket").title, "주문");
assert.equal(PANEL_CATALOG_TYPES.includes("orderTicket"), true);
const orderPanelInstance = createPanelInstance("orderTicket", testPlacement(4, 4, 1, 2), "system", {}, "test-order");
assert.equal(orderPanelInstance.type, "orderTicket");
assert.equal(orderPanelInstance.resourceRefs?.[0]?.kind, "orderTicket");
const chartPresetOrderPanel = createPresetLayout("chart").panels.find((panel) => panel.id === "panel-order");
assert.equal(chartPresetOrderPanel?.type, "orderTicket");
assert.deepEqual(pickPlacement(chartPresetOrderPanel?.placement), { col: 4, row: 4, colSpan: 1, rowSpan: 2 });
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
      ? createPanelInstance("aiSummary", staleOrderPlacement, "system", { summary: "LLM summary placeholder" }, "panel-ai-summary")
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
  assert.equal(mergedChartDefault?.layout.panels.some((panel) => panel.id === "panel-ai-summary"), false);
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

assert.equal(shouldRequestBackfill({
  state: "empty",
  message: "No candle data",
  backfillStatus: "not_requested",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}), true);
assert.equal(shouldRequestBackfill({
  state: "empty",
  backfillStatus: "queued",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}), false);
assert.equal(isPreparingCandleData({
  state: "empty",
  message: "No candle data",
  backfillStatus: "not_requested",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}, true), true);
assert.equal(isPreparingCandleData({
  state: "empty",
  backfillStatus: "queued",
  canBackfill: false,
  updatedAt: new Date().toISOString()
}, true), true);
assert.equal(isPreparingCandleData({
  state: "empty",
  backfillStatus: "failed",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}, true), true);
assert.equal(shouldRequestBackfill({
  state: "empty",
  message: "Alpaca credentials are not configured.",
  backfillStatus: "unavailable",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}), true);
assert.equal(shouldForceBackfill({
  state: "empty",
  backfillStatus: "unavailable",
  canBackfill: true,
  updatedAt: new Date().toISOString()
}), true);
assert.equal(shouldRequestBackfill({
  state: "partial",
  backfillStatus: "succeeded",
  canBackfill: true,
  coverage: {
    state: "partial",
    reasonCode: "insufficient_source_bars",
    sourceInterval: "1D",
    renderable: false
  },
  updatedAt: new Date().toISOString()
}), true);
assert.equal(normalizeBackfillStatusPayload({
  symbol: "NVDA",
  interval: "1W",
  sourceInterval: "1D",
  requestId: "backfill:NVDA:1m:test",
  status: "succeeded"
}).status, "succeeded");
assert.equal(normalizeBackfillStatusPayload({
  symbol: "NVDA",
  interval: "1W",
  sourceInterval: "1D",
  requestId: "backfill:NVDA:1D:test",
  status: "queued"
}).sourceInterval, "1D");
assert.equal(shouldRequestBackfill({
  state: "empty",
  message: "Backfill completed, but no stored 1m candles were found for NVDA.",
  backfillStatus: "succeeded",
  canBackfill: true,
  coverage: {
    state: "empty",
    reasonCode: "backfill_succeeded_without_complete_coverage",
    sourceInterval: "1m"
  },
  updatedAt: new Date().toISOString()
}), true);
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
    message: "Historical candle backfill is queued.",
    backfillStatus: "queued",
    canBackfill: false
  }
});
assert.equal(emptyStatusRuntime.dataStatusByKey[candleKey("AMD", "1m")]?.backfillStatus, "queued");
assert.equal(emptyStatusRuntime.streamStatusByKey[candleKey("AMD", "1m")], undefined);

const derivedSourceStatusRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.data.status",
  symbol: "AMD",
  interval: "1W",
  status: {
    state: "empty",
    message: "Weekly candles are waiting for daily backfill.",
    backfillStatus: "queued",
    canBackfill: false,
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

const partialBackfillSnapshot = normalizeCandleSnapshot({
  symbol: "INTC",
  interval: "1m",
  source: "alpaca",
  feed: "sip",
  dataStatus: "partial",
  backfillStatus: "not_requested",
  canBackfill: true,
  requestedLimit: 390,
  returnedCount: 1,
  targetStoredCount: 98280,
  storedCandleCount: 1,
  hasMoreBefore: true,
  coverage: {
    state: "partial",
    reasonCode: "stored_range_incomplete",
    sourceInterval: "1m",
    returnedCount: 1,
    storedCandleCount: 1,
    targetStoredCount: 98280,
    renderable: false,
    minimumReturnedCount: 20,
    minimumRenderableSourceBars: 30
  },
  candles: [candleB]
});
assert.equal(partialBackfillSnapshot.dataStatus, "partial");
assert.equal(partialBackfillSnapshot.coverage?.reasonCode, "stored_range_incomplete");
assert.equal(partialBackfillSnapshot.coverage?.renderable, false);
const partialBackfillRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.snapshot.loaded",
  snapshot: partialBackfillSnapshot
});
const partialBackfillStatus = partialBackfillRuntime.dataStatusByKey[candleKey("INTC", "1m")];
assert.equal(partialBackfillStatus?.state, "partial");
assert.equal(partialBackfillStatus?.hasMoreBefore, true);
assert.equal(partialBackfillStatus?.targetStoredCount, 98280);
assert.equal(partialBackfillStatus?.coverage?.targetStoredCount, 98280);

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

const mergedSnapshotRuntime = chartRuntimeReducer(partialBackfillRuntime, {
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
  [candleA.timestamp, candleB.timestamp]
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
assert.equal(defaultVisibleBarsForInterval("1m"), 390);
assert.equal(defaultVisibleBarsForInterval("5m"), 390);
assert.equal(defaultVisibleBarsForInterval("10m"), 390);
assert.equal(defaultVisibleBarsForInterval("1D"), 250);
assert.equal(defaultVisibleBarsForInterval("1W"), 260);
assert.equal(defaultVisibleBarsForInterval("1M"), 120);
assert.equal(backfillTargetBarsForInterval("1m"), 98280);
assert.equal(backfillTargetBarsForInterval("5m"), 19656);
assert.equal(backfillTargetBarsForInterval("10m"), 9828);
assert.equal(backfillTargetBarsForInterval("1D"), 1260);
assert.equal(backfillTargetBarsForInterval("1W"), 260);
assert.equal(backfillTargetBarsForInterval("1M"), 60);
assert.equal(maxRequestBarsForInterval("1M"), 120);
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
    { symbol: "AAPL", name: "Apple", market: "NASDAQ", lastPrice: 190.12, changePercent: 1.2, volume: 1000 },
    { symbol: "GOOG", name: "Alphabet", lastPrice: 1 }
  ]
});
assert.equal(watchlist.length, 2);
assert.equal(watchlist[0]?.symbol, "AAPL");
assert.equal(watchlist[0]?.market, "NASDAQ");
assert.equal(watchlist[0]?.lastPrice, 190.12);
assert.equal(watchlist.find((item) => item.symbol === "GOOG")?.market, "US");

const seedWatchlist = normalizeWatchlistPayload({
  symbols: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "AMAT", "MU"].map((symbol) => ({
    symbol,
    name: symbol,
    market: symbol === "TSM" ? "NYSE" : "NASDAQ"
  }))
});
assert.deepEqual(seedWatchlist.map((item) => item.symbol), ["NVDA", "AMD", "AVGO", "TSM", "ASML", "AMAT", "MU"]);

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

assert.equal(clampRightOffset(120, 72, 160), 88);
assert.equal(dragDeltaToRightOffset(0, 18, 9, 72, 160), 2);
assert.equal(dragDeltaToRightOffset(8, -27, 9, 72, 160), 5);
assert.equal(resolveViewportVisibleCount(400, 180), 50);
assert.equal(clampVisibleCount(180, 160, 400), 50);
assert.deepEqual(normalizeViewport({ visibleCount: 180, rightOffset: 120 }, 160, 400), {
  visibleCount: 50,
  rightOffset: 110
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
assert.deepEqual(sharedCacheRuntime.documents["shared-doc-a"]?.viewport, { visibleCount: 12, rightOffset: 1 });
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

const agentAnalysisRequest = buildAgentAnalysisRequest({
  agentIds: ["agent-01", "agent-02"],
  messages: [{ id: "message-1", role: "user", content: "NVDA 급등 원인 알려줘", createdAt: "2026-06-29T00:00:00.000Z" }],
  symbol: "NVDA",
  intent: "NVDA 급등 원인 알려줘",
  chartContext: { chartDocument: { symbol: "NVDA", timeframe: "1m" } }
});
assert.deepEqual(agentAnalysisRequest, {
  agentIds: ["agent-01", "agent-02"],
  messages: [{ role: "user", content: "NVDA 급등 원인 알려줘" }],
  symbol: "NVDA",
  intent: "NVDA 급등 원인 알려줘",
  chartContext: { chartDocument: { symbol: "NVDA", timeframe: "1m" } },
  routerMode: "hybrid"
});

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
  notificationDecision: {
    level: "watch",
    title: "NVDA price surge",
    message: "Smoke event for Docker validation.",
    reason: "Notification level follows the strongest attached market event severity."
  }
});
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
assert.match(agentAnalysisMessage, /알림 판단: WATCH - NVDA price surge/);
assert.doesNotMatch(agentAnalysisMessage, /검증 결과: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /검증 경고: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /URL 없는 온톨로지 근거/);
assert.doesNotMatch(agentAnalysisMessage, /verification-guardrail:/);
assert.throws(
  () => normalizeAgentAnalysisReport({ findings: [] }),
  /멀티에이전트 분석 응답 형식이 올바르지 않습니다\./
);

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
