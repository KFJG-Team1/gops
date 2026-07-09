import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChartAgentAccess } from "../../chart-engine/src/agentAccess";
import { normalizeAgentChatResponse } from "../../chart-engine/src/agentChat";
import { isChartDataRenderable } from "../../chart-engine/src/renderability";
import { compileDeterministicChartOperations } from "../src/agent/chartOperationCompiler";
import {
  buildAgentAnalysisRequest,
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
import { chartRuntimeReducer, createInitialChartRuntimeState, type ChartRuntimePanel } from "../../chart-engine/src/runtime";
import { createCoordinateTransform } from "../../chart-engine/src/scales";
import { DEFAULT_CHART_SYMBOL, defaultWatchlistSymbols, normalizeHotRankingPayload, normalizeSupportedSymbol, normalizeWatchlistPayload } from "../../chart-engine/src/symbols";
import { fallbackChartStyle, normalizeChartStyle, setDefaultChartStyle } from "../../chart-engine/src/theme";
import type { CandleData, ChartPendingPreview, ChartProposal } from "../../chart-engine/src/types";
import { normalizeAgentEntityResolveResponse, normalizeAgentLayoutResolveResponse } from "../src/agent/agentAnalysisClient";
import { formatNotificationToastMessage, notificationSummary } from "../src/alerts/alertPresentation";
import { createMarketOpenNotification, readMarketOpenReminderEnabled, shouldShowMarketOpenReminder } from "../src/alerts/marketOpenReminder";
import { normalizeNextMarketOpen } from "../src/market/marketOpenApi";
import type { AgentLayoutCommand, AgentLayoutCommandType, AgentLayoutProposal, CommandActor } from "../src/layout/agentLayoutTypes";
import {
  buildSemanticTimeline,
  nextDigTargetInterval,
  semanticExpansionId,
  semanticNodeId,
  type SemanticExpansion
} from "../src/chart/semanticTimeline";
import { anchoredViewportForCandles, viewportPreservingRightEdgeAfterCandlesChange } from "../src/chart/intervalNavigation";
import { resolveDrawingRenderItems } from "../src/chart/drawingProjection";
import {
  buildChartScene as buildFrontendChartScene,
  createCoordinateTransform as createFrontendCoordinateTransform
} from "../src/chart/scene";
import { createIndicatorPointLookup, createIndicatorValueLookup, mergeIndicatorSeries, scopedIndicatorSeriesKey } from "../src/chart/indicatorSeries";
import {
  candleMovingAverageWindows,
  indicatorRequestRangeFromCandles,
  serverIndicatorLayersForLayers
} from "../src/chart/indicatorLayerPolicy";
import { stableVolumeProfileRangeKey } from "../src/chart/derivedRequestPolicy";
import { indicatorRequestLimitForInterval, maxIndicatorRequestBars } from "../src/chart/indicatorRequestPolicy";
import {
  olderRangeQueuedRetryDelayMs,
  olderRangeRequestKey,
  olderRangeRetryAfterMs,
  olderRangeTerminalRetryDelayMs,
  shouldRequestOlderRange
} from "../src/chart/olderRangeRequestPolicy";
import { sourceIntervalForDrawingAnchors } from "../src/chart/drawings";
import { chartStateFromDocument, ensureFrontendChartDocuments } from "../src/chart/chartDocumentAdapter";
import { chartIntervals, type CandleDto, type ChartState, type DrawingEntity } from "../src/chart/types";
import {
  addPanelSlotAtGridRect,
  applyPanelResizeWithYield,
  canPlaceGridRect,
  createInitialTiledPanelState,
  detectResizablePanelBoundaries,
  layoutHasGapsOrOverlaps,
  movePanelSlotToGridRect,
  normalizeFreeformRectsToGridLayout,
  panelGridSpec,
  panelRectForGridRect,
  panelGutter,
  removePanelSlot,
  replacePanelSlotKind,
  resolvePanelDropGridRect,
  resolvePanelResizeWithYield,
  restoreTiledPanelStateSnapshot,
  scaleTiledPanelState,
  serializeTiledPanelState,
  resizeFreeformBoundary,
  resizePanelSlotToGridRect,
  swapPanelContents,
  workspaceBounds
} from "../src/layout/panelLayout";
import { rectBottom, rectRight, rectsOverlap } from "../src/layout/panelGeometry";
import {
  applyPlacementPickCandidate,
  applyTiledAgentLayoutProposal,
  applyTiledAgentLayoutProposalWithResult,
  buildTiledAgentLayoutContext
} from "../src/layout/tiledAgentLayout";
import { createMainViewUrl, resolveMainViewFromUrl } from "../src/navigation/mainViewUrl";
import {
  clampRightOffset,
  clampVisibleCount,
  dragDeltaToRightOffset,
  horizontalWheelDeltaToRightOffset,
  normalizeViewport,
  resolveHorizontalWheelDelta,
  resolveViewportVisibleCount,
  zoomViewport
} from "../../chart-engine/src/viewport";
import {
  clampRightOffset as frontendClampRightOffset,
  dragDeltaToRightOffset as frontendDragDeltaToRightOffset,
  futureEmptySlotCount as frontendFutureEmptySlotCount,
  horizontalWheelDeltaToRightOffset as frontendHorizontalWheelDeltaToRightOffset,
  normalizeViewport as frontendNormalizeViewport,
  resolveHorizontalWheelDelta as frontendResolveHorizontalWheelDelta
} from "../src/chart/viewport";
import {
  createTreeMapOpacityScale,
  tileFillForChange,
  tileOpacityForChange,
  tileTextForOpacity
} from "../src/treemap/treemapColors";

function target(panelId: string, chartDocumentId: string) {
  return { panelId, chartDocumentId };
}

function chartPanel(panelId: string, chartDocumentId: string, symbol = "AAPL"): ChartRuntimePanel {
  return {
    id: panelId,
    type: "chart",
    props: { symbol },
    chartDocumentId
  };
}

type TestPanelPlacement = {
  group: "workspace";
  zone: "main" | "context" | "mainContext";
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

function testPlacement(col: number, row: number, colSpan = 1, rowSpan = 1): TestPanelPlacement {
  return {
    group: "workspace",
    zone: col >= 7 ? "context" : col + colSpan - 1 <= 6 ? "main" : "mainContext",
    col,
    row,
    colSpan,
    rowSpan
  };
}

function runtimePanel(id: string, type: string, props: Record<string, unknown> = {}): ChartRuntimePanel {
  return {
    id,
    type,
    props,
    chartDocumentId: type === "chart" ? `${id}-chartDocument` : undefined
  };
}

function makeAgentLayoutCommand(
  type: AgentLayoutCommandType,
  actor: CommandActor,
  payload: Record<string, unknown> = {},
  target?: AgentLayoutCommand["target"]
): AgentLayoutCommand {
  return {
    id: `test-layout-command-${type}-${Math.random().toString(16).slice(2)}`,
    type,
    actor,
    target,
    payload,
    createdAt: "2026-06-29T00:00:00.000Z"
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

function testCandle(timestamp: string, close = 100): CandleDto {
  return {
    timestamp,
    open: close - 0.2,
    high: close + 0.4,
    low: close - 0.5,
    close,
    volume: 100,
    isClosed: true
  };
}

function frontendChartState(overrides: Partial<ChartState>): ChartState {
  return {
    symbol: "AAPL",
    chartType: "candle",
    interval: "1D",
    candles: [],
    status: "ready",
    layers: { candles: true, volume: true, ma5: false, ma20: false, ma60: false },
    volumeRatio: 0.2,
    visibleCount: 20,
    rightOffset: 0,
    toolMode: "select",
    trendLineExtension: "segment",
    drawings: [],
    streamState: "idle",
    ...overrides
  };
}

const priceAlertNotification = {
  id: 1,
  eventId: "alert-price-toast",
  type: "alert.price_cross",
  payload: {
    symbol: "NVDA",
    direction: "above",
    targetPrice: 110,
    price: 111.2
  }
};
const priceAlertToast = formatNotificationToastMessage(priceAlertNotification);
assert.equal(priceAlertToast.message, "NVDA 목표가 110 상향 돌파 조건을 달성했습니다.");
assert.equal(priceAlertToast.detail, "현재가는 111.2입니다.");
assert.equal(notificationSummary(priceAlertNotification), " 목표가 110 상향 돌파 조건 달성");

const spikeAlertNotification = {
  id: 2,
  eventId: "alert-spike-toast",
  type: "alert.spike",
  payload: {
    symbol: "AAPL",
    direction: "below",
    thresholdPct: 3,
    windowMin: 5,
    changePct: -4.25
  }
};
const spikeAlertToast = formatNotificationToastMessage(spikeAlertNotification);
assert.equal(spikeAlertToast.message, "AAPL 5분 내 급락 3% 이상 조건을 달성했습니다.");
assert.equal(spikeAlertToast.detail, "실제 변동률은 -4.25%입니다.");
assert.equal(notificationSummary(spikeAlertNotification), " 5분 내 급락 3% 이상 조건 달성");

const marketOpenNotification = createMarketOpenNotification("2026-07-07T13:30:00.000Z");
const marketOpenToast = formatNotificationToastMessage(marketOpenNotification);
assert.equal(marketOpenToast.title, "본장 시작");
assert.equal(marketOpenToast.message, "미국 본장이 시작되었습니다.");
assert.equal(marketOpenToast.chartSymbol, "");
assert.equal(notificationSummary(marketOpenNotification), " 미국 본장 시작");
assert.equal(readMarketOpenReminderEnabled(undefined), true);
assert.equal(shouldShowMarketOpenReminder("2026-07-07T13:30:00.000Z", Date.parse("2026-07-07T13:30:06.000Z")), true);
assert.equal(shouldShowMarketOpenReminder("2026-07-07T13:30:00.000Z", Date.parse("2026-07-07T13:41:00.000Z")), false);
assert.equal(normalizeNextMarketOpen({
  nextOpenAt: "2026-07-07T13:30:00.000Z",
  marketDate: "2026-07-07",
  source: "alpaca-clock"
}).source, "alpaca-clock");

function testDrawing(overrides: Partial<DrawingEntity>): DrawingEntity {
  return {
    id: "drawing-test",
    type: "rangeBox",
    anchors: [],
    style: { color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.12 },
    visible: true,
    createdBy: "user",
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    ...overrides
  };
}

const compiledChartOps = compileDeterministicChartOperations({
  query: "7월 4일 종가 기준으로 수평선 그리고, 볼린저 밴드만 보여줘",
  chart: frontendChartState({
    candles: [
      testCandle("2026-07-03T00:00:00Z", 101),
      testCandle("2026-07-04T00:00:00Z", 104)
    ],
    layers: {
      candles: true,
      volume: true,
      "sma:20": true,
      "bollinger:20:2": false,
      "rsi:14": true
    }
  })
});
assert.equal(compiledChartOps.handled, true);
assert.equal(compiledChartOps.operationIR?.operations.length, 3);
assert.ok(compiledChartOps.actions.some((action) => action.type === "setLayer" && action.layer === "bollinger:20:2" && action.enabled));
assert.ok(compiledChartOps.actions.some((action) => action.type === "setLayer" && action.layer === "sma:20" && !action.enabled));
const compiledHorizontalLine = compiledChartOps.actions.find((action) => action.type === "addDrawing");
assert.equal(compiledHorizontalLine?.type, "addDrawing");
if (compiledHorizontalLine?.type === "addDrawing") {
  assert.equal(compiledHorizontalLine.drawing.anchors[0]?.price, 104);
  assert.equal(compiledHorizontalLine.drawing.anchors[0]?.timestamp, "2026-07-04T00:00:00Z");
}
assert.ok(compiledChartOps.visualOverlays.some((overlay) => (
  overlay.kind === "candleHighlight" &&
  overlay.styleToken === "signal" &&
  overlay.anchors.some((anchor) => anchor.timestamp === "2026-07-04T00:00:00Z")
)));

assert.equal(createChartDocument("chart-doc-themed-default", "AAPL", "1m").style.background, fallbackChartStyle.background);
assert.equal(createChartDocument("chart-doc-themed-default-bullish", "AAPL", "1m").style.bullish, fallbackChartStyle.bullish);
const chartTypeDefaultDocument = createChartDocument("chart-doc-type-default", "AAPL", "1m");
assert.equal(chartTypeDefaultDocument.chartType, "candle");
assert.equal(chartTypeDefaultDocument.layers["sma:5"], true);
assert.equal(chartTypeDefaultDocument.layers.ma5, true);
assert.equal(fallbackChartStyle.background, "#efefe8");
assert.equal(fallbackChartStyle.text, "#1a1a0e");
assert.equal(fallbackChartStyle.grid, "rgba(26, 26, 14, 0.08)");
assert.equal(fallbackChartStyle.volume, "rgba(26, 26, 14, 0.12)");
assert.equal(fallbackChartStyle.bullish, "#1b6a29");
assert.equal(fallbackChartStyle.bearish, "#b31a0f");
setDefaultChartStyle({
  background: "#101010",
  bullish: "#00ff00",
  bearish: "#ff0000",
  ma5: "#abcdef"
});
const themedDocument = createChartDocument("chart-doc-themed-custom", "AAPL", "1m");
assert.equal(themedDocument.style.background, "#101010");
assert.equal(themedDocument.style.bullish, "#00ff00");
assert.equal(themedDocument.style.bearish, "#ff0000");
assert.equal(themedDocument.style.ma5, "#abcdef");
setDefaultChartStyle(fallbackChartStyle);
assert.equal(normalizeChartStyle({ background: "#ffffff", bullish: "#16a86b" }).background, fallbackChartStyle.background);
assert.equal(normalizeChartStyle({ background: "#ffffff", bullish: "#16a86b" }).bullish, fallbackChartStyle.bullish);

assert.deepEqual(candleMovingAverageWindows, [5, 20, 60]);
assert.deepEqual(serverIndicatorLayersForLayers({
  ma5: true,
  "sma:20": true,
  "sma:60": true,
  "ema:20": true,
  "rsi:14": true
}), ["ema:20", "rsi:14"]);
assert.deepEqual(indicatorRequestRangeFromCandles([
  { timestamp: "2026-06-25T13:30:00Z", open: 1, high: 2, low: 1, close: 2, volume: 10, isClosed: true },
  { timestamp: "2026-06-25T13:31:00Z", open: 2, high: 3, low: 2, close: 3, volume: 10, isClosed: true },
  { timestamp: "2026-06-25T13:32:00Z", open: 3, high: 4, low: 3, close: 4, volume: 10, isClosed: false }
]), {
  firstTimestamp: "2026-06-25T13:30:00Z",
  lastTimestamp: "2026-06-25T13:31:00Z",
  candleCount: 2
});

const treeMapTestTheme = {
  ...fallbackChartStyle,
  up: "#1b6a29",
  upSoft: "#1b6a29",
  down: "#b31a0f",
  downSoft: "#b31a0f",
  changeUp: "#1b6a29",
  changeDown: "#b31a0f",
  tileText: "#1a1a0e",
  tileTextInverse: "#efefe8",
  footprint: "rgba(26, 26, 14, 0.42)"
};
const treeMapScale = createTreeMapOpacityScale([
  0.01,
  0.06,
  ...Array.from({ length: 19 }, (_, index) => 0.1 + index * (3.9 / 18)),
  30
]);
assert.equal(tileFillForChange(0.01, treeMapTestTheme), treeMapTestTheme.muted);
assert.equal(tileOpacityForChange(0.01, treeMapScale), 0.48);
assert.equal(tileOpacityForChange(undefined, treeMapScale), 0.48);
assert.ok(Math.abs(tileOpacityForChange(4, treeMapScale) - 0.92) < 0.001);
assert.equal(tileOpacityForChange(30, treeMapScale), 0.92);
const quietTreeMapScale = createTreeMapOpacityScale([0.01, 0.04, 0.08, 0.12, 0.2]);
assert.equal(tileOpacityForChange(0.04, quietTreeMapScale), 0.48);
assert.ok(tileOpacityForChange(0.12, quietTreeMapScale) > tileOpacityForChange(0.08, quietTreeMapScale));
assert.equal(tileOpacityForChange(0.2, quietTreeMapScale), 0.92);
const emptyTreeMapScale = createTreeMapOpacityScale([undefined, Number.NaN]);
assert.equal(tileOpacityForChange(5, emptyTreeMapScale), 0.48);
assert.equal(tileTextForOpacity(0.57, treeMapTestTheme), treeMapTestTheme.tileText);
assert.equal(tileTextForOpacity(0.58, treeMapTestTheme), treeMapTestTheme.tileTextInverse);

assert.deepEqual(resolveMainViewFromUrl("http://localhost/?view=home").view, { mode: "treemap" });
assert.equal(resolveMainViewFromUrl("http://localhost/").url, "/?view=home");
assert.deepEqual(resolveMainViewFromUrl("http://localhost/?symbol=nvda").view, { mode: "chart", symbol: "NVDA" });
assert.equal(resolveMainViewFromUrl("http://localhost/?view=home&symbol=NVDA").url, "/?symbol=NVDA");
assert.equal(createMainViewUrl("http://localhost/?symbol=NVDA&panel=left#watch", { mode: "treemap" }), "/?panel=left&view=home#watch");
assert.equal(createMainViewUrl("http://localhost/?view=home&panel=left#watch", { mode: "chart", symbol: "aapl" }), "/?panel=left&symbol=AAPL#watch");

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

const futureViewportCommand = makeChartCommand("chart.viewport.set", "user", target("panel-a", documentA.id), {
  visibleCount: 42,
  rightOffset: -28
});
const futureViewportResult = executeChartCommand(documentA, futureViewportCommand);
assert.equal(futureViewportResult.ok, true);
if (futureViewportResult.ok) {
  assert.equal(futureViewportResult.document.viewport.visibleCount, 42);
  assert.equal(futureViewportResult.document.viewport.rightOffset, -28);
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
  assert.equal(documentBResult.document.layers.ma20, false);
  assert.equal(documentBResult.document.layers["sma:20"], false);
}

const chartTypeResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.type.set", "user", target("panel-b", documentB.id), { chartType: "line" })
);
assert.equal(chartTypeResult.ok, true);
if (chartTypeResult.ok) {
  assert.equal(chartTypeResult.document.chartType, "line");
  const undoChartType = executeChartCommand(
    chartTypeResult.document,
    makeChartCommand("chart.undo", "user", target("panel-b", documentB.id))
  );
  assert.equal(undoChartType.ok, true);
  if (undoChartType.ok) {
    assert.equal(undoChartType.document.chartType, "candle");
  }
}

const paneRatioResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.pane.ratio.set", "user", target("panel-b", documentB.id), { paneId: "volume", heightRatio: 0.31 })
);
assert.equal(paneRatioResult.ok, true);
if (paneRatioResult.ok) {
  assert.equal(paneRatioResult.document.panes.find((pane) => pane.id === "volume")?.heightRatio, 0.31);
}

const smaAliasResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.layer.visibility.set", "user", target("panel-b", documentB.id), {
    layer: "sma:60",
    visible: false
  })
);
assert.equal(smaAliasResult.ok, true);
if (smaAliasResult.ok) {
  assert.equal(smaAliasResult.document.layers["sma:60"], false);
  assert.equal(smaAliasResult.document.layers.ma60, false);
}

const rsiPaneResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.layer.visibility.set", "user", target("panel-b", documentB.id), {
    layer: "rsi:14",
    visible: true
  })
);
assert.equal(rsiPaneResult.ok, true);
if (rsiPaneResult.ok) {
  assert.equal(rsiPaneResult.document.layers["rsi:14"], true);
  assert.equal(rsiPaneResult.document.panes.at(-1)?.id, "rsi:14");
  const removeRsiPaneResult = executeChartCommand(
    rsiPaneResult.document,
    makeChartCommand("chart.layer.visibility.set", "user", target("panel-b", documentB.id), {
      layer: "rsi:14",
      visible: false
    })
  );
  assert.equal(removeRsiPaneResult.ok, true);
  if (removeRsiPaneResult.ok) {
    assert.equal(removeRsiPaneResult.document.layers["rsi:14"], false);
    assert.equal(removeRsiPaneResult.document.panes.some((pane) => pane.id === "rsi:14"), false);
  }
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

const loadingExpansion: SemanticExpansion = {
  ...emptyExpansion,
  status: "loading",
  candles: [],
  message: undefined
};
const readyExpansion: SemanticExpansion = {
  ...loadingExpansion,
  status: "ready",
  candles: Array.from(
    { length: 39 },
    (_, index) => testCandle(new Date(Date.parse("2026-06-25T13:30:00Z") + index * 10 * 60_000).toISOString(), 100 + index)
  )
};
const loadingExpansionRange = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: [candleA as CandleDto],
  expansions: [loadingExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: 1,
  viewportStartIndex: 0,
  visibleSlotCount: 80
}).expansionRanges[0];
const readyExpansionRange = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: [candleA as CandleDto],
  expansions: [readyExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: 1,
  viewportStartIndex: 0,
  visibleSlotCount: 80
}).expansionRanges[0];
assert.equal(
  (loadingExpansionRange?.slotEnd ?? 0) - (loadingExpansionRange?.slotStart ?? 0),
  (readyExpansionRange?.slotEnd ?? 0) - (readyExpansionRange?.slotStart ?? 0)
);
const readyExpansionWidth = (readyExpansionRange?.slotEnd ?? 0) - (readyExpansionRange?.slotStart ?? 0);
assert.ok(readyExpansionWidth < readyExpansion.candles.length / 2);
const readyExpansionTimeline = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: [candleA as CandleDto],
  expansions: [readyExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: 1,
  viewportStartIndex: 0,
  visibleSlotCount: 80
});
const readyExpansionChildCandle = readyExpansionTimeline.units.find((unit) => unit.kind === "candle" && unit.parentExpansionId === readyExpansion.id);
assert.ok(readyExpansionChildCandle);
assert.ok((readyExpansionChildCandle?.slotEnd ?? 0) - (readyExpansionChildCandle?.slotStart ?? 0) < 0.5);
const footprintExpansion: SemanticExpansion = {
  ...emptyExpansion,
  childInterval: "footprint",
  status: "ready",
  candles: [],
  footprintBucket: {
    timestamp: candleA.timestamp,
    from: candleA.timestamp,
    to: "2026-06-25T13:31:00Z",
    open: candleA.open,
    high: candleA.high,
    low: candleA.low,
    close: candleA.close,
    volume: 1200,
    tradeCount: 18,
    askVolume: 720,
    bidVolume: 430,
    unknownVolume: 50,
    delta: 290,
    priceLevels: [
      { price: 10.7, askVolume: 300, bidVolume: 120, unknownVolume: 0, totalVolume: 420, tradeCount: 6, delta: 180 },
      { price: 10.5, askVolume: 180, bidVolume: 260, unknownVolume: 20, totalVolume: 460, tradeCount: 8, delta: -80 }
    ]
  },
  message: undefined
};
const footprintExpansionTimeline = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: [candleA as CandleDto],
  expansions: [footprintExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: 1,
  viewportStartIndex: 0,
  visibleSlotCount: 40
});
const footprintExpansionUnit = footprintExpansionTimeline.units.find((unit) => unit.kind === "footprint");
assert.ok(footprintExpansionUnit);
assert.equal((footprintExpansionUnit?.slotEnd ?? 0) - (footprintExpansionUnit?.slotStart ?? 0), 18);
const sparseMinuteCandles = [
  testCandle("2026-07-09T05:36:00Z", 100),
  testCandle("2026-07-09T05:39:00Z", 101)
] as CandleDto[];
const sparseMinuteTimeline = buildSemanticTimeline({
  symbol: "MU",
  interval: "1m",
  candles: sparseMinuteCandles,
  expansions: [],
  visibleStartIndex: 0,
  visibleEndIndex: 2,
  viewportStartIndex: 0,
  visibleSlotCount: 6
});
const sparseMinuteGap = sparseMinuteTimeline.units.find((unit) => unit.kind === "time-gap");
assert.equal(sparseMinuteGap?.from, "2026-07-09T05:37:00Z");
assert.equal(sparseMinuteGap?.to, "2026-07-09T05:39:00Z");
assert.equal(sparseMinuteGap?.missingSlots, 2);
assert.equal(sparseMinuteGap?.carryTimestamp, "2026-07-09T05:36:00Z");
assert.equal(sparseMinuteGap?.carryPrice, 100);
assert.equal(sparseMinuteTimeline.units.filter((unit) => unit.kind === "candle").length, 2);
assert.ok(sparseMinuteTimeline.totalSlots >= 4);
const sparseMinuteScene = buildFrontendChartScene(frontendChartState({
  symbol: "MU",
  interval: "1m",
  candles: sparseMinuteCandles,
  visibleCount: 6,
  requestedLimit: 6
}), 600, 320);
const sparseMinuteTransform = createFrontendCoordinateTransform(sparseMinuteScene);
const beforeGapX = sparseMinuteTransform.timestampToX("2026-07-09T05:36:00Z");
const insideGapX = sparseMinuteTransform.timestampToX("2026-07-09T05:38:00Z");
const afterGapX = sparseMinuteTransform.timestampToX("2026-07-09T05:39:00Z");
assert.equal(typeof insideGapX, "number");
assert.ok((beforeGapX ?? 0) < (insideGapX ?? 0));
assert.ok((insideGapX ?? 0) < (afterGapX ?? 0));
const scopedRsiLookup = createIndicatorPointLookup({
  "rsi:14": [{ timestamp: candleA.timestamp, value: 55 }],
  [scopedIndicatorSeriesKey("10m", "rsi:14")]: [{ timestamp: candleA.timestamp, value: 77 }]
}, "rsi:14", "1D");
assert.equal(scopedRsiLookup({ interval: "1D", candle: { timestamp: candleA.timestamp } })?.value, 55);
assert.equal(scopedRsiLookup({ interval: "10m", candle: { timestamp: candleA.timestamp } })?.value, 77);
const canonicalIndicatorLookup = createIndicatorValueLookup({
  "ema:20": [
    { timestamp: "2026-06-25T13:30:00Z", value: 101 },
    { timestamp: "2026-06-25T13:31:00.000Z", value: 102 }
  ]
}, "ema:20", "1m");
assert.equal(canonicalIndicatorLookup({ interval: "1m", candle: { timestamp: "2026-06-25T13:30:00.000Z" } }), 101);
assert.equal(canonicalIndicatorLookup({ interval: "1m", candle: { timestamp: "2026-06-25T13:31:00Z" } }), 102);
const mergedCanonicalIndicators = mergeIndicatorSeries(
  { "ema:20": [{ timestamp: "2026-06-25T13:30:00Z", value: 101 }] },
  { "ema:20": [{ timestamp: "2026-06-25T13:30:00.000Z", value: 103 }] }
);
assert.deepEqual(mergedCanonicalIndicators["ema:20"], [{ timestamp: "2026-06-25T13:30:00.000Z", value: 103 }]);
const expandedIndicatorScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [candleA as CandleDto],
  visibleCount: 80,
  layers: {
    candles: true,
    volume: false,
    "ema:20": true,
    "rsi:14": true
  },
  indicatorSeries: {
    "ema:20": [{ timestamp: candleA.timestamp, value: 110 }],
    [scopedIndicatorSeriesKey("10m", "ema:20")]: readyExpansion.candles.map((candle, index) => ({
      timestamp: candle.timestamp,
      value: 90 + index
    })),
    [scopedIndicatorSeriesKey("10m", "rsi:14")]: readyExpansion.candles.map((candle, index) => ({
      timestamp: candle.timestamp,
      value: 40 + (index % 20)
    }))
  }
}), 720, 360, { expansions: [readyExpansion] });
const expandedIndicatorChild = expandedIndicatorScene.semantic.units.find((unit) => unit.kind === "candle" && unit.parentExpansionId === readyExpansion.id);
assert.ok(expandedIndicatorChild?.kind === "candle");
if (expandedIndicatorChild?.kind === "candle") {
  const expandedRsiLookup = createIndicatorPointLookup(expandedIndicatorScene.chart.indicatorSeries, "rsi:14", expandedIndicatorScene.chart.interval);
  assert.equal(expandedRsiLookup(expandedIndicatorChild)?.value, 40);
  assert.ok(expandedIndicatorScene.scales.minPrice <= 90);
}

const semanticFutureCandles = Array.from(
  { length: 80 },
  (_, index) => testCandle(new Date(Date.parse("2026-05-01T00:00:00Z") + index * 86_400_000).toISOString(), 100 + index)
);
const semanticFutureParent = semanticFutureCandles[semanticFutureCandles.length - 1] as CandleDto;
const semanticFutureParentNodeId = semanticNodeId("AAPL", "1D", semanticFutureParent.timestamp);
const semanticFutureExpansion: SemanticExpansion = {
  ...readyExpansion,
  id: semanticExpansionId(semanticFutureParentNodeId),
  parentNodeId: semanticFutureParentNodeId,
  parentTimestamp: semanticFutureParent.timestamp,
  parentCandle: semanticFutureParent,
  from: semanticFutureParent.timestamp,
  to: "2026-07-21T00:00:00.000Z"
};
const semanticFutureTimeline = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: semanticFutureCandles as CandleDto[],
  expansions: [semanticFutureExpansion],
  visibleStartIndex: 0,
  visibleEndIndex: semanticFutureCandles.length,
  viewportStartIndex: 0,
  visibleSlotCount: 80
});
assert.ok(semanticFutureTimeline.occupiedSlotEnd > semanticFutureTimeline.totalSlots);
const semanticFutureExtraSlots = Math.ceil(semanticFutureTimeline.expansionExtraSlots);
assert.ok(semanticFutureExtraSlots > 0);
const futureOffsetWithSemanticWidth = -(frontendFutureEmptySlotCount(80) + semanticFutureExtraSlots);
const noExpansionFutureScene = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 80,
  rightOffset: futureOffsetWithSemanticWidth
}), 800, 360);
assert.equal(noExpansionFutureScene.viewportStartIndex, frontendFutureEmptySlotCount(80));
const semanticFutureScene = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 80,
  rightOffset: futureOffsetWithSemanticWidth
}), 800, 360, { expansions: [semanticFutureExpansion] });
assert.equal(semanticFutureScene.viewportStartIndex, frontendFutureEmptySlotCount(80) + semanticFutureExtraSlots);
assert.equal(Math.ceil(semanticFutureScene.semantic.expansionExtraSlots), semanticFutureExtraSlots);
const semanticFutureSceneAtBaseEmptySpace = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 80,
  rightOffset: -frontendFutureEmptySlotCount(80)
}), 800, 360, { expansions: [semanticFutureExpansion] });
assert.equal(
  Math.ceil(semanticFutureSceneAtBaseEmptySpace.semantic.expansionExtraSlots),
  semanticFutureExtraSlots
);
const multiBelowPaneScene = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 40,
  layers: {
    candles: true,
    volume: true,
    "rsi:14": true,
    "macd:12:26:9": true
  },
  panes: [
    { id: "price", heightRatio: 0.56 },
    { id: "volume", heightRatio: 0.18 },
    { id: "rsi:14", heightRatio: 0.13 },
    { id: "macd:12:26:9", heightRatio: 0.13 }
  ]
}), 800, 460);
assert.deepEqual(multiBelowPaneScene.plot.belowPanes.map((pane) => pane.id), ["volume", "rsi:14", "macd:12:26:9"]);
assert.ok(multiBelowPaneScene.plot.belowPanes[0].top < multiBelowPaneScene.plot.belowPanes[1].top);
assert.equal(
  frontendDragDeltaToRightOffset(
    -frontendFutureEmptySlotCount(80),
    -semanticFutureSceneAtBaseEmptySpace.scales.slotWidth,
    semanticFutureSceneAtBaseEmptySpace.scales.slotWidth,
    80,
    semanticFutureCandles.length,
    { extraFutureSlots: semanticFutureSceneAtBaseEmptySpace.semantic.expansionExtraSlots }
  ),
  -frontendFutureEmptySlotCount(80) - 1
);
assert.equal(
  frontendDragDeltaToRightOffset(
    futureOffsetWithSemanticWidth,
    -semanticFutureScene.scales.slotWidth,
    semanticFutureScene.scales.slotWidth,
    80,
    semanticFutureCandles.length,
    { extraFutureSlots: semanticFutureScene.semantic.expansionExtraSlots }
  ),
  futureOffsetWithSemanticWidth
);

const leftSemanticFutureParent = semanticFutureCandles[0] as CandleDto;
const leftSemanticFutureParentNodeId = semanticNodeId("AAPL", "1D", leftSemanticFutureParent.timestamp);
const leftSemanticFutureExpansion: SemanticExpansion = {
  ...semanticFutureExpansion,
  id: semanticExpansionId(leftSemanticFutureParentNodeId),
  parentNodeId: leftSemanticFutureParentNodeId,
  parentTimestamp: leftSemanticFutureParent.timestamp,
  parentCandle: leftSemanticFutureParent,
  from: leftSemanticFutureParent.timestamp,
  to: "2026-05-02T00:00:00.000Z"
};
const leftExpansionTimeline = buildSemanticTimeline({
  symbol: "AAPL",
  interval: "1D",
  candles: semanticFutureCandles as CandleDto[],
  expansions: [leftSemanticFutureExpansion],
  visibleStartIndex: 30,
  visibleEndIndex: semanticFutureCandles.length,
  viewportStartIndex: 30,
  visibleSlotCount: 80
});
const firstVisibleAfterLeftExpansion = leftExpansionTimeline.units.find(
  (unit) => unit.kind === "candle" && unit.sourceIndex === 30
);
assert.equal(Math.ceil(leftExpansionTimeline.expansionExtraSlots), semanticFutureExtraSlots);
assert.ok(Math.abs((firstVisibleAfterLeftExpansion?.slotStart ?? -1) - leftExpansionTimeline.expansionExtraSlots) < 0.000001);

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
assert.equal(normalizeChartInterval("1H"), "1h");
assert.equal(normalizeChartInterval("4H"), "4h");
assert.equal(normalizeChartInterval("Footprint"), "footprint");
assert.equal(normalizeChartInterval("bad"), null);
assert.deepEqual(chartIntervals.slice(0, 6), ["footprint", "1m", "5m", "10m", "1h", "4h"]);
assert.equal(nextDigTargetInterval("1m"), "footprint");
assert.equal(nextDigTargetInterval("1D"), "1h");
assert.equal(nextDigTargetInterval("4h"), "1h");
assert.equal(nextDigTargetInterval("1h"), "10m");
assert.equal(defaultVisibleBarsForInterval("1m"), 120);
assert.equal(defaultVisibleBarsForInterval("footprint"), 120);
assert.equal(defaultVisibleBarsForInterval("5m"), 120);
assert.equal(defaultVisibleBarsForInterval("10m"), 120);
assert.equal(defaultVisibleBarsForInterval("1h"), 120);
assert.equal(defaultVisibleBarsForInterval("4h"), 120);
assert.equal(defaultVisibleBarsForInterval("1D"), 120);
assert.equal(defaultVisibleBarsForInterval("1W"), 104);
assert.equal(defaultVisibleBarsForInterval("1M"), 36);
assert.equal(maxRequestBarsForInterval("1m"), 589680);
assert.equal(maxRequestBarsForInterval("footprint"), 589680);
assert.equal(maxRequestBarsForInterval("5m"), 117936);
assert.equal(maxRequestBarsForInterval("10m"), 58968);
assert.equal(maxRequestBarsForInterval("1h"), 9828);
assert.equal(maxRequestBarsForInterval("4h"), 2457);
assert.equal(maxRequestBarsForInterval("1D"), 1512);
assert.equal(maxRequestBarsForInterval("1W"), 312);
assert.equal(maxRequestBarsForInterval("1M"), 72);
assert.equal(maxIndicatorRequestBars, 5000);
assert.equal(indicatorRequestLimitForInterval("1D", 22849), 1512);
assert.equal(indicatorRequestLimitForInterval("1D", 36477), 1512);
assert.equal(indicatorRequestLimitForInterval("1m", 22849), 5000);
assert.equal(indicatorRequestLimitForInterval("4h", 5000), 2457);
assert.equal(
  stableVolumeProfileRangeKey({
    symbol: "nvda",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceBinSize: "auto"
  }),
  stableVolumeProfileRangeKey({
    symbol: "NVDA",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceBinSize: "auto"
  })
);
assert.equal(
  olderRangeRequestKey("nvda", "1D", "2026-07-02T04:00:00.000Z", 120),
  "NVDA:1D:before:2026-07-02T04:00:00.000Z:120"
);
assert.equal(shouldRequestOlderRange(undefined, 1_000), true);
assert.equal(shouldRequestOlderRange(1_500, 1_000), false);
assert.equal(shouldRequestOlderRange(1_500, 1_500), true);
assert.equal(
  olderRangeRetryAfterMs({
    candles: [],
    hasMoreBefore: false
  }, 0, 10_000),
  10_000 + olderRangeTerminalRetryDelayMs
);
assert.equal(
  olderRangeRetryAfterMs({
    candles: [],
    hasMoreBefore: true,
    fill: { backgroundFill: { queued: true, state: "already_queued" } }
  }, 0, 10_000),
  10_000 + olderRangeQueuedRetryDelayMs
);
assert.equal(
  olderRangeRetryAfterMs({
    candles: [testCandle("2026-07-01T04:00:00.000Z")],
    hasMoreBefore: true
  }, 1, 10_000),
  null
);
for (const timeframe of ["1h", "4h", "1D", "1W", "1M"]) {
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

const tiledViewport = { width: 1280, height: 800 };
const tiledState = createInitialTiledPanelState(tiledViewport, { symbol: "NVDA" });
const tiledWorkspace = workspaceBounds(tiledViewport);
const tiledGutter = panelGutter(tiledViewport);
const tiledInnerBottom = rectBottom(tiledWorkspace) - tiledGutter;
const defaultChartSlot = tiledState.slots.find((slot) => slot.id === "slot-chart");
const initialNewsSlot = tiledState.slots.find((slot) => slot.id === "slot-news");
const initialOntologySlot = tiledState.slots.find((slot) => slot.id === "slot-ontology");
const defaultChartContent = defaultChartSlot ? tiledState.contents[defaultChartSlot.contentId] : undefined;
const expectedInitialChartRect = panelRectForGridRect({ col: 1, row: 3, colSpan: 8, rowSpan: 3 }, tiledViewport);
const expectedInitialNewsRect = panelRectForGridRect({ col: 1, row: 1, colSpan: 4, rowSpan: 2 }, tiledViewport);
const expectedInitialOntologyRect = panelRectForGridRect({ col: 5, row: 1, colSpan: 4, rowSpan: 2 }, tiledViewport);
const expectedChartMinRect = panelRectForGridRect({ col: 1, row: 1, colSpan: 2, rowSpan: 1 }, tiledViewport);
const expectedDefaultPanelMinRect = panelRectForGridRect({ col: 1, row: 1, colSpan: 1, rowSpan: 1 }, tiledViewport);
const testFreeformSlot = (
  id: string,
  contentId: string,
  gridRect: { col: number; row: number; colSpan: number; rowSpan: number }
) => ({
  id,
  contentId,
  gridRect,
  rect: panelRectForGridRect(gridRect, tiledViewport),
  minWidth: expectedDefaultPanelMinRect.width,
  minHeight: expectedDefaultPanelMinRect.height
});
const testSlotsOverlap = (slots: Array<{ rect: { left: number; top: number; width: number; height: number } }>) => {
  for (let leftIndex = 0; leftIndex < slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex += 1) {
      if (rectsOverlap(slots[leftIndex]!.rect, slots[rightIndex]!.rect, 0.5)) {
        return true;
      }
    }
  }
  return false;
};
assert.deepEqual(panelGridSpec, { cols: 8, rows: 5 });
assert.deepEqual(
  tiledState.slots.map((slot) => tiledState.contents[slot.contentId]?.kind).sort(),
  ["chart", "news", "ontology"]
);
assert.ok(defaultChartSlot);
assert.ok(initialNewsSlot);
assert.ok(initialOntologySlot);
assert.equal(defaultChartContent?.kind, "chart");
assert.equal(defaultChartContent?.props?.symbol, "NVDA");
assert.equal(typeof defaultChartContent?.chartDocumentId, "string");
const frontendInitialRuntime = ensureFrontendChartDocuments(createInitialChartRuntimeState(), tiledState, "NVDA");
const defaultChartDocument = defaultChartContent?.chartDocumentId
  ? frontendInitialRuntime.documents[defaultChartContent.chartDocumentId]
  : undefined;
assert.ok(defaultChartDocument);
assert.equal(defaultChartDocument.layers.volume, false);
assert.equal((defaultChartContent as Record<string, unknown> | undefined)?.isDefaultChart, undefined);
assert.equal((defaultChartSlot as Record<string, unknown> | undefined)?.required, undefined);
assert.deepEqual(defaultChartSlot.gridRect, { col: 1, row: 3, colSpan: 8, rowSpan: 3 });
assert.deepEqual(initialNewsSlot.gridRect, { col: 1, row: 1, colSpan: 4, rowSpan: 2 });
assert.deepEqual(initialOntologySlot.gridRect, { col: 5, row: 1, colSpan: 4, rowSpan: 2 });
assert.deepEqual(defaultChartSlot.rect, expectedInitialChartRect);
assert.deepEqual(initialNewsSlot.rect, expectedInitialNewsRect);
assert.deepEqual(initialOntologySlot.rect, expectedInitialOntologyRect);
assert.equal(rectBottom(defaultChartSlot.rect), tiledInnerBottom);
assert.equal(rectBottom(initialNewsSlot.rect) + tiledGutter, defaultChartSlot.rect.top);
assert.equal(rectBottom(initialOntologySlot.rect), rectBottom(initialNewsSlot.rect));
assert.ok(Math.abs(initialNewsSlot.rect.width - initialOntologySlot.rect.width) <= 1);
assert.equal(layoutHasGapsOrOverlaps(tiledState, tiledViewport), false);
const newsOntologyBoundary = detectResizablePanelBoundaries(tiledState, tiledViewport).find((boundary) => (
  boundary.orientation === "vertical" &&
  boundary.negativeSlotIds.includes("slot-news") &&
  boundary.positiveSlotIds.includes("slot-ontology")
));
assert.ok(newsOntologyBoundary);
const freeformResizedState = resizeFreeformBoundary(tiledState, newsOntologyBoundary.id, 48, tiledViewport);
assert.deepEqual(freeformResizedState.slots.map((slot) => slot.gridRect), tiledState.slots.map((slot) => slot.gridRect));
assert.ok((freeformResizedState.slots.find((slot) => slot.id === "slot-news")?.rect.width ?? 0) > initialNewsSlot.rect.width);
assert.ok((freeformResizedState.slots.find((slot) => slot.id === "slot-ontology")?.rect.width ?? 0) < initialOntologySlot.rect.width);
const minClampedFreeformState = resizeFreeformBoundary(tiledState, newsOntologyBoundary.id, 10000, tiledViewport);
const clampedOntologySlot = minClampedFreeformState.slots.find((slot) => slot.id === "slot-ontology");
assert.ok(clampedOntologySlot);
assert.ok((clampedOntologySlot?.rect.width ?? 0) >= expectedDefaultPanelMinRect.width - 0.1);
const normalizedFreeformState = normalizeFreeformRectsToGridLayout(freeformResizedState, tiledViewport);
const repeatedNormalizedFreeformState = normalizeFreeformRectsToGridLayout(freeformResizedState, tiledViewport);
assert.deepEqual(
  normalizedFreeformState.slots.map((slot) => slot.gridRect),
  repeatedNormalizedFreeformState.slots.map((slot) => slot.gridRect)
);
assert.deepEqual(
  serializeTiledPanelState(normalizedFreeformState).slots,
  normalizedFreeformState.slots.map((slot) => ({ id: slot.id, contentId: slot.contentId, gridRect: slot.gridRect }))
);
const mergedBoundaryContents = {
  "content-left-large": { id: "content-left-large", kind: "news" as const, title: "뉴스", instanceIndex: 11 },
  "content-right-top": { id: "content-right-top", kind: "ontology" as const, title: "온톨로지", instanceIndex: 12 },
  "content-right-bottom": { id: "content-right-bottom", kind: "company" as const, title: "기업정보", instanceIndex: 13 }
};
const leftLargeBoundaryState = {
  contents: mergedBoundaryContents,
  nextInstance: 14,
  slots: [
    testFreeformSlot("slot-left-large", "content-left-large", { col: 1, row: 1, colSpan: 4, rowSpan: 2 }),
    testFreeformSlot("slot-right-top", "content-right-top", { col: 5, row: 1, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-right-bottom", "content-right-bottom", { col: 5, row: 2, colSpan: 4, rowSpan: 1 })
  ]
};
const leftLargeBoundary = detectResizablePanelBoundaries(leftLargeBoundaryState, tiledViewport).find((boundary) => (
  boundary.orientation === "vertical" &&
  boundary.negativeSlotIds.includes("slot-left-large") &&
  boundary.positiveSlotIds.includes("slot-right-top") &&
  boundary.positiveSlotIds.includes("slot-right-bottom")
));
assert.ok(leftLargeBoundary);
assert.deepEqual(leftLargeBoundary.negativeSlotIds, ["slot-left-large"]);
assert.deepEqual(leftLargeBoundary.positiveSlotIds, ["slot-right-bottom", "slot-right-top"]);
const leftLargeResizedState = resizeFreeformBoundary(leftLargeBoundaryState, leftLargeBoundary.id, 48, tiledViewport);
assert.deepEqual(leftLargeResizedState.slots.map((slot) => slot.gridRect), leftLargeBoundaryState.slots.map((slot) => slot.gridRect));
assert.equal(testSlotsOverlap(leftLargeResizedState.slots), false);
assert.ok((leftLargeResizedState.slots.find((slot) => slot.id === "slot-left-large")?.rect.width ?? 0) > leftLargeBoundaryState.slots[0]!.rect.width);
assert.ok((leftLargeResizedState.slots.find((slot) => slot.id === "slot-right-top")?.rect.left ?? 0) > leftLargeBoundaryState.slots[1]!.rect.left);
assert.ok((leftLargeResizedState.slots.find((slot) => slot.id === "slot-right-bottom")?.rect.left ?? 0) > leftLargeBoundaryState.slots[2]!.rect.left);

const rightLargeBoundaryState = {
  contents: {
    "content-left-top": { id: "content-left-top", kind: "news" as const, title: "뉴스", instanceIndex: 21 },
    "content-left-bottom": { id: "content-left-bottom", kind: "company" as const, title: "기업정보", instanceIndex: 22 },
    "content-right-large": { id: "content-right-large", kind: "ontology" as const, title: "온톨로지", instanceIndex: 23 }
  },
  nextInstance: 24,
  slots: [
    testFreeformSlot("slot-left-top", "content-left-top", { col: 1, row: 1, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-left-bottom", "content-left-bottom", { col: 1, row: 2, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-right-large", "content-right-large", { col: 5, row: 1, colSpan: 4, rowSpan: 2 })
  ]
};
const rightLargeBoundary = detectResizablePanelBoundaries(rightLargeBoundaryState, tiledViewport).find((boundary) => (
  boundary.orientation === "vertical" &&
  boundary.negativeSlotIds.includes("slot-left-top") &&
  boundary.negativeSlotIds.includes("slot-left-bottom") &&
  boundary.positiveSlotIds.includes("slot-right-large")
));
assert.ok(rightLargeBoundary);
const rightLargeResizedState = resizeFreeformBoundary(rightLargeBoundaryState, rightLargeBoundary.id, -48, tiledViewport);
assert.deepEqual(rightLargeResizedState.slots.map((slot) => slot.gridRect), rightLargeBoundaryState.slots.map((slot) => slot.gridRect));
assert.equal(testSlotsOverlap(rightLargeResizedState.slots), false);
assert.ok((rightLargeResizedState.slots.find((slot) => slot.id === "slot-left-top")?.rect.width ?? 0) < rightLargeBoundaryState.slots[0]!.rect.width);
assert.ok((rightLargeResizedState.slots.find((slot) => slot.id === "slot-left-bottom")?.rect.width ?? 0) < rightLargeBoundaryState.slots[1]!.rect.width);
assert.ok((rightLargeResizedState.slots.find((slot) => slot.id === "slot-right-large")?.rect.left ?? 0) < rightLargeBoundaryState.slots[2]!.rect.left);

const topLargeBoundaryState = {
  contents: {
    "content-top-large": { id: "content-top-large", kind: "news" as const, title: "뉴스", instanceIndex: 31 },
    "content-bottom-left": { id: "content-bottom-left", kind: "ontology" as const, title: "온톨로지", instanceIndex: 32 },
    "content-bottom-right": { id: "content-bottom-right", kind: "company" as const, title: "기업정보", instanceIndex: 33 }
  },
  nextInstance: 34,
  slots: [
    testFreeformSlot("slot-top-large", "content-top-large", { col: 1, row: 1, colSpan: 8, rowSpan: 2 }),
    testFreeformSlot("slot-bottom-left", "content-bottom-left", { col: 1, row: 3, colSpan: 4, rowSpan: 3 }),
    testFreeformSlot("slot-bottom-right", "content-bottom-right", { col: 5, row: 3, colSpan: 4, rowSpan: 3 })
  ]
};
const topLargeBoundary = detectResizablePanelBoundaries(topLargeBoundaryState, tiledViewport).find((boundary) => (
  boundary.orientation === "horizontal" &&
  boundary.negativeSlotIds.includes("slot-top-large") &&
  boundary.positiveSlotIds.includes("slot-bottom-left") &&
  boundary.positiveSlotIds.includes("slot-bottom-right")
));
assert.ok(topLargeBoundary);
const topLargeResizedState = resizeFreeformBoundary(topLargeBoundaryState, topLargeBoundary.id, 48, tiledViewport);
assert.deepEqual(topLargeResizedState.slots.map((slot) => slot.gridRect), topLargeBoundaryState.slots.map((slot) => slot.gridRect));
assert.equal(testSlotsOverlap(topLargeResizedState.slots), false);
assert.ok((topLargeResizedState.slots.find((slot) => slot.id === "slot-top-large")?.rect.height ?? 0) > topLargeBoundaryState.slots[0]!.rect.height);
assert.ok((topLargeResizedState.slots.find((slot) => slot.id === "slot-bottom-left")?.rect.top ?? 0) > topLargeBoundaryState.slots[1]!.rect.top);
assert.ok((topLargeResizedState.slots.find((slot) => slot.id === "slot-bottom-right")?.rect.top ?? 0) > topLargeBoundaryState.slots[2]!.rect.top);

const minimumBlockedBoundaryState = {
  contents: mergedBoundaryContents,
  nextInstance: 14,
  slots: [
    testFreeformSlot("slot-left-large", "content-left-large", { col: 1, row: 1, colSpan: 4, rowSpan: 2 }),
    testFreeformSlot("slot-right-top", "content-right-top", { col: 5, row: 1, colSpan: 1, rowSpan: 1 }),
    testFreeformSlot("slot-right-bottom", "content-right-bottom", { col: 5, row: 2, colSpan: 4, rowSpan: 1 })
  ]
};
const minimumBlockedBoundary = detectResizablePanelBoundaries(minimumBlockedBoundaryState, tiledViewport).find((boundary) => (
  boundary.orientation === "vertical" &&
  boundary.negativeSlotIds.includes("slot-left-large") &&
  boundary.positiveSlotIds.includes("slot-right-top") &&
  boundary.positiveSlotIds.includes("slot-right-bottom")
));
assert.ok(minimumBlockedBoundary);
assert.equal(resizeFreeformBoundary(minimumBlockedBoundaryState, minimumBlockedBoundary.id, 48, tiledViewport), minimumBlockedBoundaryState);

const separatedBoundaryState = {
  contents: {
    "content-a-left": { id: "content-a-left", kind: "news" as const, title: "뉴스", instanceIndex: 41 },
    "content-a-right": { id: "content-a-right", kind: "company" as const, title: "기업정보", instanceIndex: 42 },
    "content-b-left": { id: "content-b-left", kind: "ontology" as const, title: "온톨로지", instanceIndex: 43 },
    "content-b-right": { id: "content-b-right", kind: "popular" as const, title: "인기종목", instanceIndex: 44 }
  },
  nextInstance: 45,
  slots: [
    testFreeformSlot("slot-a-left", "content-a-left", { col: 1, row: 1, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-a-right", "content-a-right", { col: 5, row: 1, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-b-left", "content-b-left", { col: 1, row: 3, colSpan: 4, rowSpan: 1 }),
    testFreeformSlot("slot-b-right", "content-b-right", { col: 5, row: 3, colSpan: 4, rowSpan: 1 })
  ]
};
const separatedVerticalBoundaries = detectResizablePanelBoundaries(separatedBoundaryState, tiledViewport).filter((boundary) => boundary.orientation === "vertical");
assert.equal(separatedVerticalBoundaries.length, 2);

const chartNewsSwapState = swapPanelContents(tiledState, "slot-chart", "slot-news", tiledViewport);
const chartNewsSwapChartSlot = chartNewsSwapState.slots.find((slot) => chartNewsSwapState.contents[slot.contentId]?.kind === "chart");
const chartNewsSwapNewsSlot = chartNewsSwapState.slots.find((slot) => chartNewsSwapState.contents[slot.contentId]?.kind === "news");
assert.ok(chartNewsSwapChartSlot);
assert.ok(chartNewsSwapNewsSlot);
assert.equal(chartNewsSwapChartSlot.id, "slot-news");
assert.deepEqual(chartNewsSwapChartSlot.rect, expectedInitialNewsRect);
assert.equal(chartNewsSwapChartSlot.minHeight, expectedChartMinRect.height);
assert.equal(chartNewsSwapNewsSlot.id, "slot-chart");
assert.deepEqual(chartNewsSwapNewsSlot.rect, expectedInitialChartRect);
assert.equal(chartNewsSwapNewsSlot.minHeight, expectedDefaultPanelMinRect.height);
assert.equal(layoutHasGapsOrOverlaps(chartNewsSwapState, tiledViewport), false);

const chartOntologySwapState = swapPanelContents(tiledState, "slot-chart", "slot-ontology", tiledViewport);
const chartOntologySwapChartSlot = chartOntologySwapState.slots.find((slot) => chartOntologySwapState.contents[slot.contentId]?.kind === "chart");
const chartOntologySwapOntologySlot = chartOntologySwapState.slots.find((slot) => chartOntologySwapState.contents[slot.contentId]?.kind === "ontology");
assert.ok(chartOntologySwapChartSlot);
assert.ok(chartOntologySwapOntologySlot);
assert.equal(chartOntologySwapChartSlot.id, "slot-ontology");
assert.deepEqual(chartOntologySwapChartSlot.rect, expectedInitialOntologyRect);
assert.equal(chartOntologySwapOntologySlot.id, "slot-chart");
assert.deepEqual(chartOntologySwapOntologySlot.rect, expectedInitialChartRect);
assert.equal(layoutHasGapsOrOverlaps(chartOntologySwapState, tiledViewport), false);

const insertionViewport = { width: 1920, height: 900 };
const insertionState = createInitialTiledPanelState(insertionViewport);
const stateWithEmptyTopLeft = removePanelSlot(insertionState, "slot-news", insertionViewport);
const stateWithNewCompany = addPanelSlotAtGridRect(stateWithEmptyTopLeft, "company", { col: 1, row: 1, colSpan: 2, rowSpan: 1 }, { symbol: "NVDA" }, insertionViewport);
const newCompanySlot = stateWithNewCompany.slots.find((slot) => (
  !stateWithEmptyTopLeft.slots.some((existing) => existing.id === slot.id) &&
  stateWithNewCompany.contents[slot.contentId]?.kind === "company"
));
assert.ok(newCompanySlot);
assert.deepEqual(newCompanySlot.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 1 });
assert.equal(stateWithNewCompany.contents[newCompanySlot.contentId]?.props?.symbol, "NVDA");
assert.equal(layoutHasGapsOrOverlaps(stateWithNewCompany, insertionViewport), false);
const movedCompanyState = movePanelSlotToGridRect(stateWithNewCompany, newCompanySlot.id, { col: 3, row: 1, colSpan: 2, rowSpan: 1 }, insertionViewport);
assert.deepEqual(movedCompanyState.slots.find((slot) => slot.id === newCompanySlot.id)?.gridRect, { col: 3, row: 1, colSpan: 2, rowSpan: 1 });
const blockedMoveState = movePanelSlotToGridRect(movedCompanyState, newCompanySlot.id, { col: 5, row: 1, colSpan: 2, rowSpan: 1 }, insertionViewport);
assert.deepEqual(blockedMoveState.slots.find((slot) => slot.id === newCompanySlot.id)?.gridRect, { col: 3, row: 1, colSpan: 2, rowSpan: 1 });
assert.equal(canPlaceGridRect(movedCompanyState, { col: 5, row: 1, colSpan: 2, rowSpan: 1 }, { kind: "company" }), false);
const resizedCompanyState = resizePanelSlotToGridRect(movedCompanyState, newCompanySlot.id, { col: 1, row: 1, colSpan: 4, rowSpan: 2 }, insertionViewport);
assert.deepEqual(resizedCompanyState.slots.find((slot) => slot.id === newCompanySlot.id)?.gridRect, { col: 1, row: 1, colSpan: 4, rowSpan: 2 });
const isolatedDropContents = {
  "content-chart": { id: "content-chart", kind: "chart" as const, title: "차트", instanceIndex: 1, chartDocumentId: "doc-chart" },
  "content-top-block": { id: "content-top-block", kind: "news" as const, title: "뉴스", instanceIndex: 2 },
  "content-mid-block": { id: "content-mid-block", kind: "news" as const, title: "뉴스", instanceIndex: 3 },
  "content-bottom-left": { id: "content-bottom-left", kind: "news" as const, title: "뉴스", instanceIndex: 4 }
};
const isolatedDropState = {
  contents: isolatedDropContents,
  nextInstance: 5,
  slots: [
    testFreeformSlot("slot-chart", "content-chart", { col: 5, row: 4, colSpan: 4, rowSpan: 2 }),
    testFreeformSlot("slot-top-block", "content-top-block", { col: 3, row: 1, colSpan: 6, rowSpan: 2 }),
    testFreeformSlot("slot-mid-block", "content-mid-block", { col: 1, row: 3, colSpan: 8, rowSpan: 1 }),
    testFreeformSlot("slot-bottom-left", "content-bottom-left", { col: 1, row: 4, colSpan: 4, rowSpan: 2 })
  ]
};
const movedChartDropPlan = resolvePanelDropGridRect(isolatedDropState, "chart", { col: 1, row: 1 }, {
  exceptSlotId: "slot-chart",
  preferredSpan: { colSpan: 4, rowSpan: 2 }
});
assert.equal(movedChartDropPlan.valid, true);
assert.deepEqual(movedChartDropPlan.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
const movedChartDropState = movePanelSlotToGridRect(isolatedDropState, "slot-chart", movedChartDropPlan.gridRect, tiledViewport);
assert.deepEqual(movedChartDropState.slots.find((slot) => slot.id === "slot-chart")?.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
assert.equal(testSlotsOverlap(movedChartDropState.slots), false);
const paletteChartDropPlan = resolvePanelDropGridRect(isolatedDropState, "chart", { col: 1, row: 1 });
assert.equal(paletteChartDropPlan.valid, true);
assert.deepEqual(paletteChartDropPlan.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
const paletteChartDropState = addPanelSlotAtGridRect(isolatedDropState, "chart", paletteChartDropPlan.gridRect, { symbol: "NVDA" }, tiledViewport);
const addedDropChartSlot = paletteChartDropState.slots.find((slot) => !isolatedDropState.slots.some((existing) => existing.id === slot.id));
assert.ok(addedDropChartSlot);
assert.deepEqual(addedDropChartSlot.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
assert.equal(testSlotsOverlap(paletteChartDropState.slots), false);
const bShapeDropContents = {
  "content-b-top-right": { id: "content-b-top-right", kind: "news" as const, title: "뉴스", instanceIndex: 1 },
  "content-b-mid-right": { id: "content-b-mid-right", kind: "news" as const, title: "뉴스", instanceIndex: 2 },
  "content-b-bottom": { id: "content-b-bottom", kind: "news" as const, title: "뉴스", instanceIndex: 3 }
};
const bShapeDropState = {
  contents: bShapeDropContents,
  nextInstance: 4,
  slots: [
    testFreeformSlot("slot-b-top-right", "content-b-top-right", { col: 2, row: 1, colSpan: 7, rowSpan: 1 }),
    testFreeformSlot("slot-b-mid-right", "content-b-mid-right", { col: 3, row: 2, colSpan: 6, rowSpan: 2 }),
    testFreeformSlot("slot-b-bottom", "content-b-bottom", { col: 1, row: 4, colSpan: 8, rowSpan: 2 })
  ]
};
const bShapeChartDropPlan = resolvePanelDropGridRect(bShapeDropState, "chart", { col: 1, row: 1 });
assert.equal(bShapeChartDropPlan.valid, true);
assert.deepEqual(bShapeChartDropPlan.gridRect, { col: 1, row: 2, colSpan: 2, rowSpan: 2 });
const tooSmallDropContents = {
  "content-small-right": { id: "content-small-right", kind: "news" as const, title: "뉴스", instanceIndex: 1 },
  "content-small-bottom": { id: "content-small-bottom", kind: "news" as const, title: "뉴스", instanceIndex: 2 }
};
const tooSmallDropState = {
  contents: tooSmallDropContents,
  nextInstance: 3,
  slots: [
    testFreeformSlot("slot-small-right", "content-small-right", { col: 2, row: 1, colSpan: 7, rowSpan: 2 }),
    testFreeformSlot("slot-small-bottom", "content-small-bottom", { col: 1, row: 3, colSpan: 8, rowSpan: 3 })
  ]
};
const tooSmallChartDropPlan = resolvePanelDropGridRect(tooSmallDropState, "chart", { col: 1, row: 1 });
assert.equal(tooSmallChartDropPlan.valid, false);
assert.equal(tooSmallChartDropPlan.reason, "minimum-span");
assert.deepEqual(tooSmallChartDropPlan.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 1 });
const ontologyWestYieldPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 4, row: 1, colSpan: 5, rowSpan: 2 });
assert.equal(ontologyWestYieldPlan.valid, true);
assert.deepEqual(ontologyWestYieldPlan.yieldedSlots, [{
  slotId: "slot-news",
  previousGridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 2 },
  gridRect: { col: 1, row: 1, colSpan: 3, rowSpan: 2 }
}]);
const ontologyWestYieldState = applyPanelResizeWithYield(tiledState, ontologyWestYieldPlan, tiledViewport);
assert.deepEqual(ontologyWestYieldState.slots.find((slot) => slot.id === "slot-ontology")?.gridRect, { col: 4, row: 1, colSpan: 5, rowSpan: 2 });
assert.deepEqual(ontologyWestYieldState.slots.find((slot) => slot.id === "slot-news")?.gridRect, { col: 1, row: 1, colSpan: 3, rowSpan: 2 });
assert.equal(layoutHasGapsOrOverlaps(ontologyWestYieldState, tiledViewport), false);
const ontologyWestBlockedPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 1, row: 1, colSpan: 8, rowSpan: 2 });
assert.equal(ontologyWestBlockedPlan.valid, false);
assert.equal(ontologyWestBlockedPlan.reason, "minimum-span");
assert.equal(applyPanelResizeWithYield(tiledState, ontologyWestBlockedPlan, tiledViewport), tiledState);
const ontologySouthYieldPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 5, row: 1, colSpan: 4, rowSpan: 3 });
assert.equal(ontologySouthYieldPlan.valid, true);
assert.deepEqual(ontologySouthYieldPlan.yieldedSlots, [{
  slotId: "slot-chart",
  previousGridRect: { col: 1, row: 3, colSpan: 8, rowSpan: 3 },
  gridRect: { col: 1, row: 4, colSpan: 8, rowSpan: 2 }
}]);
const ontologySouthYieldState = applyPanelResizeWithYield(tiledState, ontologySouthYieldPlan, tiledViewport);
assert.deepEqual(ontologySouthYieldState.slots.find((slot) => slot.id === "slot-ontology")?.gridRect, { col: 5, row: 1, colSpan: 4, rowSpan: 3 });
assert.deepEqual(ontologySouthYieldState.slots.find((slot) => slot.id === "slot-chart")?.gridRect, { col: 1, row: 4, colSpan: 8, rowSpan: 2 });
assert.equal(layoutHasGapsOrOverlaps(ontologySouthYieldState, tiledViewport), false);
const ontologySouthBlockedPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 5, row: 1, colSpan: 4, rowSpan: 5 });
assert.equal(ontologySouthBlockedPlan.valid, false);
assert.equal(ontologySouthBlockedPlan.reason, "minimum-span");
const ontologyDiagonalYieldPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 4, row: 1, colSpan: 5, rowSpan: 3 });
assert.equal(ontologyDiagonalYieldPlan.valid, true);
assert.deepEqual(ontologyDiagonalYieldPlan.yieldedSlots.map((slot) => [slot.slotId, slot.gridRect]), [
  ["slot-news", { col: 1, row: 1, colSpan: 3, rowSpan: 2 }],
  ["slot-chart", { col: 1, row: 4, colSpan: 8, rowSpan: 2 }]
]);
const cornerCollisionContents = {
  "content-source": { id: "content-source", kind: "ontology" as const, title: "온톨로지", instanceIndex: 1 },
  "content-left": { id: "content-left", kind: "news" as const, title: "뉴스", instanceIndex: 2 },
  "content-bottom": { id: "content-bottom", kind: "news" as const, title: "뉴스", instanceIndex: 3 },
  "content-corner": { id: "content-corner", kind: "news" as const, title: "뉴스", instanceIndex: 4 }
};
const cornerCollisionState = {
  contents: cornerCollisionContents,
  nextInstance: 5,
  slots: [
    { id: "slot-source", contentId: "content-source", gridRect: { col: 5, row: 2, colSpan: 2, rowSpan: 2 }, rect: panelRectForGridRect({ col: 5, row: 2, colSpan: 2, rowSpan: 2 }, tiledViewport), minWidth: 180, minHeight: 104 },
    { id: "slot-left", contentId: "content-left", gridRect: { col: 1, row: 2, colSpan: 4, rowSpan: 2 }, rect: panelRectForGridRect({ col: 1, row: 2, colSpan: 4, rowSpan: 2 }, tiledViewport), minWidth: 180, minHeight: 104 },
    { id: "slot-bottom", contentId: "content-bottom", gridRect: { col: 5, row: 4, colSpan: 2, rowSpan: 2 }, rect: panelRectForGridRect({ col: 5, row: 4, colSpan: 2, rowSpan: 2 }, tiledViewport), minWidth: 180, minHeight: 104 },
    { id: "slot-corner", contentId: "content-corner", gridRect: { col: 4, row: 4, colSpan: 1, rowSpan: 1 }, rect: panelRectForGridRect({ col: 4, row: 4, colSpan: 1, rowSpan: 1 }, tiledViewport), minWidth: 180, minHeight: 104 }
  ]
};
const cornerCollisionPlan = resolvePanelResizeWithYield(cornerCollisionState, "slot-source", { col: 4, row: 2, colSpan: 3, rowSpan: 3 });
assert.equal(cornerCollisionPlan.valid, false);
assert.equal(cornerCollisionPlan.reason, "non-yieldable-overlap");
const replacedWithTradeState = replacePanelSlotKind(resizedCompanyState, newCompanySlot.id, "trade", insertionViewport);
const replacedTradeContent = replacedWithTradeState.contents[replacedWithTradeState.slots.find((slot) => slot.id === newCompanySlot.id)?.contentId ?? ""];
assert.equal(replacedTradeContent?.kind, "trade");
assert.deepEqual(replacedWithTradeState.slots.find((slot) => slot.id === newCompanySlot.id)?.gridRect, { col: 1, row: 1, colSpan: 4, rowSpan: 2 });
const legacyBottomFlushState = {
  ...tiledState,
  slots: tiledState.slots.map((slot) => (
    slot.id === "slot-chart"
      ? { ...slot, rect: { ...slot.rect, height: rectBottom(tiledWorkspace) - slot.rect.top } }
      : slot
  ))
};
const normalizedLegacyState = scaleTiledPanelState(legacyBottomFlushState, tiledViewport, tiledViewport);
const normalizedLegacyChart = normalizedLegacyState.slots.find((slot) => slot.id === "slot-chart");
assert.ok(normalizedLegacyChart);
assert.equal(rectBottom(normalizedLegacyChart.rect), tiledInnerBottom);
const tiledContext = buildTiledAgentLayoutContext(tiledState, tiledViewport, "NVDA");
assert.equal((tiledContext as { selectedPanelId?: string }).selectedPanelId, undefined);
const selectedTiledContext = buildTiledAgentLayoutContext(tiledState, tiledViewport, "NVDA", "slot-chart");
assert.equal(selectedTiledContext.selectedPanelId, "slot-chart");
assert.equal((tiledContext.panels.find((panel) => panel.id === "slot-news") as { type?: string } | undefined)?.type, "newsFeed");
const oneGridStepFreeformState = resizeFreeformBoundary(tiledState, newsOntologyBoundary.id, expectedDefaultPanelMinRect.width + tiledGutter, tiledViewport);
const freeformAgentContext = buildTiledAgentLayoutContext(oneGridStepFreeformState, tiledViewport, "NVDA");
const freeformAgentNewsPlacement = freeformAgentContext.panels.find((panel) => panel.id === "slot-news")?.placement;
const freeformAgentOntologyPlacement = freeformAgentContext.panels.find((panel) => panel.id === "slot-ontology")?.placement;
assert.deepEqual(freeformAgentNewsPlacement, testPlacement(1, 1, 5, 2));
assert.deepEqual(freeformAgentOntologyPlacement, testPlacement(6, 1, 3, 2));
const tiledChartContext = tiledContext.panels.find((panel) => panel.id === "slot-chart") as
  | { layoutPinned?: boolean; layoutWeight?: number; minSpan?: { colSpan?: number; rowSpan?: number }; symbol?: string }
  | undefined;
assert.equal(tiledChartContext?.layoutPinned, false);
assert.equal(tiledChartContext?.layoutWeight, 100);
assert.equal(tiledChartContext?.symbol, "NVDA");
assert.deepEqual(tiledChartContext?.minSpan, { colSpan: 2, rowSpan: 1 });
assert.equal(typeof defaultChartContent?.chartDocumentId, "string");
const documentBackedChartContext = buildTiledAgentLayoutContext(tiledState, tiledViewport, "AAPL", undefined, {
  "slot-chart": "MSFT"
});
const documentBackedChartPanel = documentBackedChartContext.panels.find((panel) => panel.id === "slot-chart") as
  | { symbol?: string; props?: { symbol?: string } }
  | undefined;
const documentBackedNewsPanel = documentBackedChartContext.panels.find((panel) => panel.id === "slot-news") as
  | { symbol?: string }
  | undefined;
assert.equal(documentBackedChartPanel?.symbol, "MSFT");
assert.equal(documentBackedChartPanel?.props?.symbol, "MSFT");
assert.equal(documentBackedNewsPanel?.symbol, undefined);
const chartOnlyState = removePanelSlot(removePanelSlot(tiledState, "slot-news", tiledViewport), "slot-ontology", tiledViewport);
assert.equal(chartOnlyState.slots.length, 1);
assert.equal(chartOnlyState.slots[0]?.id, "slot-chart");
const blockedLastPanelRemoveState = removePanelSlot(chartOnlyState, "slot-chart", tiledViewport);
assert.equal(blockedLastPanelRemoveState.slots.length, 0);
const restoredSnapshotState = restoreTiledPanelStateSnapshot(serializeTiledPanelState(resizedCompanyState), insertionViewport);
assert.ok(restoredSnapshotState);
assert.deepEqual(restoredSnapshotState.slots.map((slot) => slot.gridRect), resizedCompanyState.slots.map((slot) => slot.gridRect));
const tiledNewsPropsState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled-news-props",
  title: "Update news props",
  rationale: "Test news panel props preservation.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-news", panelType: "newsFeed", layoutWeight: 80 }],
  commands: [
    makeAgentLayoutCommand("layout.panel.add", "llm", {
      panelType: "newsFeed",
      props: {
        symbol: "NVDA",
        displayMode: "dailySummary",
        dailySummaries: [
          {
            date: "2026-07-01",
            symbol: "NVDA",
            summary: "엔비디아 일일 뉴스 요약입니다.",
            keyPoints: [],
            articleIds: ["nvda-daily-1"],
            priceChange: {
              date: "2026-07-01",
              previousClose: 158.35,
              close: 158.5,
              change: 0.15,
              changePercent: 0.0947
            },
            sources: [
              {
                articleId: "nvda-daily-1",
                title: "NVIDIA shares rise",
                name: "Example News",
                url: "https://example.com/nvda-daily"
              }
            ]
          }
        ],
        latestNews: [],
        majorNews: []
      }
    }, { panelId: "slot-news" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const tiledNewsContent = tiledNewsPropsState.contents[tiledNewsPropsState.slots.find((slot) => slot.id === "slot-news")?.contentId ?? ""];
assert.equal(tiledNewsContent?.props?.symbol, "NVDA");
assert.equal(tiledNewsContent?.props?.displayMode, "dailySummary");
assert.equal(
  (((tiledNewsContent?.props?.dailySummaries as unknown[])[0] as Record<string, unknown>).sources as Array<Record<string, unknown>>)[0]?.url,
  "https://example.com/nvda-daily"
);
assert.equal(
  (((tiledNewsContent?.props?.dailySummaries as unknown[])[0] as Record<string, unknown>).priceChange as Record<string, unknown>)?.change,
  0.15
);
const originalOntologySlot = tiledState.slots.find((slot) => slot.id === "slot-ontology");
const focusedOntologyState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled",
  title: "Focus ontology",
  rationale: "Test tiled focus.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-ontology", panelType: "ontologyGraph", layoutWeight: 100 }],
  commands: [
    makeAgentLayoutCommand("layout.panel.priority.set", "llm", { panelId: "slot-ontology", layoutWeight: 100 }, { panelId: "slot-ontology" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const focusedOntologySlot = focusedOntologyState.slots.find((slot) => slot.id === "slot-ontology");
assert.deepEqual(focusedOntologySlot?.gridRect, originalOntologySlot?.gridRect);
assert.equal(focusedOntologyState.contents[focusedOntologySlot?.contentId ?? ""]?.layoutWeight, 100);
const keepChartOnlyState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled-remove",
  title: "Keep chart",
  rationale: "차트만 남기고 2개 패널을 숨겼습니다.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-chart", panelType: "chart", layoutWeight: 100 }],
  commands: [
    makeAgentLayoutCommand("layout.panel.remove", "llm", { panelId: "slot-news" }, { panelId: "slot-news" }),
    makeAgentLayoutCommand("layout.panel.remove", "llm", { panelId: "slot-ontology" }, { panelId: "slot-ontology" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
assert.equal(keepChartOnlyState.slots.length, 1);
assert.equal(keepChartOnlyState.slots[0]?.id, "slot-chart");
const restoredNewsState = applyTiledAgentLayoutProposal(keepChartOnlyState, {
  id: "layout-proposal-restore-news",
  title: "Restore news",
  rationale: "시장 뉴스 패널을 열었습니다.",
  autoApply: true,
  panelPriorities: [
    { panelId: "panel-news", panelType: "newsFeed", layoutWeight: 100 },
    { panelId: "slot-chart", panelType: "chart", layoutWeight: 60 }
  ],
  commands: [
    makeAgentLayoutCommand("layout.panel.add", "llm", {
      panelId: "panel-news",
      panelType: "newsFeed",
      props: { symbol: "NVDA" },
      symbol: "NVDA",
      layoutWeight: 100,
      placement: testPlacement(1, 1, 2, 2)
    }, { panelId: "panel-news" }),
    makeAgentLayoutCommand("layout.panel.priority.set", "llm", {
      panelId: "panel-news",
      layoutWeight: 100
    }, { panelId: "panel-news" }),
    makeAgentLayoutCommand("layout.panels.arrange", "llm", {
      placements: [
        { panelId: "panel-news", placement: testPlacement(1, 1, 2, 2), layoutWeight: 100 },
        { panelId: "slot-chart", placement: testPlacement(1, 3, 4, 3), layoutWeight: 60 }
      ]
    }, { panelId: "panel-news" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const restoredNewsSlot = restoredNewsState.slots.find((slot) => slot.id === "panel-news");
assert.ok(restoredNewsSlot);
assert.equal(restoredNewsState.contents[restoredNewsSlot?.contentId ?? ""]?.kind, "news");
assert.equal(restoredNewsState.contents[restoredNewsSlot?.contentId ?? ""]?.props?.symbol, "NVDA");
assert.equal(restoredNewsState.contents[restoredNewsSlot?.contentId ?? ""]?.layoutWeight, 100);
const arrangedOntologyState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled-arrange",
  title: "Arrange ontology",
  rationale: "Test tiled arrange.",
  autoApply: true,
  panelPriorities: [{ panelId: "slot-ontology", panelType: "ontologyGraph", layoutWeight: 100 }],
  commands: [
    makeAgentLayoutCommand("layout.panels.arrange", "llm", {
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
assert.ok(arrangedOntologyRect && originalOntologySlot && arrangedOntologyRect.left < originalOntologySlot.rect.left);
assert.ok(arrangedOntologyRect && originalOntologySlot && arrangedOntologyRect.top === originalOntologySlot.rect.top);

const chartAddState = applyTiledAgentLayoutProposal(tiledState, {
  id: "layout-proposal-tiled-chart-add",
  title: "Add AAPL chart",
  rationale: "Test chart add.",
  autoApply: true,
  panelPriorities: [
    { panelId: "panel-chart-aapl", panelType: "chart", layoutWeight: 120 },
    { panelId: "slot-chart", panelType: "chart", layoutWeight: 100 }
  ],
  commands: [
    makeAgentLayoutCommand("layout.panel.add", "llm", {
      panelId: "panel-chart-aapl",
      panelType: "chart",
      props: { symbol: "AAPL" },
      layoutWeight: 120,
      placement: testPlacement(1, 4, 4, 2)
    }, { panelId: "panel-chart-aapl" }),
    makeAgentLayoutCommand("layout.panel.priority.set", "llm", {
      panelId: "panel-chart-aapl",
      layoutWeight: 120
    }, { panelId: "panel-chart-aapl" }),
    makeAgentLayoutCommand("layout.panels.arrange", "llm", {
      placements: [
        { panelId: "slot-news", placement: testPlacement(1, 1, 1, 1), layoutWeight: 40 },
        { panelId: "slot-ontology", placement: testPlacement(2, 1, 1, 1), layoutWeight: 40 },
        { panelId: "slot-portfolio", placement: testPlacement(3, 1, 1, 1), layoutWeight: 35 },
        { panelId: "slot-trade", placement: testPlacement(4, 1, 1, 1), layoutWeight: 35 },
        { panelId: "slot-chart", placement: testPlacement(1, 2, 4, 2), layoutWeight: 100 },
        { panelId: "panel-chart-aapl", placement: testPlacement(1, 4, 4, 2), layoutWeight: 120 }
      ]
    }, { panelIds: ["slot-chart", "panel-chart-aapl"] })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const addedChartSlot = chartAddState.slots.find((slot) => slot.id === "panel-chart-aapl");
assert.ok(addedChartSlot);
assert.equal(chartAddState.contents[addedChartSlot?.contentId ?? ""]?.props?.symbol, "AAPL");
assert.equal(typeof chartAddState.contents[addedChartSlot?.contentId ?? ""]?.chartDocumentId, "string");
assert.equal(chartAddState.contents[addedChartSlot?.contentId ?? ""]?.layoutWeight, 120);
assert.deepEqual(addedChartSlot.gridRect, { col: 1, row: 4, colSpan: 4, rowSpan: 2 });
assert.equal(rectBottom(addedChartSlot.rect), tiledInnerBottom);
assert.equal(chartAddState.slots.filter((slot) => chartAddState.contents[slot.contentId]?.kind === "chart").length, 2);
assert.equal(layoutHasGapsOrOverlaps(chartAddState, tiledViewport), false);

const placementPickProposal: AgentLayoutProposal = {
  id: "layout-proposal-placement-pick",
  title: "Pick chart placement",
  rationale: "Test placement picker.",
  autoApply: false,
  commands: [
    makeAgentLayoutCommand("layout.placement.pick", "llm", {
      panelType: "chart",
      panelId: "panel-chart-tsla",
      symbol: "TSLA",
      candidates: [
        {
          id: "bottom",
          label: "맨 아래",
          placement: testPlacement(1, 4, 8, 2),
          arrangement: [
            { panelId: "slot-news", placement: testPlacement(1, 1, 4, 1), layoutWeight: 40 },
            { panelId: "slot-ontology", placement: testPlacement(5, 1, 4, 1), layoutWeight: 40 },
            { panelId: "slot-chart", placement: testPlacement(1, 2, 8, 2), layoutWeight: 100 },
            { panelId: "panel-chart-tsla", placement: testPlacement(1, 4, 8, 2), layoutWeight: 120 }
          ]
        }
      ]
    }, { panelId: "panel-chart-tsla" })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
};
const placementPickResult = applyTiledAgentLayoutProposalWithResult(tiledState, placementPickProposal, tiledViewport);
assert.equal(placementPickResult.state, tiledState);
assert.equal(placementPickResult.pendingPlacementPick?.symbol, "TSLA");
assert.equal(placementPickResult.pendingPlacementPick?.candidates[0]?.id, "bottom");
assert.equal(applyTiledAgentLayoutProposal(tiledState, placementPickProposal, tiledViewport), tiledState);
const pickedPlacementState = applyPlacementPickCandidate(
  tiledState,
  placementPickResult.pendingPlacementPick!,
  placementPickResult.pendingPlacementPick!.candidates[0]!,
  tiledViewport
);
const pickedChartSlot = pickedPlacementState.slots.find((slot) => slot.id === "panel-chart-tsla");
assert.ok(pickedChartSlot);
assert.deepEqual(pickedChartSlot.gridRect, { col: 1, row: 4, colSpan: 8, rowSpan: 2 });
assert.equal(pickedPlacementState.contents[pickedChartSlot?.contentId ?? ""]?.props?.symbol, "TSLA");

const chartPanels = [
  runtimePanel("primary-chart", "chart"),
  runtimePanel("secondary-chart", "chart", { symbol: "TSLA" })
];
assert.equal(chartPanels.length, 2);
assert.notEqual(chartPanels[0]?.chartDocumentId, chartPanels[1]?.chartDocumentId);
let multiChartRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: chartPanels
});
assert.equal(multiChartRuntime.documents[chartPanels[0]?.chartDocumentId ?? ""]?.symbol, DEFAULT_CHART_SYMBOL);
assert.equal(multiChartRuntime.documents[chartPanels[1]?.chartDocumentId ?? ""]?.symbol, "TSLA");

assert.equal(clampRightOffset(120, 72, 160), 88);
assert.equal(clampRightOffset(-120, 72, 160), -48);
assert.equal(dragDeltaToRightOffset(0, 18, 9, 72, 160), 2);
assert.equal(dragDeltaToRightOffset(8, -27, 9, 72, 160), 5);
assert.equal(horizontalWheelDeltaToRightOffset(8, 27, 9, 72, 160), 5);
assert.equal(horizontalWheelDeltaToRightOffset(8, -27, 9, 72, 160), 11);
assert.equal(horizontalWheelDeltaToRightOffset(8, 2, 9, 72, 160, 1), 4);
assert.equal(frontendClampRightOffset(-120, 72, 160), -48);
assert.equal(frontendClampRightOffset(-120, 72, 160, { extraFutureSlots: 14 }), -62);
assert.deepEqual(frontendNormalizeViewport({ visibleCount: 72, rightOffset: -120 }, 160, 640, { extraFutureSlots: 14 }), {
  visibleCount: 72,
  rightOffset: -62
});
assert.deepEqual(frontendNormalizeViewport({ visibleCount: 120, rightOffset: 0 }, 3, 640, { minimumVisibleSlots: 120 }), {
  visibleCount: 120,
  rightOffset: 0
});
assert.equal(frontendDragDeltaToRightOffset(-40, -180, 9, 72, 160, { extraFutureSlots: 14 }), -60);
assert.equal(frontendHorizontalWheelDeltaToRightOffset(0, 27, 9, 72, 160), -3);
assert.equal(resolveHorizontalWheelDelta(2, 20), 2);
assert.equal(resolveHorizontalWheelDelta(0, -4, true), -4);
assert.equal(resolveHorizontalWheelDelta(0, -4), null);
assert.equal(frontendResolveHorizontalWheelDelta(2, 20), 2);
const sparseDailyCandles = [
  testCandle("2026-07-02T04:00:00.000Z", 100),
  testCandle("2026-07-06T04:00:00.000Z", 102),
  testCandle("2026-07-07T04:00:00.000Z", 104)
];
assert.deepEqual(
  anchoredViewportForCandles(
    sparseDailyCandles,
    "1D",
    null,
    { visibleCount: 120, rightOffset: 0 },
    640,
    { minimumVisibleSlots: 120 }
  ),
  { visibleCount: 120, rightOffset: 0 }
);
const sparseDailyScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: sparseDailyCandles,
  visibleCount: 120,
  rightOffset: 0,
  requestedLimit: 120
}), 640, 360);
assert.equal(sparseDailyScene.visibleSlotCount, 120);
assert.equal(sparseDailyScene.candles.length, 3);
assert.equal(sparseDailyScene.viewportStartIndex, -117);
const restoredDailyCandles = [
  ...Array.from({ length: 117 }, (_, index) => testCandle(new Date(Date.UTC(2026, 0, index + 1, 4)).toISOString(), 80 + index)),
  ...sparseDailyCandles
];
assert.deepEqual(
  viewportPreservingRightEdgeAfterCandlesChange(
    sparseDailyCandles,
    restoredDailyCandles,
    { visibleCount: 120, rightOffset: 0 },
    640,
    { minimumVisibleSlots: 120 }
  ),
  { visibleCount: 120, rightOffset: 0 }
);
const visibleCandlesBeforePrepend = Array.from({ length: 10 }, (_, index) => testCandle(`2026-06-25T13:${String(30 + index).padStart(2, "0")}:00Z`, 100 + index));
const prependedCandles = Array.from({ length: 5 }, (_, index) => testCandle(`2026-06-25T13:${String(25 + index).padStart(2, "0")}:00Z`, 90 + index));
assert.deepEqual(
  viewportPreservingRightEdgeAfterCandlesChange(
    visibleCandlesBeforePrepend,
    [...prependedCandles, ...visibleCandlesBeforePrepend],
    { visibleCount: 6, rightOffset: 3 }
  ),
  { visibleCount: 6, rightOffset: 3 }
);
const drawingAnchorBeforePrepend = {
  timestamp: visibleCandlesBeforePrepend[4]?.timestamp,
  logicalIndex: 4,
  price: visibleCandlesBeforePrepend[4]?.close,
  paneId: "price" as const,
  symbol: "AAPL"
};
const prependedScene = buildFrontendChartScene(frontendChartState({
  interval: "1m",
  candles: [...prependedCandles, ...visibleCandlesBeforePrepend],
  visibleCount: 10,
  rightOffset: 0
}), 640, 360);
const prependedTransform = createFrontendCoordinateTransform(prependedScene);
assert.deepEqual(
  prependedTransform.anchorToPoint(drawingAnchorBeforePrepend),
  prependedTransform.anchorToPoint({
    timestamp: drawingAnchorBeforePrepend.timestamp,
    price: drawingAnchorBeforePrepend.price,
    paneId: "price",
    symbol: "AAPL"
  })
);

const drawingOutsideVisiblePriceRangeScene = buildFrontendChartScene(frontendChartState({
  candles: [testCandle("2026-06-25T13:30:00.000Z", 100)],
  visibleCount: 10,
  rightOffset: 0,
  drawings: [testDrawing({
    id: "out-of-range-drawing",
    type: "horizontalLine",
    anchors: [{
      timestamp: "2026-06-25T13:30:00.000Z",
      logicalIndex: 0,
      price: 10000,
      paneId: "price",
      symbol: "AAPL"
    }]
  })]
}), 640, 360);
assert.ok(drawingOutsideVisiblePriceRangeScene.scales.maxPrice < 1000);

const continuousAnchorBaseScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100)],
  visibleCount: 20
}), 720, 360);
const continuousAnchorUnit = continuousAnchorBaseScene.semantic.units.find((unit) => unit.kind === "candle");
assert.ok(continuousAnchorUnit);
const continuousAnchorBounds = {
  left: continuousAnchorBaseScene.plot.left + continuousAnchorUnit.slotStart * continuousAnchorBaseScene.scales.slotWidth,
  right: continuousAnchorBaseScene.plot.left + continuousAnchorUnit.slotEnd * continuousAnchorBaseScene.scales.slotWidth
};
const continuousAnchorX = continuousAnchorBounds.left + (continuousAnchorBounds.right - continuousAnchorBounds.left) * 0.75;
const continuousAnchor = createFrontendCoordinateTransform(continuousAnchorBaseScene).pointToAnchor(
  continuousAnchorX,
  continuousAnchorBaseScene.plot.top + 20,
  "AAPL"
);
assert.ok(continuousAnchor?.timestamp);
assert.notEqual(continuousAnchor?.timestamp, "2026-06-25T13:30:00Z");
const continuousAnchorExpandedScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100)],
  visibleCount: 80
}), 720, 360, { expansions: [readyExpansion] });
const continuousAnchorPoint = continuousAnchor ? createFrontendCoordinateTransform(continuousAnchorExpandedScene).anchorToPoint(continuousAnchor) : null;
const continuousAnchorExpansionRange = continuousAnchorExpandedScene.semantic.expansionRanges[0];
assert.ok(continuousAnchorPoint);
assert.equal(
  Math.round(continuousAnchorPoint?.x ?? -1),
  Math.round((continuousAnchorExpansionRange?.left ?? 0) + ((continuousAnchorExpansionRange?.right ?? 0) - (continuousAnchorExpansionRange?.left ?? 0)) * 0.75)
);
assert.equal(
  sourceIntervalForDrawingAnchors([
    { timestamp: "2026-06-25T13:40:00Z", interval: "10m", price: 101 },
    { timestamp: "2026-06-25T13:50:00Z", interval: "10m", price: 102 }
  ], "1D"),
  "10m"
);
assert.equal(
  sourceIntervalForDrawingAnchors([
    { timestamp: "2026-06-25T13:00:00Z", interval: "4h", price: 101 },
    { timestamp: "2026-06-25T14:00:00Z", interval: "1h", price: 102 }
  ], "1D"),
  "1h"
);
assert.equal(
  sourceIntervalForDrawingAnchors([
    { timestamp: "2026-06-25T13:40:00Z", interval: "10m", price: 101 },
    { timestamp: "2026-06-25T13:41:00Z", interval: "1m", price: 102 }
  ], "1D"),
  "1m"
);

const dailyDrawingScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100), testCandle("2026-06-26T13:30:00Z", 104)],
  visibleCount: 20,
  drawings: [testDrawing({
    id: "drawing-daily-zone",
    sourceInterval: "1D",
    anchors: [
      { timestamp: "2026-06-25T13:30:00Z", price: 98, paneId: "price", symbol: "AAPL" },
      { timestamp: "2026-06-26T13:30:00Z", price: 108, paneId: "price", symbol: "AAPL" }
    ],
    label: "Daily zone"
  })]
}), 720, 360, { expansions: [readyExpansion] });
const dailyProjection = resolveDrawingRenderItems(dailyDrawingScene, dailyDrawingScene.chart.drawings)
  .find((item) => item.kind === "expansionProjection");
assert.ok(dailyProjection);
assert.equal(dailyProjection.expansionId, readyExpansion.id);
assert.equal(Math.round(dailyProjection.left), Math.round(dailyDrawingScene.semantic.expansionRanges[0]?.left ?? -1));
assert.equal(Math.round(dailyProjection.right), Math.round(dailyDrawingScene.semantic.expansionRanges[0]?.right ?? -1));

const dailyLineScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100), testCandle("2026-06-26T13:30:00Z", 104)],
  visibleCount: 20,
  drawings: [testDrawing({
    id: "drawing-daily-trend",
    type: "trendLine",
    sourceInterval: "1D",
    anchors: [
      { timestamp: "2026-06-25T13:30:00Z", price: 100, paneId: "price", symbol: "AAPL" },
      { timestamp: "2026-06-26T13:30:00Z", price: 110, paneId: "price", symbol: "AAPL" }
    ],
    label: "Daily trend"
  })]
}), 720, 360, { expansions: [readyExpansion] });
const dailyLineRange = dailyLineScene.semantic.expansionRanges[0];
const dailyLineItems = resolveDrawingRenderItems(dailyLineScene, dailyLineScene.chart.drawings);
const dailyWarpedLine = dailyLineItems.find((item) => item.kind === "timeWarpedLine");
assert.ok(dailyWarpedLine);
assert.equal(dailyLineItems.some((item) => item.kind === "full" && item.drawing.id === "drawing-daily-trend"), false);
assert.equal(Math.round(dailyWarpedLine.points[0]?.x ?? -1), Math.round(dailyLineRange?.left ?? -2));
assert.equal(Math.round(dailyWarpedLine.points[dailyWarpedLine.points.length - 1]?.x ?? -1), Math.round(dailyLineRange?.right ?? -2));

const intradayDrawingScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100), testCandle("2026-06-26T13:30:00Z", 104)],
  drawings: [testDrawing({
    id: "drawing-intraday-line",
    type: "trendLine",
    sourceInterval: "1m",
    anchors: [
      { timestamp: "2026-06-25T13:40:00Z", price: 101, paneId: "price", symbol: "AAPL" },
      { timestamp: "2026-06-25T13:45:00Z", price: 102, paneId: "price", symbol: "AAPL" }
    ],
    label: "1m scalp"
  })]
}), 720, 360);
const intradayRenderItems = resolveDrawingRenderItems(intradayDrawingScene, intradayDrawingScene.chart.drawings);
assert.equal(intradayRenderItems.some((item) => item.kind === "full" && item.drawing.id === "drawing-intraday-line"), false);
assert.equal(intradayRenderItems.some((item) => item.kind === "collapsed" && item.drawing.id === "drawing-intraday-line"), true);
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
assert.doesNotMatch(appSource, /isLikelyLayoutCommand/);
assert.match(appSource, /layoutResolutionMessage/);
assert.doesNotMatch(appSource, /hasChartCommandTarget/);
assert.match(appSource, /login\(\)/);
assert.match(appSource, /openSymbolPage/);
assert.match(appSource, /syncPageSymbolFromChart/);
assert.doesNotMatch(appSource, /chartCommandTargetContentId/);
assert.match(appSource, /chartPanelHandlesRef/);
assert.doesNotMatch(appSource, /showChartInCurrentPanel/);
assert.match(appSource, /normalizedShortcutSymbols/);
assert.match(appSource, /shortcutSymbols\.length > 1/);
assert.match(appSource, /panelLayoutStorageKey/);
assert.match(appSource, /restoreTiledPanelStateSnapshot/);
assert.match(appSource, /setPrimaryChartSymbol/);
assert.match(appSource, /createInitialTiledPanelState\(viewport, \{/);
assert.match(appSource, /차트를 같이 표시했습니다/);
assert.match(appSource, /chartAction === "add"/);
assert.match(appSource, /chartTargetSymbol/);
assert.match(appSource, /isInternalLayoutRationale/);
assert.match(appSource, /ui_clarify/);
const agentShortcutIndex = appSource.indexOf("resolveAgentChartShortcut(prompt)");
assert.ok(agentShortcutIndex >= 0);
assert.ok(agentShortcutIndex < appSource.indexOf("if (mainView.mode !== \"chart\")", agentShortcutIndex));
assert.match(appSource, /기업명\/티커만 입력하면 차트를 열 수 있고/);
assert.match(appSource, /resolveAgentLayoutCommand\(analysisPayload\)/);
assert.ok(appSource.indexOf("resolveAgentLayoutCommand") < appSource.indexOf("Agent가 분석을 시작했습니다."));

const bottomCommandBarSource = readFileSync(fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)), "utf-8");
assert.match(bottomCommandBarSource, /AgentSubmitResult/);
assert.match(bottomCommandBarSource, /chart-shortcut/);
assert.match(bottomCommandBarSource, /기업명\/티커로 차트 열기/);
assert.match(bottomCommandBarSource, /선택한 자료/);
assert.match(bottomCommandBarSource, /bottom-chat-message-text/);
assert.match(bottomCommandBarSource, /bottom-chat-loading-mark/);
assert.match(bottomCommandBarSource, /bottom-chat-confidence-dot/);
assert.match(bottomCommandBarSource, /신뢰도 \$\{percent\}%/);
assert.match(bottomCommandBarSource, /aria-hidden="true">\/<\/span>/);
assert.doesNotMatch(bottomCommandBarSource, /선택한 차트에 명령하기/);
assert.match(bottomCommandBarSource, /export type BottomMenuKey = "III" \| "IV" \| "VI";/);
assert.match(bottomCommandBarSource, /const leftMenuKeys: BottomMenuKey\[\] = \[\];/);
assert.match(bottomCommandBarSource, /const rightMenuKeys: BottomMenuKey\[\] = \["IV", "III", "VI"\];/);
assert.match(bottomCommandBarSource, /aria-label="로그인"/);
assert.match(bottomCommandBarSource, /Logout\/profile live in Settings/);
assert.doesNotMatch(bottomCommandBarSource, /chart-agent-dev-toggle/);
assert.doesNotMatch(bottomCommandBarSource, /onChartCommandModeChange/);
assert.doesNotMatch(bottomCommandBarSource, /차트 조작 에이전트 테스트/);
assert.doesNotMatch(bottomCommandBarSource, /PortfolioHoldingsPanel/);
assert.match(bottomCommandBarSource, /알림설정/);
assert.match(bottomCommandBarSource, /fetchNextMarketOpen/);
assert.match(bottomCommandBarSource, /isMarketOpenNotification/);
assert.match(bottomCommandBarSource, /alertToastState\.queue\.length === 0/);
assert.doesNotMatch(bottomCommandBarSource, /createMarketOpenNotification\(nextOpenAt\), \{ autoDismissMs: alertToastAdvanceMs \}/);
assert.match(bottomCommandBarSource, /marketOpenReminderEnabled/);
assert.match(bottomCommandBarSource, /bottom-menu-panel, \.bottom-nav-actions, \.bottom-chat-panel, \.agent-dock, \.symbol-search-menu/);
assert.match(bottomCommandBarSource, /onOpenNotificationSymbol=\{\(symbol\) => \{/);
const alertMenuSource = readFileSync(fileURLToPath(new URL("../src/alerts/AlertMenu.tsx", import.meta.url)), "utf-8");
assert.match(alertMenuSource, /본장 시작 알림/);
assert.match(alertMenuSource, /is-form-only/);
assert.match(alertMenuSource, /notificationChartSymbol/);
assert.match(alertMenuSource, /onOpenNotificationSymbol\(chartSymbol\)/);
assert.match(alertMenuSource, /onClick=\{\(\) => void openNotification\(notification\)\}/);
assert.doesNotMatch(alertMenuSource, /disabled=\{saving \|\| Boolean\(notification\.readAt\)\}/);

const agentAnalysisClientSource = readFileSync(fileURLToPath(new URL("../src/agent/agentAnalysisClient.ts", import.meta.url)), "utf-8");
assert.match(agentAnalysisClientSource, /\/api\/agents\/analyze/);
assert.match(agentAnalysisClientSource, /\/api\/agents\/layout\/resolve/);
assert.match(agentAnalysisClientSource, /\/api\/agents\/entities\/resolve/);
assert.match(agentAnalysisClientSource, /EventSource/);
assert.doesNotMatch(agentAnalysisClientSource, /\/api\/llm\/chat/);

const newsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/NewsPanel.tsx", import.meta.url)), "utf-8");
assert.match(newsPanelSource, /\/api\/market\/news\/daily/);
assert.match(newsPanelSource, /limit:\s*"30"/);
assert.match(newsPanelSource, /dailySummaries/);
assert.match(newsPanelSource, /sources/);
assert.match(newsPanelSource, /priceChange/);
assert.match(newsPanelSource, /market-news-source-row/);
assert.match(newsPanelSource, /sourceIconUrl/);
assert.doesNotMatch(newsPanelSource, /일자별 뉴스 요약/);
assert.match(newsPanelSource, /impactDirection/);

const panelContentRendererSource = readFileSync(fileURLToPath(new URL("../src/components/PanelContentRenderer.tsx", import.meta.url)), "utf-8");
assert.match(panelContentRendererSource, /NewsPanel/);
assert.match(panelContentRendererSource, /OrderTicket/);
assert.match(panelContentRendererSource, /PortfolioHoldingsPanel/);
assert.match(panelContentRendererSource, /ChartComparisonPanel/);
assert.match(panelContentRendererSource, /content\.kind === "compare"/);
assert.doesNotMatch(panelContentRendererSource, /workspace-panel-empty/);
assert.match(panelContentRendererSource, /chart-instance-interval/);
assert.match(panelContentRendererSource, /chartPanelHandleRef\.current\?\.setInterval/);
assert.match(panelContentRendererSource, /chartIntervals\.map/);
assert.doesNotMatch(panelContentRendererSource, /chart-panel-drag-strip|chart-instance-close|onClosePanel|onChartSwapPointerDown/);

const portfolioHoldingsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/PortfolioHoldingsPanel.tsx", import.meta.url)), "utf-8");
assert.match(portfolioHoldingsPanelSource, /RefreshCcw/);
assert.match(portfolioHoldingsPanelSource, /포트폴리오 새로고침/);
assert.match(portfolioHoldingsPanelSource, /loadHoldings\(undefined, true\)/);

const chartPanelSource = readFileSync(fileURLToPath(new URL("../src/components/ChartPanel.tsx", import.meta.url)), "utf-8");
const chartDocumentAdapterSource = readFileSync(fileURLToPath(new URL("../src/chart/chartDocumentAdapter.ts", import.meta.url)), "utf-8");
const symbolSearchSource = readFileSync(fileURLToPath(new URL("../src/components/SymbolSearch.tsx", import.meta.url)), "utf-8");
assert.match(chartPanelSource, /visibleProfileRangeKey/);
assert.match(chartPanelSource, /closedVisibleCandles/);
assert.doesNotMatch(chartPanelSource, /chart\.layers\["volume-profile"\],\n    chart\.symbol,\n    visibleProfileRange,\n  \]/);
assert.match(chartPanelSource, /chartStateFromDocument/);
assert.match(chartPanelSource, /ChartDrawingDock/);
assert.match(chartPanelSource, /Paintbrush/);
assert.match(chartPanelSource, /chart-current-price|currentPriceMarker/);
assert.doesNotMatch(chartPanelSource, /ChevronDown|ChevronUp/);
assert.doesNotMatch(chartPanelSource, /applyChartAction|applyChartActions/);
assert.doesNotMatch(chartPanelSource, /trendMenuOpen|trend-menu/);
assert.doesNotMatch(chartPanelSource, /interval-stepper/);
assert.match(chartPanelSource, /chart\.timeframe\.set/);
assert.doesNotMatch(chartPanelSource, /chart\.comparison\.add/);
assert.match(chartPanelSource, /chart\.comparison\.remove/);
assert.match(chartPanelSource, /maxComparisonCount/);
assert.doesNotMatch(chartPanelSource, /onOpenComparisonPanel|placeholder="비교 패널"|chart-comparison-picker/);
assert.match(chartPanelSource, /comparisons: renderComparisons/);
assert.match(chartPanelSource, /trendExtensionButtons\.map/);
assert.match(chartPanelSource, /interval: chart\.interval === "footprint" \? "1m" : chart\.interval/);
assert.match(chartPanelSource, /toggleAgentSemanticUnitSelection/);
assert.match(chartPanelSource, /hitTestTimeAxisUnit/);
assert.match(chartPanelSource, /action: "dig"/);
assert.match(chartPanelSource, /action: "agent-select"/);
assert.match(symbolSearchSource, /createPortal/);
assert.match(symbolSearchSource, /position: "fixed"/);
const chartCanvasSource = readFileSync(fileURLToPath(new URL("../src/chart/ChartCanvas.tsx", import.meta.url)), "utf-8");
const semanticTimelineSource = readFileSync(fileURLToPath(new URL("../src/chart/semanticTimeline.ts", import.meta.url)), "utf-8");
assert.doesNotMatch(chartCanvasSource, /chartForScene/);
assert.match(chartCanvasSource, /\(candle\.close - baseClose\).*100/);
assert.match(chartCanvasSource, /profile\.sideClassification === "estimated" \? "Estimated VP" : "VP"/);
assert.match(chartCanvasSource, /const bollingerFillAlpha = 0\.1;/);
assert.match(chartCanvasSource, /const volumeProfileAlpha = \{[\s\S]*poc: 0\.28[\s\S]*valueAreaBase: 0\.12[\s\S]*valueAreaScale: 0\.1[\s\S]*tailBase: 0\.08[\s\S]*tailScale: 0\.06[\s\S]*pocLine: 0\.34/);
assert.match(chartCanvasSource, /const footprintBucketMinWidth = 14;/);
assert.match(chartCanvasSource, /const footprintBucketMaxWidth = 56;/);
assert.match(chartCanvasSource, /function drawCenteredFootprintCandle/);
assert.match(chartCanvasSource, /context\.fillRect\(center - candleWidth \/ 2, bodyTop, candleWidth, bodyHeight\);/);
assert.match(chartCanvasSource, /type DrawSeriesLineOptions = \{[\s\S]*connectAcrossMissing\?: boolean/);
assert.match(chartCanvasSource, /if \(!options\.connectAcrossMissing && started\)/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.upper[\s\S]*connectAcrossMissing: true/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.lower[\s\S]*connectAcrossMissing: true/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.middle[\s\S]*connectAcrossMissing: true/);
assert.match(semanticTimelineSource, /const footprintSlotWidth = 18;/);
assert.match(chartCanvasSource, /drawSelectedCandleHighlight/);
assert.match(chartCanvasSource, /selected \? colors\.caution/);
assert.match(chartCanvasSource, /drawCurrentPriceMarker/);
assert.match(chartCanvasSource, /variant:\s*"default"\s*\|\s*"currentPrice"\s*=\s*"default"/);
const drawingLabelLayerIndex = chartCanvasSource.indexOf("drawDrawingLabelsOnAxes(context, scene)");
const currentPriceLayerIndex = chartCanvasSource.indexOf("drawCurrentPriceMarker(context, scene)");
const crosshairLayerIndex = chartCanvasSource.indexOf("drawCrosshair(context, scene, crosshair)");
assert.ok(drawingLabelLayerIndex >= 0 && currentPriceLayerIndex > drawingLabelLayerIndex);
assert.ok(crosshairLayerIndex > currentPriceLayerIndex);
assert.match(chartDocumentAdapterSource, /volume: false/);

const panelLayoutSource = readFileSync(fileURLToPath(new URL("../src/layout/panelLayout.ts", import.meta.url)), "utf-8");
assert.doesNotMatch(panelLayoutSource, /id: "slot-trade"/);
assert.doesNotMatch(panelLayoutSource, /insertPanelAtBoundary|canInsertPanelAtBoundary|insertOptionsForBoundary|BoundaryInsertOption|insert-only|pageEdge|defaultInsert|minimumInsert|chartPageEdgeGuides|insertionGuidesForSlot/);
assert.match(panelLayoutSource, /detectResizablePanelBoundaries/);
assert.match(panelLayoutSource, /resizeFreeformBoundary/);
assert.match(panelLayoutSource, /normalizeFreeformRectsToGridLayout/);
const panelWorkspaceSource = readFileSync(fileURLToPath(new URL("../src/components/PanelWorkspace.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(panelWorkspaceSource, /panel-boundary-add|panel-add-menu|insertPanelAtBoundary|canInsertPanelAtBoundary|beginPanelSwap|hitTestSwappableSlot|boundaryAddMenuPosition/);
const workspacePanelFrameSource = readFileSync(fileURLToPath(new URL("../src/components/WorkspacePanelFrame.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(workspacePanelFrameSource, /workspace-panel-close|canClose|onClose/);
const panelRegistrySource = readFileSync(fileURLToPath(new URL("../src/layout/panelRegistry.ts", import.meta.url)), "utf-8");
assert.match(panelRegistrySource, /kind: "compare"[\s\S]*title: "비교"/);
assert.match(panelRegistrySource, /kind: "trade"[\s\S]*title: "주문"/);

const chartShortcutResolve = normalizeAgentEntityResolveResponse({
  status: "confirmed",
  chartShortcut: true,
  chartAction: "add",
  chartPlacementIntent: "bottom",
  symbol: "NVDA",
  symbols: ["NVDA", "AAPL"],
  canonicalName: "NVIDIA Corporation",
  matchedText: "엔비디아",
  matchedAlias: "엔비디아",
  confidence: 0.98,
  entityType: "company",
  reason: "matched exact catalog alias"
});
assert.equal(chartShortcutResolve.status, "confirmed");
assert.equal(chartShortcutResolve.chartShortcut, true);
assert.equal(chartShortcutResolve.chartAction, "add");
assert.equal(chartShortcutResolve.chartPlacementIntent, "bottom");
assert.equal(chartShortcutResolve.symbol, "NVDA");
assert.deepEqual(chartShortcutResolve.symbols, ["NVDA", "AAPL"]);
assert.equal(chartShortcutResolve.canonicalName, "NVIDIA Corporation");
assert.equal(chartShortcutResolve.confidence, 0.98);

const unsupportedChartShortcutResolve = normalizeAgentEntityResolveResponse({ status: "confirmed", chartShortcut: false });
assert.equal(unsupportedChartShortcutResolve.status, "confirmed");
assert.equal(unsupportedChartShortcutResolve.chartShortcut, false);
assert.equal(unsupportedChartShortcutResolve.chartAction, undefined);

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
      makeAgentLayoutCommand("layout.panel.priority.set", "llm", { panelId: "slot-ontology", layoutWeight: 100 })
    ],
    createdAt: "2026-06-29T00:00:00.000Z"
  },
  agentTrace: { uiLayoutFastAck: true }
});
assert.equal(layoutResolve.status, "ui_layout");
assert.equal(layoutResolve.summary, "변경했습니다.");
assert.equal(layoutResolve.route?.intentType, "ui-layout");
assert.equal(layoutResolve.layoutProposal?.commands[0]?.type, "layout.panel.priority.set");

const layoutClarifyResolve = normalizeAgentLayoutResolveResponse({
  status: "ui_clarify",
  summary: "어떤 패널을 어떻게 바꿀지 조금 더 구체적으로 말해 주세요.",
  route: { source: "ui-parser", intentType: "ui-clarify", selectedRoles: [] },
  layoutProposal: null,
  agentTrace: {}
});
assert.equal(layoutClarifyResolve.status, "ui_clarify");
assert.equal(layoutClarifyResolve.summary, "어떤 패널을 어떻게 바꿀지 조금 더 구체적으로 말해 주세요.");

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
  references: [],
  uiContext: {},
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

const agentLayoutContext = buildTiledAgentLayoutContext(createInitialTiledPanelState(tiledViewport), tiledViewport);
const agentLayoutPanels = (agentLayoutContext as { panels: Array<Record<string, unknown>> }).panels;
assert.deepEqual(agentLayoutPanels.map((panel) => panel.type).sort(), ["chart", "newsFeed", "ontologyGraph"]);
assert.equal(agentLayoutPanels.some((panel) => panel.type === "orderTicket"), false);
assert.equal(agentLayoutPanels.some((panel) => panel.type === "portfolioHoldings"), false);
const expandedAgentLayoutState = applyTiledAgentLayoutProposal(createInitialTiledPanelState(tiledViewport), {
  id: "layout-proposal-order-portfolio-context",
  title: "Open order and portfolio panels",
  rationale: "Test optional panel context contracts.",
  autoApply: true,
  panelPriorities: [
    { panelId: "panel-order", panelType: "orderTicket", layoutWeight: 50 },
    { panelId: "panel-portfolio", panelType: "portfolioHoldings", layoutWeight: 50 }
  ],
  commands: [
    makeAgentLayoutCommand("layout.panel.add", "llm", {
      panelId: "panel-order",
      panelType: "orderTicket",
      placement: testPlacement(7, 1, 2, 2)
    }, { panelId: "panel-order" }),
    makeAgentLayoutCommand("layout.panel.add", "llm", {
      panelId: "panel-portfolio",
      panelType: "portfolioHoldings",
      placement: testPlacement(5, 1, 2, 2)
    }, { panelId: "panel-portfolio" }),
    makeAgentLayoutCommand("layout.panels.arrange", "llm", {
      placements: [
        { panelId: "slot-news", placement: testPlacement(1, 1, 2, 2), layoutWeight: 50 },
        { panelId: "slot-ontology", placement: testPlacement(3, 1, 2, 2), layoutWeight: 50 },
        { panelId: "panel-portfolio", placement: testPlacement(5, 1, 2, 2), layoutWeight: 50 },
        { panelId: "panel-order", placement: testPlacement(7, 1, 2, 2), layoutWeight: 50 },
        { panelId: "slot-chart", placement: testPlacement(1, 3, 8, 3), layoutWeight: 100 }
      ]
    })
  ],
  createdAt: "2026-06-29T00:00:00.000Z"
}, tiledViewport);
const expandedAgentLayoutPanels = (buildTiledAgentLayoutContext(expandedAgentLayoutState, tiledViewport) as { panels: Array<Record<string, unknown>> }).panels;
const agentLayoutOrderPanel = expandedAgentLayoutPanels.find((panel) => panel.type === "orderTicket");
assert.equal(agentLayoutOrderPanel?.title, "주문");
assert.deepEqual(agentLayoutOrderPanel?.minSpan, { colSpan: 1, rowSpan: 1 });
assert.deepEqual(agentLayoutOrderPanel?.maxSpan, { colSpan: 8, rowSpan: 5 });
assert.equal("aliases" in (agentLayoutOrderPanel ?? {}), false);
const agentLayoutPortfolioPanel = expandedAgentLayoutPanels.find((panel) => panel.type === "portfolioHoldings");
assert.equal(agentLayoutPortfolioPanel?.title, "포트폴리오");
assert.deepEqual(agentLayoutPortfolioPanel?.minSpan, { colSpan: 1, rowSpan: 1 });
assert.deepEqual(agentLayoutPortfolioPanel?.maxSpan, { colSpan: 8, rowSpan: 5 });
assert.equal("aliases" in (agentLayoutPortfolioPanel ?? {}), false);

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
  },
  finalResponse: {
    confidence: 0.78,
    risk_warnings: [],
    data_freshness_warnings: []
  }
});
assert.equal(agentAnalysisReport.notificationDecision, null);
assert.equal(agentAnalysisReport.layoutProposal, null);
assert.equal(agentAnalysisReport.finalResponse?.confidence, 0.78);
const agentAnalysisMessage = formatAgentAnalysisReport(agentAnalysisReport);
assert.match(agentAnalysisMessage, /NVDA 주가 변동 원인 분석/);
assert.match(agentAnalysisMessage, /차트, 뉴스, 기업 관계 근거를 종합/);
assert.match(agentAnalysisMessage, /확인된 근거/);
assert.match(agentAnalysisMessage, /Headline: News summary/);
assert.doesNotMatch(agentAnalysisMessage, /Agent findings:/);
assert.doesNotMatch(agentAnalysisMessage, /Chart Agent: Chart shows a visible breakout\./);
assert.doesNotMatch(agentAnalysisMessage, /데이터 한계:/);
assert.doesNotMatch(agentAnalysisMessage, /뉴스 데이터 미확인/);
assert.doesNotMatch(agentAnalysisMessage, /거시 데이터 미확인/);
assert.doesNotMatch(agentAnalysisMessage, /확인되지 않은 내용:/);
assert.doesNotMatch(agentAnalysisMessage, /직접 지배\/자회사 관계 근거는 확인되지 않았습니다/);
assert.doesNotMatch(agentAnalysisMessage, /Provider status|GraphDB|ClickHouse|Redis|providerEvidence/);
assert.doesNotMatch(agentAnalysisMessage, /알림 판단:/);
assert.doesNotMatch(agentAnalysisMessage, /검증 결과: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /검증 경고: No trading-action guardrail violation detected\./);
assert.doesNotMatch(agentAnalysisMessage, /URL 없는 온톨로지 근거/);
assert.doesNotMatch(agentAnalysisMessage, /verification-guardrail:/);
assert.doesNotMatch(agentAnalysisMessage, /제한 사항/);
assert.doesNotMatch(agentAnalysisMessage, /Macro provider not configured\./);
assert.match(agentAnalysisMessage, /검색 0\.2초 \/ 전체 1\.1초/);
assert.doesNotMatch(agentAnalysisMessage, /캐시 사용/);

const finalAnswerFirstReport = normalizeAgentAnalysisReport({
  ...agentAnalysisReport,
  analysisId: "analysis-final-answer-first",
  agentAnswers: [
    {
      agentId: "news-agent",
      role: "news-analysis",
      title: "뉴스 독립 답변",
      content: "뉴스 역할 답변입니다.",
      citations: []
    }
  ]
});
const finalAnswerFirstMessage = formatAgentAnalysisReport(finalAnswerFirstReport);
const finalAnswerIndex = finalAnswerFirstMessage.indexOf("NVDA 주가 변동 원인 분석");
const detailEvidenceIndex = finalAnswerFirstMessage.indexOf("세부 근거");
assert.ok(finalAnswerIndex >= 0 && detailEvidenceIndex > finalAnswerIndex);
assert.match(finalAnswerFirstMessage, /세부 근거/);
assert.match(finalAnswerFirstMessage, /뉴스 독립 답변/);

const frontendStylesSource = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8");
const bottomCommandBarSourceForAgentAnalysis = readFileSync(fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)), "utf-8");
assert.match(frontendStylesSource, /\.bottom-chat-message p \{[\s\S]*white-space: pre-wrap;/);
assert.match(frontendStylesSource, /\.bottom-chat-message \{[\s\S]*max-width: min\(720px, 88%\);/);
assert.match(frontendStylesSource, /\.agent-analysis-details summary \{[\s\S]*cursor: pointer;/);
assert.match(bottomCommandBarSourceForAgentAnalysis, /analysisReport\?: AgentAnalysisReport \| null;/);
assert.match(bottomCommandBarSourceForAgentAnalysis, /<AgentAnalysisChatMessage report=\{entry\.analysisReport\}/);
assert.match(bottomCommandBarSourceForAgentAnalysis, /<details className="agent-analysis-details">/);
assert.match(bottomCommandBarSourceForAgentAnalysis, /"판단 근거", "분석한 지표", "반대로 볼 점"/);
assert.match(frontendStylesSource, /\.bottom-chat-message\.is-pending \.bottom-chat-message-text \{[\s\S]*color: var\(--color-muted-medium\);/);
assert.match(frontendStylesSource, /\.bottom-chat-loading-mark \{[\s\S]*font-weight: 800;[\s\S]*animation: bottom-chat-loading-spin/);
assert.match(frontendStylesSource, /\.bottom-chat-confidence-dot\.high \{[\s\S]*background: #1f9d55;/);
assert.match(frontendStylesSource, /\.bottom-chat-confidence-dot\.medium \{[\s\S]*background: #d69e2e;/);
assert.match(frontendStylesSource, /\.bottom-chat-confidence-dot\.low \{[\s\S]*background: #d64545;/);
assert.match(frontendStylesSource, /@keyframes bottom-chat-loading-spin/);
assert.match(frontendStylesSource, /\.chart-add-dock \.chart-add-layer-button\.active \{[\s\S]*background: var\(--chart-layer-accent, var\(--color-preview\)\);/);
assert.match(frontendStylesSource, /\.chart-add-dock \.chart-add-layer-button\.active \{[\s\S]*color: #fff;/);
assert.match(frontendStylesSource, /\.treemap-panel \{[\s\S]*position: absolute;/);
assert.match(frontendStylesSource, /\.treemap-panel \{[\s\S]*overflow: hidden;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*left: 0;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*right: 0;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*flex-wrap: nowrap;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*padding: 5px var\(--layout-gutter\);/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*box-sizing: border-box;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*scroll-padding-inline: var\(--layout-gutter\);/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*left: 0;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*right: 0;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*flex-wrap: nowrap;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*padding: 5px var\(--layout-gutter\);/);
assert.match(frontendStylesSource, /\.layout-preset-dock-tail \{[\s\S]*display: inline-flex;/);
assert.match(frontendStylesSource, /\.layout-exit-button \{[\s\S]*width: calc\(var\(--bottom-control-size\) \* 2 \+ 15px\);/);
const pendingChatMessageBlock = frontendStylesSource.match(/\.bottom-chat-message\.is-pending \{[^}]*\}/)?.[0] ?? "";
assert.doesNotMatch(pendingChatMessageBlock, /opacity:/);
assert.doesNotMatch(frontendStylesSource, /\.bottom-chat-message\.assistant p,[\s\S]*box-shadow: inset 0 0 0 1px/);

const zeroTimingReport = normalizeAgentAnalysisReport({
  ...agentAnalysisReport,
  analysisId: "analysis-zero-timing",
  timing: { totalMs: 0, newsFetchMs: 0 }
});
assert.doesNotMatch(formatAgentAnalysisReport(zeroTimingReport), /검색 0\.0초|전체 0\.0초/);

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
            displayMode: "dailySummary",
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
                status: "final",
                priceChange: {
                  date: "2026-07-01",
                  previousClose: 158.35,
                  close: 158.5,
                  change: 0.15,
                  changePercent: 0.0947
                },
                sources: [
                  {
                    articleId: "nvda-daily-1",
                    title: "NVIDIA shares rise after earnings",
                    name: "Example News",
                    url: "https://example.com/nvda-daily",
                    publishedAt: "2026-07-01T12:00:00.000Z"
                  }
                ]
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
assert.equal(
  ((((agentNewsPanelReport.layoutProposal?.commands[0]?.payload.props as Record<string, unknown>)?.dailySummaries as unknown[])[0] as Record<string, unknown>)
    .sources as Array<Record<string, unknown>>)[0]?.url,
  "https://example.com/nvda-daily"
);
assert.equal(
  (((agentNewsPanelReport.layoutProposal?.commands[0]?.payload.props as Record<string, unknown>)?.dailySummaries as Array<Record<string, unknown>>)[0]
    .priceChange as Record<string, unknown>)?.change,
  0.15
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
assert.equal(
  (((agentNewsPanelUpdateReport.layoutProposal?.commands[0]?.payload.props as Record<string, unknown>)?.latestNews as unknown[]) ?? []).length,
  1
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

const regressionPanelA = runtimePanel("regression-chart-a", "chart", { symbol: "AAPL" });
const regressionPanelB = runtimePanel("regression-chart-b", "chart", { symbol: "TSLA" });
const regressionNewsPanel = runtimePanel("regression-news", "newsFeed");
const regressionPanels = [regressionPanelA, regressionPanelB, regressionNewsPanel];
const regressionDocAId = regressionPanelA.chartDocumentId ?? "";
const regressionDocBId = regressionPanelB.chartDocumentId ?? "";
assert.ok(regressionDocAId);
assert.ok(regressionDocBId);
assert.notEqual(regressionDocAId, regressionDocBId);

let regressionRuntime = chartRuntimeReducer(createInitialChartRuntimeState(), {
  kind: "chart.ensureDocuments",
  panels: regressionPanels
});
assert.equal(regressionRuntime.documents[regressionDocAId]?.symbol, "AAPL");
assert.equal(regressionRuntime.documents[regressionDocBId]?.symbol, "TSLA");

assert.equal(findTargetChartPanel(regressionPanels, regressionPanelB.id)?.id, regressionPanelB.id);
assert.equal(findTargetChartPanel(regressionPanels, regressionNewsPanel.id)?.id, regressionPanelA.id);
assert.equal(findTargetChartPanel(regressionPanels, undefined)?.id, regressionPanelA.id);
assert.equal(resolveAgentChartReference(regressionPanels, regressionRuntime, undefined), null);
const referenceToA = { panelId: regressionPanelA.id, chartDocumentId: regressionDocAId, draftSeed: DEFAULT_AGENT_DRAFT_SEED };
const resolvedReferenceToA = resolveAgentChartReference(regressionPanels, regressionRuntime, referenceToA);
assert.equal(resolvedReferenceToA?.panel.id, regressionPanelA.id);
assert.equal(resolvedReferenceToA?.document.id, regressionDocAId);
assert.equal(resolveAgentChartReference(regressionPanels, regressionRuntime, {
  panelId: regressionNewsPanel.id,
  chartDocumentId: regressionDocAId
}), null);
assert.equal(isAgentChartReferenceAvailable(regressionPanels, referenceToA), true);
assert.equal(isAgentChartReferenceAvailable(regressionPanels.filter((panel) => panel.id !== regressionPanelA.id), referenceToA), false);
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

assert.equal(regressionRuntime.documents[regressionDocAId]?.history.length, 3);
assert.equal(regressionRuntime.documents[regressionDocBId]?.history.length, 0);
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
  panels: regressionPanels.filter((panel) => panel.id !== regressionPanelA.id)
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
  const frontendComparisonChart = chartStateFromDocument(
    comparisonResult.document,
    [candleA, candleB],
    { state: "ready", updatedAt: "2026-06-25T13:31:00.000Z" },
    "idle"
  );
  assert.equal(frontendComparisonChart.comparisons.length, 1);
  const frontendSpyComparison = frontendComparisonChart.comparisons[0];
  assert.ok(frontendSpyComparison);
  assert.equal(frontendSpyComparison.symbol, "SPY");
  const highPriceComparisonCandles = [
    { ...candleA, open: 900, high: 930, low: 880, close: 900 },
    { ...candleB, open: 900, high: 950, low: 890, close: 990 }
  ];
  const frontendComparisonScene = buildFrontendChartScene({
    ...frontendComparisonChart,
    visibleCount: 2,
    rightOffset: 0,
    comparisons: [{
      ...frontendSpyComparison,
      candles: highPriceComparisonCandles,
      scopes: [{
        key: "SPY|root|1m|test",
        interval: "1m",
        candles: highPriceComparisonCandles,
        status: "ready"
      }],
      status: "ready"
    }]
  }, 640, 320);
  assert.ok(frontendComparisonScene.scales.maxPrice < 20);
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
assert.equal(loosePreview?.drawings[0]?.style.color, undefined);
assert.equal(loosePreview?.drawings[0]?.style.colorToken, "drawing");
assert.equal(loosePreview?.drawings[0]?.style.lineWidth, 1.0);
assert.equal(loosePreview?.comparisons[0]?.style.color, undefined);
assert.equal(loosePreview?.comparisons[0]?.style.colorToken, "drawing");
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
assert.equal(directPreview?.drawings[0]?.style.color, undefined);
assert.equal(directPreview?.drawings[0]?.style.colorToken, "drawing");
assert.equal(directPreview?.comparisons[0]?.style.color, undefined);
assert.equal(directPreview?.comparisons[0]?.style.colorToken, "drawing");
