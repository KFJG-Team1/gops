import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "./contextualAgentProps.test";
import "./commentaryNavigation.test";
import "./drawingTools.test";
import "./uiScale.test";
import "./glossary.test";
import "./analysisAssets.test";
import "./tradeTimingOverlay.test";
import "./tradePlanOverlayLayout.test";
import "./patternBadge.test";
import "./tradePlanStore.test";
import "./commentaryModel.test";
import "./chartCommentaryHistory.test";
import "./chartTradeAutomation.test";
import "./watchlistAgentCommand.test";
import "./analysisAssetsCache.test";
import "./chartAnalysisAssetRuntimeStore.test";
import "./notificationInboxState.test";
import "./paperHoldingPrice.test";
import "./chartTradeMarkers.test";
import "./chartEventPopoverLayout.test";
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
import { parsePortfolioHoldingsApiResponse, validPortfolioCash } from "../src/components/portfolioHoldingsApi";
import {
  DEFAULT_AGENT_DRAFT_SEED,
  isAgentChartReferenceAvailable,
  resolveAgentChartReference,
  resolveAgentSendContent
} from "../../chart-engine/src/agentReference";
import { applyCandleEvent, applySnapshotToCandles, candleKey } from "../../chart-engine/src/candleStore";
import { createChartDocument, normalizeChartDocument } from "../../chart-engine/src/chartDocuments";
import { findTargetChartPanel } from "../../chart-engine/src/chartPanelSelection";
import { executeChartCommand, executeChartCommandGroup, makeChartCommand, validateChartProposal } from "../../chart-engine/src/commands";
import { buildTrendParallelLines, projectTrendLine } from "../../chart-engine/src/drawingGeometry";
import { applyDisplayContinuity } from "../../chart-engine/src/displayContinuity";
import { defaultVisibleBarsForInterval, maxRequestBarsForInterval, normalizeChartInterval } from "../../chart-engine/src/intervals";
import { isRealtimeControlPayload, isRealtimeLayerPayload, normalizeCandleEvent, normalizeCandleSnapshot, normalizeRealtimeLayerEvent } from "../../chart-engine/src/marketDataAdapter";
import { buildChartAgentContext, buildChartProposalRequest } from "../../chart-engine/src/proposals";
import { buildRenderScene } from "../../chart-engine/src/renderScene";
import {
  chartRuntimeReducer,
  createInitialChartRuntimeState,
  getLiveTradeForSymbol,
  maxInactiveCandleCacheKeys,
  type ChartRuntimePanel
} from "../../chart-engine/src/runtime";
import { createCoordinateTransform } from "../../chart-engine/src/scales";
import { DEFAULT_CHART_SYMBOL, defaultWatchlistSymbols, normalizeHotRankingPayload, normalizeSupportedSymbol, normalizeWatchlistPayload } from "../../chart-engine/src/symbols";
import { fallbackChartStyle, normalizeChartStyle, setDefaultChartStyle } from "../../chart-engine/src/theme";
import type { CandleData, ChartPendingPreview, ChartProposal } from "../../chart-engine/src/types";
import { normalizeAgentEntityResolveResponse, normalizeAgentLayoutResolveResponse } from "../src/agent/agentAnalysisClient";
import {
  agentReferenceChipKind,
  agentReferenceTicker,
  stockRecommendationReference
} from "../src/agent/agentReferences";
import { deleteAllAlerts } from "../src/alerts/alertApi";
import { formatNotificationToastMessage, notificationSummary } from "../src/alerts/alertPresentation";
import { createMarketOpenNotification, readMarketOpenReminderEnabled, shouldShowMarketOpenReminder } from "../src/alerts/marketOpenReminder";
import {
  normalizeNotificationPreferences,
  notificationSettingForItem,
  shouldShowNotificationToast
} from "../src/alerts/notificationPreferences";
import { normalizeNextMarketOpen } from "../src/market/marketOpenApi";
import type { AgentLayoutCommand, AgentLayoutCommandType, AgentLayoutProposal, CommandActor } from "../src/layout/agentLayoutTypes";
import {
  advanceTimestampByInterval,
  buildSemanticTimeline,
  nextDigTargetInterval,
  semanticExpansionId,
  semanticNodeId,
  type SemanticExpansion
} from "../src/chart/semanticTimeline";
import {
  anchoredViewportForCandles,
  viewportCenteredOnLogicalIndex,
  viewportCenteredOnSceneX,
  viewportAfterOlderCandlesLoaded,
  viewportAfterSnapshotCandlesChange,
  viewportPreservingRightEdgeAfterCandlesChange,
  viewportRevealingPrependedCandlesAfterChange
} from "../src/chart/intervalNavigation";
import { resolveDrawingRenderItems } from "../src/chart/drawingProjection";
import {
  buildChartScene as buildFrontendChartScene,
  chartPriceAxisPoint,
  createCoordinateTransform as createFrontendCoordinateTransform,
  formatPriceAxisValue as formatFrontendPriceAxisValue,
  paneSeparatorYs,
  isChartRightAxisPoint,
  isPriceAxisPricePanePoint,
  resolveCrosshairTimeTarget,
  slotCenterToX,
  viewportAnchorRatioAtX,
  viewportSlotWidth
} from "../src/chart/scene";
import { createIndicatorPointLookup, createIndicatorValueLookup, mergeIndicatorSeries, scopedIndicatorSeriesKey } from "../src/chart/indicatorSeries";
import {
  candleMovingAverageWindows,
  indicatorRequestRangeFromCandles,
  serverIndicatorLayersForLayers
} from "../src/chart/indicatorLayerPolicy";
import { derivedClientCacheMaxEntries, stableVolumeProfileRangeKey } from "../src/chart/derivedRequestPolicy";
import { fetchVolumeProfile } from "../src/chart/cdcClient";
import {
  chartEventMarkersForScene,
  chartEventRequestRange,
  chartEventTargetCandleIndex,
  latestChartEventRefreshRange,
  mergeChartEventsResponses,
  missingChartEventRanges,
  syncChartEventMarkerPositions,
  type ChartEventsResponse
} from "../src/chart/chartEvents";
import { volumeProfilePartialRetryDelaysMs, volumeProfileResponseMatchesRequest } from "../src/chart/volumeProfilePolicy";
import { indicatorRequestLimitForInterval, maxIndicatorRequestBars } from "../src/chart/indicatorRequestPolicy";
import {
  olderRangeQueuedRetryDelayMs,
  olderRangeRequestKey,
  olderRangeRetryAfterMs,
  olderRangeTerminalRetryDelayMs,
  shouldRequestOlderRange
} from "../src/chart/olderRangeRequestPolicy";
import { drawingLabelLayout, drawingLabelPosition, hitTestDrawing, sourceIntervalForDrawingAnchors } from "../src/chart/drawings";
import { chartStateFromDocument, ensureFrontendChartDocuments } from "../src/chart/chartDocumentAdapter";
import {
  bidAskChartIntervals,
  chartIntervals,
  defaultBidAskInterval,
  defaultVisibleBarsForBidAskInterval,
  isBidAskChartInterval,
  type CandleDto,
  type ChartState,
  type DrawingEntity,
  type VolumeProfileResponseDto
} from "../src/chart/types";
import { fetchOrderFlowSymbols, orderFlowDemoContextFromCandles } from "../src/chart/orderFlowClient";
import { fetchDemoOrderFlowIntraday } from "../src/chart/orderFlowDemoData";
import {
  autoOrderFlowTargetRows,
  autoPriceStep,
  buildBidAskPriceGrid,
  buildLadder,
  effectiveOrderFlowPriceStep,
  maxOrderFlowTargetRowsForHeight,
  orderFlowMinutesForBucket,
  orderFlowWindowMinutesForInterval,
  rebinLevels,
  replaceOrderFlowMinute,
  resolveOrderFlowTargetRows,
  stepOrderFlowTargetRows,
  sumOrderFlowBucketLevels,
  sumMinuteWindows,
  visibleScaleMax,
  type OrderFlowMinuteUpdate
} from "../src/chart/orderFlow";
import { orderFlowChartRowScaleMax, projectOrderFlowChartRows } from "../src/chart/orderFlowRender";
import { OrderFlowBucketCache } from "../src/chart/orderFlowBucketCache";
import { priceScaleHeadroom, priceTickCountForHeight, resolvePriceScale } from "../src/chart/priceScale";
import {
  addPanelSlotAtGridRect,
  applyPanelResizeWithYield,
  canPlaceGridRect,
  createInitialTiledPanelState,
  createTiledPanelStateFromSpec,
  detectResizablePanelBoundaries,
  layoutHasGapsOrOverlaps,
  gridRectForPanelDrag,
  movePanelSlotToGridRect,
  normalizeFreeformRectsToGridLayout,
  panelGridSpec,
  panelMinimumRenderedSizeForKind,
  panelRectForGridRect,
  panelGutter,
  removePanelSlot,
  replacePanelSlotKind,
  resolvePanelDropGridRect,
  resolvePanelResizeWithYield,
  restoreTiledPanelStateSnapshot,
  scaleTiledPanelState,
  serializeTiledPanelState,
  setCompanyInformationSymbol,
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
import {
  DEFAULT_PRESETS,
  applyLayoutLoadProposalToPresets,
  buildAgentLayoutPresetSummaries,
  buildPresetLayout,
  isLikelyPresetLoadPrompt
} from "../src/layout/layoutPresets";
import { createMainViewUrl, resolveMainViewFromUrl } from "../src/navigation/mainViewUrl";
import {
  isSelectedRecommendationCompanyPrompt,
  resolveRecommendationCompanyNavigation
} from "../src/recommendations/recommendationNavigation";
import {
  clampRightOffset,
  clampVisibleCount,
  dragDeltaToRightOffset,
  horizontalWheelDeltaToRightOffset,
  latestCandleRightOffset,
  normalizeViewport,
  resolveHorizontalWheelDelta,
  resolveViewportVisibleCount,
  zoomViewport
} from "../../chart-engine/src/viewport";
import {
  clampRightOffset as frontendClampRightOffset,
  clampVisibleCount as frontendClampVisibleCount,
  dragDeltaToRightOffset as frontendDragDeltaToRightOffset,
  futureEmptySlotCount as frontendFutureEmptySlotCount,
  horizontalWheelDeltaToRightOffset as frontendHorizontalWheelDeltaToRightOffset,
  latestCandleRightOffset as frontendLatestCandleRightOffset,
  normalizeViewport as frontendNormalizeViewport,
  resolveHorizontalWheelDelta as frontendResolveHorizontalWheelDelta,
  viewportNeedsOlderCandles,
  zoomViewport as frontendZoomViewport
} from "../src/chart/viewport";
import {
  createTreeMapOpacityScale,
  formatTreeMapChange,
  tileFillForChange,
  tileOpacityForChange,
  tileTextForOpacity
} from "../src/treemap/treemapColors";
import { layoutSp500TreeMap } from "../src/treemap/treemapLayout";

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

const marketClosedNotification = {
  id: 3,
  eventId: "system.market_closed:2026-07-14:user-a",
  type: "system.market_closed",
  payload: {
    kind: "market_closed",
    title: "미국 정규장 마감",
    summary: "미국 정규장이 마감했습니다.",
    effectiveAt: "2026-07-14T20:00:00Z",
    expiresAt: "2026-07-14T20:02:00Z"
  }
};
const marketClosedToast = formatNotificationToastMessage(marketClosedNotification);
assert.equal(marketClosedToast.title, "미국 정규장 마감");
assert.equal(marketClosedToast.message, "미국 정규장이 마감했습니다.");
assert.equal(marketClosedToast.chartSymbol, "");

const marketMoveNotification = {
  id: 4,
  eventId: "market-move:2026-07-14:user-a:NVDA:down:5",
  type: "system.market_move",
  payload: {
    kind: "market_move",
    symbol: "NVDA",
    title: "NVDA 정규장 급락",
    summary: "전일 정규장 종가 대비 -5.75% 하락했습니다.",
    previousClose: 100,
    lastPrice: 94.25,
    changePercent: -5.75,
    quoteAsOf: "2026-07-14T14:00:00Z"
  }
};
const marketMoveToast = formatNotificationToastMessage(marketMoveNotification);
assert.equal(marketMoveToast.message, "전일 정규장 종가 대비 -5.75% 하락했습니다.");
assert.equal(marketMoveToast.detail, "현재가 94.25 · 전일 정규장 종가 100");
assert.equal(notificationSettingForItem(marketMoveNotification), "rapidMove");

const volumeAgentNotification = {
  id: -1,
  eventId: "agent-volume-spike",
  type: "AGENT_ALERT",
  payload: {
    symbol: "NVDA",
    decision: {
      symbol: "NVDA",
      eventType: "volume_spike",
      summary: "NVDA 1m candle volume rose 2.40x above its rolling baseline.",
      metrics: { interval: "1m", multiplier: 2.4 }
    }
  }
};
const volumeAgentToast = formatNotificationToastMessage(volumeAgentNotification);
assert.equal(volumeAgentToast.title, "거래량 급증");
assert.equal(volumeAgentToast.message, "NVDA 1분봉 거래량이 최근 평균의 2.4배까지 증가했습니다.");

const dailyLossAgentNotification = {
  id: -1,
  eventId: "agent-daily-loss",
  type: "AGENT_ALERT",
  payload: {
    symbol: "PORTFOLIO",
    decision: {
      symbol: "PORTFOLIO",
      eventType: "risk_daily_loss_limit",
      summary: "오늘 손실이 설정한 일일 손실 보호 한도에 도달했습니다."
    }
  }
};
const dailyLossAgentToast = formatNotificationToastMessage(dailyLossAgentNotification);
assert.equal(dailyLossAgentToast.title, "일일 손실 한도");
assert.equal(dailyLossAgentToast.message, "오늘 손실이 설정한 일일 손실 보호 한도에 도달했습니다.");

const originalAlertApiFetch = globalThis.fetch;
try {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "/api/alerts");
    assert.equal(init?.method, "DELETE");
    return new Response(JSON.stringify({ deleted: 3, projectionStatus: "synced" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  assert.equal(await deleteAllAlerts(), 3);
} finally {
  globalThis.fetch = originalAlertApiFetch;
}
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
    style: { color: "#0052ff", fillColor: "#0052ff", fillOpacity: 0.12 },
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

const compiledSma120Ops = compileDeterministicChartOperations({
  query: "120일선 보여줘",
  chart: frontendChartState({ layers: { candles: true, "sma:120": false } })
});
assert.equal(compiledSma120Ops.handled, true);
assert.ok(compiledSma120Ops.actions.some((action) => (
  action.type === "setLayer" && action.layer === "sma:120" && action.enabled
)));

assert.equal(createChartDocument("chart-doc-themed-default", "AAPL", "1m").style.background, fallbackChartStyle.background);
assert.equal(createChartDocument("chart-doc-themed-default-bullish", "AAPL", "1m").style.bullish, fallbackChartStyle.bullish);
const chartTypeDefaultDocument = createChartDocument("chart-doc-type-default", "AAPL", "1m");
assert.equal(chartTypeDefaultDocument.chartType, "candle");
assert.equal(chartTypeDefaultDocument.layers["sma:5"], false);
assert.equal(chartTypeDefaultDocument.layers.ma5, false);
assert.equal(chartTypeDefaultDocument.layers["sma:120"], false);
assert.equal(chartTypeDefaultDocument.layers["events:earnings"], true);
assert.equal(chartTypeDefaultDocument.layers["events:news"], true);
const legacyEventLayerDocument = createChartDocument("chart-doc-event-layer-legacy", "AAPL", "1D");
delete legacyEventLayerDocument.layers["events:earnings"];
delete legacyEventLayerDocument.layers["events:news"];
const normalizedLegacyEventLayers = normalizeChartDocument(legacyEventLayerDocument);
assert.equal(normalizedLegacyEventLayers.layers["events:earnings"], true);
assert.equal(normalizedLegacyEventLayers.layers["events:news"], true);
const explicitHiddenEventLayerDocument = createChartDocument("chart-doc-event-layer-hidden", "AAPL", "1D");
explicitHiddenEventLayerDocument.layers["events:earnings"] = false;
explicitHiddenEventLayerDocument.layers["events:news"] = false;
const normalizedHiddenEventLayers = normalizeChartDocument(explicitHiddenEventLayerDocument);
assert.equal(normalizedHiddenEventLayers.layers["events:earnings"], false);
assert.equal(normalizedHiddenEventLayers.layers["events:news"], false);
assert.equal(fallbackChartStyle.background, "#090909");
assert.equal(fallbackChartStyle.text, "#ffffff");
assert.equal(fallbackChartStyle.grid, "rgba(255, 255, 255, 0.08)");
assert.equal(fallbackChartStyle.volume, "rgba(255, 255, 255, 0.12)");
assert.equal(fallbackChartStyle.bullish, "#22c55e");
assert.equal(fallbackChartStyle.bearish, "#ff5577");
assert.equal(fallbackChartStyle.evidenceTrend, fallbackChartStyle.axis);
setDefaultChartStyle({
  background: "#242832",
  bullish: "#05b169",
  bearish: "#cf202f",
  ma5: "#0052ff"
});
const themedDocument = createChartDocument("chart-doc-themed-custom", "AAPL", "1m");
assert.equal(themedDocument.style.background, "#242832");
assert.equal(themedDocument.style.bullish, "#05b169");
assert.equal(themedDocument.style.bearish, "#cf202f");
assert.equal(themedDocument.style.ma5, "#0052ff");
setDefaultChartStyle(fallbackChartStyle);

const chartEventsFixture: ChartEventsResponse = {
  symbol: "AAPL",
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.000Z",
  status: { earnings: "ready", news: "ready" },
  earnings: [{
    id: "earnings:AAPL:2026-07-15",
    type: "earnings",
    eventAt: "2026-07-15T20:05:00.000Z",
    status: "reported",
    session: "after",
    eps: { actual: 1.4, estimate: 1.25, surprise: 0.15, surprisePercent: 12 },
    source: "yahoo-finance",
    sourceAsOf: "2026-07-16T22:30:00.000Z"
  }],
  newsDays: [{
    id: "news:AAPL:2026-07-15",
    type: "news",
    date: "2026-07-15",
    articleCount: 3,
    summary: "Apple daily news",
    keyPoints: ["Product launch"],
    impactDirection: "mixed",
    sentiment: "neutral",
    sources: [{ title: "Apple launch", url: "https://example.com/apple", publishedAt: "2026-07-15T14:10:00.000Z" }]
  }],
  upcomingEarnings: null
};
assert.deepEqual(chartEventRequestRange([testCandle("2026-07-15T04:00:00.000Z")], "1D"), {
  from: "2026-07-15T04:00:00.000Z",
  to: "2026-07-16T03:59:59.999Z"
});
const dailyEventScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [
    testCandle("2026-07-14T04:00:00.000Z"),
    testCandle("2026-07-15T04:00:00.000Z"),
    testCandle("2026-07-16T04:00:00.000Z")
  ],
  visibleCount: 3,
  layers: { candles: true, volume: false, "events:earnings": true, "events:news": true }
}), 800, 360);
const dailyEventMarkers = chartEventMarkersForScene(dailyEventScene, chartEventsFixture, { earnings: true, news: true });
assert.equal(dailyEventMarkers.length, 2);
assert.equal(dailyEventMarkers[0].label, "E");
assert.equal(dailyEventMarkers[1].label, "N");
const dailyEventCandle = dailyEventScene.semantic.units.find((unit) => (
  unit.kind === "candle"
  && unit.depth === 0
  && unit.timestamp === "2026-07-15T04:00:00.000Z"
));
assert.ok(dailyEventCandle);
const dailyEventCandleX = slotCenterToX(dailyEventScene, dailyEventCandle.slotCenter);
assert.equal(dailyEventMarkers[0].x, dailyEventCandleX);
assert.equal(dailyEventMarkers[1].x, dailyEventCandleX);
assert.notEqual(dailyEventMarkers[0].top, dailyEventMarkers[1].top);
const scaledEventMarkers = chartEventMarkersForScene(
  dailyEventScene,
  chartEventsFixture,
  { earnings: true, news: true },
  { width: dailyEventScene.width / 0.8, height: dailyEventScene.height / 0.8 }
);
assert.equal(scaledEventMarkers[0].x, dailyEventCandleX / 0.8);
assert.equal(scaledEventMarkers[1].x, dailyEventCandleX / 0.8);
assert.equal(scaledEventMarkers[0].top, dailyEventMarkers[0].top / 0.8);
const movingEventElement = {
  dataset: { chartEventId: dailyEventMarkers[0].id },
  style: { left: "0px", top: "0px", visibility: "" }
};
const staleEventElement = {
  dataset: { chartEventId: "news:AAPL:stale" },
  style: { left: "10px", top: "10px", visibility: "" }
};
syncChartEventMarkerPositions({
  querySelectorAll: () => [movingEventElement, staleEventElement]
} as unknown as ParentNode, [{ ...dailyEventMarkers[0], x: 123.25, top: 271.5 }]);
assert.deepEqual(movingEventElement.style, { left: "123.25px", top: "271.5px", visibility: "" });
assert.equal(staleEventElement.style.visibility, "hidden");
const intradayEventScene = buildFrontendChartScene(frontendChartState({
  interval: "1h",
  candles: [
    testCandle("2026-07-15T13:30:00.000Z"),
    testCandle("2026-07-15T14:30:00.000Z"),
    testCandle("2026-07-15T20:00:00.000Z")
  ],
  visibleCount: 3,
  layers: { candles: true, volume: false, "events:earnings": true, "events:news": true }
}), 800, 360);
assert.equal(chartEventMarkersForScene(intradayEventScene, chartEventsFixture, { earnings: true, news: true }).length, 2);
assert.equal(
  chartEventTargetCandleIndex(intradayEventScene.allCandles, "1h", chartEventsFixture.newsDays[0]),
  1
);
assert.equal(
  chartEventTargetCandleIndex(intradayEventScene.allCandles, "1h", chartEventsFixture.earnings[0]),
  2
);
assert.equal(
  chartEventTargetCandleIndex(dailyEventScene.allCandles, "1D", chartEventsFixture.newsDays[0]),
  1
);
const weeklyEventScene = buildFrontendChartScene(frontendChartState({
  interval: "1W",
  candles: [testCandle("2026-07-13T04:00:00.000Z")],
  visibleCount: 1,
  layers: { candles: true, volume: false, "events:earnings": true, "events:news": true }
}), 800, 360);
assert.equal(chartEventMarkersForScene(weeklyEventScene, chartEventsFixture, { earnings: true, news: true }).length, 2);
const monthlyEventScene = buildFrontendChartScene(frontendChartState({
  interval: "1M",
  candles: [testCandle("2026-07-01T04:00:00.000Z")],
  visibleCount: 1,
  layers: { candles: true, volume: false, "events:earnings": true, "events:news": true }
}), 800, 360);
assert.equal(chartEventMarkersForScene(monthlyEventScene, chartEventsFixture, { earnings: true, news: true }).length, 2);
assert.equal(chartEventMarkersForScene(dailyEventScene, chartEventsFixture, { earnings: false, news: true }).length, 1);
assert.deepEqual(missingChartEventRanges(
  { symbol: "AAPL", from: "2026-07-10T00:00:00.000Z", to: "2026-07-31T23:59:59.000Z" },
  { symbol: "AAPL", from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.000Z" }
), [{ from: "2026-07-01T00:00:00.000Z", to: "2026-07-10T00:00:00.000Z" }]);
const refreshedNewsFixture: ChartEventsResponse = {
  ...chartEventsFixture,
  from: "2026-07-31T23:59:58.000Z",
  newsDays: [{
    ...chartEventsFixture.newsDays[0],
    articleCount: 4,
    summary: "Updated Apple daily news"
  }]
};
const mergedChartEvents = mergeChartEventsResponses(chartEventsFixture, [refreshedNewsFixture], {
  symbol: "AAPL",
  from: chartEventsFixture.from,
  to: chartEventsFixture.to
});
assert.equal(mergedChartEvents?.newsDays[0]?.articleCount, 4);
assert.equal(mergedChartEvents?.earnings.length, 1);
assert.deepEqual(latestChartEventRefreshRange({ from: chartEventsFixture.from, to: chartEventsFixture.to }), {
  from: "2026-07-31T23:59:58.000Z",
  to: chartEventsFixture.to
});
assert.equal(normalizeChartStyle({ background: "#ffffff", bullish: "#05b169" }).background, fallbackChartStyle.background);
assert.equal(normalizeChartStyle({ background: "#ffffff", bullish: "#05b169" }).bullish, fallbackChartStyle.bullish);

assert.deepEqual(candleMovingAverageWindows, [5, 20, 60]);
assert.deepEqual(serverIndicatorLayersForLayers({
  ma5: true,
  "sma:20": true,
  "sma:60": true,
  "sma:120": true,
  "ema:20": true,
  "rsi:14": true
}), ["sma:120", "ema:20", "rsi:14"]);
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
  up: "#05b169",
  upSoft: "#05b169",
  down: "#cf202f",
  downSoft: "#cf202f",
  changeUp: "#05b169",
  changeDown: "#cf202f",
  tileText: "#0a0b0d",
  tileTextInverse: "#ffffff"
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
assert.equal(formatTreeMapChange(null), "—");
assert.equal(formatTreeMapChange(undefined), "—");
assert.equal(formatTreeMapChange(0), "0.00%");
assert.equal(formatTreeMapChange(1.234), "+1.23%");
const nullableChangeTiles = layoutSp500TreeMap([
  {
    symbol: "AAPL",
    companyName: "Apple",
    sector: "Information Technology",
    industry: "Hardware",
    value: 100,
    marketCap: 100,
    changePercent: 10
  },
  {
    symbol: "MSFT",
    companyName: "Microsoft",
    sector: "Information Technology",
    industry: "Software",
    value: 100,
    marketCap: 100,
    changePercent: null
  }
], { x: 0, y: 0, width: 400, height: 240 });
assert.equal(nullableChangeTiles.find((tile) => tile.kind === "sector")?.changePercent, 10);
assert.equal(nullableChangeTiles.find((tile) => tile.symbol === "MSFT")?.changePercent, null);

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

const bidAskChartTypeResult = executeChartCommand(
  documentB,
  makeChartCommand("chart.type.set", "user", target("panel-b", documentB.id), { chartType: "bidask" })
);
assert.equal(bidAskChartTypeResult.ok, true);
if (bidAskChartTypeResult.ok) {
  assert.equal(bidAskChartTypeResult.document.chartType, "bidask");
  const frontendBidAskState = chartStateFromDocument(
    { ...bidAskChartTypeResult.document, timeframe: "unsupported" },
    [],
    { state: "ready", updatedAt: "2026-06-25T13:31:00.000Z" },
    "idle"
  );
  assert.equal(frontendBidAskState.chartType, "bidask");
  assert.equal(frontendBidAskState.interval, defaultBidAskInterval);
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

const sma120Result = executeChartCommand(
  documentB,
  makeChartCommand("chart.layer.visibility.set", "user", target("panel-b", documentB.id), {
    layer: "sma:120",
    visible: true
  })
);
assert.equal(sma120Result.ok, true);
if (sma120Result.ok) {
  assert.equal(sma120Result.document.layers["sma:120"], true);
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
assert.equal(sparseMinuteTimeline.expansionExtraSlots, 0);
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
const gapCrosshairTarget = resolveCrosshairTimeTarget(
  sparseMinuteScene,
  insideGapX ?? sparseMinuteScene.plot.left,
  (sparseMinuteScene.plot.top + sparseMinuteScene.plot.priceBottom) / 2
);
assert.equal(gapCrosshairTarget?.kind, "semantic");
assert.equal(gapCrosshairTarget?.unit?.kind, "time-gap");
assert.equal(gapCrosshairTarget?.x, insideGapX);
const afterGapAnchorRatio = viewportAnchorRatioAtX(sparseMinuteScene, afterGapX ?? sparseMinuteScene.plot.left);
const afterGapVisualRatio = ((afterGapX ?? sparseMinuteScene.plot.left) - sparseMinuteScene.plot.left) / (sparseMinuteScene.plot.right - sparseMinuteScene.plot.left);
assert.ok(Math.abs(afterGapVisualRatio - afterGapAnchorRatio) < 0.000001);
assert.equal(sparseMinuteScene.semantic.expansionExtraSlots, 0);
assert.equal(
  frontendDragDeltaToRightOffset(
    -frontendFutureEmptySlotCount(6),
    -sparseMinuteScene.scales.slotWidth,
    sparseMinuteScene.scales.slotWidth,
    6,
    sparseMinuteCandles.length,
    { extraFutureSlots: sparseMinuteScene.semantic.expansionExtraSlots }
  ),
  -frontendFutureEmptySlotCount(6)
);
const compressedGapScene = buildFrontendChartScene(frontendChartState({
  symbol: "MU",
  interval: "1m",
  candles: [
    testCandle("2026-07-09T05:36:00Z", 100),
    testCandle("2026-07-09T06:50:00Z", 101)
  ] as CandleDto[],
  visibleCount: 6,
  requestedLimit: 6
}), 600, 320);
const compressedGapViewportSlotWidth = viewportSlotWidth(compressedGapScene);
assert.ok(compressedGapScene.scales.slotWidth < compressedGapViewportSlotWidth / 2);
assert.equal(
  frontendHorizontalWheelDeltaToRightOffset(
    -frontendFutureEmptySlotCount(6),
    -compressedGapScene.scales.slotWidth,
    compressedGapScene.scales.slotWidth,
    6,
    compressedGapScene.allCandles.length,
    0,
    compressedGapScene.scales.slotWidth * 6,
    { extraFutureSlots: compressedGapScene.semantic.expansionExtraSlots }
  ),
  -frontendFutureEmptySlotCount(6) + 1
);
const priorGapViewportCandles = [
  testCandle("2026-07-09T05:00:00Z", 99),
  testCandle("2026-07-09T06:00:00Z", 100),
  testCandle("2026-07-09T06:01:00Z", 101),
  testCandle("2026-07-09T06:02:00Z", 102),
  testCandle("2026-07-09T06:03:00Z", 103),
  testCandle("2026-07-09T06:04:00Z", 104)
] as CandleDto[];
const priorGapViewportTimeline = buildSemanticTimeline({
  symbol: "MU",
  interval: "1m",
  candles: priorGapViewportCandles,
  expansions: [],
  visibleStartIndex: 2,
  visibleEndIndex: 6,
  viewportStartIndex: 2,
  visibleSlotCount: 4
});
const firstViewportCandleAfterPriorGap = priorGapViewportTimeline.units.find(
  (unit) => unit.kind === "candle" && unit.sourceIndex === 2
);
assert.equal(firstViewportCandleAfterPriorGap?.kind, "candle");
assert.equal(firstViewportCandleAfterPriorGap?.slotStart, 0);
assert.ok(priorGapViewportTimeline.totalSlots <= 4);
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
const volumeProfileAxisCandles = [
  testCandle("2026-06-25T13:30:00.000Z", 100),
  testCandle("2026-06-25T13:31:00.000Z", 101)
];
const volumeProfileAxisScene = buildFrontendChartScene(frontendChartState({
  interval: "1m",
  candles: volumeProfileAxisCandles,
  visibleCount: 2,
  layers: { candles: true, volume: false, ma5: false, ma20: false, ma60: false, "sma:120": true },
  indicatorSeries: {
    "sma:120": volumeProfileAxisCandles.map((candle) => ({ timestamp: candle.timestamp, value: 140 }))
  }
}), 720, 420);
assert.ok(volumeProfileAxisScene.scales.maxPrice > Math.max(...volumeProfileAxisCandles.map((candle) => candle.high)));
const volumeProfileAxisTransform = createFrontendCoordinateTransform(volumeProfileAxisScene);
const volumeProfileAxisStep = (volumeProfileAxisScene.scales.maxPrice - volumeProfileAxisScene.scales.minPrice) / 10;
const volumeProfileBoundaryYs = Array.from({ length: 11 }, (_, index) => (
  volumeProfileAxisTransform.priceToY(volumeProfileAxisScene.scales.minPrice + index * volumeProfileAxisStep)
));
const volumeProfileSlotHeights = volumeProfileBoundaryYs.slice(1).map((value, index) => Math.abs(value - volumeProfileBoundaryYs[index]));
const expectedVolumeProfileSlotHeight = (volumeProfileAxisScene.plot.priceBottom - volumeProfileAxisScene.plot.top) / 10;
assert.ok(volumeProfileSlotHeights.every((height) => Math.abs(height - expectedVolumeProfileSlotHeight) < 0.000001));
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
  assert.ok(expandedIndicatorScene.scales.minPrice > 90);
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
const intervalAdvanceCases = [
  ["1m", "2026-01-31T23:32:00.000Z"],
  ["5m", "2026-01-31T23:40:00.000Z"],
  ["10m", "2026-01-31T23:50:00.000Z"],
  ["1h", "2026-02-01T01:30:00.000Z"],
  ["4h", "2026-02-01T07:30:00.000Z"],
  ["1D", "2026-02-02T23:30:00.000Z"],
  ["1W", "2026-02-14T23:30:00.000Z"],
  ["1M", "2026-03-01T00:00:00.000Z"]
] as const;
intervalAdvanceCases.forEach(([interval, expected]) => {
  assert.equal(advanceTimestampByInterval("2026-01-31T23:30:00.000Z", interval, 2), expected);
});
assert.equal(advanceTimestampByInterval("not-a-timestamp", "1D"), null);
const emptyCrosshairScene = buildFrontendChartScene(frontendChartState({ candles: [] }), 800, 360);
assert.equal(
  resolveCrosshairTimeTarget(
    emptyCrosshairScene,
    emptyCrosshairScene.plot.right / 2,
    (emptyCrosshairScene.plot.top + emptyCrosshairScene.plot.priceBottom) / 2
  ),
  null
);

const latestFutureUnit = noExpansionFutureScene.semantic.unitById.get(semanticFutureParentNodeId);
assert.ok(latestFutureUnit?.kind === "candle");
if (latestFutureUnit?.kind === "candle") {
  const crosshairY = (noExpansionFutureScene.plot.top + noExpansionFutureScene.plot.priceBottom) / 2;
  const latestTarget = resolveCrosshairTimeTarget(
    noExpansionFutureScene,
    noExpansionFutureScene.plot.left + latestFutureUnit.slotCenter * noExpansionFutureScene.scales.slotWidth,
    crosshairY
  );
  assert.equal(latestTarget?.kind, "semantic");
  assert.equal(latestTarget?.timestamp, semanticFutureParent.timestamp);

  const futureStartX = noExpansionFutureScene.plot.left + latestFutureUnit.slotEnd * noExpansionFutureScene.scales.slotWidth;
  const firstFutureTarget = resolveCrosshairTimeTarget(
    noExpansionFutureScene,
    futureStartX + noExpansionFutureScene.scales.slotWidth * 0.1,
    crosshairY
  );
  const sameFutureTarget = resolveCrosshairTimeTarget(
    noExpansionFutureScene,
    futureStartX + noExpansionFutureScene.scales.slotWidth * 0.9,
    crosshairY
  );
  const thirdFutureTarget = resolveCrosshairTimeTarget(
    noExpansionFutureScene,
    futureStartX + noExpansionFutureScene.scales.slotWidth * 2.1,
    crosshairY
  );
  assert.equal(firstFutureTarget?.kind, "future");
  assert.equal(firstFutureTarget?.futureIndex, 0);
  assert.equal(firstFutureTarget?.timestamp, advanceTimestampByInterval(semanticFutureParent.timestamp, "1D", 1));
  assert.equal(sameFutureTarget?.x, firstFutureTarget?.x);
  assert.equal(sameFutureTarget?.timestamp, firstFutureTarget?.timestamp);
  assert.equal(thirdFutureTarget?.futureIndex, 2);
  assert.equal(thirdFutureTarget?.timestamp, advanceTimestampByInterval(semanticFutureParent.timestamp, "1D", 3));
  assert.ok(Math.abs((thirdFutureTarget?.x ?? 0) - (firstFutureTarget?.x ?? 0) - noExpansionFutureScene.scales.slotWidth * 2) < 0.000001);
  assert.equal(resolveCrosshairTimeTarget(noExpansionFutureScene, noExpansionFutureScene.plot.right + 1, crosshairY), null);
}
const semanticFutureScene = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 80,
  rightOffset: futureOffsetWithSemanticWidth
}), 800, 360, { expansions: [semanticFutureExpansion] });
assert.equal(semanticFutureScene.plot.top, 60);
assert.equal(semanticFutureScene.viewportStartIndex, frontendFutureEmptySlotCount(80) + semanticFutureExtraSlots);
assert.equal(Math.ceil(semanticFutureScene.semantic.expansionExtraSlots), semanticFutureExtraSlots);
const latestExpansionRange = semanticFutureScene.semantic.expansionRanges.find(
  (range) => range.parentNodeId === semanticFutureParentNodeId
);
assert.ok(latestExpansionRange);
if (latestExpansionRange) {
  const crosshairY = (semanticFutureScene.plot.top + semanticFutureScene.plot.priceBottom) / 2;
  const futureStartX = semanticFutureScene.plot.left + latestExpansionRange.slotEnd * semanticFutureScene.scales.slotWidth;
  const expansionFutureTarget = resolveCrosshairTimeTarget(
    semanticFutureScene,
    futureStartX + semanticFutureScene.scales.slotWidth * 0.25,
    crosshairY
  );
  assert.equal(expansionFutureTarget?.kind, "future");
  assert.equal(expansionFutureTarget?.futureIndex, 0);
  assert.equal(expansionFutureTarget?.timestamp, advanceTimestampByInterval(semanticFutureParent.timestamp, "1D"));
}
const pannedAwayLatestScene = buildFrontendChartScene(frontendChartState({
  candles: semanticFutureCandles as CandleDto[],
  visibleCount: 20,
  rightOffset: 10
}), 800, 360);
const pannedAwayTarget = resolveCrosshairTimeTarget(
  pannedAwayLatestScene,
  pannedAwayLatestScene.plot.right - pannedAwayLatestScene.scales.slotWidth / 2,
  (pannedAwayLatestScene.plot.top + pannedAwayLatestScene.plot.priceBottom) / 2
);
assert.equal(pannedAwayTarget?.kind, "semantic");
assert.notEqual(pannedAwayTarget?.timestamp, semanticFutureParent.timestamp);
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
const multiBelowPaneSeparatorYs = paneSeparatorYs(multiBelowPaneScene.plot);
assert.equal(multiBelowPaneSeparatorYs.length, multiBelowPaneScene.plot.belowPanes.length);
multiBelowPaneSeparatorYs.forEach((separatorY, index) => {
  const previousBottom = index === 0
    ? multiBelowPaneScene.plot.priceBottom
    : multiBelowPaneScene.plot.belowPanes[index - 1].bottom;
  const paneTop = multiBelowPaneScene.plot.belowPanes[index].top;
  assert.ok(separatorY > previousBottom && separatorY < paneTop);
});
assert.equal(multiBelowPaneScene.plot.top, 34);
assert.equal(multiBelowPaneScene.plot.bottom, 420);
assert.equal(multiBelowPaneScene.width - multiBelowPaneScene.plot.right, 68);
assert.equal(formatFrontendPriceAxisValue(210), "210.00");
assert.equal(formatFrontendPriceAxisValue(1356.22), "1356.22");
assert.equal(formatFrontendPriceAxisValue(-12.3), "-12.30");
assert.equal(formatFrontendPriceAxisValue(1.2345, 4), "1.2345");
assert.equal(formatFrontendPriceAxisValue(Number.NaN), "-");
const priceAxisMidY = (multiBelowPaneScene.plot.top + multiBelowPaneScene.plot.priceBottom) / 2;
assert.equal(isPriceAxisPricePanePoint(multiBelowPaneScene, multiBelowPaneScene.plot.right + 10, priceAxisMidY), true);
assert.equal(isPriceAxisPricePanePoint(multiBelowPaneScene, multiBelowPaneScene.plot.right - 1, priceAxisMidY), false);
assert.equal(isPriceAxisPricePanePoint(multiBelowPaneScene, multiBelowPaneScene.plot.right + 10, multiBelowPaneScene.plot.priceBottom + 1), false);
assert.equal(isChartRightAxisPoint(multiBelowPaneScene, multiBelowPaneScene.plot.right + 10, multiBelowPaneScene.plot.priceBottom + 1), true);
const selectedAxisPrice = chartPriceAxisPoint(multiBelowPaneScene, multiBelowPaneScene.plot.right + 10, priceAxisMidY);
assert.equal(selectedAxisPrice?.formattedPrice, selectedAxisPrice?.price.toFixed(2));
assert.equal(chartPriceAxisPoint(multiBelowPaneScene, multiBelowPaneScene.plot.right + 10, multiBelowPaneScene.plot.bottom), null);
const priceDensityCandles = [
  testCandle("2026-07-09T00:00:00.000Z", 150),
  testCandle("2026-07-10T00:00:00.000Z", 164)
] as CandleDto[];
const compactPriceDensityScene = buildFrontendChartScene(frontendChartState({
  candles: priceDensityCandles,
  visibleCount: 6,
  layers: { candles: true, volume: false }
}), 800, 360);
const tallPriceDensityScene = buildFrontendChartScene(frontendChartState({
  candles: priceDensityCandles,
  visibleCount: 6,
  layers: { candles: true, volume: false }
}), 800, 760);
assert.equal(compactPriceDensityScene.plot.bottom, 326);
const compactPricePaneHeight = compactPriceDensityScene.plot.priceBottom - compactPriceDensityScene.plot.top;
const tallPricePaneHeight = tallPriceDensityScene.plot.priceBottom - tallPriceDensityScene.plot.top;
assert.equal(
  compactPriceDensityScene.scales.priceTicks.length,
  priceTickCountForHeight(compactPricePaneHeight)
);
assert.equal(
  tallPriceDensityScene.scales.priceTicks.length,
  priceTickCountForHeight(tallPricePaneHeight)
);
const compactPriceTransform = createFrontendCoordinateTransform(compactPriceDensityScene);
const visiblePriceMax = Math.max(...priceDensityCandles.map((candle) => candle.high));
const visiblePriceMin = Math.min(...priceDensityCandles.map((candle) => candle.low));
const compactHeadroom = priceScaleHeadroom(compactPricePaneHeight);
assert.ok(Math.abs(compactPriceTransform.priceToY(visiblePriceMax) - compactPriceDensityScene.plot.top - compactHeadroom.topPx) < 0.000001);
assert.ok(Math.abs(compactPriceDensityScene.plot.priceBottom - compactPriceTransform.priceToY(visiblePriceMin) - compactHeadroom.bottomPx) < 0.000001);
assert.ok(Math.abs(compactPriceTransform.yToPrice(compactPriceTransform.priceToY(157.25)) - 157.25) < 0.000001);
assert.ok(compactPriceDensityScene.scales.priceTicks.every((tick) => (
  tick >= compactPriceDensityScene.scales.minPrice && tick <= compactPriceDensityScene.scales.maxPrice
)));
assert.deepEqual(priceScaleHeadroom(200), { topPx: 18, bottomPx: 22 });
assert.deepEqual(priceScaleHeadroom(760), { topPx: 44, bottomPx: 50 });
assert.ok(Math.abs(priceScaleHeadroom(320).topPx - 24) < 0.000001);
assert.ok(Math.abs(priceScaleHeadroom(320).bottomPx - 27.2) < 0.000001);
assert.ok(Math.abs(compactPriceDensityScene.scales.priceTicks[0] - compactPriceDensityScene.scales.minPrice) < 0.000001);
assert.ok(Math.abs(compactPriceDensityScene.scales.priceTicks.at(-1)! - compactPriceDensityScene.scales.maxPrice) < 0.000001);
const compactTickYs = compactPriceDensityScene.scales.priceTicks.map((tick) => compactPriceTransform.priceToY(tick));
const compactTickPixelGaps = compactTickYs.slice(1).map((y, index) => Math.abs(y - compactTickYs[index]));
assert.ok(compactTickPixelGaps.every((gap) => Math.abs(gap - compactTickPixelGaps[0]) < 0.000001));
assert.ok(Math.abs(compactTickYs[0] - compactPriceDensityScene.plot.priceBottom) < 0.000001);
assert.ok(Math.abs(compactTickYs.at(-1)! - compactPriceDensityScene.plot.top) < 0.000001);

const visibleCandleScaleSource = [
  testCandle("2026-07-09T13:30:00.000Z", 100),
  testCandle("2026-07-09T13:31:00.000Z", 101)
] as CandleDto[];
const visibleCandleScaleBaseline = buildFrontendChartScene(frontendChartState({
  interval: "1m",
  candles: visibleCandleScaleSource,
  visibleCount: visibleCandleScaleSource.length,
  layers: { candles: true, volume: false }
}), 800, 360);
const visibleCandleScaleWithOverlays = buildFrontendChartScene(frontendChartState({
  interval: "1m",
  candles: visibleCandleScaleSource.map((candle) => ({
    ...candle,
    ma5: 10_000,
    ma20: 1,
    ma60: 5_000
  })),
  visibleCount: visibleCandleScaleSource.length,
  layers: {
    candles: true,
    volume: false,
    ma5: true,
    ma20: true,
    ma60: true,
    "sma:120": true,
    "bollinger:20:2": true
  },
  indicatorSeries: {
    "sma:120": visibleCandleScaleSource.map((candle) => ({ timestamp: candle.timestamp, value: 20_000 })),
    "bollinger:20:2": visibleCandleScaleSource.map((candle) => ({
      timestamp: candle.timestamp,
      upper: 30_000,
      lower: 0.5
    }))
  },
  holdingOverlay: { symbol: "AAPL", quantity: 10, averagePrice: 1 },
  streamState: "live",
  liveTrade: { price: 40_000, timestamp: "2026-07-09T13:31:30.000Z" },
  drawings: [testDrawing({
    id: "chart-plan:AAPL:1m:visible-candle-scale:risk",
    sourceProposalId: "chart-plan:AAPL:1m:visible-candle-scale",
    type: "riskRewardBox",
    anchors: [
      { timestamp: visibleCandleScaleSource[0].timestamp, price: 100, paneId: "price", symbol: "AAPL" },
      { timestamp: visibleCandleScaleSource[1].timestamp, price: 1, paneId: "price", symbol: "AAPL" },
      { timestamp: visibleCandleScaleSource[1].timestamp, price: 50_000, paneId: "price", symbol: "AAPL" }
    ],
    style: { colorToken: "proposal", zoneSplit: true, labelPlacement: "axis" }
  })]
}), 800, 360);
assert.deepEqual(
  {
    minPrice: visibleCandleScaleWithOverlays.scales.minPrice,
    maxPrice: visibleCandleScaleWithOverlays.scales.maxPrice,
    priceTicks: visibleCandleScaleWithOverlays.scales.priceTicks
  },
  {
    minPrice: visibleCandleScaleBaseline.scales.minPrice,
    maxPrice: visibleCandleScaleBaseline.scales.maxPrice,
    priceTicks: visibleCandleScaleBaseline.scales.priceTicks
  },
  "price scale must depend only on visible candle highs and lows"
);

const engineVisibleCandleScaleDocument = {
  ...createChartDocument("chart-doc-visible-candle-scale", "AAPL", "1m"),
  viewport: { visibleCount: 2, rightOffset: 0 }
};
const engineVisibleCandleScaleBaseline = buildRenderScene({
  state: "ready",
  document: engineVisibleCandleScaleDocument,
  candles: visibleCandleScaleSource,
  width: 800,
  height: 360
});
const engineVisibleCandleScaleWithOverlays = buildRenderScene({
  state: "ready",
  document: {
    ...engineVisibleCandleScaleDocument,
    drawings: [{
      id: "engine-visible-candle-scale-risk",
      type: "riskRewardBox",
      anchors: [
        { timestamp: visibleCandleScaleSource[0].timestamp, price: 100 },
        { timestamp: visibleCandleScaleSource[1].timestamp, price: 1 },
        { timestamp: visibleCandleScaleSource[1].timestamp, price: 50_000 }
      ],
      style: { zoneSplit: true },
      visible: true,
      createdBy: "user",
      createdAt: "2026-07-09T13:31:00.000Z",
      updatedAt: "2026-07-09T13:31:00.000Z"
    }]
  },
  candles: visibleCandleScaleSource.map((candle) => ({
    ...candle,
    ma5: 10_000,
    ma20: 1,
    ma60: 5_000
  })),
  width: 800,
  height: 360
});
assert.deepEqual(
  {
    minPrice: engineVisibleCandleScaleWithOverlays.scales.minPrice,
    maxPrice: engineVisibleCandleScaleWithOverlays.scales.maxPrice
  },
  {
    minPrice: engineVisibleCandleScaleBaseline.scales.minPrice,
    maxPrice: engineVisibleCandleScaleBaseline.scales.maxPrice
  },
  "shared chart scene must ignore moving averages and drawings when autoscaling"
);

const lowerNiceBoundaryScale = resolvePriceScale([100, 107.27], compactPricePaneHeight);
const upperNiceBoundaryScale = resolvePriceScale([100, 107.28], compactPricePaneHeight);
const lowerNiceBoundarySpan = lowerNiceBoundaryScale.domainMax - lowerNiceBoundaryScale.domainMin;
const upperNiceBoundarySpan = upperNiceBoundaryScale.domainMax - upperNiceBoundaryScale.domainMin;
assert.equal(lowerNiceBoundaryScale.tickCount, upperNiceBoundaryScale.tickCount);
assert.ok(Math.abs(upperNiceBoundarySpan - lowerNiceBoundarySpan) / lowerNiceBoundarySpan < 0.01);
assert.ok(lowerNiceBoundaryScale.ticks.every((tick) => tick >= lowerNiceBoundaryScale.domainMin && tick <= lowerNiceBoundaryScale.domainMax));
assert.ok(upperNiceBoundaryScale.ticks.every((tick) => tick >= upperNiceBoundaryScale.domainMin && tick <= upperNiceBoundaryScale.domainMax));
assert.equal(lowerNiceBoundaryScale.ticks[0], lowerNiceBoundaryScale.domainMin);
assert.equal(lowerNiceBoundaryScale.ticks.at(-1), lowerNiceBoundaryScale.domainMax);
assert.ok(lowerNiceBoundaryScale.ticks.slice(1).every((tick, index) => (
  Math.abs((tick - lowerNiceBoundaryScale.ticks[index]) - lowerNiceBoundaryScale.tickStep) < 0.000001
)));
assert.equal(priceTickCountForHeight(279), 4);
assert.equal(priceTickCountForHeight(280), 5);
assert.equal(priceTickCountForHeight(343), 5);
assert.equal(priceTickCountForHeight(344), 6);

const panTickCountCandles = Array.from({ length: 40 }, (_, index) => (
  testCandle(new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 86_400_000).toISOString(), 100 + index * 0.7)
));
const panTickCountScene = buildFrontendChartScene(frontendChartState({
  candles: panTickCountCandles,
  visibleCount: 12,
  rightOffset: 18,
  layers: { candles: true, volume: false }
}), 800, 360);
const zoomTickCountScene = buildFrontendChartScene(frontendChartState({
  candles: panTickCountCandles,
  visibleCount: 30,
  rightOffset: 0,
  layers: { candles: true, volume: false }
}), 800, 360);
assert.equal(panTickCountScene.scales.priceTicks.length, compactPriceDensityScene.scales.priceTicks.length);
assert.equal(zoomTickCountScene.scales.priceTicks.length, compactPriceDensityScene.scales.priceTicks.length);

const livePriceScaleScene = buildFrontendChartScene(frontendChartState({
  candles: [testCandle("2026-07-10T13:30:00.000Z", 100)],
  visibleCount: 6,
  layers: { candles: true, volume: false },
  streamState: "live",
  liveTrade: { price: 120, timestamp: "2026-07-10T13:30:30.000Z" }
}), 800, 360);
const idleLivePriceScaleScene = buildFrontendChartScene(frontendChartState({
  candles: [testCandle("2026-07-10T13:30:00.000Z", 100)],
  visibleCount: 6,
  layers: { candles: true, volume: false },
  streamState: "idle",
  liveTrade: { price: 120, timestamp: "2026-07-10T13:30:30.000Z" }
}), 800, 360);
assert.deepEqual(
  [livePriceScaleScene.scales.minPrice, livePriceScaleScene.scales.maxPrice],
  [idleLivePriceScaleScene.scales.minPrice, idleLivePriceScaleScene.scales.maxPrice]
);
const fourDigitPriceScene = buildFrontendChartScene(frontendChartState({
  candles: [{ ...semanticFutureCandles[0], open: 1350, high: 1356.22, low: 1340, close: 1355 } as CandleDto],
  visibleCount: 1
}), 800, 360);
assert.equal(fourDigitPriceScene.width - fourDigitPriceScene.plot.right, 68);
const fiveDigitPriceScene = buildFrontendChartScene(frontendChartState({
  candles: [{ ...semanticFutureCandles[0], open: 10_050, high: 10_100, low: 10_000, close: 10_075 } as CandleDto],
  visibleCount: 1
}), 800, 360);
assert.ok(fiveDigitPriceScene.width - fiveDigitPriceScene.plot.right > 68);
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
assert.ok(Math.abs(firstVisibleAfterLeftExpansion?.slotStart ?? -1) < 0.000001);

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
assert.equal(getLiveTradeForSymbol(tradeLayerRuntime, "nvda")?.price, 197.66);
const tradePatchedCandles = tradeLayerRuntime.candlesByKey[candleKey("NVDA", "5m")] ?? [];
assert.equal(tradePatchedCandles.length, 2);
assert.equal(tradePatchedCandles[1]?.timestamp, "2026-07-02T14:30:00.000Z");
assert.equal(tradePatchedCandles[1]?.open, 197.66);
assert.equal(tradePatchedCandles[1]?.high, 197.66);
assert.equal(tradePatchedCandles[1]?.low, 197.66);
assert.equal(tradePatchedCandles[1]?.close, 197.66);
assert.equal(tradePatchedCandles[1]?.volume, 0);
assert.equal(tradePatchedCandles[1]?.isClosed, false);
const nextTrade = normalizeRealtimeLayerEvent({
  type: "LIVE_TRADE_UPDATE",
  symbol: "NVDA",
  data: { price: "199.10", timestamp: "2026-07-02T14:33:00Z" }
});
if (nextTrade.type !== "LIVE_TRADE_UPDATE") {
  throw new Error("expected next trade payload");
}
const nextTradeRuntime = chartRuntimeReducer(tradeLayerRuntime, { kind: "chart.layer.live", event: nextTrade });
const nextTradeCandles = nextTradeRuntime.candlesByKey[candleKey("NVDA", "5m")] ?? [];
assert.equal(nextTradeCandles.length, 2);
assert.equal(nextTradeCandles[1]?.timestamp, "2026-07-02T14:30:00.000Z");
assert.equal(nextTradeCandles[1]?.open, 197.66);
assert.equal(nextTradeCandles[1]?.high, 199.1);
assert.equal(nextTradeCandles[1]?.low, 197.66);
assert.equal(nextTradeCandles[1]?.close, 199.1);
assert.equal(nextTradeCandles[1]?.volume, 0);

const simulatorPollutedRuntime = chartRuntimeReducer(nextTradeRuntime, {
  kind: "chart.ensureDocuments",
  panels: [{ id: "panel-chart", type: "chart", props: { symbol: "NVDA", timeframe: "5m" } }]
});
const liveRestoredRuntime = chartRuntimeReducer(simulatorPollutedRuntime, {
  kind: "chart.marketData.reset"
});
assert.deepEqual(liveRestoredRuntime.documents, simulatorPollutedRuntime.documents);
assert.deepEqual(liveRestoredRuntime.candlesByKey, {});
assert.deepEqual(liveRestoredRuntime.candleKeyAccessOrder, []);
assert.deepEqual(liveRestoredRuntime.liveTradesBySymbol, {});
assert.deepEqual(liveRestoredRuntime.liveQuotesBySymbol, {});
assert.deepEqual(liveRestoredRuntime.dataStatusByKey, {});
assert.deepEqual(liveRestoredRuntime.streamStatusByKey, {});
assert.deepEqual(liveRestoredRuntime.streamMessageByKey, {});

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
assert.equal(normalizeChartInterval("bad"), null);
assert.deepEqual(chartIntervals.slice(0, 5), ["1m", "5m", "10m", "1h", "4h"]);
assert.deepEqual(bidAskChartIntervals, ["1m", "10m", "1h"]);
assert.equal(defaultBidAskInterval, "10m");
assert.equal(isBidAskChartInterval("1D"), false);
assert.equal(isBidAskChartInterval("10m"), true);
assert.equal(nextDigTargetInterval("1m"), "1m");
assert.equal(nextDigTargetInterval("1D"), "1h");
assert.equal(nextDigTargetInterval("4h"), "1h");
assert.equal(nextDigTargetInterval("1h"), "10m");
assert.equal(defaultVisibleBarsForInterval("1m"), 120);
assert.equal(defaultVisibleBarsForInterval("5m"), 120);
assert.equal(defaultVisibleBarsForInterval("10m"), 120);
assert.equal(defaultVisibleBarsForInterval("1h"), 120);
assert.equal(defaultVisibleBarsForInterval("4h"), 120);
assert.equal(defaultVisibleBarsForInterval("1D"), 120);
assert.equal(defaultVisibleBarsForInterval("1W"), 104);
assert.equal(defaultVisibleBarsForInterval("1M"), 36);
assert.equal(defaultVisibleBarsForBidAskInterval("1m"), 120);
assert.equal(defaultVisibleBarsForBidAskInterval("10m"), 39);
assert.equal(defaultVisibleBarsForBidAskInterval("1h"), 7);
assert.equal(maxRequestBarsForInterval("1m"), 589680);
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

const rebinnedOrderFlow = rebinLevels([
  { priceBin: 100.01, askVolume: 10, bidVolume: 2, unknownVolume: 1, askTradeCount: 1 },
  { priceBin: 100.12, askVolume: 3, bidVolume: 4, unknownVolume: 0, bidTradeCount: 2 },
  { priceBin: 100.26, askVolume: 0, bidVolume: 7, unknownVolume: 2, unknownTradeCount: 1 }
], 0.01, 0.25);
assert.deepEqual(rebinnedOrderFlow, [
  { priceBin: 100.25, askVolume: 0, bidVolume: 7, unknownVolume: 2, unknownTradeCount: 1 },
  { priceBin: 100, askVolume: 13, bidVolume: 6, unknownVolume: 1, askTradeCount: 1, bidTradeCount: 2 }
]);
assert.throws(() => rebinLevels([], 0.02, 0.03), /multiple/);
const rebinnedWithCountsSource = [
  { priceBin: 210.61, askVolume: 10, bidVolume: 2, unknownVolume: 1, askTradeCount: 2, bidTradeCount: 1 },
  { priceBin: 210.62, askVolume: 3, bidVolume: 4, unknownVolume: 2, askTradeCount: 1, unknownTradeCount: 2 },
  { priceBin: 210.67, askVolume: 7, bidVolume: 6, unknownVolume: 0, askTradeCount: 3, bidTradeCount: 2 }
];
const rebinnedWithCounts = rebinLevels(rebinnedWithCountsSource, 0.01, 0.05);
assert.deepEqual(buildLadder(rebinnedWithCountsSource, 0.01).totals, buildLadder(rebinnedWithCounts, 0.05).totals);

const narrowBidAskGrid = buildBidAskPriceGrid([210.6, 210.9], 0.01, 320);
assert.equal(narrowBidAskGrid.priceStep, 0.01);
const narrowBidAskHeadroom = priceScaleHeadroom(320);
const narrowBidAskPricePerPixel = 0.3 / (320 - narrowBidAskHeadroom.topPx - narrowBidAskHeadroom.bottomPx);
assert.ok(Math.abs(narrowBidAskGrid.domainMin - (210.6 - narrowBidAskPricePerPixel * narrowBidAskHeadroom.bottomPx)) < 0.000001);
assert.ok(Math.abs(narrowBidAskGrid.domainMax - (210.9 + narrowBidAskPricePerPixel * narrowBidAskHeadroom.topPx)) < 0.000001);
assert.equal(narrowBidAskGrid.decimalPlaces, 2);
assert.ok(narrowBidAskGrid.rowPrices.length <= 64);
assert.ok(narrowBidAskGrid.domainMax - narrowBidAskGrid.domainMin < 0.37);
assert.equal(narrowBidAskGrid.axisTicks.length, priceTickCountForHeight(320));
const compactBidAskGrid = buildBidAskPriceGrid([210.6, 210.9], 0.01, 100);
assert.equal(compactBidAskGrid.priceStep, 0.02);
assert.ok(compactBidAskGrid.rowPrices.length <= 20);
assert.equal(compactBidAskGrid.axisTicks.length, priceTickCountForHeight(100));
const expandedBidAskGrid = buildBidAskPriceGrid([210.6, 212.8], 0.01, 320);
assert.ok(expandedBidAskGrid.priceStep > narrowBidAskGrid.priceStep);
assert.ok(expandedBidAskGrid.domainMax > 212.8);
assert.equal(expandedBidAskGrid.axisTicks.length, narrowBidAskGrid.axisTicks.length);
assert.ok(expandedBidAskGrid.axisTicks.every((tick) => (
  tick >= 0 && tick >= expandedBidAskGrid.domainMin && tick <= expandedBidAskGrid.domainMax
)));
const narrowPriceCandle: CandleDto = {
  timestamp: "2026-07-08T13:30:00.000Z",
  open: 210.7,
  high: 210.9,
  low: 210.6,
  close: 210.8,
  volume: 100,
  isClosed: true
};
const ordinaryNarrowPriceScene = buildFrontendChartScene(frontendChartState({
  candles: [narrowPriceCandle],
  visibleCount: 1,
  requestedLimit: 1
}), 600, 320);
assert.ok(ordinaryNarrowPriceScene.scales.minPrice < narrowPriceCandle.low);
assert.ok(ordinaryNarrowPriceScene.scales.maxPrice > narrowPriceCandle.high);
assert.equal(
  ordinaryNarrowPriceScene.scales.priceTicks.length,
  priceTickCountForHeight(ordinaryNarrowPriceScene.plot.priceBottom - ordinaryNarrowPriceScene.plot.top)
);
assert.equal(ordinaryNarrowPriceScene.scales.bidAskPriceGrid, undefined);
const lowPriceCandles = [
  {
    timestamp: "2026-07-08T13:30:00.000Z",
    open: 0.19,
    high: 0.21,
    low: 0.18,
    close: 0.2,
    volume: 100,
    isClosed: true
  },
  {
    timestamp: "2026-07-08T13:31:00.000Z",
    open: 0.2,
    high: 0.23,
    low: 0.19,
    close: 0.22,
    volume: 110,
    isClosed: true
  }
] as CandleDto[];
const guardedSmaScene = buildFrontendChartScene(frontendChartState({
  interval: "1m",
  candles: lowPriceCandles,
  visibleCount: 2,
  layers: { candles: true, volume: false, "sma:120": true },
  indicatorSeries: {
    "sma:120": [
      { timestamp: lowPriceCandles[0].timestamp, value: 0 },
      { timestamp: lowPriceCandles[1].timestamp, value: 100 }
    ]
  }
}), 600, 320);
assert.ok(guardedSmaScene.scales.minPrice >= 0);
assert.ok(guardedSmaScene.scales.maxPrice < 1);
assert.ok(guardedSmaScene.scales.priceTicks.every((tick) => tick >= 0));
const invalidOverlayScale = resolvePriceScale([0.18, 0.23, Number.NaN, Number.POSITIVE_INFINITY, 0, -1], 240);
assert.ok(invalidOverlayScale.domainMax < 1);
assert.ok(invalidOverlayScale.ticks.every((tick) => tick >= 0));
const invalidIndicatorScene = buildFrontendChartScene(frontendChartState({
  candles: [narrowPriceCandle],
  visibleCount: 1,
  layers: {
    candles: true,
    volume: false,
    "sma:120": true,
    "ema:20": true,
    "wma:20": true,
    "bollinger:20:2": true
  },
  indicatorSeries: {
    "sma:120": [{ timestamp: narrowPriceCandle.timestamp, value: Number.NaN }],
    "ema:20": [{ timestamp: narrowPriceCandle.timestamp, value: Number.POSITIVE_INFINITY }],
    "wma:20": [{ timestamp: narrowPriceCandle.timestamp, value: 0 }],
    "bollinger:20:2": [{
      timestamp: narrowPriceCandle.timestamp,
      upper: Number.NEGATIVE_INFINITY,
      lower: -1
    }]
  }
}), 600, 320);
assert.ok(invalidIndicatorScene.scales.maxPrice < 220);
assert.ok(invalidIndicatorScene.scales.minPrice >= 0);
const nearbySmaScene = buildFrontendChartScene(frontendChartState({
  candles: [narrowPriceCandle],
  visibleCount: 1,
  layers: { candles: true, volume: false, "sma:120": true },
  indicatorSeries: {
    "sma:120": [{ timestamp: narrowPriceCandle.timestamp, value: 208 }]
  }
}), 600, 320);
assert.ok(nearbySmaScene.scales.minPrice > 208);
assert.ok(nearbySmaScene.scales.priceTicks.every((tick) => tick >= 0));
const bidAskNarrowPriceScene = buildFrontendChartScene(frontendChartState({
  chartType: "bidask",
  interval: "1m",
  candles: [narrowPriceCandle],
  visibleCount: 1,
  requestedLimit: 1,
  orderFlow: {
    dataStatus: "ready",
    priceBinSize: 0.01,
    sessionDate: "2026-07-08",
    minutes: new Map([[narrowPriceCandle.timestamp, {
      eventMinute: narrowPriceCandle.timestamp,
      bins: [
        { priceBin: 210.6, askVolume: 4, bidVolume: 2, unknownVolume: 0 },
        { priceBin: 210.9, askVolume: 1, bidVolume: 3, unknownVolume: 0 }
      ]
    }]])
  }
}), 600, 320);
assert.ok(bidAskNarrowPriceScene.scales.minPrice > 210.5);
assert.ok(bidAskNarrowPriceScene.scales.maxPrice < 211);
assert.equal(bidAskNarrowPriceScene.scales.priceBottomInset, 13);
assert.equal(bidAskNarrowPriceScene.scales.bidAskPriceGrid?.decimalPlaces, 2);

const minuteWindowLevels = [
  { eventMinute: "2026-07-08T13:30:00.000Z", bins: [{ priceBin: 100, askVolume: 1, bidVolume: 0, unknownVolume: 0 }] },
  { eventMinute: "2026-07-08T13:31:00.000Z", bins: [{ priceBin: 100, askVolume: 2, bidVolume: 0, unknownVolume: 0 }] },
  { eventMinute: "2026-07-08T13:32:00.000Z", bins: [{ priceBin: 101, askVolume: 0, bidVolume: 3, unknownVolume: 0 }] }
];
assert.deepEqual(sumMinuteWindows(minuteWindowLevels, 2), [
  { priceBin: 101, askVolume: 0, bidVolume: 3, unknownVolume: 0 },
  { priceBin: 100, askVolume: 2, bidVolume: 0, unknownVolume: 0 }
]);
assert.deepEqual(sumMinuteWindows(minuteWindowLevels, "session"), [
  { priceBin: 101, askVolume: 0, bidVolume: 3, unknownVolume: 0 },
  { priceBin: 100, askVolume: 3, bidVolume: 0, unknownVolume: 0 }
]);
const bidAskBucketMinutes = [
  { eventMinute: "2026-07-08T13:30:00.000Z", bins: [{ priceBin: 100, askVolume: 1, bidVolume: 0, unknownVolume: 0 }] },
  { eventMinute: "2026-07-08T13:39:00.000Z", bins: [{ priceBin: 100, askVolume: 4, bidVolume: 0, unknownVolume: 0 }] },
  { eventMinute: "2026-07-08T13:40:00.000Z", bins: [{ priceBin: 101, askVolume: 0, bidVolume: 9, unknownVolume: 0 }] }
];
assert.equal(orderFlowWindowMinutesForInterval("1m"), 1);
assert.equal(orderFlowWindowMinutesForInterval("10m"), 10);
assert.equal(orderFlowWindowMinutesForInterval("1h"), 60);
assert.deepEqual(
  orderFlowMinutesForBucket(bidAskBucketMinutes, "2026-07-08T13:30:00.000Z", 10).map((minute) => minute.eventMinute),
  ["2026-07-08T13:30:00.000Z", "2026-07-08T13:39:00.000Z"]
);
assert.deepEqual(sumOrderFlowBucketLevels(bidAskBucketMinutes, "2026-07-08T13:30:00.000Z", 10), [
  { priceBin: 100, askVolume: 5, bidVolume: 0, unknownVolume: 0 }
]);
const cacheMinutes = new Map(Array.from({ length: 120 }, (_, index) => {
  const eventMinute = new Date(Date.parse("2026-07-08T13:00:00.000Z") + index * 60_000).toISOString();
  return [eventMinute, {
    eventMinute,
    bins: [{ priceBin: 100, askVolume: 1, bidVolume: 0, unknownVolume: 0 }]
  }] as const;
}));
const bucketComputes: Array<[string, number]> = [];
const bucketCache = new OrderFlowBucketCache(512, (start, window) => bucketComputes.push([start, window]));
const oneMinuteStarts = Array.from(cacheMinutes.keys());
const tenMinuteStarts = oneMinuteStarts.filter((_, index) => index % 10 === 0);
const oneHourStarts = oneMinuteStarts.filter((_, index) => index % 60 === 0);
oneMinuteStarts.forEach((start) => bucketCache.get(cacheMinutes, start, 1));
tenMinuteStarts.forEach((start) => bucketCache.get(cacheMinutes, start, 10));
oneHourStarts.forEach((start) => bucketCache.get(cacheMinutes, start, 60));
bucketComputes.length = 0;
const changedMinute = oneMinuteStarts[35];
const changedCacheMinutes = new Map(cacheMinutes);
changedCacheMinutes.set(changedMinute, {
  eventMinute: changedMinute,
  bins: [{ priceBin: 100, askVolume: 9, bidVolume: 0, unknownVolume: 0 }]
});
oneMinuteStarts.forEach((start) => bucketCache.get(changedCacheMinutes, start, 1));
tenMinuteStarts.forEach((start) => bucketCache.get(changedCacheMinutes, start, 10));
oneHourStarts.forEach((start) => bucketCache.get(changedCacheMinutes, start, 60));
assert.deepEqual(bucketComputes, [
  [changedMinute, 1],
  [tenMinuteStarts[3], 10],
  [oneHourStarts[0], 60]
]);
assert.equal(bucketCache.get(changedCacheMinutes, tenMinuteStarts[3], 10).levels[0]?.askVolume, 18);
const anchoredDemoOrderFlow = fetchDemoOrderFlowIntraday("NVDA", {
  sessionDate: "2026-07-03",
  basePrice: 194.5
});
const differentlyAnchoredDemoOrderFlow = fetchDemoOrderFlowIntraday("NVDA", {
  sessionDate: "2026-07-02",
  basePrice: 152.4
});
const demoContext = orderFlowDemoContextFromCandles([
  { timestamp: "2026-07-10T05:00:00.000Z", close: 200 },
  { timestamp: "2026-07-10T05:10:00.000Z", close: 201.5 },
  { timestamp: "2026-07-10T05:20:00.000Z", close: 203 }
], "10m");
const scheduledDemoOrderFlow = fetchDemoOrderFlowIntraday("NVDA", demoContext?.anchor);
assert.equal(anchoredDemoOrderFlow.sessionDate, "2026-07-03");
assert.equal(anchoredDemoOrderFlow.minutes[0]?.eventMinute, "2026-07-03T13:30:00.000Z");
assert.ok(anchoredDemoOrderFlow.minutes[0]?.bins.some((level) => level.priceBin >= 194.45 && level.priceBin <= 194.55));
assert.equal(differentlyAnchoredDemoOrderFlow.sessionDate, "2026-07-02");
assert.notDeepEqual(anchoredDemoOrderFlow.minutes[0]?.bins, differentlyAnchoredDemoOrderFlow.minutes[0]?.bins);
assert.deepEqual(demoContext?.anchor, {
  sessionDate: "2026-07-10",
  basePrice: 203,
  sessionOpenTimestamp: "2026-07-10T05:00:00.000Z",
  bucketTimestamps: [
    "2026-07-10T05:00:00.000Z",
    "2026-07-10T05:10:00.000Z",
    "2026-07-10T05:20:00.000Z"
  ],
  bucketWindowMinutes: 10
});
assert.equal(scheduledDemoOrderFlow.minutes.length, 30);
assert.equal(scheduledDemoOrderFlow.minutes[0]?.eventMinute, "2026-07-10T05:00:00.000Z");
assert.equal(scheduledDemoOrderFlow.minutes.at(-1)?.eventMinute, "2026-07-10T05:29:00.000Z");

const ladder = buildLadder([
  { priceBin: 102, askVolume: 50, bidVolume: 55, unknownVolume: 0 },
  { priceBin: 101, askVolume: 0, bidVolume: 25, unknownVolume: 0 },
  { priceBin: 100, askVolume: 100, bidVolume: 5, unknownVolume: 0 },
  { priceBin: 99, askVolume: 20, bidVolume: 1, unknownVolume: 0 }
], 1, "fixture");
assert.equal(ladder.pocPriceBin, 100);
assert.equal(ladder.totals.delta, 84);
assert.equal(ladder.maxLevelVolume, 105);
assert.equal(ladder.levels.find((level) => level.priceBin === 100)?.askImbalance, true);
assert.equal(ladder.levels.find((level) => level.priceBin === 102)?.bidImbalance, true);
assert.equal(ladder.levels.find((level) => level.priceBin === 101)?.bidImbalance, false);
assert.equal(autoPriceStep(1.2, 44), 0.05);
assert.equal(autoPriceStep(8, 24), 0.5);
assert.equal(maxOrderFlowTargetRowsForHeight(120), 16);
assert.equal(autoOrderFlowTargetRows(120), 8);
assert.equal(resolveOrderFlowTargetRows("auto", 16, 32), 16);
assert.equal(resolveOrderFlowTargetRows(44, 16, 32), 32);
assert.equal(stepOrderFlowTargetRows(16, 1, 44), 20);
assert.equal(stepOrderFlowTargetRows(16, -1, 44), 12);
assert.equal(stepOrderFlowTargetRows(44, 1, 50), 50);
assert.equal(effectiveOrderFlowPriceStep(1.2, 32, 0.01), 0.05);
assert.equal(visibleScaleMax([ladder]), 105);
const projectedOrderFlowRows = projectOrderFlowChartRows(ladder, (price) => (102 - price) * 0.4, 0, 2);
assert.equal(projectedOrderFlowRows.length, 2);
assert.equal(projectedOrderFlowRows[0]?.bidVolume, 80);
assert.equal(projectedOrderFlowRows[1]?.askVolume, 120);
assert.equal(orderFlowChartRowScaleMax([projectedOrderFlowRows]), 120);
const sharedGrid = buildBidAskPriceGrid([99, 102], 0.01, 240);
const sharedGridPriceToY = (price: number) => (
  ((sharedGrid.domainMax - price) / (sharedGrid.domainMax - sharedGrid.domainMin)) * 240
);
const sparseSharedGridLadder = buildLadder([
  { priceBin: 100, askVolume: 12, bidVolume: 3, unknownVolume: 0 }
], sharedGrid.priceStep);
const denseSharedGridLadder = buildLadder(rebinLevels([
  { priceBin: 99, askVolume: 2, bidVolume: 1, unknownVolume: 0 },
  { priceBin: 100, askVolume: 3, bidVolume: 4, unknownVolume: 1 },
  { priceBin: 102, askVolume: 5, bidVolume: 6, unknownVolume: 0 }
], 0.01, sharedGrid.priceStep), sharedGrid.priceStep);
const sparseSharedRows = projectOrderFlowChartRows(
  sparseSharedGridLadder,
  sharedGridPriceToY,
  0,
  240,
  sharedGrid.rowPrices
);
const denseSharedRows = projectOrderFlowChartRows(
  denseSharedGridLadder,
  sharedGridPriceToY,
  0,
  240,
  sharedGrid.rowPrices
);
assert.equal(sparseSharedRows.length, sharedGrid.rowPrices.length);
assert.equal(denseSharedRows.length, sharedGrid.rowPrices.length);
assert.deepEqual(sparseSharedRows.map((row) => row.y), denseSharedRows.map((row) => row.y));
assert.equal(sparseSharedRows.filter((row) => row.totalVolume === 0).every((row) => !row.isPoc && !row.askImbalance && !row.bidImbalance), true);
assert.equal(sparseSharedRows.filter((row) => row.isPoc).length, 1);

const orderFlowUpdateA: OrderFlowMinuteUpdate = {
  eventMinute: "2026-07-08T13:31:00.000Z",
  sessionDate: "2026-07-08",
  priceBinSize: 0.01,
  bins: [{ priceBin: 100, askVolume: 1, bidVolume: 0, unknownVolume: 0 }],
  updatedAt: "2026-07-08T13:31:01.000Z"
};
const orderFlowUpdateB: OrderFlowMinuteUpdate = {
  ...orderFlowUpdateA,
  bins: [{ priceBin: 100, askVolume: 5, bidVolume: 2, unknownVolume: 0 }],
  updatedAt: "2026-07-08T13:31:02.000Z"
};
const orderFlowUpdateOlder: OrderFlowMinuteUpdate = {
  eventMinute: "2026-07-08T13:30:00.000Z",
  sessionDate: "2026-07-08",
  priceBinSize: 0.01,
  bins: [{ priceBin: 99, askVolume: 0, bidVolume: 3, unknownVolume: 0 }],
  updatedAt: "2026-07-08T13:30:01.000Z"
};
const minuteMapAfterEvents = replaceOrderFlowMinute(
  replaceOrderFlowMinute(
    replaceOrderFlowMinute(new Map(), orderFlowUpdateA),
    orderFlowUpdateOlder
  ),
  orderFlowUpdateB
);
assert.deepEqual(Array.from(minuteMapAfterEvents.keys()).sort(), [
  "2026-07-08T13:30:00.000Z",
  "2026-07-08T13:31:00.000Z"
]);
assert.deepEqual(minuteMapAfterEvents.get("2026-07-08T13:31:00.000Z")?.bins, orderFlowUpdateB.bins);

const originalFetch = globalThis.fetch;
let orderFlowSymbolFetchCalls = 0;
try {
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    orderFlowSymbolFetchCalls += 1;
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;
  const controller = new AbortController();
  const abortedFetch = fetchOrderFlowSymbols(controller.signal).then(
    () => "resolved",
    (error: Error) => error.name
  );
  controller.abort();
  assert.equal(await abortedFetch, "AbortError");

  globalThis.fetch = (async () => {
    orderFlowSymbolFetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ symbols: ["nvda", "aapl"], priceBinSize: 0.01 })
    } as Response;
  }) as typeof fetch;
  const symbolsAfterAbort = await fetchOrderFlowSymbols();
  const symbolsFromCache = await fetchOrderFlowSymbols();
  assert.deepEqual(symbolsAfterAbort.symbols, ["NVDA", "AAPL"]);
  assert.strictEqual(symbolsFromCache, symbolsAfterAbort);
  assert.equal(orderFlowSymbolFetchCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
}

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
assert.notEqual(
  stableVolumeProfileRangeKey({
    symbol: "NVDA",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceBinSize: "auto",
    priceMin: 100,
    priceMax: 110
  }),
  stableVolumeProfileRangeKey({
    symbol: "NVDA",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceBinSize: "auto",
    priceMin: 101,
    priceMax: 111
  })
);
assert.notEqual(
  stableVolumeProfileRangeKey({
    symbol: "NVDA",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceMin: 100,
    priceMax: 110,
    candleCount: 120
  }),
  stableVolumeProfileRangeKey({
    symbol: "NVDA",
    interval: "1D",
    from: "2026-07-02T04:00:00.000Z",
    to: "2026-07-08T04:00:00.000Z",
    targetBins: 10,
    priceMin: 100,
    priceMax: 110,
    candleCount: 200
  })
);
assert.deepEqual(volumeProfilePartialRetryDelaysMs, [500, 1_500]);

const exactProfileRequest = {
  symbol: "NVDA",
  interval: "1m" as const,
  from: "2026-07-08T13:30:00.000Z",
  to: "2026-07-08T14:00:00.000Z",
  targetBins: 10,
  priceMin: 90,
  priceMax: 110,
  candleCount: 200
};
const exactProfileBins = Array.from({ length: 10 }, (_, index) => ({
  index,
  priceBin: 90 + index * 2,
  priceBinSize: 2,
  priceMin: 90 + index * 2,
  priceMax: 92 + index * 2,
  priceMid: 91 + index * 2,
  volume: index === 4 ? 100 : 0,
  tradeCount: 0,
  volumePercent: index === 4 ? 1 : 0,
  isPoc: index === 4,
  inValueArea: index === 4
}));
const exactProfileResponse: VolumeProfileResponseDto = {
  ...exactProfileRequest,
  sourceInterval: "1m",
  timeBucket: "1m",
  bucketCount: 10,
  priceBinSize: 2,
  sourceBinCount: 200,
  sourceCandleCount: 200,
  requestedCandleCount: 200,
  source: "fixture",
  feed: "sip",
  calculationVersion: "volume-profile-exact-v2",
  dataStatus: "ready",
  priceRange: { min: 90, max: 110, requestedMin: 90, requestedMax: 110 },
  totalVolume: 100,
  totalTradeCount: 0,
  bins: exactProfileBins
};
assert.equal(volumeProfileResponseMatchesRequest(exactProfileResponse, exactProfileRequest), true);
assert.equal(volumeProfileResponseMatchesRequest({ ...exactProfileResponse, sourceCandleCount: 120 }, exactProfileRequest), false);
assert.equal(volumeProfileResponseMatchesRequest({ ...exactProfileResponse, dataStatus: "partial" }, exactProfileRequest), false);

let volumeProfileFetchCalls = 0;
try {
  globalThis.fetch = (async () => {
    volumeProfileFetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ symbol: "NVDA", interval: "1m", bins: [] })
    } as Response;
  }) as typeof fetch;
  const queryForIndex = (index: number) => ({
    symbol: "NVDA",
    interval: "1m" as const,
    from: `2026-07-08T13:${String(index).padStart(2, "0")}:00.000Z`,
    to: `2026-07-08T14:${String(index).padStart(2, "0")}:00.000Z`,
    targetBins: 10,
    priceMin: 100 + index,
    priceMax: 110 + index
  });
  for (let index = 0; index <= derivedClientCacheMaxEntries; index += 1) {
    await fetchVolumeProfile(queryForIndex(index));
  }
  await fetchVolumeProfile(queryForIndex(0));
  assert.equal(volumeProfileFetchCalls, derivedClientCacheMaxEntries + 2);
} finally {
  globalThis.fetch = originalFetch;
}
let partialVolumeProfileFetchCalls = 0;
try {
  globalThis.fetch = (async () => {
    partialVolumeProfileFetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...exactProfileResponse, dataStatus: "partial", sourceCandleCount: 120 })
    } as Response;
  }) as typeof fetch;
  await fetchVolumeProfile(exactProfileRequest);
  await fetchVolumeProfile(exactProfileRequest);
  assert.equal(partialVolumeProfileFetchCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
}
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
const companyInformationState = setCompanyInformationSymbol(tiledState, "AAPL", tiledViewport);
const companyInformationChart = companyInformationState.slots
  .map((slot) => companyInformationState.contents[slot.contentId])
  .find((content) => content?.kind === "chart");
assert.equal(companyInformationChart?.props?.symbol, "AAPL");
assert.equal(companyInformationChart?.props?.view, "company");
const tiledWorkspace = workspaceBounds(tiledViewport);
const tiledGutter = panelGutter(tiledViewport);
const tiledInnerBottom = rectBottom(tiledWorkspace) - tiledGutter;
const defaultChartSlot = tiledState.slots.find((slot) => slot.id === "slot-chart");
const initialNewsSlot = tiledState.slots.find((slot) => slot.id === "slot-news");
const initialOntologySlot = tiledState.slots.find((slot) => slot.id === "slot-ontology");
const defaultChartContent = defaultChartSlot ? tiledState.contents[defaultChartSlot.contentId] : undefined;
const expectedInitialChartRect = panelRectForGridRect({ col: 1, row: 3, colSpan: 8, rowSpan: 4 }, tiledViewport);
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
assert.deepEqual(panelGridSpec, { cols: 8, rows: 6 });
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
assert.equal(defaultChartDocument.layers.volume, true);
const volumeOffRuntime = {
  ...frontendInitialRuntime,
  documents: {
    ...frontendInitialRuntime.documents,
    [defaultChartDocument.id]: {
      ...defaultChartDocument,
      layers: { ...defaultChartDocument.layers, volume: false }
    }
  }
};
assert.equal(
  ensureFrontendChartDocuments(volumeOffRuntime, tiledState, "NVDA").documents[defaultChartDocument.id]?.layers.volume,
  false,
  "an existing chart document keeps its explicit volume preference"
);
assert.equal((defaultChartContent as Record<string, unknown> | undefined)?.isDefaultChart, undefined);
assert.equal((defaultChartSlot as Record<string, unknown> | undefined)?.required, undefined);
assert.deepEqual(defaultChartSlot.gridRect, { col: 1, row: 3, colSpan: 8, rowSpan: 4 });
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
    "content-b-right": { id: "content-b-right", kind: "recommendationsList" as const, title: "추천 목록", instanceIndex: 44 }
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
assert.equal(chartNewsSwapChartSlot.minHeight, panelMinimumRenderedSizeForKind("chart").height);
assert.equal(chartNewsSwapNewsSlot.id, "slot-chart");
assert.deepEqual(chartNewsSwapNewsSlot.rect, expectedInitialChartRect);
assert.equal(chartNewsSwapNewsSlot.minHeight, expectedInitialNewsRect.height);
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
assert.deepEqual(
  gridRectForPanelDrag(
    { col: 3, row: 2, colSpan: 3, rowSpan: 2 },
    { col: 7, row: 4 },
    { col: 1, row: 1 }
  ),
  { col: 6, row: 3, colSpan: 3, rowSpan: 2 }
);
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
assert.equal(movedChartDropPlan.valid, false);
assert.equal(movedChartDropPlan.reason, "preferred-span-unavailable");
assert.deepEqual(movedChartDropPlan.gridRect, { col: 1, row: 1, colSpan: 4, rowSpan: 2 });
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
assert.equal(tooSmallChartDropPlan.reason, "preferred-span-unavailable");
assert.deepEqual(tooSmallChartDropPlan.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
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
  previousGridRect: { col: 1, row: 3, colSpan: 8, rowSpan: 4 },
  gridRect: { col: 1, row: 4, colSpan: 8, rowSpan: 3 }
}]);
const ontologySouthYieldState = applyPanelResizeWithYield(tiledState, ontologySouthYieldPlan, tiledViewport);
assert.deepEqual(ontologySouthYieldState.slots.find((slot) => slot.id === "slot-ontology")?.gridRect, { col: 5, row: 1, colSpan: 4, rowSpan: 3 });
assert.deepEqual(ontologySouthYieldState.slots.find((slot) => slot.id === "slot-chart")?.gridRect, { col: 1, row: 4, colSpan: 8, rowSpan: 3 });
assert.equal(layoutHasGapsOrOverlaps(ontologySouthYieldState, tiledViewport), false);
const ontologySouthCompressedPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 5, row: 1, colSpan: 4, rowSpan: 5 });
assert.equal(ontologySouthCompressedPlan.valid, true);
assert.deepEqual(ontologySouthCompressedPlan.yieldedSlots, [{
  slotId: "slot-chart",
  previousGridRect: { col: 1, row: 3, colSpan: 8, rowSpan: 4 },
  gridRect: { col: 1, row: 6, colSpan: 8, rowSpan: 1 }
}]);
const ontologyDiagonalYieldPlan = resolvePanelResizeWithYield(tiledState, "slot-ontology", { col: 4, row: 1, colSpan: 5, rowSpan: 3 });
assert.equal(ontologyDiagonalYieldPlan.valid, true);
assert.deepEqual(ontologyDiagonalYieldPlan.yieldedSlots.map((slot) => [slot.slotId, slot.gridRect]), [
  ["slot-news", { col: 1, row: 1, colSpan: 3, rowSpan: 2 }],
  ["slot-chart", { col: 1, row: 4, colSpan: 8, rowSpan: 3 }]
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
assert.deepEqual(tiledChartContext?.minSpan, { colSpan: 2, rowSpan: 2 });
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
      placement: testPlacement(1, 5, 4, 2)
    }, { panelId: "panel-chart-aapl" }),
    makeAgentLayoutCommand("layout.panel.priority.set", "llm", {
      panelId: "panel-chart-aapl",
      layoutWeight: 120
    }, { panelId: "panel-chart-aapl" }),
    makeAgentLayoutCommand("layout.panels.arrange", "llm", {
      placements: [
        { panelId: "slot-news", placement: testPlacement(1, 1, 2, 2), layoutWeight: 40 },
        { panelId: "slot-ontology", placement: testPlacement(3, 1, 2, 2), layoutWeight: 40 },
        { panelId: "slot-portfolio", placement: testPlacement(3, 1, 1, 1), layoutWeight: 35 },
        { panelId: "slot-trade", placement: testPlacement(4, 1, 1, 1), layoutWeight: 35 },
        { panelId: "slot-chart", placement: testPlacement(1, 3, 4, 2), layoutWeight: 100 },
        { panelId: "panel-chart-aapl", placement: testPlacement(1, 5, 4, 2), layoutWeight: 120 }
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
assert.deepEqual(addedChartSlot.gridRect, { col: 1, row: 5, colSpan: 4, rowSpan: 2 });
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
assert.ok(Math.abs(horizontalWheelDeltaToRightOffset(8, 2, 9, 72, 160, 1) - (8 - 32 / 9)) < 0.000001);
assert.equal(frontendClampRightOffset(-120, 72, 160), -48);
assert.equal(frontendClampRightOffset(-120, 72, 160, { extraFutureSlots: 14 }), -62);
assert.equal(latestCandleRightOffset(120), -30);
assert.equal(latestCandleRightOffset(104), -26);
assert.equal(latestCandleRightOffset(36), -9);
assert.equal(frontendLatestCandleRightOffset(6), -1);
const centeredRecentViewport = viewportCenteredOnLogicalIndex(
  140,
  138,
  { visibleCount: 120, rightOffset: 0 },
  800
);
assert.equal(centeredRecentViewport.rightOffset, -58.5);
const centeredRecentCandles = Array.from(
  { length: 140 },
  (_, index) => testCandle(new Date(Date.UTC(2026, 0, index + 1, 4)).toISOString(), 100 + index)
);
const centeredRecentScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: centeredRecentCandles,
  visibleCount: centeredRecentViewport.visibleCount,
  rightOffset: centeredRecentViewport.rightOffset
}), 800, 360);
const centeredRecentUnit = centeredRecentScene.semantic.units.find((unit) => (
  unit.kind === "candle" && unit.depth === 0 && unit.timestamp === centeredRecentCandles[138].timestamp
));
assert.ok(centeredRecentUnit);
assert.ok(Math.abs(
  slotCenterToX(centeredRecentScene, centeredRecentUnit.slotCenter)
    - (centeredRecentScene.plot.left + centeredRecentScene.plot.right) / 2
) <= 0.5);
assert.equal(
  viewportCenteredOnSceneX(140, centeredRecentViewport, 450, 400, 5, 800).rightOffset,
  -68.5
);
assert.deepEqual(frontendNormalizeViewport({ visibleCount: 72, rightOffset: -120 }, 160, 640, { extraFutureSlots: 14 }), {
  visibleCount: 72,
  rightOffset: -62
});
assert.equal(frontendClampVisibleCount(120, 3, 640, { minimumVisibleSlots: 120 }), 120);
assert.deepEqual(frontendNormalizeViewport({ visibleCount: 120, rightOffset: 0 }, 3, 640, { minimumVisibleSlots: 120 }), {
  visibleCount: 120,
  rightOffset: 0
});
assert.deepEqual(frontendZoomViewport({ visibleCount: 6, rightOffset: -1 }, 18, 3, 640), {
  visibleCount: 24,
  rightOffset: -1
});
assert.equal(viewportNeedsOlderCandles({ visibleCount: 120, rightOffset: -30 }, 120), false);
assert.equal(viewportNeedsOlderCandles({ visibleCount: 160, rightOffset: -30 }, 120), true);
assert.equal(viewportNeedsOlderCandles({ visibleCount: 60, rightOffset: 60 }, 120), true);
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
  { visibleCount: 120, rightOffset: frontendLatestCandleRightOffset(120) }
);
assert.deepEqual(
  viewportAfterSnapshotCandlesChange(
    [],
    sparseDailyCandles,
    "1D",
    { visibleCount: 120, rightOffset: frontendLatestCandleRightOffset(120) },
    null,
    640,
    { minimumVisibleSlots: 120 }
  ),
  { visibleCount: 120, rightOffset: frontendLatestCandleRightOffset(120) }
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
  viewportAfterSnapshotCandlesChange(
    sparseDailyCandles,
    restoredDailyCandles,
    "1D",
    { visibleCount: 6, rightOffset: frontendLatestCandleRightOffset(6) },
    null,
    640,
    { minimumVisibleSlots: 120 }
  ),
  { visibleCount: 6, rightOffset: frontendLatestCandleRightOffset(6) }
);
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
assert.deepEqual(
  viewportRevealingPrependedCandlesAfterChange(
    visibleCandlesBeforePrepend,
    [...prependedCandles, ...visibleCandlesBeforePrepend],
    { visibleCount: 6, rightOffset: 4 }
  ),
  { visibleCount: 6, rightOffset: 9 }
);
assert.deepEqual(
  viewportAfterOlderCandlesLoaded(
    visibleCandlesBeforePrepend,
    [...prependedCandles, ...visibleCandlesBeforePrepend],
    { visibleCount: 6, rightOffset: 4 },
    { visibleCount: 6, rightOffset: 4 }
  ),
  { visibleCount: 6, rightOffset: 4 }
);
assert.deepEqual(
  viewportAfterOlderCandlesLoaded(
    visibleCandlesBeforePrepend,
    [...prependedCandles, ...visibleCandlesBeforePrepend],
    { visibleCount: 6, rightOffset: 4 },
    { visibleCount: 6, rightOffset: 0 }
  ),
  { visibleCount: 6, rightOffset: 0 }
);
const cachedMinuteSnapshotCandles = Array.from(
  { length: 1000 },
  (_, index) => testCandle(new Date(Date.UTC(2026, 5, 25, 13, 30 + index)).toISOString(), 100 + index)
);
const tailSnapshotResponseCandles = cachedMinuteSnapshotCandles.slice(-120);
const detachedSnapshotViewport = { visibleCount: 60, rightOffset: 500 };
assert.deepEqual(
  anchoredViewportForCandles(
    tailSnapshotResponseCandles,
    "1m",
    { mode: "latest", visibleCount: 60 },
    detachedSnapshotViewport,
    640
  ),
  { visibleCount: 60, rightOffset: frontendLatestCandleRightOffset(60) }
);
assert.deepEqual(
  anchoredViewportForCandles(
    tailSnapshotResponseCandles,
    "1m",
    { mode: "right", timestamp: tailSnapshotResponseCandles[80].timestamp, visibleCount: 60 },
    detachedSnapshotViewport,
    640
  ),
  { visibleCount: 60, rightOffset: 39 }
);
assert.equal(
  anchoredViewportForCandles(
    tailSnapshotResponseCandles,
    "1m",
    null,
    detachedSnapshotViewport,
    640,
    { minimumVisibleSlots: 120 }
  ).rightOffset,
  60
);
assert.deepEqual(
  viewportAfterSnapshotCandlesChange(
    cachedMinuteSnapshotCandles,
    cachedMinuteSnapshotCandles,
    "1m",
    detachedSnapshotViewport,
    null,
    640,
    { minimumVisibleSlots: 120 }
  ),
  detachedSnapshotViewport
);
const appendedSnapshotCandles = [
  ...cachedMinuteSnapshotCandles,
  testCandle(new Date(Date.UTC(2026, 5, 25, 13, 30 + 1000)).toISOString(), 1100),
  testCandle(new Date(Date.UTC(2026, 5, 25, 13, 30 + 1001)).toISOString(), 1101)
];
assert.deepEqual(
  viewportAfterSnapshotCandlesChange(
    cachedMinuteSnapshotCandles,
    appendedSnapshotCandles,
    "1m",
    { visibleCount: 60, rightOffset: 0 },
    null,
    640
  ),
  { visibleCount: 60, rightOffset: frontendLatestCandleRightOffset(60) }
);
assert.deepEqual(
  viewportAfterSnapshotCandlesChange(
    cachedMinuteSnapshotCandles,
    appendedSnapshotCandles,
    "1m",
    detachedSnapshotViewport,
    null,
    640
  ),
  { visibleCount: 60, rightOffset: 502 }
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

const proposalPriceRangeState = frontendChartState({
  candles: [testCandle("2026-06-25T13:30:00.000Z", 100)],
  visibleCount: 20,
  drawings: [testDrawing({
    id: "chart-plan:AAPL:1D:trade-timing:test:risk",
    sourceProposalId: "chart-plan:AAPL:1D:trade-timing",
    type: "riskRewardBox",
    anchors: [
      { logicalIndex: 0, price: 100, paneId: "price", symbol: "AAPL" },
      { logicalIndex: 10, price: 80, paneId: "price", symbol: "AAPL" },
      { logicalIndex: 10, price: 150, paneId: "price", symbol: "AAPL" }
    ],
    style: { colorToken: "proposal", zoneSplit: true, labelPlacement: "axis" }
  })]
});
const proposalPriceRangeScene = buildFrontendChartScene(proposalPriceRangeState, 640, 360);
const hiddenProposalPriceRangeScene = buildFrontendChartScene({
  ...proposalPriceRangeState,
  drawings: proposalPriceRangeState.drawings.map((drawing) => ({ ...drawing, visible: false }))
}, 640, 360);
assert.deepEqual(
  [proposalPriceRangeScene.scales.minPrice, proposalPriceRangeScene.scales.maxPrice],
  [hiddenProposalPriceRangeScene.scales.minPrice, hiddenProposalPriceRangeScene.scales.maxPrice]
);
const extremeProposalPriceRangeScene = buildFrontendChartScene({
  ...proposalPriceRangeState,
  drawings: proposalPriceRangeState.drawings.map((drawing) => ({
    ...drawing,
    anchors: drawing.anchors.map((anchor, index) => index === 2 ? { ...anchor, price: 10_000 } : anchor)
  }))
}, 640, 360);
assert.deepEqual(
  [extremeProposalPriceRangeScene.scales.minPrice, extremeProposalPriceRangeScene.scales.maxPrice],
  [hiddenProposalPriceRangeScene.scales.minPrice, hiddenProposalPriceRangeScene.scales.maxPrice]
);
assert.equal(
  extremeProposalPriceRangeScene.scales.priceTicks.length,
  priceTickCountForHeight(extremeProposalPriceRangeScene.plot.priceBottom - extremeProposalPriceRangeScene.plot.top)
);

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
const snappedAnchorX = continuousAnchorBounds.left + (continuousAnchorBounds.right - continuousAnchorBounds.left) * 0.75;
const snappedAnchor = createFrontendCoordinateTransform(continuousAnchorBaseScene).pointToAnchor(
  snappedAnchorX,
  continuousAnchorBaseScene.plot.top + 20,
  "AAPL"
);
const snappedAnchorFromOtherSide = createFrontendCoordinateTransform(continuousAnchorBaseScene).pointToAnchor(
  continuousAnchorBounds.left + (continuousAnchorBounds.right - continuousAnchorBounds.left) * 0.25,
  continuousAnchorBaseScene.plot.top + 20,
  "AAPL"
);
assert.equal(snappedAnchor?.timestamp, "2026-06-25T13:30:00Z");
assert.equal(snappedAnchorFromOtherSide?.timestamp, snappedAnchor?.timestamp);
assert.equal(snappedAnchorFromOtherSide?.logicalIndex, snappedAnchor?.logicalIndex);
const snappedAnchorExpandedScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100)],
  visibleCount: 80
}), 720, 360, { expansions: [readyExpansion] });
const snappedAnchorPoint = snappedAnchor ? createFrontendCoordinateTransform(snappedAnchorExpandedScene).anchorToPoint(snappedAnchor) : null;
const snappedAnchorOtherPoint = snappedAnchorFromOtherSide
  ? createFrontendCoordinateTransform(snappedAnchorExpandedScene).anchorToPoint(snappedAnchorFromOtherSide)
  : null;
assert.ok(snappedAnchorPoint);
assert.equal(Math.round(snappedAnchorPoint?.x ?? -1), Math.round(snappedAnchorOtherPoint?.x ?? -2));
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

const dailyParallelDrawing = testDrawing({
  id: "drawing-daily-parallel",
  type: "trendParallelLines",
  sourceInterval: "1D",
  parallelLineCount: 4,
  anchors: [
    { timestamp: "2026-06-25T13:30:00Z", price: 100, paneId: "price", symbol: "AAPL" },
    { timestamp: "2026-06-26T13:30:00Z", price: 110, paneId: "price", symbol: "AAPL" },
    { timestamp: "2026-06-25T19:30:00Z", price: 107.5, paneId: "price", symbol: "AAPL" }
  ],
  label: "Daily channel"
});
const dailyParallelScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100), testCandle("2026-06-26T13:30:00Z", 104)],
  visibleCount: 20,
  drawings: [dailyParallelDrawing],
  selectedDrawingId: dailyParallelDrawing.id
}), 720, 360, { expansions: [readyExpansion] });
const dailyParallelItems = resolveDrawingRenderItems(dailyParallelScene, dailyParallelScene.chart.drawings);
const dailyWarpedParallel = dailyParallelItems.find((item) => item.kind === "timeWarpedParallelLines");
assert.ok(dailyWarpedParallel);
assert.equal(dailyParallelItems.some((item) => item.kind === "full" && item.drawing.id === dailyParallelDrawing.id), false);
assert.equal(dailyWarpedParallel.lines.length, 4);
assert.equal(dailyWarpedParallel.bands.length, 3);
assert.equal(dailyWarpedParallel.handles.length, 3);
assert.equal(dailyWarpedParallel.priceOffset, 5);
const projectedParallelLabel = drawingLabelPosition(dailyParallelScene, dailyParallelDrawing);
const projectedParallelLayout = drawingLabelLayout(dailyParallelScene, dailyParallelDrawing);
assert.ok(projectedParallelLabel && projectedParallelLayout);
assert.equal(projectedParallelLabel.x, projectedParallelLayout.textX);
assert.equal(projectedParallelLabel.y, projectedParallelLayout.baseline);
assert.ok(projectedParallelLayout.left >= dailyParallelScene.plot.left);
assert.ok(projectedParallelLayout.left + projectedParallelLayout.width <= dailyParallelScene.plot.right);
const dailyParallelStart = Date.parse("2026-06-25T13:30:00Z");
const dailyParallelSpan = Date.parse("2026-06-26T13:30:00Z") - dailyParallelStart;
dailyWarpedParallel.lines.forEach((linePoints, lineIndex) => {
  linePoints.forEach((point) => {
    const expectedPrice = 100 + 10 * ((point.time - dailyParallelStart) / dailyParallelSpan) + 5 * (lineIndex - 1);
    assert.ok(Math.abs(point.price - expectedPrice) < 0.000001, "expanded channel must retain its price/time slope and price offset");
  });
});
assert.ok(dailyWarpedParallel.bands.every((band) => band.length === dailyWarpedParallel.lines[0].length * 2));
const spacingLinePoint = dailyWarpedParallel.lines[2].find((point) => point.time === Date.parse("2026-06-25T19:30:00Z"));
assert.ok(spacingLinePoint);
assert.ok(Math.abs(spacingLinePoint.x - dailyWarpedParallel.handles[2].x) < 0.000001);
assert.ok(Math.abs(spacingLinePoint.y - dailyWarpedParallel.handles[2].y) < 0.000001);
const projectedBasePoint = dailyWarpedParallel.lines[1].find((point) => point.time === Date.parse("2026-06-25T19:30:00Z"));
assert.ok(projectedBasePoint);
assert.equal(hitTestDrawing(dailyParallelScene, projectedBasePoint.x, projectedBasePoint.y)?.drawing.id, dailyParallelDrawing.id);
const ordinaryParallelScene = buildFrontendChartScene(frontendChartState({
  interval: "1D",
  candles: [testCandle("2026-06-25T13:30:00Z", 100), testCandle("2026-06-26T13:30:00Z", 104)],
  drawings: [dailyParallelDrawing]
}), 720, 360);
const ordinaryParallelItems = resolveDrawingRenderItems(ordinaryParallelScene, ordinaryParallelScene.chart.drawings);
assert.equal(ordinaryParallelItems.some((item) => item.kind === "full" && item.drawing.id === dailyParallelDrawing.id), true);
assert.equal(ordinaryParallelItems.some((item) => item.kind === "timeWarpedParallelLines"), false);

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
assert.equal(clampVisibleCount(120, 1), 120);
assert.equal(clampVisibleCount(120, 1, 400), 50);
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

const initializingLiveDocument = createChartDocument("chart-doc-live-initial", "AAPL", "1m");
const initializingLiveState = {
  ...createInitialChartRuntimeState(),
  documents: { [initializingLiveDocument.id]: initializingLiveDocument }
};
const firstLiveCandleState = chartRuntimeReducer(initializingLiveState, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "AAPL",
    interval: "1m",
    data: candleA
  }
});
assert.deepEqual(firstLiveCandleState.documents[initializingLiveDocument.id]?.viewport, {
  visibleCount: defaultVisibleBarsForInterval("1m"),
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m"))
});
const secondLiveCandleState = chartRuntimeReducer(firstLiveCandleState, {
  kind: "chart.live",
  event: {
    type: "LIVE_CANDLE_UPDATE",
    symbol: "AAPL",
    interval: "1m",
    data: candleB
  }
});
assert.deepEqual(secondLiveCandleState.documents[initializingLiveDocument.id]?.viewport, {
  visibleCount: defaultVisibleBarsForInterval("1m"),
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m"))
});
const liveThenSnapshotState = chartRuntimeReducer(secondLiveCandleState, {
  kind: "chart.snapshot.loaded",
  snapshot: {
    symbol: "AAPL",
    interval: "1m",
    source: "alpaca",
    feed: "sip",
    indicators: { ma: [5, 20, 60], volume: true },
    candles: [candleA, candleB, candleC]
  }
});
assert.deepEqual(liveThenSnapshotState.documents[initializingLiveDocument.id]?.viewport, {
  visibleCount: defaultVisibleBarsForInterval("1m"),
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m"))
});

for (const interval of ["1D", "1W", "1M"] as const) {
  const document = createChartDocument(`chart-doc-live-initial-${interval}`, "AAPL", interval);
  const runtime = chartRuntimeReducer({
    ...createInitialChartRuntimeState(),
    documents: { [document.id]: document }
  }, {
    kind: "chart.live",
    event: {
      type: "LIVE_CANDLE_UPDATE",
      symbol: "AAPL",
      interval,
      data: candleA
    }
  });
  const expectedVisibleCount = defaultVisibleBarsForInterval(interval);
  assert.deepEqual(runtime.documents[document.id]?.viewport, {
    visibleCount: expectedVisibleCount,
    rightOffset: latestCandleRightOffset(expectedVisibleCount)
  });
}

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
assert.deepEqual(sharedCacheRuntime.documents["shared-doc-b"]?.viewport, {
  visibleCount: defaultVisibleBarsForInterval("1m"),
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m"))
});
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
assert.equal(
  sharedCacheRuntime.documents["shared-doc-b"]?.viewport.rightOffset,
  latestCandleRightOffset(defaultVisibleBarsForInterval("1m"))
);

const boundedCacheDocument = createChartDocument("bounded-cache-doc", "ACTIVE", "1m");
let boundedCacheRuntime = {
  ...createInitialChartRuntimeState(),
  documents: { [boundedCacheDocument.id]: boundedCacheDocument }
};
const cacheFixtureCandle = {
  ...candleA,
  timestamp: "2026-07-08T13:30:00.000Z"
};
boundedCacheRuntime = chartRuntimeReducer(boundedCacheRuntime, {
  kind: "chart.snapshot.loaded",
  snapshot: { symbol: "ACTIVE", interval: "1m", candles: [cacheFixtureCandle] }
});
for (let index = 0; index < maxInactiveCandleCacheKeys + 3; index += 1) {
  boundedCacheRuntime = chartRuntimeReducer(boundedCacheRuntime, {
    kind: "chart.snapshot.loaded",
    snapshot: { symbol: `CACHE${index}`, interval: "1m", candles: [cacheFixtureCandle] }
  });
}
assert.ok(boundedCacheRuntime.candlesByKey[candleKey("ACTIVE", "1m")]);
assert.equal(Object.keys(boundedCacheRuntime.candlesByKey).length, maxInactiveCandleCacheKeys + 1);
assert.equal(boundedCacheRuntime.candlesByKey[candleKey("CACHE0", "1m")], undefined);
assert.ok(boundedCacheRuntime.candlesByKey[candleKey(`CACHE${maxInactiveCandleCacheKeys + 2}`, "1m")]);

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
assert.match(appSource, /layoutResolutionProblemMessage/);
assert.match(appSource, /agentLayoutApplySucceeded/);
assert.match(appSource, /showAgentNotice\(problemMessage, "error"\);[\s\S]*return "notice";/);
assert.doesNotMatch(appSource, /hasChartCommandTarget/);
assert.match(appSource, /onLogin=\{login\}/);
assert.match(appSource, /onLogout=\{\(\) => void logout\(\)\}/);
assert.match(appSource, /openSymbolPage/);
assert.doesNotMatch(appSource, /syncPageSymbolFromChart/);
assert.doesNotMatch(appSource, /chartCommandTargetContentId/);
assert.match(appSource, /chartPanelHandlesRef/);
assert.doesNotMatch(appSource, /showChartInCurrentPanel/);
assert.match(appSource, /normalizedShortcutSymbols/);
assert.match(appSource, /shortcutSymbols\.length > 1/);
assert.match(appSource, /panelLayoutStorageKey/);
assert.match(appSource, /restoreTiledPanelStateSnapshot/);
assert.match(appSource, /syncPrimaryChartSymbol/);
assert.match(appSource, /ensurePrimaryChartSymbol/);
assert.doesNotMatch(appSource, /setPrimaryChart(Symbol|Selection)/);
assert.match(appSource, /createInitialTiledPanelState\(viewport, \{/);
assert.match(appSource, /createOrderFlowDemoPanelState/);
assert.match(appSource, /isOrderFlowDemoRoute/);
assert.match(appSource, /import\.meta\.env\.DEV !== true/);
assert.doesNotMatch(appSource, /orderFlowDemoData/);
assert.doesNotMatch(appSource, /차트를 같이 표시했습니다/);
assert.doesNotMatch(appSource, /배치로 적용했습니다/);
assert.match(appSource, /chartAction === "add"/);
assert.match(appSource, /chartTargetSymbol/);
assert.match(appSource, /isInternalLayoutRationale/);
assert.match(appSource, /ui_clarify/);
assert.match(appSource, /isLikelyPresetLoadPrompt\(prompt, agentPresetSummaries\)/);
assert.doesNotMatch(appSource, /showPresetApplyFeedback/);
assert.match(appSource, /return presetLoadStatus === "applied" \? "ui-action" : "notice";/);
const agentShortcutIndex = appSource.indexOf("resolveAgentChartShortcut(prompt)");
const presetShortcutIndex = appSource.indexOf("isLikelyPresetLoadPrompt(prompt, agentPresetSummaries)");
assert.ok(presetShortcutIndex > -1);
assert.ok(presetShortcutIndex < agentShortcutIndex);
assert.ok(agentShortcutIndex >= 0);
assert.ok(agentShortcutIndex < appSource.indexOf("if (mainView.mode !== \"chart\")", agentShortcutIndex));
assert.match(appSource, /기업명\/티커만 입력하면 차트를 열 수 있고/);
assert.match(appSource, /resolveAgentLayoutCommand\(analysisPayload\)/);
const runAgentPromptIndex = appSource.indexOf("const runAgentPrompt");
assert.ok(appSource.indexOf("resolveAgentLayoutCommand(analysisPayload)", runAgentPromptIndex) < appSource.indexOf("requestAgentAnalysisPayload(analysisRequestPayload", runAgentPromptIndex));

const bottomCommandBarSource = readFileSync(fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)), "utf-8");
const headerNotificationMenuSource = readFileSync(fileURLToPath(new URL("../src/alerts/HeaderNotificationMenu.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(bottomCommandBarSource, /AgentSubmitResult|ChatLogEntry|chatPanelOpen/);
assert.doesNotMatch(bottomCommandBarSource, /Agent log|AGENT LOG|agent-log-button|bottom-chat-panel/);
assert.match(bottomCommandBarSource, /agentNotice: AgentHeaderNotice \| null/);
assert.match(bottomCommandBarSource, /window\.setTimeout\(\(\) => onAgentNoticeDismiss\(agentNotice\.id\), 3000\)/);
assert.match(bottomCommandBarSource, /기업명\/티커로 차트 열기/);
assert.match(bottomCommandBarSource, /선택한 자료/);

const presetDockSource = readFileSync(fileURLToPath(new URL("../src/components/PresetDock.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(presetDockSource, /statusFeedback/);
assert.doesNotMatch(presetDockSource, /layout-preset-status/);
assert.doesNotMatch(presetDockSource, /role="status"/);
assert.doesNotMatch(presetDockSource, /aria-live="polite"/);
assert.match(presetDockSource, /createLayoutEditControl\(layoutEditMode, onEnterLayoutEdit, onExitLayoutEdit\)/);
assert.match(presetDockSource, /aria-pressed=\{layoutEditControl\.pressed\}/);
assert.match(appSource, /<PresetDock[\s\S]*layoutEditMode=\{layoutEditMode\}[\s\S]*onExitLayoutEdit=\{exitLayoutEditMode\}/);
const layoutEditButtonIndex = presetDockSource.indexOf("aria-label={layoutEditControl.label}");
const presetSaveButtonIndex = presetDockSource.indexOf('aria-label="프리셋 저장"');
const presetDeleteButtonIndex = presetDockSource.indexOf('aria-label="프리셋 삭제"');
assert.ok(layoutEditButtonIndex >= 0);
assert.ok(presetSaveButtonIndex > layoutEditButtonIndex);
assert.ok(presetDeleteButtonIndex > presetSaveButtonIndex);

assert.doesNotMatch(bottomCommandBarSource, /선택한 차트에 명령하기/);
assert.doesNotMatch(bottomCommandBarSource, /BottomMenuKey|leftMenuKeys|sideMenuKeys|rightMenuKeys/);
assert.match(bottomCommandBarSource, /className="workspace-top-nav"/);
assert.match(bottomCommandBarSource, /className="workspace-bottom-nav"/);
assert.match(bottomCommandBarSource, /workspace-top-center-flip[\s\S]*workspace-agent-notice/);
assert.match(bottomCommandBarSource, /role="status"[\s\S]*aria-live="polite"/);
assert.match(bottomCommandBarSource, /className="workspace-top-login"/);
assert.match(bottomCommandBarSource, /onClick=\{authUser \? onLogout : onLogin\}/);
assert.match(bottomCommandBarSource, /topLoginLabel\(authEnabled, authLoading, authUser\)/);
const simulatorControlIndex = bottomCommandBarSource.indexOf("<SimulatorControl");
const headerNotificationIndex = bottomCommandBarSource.indexOf("<HeaderNotificationMenu");
const topLoginIndex = bottomCommandBarSource.indexOf('className="workspace-top-login"');
assert.ok(simulatorControlIndex >= 0 && headerNotificationIndex > simulatorControlIndex && topLoginIndex > headerNotificationIndex);
assert.match(bottomCommandBarSource, /fetchNotifications\(controller\.signal\)/);
assert.match(bottomCommandBarSource, /markAllNotificationsRead\(\)/);
assert.match(bottomCommandBarSource, /removePersistedAlertToastState/);
assert.match(headerNotificationMenuSource, /aria-controls="workspace-header-notification-popover"/);
assert.match(headerNotificationMenuSource, /workspace-top-notification-badge/);
assert.match(headerNotificationMenuSource, /모두 읽기/);
assert.match(headerNotificationMenuSource, /formatNotificationToastMessage/);
assert.doesNotMatch(bottomCommandBarSource, /chart-agent-dev-toggle/);
assert.doesNotMatch(bottomCommandBarSource, /onChartCommandModeChange/);
assert.doesNotMatch(bottomCommandBarSource, /차트 조작 에이전트 테스트/);
assert.doesNotMatch(bottomCommandBarSource, /PortfolioHoldingsOnlyPanel|PortfolioInvestmentStatusPanel|SettingsMenu/);
assert.doesNotMatch(bottomCommandBarSource, /fetchNextMarketOpen/);
assert.doesNotMatch(bottomCommandBarSource, /isMarketOpenNotification/);
assert.doesNotMatch(bottomCommandBarSource, /alertToastState\.queue\.length === 0/);
assert.doesNotMatch(bottomCommandBarSource, /createMarketOpenNotification\(nextOpenAt\), \{ autoDismissMs: alertToastAdvanceMs \}/);
assert.match(bottomCommandBarSource, /payload\.type === "snapshot"/);
assert.doesNotMatch(bottomCommandBarSource, /\.reverse\(\)[\s\S]*enqueueAlertToast/);
assert.match(bottomCommandBarSource, /setTimeout\(\(\) => \{[\s\S]*advanceAlertToast\(\);[\s\S]*alertToastAdvanceMs/);
assert.match(bottomCommandBarSource, /onOpenChart=\{openAlertToastChart\}/);
assert.match(bottomCommandBarSource, /onSelectSymbol\(symbol\)/);
const alertMenuSource = readFileSync(fileURLToPath(new URL("../src/alerts/AlertMenu.tsx", import.meta.url)), "utf-8");
assert.match(alertMenuSource, /본장 시작 알림/);
assert.match(alertMenuSource, /deleteAllAlerts/);
assert.match(alertMenuSource, /등록된 알림 전체 삭제/);
assert.match(alertMenuSource, /등록된 알림 전체 삭제 확인/);
assert.match(alertMenuSource, /등록된 알림 전체 삭제 취소/);
assert.doesNotMatch(alertMenuSource, /window\.confirm/);
assert.match(alertMenuSource, /is-form-only/);
assert.match(alertMenuSource, /notificationChartSymbol/);
assert.match(alertMenuSource, /onOpenNotificationSymbol\(chartSymbol\)/);
assert.match(alertMenuSource, /onClick=\{\(\) => void openNotification\(notification\)\}/);
assert.doesNotMatch(alertMenuSource, /disabled=\{saving \|\| Boolean\(notification\.readAt\)\}/);

const priceConditionPanelSource = readFileSync(fileURLToPath(new URL("../src/components/PriceConditionPanel.tsx", import.meta.url)), "utf-8");
assert.match(priceConditionPanelSource, /role="tablist"/);
assert.match(priceConditionPanelSource, /view === "account" \? "가상계좌 가격 조건"/);
assert.doesNotMatch(priceConditionPanelSource, /\{ id: "price", label:/);
const notificationCenterPanelSource = readFileSync(fileURLToPath(new URL("../src/components/NotificationCenterPanel.tsx", import.meta.url)), "utf-8");
assert.match(notificationCenterPanelSource, /알림/);
assert.match(notificationCenterPanelSource, /관심 기업/);
assert.match(notificationCenterPanelSource, /role="tabpanel"/);
assert.match(notificationCenterPanelSource, /fetchWatchlist/);
assert.match(notificationCenterPanelSource, /fetchAlerts/);
assert.match(notificationCenterPanelSource, /리마인더/);
assert.match(notificationCenterPanelSource, /기업 알림/);
assert.match(notificationCenterPanelSource, /미국장 개장/);
assert.match(notificationCenterPanelSource, /RSI 과매수·과매도/);
assert.match(notificationCenterPanelSource, /거래량 급증/);
assert.doesNotMatch(notificationCenterPanelSource, /실적 발표 D-1|earningsD1/);
assert.doesNotMatch(notificationCenterPanelSource, /notification-threshold-chips/);
assert.match(notificationCenterPanelSource, /AlarmSwitch/);
assert.match(notificationCenterPanelSource, /role="switch"/);
assert.doesNotMatch(notificationCenterPanelSource, />켜짐<|>꺼짐</);
assert.doesNotMatch(notificationCenterPanelSource, /기업 자세히 보기/);
assert.match(notificationCenterPanelSource, /condition\.operator === "below" \? "≤" : "≥"/);
assert.doesNotMatch(notificationCenterPanelSource, /Trash2/);
assert.match(notificationCenterPanelSource, /company-alerts-heading[\s\S]*alert-edit-button/);
assert.match(notificationCenterPanelSource, /editingAlerts \? "완료" : "편집"/);
assert.doesNotMatch(notificationCenterPanelSource, /disabled=\{alertsLoading \|\| alerts\.length === 0\}/);
assert.doesNotMatch(notificationCenterPanelSource, /alert-row-edit-button|alert-master-actions/);
assert.match(notificationCenterPanelSource, /alertValidity/);
assert.match(notificationCenterPanelSource, /createdViaLabel/);
assert.doesNotMatch(notificationCenterPanelSource, /1단계|2단계/);
assert.match(notificationCenterPanelSource, /changePercentBySymbol/);
assert.match(notificationCenterPanelSource, /onClick=\{\(\) => onOpenCompany\(company\.symbol\)\}/);
assert.match(notificationCenterPanelSource, /가격 조건 패널/);
assert.doesNotMatch(notificationCenterPanelSource, /시장 일정과 사이트 지표 알림|패널과 에이전트에서 설정한 조건/);
assert.match(notificationCenterPanelSource, /refreshWatchlist/);
assert.match(notificationCenterPanelSource, /다시 불러오기/);
assert.doesNotMatch(notificationCenterPanelSource, /SymbolSearch|portalMenu|replaceWatchlistSymbols/);
assert.doesNotMatch(notificationCenterPanelSource, /watchlist-list-toolbar|watchlist-company-reasons/);
assert.doesNotMatch(notificationCenterPanelSource, /watchlist-candidate-card/);
assert.doesNotMatch(notificationCenterPanelSource, /watchlist-search-star|watchlist-row-star|onOpenNews|CompanyNewsPreview/);
assert.doesNotMatch(notificationCenterPanelSource, /localStorage/);

const notificationPreferencesSource = readFileSync(fileURLToPath(new URL("../src/alerts/notificationPreferences.tsx", import.meta.url)), "utf-8");
assert.match(notificationPreferencesSource, /\/api\/notification-preferences/);
assert.match(bottomCommandBarSource, /enqueueAlertToastState/);
const targetPriceNotification = {
  id: 1,
  eventId: "target-price",
  type: "alert.price_cross",
  payload: { symbol: "AAPL" }
};
const defaultPreferences = normalizeNotificationPreferences({ persisted: true });
assert.deepEqual(defaultPreferences.thresholds, { rapidMovePct: 5, volumeSpikeMultiple: 3 });
assert.deepEqual(normalizeNotificationPreferences({
  thresholds: { rapidMovePct: 10, volumeSpikeMultiple: 5 }
}).thresholds, { rapidMovePct: 10, volumeSpikeMultiple: 5 });
assert.deepEqual(normalizeNotificationPreferences({
  thresholds: { rapidMovePct: 7, volumeSpikeMultiple: 4 }
}).thresholds, { rapidMovePct: 5, volumeSpikeMultiple: 3 });
assert.equal(notificationSettingForItem(targetPriceNotification), "targetPrice");
assert.equal(shouldShowNotificationToast(targetPriceNotification, defaultPreferences), true);
assert.equal(shouldShowNotificationToast(targetPriceNotification, normalizeNotificationPreferences({
  settings: { targetPrice: false }
})), false);
assert.equal(shouldShowNotificationToast(targetPriceNotification, normalizeNotificationPreferences({
  companyOverrides: { AAPL: false }
})), false);
const volumeNotification = {
  id: -1,
  eventId: "volume-spike",
  type: "AGENT_ALERT",
  payload: { decision: { symbol: "NVDA", eventType: "volume_spike" } }
};
assert.equal(notificationSettingForItem(volumeNotification), "volumeSpike");
assert.equal(shouldShowNotificationToast(volumeNotification, defaultPreferences), false);
const rapidMoveNotification = {
  id: -4,
  eventId: "rapid-move",
  type: "AGENT_ALERT",
  payload: { decision: { symbol: "NVDA", eventType: "price_surge", metrics: { changePercent: 5 } } }
};
assert.equal(shouldShowNotificationToast(rapidMoveNotification, normalizeNotificationPreferences({
  settings: { rapidMove: true },
  thresholds: { rapidMovePct: 10 }
})), false);
assert.equal(shouldShowNotificationToast({
  ...rapidMoveNotification,
  payload: { decision: { symbol: "NVDA", eventType: "price_surge", metrics: { changePercent: 10 } } }
}, normalizeNotificationPreferences({
  settings: { rapidMove: true },
  thresholds: { rapidMovePct: 10 }
})), true);
const anomalyNotification = {
  id: -2,
  eventId: "risk-anomaly",
  type: "AGENT_ALERT",
  payload: { decision: { symbol: "NVDA", eventType: "risk_anomaly_surge" } }
};
assert.equal(notificationSettingForItem(anomalyNotification), "aiAnomaly");
const excludedEarningsResultNotification = {
  id: -3,
  eventId: "earnings-result",
  type: "AGENT_ALERT",
  payload: { decision: { symbol: "NVDA", eventType: "earnings" } }
};
assert.equal(notificationSettingForItem(excludedEarningsResultNotification), null);
assert.equal(shouldShowNotificationToast(excludedEarningsResultNotification, defaultPreferences), false);
assert.equal(shouldShowNotificationToast({
  id: 9,
  eventId: "removed-earnings-d1",
  type: "system.earnings_d1",
  payload: { kind: "earnings_d1", symbol: "NVDA" }
}, defaultPreferences), false);

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
assert.match(panelContentRendererSource, /PortfolioHoldingsOnlyPanel/);
assert.match(panelContentRendererSource, /ChartComparisonPanel/);
assert.match(panelContentRendererSource, /content\.kind === "compare"/);
assert.match(panelContentRendererSource, /content\.kind === "chartPatternList"/);
assert.match(panelContentRendererSource, /ChartPatternListPanel/);
assert.match(panelContentRendererSource, /onSelectPatternAsset/);
assert.doesNotMatch(panelContentRendererSource, /workspace-panel-empty/);
assert.match(panelContentRendererSource, /ChartToolbarSelect/);
assert.match(panelContentRendererSource, /variant="interval"/);
assert.match(panelContentRendererSource, /chartPanelHandleRef\.current\?\.setInterval/);
assert.match(panelContentRendererSource, /bidAskChartIntervals/);
assert.match(panelContentRendererSource, /chartIntervalOptions\.map/);
assert.doesNotMatch(panelContentRendererSource, /disabled=\{chartType === "bidask"\}/);
assert.doesNotMatch(panelContentRendererSource, /chart-panel-drag-strip|chart-instance-close|onClosePanel|onChartSwapPointerDown/);
assert.match(panelContentRendererSource, /PriceConditionPanel[\s\S]*symbols=\{symbols\}[\s\S]*marketItems=\{marketItems\}[\s\S]*onOpenCompany=\{onOpenCompany\}/);
assert.match(panelContentRendererSource, /알림과 관심 기업을 불러오는 중입니다/);

const chartToolbarSelectSource = readFileSync(fileURLToPath(new URL("../src/components/ChartToolbarSelect.tsx", import.meta.url)), "utf-8");
assert.match(chartToolbarSelectSource, /createPortal/);
assert.match(chartToolbarSelectSource, /rect\.bottom \+ menuGap/);
assert.match(chartToolbarSelectSource, /role="listbox"/);
assert.match(chartToolbarSelectSource, /aria-activedescendant/);
assert.match(chartToolbarSelectSource, /chart-toolbar-select-option-icon/);

const portfolioHoldingsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/PortfolioHoldingsPanel.tsx", import.meta.url)), "utf-8");
assert.match(portfolioHoldingsPanelSource, /RefreshCcw/);
assert.match(portfolioHoldingsPanelSource, /포트폴리오 새로고침/);
assert.match(portfolioHoldingsPanelSource, /loadPortfolioHoldingsStore\(source, true\)/);
assert.match(portfolioHoldingsPanelSource, /new Map<PortfolioHoldingsSource, PortfolioHoldingsStore>/);
assert.match(portfolioHoldingsPanelSource, /new URLSearchParams\(\{ market: "overseas", currency: "USD", source \}\)/);
assert.match(portfolioHoldingsPanelSource, /subscribePortfolioHoldingsStore/);
assert.match(portfolioHoldingsPanelSource, /onClick=\{\(\) => void loadHoldings\(\)\}/);

const companySummaryPanelSource = readFileSync(fileURLToPath(new URL("../src/components/CompanySummaryPanel.tsx", import.meta.url)), "utf-8");
assert.equal(companySummaryPanelSource.match(/preserveAspectRatio="xMidYMid meet"/g)?.length, 1);
assert.match(companySummaryPanelSource, /company-profitability-plot[^>]*preserveAspectRatio="none"/);
assert.match(companySummaryPanelSource, /company-stability-ratios-plot[^>]*preserveAspectRatio="none"/);
assert.match(companySummaryPanelSource, /function useFinancialChartSize\(\)[\s\S]*new ResizeObserver\(measure\)/);
assert.match(companySummaryPanelSource, /financialChartPlotAspectRatio = \(620 - 112 - 20\) \/ \(360 - 10 - 34\)/);
assert.match(companySummaryPanelSource, /height: Math\.min\(measuredSize\.height, Math\.round\(proportionalHeight\)\)/);
assert.equal(companySummaryPanelSource.match(/<svg ref=\{chartRef\} className="company-(?:profitability|stability)/g)?.length, 1);

const chartPanelSource = readFileSync(fileURLToPath(new URL("../src/components/ChartPanel.tsx", import.meta.url)), "utf-8");
const chartEventOverlaySource = readFileSync(fileURLToPath(new URL("../src/components/ChartEventOverlay.tsx", import.meta.url)), "utf-8");
const chartDocumentAdapterSource = readFileSync(fileURLToPath(new URL("../src/chart/chartDocumentAdapter.ts", import.meta.url)), "utf-8");
const symbolSearchSource = readFileSync(fileURLToPath(new URL("../src/components/SymbolSearch.tsx", import.meta.url)), "utf-8");
const orderFlowPanelSource = readFileSync(fileURLToPath(new URL("../src/components/OrderFlowPanel.tsx", import.meta.url)), "utf-8");
assert.match(chartPanelSource, /const chartVolumeProfileBinCount = 10;/);
assert.equal((chartPanelSource.match(/targetBins: chartVolumeProfileBinCount/g) ?? []).length, 1);
assert.match(chartPanelSource, /scene\.scales\.minPrice/);
assert.match(chartPanelSource, /scene\.scales\.maxPrice/);
assert.match(chartPanelSource, /volumeProfileRequestKey/);
assert.match(chartPanelSource, /volumeProfilePartialRetryDelaysMs/);
assert.match(chartPanelSource, /volumeProfileResponseMatchesRequest/);
assert.match(chartPanelSource, /closedVisibleCandles/);
assert.doesNotMatch(chartPanelSource, /chart\.layers\["volume-profile"\],\n    chart\.symbol,\n    visibleProfileRange,\n  \]/);
assert.match(chartPanelSource, /chartStateFromDocument/);
assert.match(chartPanelSource, /ChartDrawingDock/);
assert.match(chartPanelSource, /chart-drawing-dock-scroller/);
assert.match(chartPanelSource, /chart-add-dropdown-anchor/);
assert.match(chartPanelSource, /chart-current-price|currentPriceMarker/);
assert.match(chartEventOverlaySource, /data-chart-event-id=\{marker\.id\}/);
assert.match(chartPanelSource, /detail\?\.chartDocumentId !== document\.id/);
assert.match(chartPanelSource, /chartCommentaryReferenceOpenEventName/);
assert.match(chartPanelSource, /chartCommentaryIndicatorToggleEventName/);
assert.match(chartPanelSource, /commentaryIndicatorStatuses\[detail\.layer\] === "unavailable"/);
assert.match(chartPanelSource, /setVolumeProfileRuntimeStatus\("loading"\)/);
assert.match(chartPanelSource, /setVolumeProfileRuntimeStatus\("ready"\)/);
assert.match(chartPanelSource, /setVolumeProfileRuntimeStatus\("empty"\)/);
assert.match(chartPanelSource, /setVolumeProfileRuntimeStatus\("error"\)/);
assert.match(chartPanelSource, /setVolumeProfileRuntimeStatus\("unavailable"\)/);
assert.match(chartPanelSource, /expectedCandleKey === selectedCandleKey[\s\S]*setSelectedSemanticNode\(null\)/);
assert.match(chartPanelSource, /viewportCenteredOnLogicalIndex\(/);
assert.match(chartPanelSource, /viewportCenteredOnSceneX\(/);
assert.doesNotMatch(chartPanelSource, /centeredRightOffset = Math\.max\(0/);
assert.match(chartPanelSource, /pendingCommentaryNavigationRef\.current/);
assert.match(chartEventOverlaySource, /markers\.find\(\(item\) => item\.id === openRequest\.eventId\)/);
assert.match(chartEventOverlaySource, /openRequest\.anchor\?\.x/);
assert.match(chartEventOverlaySource, /current\?\.event\.id === marker\.id \? null/);
assert.match(chartEventOverlaySource, /onSelectedEventChange\?\.\(selected\?\.event\.id \?\? null\)/);
assert.match(chartEventOverlaySource, /data-chart-commentary-event-trigger/);
assert.doesNotMatch(chartPanelSource, /querySelector\([^)]*chart-commentary/);
assert.ok(
  chartPanelSource.indexOf("syncChartEventMarkerPositions(chartWrapRef.current, nextEventMarkers)")
    < chartPanelSource.indexOf("setChartEventMarkers(nextEventMarkers)")
);
assert.match(chartPanelSource, /liveTradePrice/);
assert.doesNotMatch(chartPanelSource, /applyChartAction|applyChartActions/);
assert.match(chartPanelSource, /variant="drawing-tool"/);
assert.match(chartPanelSource, /variant="drawing-count"/);
assert.match(chartPanelSource, /window\.document\.body/);
assert.doesNotMatch(chartPanelSource, /chart-tool-group-menu|chart-parallel-line-count/);
assert.match(chartPanelSource, /ResizeObserver/);
assert.match(chartPanelSource, /clientWidth \* 0\.7/);
assert.match(chartPanelSource, /useImmediateChartTooltip/);
assert.match(chartPanelSource, /5기간 단순 이동평균선/);
assert.match(chartPanelSource, /window\.document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/);
assert.doesNotMatch(chartPanelSource, /interval-stepper/);
assert.match(chartPanelSource, /chart\.timeframe\.set/);
assert.doesNotMatch(chartPanelSource, /chart\.comparison\.add/);
assert.match(chartPanelSource, /chart\.comparison\.remove/);
assert.match(chartPanelSource, /maxComparisonCount/);
assert.doesNotMatch(chartPanelSource, /onOpenComparisonPanel|placeholder="비교 패널"|chart-comparison-picker/);
assert.match(chartPanelSource, /comparisons: renderComparisons/);
assert.match(chartPanelSource, /trendExtensionButtons\.map/);
assert.doesNotMatch(chartPanelSource, /fetchOrderFlowDaily|orderFlowDaily|visibleOrderFlowRange|orderFlowTodayDay/);
assert.match(chartPanelSource, /orderFlow: orderFlowActive \? \{[\s\S]*minutes: orderFlowToday[\s\S]*\} : null/);
assert.match(chartPanelSource, /chart\.chartType === "bidask" && isBidAskChartInterval\(chart\.interval\)/);
assert.match(chartPanelSource, /orderFlowDemoContextFromCandles\(chart\.candles, chart\.interval\)/);
assert.match(chartPanelSource, /fetchOrderFlowIntraday\(chart\.symbol, controller\.signal, orderFlowDemoAnchor\)/);
assert.doesNotMatch(chartPanelSource, /\}, \[\s*chart\.interval,\s*chart\.symbol,\s*orderFlowActive/);
assert.doesNotMatch(chartPanelSource, /setInterval\([\s\S]{0,240}fetchCandles/);
assert.match(chartPanelSource, /toggleAgentSemanticUnitSelection/);
assert.match(chartPanelSource, /hitTestTimeAxisUnit/);
assert.match(chartPanelSource, /semanticSelectionEnabled = chart\.chartType !== "line"/);
assert.match(chartPanelSource, /semanticDigEnabled = semanticSelectionEnabled && chart\.chartType !== "bidask"/);
assert.match(chartPanelSource, /chart\.chartType === "bidask" && previousChartType !== "bidask"/);
assert.match(chartPanelSource, /semanticDigEnabled\s*\?\s*hitTestTimeAxisUnit/);
assert.match(chartPanelSource, /action: "dig"/);
assert.match(chartPanelSource, /action: "agent-select"/);
assert.match(symbolSearchSource, /createPortal/);
assert.match(symbolSearchSource, /position: "fixed"/);
assert.match(symbolSearchSource, /allowCustomSymbol/);
assert.match(symbolSearchSource, /portalMenu/);
assert.match(orderFlowPanelSource, /order-flow-hover-overlay/);
assert.match(orderFlowPanelSource, /onWheel=\{handleCanvasWheel\}/);
assert.match(orderFlowPanelSource, /stepOrderFlowTargetRows/);
assert.match(orderFlowPanelSource, /data-order-flow-symbol=\{normalizedSymbol\}/);
assert.match(orderFlowPanelSource, /data-order-flow-resolution=\{resolution\}/);
assert.doesNotMatch(orderFlowPanelSource, /fetchOrderFlowDaily|semanticSelection|selectedDay|fallbackDay|dailyMode|disabledWindowBadge|overlayVisible|overlayIntentRef/);
assert.doesNotMatch(orderFlowPanelSource, /order-flow-control-select|ORDER_FLOW_PRICE_STEPS/);
const orderFlowRendererBlock = panelContentRendererSource.slice(
  panelContentRendererSource.indexOf('if (content.kind === "orderFlow")'),
  panelContentRendererSource.indexOf('if (content.kind === "trade")')
);
assert.match(orderFlowRendererBlock, /symbol=\{readOrderFlowSymbol\(content\)\}/);
assert.doesNotMatch(orderFlowRendererBlock, /semanticSelection|defaultToPinnedSymbol|readPanelSymbol/);
const chartCanvasSource = readFileSync(fileURLToPath(new URL("../src/chart/ChartCanvas.tsx", import.meta.url)), "utf-8");
const chartCanvasLayerSource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("const layers: Array<() => void>"),
  chartCanvasSource.indexOf("layers.forEach((drawLayer)")
);
const chartCanvasAnalysisFocusSource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("function analysisFocusDrawingBatch"),
  chartCanvasSource.indexOf("function drawBaseChart")
);
const treeMapCanvasSource = readFileSync(fileURLToPath(new URL("../src/treemap/TreeMapCanvas.tsx", import.meta.url)), "utf-8");
const orderFlowRenderSource = readFileSync(fileURLToPath(new URL("../src/chart/orderFlowRender.ts", import.meta.url)), "utf-8");
const semanticTimelineSource = readFileSync(fileURLToPath(new URL("../src/chart/semanticTimeline.ts", import.meta.url)), "utf-8");
const treeMapPointerSelectionSource = treeMapCanvasSource.slice(
  treeMapCanvasSource.indexOf("const selectPointerTile"),
  treeMapCanvasSource.indexOf("return (", treeMapCanvasSource.indexOf("const selectPointerTile"))
);
assert.match(treeMapPointerSelectionSource, /event: ReactPointerEvent<HTMLCanvasElement>/);
assert.match(treeMapPointerSelectionSource, /hitTestTreeMapTile\(tilesRef\.current, x, y\)/);
assert.match(treeMapCanvasSource, /onClick=\{interactive \? selectPointerTile : undefined\}/);
assert.doesNotMatch(treeMapCanvasSource, /selectHoveredTile/);
assert.doesNotMatch(chartCanvasSource, /chartForScene/);
assert.match(chartCanvasSource, /drawCarryForwardGapCandles\(context, scene, "candle"\)/);
assert.match(chartCanvasSource, /drawCarryForwardGapCandles\(context, scene, "ohlc"\)/);
assert.match(chartCanvasSource, /function drawCarryForwardCandle/);
assert.match(chartCanvasSource, /function drawCarryForwardOhlcBar/);
assert.doesNotMatch(chartCanvasSource, /function drawCarryForwardGaps/);
assert.doesNotMatch(chartCanvasSource, /function drawTimeGapUnit/);
assert.match(chartCanvasSource, /\(candle\.close - baseClose\).*100/);
assert.match(chartCanvasSource, /profile\.sideClassification === "estimated" \? "Estimated VP" : "VP"/);
assert.match(chartCanvasSource, /if \(!Number\.isFinite\(bucket\.volume\) \|\| bucket\.volume <= 0\) \{\s*return;/);
assert.match(chartCanvasSource, /const bollingerFillAlpha = 0\.1;/);
assert.match(chartCanvasSource, /context\.fillStyle = candleStrokeColor\(candle\.close >= candle\.open\)/);
assert.match(chartCanvasSource, /function horizontalGuideRight[\s\S]*return scene\.plot\.right/);
assert.match(chartCanvasSource, /function drawPaneSeparators[\s\S]*context\.strokeStyle = colors\.axis;[\s\S]*context\.globalAlpha = 0\.38;[\s\S]*line\(context, scene\.plot\.left, y, scene\.width, y\)/);
assert.match(chartCanvasSource, /const volumeProfileAlpha = \{[\s\S]*poc: 0\.28[\s\S]*valueAreaBase: 0\.12[\s\S]*valueAreaScale: 0\.1[\s\S]*tailBase: 0\.08[\s\S]*tailScale: 0\.06[\s\S]*pocLine: 0\.34/);
assert.match(chartCanvasSource, /function drawOrderFlowColumns/);
assert.match(chartCanvasSource, /drawOrderFlowChartColumn\(context, rect, ladder, colors/);
assert.match(chartCanvasSource, /candle: unit\.candle/);
assert.match(chartCanvasSource, /drawOrderFlowGapColumns/);
assert.match(chartCanvasSource, /if \(canvas\.width !== pixelWidth\) canvas\.width = pixelWidth/);
assert.match(chartCanvasSource, /if \(canvas\.height !== pixelHeight\) canvas\.height = pixelHeight/);
assert.match(chartCanvasSource, /className="chart-canvas-layer chart-canvas-base"/);
assert.match(chartCanvasSource, /className="chart-canvas chart-canvas-layer chart-canvas-overlay"/);
assert.match(chartCanvasSource, /scheduleOverlayDrawRef\.current\(\)/);
assert.match(chartCanvasSource, /const drawingBatch = drawingRenderBatch\(scene, scene\.chart\.drawings, false, spotlight\)/);
assert.match(chartCanvasSource, /function interpretationFinalDrawingBatch/);
assert.match(chartCanvasSource, /lineWidth: interpretationFocusedLineWidth\(descriptor\.category, targeted\)/);
assert.match(chartCanvasSource, /fillOpacity: 0/);
assert.match(chartCanvasSource, /labelPlacement: "none"/);
assert.match(chartCanvasSource, /function interpretationLineWidth[\s\S]*pattern"\) return 5\.5[\s\S]*levels"\) return 4\.5[\s\S]*return 4/);
assert.match(chartCanvasSource, /const interpretationLineOpacity = 0\.3/);
assert.match(chartCanvasSource, /const analysisSpotlightDimMultiplier = 0\.5/);
assert.match(chartCanvasSource, /const focusedDrawingMaxOuterLineWidth = 6/);
assert.match(chartCanvasSource, /const focusedDrawingMaxCoreLineWidth = 4\.5/);
assert.match(chartCanvasSource, /const focusedDrawingMinCoreLineWidth = 2/);
assert.match(chartCanvasSource, /function interpretationFocusedLineWidth[\s\S]*return targeted \? focusedOuterLineWidth\(baseLineWidth\) : baseLineWidth/);
assert.match(chartCanvasSource, /function interpretationStrokeOpacity[\s\S]*if \(!focused\) return interpretationLineOpacity;[\s\S]*return targeted \? 1 : interpretationLineOpacity \* analysisSpotlightDimMultiplier/);
assert.match(chartCanvasSource, /const opacity = interpretationStrokeOpacity\(Boolean\(spotlight\), targeted\)/);
assert.match(chartCanvasSource, /context\.globalAlpha = interpretationStrokeOpacity\(overlay\.focused, targeted\)/);
assert.match(chartCanvasSource, /descriptor\.tone === "support"[\s\S]*\? "up"[\s\S]*descriptor\.tone === "resistance"[\s\S]*\? "down"[\s\S]*descriptor\.tone === "pattern" \? "pointPurple" : "signal"/);
assert.match(chartCanvasSource, /candidate\.role === "resistance" \? colors\.down : colors\.up[\s\S]*candidate\.category === "pattern"\) return colors\.pointPurple;[\s\S]*return colors\.signal/);
assert.match(chartCanvasAnalysisFocusSource, /token === "evidenceSupport"\) return "up"/);
assert.match(chartCanvasAnalysisFocusSource, /token === "evidenceResistance"\) return "down"/);
assert.match(chartCanvasAnalysisFocusSource, /token === "evidenceTrend"\) return "signal"/);
assert.match(chartCanvasAnalysisFocusSource, /token === "evidencePattern"\) return "pointPurple"/);
assert.match(chartCanvasAnalysisFocusSource, /pass === "outer" \? outerColorToken : "text"/);
assert.match(chartCanvasAnalysisFocusSource, /fillOpacity: 0/);
assert.match(chartCanvasAnalysisFocusSource, /labelPlacement: "none"/);
assert.match(chartCanvasAnalysisFocusSource, /opacity: 1/);
assert.doesNotMatch(chartCanvasAnalysisFocusSource, /#[0-9a-f]{3,8}|rgba?\(/i);
assert.match(chartCanvasSource, /if \(targeted\) \{[\s\S]*context\.strokeStyle = colors\.text;[\s\S]*focusedCoreLineWidth\(interpretationLineWidth\(candidate\.category\)\)/);
assert.match(chartCanvasSource, /focusedAnalysisLabel[\s\S]*\? colors\.text/);
assert.match(chartCanvasSource, /return analysis \? analysisSpotlightDimMultiplier : 0\.82/);
assert.match(chartCanvasSource, /context\.setLineDash\(\[\]\)/);
assert.ok(chartCanvasLayerSource.indexOf("drawGrid(context, scene)") < chartCanvasLayerSource.indexOf("drawAnalysisTraceLines"));
assert.ok(chartCanvasLayerSource.indexOf("drawAnalysisTraceLines") < chartCanvasLayerSource.indexOf("drawDrawingFills"));
assert.ok(chartCanvasLayerSource.indexOf("drawAnalysisTraceLines") < chartCanvasLayerSource.indexOf("drawBasePriceLayer"));
assert.ok(chartCanvasLayerSource.indexOf("drawBasePriceLayer") < chartCanvasLayerSource.indexOf("drawAnalysisTraceMarkers"));
assert.ok(chartCanvasLayerSource.indexOf("drawAnalysisTraceMarkers") < chartCanvasLayerSource.lastIndexOf("drawDrawings"));
assert.ok(chartCanvasLayerSource.indexOf("drawingBatch, false, editingDrawingId, spotlight") < chartCanvasLayerSource.indexOf("analysisFocusOuterBatch"));
assert.ok(chartCanvasLayerSource.indexOf("analysisFocusOuterBatch") < chartCanvasLayerSource.indexOf("analysisFocusCoreBatch"));
assert.ok(chartCanvasLayerSource.indexOf("analysisFocusCoreBatch") < chartCanvasLayerSource.indexOf("drawDrawings(context, scene, previewDrawingBatch, true)"));
assert.match(orderFlowRenderSource, /projectOrderFlowChartRows/);
assert.match(orderFlowRenderSource, /drawChartCandle/);
assert.doesNotMatch(orderFlowRenderSource, /ChartColumnTier|packedChartPriceMapper|isLive/);
assert.match(chartPanelSource, /wheelViewportRef\.current \?\? normalizeViewport/);
assert.match(chartPanelSource, /applyViewport\(finalViewport, "external"\)/);
assert.match(chartPanelSource, /window\.requestAnimationFrame/);
assert.match(chartCanvasSource, /type DrawSeriesLineOptions = \{[\s\S]*connectAcrossMissing\?: boolean/);
assert.match(chartCanvasSource, /if \(!options\.connectAcrossMissing && started\)/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.upper[\s\S]*connectAcrossMissing: true/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.lower[\s\S]*connectAcrossMissing: true/);
assert.match(chartCanvasSource, /pointForUnit\(unit\)\?\.middle[\s\S]*connectAcrossMissing: true/);
assert.doesNotMatch(semanticTimelineSource, /kind:\s*"placeholder"\s*\|\s*"foot/);
assert.match(chartCanvasSource, /drawSelectedCandleHighlight/);
assert.match(chartCanvasSource, /selected \? colors\.caution/);
assert.match(chartCanvasSource, /drawCurrentPriceMarker/);
assert.match(chartCanvasSource, /currentPriceForScene/);
const canvasCurrentPriceSource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("function currentPriceForScene"),
  chartCanvasSource.indexOf("function drawAxes")
);
assert.match(canvasCurrentPriceSource, /const latestClose = scene\.chart\.candles\.at\(-1\)\?\.close;/);
assert.doesNotMatch(canvasCurrentPriceSource, /liveTrade/);
const panelCurrentPriceSource = chartPanelSource.slice(
  chartPanelSource.indexOf("function currentPriceMarkerFromScene"),
  chartPanelSource.indexOf("function currentPriceMarkerEquals")
);
assert.match(panelCurrentPriceSource, /const price = latest\.close;/);
assert.match(panelCurrentPriceSource, /const isClosed = latest\.isClosed;/);
assert.doesNotMatch(panelCurrentPriceSource, /liveTrade/);
assert.match(chartCanvasSource, /variant:\s*"default"\s*\|\s*"currentPrice"\s*\|\s*"holdingPrice"\s*=\s*"default"/);
const drawingLabelLayerIndex = chartCanvasSource.indexOf("drawDrawingLabelsOnAxes(context, scene,");
const drawingLayerIndex = chartCanvasSource.indexOf("drawDrawings(context, scene, drawingBatch");
const currentPriceLayerIndex = chartCanvasSource.indexOf("drawCurrentPriceMarker(context, scene)");
const crosshairLayerIndex = chartCanvasSource.indexOf("drawCrosshair(context, scene, crosshair)");
assert.ok(drawingLayerIndex >= 0 && drawingLabelLayerIndex > drawingLayerIndex);
assert.ok(currentPriceLayerIndex > drawingLabelLayerIndex);
assert.ok(crosshairLayerIndex > currentPriceLayerIndex);
const baseChartSource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("function drawBaseChart"),
  chartCanvasSource.indexOf("function drawTransientOverlay")
);
const transientOverlaySource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("function drawTransientOverlay"),
  chartCanvasSource.indexOf("function basePriceLayerVisible")
);
assert.doesNotMatch(baseChartSource, /drawCrosshair\(/);
assert.match(transientOverlaySource, /drawCrosshair\(context, scene, crosshair\)/);
assert.match(
  baseChartSource,
  /spotlightDrawingIds\.length \|\| analysisTraceOverlay\?\.focused[\s\S]*new Set\(spotlightDrawingIds\)/,
  "trace-only commentary focus still creates an empty drawing spotlight"
);
assert.match(
  baseChartSource,
  /const drawDimmedBase = \(draw: \(\) => void\) => withCanvasAlpha\(context, spotlight \? 0\.78 : 1, draw\)/,
  "trace-only focus keeps candles and indicators legible while emphasizing trace evidence"
);
assert.match(
  chartCanvasSource,
  /const color = traceCandidateColor\(candidate\);[\s\S]*context\.globalAlpha = interpretationStrokeOpacity\(overlay\.focused, targeted\)/,
  "interpretation candidates keep their category color while focused targets become fully opaque"
);
assert.doesNotMatch(chartCanvasSource, /const baseAlpha = disposition === "rejected"/);
assert.match(
  chartCanvasSource,
  /analysisTraceLevelPrice\(candidate, overlay\.pivots\)[\s\S]*candidate\.category === "levels"[\s\S]*line\(context, scene\.plot\.left, levelY, scene\.plot\.right, levelY\)/,
  "level analysis candidates render as full-width H-lines"
);
assert.doesNotMatch(chartCanvasSource, /const strokeColor = spotlighted\s*\?\s*colors\.signal/);
assert.match(chartCanvasSource, /const strokeColor = resolveDrawingColor\(style, "colorToken", "color", preview \? "preview" : "drawing"\)/);
assert.match(chartCanvasSource, /spotlighted\s*\? Math\.min\(4\.5, baseLineWidth \+ 0\.75\)/);
assert.match(chartCanvasSource, /if \(spotlight\?\.has\(drawing\.id\)\) return 1;/);
assert.match(chartCanvasSource, /return analysis \? analysisSpotlightDimMultiplier : 0\.82;/);
assert.equal((chartCanvasSource.match(/drawDarkAxisPill\([^\n]+axisLabelColor\)/g) ?? []).length, 3);
assert.doesNotMatch(chartDocumentAdapterSource, /volume: false/);

const panelLayoutSource = readFileSync(fileURLToPath(new URL("../src/layout/panelLayout.ts", import.meta.url)), "utf-8");
assert.doesNotMatch(panelLayoutSource, /id: "slot-trade"/);
assert.doesNotMatch(panelLayoutSource, /insertPanelAtBoundary|canInsertPanelAtBoundary|insertOptionsForBoundary|BoundaryInsertOption|insert-only|pageEdge|defaultInsert|minimumInsert|chartPageEdgeGuides|insertionGuidesForSlot/);
assert.match(panelLayoutSource, /detectResizablePanelBoundaries/);
assert.match(panelLayoutSource, /resizeFreeformBoundary/);
assert.match(panelLayoutSource, /normalizeFreeformRectsToGridLayout/);
assert.match(panelLayoutSource, /const inheritsSymbol = item\.kind === "chart" \|\| item\.kind === "company" \|\| item\.kind === "compare" \|\| item\.kind === "companyCompare";/);
const panelWorkspaceSource = readFileSync(fileURLToPath(new URL("../src/components/PanelWorkspace.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(panelWorkspaceSource, /panel-boundary-add|panel-add-menu|insertPanelAtBoundary|canInsertPanelAtBoundary|beginPanelSwap|hitTestSwappableSlot|boundaryAddMenuPosition/);
assert.match(panelWorkspaceSource, /content\.kind === "priceCondition"/);
const workspacePanelFrameSource = readFileSync(fileURLToPath(new URL("../src/components/WorkspacePanelFrame.tsx", import.meta.url)), "utf-8");
assert.doesNotMatch(workspacePanelFrameSource, /workspace-panel-close|canClose|onClose/);
const panelRegistrySource = readFileSync(fileURLToPath(new URL("../src/layout/panelRegistry.ts", import.meta.url)), "utf-8");
assert.match(panelRegistrySource, /kind: "compare"[\s\S]*title: "비교"/);
assert.match(panelRegistrySource, /kind: "companyJournal"[\s\S]*title: "AI 기업저널"/);
assert.match(panelRegistrySource, /kind: "orderFlow"[\s\S]*agentPanelType: "orderFlowProfile"/);
assert.match(panelRegistrySource, /kind: "trade"[\s\S]*title: "주문"/);
assert.match(panelRegistrySource, /kind: "chartPatternList"[\s\S]*title: "패턴 종목"[\s\S]*agentPanelType: "chartPatternList"/);

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

assert.deepEqual(
  DEFAULT_PRESETS.map((preset) => [preset.id, preset.name]),
  [
    ["market", "추천종목"],
    ["stock", "기업분석"],
    ["compare", "차트분석"],
    ["regular", "추천분석"],
    ["asset", "포트폴리오"]
  ]
);
const recommendationPreset = DEFAULT_PRESETS.find((preset) => preset.id === "market");
assert.ok(recommendationPreset);
const recommendationLayout = buildPresetLayout(recommendationPreset, { width: 1280, height: 720 });
assert.ok(recommendationLayout);
assert.deepEqual(
  recommendationLayout.slots.map((slot) => recommendationLayout.contents[slot.contentId]?.kind),
  ["recommendationsList", "chart"]
);
const legacyRecommendationLayout = serializeTiledPanelState(createTiledPanelStateFromSpec([
  { kind: "recommendationsList", gridRect: { col: 1, row: 1, colSpan: 5, rowSpan: 6 } },
  { kind: "indexCommentary", gridRect: { col: 6, row: 1, colSpan: 3, rowSpan: 1 } },
  { kind: "themeRadar", gridRect: { col: 6, row: 2, colSpan: 3, rowSpan: 2 } },
  { kind: "newsKeyword", gridRect: { col: 6, row: 4, colSpan: 3, rowSpan: 3 } }
], { width: 1280, height: 720 }, { symbol: "NVDA" }));
const migratedRecommendationLayout = buildPresetLayout(
  { ...recommendationPreset, layout: legacyRecommendationLayout },
  { width: 1280, height: 720 },
  { symbol: "NVDA" }
);
assert.ok(migratedRecommendationLayout);
assert.deepEqual(
  migratedRecommendationLayout.slots.map((slot) => migratedRecommendationLayout.contents[slot.contentId]?.kind),
  ["recommendationsList", "chart"]
);
const companyAnalysisPreset = DEFAULT_PRESETS.find((preset) => preset.id === "stock");
assert.ok(companyAnalysisPreset);
const companyAnalysisLayout = buildPresetLayout(companyAnalysisPreset, { width: 1280, height: 720 });
assert.ok(companyAnalysisLayout);
assert.deepEqual(
  companyAnalysisLayout.slots.map((slot) => companyAnalysisLayout.contents[slot.contentId]?.kind),
  ["company", "companyJournal", "newsKeyword"]
);
assert.deepEqual(companyAnalysisLayout.slots[0]?.gridRect, { col: 1, row: 1, colSpan: 2, rowSpan: 6 });
const legacyCompanyAnalysisLayout = serializeTiledPanelState(createTiledPanelStateFromSpec([
  { kind: "chart", gridRect: { col: 1, row: 1, colSpan: 6, rowSpan: 3 } },
  { kind: "company", gridRect: { col: 7, row: 1, colSpan: 2, rowSpan: 3 } },
  { kind: "watchlistNews", gridRect: { col: 1, row: 4, colSpan: 8, rowSpan: 2 } }
], { width: 1280, height: 720 }, { symbol: "NVDA" }));
const migratedCompanyAnalysisLayout = buildPresetLayout(
  {
    ...companyAnalysisPreset,
    layout: legacyCompanyAnalysisLayout
  },
  { width: 1280, height: 720 },
  { symbol: "NVDA" }
);
assert.ok(migratedCompanyAnalysisLayout);
assert.equal(
  migratedCompanyAnalysisLayout.slots.some((slot) => migratedCompanyAnalysisLayout.contents[slot.contentId]?.kind === "companyJournal"),
  true
);
const recommendationReference = stockRecommendationReference({
  symbol: "msft",
  rank: 1,
  score: 55.8,
  confidence: 0.75,
  changePercent: 3.4,
  sector: "Information Technology",
  sectorLabelKo: "정보기술",
  reasons: [{ type: "market_momentum", text: "상승 모멘텀이 확인됐습니다.", weight: 23.8 }],
  riskWarnings: ["변동성 확대에 유의하세요."],
  metricsSnapshot: { sessionDollarVolume: 210_000_000 }
}, "content-recommendations-list");
assert.equal(recommendationReference.type, "recommendation.stock");
assert.equal(recommendationReference.displayLabel, "MSFT 추천 1위");
assert.equal(recommendationReference.data.symbol, "MSFT");
assert.equal(agentReferenceTicker(recommendationReference), "MSFT");
assert.equal(agentReferenceChipKind(recommendationReference), "recommendation");
assert.deepEqual(recommendationReference.data.riskWarnings, ["변동성 확대에 유의하세요."]);
const chartAnalysisPreset = DEFAULT_PRESETS.find((preset) => preset.id === "compare");
assert.ok(chartAnalysisPreset);
const chartAnalysisLayout = buildPresetLayout(chartAnalysisPreset, { width: 1280, height: 720 });
assert.ok(chartAnalysisLayout);
assert.deepEqual(
  chartAnalysisLayout.slots.map((slot) => chartAnalysisLayout.contents[slot.contentId]?.kind),
  ["compare", "indices", "watchlistNews"]
);
const chartAnalysisCompareContent = chartAnalysisLayout.contents[chartAnalysisLayout.slots[0].contentId];
assert.equal(chartAnalysisCompareContent?.props?.baseSymbol, "NVDA");
assert.deepEqual(chartAnalysisCompareContent?.props?.symbols, ["NVDA"]);
const regularRecommendationPreset = DEFAULT_PRESETS.find((preset) => preset.id === "regular");
assert.ok(regularRecommendationPreset);
const regularRecommendationLayout = buildPresetLayout(regularRecommendationPreset, { width: 1280, height: 720 });
assert.ok(regularRecommendationLayout);
assert.deepEqual(
  regularRecommendationLayout.slots.map((slot) => regularRecommendationLayout.contents[slot.contentId]?.kind),
  ["recommendationsList", "chart"]
);
assert.equal(regularRecommendationLayout.contents[regularRecommendationLayout.slots[0].contentId]?.props?.initialSessionMode, undefined);

const presetSummaries = buildAgentLayoutPresetSummaries([
  { id: "market", kind: "default", name: "추천종목" },
  { id: "custom-taste", kind: "custom", name: "내 입맛", layout: serializeTiledPanelState(tiledState) },
  { id: "custom-preopen", kind: "custom", name: "장전 체크", layout: serializeTiledPanelState(tiledState) }
]);
assert.equal(presetSummaries[0]?.id, "market");
assert.ok(presetSummaries[0]?.aliases.includes("추천종목 프리셋"));
assert.ok(presetSummaries[0]?.aliases.includes("추천종목창"));
assert.ok(presetSummaries[0]?.aliases.includes("오늘의 추천 종목"));
assert.ok(presetSummaries[0]?.aliases.includes("시장분석"));
assert.equal(presetSummaries[1]?.id, "custom-taste");
assert.ok(presetSummaries[1]?.aliases.includes("내입맛"));
assert.equal(presetSummaries[2]?.id, "custom-preopen");
assert.ok(presetSummaries[2]?.aliases.includes("장전 체크 대시보드"));
assert.equal(isLikelyPresetLoadPrompt("시장분석 프리셋 띄워줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("시장분석 보여줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("시장분석창 보여줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("오늘의 추천 종목 보여줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("추천종목 페이지 열어줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("내 입맛 화면으로 바꿔줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("장전 체크 대시보드 열어줘", presetSummaries), true);
assert.equal(isLikelyPresetLoadPrompt("시장 분석해줘", presetSummaries), false);
assert.equal(isLikelyPresetLoadPrompt("추천종목 해줘", presetSummaries), false);

const presetLoadResolve = normalizeAgentLayoutResolveResponse({
  status: "ui_layout",
  summary: "추천종목 프리셋을 열었습니다.",
  route: { source: "ui-preset-parser", intentType: "ui-layout", selectedRoles: [] },
  layoutProposal: {
    id: "layout-proposal-preset-load",
    title: "UI preset request",
    rationale: "추천종목 프리셋을 열었습니다.",
    autoApply: true,
    panelPriorities: [],
    commands: [
      makeAgentLayoutCommand("layout.load", "llm", { presetId: "market", presetName: "추천종목", presetKind: "default" })
    ],
    createdAt: "2026-06-29T00:00:00.000Z"
  },
  agentTrace: { uiLayoutFastAck: true }
});
assert.equal(presetLoadResolve.layoutProposal?.commands[0]?.type, "layout.load");
assert.equal(presetLoadResolve.layoutProposal?.commands[0]?.payload.presetId, "market");
const appliedPresetIds: string[] = [];
assert.deepEqual(
  applyLayoutLoadProposalToPresets(
    presetLoadResolve.layoutProposal!,
    [
      { id: "market", kind: "default", name: "추천종목" },
      { id: "custom-taste", kind: "custom", name: "내 입맛", layout: serializeTiledPanelState(tiledState) }
    ],
    (id) => appliedPresetIds.push(id)
  ),
  { status: "applied", presetId: "market", presetName: "추천종목" }
);
assert.deepEqual(appliedPresetIds, ["market"]);
assert.deepEqual(
  applyLayoutLoadProposalToPresets(presetLoadResolve.layoutProposal!, [{ id: "stock", kind: "default", name: "기업분석" }], () => appliedPresetIds.push("unexpected")),
  { status: "missing", presetId: "market" }
);
assert.deepEqual(appliedPresetIds, ["market"]);
assert.deepEqual(
  applyLayoutLoadProposalToPresets(layoutResolve.layoutProposal!, [{ id: "market", kind: "default", name: "추천종목" }], () => appliedPresetIds.push("unexpected")),
  { status: "none" }
);

assert.equal(isSelectedRecommendationCompanyPrompt("이 종목의 기업에 대해 자세히 알려줘"), true);
assert.equal(isSelectedRecommendationCompanyPrompt("선택한 종목 회사 정보를 보여줘"), true);
assert.equal(isSelectedRecommendationCompanyPrompt("이 종목 차트 자세히 보여줘"), false);
assert.equal(isSelectedRecommendationCompanyPrompt("엔비디아에 대해 자세히 알려줘"), false);
assert.deepEqual(
  resolveRecommendationCompanyNavigation("이 종목의 기업에 대해 자세히 알려줘", "market", "nvda"),
  { status: "ready", presetId: "stock", symbol: "NVDA" }
);
assert.deepEqual(
  resolveRecommendationCompanyNavigation("이 종목의 기업에 대해 자세히 알려줘", "market", null),
  { status: "missing_selection" }
);
assert.deepEqual(
  resolveRecommendationCompanyNavigation("이 종목의 기업에 대해 자세히 알려줘", "asset", "NVDA"),
  { status: "not_applicable" }
);

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
assert.deepEqual(agentLayoutOrderPanel?.minSpan, { colSpan: 2, rowSpan: 2 });
assert.deepEqual(agentLayoutOrderPanel?.maxSpan, { colSpan: 8, rowSpan: 6 });
assert.equal("aliases" in (agentLayoutOrderPanel ?? {}), false);
const agentLayoutPortfolioPanel = expandedAgentLayoutPanels.find((panel) => panel.type === "portfolioHoldings");
assert.equal(agentLayoutPortfolioPanel?.title, "보유 종목 표");
assert.deepEqual(agentLayoutPortfolioPanel?.minSpan, { colSpan: 2, rowSpan: 2 });
assert.deepEqual(agentLayoutPortfolioPanel?.maxSpan, { colSpan: 8, rowSpan: 6 });
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
assert.equal(validPortfolioCash(1199, 1853, 3052), 1199);
assert.equal(validPortfolioCash(105510401.1332, 71662.86, 71662.86), null);
assert.equal(validPortfolioCash(null, 71662.86, 71662.86), null);
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

const frontendStylesSource = [
  readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8"),
  readFileSync(fileURLToPath(new URL("../src/chart-features.css", import.meta.url)), "utf-8")
].join("\n");
assert.match(frontendStylesSource, /\.stock-logo\.has-image\s*\{[^}]*background:\s*#fff;/);
assert.doesNotMatch(frontendStylesSource, /\.alerts-watchlist-tabs button(?:\.is-active)?::after/);
assert.match(frontendStylesSource, /\.alerts-watchlist-tabs button\.is-active \{[^}]*background: color-mix\([^}]*color: var\(--color-text\);/);
assert.match(frontendStylesSource, /\.alerts-watchlist-company-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*background: transparent;/);
assert.match(frontendStylesSource, /\.alerts-watchlist-company-open \{[\s\S]*grid-template-columns: 32px minmax\(0, 1fr\) auto;[\s\S]*background: transparent;/);
assert.match(frontendStylesSource, /\.notification-threshold-chips button\.is-selected \{[\s\S]*background: color-mix/);
assert.match(frontendStylesSource, /\.workspace-top-center-flip\.is-notice \.workspace-agent-notice \{[\s\S]*opacity: 1;[\s\S]*rotateX\(0deg\);/);
assert.match(frontendStylesSource, /\.workspace-agent-notice \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
assert.match(frontendStylesSource, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.workspace-top-center-face \{[\s\S]*transition: none;/);
assert.match(frontendStylesSource, /\.workspace-top-notification-popover \{[\s\S]*top: calc\(100% \+ 11px\);[\s\S]*right: 0;/);
assert.match(frontendStylesSource, /\.workspace-top-notification-popover::before \{[\s\S]*transform: rotate\(45deg\);/);
assert.match(frontendStylesSource, /\.workspace-top-notification-badge \{[\s\S]*border-radius: 999px;/);
assert.match(frontendStylesSource, /\.alert-toast \{[\s\S]*right: calc\(var\(--layout-gutter\) \+ 4px\);[\s\S]*bottom: calc\(var\(--tool-dock-bottom\) \+ 16px\);/);
assert.match(frontendStylesSource, /\.chart-add-dock \.chart-add-layer-button\.active \{[\s\S]*background: var\(--chart-layer-accent, var\(--color-preview\)\);/);
assert.match(frontendStylesSource, /\.chart-add-dock \.chart-add-layer-button\.active \{[\s\S]*color: #ffffff;/);
assert.match(frontendStylesSource, /\.treemap-panel \{[\s\S]*position: absolute;/);
assert.match(frontendStylesSource, /\.treemap-panel \{[\s\S]*overflow: hidden;/);
assert.match(frontendStylesSource, /\.order-flow-hover-overlay \{[\s\S]*grid-template-rows: 26px 22px;/);
assert.match(frontendStylesSource, /\.order-flow-panel:hover \.order-flow-hover-overlay,[\s\S]*\.order-flow-panel:focus-within \.order-flow-hover-overlay/);
assert.match(frontendStylesSource, /\.order-flow-window-grid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*left: 0;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*right: 0;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*justify-content: center;/);
assert.match(frontendStylesSource, /\.layout-palette-dock \{[\s\S]*pointer-events: none;/);
assert.match(frontendStylesSource, /\.layout-palette-shell \{[\s\S]*flex-wrap: nowrap;/);
assert.match(frontendStylesSource, /\.layout-palette-shell \{[\s\S]*padding: 5px 8px;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*position: relative;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*width: 100%;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*flex-wrap: nowrap;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*padding: 5px 0;/);
assert.match(frontendStylesSource, /\.layout-preset-dock \{[\s\S]*scroll-padding-inline: var\(--layout-gutter\);/);
assert.match(frontendStylesSource, /\.portfolio-holdings-list \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);/);
assert.match(frontendStylesSource, /\.portfolio-holdings-table-head,[\s\S]*\.portfolio-holding-row \{[\s\S]*display: grid;/);
assert.match(frontendStylesSource, /\.portfolio-multi-panel \{[\s\S]*display: flex;/);
assert.match(frontendStylesSource, /Local dark-theme compatibility for the restored dev portfolio panels/);
assert.match(frontendStylesSource, /\.layout-preset-dock-tail \{[\s\S]*display: inline-flex;/);
assert.doesNotMatch(frontendStylesSource, /\.layout-preset-status/);
assert.doesNotMatch(frontendStylesSource, /layout-preset-status-in/);
assert.match(frontendStylesSource, /\.layout-exit-button \{[\s\S]*width: auto;/);
assert.match(frontendStylesSource, /\.layout-exit-button \{[\s\S]*min-width: 50px;/);

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
const projectedChannelRay = buildTrendParallelLines(
  { x: 20, y: 80 },
  { x: 40, y: 60 },
  { x: 20, y: 60 },
  { left: 0, right: 100, top: 0, priceBottom: 100 },
  2,
  "ray"
);
assert.deepEqual(projectedChannelRay[0], [{ x: 20, y: 80 }, { x: 100, y: 0 }], "trend channels honor right-ray extension");
assert.deepEqual(projectedChannelRay.at(-1)?.[1], { x: 80, y: 0 }, "parallel channel boundaries extend to the plot edge");
assert.deepEqual(projectedLine, [{ x: 0, y: 100 }, { x: 100, y: 0 }]);

const trendLineResult = executeChartCommand(
  documentA,
  makeChartCommand("chart.drawing.add", "user", target("panel-a", documentA.id), {
    drawingType: "trendLine",
    anchors: [anchorA, anchorB],
    style: {
      color: "#0a0b0d", lineWidth: 6, extension: "ray", labelPlacement: "axis", zoneSplit: true,
      proposalAction: "buy_candidate", proposalKind: "confirmed"
    },
    label: "Trend ray"
  })
);
assert.equal(trendLineResult.ok, true);
if (trendLineResult.ok) {
  assert.equal(trendLineResult.document.drawings[0]?.style.extension, "ray");
  assert.equal(trendLineResult.document.drawings[0]?.style.labelPlacement, "axis");
  assert.equal(trendLineResult.document.drawings[0]?.style.zoneSplit, true);
  assert.equal(trendLineResult.document.drawings[0]?.style.lineWidth, 5);
  assert.equal(trendLineResult.document.drawings[0]?.style.proposalAction, "buy_candidate");
  assert.equal(trendLineResult.document.drawings[0]?.style.proposalKind, "confirmed");
  const stylePatchResult = executeChartCommand(
    trendLineResult.document,
    makeChartCommand("chart.drawing.update", "user", target("panel-a", documentA.id), {
      drawingId: trendLineResult.document.drawings[0]?.id,
      drawingPatch: {
        style: {
          labelPlacement: "inline", zoneSplit: false,
          proposalAction: "sell_candidate", proposalKind: "conditional"
        }
      }
    })
  );
  assert.equal(stylePatchResult.ok, true);
  if (stylePatchResult.ok) {
    assert.equal(stylePatchResult.document.drawings[0]?.style.labelPlacement, "inline");
    assert.equal(stylePatchResult.document.drawings[0]?.style.zoneSplit, false);
    assert.equal(stylePatchResult.document.drawings[0]?.style.proposalAction, "sell_candidate");
    assert.equal(stylePatchResult.document.drawings[0]?.style.proposalKind, "conditional");
    const styleUndo = executeChartCommand(
      stylePatchResult.document,
      makeChartCommand("chart.undo", "user", target("panel-a", documentA.id))
    );
    assert.equal(styleUndo.ok, true);
    if (styleUndo.ok) {
      assert.equal(styleUndo.document.drawings[0]?.style.labelPlacement, "axis");
      assert.equal(styleUndo.document.drawings[0]?.style.proposalAction, "buy_candidate");
      assert.equal(styleUndo.document.drawings[0]?.style.proposalKind, "confirmed");
    }
  }
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
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, {
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m")),
  visibleCount: defaultVisibleBarsForInterval("1m")
});
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
assert.deepEqual(regressionRuntime.documents[regressionDocAId]?.viewport, {
  rightOffset: latestCandleRightOffset(defaultVisibleBarsForInterval("1m")),
  visibleCount: defaultVisibleBarsForInterval("1m")
});
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
      style: { color: "#0052ff" }
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
      style: { color: "#0a0b0d" },
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
        style: { color: "#cf202f" },
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
    style: { color: "#0a0b0d" },
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

const drawingPaletteDocument = createChartDocument("chart-doc-drawing-palette", "AAPL", "1m");
const drawingPaletteAdd = executeChartCommand(
  drawingPaletteDocument,
  makeChartCommand("chart.drawing.add", "user", target("panel-palette", drawingPaletteDocument.id), {
    drawingType: "rangeBox",
    anchors: [anchorA, anchorB],
    style: { colorToken: "drawing", textToken: "drawing", fillToken: "drawing", fillOpacity: 0.045 }
  })
);
assert.equal(drawingPaletteAdd.ok, true);
if (drawingPaletteAdd.ok) {
  const drawingId = drawingPaletteAdd.document.drawings[0]?.id ?? "";
  const drawingPaletteUpdate = executeChartCommand(
    drawingPaletteAdd.document,
    makeChartCommand("chart.drawing.update", "user", target("panel-palette", drawingPaletteDocument.id), {
      drawingId,
      drawingPatch: {
        style: { colorToken: "signal", textToken: "signal", fillToken: "signal", fillOpacity: 0.045 }
      }
    })
  );
  assert.equal(drawingPaletteUpdate.ok, true);
  if (drawingPaletteUpdate.ok) {
    assert.equal(drawingPaletteUpdate.document.drawings[0]?.style.colorToken, "signal");
    assert.equal(drawingPaletteUpdate.document.drawings[0]?.style.textToken, "signal");
    assert.equal(drawingPaletteUpdate.document.drawings[0]?.style.fillToken, "signal");
    const undoPalette = executeChartCommand(
      drawingPaletteUpdate.document,
      makeChartCommand("chart.undo", "user", target("panel-palette", drawingPaletteDocument.id))
    );
    assert.equal(undoPalette.ok, true);
    if (undoPalette.ok) {
      assert.equal(undoPalette.document.drawings[0]?.style.colorToken, "drawing");
      const redoPalette = executeChartCommand(
        undoPalette.document,
        makeChartCommand("chart.redo", "user", target("panel-palette", drawingPaletteDocument.id))
      );
      assert.equal(redoPalette.ok, true);
      if (redoPalette.ok) {
        assert.equal(redoPalette.document.drawings[0]?.style.colorToken, "signal");
        assert.equal(redoPalette.document.drawings[0]?.style.fillToken, "signal");
      }
    }
  }
}

const scopedUndoDocument = createChartDocument("chart-doc-scoped-undo", "AAPL", "1m");
const scopedAdd = executeChartCommand(
  scopedUndoDocument,
  makeChartCommand("chart.drawing.add", "user", target("panel-scoped", scopedUndoDocument.id), {
    drawingType: "horizontalLine",
    anchors: [anchorA],
    style: { color: "#0a0b0d" },
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
  style: { color: "#0a0b0d" },
  label: "Level A"
});
const secondDrawing = makeChartCommand("chart.drawing.add", "user", target("panel-clear", clearAllDocument.id), {
  drawingType: "verticalMarker",
  anchors: [{ timestamp: candleB.timestamp, price: 10.8, paneId: "price", symbol: "AAPL", logicalIndex: 1 }],
  style: { color: "#cf202f" },
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
    style: { color: "#cf202f" },
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
    style: { color: "#0052ff", fillColor: null, lineWidth: 2, textColor: null, lineDash: [] },
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
      style: { color: "#05b169" }
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
      style: { color: "#05b169" }
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
      style: { color: "#0a0b0d" }
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
      style: { color: "#0052ff" },
      label: "Agent level"
    }, "proposal-preview"),
    makeChartCommand("chart.comparison.add", "llm", target("panel-preview", previewDocument.id), {
      comparison: {
        id: "comparison-spy-preview-test",
        symbol: "SPY",
        label: "SPY",
        scaleMode: "percent",
        base: { mode: "visibleRangeStart" },
        style: { color: "#05b169", lineWidth: 1.5 }
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
