import {
  Activity,
  AudioWaveform,
  CalendarClock,
  ChartColumn,
  ChartNoAxesCombined,
  ChartSpline,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Flag,
  Gauge,
  Hand,
  MousePointer2,
  Newspaper,
  Palette,
  RotateCcw,
  Square,
  Trash2,
  TrendingUp,
  Type,
  Waves,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  forwardRef,
  PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent as ReactWheelEvent
} from "react";
import {
  makeChartCommand,
  type CandleEvent,
  type CandleSnapshot,
  type ChartCommand,
  type ChartCommandActor,
  type ChartCommandHistoryScope,
  type ChartCommandType,
  type ChartDataStatus,
  type ChartDocument,
  type ChartRuntimeAction,
  type StreamStatus,
  type TradeTickData,
  normalizeRealtimeLayerEvent,
  proposalPriceLabelReserveWidth,
  proposalRiskRewardMinimumWidth
} from "@gops/chart-engine";
import { chartStateFromDocument } from "../chart/chartDocumentAdapter";
import { ChartCanvas } from "../chart/ChartCanvas";
import {
  findPaperHoldingOverlay,
  formatPaperHoldingQuantity,
  paperHoldingPriceMarkerForScene,
  paperHoldingOverlayLabel,
  paperHoldingOverlayPriceLabel,
  syncPaperHoldingPriceMarkerPosition,
  type PaperHoldingPriceMarker
} from "../chart/paperHoldingPrice";
import { analysisTraceDataMode, buildAnalysisTraceOverlay, type AnalysisTraceOverlay } from "../chart/analysisTraceOverlay";
import { analysisAssetFreshness, candleKeyForTimestamp, resolveAnalysisAssetForCandles, staleAnalysisAsset } from "../chart/analysisAssetPresentation";
import {
  analysisAssetsLoadErrorMessage,
  fetchAnalysisAssets,
  subscribeAnalysisAssetsInvalidation,
  type AnalysisAssetInterval,
  type AnalysisAssetsResponse,
  type ChartAssetCommentaryIndicatorLayer
} from "../chart/analysisAssetsApi";
import { projectChartTradeSetup } from "../chart/chartTradeSetup";
import {
  chartCommentaryIndicatorToggleEventName,
  chartCommentaryReferenceOpenEventName,
  type ChartCommentaryIndicatorToggleRequest,
  type ChartCommentaryReferenceOpenRequest
} from "../chart/chartCommentaryReferences";
import {
  clearChartCommentaryInteraction,
  updateChartCommentaryInteraction,
  type ChartCommentaryIndicatorRuntimeStatus
} from "../chart/chartCommentaryInteractionStore";
import {
  chartAnalysisAssetRuntimeIdentity,
  chartAnalysisAssetSceneContainsLoadedSnapshot,
  clearChartAnalysisAssetRuntime,
  updateChartAnalysisAssetRuntime,
  type ChartAnalysisAssetLoadedCandleSnapshot,
  type ChartAnalysisAssetLoadPhase
} from "../chart/chartAnalysisAssetRuntimeStore";
import { buildPatternBadgeLayout, type PatternBadgeLayout } from "../chart/patternBadge";
import { createChartPriceSelection, type ChartPriceSelection, type ChartTradeSetupSnapshot } from "../chart/chartTradeAutomation";
import { clearChartTradeSetupSnapshot, setChartTradeSetupSnapshot } from "../chart/chartTradeSetupStore";
import {
  analysisAssetApplyCommands,
  analysisAssetRemovalCommands,
  analysisLayerToggleCommands,
  chartAnalysisLayerToggleEventName,
  defaultAnalysisLayerVisibility,
  isChartAssetDrawing,
  hasAnalysisLayerDrawings,
  type AnalysisLayerKey,
  type AnalysisLayerVisibility
} from "../chart/analysisLayerController";
import {
  buildTradePlanOverlayLayout,
  scaleTradePlanOverlayLayout,
  tradePlanOverlayContentKey,
  type TradePlanOverlayLayout
} from "../chart/tradePlanOverlayLayout";
import { clearActiveTradePlan, projectActiveTradePlan, setActiveTradePlan } from "../chart/tradePlanStore";
import { fetchCandles, fetchChartEvents, fetchIndicators, fetchVolumeProfile, openChartSocket, refreshActiveChartSymbol } from "../chart/cdcClient";
import {
  chartEventMarkerLayoutKey,
  chartEventMarkersForScene,
  chartEventTargetCandleIndex,
  upcomingDailyEventLogicalIndex,
  chartEventRequestRange,
  latestChartEventRefreshRange,
  mergeChartEventsResponses,
  missingChartEventRanges,
  marketDateForTimestamp,
  syncChartEventMarkerPositions,
  type ChartEventCoverage,
  type ChartEventMarker,
  type ChartEventsResponse
} from "../chart/chartEvents";
import {
  chartTradeMarkerLayoutKey,
  chartTradeMarkersForScene,
  syncChartTradeMarkerPositions,
  type ChartTradeMarker
} from "../chart/chartTradeMarkers";
import {
  buildDraftPreviewDrawing,
  buildSingleAnchorPreviewDrawing,
  buildDraggedAnchors,
  defaultDrawingLabel,
  drawingLabelLayout,
  drawingRequiredAnchorCount,
  drawingSupportsTextEditing,
  drawingTools,
  drawingTypeFromToolMode,
  hitTestDrawing,
  isValidRiskRewardAnchors,
  makeDrawing,
  nearestDrawingLineWidthStage,
  normalizeParallelLineCount,
  sourceIntervalForDrawingAnchors,
  type DrawingDraft,
  type DrawingDrag
} from "../chart/drawings";
import { expansionCloseButtonSize, expansionMetadataCenterY, expansionParentThumbnailRight } from "../chart/expansionLayout";
import { stableVolumeProfileRangeKey } from "../chart/derivedRequestPolicy";
import {
  volumeProfilePartialRetryDelaysMs,
  volumeProfileResponseMatchesRequest,
  type ExactVolumeProfileRequest
} from "../chart/volumeProfilePolicy";
import { candleMovingAverageWindows, indicatorRequestRangeFromCandles, serverIndicatorLayersForLayers } from "../chart/indicatorLayerPolicy";
import { indicatorRequestLimitForInterval } from "../chart/indicatorRequestPolicy";
import { mergeIndicatorSeries, scopeIndicatorSeries } from "../chart/indicatorSeries";
import {
  olderRangeQueuedRetryDelayMs,
  olderRangeRequestKey,
  olderRangeRetryAfterMs,
  shouldRequestOlderRange
} from "../chart/olderRangeRequestPolicy";
import {
  fetchOrderFlowIntraday,
  isOrderFlowDemoRuntimeEnabled,
  orderFlowDemoContextFromCandles,
  subscribeOrderFlowDemoTicks
} from "../chart/orderFlowClient";
import { replaceOrderFlowMinute, sessionDateFromTimestamp, type OrderFlowMinuteDto } from "../chart/orderFlow";
import { activeBelowPaneIds, chartPriceAxisPoint, createCoordinateTransform, formatPriceAxisValue, getPaneRatio, hitTestSemanticNode, hitTestTimeAxisUnit, isChartRightAxisPoint, priceAxisLabelWidth, priceToY, unitBoundsX, viewportAnchorRatioAtX, type ChartScene } from "../chart/scene";
import {
  viewportCenteredOnLogicalIndex,
  viewportCenteredOnSceneX,
  viewportAfterOlderCandlesLoaded,
  viewportAfterSnapshotCandlesChange,
  type ViewportAnchor
} from "../chart/intervalNavigation";
import {
  candleRange,
  childQueryRange,
  expansionLimitForInterval,
  nextDigTargetInterval,
  semanticExpansionId,
  snapshotFromSemanticUnit,
  type ExpansionStatus,
  type SemanticExpansion,
  type SemanticRenderUnit,
  type SemanticSelectionSnapshot
} from "../chart/semanticTimeline";
import type { CandleDto, CandleEventDto, CandleFillTraceDto, CandleQueryResponseDto, ChartComparisonCandleScope, ChartComparisonStatus, ChartInterval, ChartLayerKey, ChartLineExtension, ChartState, ChartSymbolDto, ChartToolMode, ChartType, DrawingEntity, IndicatorSeries } from "../chart/types";
import { simulationAwareNowMs } from "../simulator/simulatorApi";
import {
  defaultBidAskInterval,
  defaultVisibleBarsForBidAskInterval,
  defaultVisibleBarsForInterval,
  isBidAskChartInterval,
  normalizeBidAskChartInterval
} from "../chart/types";
import {
  dragDeltaToRightOffset,
  futureEmptySlotCount,
  horizontalWheelDeltaToRightOffset,
  latestCandleRightOffset,
  normalizeViewport,
  resolveHorizontalWheelDelta,
  viewportNeedsOlderCandles,
  zoomViewport,
  zoomViewportAt,
  type ChartViewport,
  type ViewportClampOptions
} from "../chart/viewport";
import { ChartAnalysisLayerToggles } from "./ChartAnalysisLayerToggles";
import { ChartEventOverlay, type ChartEventOpenRequest } from "./ChartEventOverlay";
import { ChartTradeOverlay } from "./ChartTradeOverlay";
import { ChartToolbarSelect, type ChartToolbarSelectOption } from "./ChartToolbarSelect";
import { ContextualAgentAskButton } from "./ContextualAgentAskButton";
import type { ThemeColorToken } from "../theme/colors";
import { usePaperAccount } from "../orders/PaperAccountProvider";
import { useChartTradeHistory } from "../orders/ChartTradeHistoryProvider";

function iconButtonClass(active = false): string {
  return active ? "icon-button active" : "icon-button";
}

const realtimeSnapshotRetryDelayMs = 6500;
const marketClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

type DragAnchor = {
  x: number;
  y: number;
  rightOffset: number;
  visibleCount: number;
};

type PaneResizeAnchor = {
  pointerId: number;
  index: number;
  startY: number;
  paneIds: string[];
  startRatios: number[];
  startHeights: number[];
};

type PendingSemanticClick = {
  unit: SemanticRenderUnit;
  action: "dig" | "agent-select";
  x: number;
  y: number;
};

type PriceAxisPointer = {
  pointerId: number;
  x: number;
  y: number;
};

type PendingCommentaryNavigation =
  | { kind: "candle"; timestamp: string; candleKey?: string; attempts: number }
  | { kind: "event"; eventId: string; attempts: number }
  | { kind: "upcoming"; eventId: string; targetLogicalIndex?: number; attempts: number };

type ExpansionOverlay = {
  id: string;
  label: string;
  left: number;
  right: number;
  top: number;
  status: string;
};

type OrderFlowChartDataStatus = "loading" | "ready" | "empty" | "unsupported" | "error";

type ComparisonScopeRequest = {
  key: string;
  symbol: string;
  interval: ChartInterval;
  from: string;
  to: string;
  limit: number;
  parentExpansionId?: string;
};

type ComparisonScopeData = ChartComparisonCandleScope;

type CurrentPriceMarker = {
  priceText: string;
  timestamp: string;
  interval: ChartInterval;
  streamState: ChartState["streamState"];
  isClosed: boolean;
  lineLeft: number;
  lineRight: number;
  labelLeft: number;
  labelTop: number;
  y: number;
};

export type LiveQuote = {
  priceText: string;
  changeText: string;
  percentText: string;
  tone: "up" | "down" | "flat" | "unavailable";
};

type ChartPanelProps = {
  panelId: string;
  document: ChartDocument;
  candles: CandleDto[];
  dataStatus: ChartDataStatus;
  streamStatus: StreamStatus;
  streamMessage?: string;
  liveTrade?: TradeTickData;
  symbols: ChartSymbolDto[];
  laneHeight?: number;
  chartAddActive?: boolean;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartAddToggle?: () => void;
  onSemanticSelectionChange?: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentAsk?: () => void;
  emphasizeSelection?: boolean;
  onChartHoverChange?: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
  onPriceSelection?: (selection: ChartPriceSelection) => void;
  toolbarLeading?: ReactNode;
  toolbarAfterViewControls?: ReactNode;
};

export type ChartPanelHandle = {
  getSnapshot: () => ChartState;
  getChartDocumentId: () => string;
  getAnalysisAssetIdentity: () => Record<string, unknown> | null;
  getTradeSetupSnapshot: () => ChartTradeSetupSnapshot | null;
  setInterval: (interval: ChartInterval) => void;
  setChartType: (chartType: ChartType) => void;
  clearSemanticSelection: () => void;
};

export type ChartHeaderSnapshot = {
  symbol: string;
  interval: ChartInterval;
  name: string;
  searchLabel: string;
  liveQuote: LiveQuote;
};

const commentaryIndicatorLayers: ChartAssetCommentaryIndicatorLayer[] = [
  "volume-profile", "volume", "rsi:14", "macd:12:26:9", "bollinger:20:2",
  "sma:20", "sma:60", "sma:120", "ema:20"
];
const commentaryBelowIndicatorLayers = new Set<ChartAssetCommentaryIndicatorLayer>([
  "volume", "rsi:14", "macd:12:26:9"
]);

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const unavailableQuote: LiveQuote = {
  priceText: "-",
  changeText: "-",
  percentText: "-",
  tone: "unavailable"
};

const baseChartMinHeightForBelowPanes = 170;
const belowPaneMinHeight = 70;
const maxComparisonCount = 4;
const chartVolumeProfileBinCount = 10;
const defaultOrderFlowPriceBinSize = 0.01;

type VolumeProfileSceneRange = ExactVolumeProfileRequest;
const trendExtensionButtons: Array<[ChartLineExtension, string]> = [
  ["segment", "선분"],
  ["ray", "반직선"],
  ["line", "직선"]
];

type DrawingPaletteToken = Extract<ThemeColorToken,
  | "drawing"
  | "bullish"
  | "bearish"
  | "signal"
  | "caution"
  | "purple"
  | "pointYellow"
  | "pointOrange"
  | "pointPurple"
  | "ma5"
  | "ma20"
  | "ma60"
>;

const drawingPaletteOptions: Array<{ token: DrawingPaletteToken; label: string; cssColor: string }> = [
  { token: "drawing", label: "기본 그리기 색상", cssColor: "var(--color-drawing)" },
  { token: "bullish", label: "상승", cssColor: "var(--color-bullish)" },
  { token: "bearish", label: "하락", cssColor: "var(--color-bearish)" },
  { token: "signal", label: "시그널", cssColor: "var(--color-signal)" },
  { token: "caution", label: "주의", cssColor: "var(--color-caution)" },
  { token: "purple", label: "보라", cssColor: "var(--color-purple)" },
  { token: "pointYellow", label: "포인트 노랑", cssColor: "var(--color-point-yellow)" },
  { token: "pointOrange", label: "포인트 주황", cssColor: "var(--color-point-orange)" },
  { token: "pointPurple", label: "포인트 보라", cssColor: "var(--color-point-purple)" },
  { token: "ma5", label: "MA5", cssColor: "var(--color-ma5)" },
  { token: "ma20", label: "MA20", cssColor: "var(--color-ma20)" },
  { token: "ma60", label: "MA60", cssColor: "var(--color-ma60)" }
];

type ImmediateTooltipState = {
  text: string;
  left: number;
  top: number;
};

function useImmediateChartTooltip() {
  const [tooltip, setTooltip] = useState<ImmediateTooltipState | null>(null);
  const hideTooltip = useCallback(() => setTooltip(null), []);
  const showTooltip = useCallback((text: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const panelRect = element.closest(".chart-panel")?.getBoundingClientRect();
    const boundaryLeft = Math.max(6, panelRect?.left ?? 6);
    const boundaryRight = Math.min(window.innerWidth - 6, panelRect?.right ?? window.innerWidth - 6);
    const estimatedWidth = Math.min(Math.max(72, Array.from(text).length * 13 + 20), Math.max(72, boundaryRight - boundaryLeft));
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - estimatedWidth / 2, boundaryLeft),
      Math.max(boundaryLeft, boundaryRight - estimatedWidth)
    );
    const preferredTop = rect.bottom + 6;
    const boundaryBottom = Math.min(window.innerHeight - 6, panelRect?.bottom ?? window.innerHeight - 6);
    const top = preferredTop + 30 <= boundaryBottom ? preferredTop : Math.max(6, rect.top - 30);
    setTooltip({ text, left, top });
  }, []);
  const tooltipProps = useCallback((text: string) => ({
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
    onPointerLeave: hideTooltip,
    onFocus: (event: ReactFocusEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
    onBlur: hideTooltip
  }), [hideTooltip, showTooltip]);
  const tooltipOverlay = tooltip && typeof window !== "undefined"
    ? createPortal(
        <div className="chart-immediate-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          {tooltip.text}
        </div>,
        window.document.body
      )
    : null;
  return { hideTooltip, tooltipOverlay, tooltipProps };
}

export const ChartPanel = forwardRef<ChartPanelHandle, ChartPanelProps>(function ChartPanel({
  panelId,
  document,
  candles,
  dataStatus,
  streamStatus,
  streamMessage,
  liveTrade,
  symbols,
  laneHeight,
  chartAddActive = false,
  onChartRuntimeAction,
  onChartAddToggle,
  onSemanticSelectionChange,
  onAgentAsk,
  emphasizeSelection = false,
  onChartHoverChange,
  onHeaderChange,
  onPriceSelection,
  toolbarLeading,
  toolbarAfterViewControls
}: ChartPanelProps, ref) {
  const { snapshot: paperAccountSnapshot } = usePaperAccount();
  const { fills: chartTradeFills } = useChartTradeHistory();
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [activeExpansions, setActiveExpansions] = useState<SemanticExpansion[]>([]);
  const [hoveredSemanticNodeId, setHoveredSemanticNodeId] = useState<string | undefined>();
  const [hoverSnapshot, setHoverSnapshot] = useState<SemanticSelectionSnapshot | null>(null);
  const [selectedSemanticNode, setSelectedSemanticNode] = useState<SemanticSelectionSnapshot | null>(null);
  const [expansionOverlays, setExpansionOverlays] = useState<ExpansionOverlay[]>([]);
  const [currentPriceMarker, setCurrentPriceMarker] = useState<CurrentPriceMarker | null>(null);
  const [holdingPriceMarker, setHoldingPriceMarker] = useState<PaperHoldingPriceMarker | null>(null);
  const [currentPriceClock, setCurrentPriceClock] = useState(() => simulationAwareNowMs(Date.now()));
  const [drawingDraft, setDrawingDraft] = useState<DrawingDraft | null>(null);
  const [drawingDraftError, setDrawingDraftError] = useState<string | null>(null);
  const [postCreateFocusDrawingId, setPostCreateFocusDrawingId] = useState<string | null>(null);
  const [labelEditor, setLabelEditor] = useState<{ drawingId: string; value: string; originalValue: string } | null>(null);
  const [transientViewport, setTransientViewport] = useState<ChartViewport | null>(null);
  const [transientDrawings, setTransientDrawings] = useState<DrawingEntity[] | null>(null);
  const [transientPaneRatios, setTransientPaneRatios] = useState<Record<string, number> | null>(null);
  const [baseIndicatorSeries, setBaseIndicatorSeries] = useState<IndicatorSeries>({});
  const [baseIndicatorRequestStatus, setBaseIndicatorRequestStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [expansionIndicatorSeries, setExpansionIndicatorSeries] = useState<IndicatorSeries>({});
  const [volumeProfile, setVolumeProfile] = useState<ChartState["volumeProfile"]>(null);
  const [volumeProfileRuntimeStatus, setVolumeProfileRuntimeStatus] = useState<ChartCommentaryIndicatorRuntimeStatus>("off");
  const [volumeProfileSceneRange, setVolumeProfileSceneRange] = useState<VolumeProfileSceneRange | null>(null);
  const [orderFlowToday, setOrderFlowToday] = useState<Map<string, OrderFlowMinuteDto>>(new Map());
  const [orderFlowTodaySessionDate, setOrderFlowTodaySessionDate] = useState<string | null>(null);
  const orderFlowTodaySessionDateRef = useRef<string | null>(null);
  const [orderFlowDataStatus, setOrderFlowDataStatus] = useState<OrderFlowChartDataStatus>("loading");
  const [orderFlowSupportedSymbols, setOrderFlowSupportedSymbols] = useState<string[] | undefined>();
  const [orderFlowPriceBinSize, setOrderFlowPriceBinSize] = useState(defaultOrderFlowPriceBinSize);
  const [comparisonScopeData, setComparisonScopeData] = useState<Record<string, ComparisonScopeData>>({});
  const [analysisAssets, setAnalysisAssets] = useState<AnalysisAssetsResponse | null>(null);
  const [analysisAssetsLoadError, setAnalysisAssetsLoadError] = useState<string | null>(null);
  const [analysisAssetsLoadPhase, setAnalysisAssetsLoadPhase] = useState<ChartAnalysisAssetLoadPhase>("waiting-for-chart");
  const [analysisAssetsRevision, setAnalysisAssetsRevision] = useState(0);
  const [analysisSceneReadyToken, setAnalysisSceneReadyToken] = useState<{ requestKey: string; generation: number } | null>(null);
  const [analysisLayerVisibility, setAnalysisLayerVisibility] = useState<AnalysisLayerVisibility>(() => ({
    ...defaultAnalysisLayerVisibility
  }));
  const [analysisCandidateCounts, setAnalysisCandidateCounts] = useState<{ total: number; visible: number; stored: number } | null>(null);
  const [spotlightDrawingIds, setSpotlightDrawingIds] = useState<string[]>([]);
  const [proposalPriceSourceSpotlightIds, setProposalPriceSourceSpotlightIds] = useState<string[]>([]);
  const [spotlightCandleTimestamp, setSpotlightCandleTimestamp] = useState<string | undefined>();
  const [spotlightProposalPrice, setSpotlightProposalPrice] = useState<number | null>(null);
  const [spotlightCandidateIds, setSpotlightCandidateIds] = useState<string[]>([]);
  const [spotlightEvidenceRefs, setSpotlightEvidenceRefs] = useState<string[]>([]);
  const [tradePlanOverlay, setTradePlanOverlay] = useState<TradePlanOverlayLayout | null>(null);
  const [patternBadge, setPatternBadge] = useState<PatternBadgeLayout | null>(null);
  const [chartEvents, setChartEvents] = useState<ChartEventsResponse | null>(null);
  const [chartEventMarkers, setChartEventMarkers] = useState<ChartEventMarker[]>([]);
  const [chartTradeMarkers, setChartTradeMarkers] = useState<ChartTradeMarker[]>([]);
  const [chartEventUpcomingStyle, setChartEventUpcomingStyle] = useState<CSSProperties>();
  const [commentaryEventOpenRequest, setCommentaryEventOpenRequest] = useState<ChartEventOpenRequest | null>(null);
  const [commentaryExtraFutureSlots, setCommentaryExtraFutureSlots] = useState(0);
  const effectiveSpotlightDrawingIds = useMemo(() => [...new Set([
    ...spotlightDrawingIds,
    ...proposalPriceSourceSpotlightIds
  ])], [proposalPriceSourceSpotlightIds, spotlightDrawingIds]);
  const sourceChart = useMemo(() => ({
    ...chartStateFromDocument(document, candles, dataStatus, streamStatus, streamMessage),
    liveTrade
  }), [candles, dataStatus, document, liveTrade, streamMessage, streamStatus]);
  const bidAskSessionDate = useMemo(() => {
    if (orderFlowTodaySessionDate) {
      return orderFlowTodaySessionDate;
    }
    return sourceChart.candles.length
      ? sessionDateFromTimestamp(sourceChart.candles[sourceChart.candles.length - 1].timestamp)
      : sessionDateFromTimestamp(new Date().toISOString());
  }, [orderFlowTodaySessionDate, sourceChart.candles]);
  const chart = useMemo(() => (
    sourceChart.chartType === "bidask"
      ? { ...sourceChart, candles: bidAskCandlesForSession(sourceChart.candles, bidAskSessionDate) }
      : sourceChart
  ), [bidAskSessionDate, sourceChart]);
  const analysisRuntimeIdentity = chartAnalysisAssetRuntimeIdentity(document.id, chart.symbol, chart.interval);
  const holdingOverlay = useMemo(() => (
    findPaperHoldingOverlay(paperAccountSnapshot?.positions ?? [], chart.symbol)
  ), [chart.symbol, paperAccountSnapshot?.positions]);
  const orderFlowActive = chart.chartType === "bidask" && isBidAskChartInterval(chart.interval);
  const earningsEventsVisible = chart.layers["events:earnings"] !== false;
  const newsEventsVisible = chart.layers["events:news"] !== false;
  const chartEventsRange = useMemo(
    () => chartEventRequestRange(chart.candles, chart.interval),
    [chart.candles, chart.interval]
  );
  const activeIndicatorLayers = useMemo(() => orderFlowActive ? [] : activeServerIndicatorLayers(chart), [
    orderFlowActive,
    chart.layers.ma5,
    chart.layers.ma20,
    chart.layers.ma60,
    chart.layers["sma:5"],
    chart.layers["sma:20"],
    chart.layers["sma:60"],
    chart.layers["sma:120"],
    chart.layers["ema:20"],
    chart.layers["wma:20"],
    chart.layers["bollinger:20:2"],
    chart.layers["rsi:14"],
    chart.layers["stochastic:14:3:3"],
    chart.layers["macd:12:26:9"]
  ]);
  const activeIndicatorLayerKey = activeIndicatorLayers.join(",");
  const baseIndicatorRange = useMemo(() => indicatorRequestRangeFromCandles(chart.candles), [chart.candles]);
  const baseIndicatorRequest = useMemo(() => {
    if (!activeIndicatorLayers.length || !baseIndicatorRange) {
      return null;
    }
    return {
      key: [
        chart.symbol,
        chart.interval,
        baseIndicatorRange.firstTimestamp,
        baseIndicatorRange.lastTimestamp,
        baseIndicatorRange.candleCount,
        activeIndicatorLayerKey
      ].join("|"),
      symbol: chart.symbol,
      interval: candleSourceInterval(chart.interval),
      from: baseIndicatorRange.firstTimestamp,
      to: baseIndicatorRange.lastTimestamp,
      limit: indicatorRequestLimitForInterval(chart.interval, baseIndicatorRange.candleCount),
      layers: activeIndicatorLayers
    };
  }, [activeIndicatorLayerKey, activeIndicatorLayers, baseIndicatorRange, chart.interval, chart.symbol]);
  const visibleProfileRange = useMemo(() => visibleCandleRangeForProfile(chart, transientViewport), [
    chart.candles,
    chart.rightOffset,
    chart.visibleCount,
    transientViewport
  ]);
  const volumeProfileRequest = useMemo<ExactVolumeProfileRequest | null>(() => {
    if (!visibleProfileRange || !volumeProfileSceneRange ||
      volumeProfileSceneRange.symbol !== chart.symbol ||
      volumeProfileSceneRange.interval !== chart.interval ||
      volumeProfileSceneRange.from !== visibleProfileRange.from ||
      volumeProfileSceneRange.to !== visibleProfileRange.to ||
      volumeProfileSceneRange.candleCount !== visibleProfileRange.candleCount) {
      return null;
    }
    return volumeProfileSceneRange;
  }, [
    chart.interval,
    chart.symbol,
    volumeProfileSceneRange,
    visibleProfileRange?.from,
    visibleProfileRange?.to,
    visibleProfileRange?.candleCount
  ]);
  const volumeProfileRequestKey = useMemo(() => (
    volumeProfileRequest
      ? stableVolumeProfileRangeKey({ ...volumeProfileRequest, priceBinSize: "auto" })
      : ""
  ), [volumeProfileRequest]);
  const orderFlowDemoContext = useMemo(() => {
    if (!isOrderFlowDemoRuntimeEnabled()) {
      return undefined;
    }
    return orderFlowDemoContextFromCandles(chart.candles, chart.interval);
  }, [chart.candles, chart.interval]);
  const orderFlowDemoAnchor = orderFlowDemoContext?.anchor;
  const visibleComparisonRange = useMemo(() => visibleCandleRangeForComparison(chart, transientViewport), [
    chart.candles,
    chart.rightOffset,
    chart.visibleCount,
    transientViewport
  ]);
  const comparisonScopeRequests = useMemo(() => (
    orderFlowActive ? [] : buildComparisonScopeRequests(chart, visibleComparisonRange, activeExpansions)
  ), [
    activeExpansions,
    chart.comparisons,
    chart.interval,
    chart.symbol,
    orderFlowActive,
    visibleComparisonRange
  ]);
  const comparisonScopeRequestKey = useMemo(() => (
    comparisonScopeRequests.map((request) => request.key).join("|")
  ), [comparisonScopeRequests]);
  const activeBelowPaneOrder = useMemo(() => activeBelowPaneIds(chart), [
    chart.chartType,
    chart.layers.volume,
    chart.layers["rsi:14"],
    chart.layers["stochastic:14:3:3"],
    chart.layers["macd:12:26:9"],
    chart.panes
  ]);
  const commentaryIndicatorStatuses = useMemo(() => {
    const statuses: Partial<Record<ChartAssetCommentaryIndicatorLayer, ChartCommentaryIndicatorRuntimeStatus>> = {};
    const belowCapacity = typeof laneHeight === "number"
      ? maxBelowPaneCountForHeight(laneHeight)
      : Number.POSITIVE_INFINITY;
    commentaryIndicatorLayers.forEach((layer) => {
      const visible = Boolean(chart.layers[layer]);
      if (orderFlowActive) {
        statuses[layer] = "unavailable";
        return;
      }
      if (layer === "volume-profile") {
        statuses[layer] = volumeProfileRuntimeStatus;
        return;
      }
      if (!visible) {
        statuses[layer] = commentaryBelowIndicatorLayers.has(layer)
          && activeBelowPaneOrder.length >= belowCapacity
          ? "unavailable"
          : "off";
        return;
      }
      if (layer === "volume") {
        statuses[layer] = chart.candles.some((candle) => Number.isFinite(candle.volume) && candle.volume > 0)
          ? "ready"
          : "empty";
        return;
      }
      if (baseIndicatorRequestStatus === "loading") {
        statuses[layer] = "loading";
      } else if (baseIndicatorRequestStatus === "error") {
        statuses[layer] = "error";
      } else if (baseIndicatorRequestStatus === "ready") {
        statuses[layer] = (baseIndicatorSeries[layer]?.length ?? 0) > 0 ? "ready" : "empty";
      } else {
        statuses[layer] = "empty";
      }
    });
    return statuses;
  }, [
    activeBelowPaneOrder.length,
    baseIndicatorRequestStatus,
    baseIndicatorSeries,
    chart.candles,
    chart.layers,
    laneHeight,
    orderFlowActive,
    volumeProfileRuntimeStatus
  ]);
  const chartPanelRef = useRef<HTMLElement | null>(null);
  const holdingPriceTooltipId = useId();
  const holdingPriceMarkerRef = useRef<HTMLSpanElement | null>(null);
  const chartControlTooltip = useImmediateChartTooltip();
  const sceneRef = useRef<ChartScene | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const tradePlanOverlayRef = useRef<HTMLDivElement | null>(null);
  const chartAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const chartAddMenuRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartState>(chart);
  const selectedSemanticNodeRef = useRef<SemanticSelectionSnapshot | null>(selectedSemanticNode);
  const hoveredSemanticNodeIdRef = useRef<string | undefined>(undefined);
  const activeExpansionsRef = useRef<SemanticExpansion[]>(activeExpansions);
  const olderRangeRequestsRef = useRef<Set<string>>(new Set());
  const olderRangeRetryAfterRef = useRef<Map<string, number>>(new Map());
  const pendingViewportAnchorRef = useRef<{ key: string; anchor: ViewportAnchor } | null>(null);
  const overlayKeyRef = useRef("");
  const chartEventMarkerKeyRef = useRef("");
  const chartTradeMarkerKeyRef = useRef("");
  const chartEventUpcomingStyleKeyRef = useRef("");
  const chartEventsRef = useRef<ChartEventsResponse | null>(null);
  const pendingCommentaryNavigationRef = useRef<PendingCommentaryNavigation | null>(null);
  const commentaryExtraFutureSlotsRef = useRef(0);
  const selectedCommentaryEventIdRef = useRef<string | null>(null);
  const commentaryInteractionIdentityRef = useRef<string | null>(null);
  const chartEventCoverageRef = useRef<ChartEventCoverage | null>(null);
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  const paneResizeRef = useRef<PaneResizeAnchor | null>(null);
  const drawingDragRef = useRef<DrawingDrag | null>(null);
  const labelEditorInputRef = useRef<HTMLInputElement | null>(null);
  const cancelLabelEditRef = useRef(false);
  const pendingSemanticClickRef = useRef<PendingSemanticClick | null>(null);
  const priceAxisPointerRef = useRef<PriceAxisPointer | null>(null);
  const transientViewportRef = useRef<ChartViewport | null>(null);
  const pendingTransientDrawingsRef = useRef<DrawingEntity[] | null>(null);
  const interactionRenderFrameRef = useRef<number | null>(null);
  const pendingViewportRenderRef = useRef(false);
  const pendingDrawingsRenderRef = useRef(false);
  const wheelViewportRef = useRef<ChartViewport | null>(null);
  const wheelRenderFrameRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const transientPaneRatiosRef = useRef<Record<string, number> | null>(null);
  const activeChartSessionIdRef = useRef(`chart-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const analysisLayerVisibilityRef = useRef(analysisLayerVisibility);
  const appliedAnalysisAssetKeyRef = useRef("");
  const candleLoadGenerationRef = useRef(0);
  const loadedCandleSnapshotRef = useRef<ChartAnalysisAssetLoadedCandleSnapshot | null>(null);
  const analysisSceneReadyTokenRef = useRef("");
  const proposalAutoFrameKeyRef = useRef("");
  const tradePlanOverlayKeyRef = useRef("none");
  const tradePlanOverlayLayoutRef = useRef<TradePlanOverlayLayout | null>(null);
  const patternBadgeKeyRef = useRef("none");
  const indicatorSeries = useMemo(() => (
    mergeIndicatorSeries(baseIndicatorSeries, expansionIndicatorSeries)
  ), [baseIndicatorSeries, expansionIndicatorSeries]);

  useEffect(() => {
    const loadPhase: ChartAnalysisAssetLoadPhase = isAnalysisAssetInterval(chart.interval)
      ? "waiting-for-chart"
      : "ready";
    setAnalysisAssets(null);
    setAnalysisAssetsLoadError(null);
    setAnalysisAssetsLoadPhase(loadPhase);
    setAnalysisSceneReadyToken(null);
    loadedCandleSnapshotRef.current = null;
    analysisSceneReadyTokenRef.current = "";
    appliedAnalysisAssetKeyRef.current = "";
    updateChartAnalysisAssetRuntime(document.id, {
      identity: analysisRuntimeIdentity,
      phase: loadPhase,
      response: null,
      error: null
    });
    return () => clearChartAnalysisAssetRuntime(document.id, analysisRuntimeIdentity);
  }, [analysisRuntimeIdentity, chart.interval, document.id]);

  useEffect(() => subscribeAnalysisAssetsInvalidation((invalidatedSymbol) => {
    const activeSymbol = chart.symbol.trim().toUpperCase();
    if (!invalidatedSymbol || invalidatedSymbol === activeSymbol) {
      setAnalysisAssets(null);
      setAnalysisAssetsLoadError(null);
      setAnalysisAssetsLoadPhase("loading");
      appliedAnalysisAssetKeyRef.current = "";
      updateChartAnalysisAssetRuntime(document.id, {
        identity: analysisRuntimeIdentity,
        phase: "loading",
        response: null,
        error: null
      });
      setAnalysisAssetsRevision((current) => current + 1);
    }
  }), [analysisRuntimeIdentity, chart.symbol, document.id]);

  useEffect(() => {
    chartRef.current = chart;
  }, [chart]);

  useEffect(() => {
    selectedSemanticNodeRef.current = selectedSemanticNode;
  }, [selectedSemanticNode]);

  useEffect(() => {
    commentaryExtraFutureSlotsRef.current = commentaryExtraFutureSlots;
  }, [commentaryExtraFutureSlots]);

  useEffect(() => () => {
    clearChartCommentaryInteraction(document.id);
  }, [document.id]);

  useEffect(() => {
    updateChartCommentaryInteraction(document.id, { indicatorStatuses: commentaryIndicatorStatuses });
  }, [commentaryIndicatorStatuses, document.id]);

  useLayoutEffect(() => {
    syncTradePlanOverlayElement(
      tradePlanOverlayRef.current,
      tradePlanOverlayLayoutRef.current,
      sceneRef.current,
      chartWrapRef.current
    );
    syncPaperHoldingPriceMarkerPosition(holdingPriceMarkerRef.current, holdingPriceMarker);
  });

  useEffect(() => {
    if (orderFlowActive || (!earningsEventsVisible && !newsEventsVisible) || !chartEventsRange) {
      setChartEvents(null);
      chartEventsRef.current = null;
      chartEventCoverageRef.current = null;
      setChartEventMarkers([]);
      chartEventMarkerKeyRef.current = "";
      return undefined;
    }
    const requested: ChartEventCoverage = {
      symbol: chart.symbol.trim().toUpperCase(),
      from: chartEventsRange.from,
      to: chartEventsRange.to
    };
    const previousCoverage = chartEventCoverageRef.current;
    const reset = previousCoverage?.symbol !== requested.symbol;
    const missingRanges = missingChartEventRanges(reset ? null : previousCoverage, requested);
    let active = true;
    const loadController = new AbortController();
    let refreshController: AbortController | null = null;
    if (reset) {
      setChartEvents(null);
      chartEventsRef.current = null;
      chartEventCoverageRef.current = null;
    }
    const requestRange = (range: { from: string; to: string }, signal: AbortSignal) => fetchChartEvents({
      symbol: requested.symbol,
      from: range.from,
      to: range.to,
      locale: "ko-KR",
      upcomingDays: 90
    }, signal);
    const loadMissingRanges = async () => {
      if (!missingRanges.length) return;
      try {
        const responses = await Promise.all(missingRanges.map((range) => requestRange(range, loadController.signal)));
        if (active) {
          const merged = mergeChartEventsResponses(chartEventsRef.current, responses, requested);
          chartEventsRef.current = merged;
          chartEventCoverageRef.current = requested;
          setChartEvents(merged);
        }
      } catch (error) {
        if (active && reset && !(error instanceof DOMException && error.name === "AbortError")) {
          chartEventsRef.current = null;
          setChartEvents(null);
        }
      }
    };
    const refreshLatestNewsDay = async () => {
      refreshController?.abort();
      refreshController = new AbortController();
      try {
        const response = await requestRange(latestChartEventRefreshRange(requested), refreshController.signal);
        if (active) {
          const merged = mergeChartEventsResponses(chartEventsRef.current, [response], requested);
          chartEventsRef.current = merged;
          setChartEvents(merged);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the last stored event snapshot when a periodic refresh fails.
        }
      }
    };
    void loadMissingRanges();
    const refreshTimer = newsEventsVisible
      ? window.setInterval(() => void refreshLatestNewsDay(), 60_000)
      : undefined;
    return () => {
      active = false;
      loadController.abort();
      refreshController?.abort();
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [
    chart.symbol,
    chartEventsRange?.from,
    chartEventsRange?.to,
    earningsEventsVisible,
    newsEventsVisible,
    orderFlowActive
  ]);

  useEffect(() => {
    analysisLayerVisibilityRef.current = analysisLayerVisibility;
  }, [analysisLayerVisibility]);

  useEffect(() => {
    if (!currentPriceMarker || currentPriceMarker.isClosed || currentPriceMarker.streamState !== "live") {
      return undefined;
    }
    const timer = window.setInterval(() => setCurrentPriceClock(simulationAwareNowMs(Date.now())), 1000);
    return () => window.clearInterval(timer);
  }, [currentPriceMarker]);

  useEffect(() => {
    activeExpansionsRef.current = activeExpansions;
  }, [activeExpansions]);

  const setHoveredSemanticUnit = useCallback((unit: SemanticRenderUnit | null | undefined) => {
    const nextId = unit?.id;
    if (hoveredSemanticNodeIdRef.current === nextId) return;
    hoveredSemanticNodeIdRef.current = nextId;
    setHoveredSemanticNodeId(nextId);
    setHoverSnapshot(unit ? snapshotFromSemanticUnit(unit) : null);
  }, []);

  const commandTarget = useMemo(() => ({
    panelId,
    chartDocumentId: document.id
  }), [document.id, panelId]);

  const emitDocumentCommand = useCallback((
    type: ChartCommandType,
    payload: Record<string, unknown> = {},
    actor: ChartCommandActor = "user",
    historyScope?: ChartCommandHistoryScope
  ) => {
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand(type, actor, commandTarget, payload, undefined, historyScope)
    });
  }, [commandTarget, onChartRuntimeAction]);

  const dispatchDocumentCommand = useCallback((
    type: ChartCommandType,
    payload: Record<string, unknown> = {},
    actor: ChartCommandActor = "user",
    historyScope?: ChartCommandHistoryScope
  ) => {
    setDrawingDraft(null);
    setDrawingDraftError(null);
    setTransientDrawings(null);
    emitDocumentCommand(type, payload, actor, historyScope);
  }, [emitDocumentCommand]);

  const dispatchExternalCommandGroup = useCallback((commands: ChartCommand[], label: string) => {
    if (!commands.length) {
      return;
    }
    setDrawingDraft(null);
    setDrawingDraftError(null);
    setTransientDrawings(null);
    onChartRuntimeAction({ kind: "chart.command.group", commands, label });
  }, [onChartRuntimeAction]);

  useEffect(() => {
    const requestedSymbol = chart.symbol.trim().toUpperCase();
    const requestKey = chartMemoryKey(requestedSymbol, chart.interval);
    if (
      !isAnalysisAssetInterval(chart.interval)
      || !analysisSceneReadyToken
      || analysisSceneReadyToken.requestKey !== requestKey
    ) {
      return undefined;
    }
    let active = true;
    const runtimeIdentity = analysisRuntimeIdentity;
    const cancelScheduledRequest = scheduleChartAnalysisAssetRequest(() => {
      if (!active) return;
      setAnalysisAssetsLoadPhase("loading");
      setAnalysisAssetsLoadError(null);
      updateChartAnalysisAssetRuntime(document.id, {
        identity: runtimeIdentity,
        phase: "loading",
        response: null,
        error: null
      });
      fetchAnalysisAssets(requestedSymbol, chart.interval)
        .then((response) => {
          if (!active || response.symbol !== requestedSymbol) return;
          setAnalysisAssets(response);
          setAnalysisAssetsLoadError(null);
          setAnalysisAssetsLoadPhase("ready");
          updateChartAnalysisAssetRuntime(document.id, {
            identity: runtimeIdentity,
            phase: "ready",
            response,
            error: null
          });
        })
        .catch((reason) => {
          if (!active) return;
          const message = analysisAssetsLoadErrorMessage(reason);
          setAnalysisAssets(null);
          setAnalysisAssetsLoadError(message);
          setAnalysisAssetsLoadPhase("error");
          updateChartAnalysisAssetRuntime(document.id, {
            identity: runtimeIdentity,
            phase: "error",
            response: null,
            error: message
          });
        });
    });
    return () => {
      active = false;
      cancelScheduledRequest();
    };
  }, [
    analysisAssetsRevision,
    analysisRuntimeIdentity,
    analysisSceneReadyToken,
    chart.interval,
    chart.symbol,
    document.id
  ]);

  const rawActiveAnalysisAsset = isAnalysisAssetInterval(chart.interval)
    && analysisAssets?.symbol === chart.symbol.trim().toUpperCase()
    ? analysisAssets.assets[chart.interval]
    : null;
  const activeAnalysisAsset = useMemo(() => resolveAnalysisAssetForCandles(
    rawActiveAnalysisAsset,
    chart.candles,
    analysisAssets?.assets
  ), [analysisAssets?.assets, chart.candles, rawActiveAnalysisAsset]);
  const activeAnalysisAssetFreshness = useMemo(() => activeAnalysisAsset
    ? analysisAssetFreshness(activeAnalysisAsset, chart.candles)
    : null, [activeAnalysisAsset, chart.candles]);
  const commentaryInteractionIdentity = [
    chart.symbol.trim().toUpperCase(),
    chart.interval,
    activeAnalysisAsset?.inputDigest ?? "no-asset",
    activeAnalysisAsset?.commentary?.sourceIdentity.contextDigest ?? "no-commentary",
    activeAnalysisAsset?.commentary?.promptVersion ?? "rule-based"
  ].join("|");

  useEffect(() => {
    const previousIdentity = commentaryInteractionIdentityRef.current;
    commentaryInteractionIdentityRef.current = commentaryInteractionIdentity;
    if (previousIdentity === null || previousIdentity === commentaryInteractionIdentity) return;
    pendingCommentaryNavigationRef.current = null;
    commentaryExtraFutureSlotsRef.current = 0;
    setCommentaryExtraFutureSlots(0);
    setSelectedSemanticNode(null);
    const selectedEventId = selectedCommentaryEventIdRef.current;
    if (selectedEventId) {
      setCommentaryEventOpenRequest((previous) => ({
        eventId: selectedEventId,
        revision: (previous?.revision ?? 0) + 1
      }));
    }
  }, [commentaryInteractionIdentity]);
  const analysisTraceOverlay = useMemo(() => buildAnalysisTraceOverlay(activeAnalysisAsset, {
    visible: analysisLayerVisibility.interpretation,
    candidateIds: spotlightCandidateIds,
    evidenceRefs: spotlightEvidenceRefs
  }), [activeAnalysisAsset, analysisLayerVisibility.interpretation, spotlightCandidateIds, spotlightEvidenceRefs]);
  const analysisTraceDiagnosticOverlay = useMemo(() => buildAnalysisTraceOverlay(activeAnalysisAsset, {
    visible: true
  }), [activeAnalysisAsset]);
  const latestClosedAssetCandleTimestamp = useMemo(() => latestClosedTimestamp(chart.candles), [chart.candles]);
  const chartTradeSetup = useMemo(() => projectChartTradeSetup(
    activeAnalysisAsset,
    chart.candles
  ), [activeAnalysisAsset, chart.candles]);
  const chartTradeSetupSnapshot = useMemo<ChartTradeSetupSnapshot | null>(() => chartTradeSetup ? {
    version: "chart-trade-setup-snapshot-v1",
    chartDocumentId: document.id,
    sourcePanelId: panelId,
    symbol: chart.symbol.trim().toUpperCase(),
    interval: chart.interval,
    setup: chartTradeSetup,
    assetIdentity: { ...chartTradeSetup.assetIdentity },
    spotlightPrice: spotlightProposalPrice
  } : null, [chart.interval, chart.symbol, chartTradeSetup, document.id, panelId, spotlightProposalPrice]);

  useEffect(() => {
    setChartTradeSetupSnapshot(document.id, chartTradeSetupSnapshot);
  }, [chartTradeSetupSnapshot, document.id]);

  useEffect(() => () => {
    clearChartTradeSetupSnapshot(document.id);
  }, [document.id]);

  useEffect(() => {
    setActiveTradePlan(document.id, projectActiveTradePlan(
      activeAnalysisAsset,
      chart.candles,
      document.id,
      activeAnalysisAssetFreshness?.state === "current" ? "active" : "stale"
    ));
  }, [activeAnalysisAsset, activeAnalysisAssetFreshness?.state, chart.candles, document.id]);

  useEffect(() => () => clearActiveTradePlan(document.id), [document.id]);

  useEffect(() => {
    setSpotlightDrawingIds([]);
    setProposalPriceSourceSpotlightIds([]);
    setSpotlightCandidateIds([]);
    setSpotlightEvidenceRefs([]);
  }, [activeAnalysisAsset?.generatedAt, chart.interval, chart.symbol, document.id]);

  useEffect(() => {
    const interval = chart.interval;
    const supportedInterval = isAnalysisAssetInterval(interval);
    const asset = supportedInterval && latestClosedAssetCandleTimestamp && activeAnalysisAsset
      ? staleAnalysisAsset(activeAnalysisAsset, activeAnalysisAssetFreshness?.state === "source_invalid")
      : null;
    const applyKey = [
      chart.symbol,
      interval,
      asset?.generatedAt ?? "none",
      chart.candles[0]?.timestamp ?? "empty",
      chart.candles.length,
      latestClosedAssetCandleTimestamp ?? "no-closed-candle"
    ].join("|");
    if (appliedAnalysisAssetKeyRef.current === applyKey) {
      return;
    }
    appliedAnalysisAssetKeyRef.current = applyKey;
    const commands = analysisAssetApplyCommands(
      commandTarget,
      chart.drawings,
      asset,
      analysisLayerVisibilityRef.current,
      { mode: chart.toolMode, selectedDrawingId: chart.selectedDrawingId }
    );
    dispatchExternalCommandGroup(commands, asset ? "Apply chart analysis asset" : "Clear chart analysis asset");
  }, [
    activeAnalysisAsset,
    activeAnalysisAssetFreshness?.state,
    chart.candles,
    chart.interval,
    chart.selectedDrawingId,
    chart.symbol,
    chart.toolMode,
    commandTarget,
    dispatchExternalCommandGroup,
    latestClosedAssetCandleTimestamp
  ]);

  const toggleAnalysisLayer = useCallback((layer: AnalysisLayerKey) => {
    if (!activeAnalysisAsset) {
      return;
    }
    const visible = !analysisLayerVisibilityRef.current[layer];
    const next = { ...analysisLayerVisibilityRef.current, [layer]: visible };
    analysisLayerVisibilityRef.current = next;
    setAnalysisLayerVisibility(next);
    dispatchExternalCommandGroup(
      analysisLayerToggleCommands(commandTarget, chartRef.current.drawings, activeAnalysisAsset, layer, visible),
      `${visible ? "Show" : "Hide"} chart analysis ${layer}`
    );
  }, [activeAnalysisAsset, commandTarget, dispatchExternalCommandGroup]);

  useEffect(() => {
    const handleLayerToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ chartDocumentId?: string; layer?: string }>).detail;
      if (detail?.chartDocumentId !== document.id || detail.layer !== "proposal") return;
      toggleAnalysisLayer("proposal");
    };
    window.addEventListener(chartAnalysisLayerToggleEventName, handleLayerToggle);
    return () => window.removeEventListener(chartAnalysisLayerToggleEventName, handleLayerToggle);
  }, [document.id, toggleAnalysisLayer]);

  useEffect(() => {
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<{
        chartDocumentId?: string;
        symbol?: string;
        interval?: string;
        drawingIds?: string[];
        mode?: "select" | "spotlight" | "clear";
        anchor?: { timestamp?: string | null } | null;
        price?: number | null;
        candidateIds?: string[];
        evidenceRefs?: string[];
      }>).detail;
      if (detail?.chartDocumentId) {
        if (detail.chartDocumentId !== document.id) return;
      } else if (detail?.symbol !== chart.symbol.trim().toUpperCase() || detail.interval !== chart.interval) return;
      if (detail.mode === "clear") {
        setSpotlightDrawingIds([]);
        setSpotlightCandleTimestamp(undefined);
        setSpotlightProposalPrice(null);
        setSpotlightCandidateIds([]);
        setSpotlightEvidenceRefs([]);
        return;
      }
      const analysisInterval = isAnalysisAssetInterval(chart.interval) ? chart.interval : null;
      const anchorKey = detail.anchor?.timestamp && analysisInterval
        ? candleKeyForTimestamp(detail.anchor.timestamp, analysisInterval)
        : null;
      const anchorCandle = anchorKey
        ? chartRef.current.candles.find((candle) => candleKeyForTimestamp(candle.timestamp, analysisInterval!) === anchorKey)
        : undefined;
      setSpotlightCandleTimestamp(anchorCandle?.timestamp);
      setSpotlightProposalPrice(typeof detail.price === "number" && Number.isFinite(detail.price) && detail.price > 0
        ? detail.price
        : null);
      setSpotlightCandidateIds(detail.candidateIds?.filter((id) => typeof id === "string" && id.length > 0) ?? []);
      setSpotlightEvidenceRefs(detail.evidenceRefs?.filter((id) => typeof id === "string" && id.length > 0) ?? []);
      const validIds = detail.drawingIds?.filter((id) => chartRef.current.drawings.some((drawing) => drawing.id === id)) ?? [];
      // Commentary focus is a non-persistent visual overlay. A pinned section
      // keeps the spotlight active, but must not replace the user's drawing
      // selection or leak a selection into undo/history when focus is cleared.
      setSpotlightDrawingIds(validIds);
    };
    window.addEventListener("gops:chart-asset-focus", handleFocus);
    return () => window.removeEventListener("gops:chart-asset-focus", handleFocus);
  }, [chart.interval, chart.symbol, commandTarget, dispatchExternalCommandGroup, document.id]);

  useEffect(() => {
    setSpotlightDrawingIds([]);
    setSpotlightCandleTimestamp(undefined);
    setSpotlightProposalPrice(null);
    setSpotlightCandidateIds([]);
    setSpotlightEvidenceRefs([]);
  }, [chart.interval, chart.symbol, document.id]);

  const beginLabelEdit = useCallback((drawing: DrawingEntity) => {
    if (!drawingSupportsTextEditing(drawing)) {
      return;
    }
    const value = drawing.label ?? "";
    cancelLabelEditRef.current = false;
    setLabelEditor({ drawingId: drawing.id, value, originalValue: value });
  }, []);

  const commitLabelEdit = useCallback(() => {
    if (!labelEditor) {
      return;
    }
    if (cancelLabelEditRef.current) {
      cancelLabelEditRef.current = false;
      setLabelEditor(null);
      return;
    }
    if (labelEditor.value !== labelEditor.originalValue) {
      dispatchDocumentCommand("chart.drawing.update", {
        drawingId: labelEditor.drawingId,
        drawingPatch: { label: labelEditor.value }
      });
    }
    setLabelEditor(null);
  }, [dispatchDocumentCommand, labelEditor]);

  useEffect(() => {
    if (!labelEditor) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      labelEditorInputRef.current?.focus();
      labelEditorInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [labelEditor?.drawingId]);

  useEffect(() => {
    if (chart.toolMode !== "select") {
      setPostCreateFocusDrawingId(null);
      setLabelEditor(null);
    }
    const activeDrawingType = drawingTypeFromToolMode(chart.toolMode);
    setDrawingDraft((current) => current && current.type === activeDrawingType ? current : null);
    setDrawingDraftError((current) => drawingDraft?.type === activeDrawingType ? current : null);
  }, [chart.toolMode, drawingDraft?.type]);

  useEffect(() => {
    if (chart.toolMode === "select" && labelEditor && !chart.drawings.some((drawing) => drawing.id === labelEditor.drawingId)) {
      setLabelEditor(null);
    }
    if (chart.toolMode === "select" && postCreateFocusDrawingId && !chart.drawings.some((drawing) => drawing.id === postCreateFocusDrawingId)) {
      setPostCreateFocusDrawingId(null);
    }
  }, [chart.drawings, labelEditor, postCreateFocusDrawingId]);

  useEffect(() => {
    if (!chartAddActive || !onChartAddToggle) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || chartAddButtonRef.current?.contains(target) || chartAddMenuRef.current?.contains(target)) {
        return;
      }
      onChartAddToggle();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onChartAddToggle();
        chartAddButtonRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chartAddActive, onChartAddToggle]);

  useEffect(() => {
    const handleParallelLineCountKey = (event: KeyboardEvent) => {
      // Multiple chart panels own an always-visible toolbar. Only the panel
      // containing focus (or the pointer) may consume the global shortcut.
      const panel = chartPanelRef.current;
      if (!panel || (!panel.contains(window.document.activeElement) && !panel.matches(":hover"))) {
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
      if (chart.toolMode === "draw-trendParallelLines") {
        event.preventDefault();
        emitDocumentCommand("chart.drawing.clearSelection", {
          mode: chart.toolMode,
          parallelLineCount: normalizeParallelLineCount(chart.parallelLineCount + delta)
        });
        return;
      }
      const selectedDrawing = chart.drawings.find((drawing) => drawing.id === chart.selectedDrawingId);
      if (chart.toolMode === "select" && selectedDrawing?.type === "trendParallelLines") {
        event.preventDefault();
        emitDocumentCommand("chart.drawing.update", {
          drawingId: selectedDrawing.id,
          drawingPatch: {
            parallelLineCount: normalizeParallelLineCount((selectedDrawing.parallelLineCount ?? chart.parallelLineCount) + delta)
          }
        });
      }
    };
    window.addEventListener("keydown", handleParallelLineCountKey);
    return () => window.removeEventListener("keydown", handleParallelLineCountKey);
  }, [chart.drawings, chart.parallelLineCount, chart.selectedDrawingId, chart.toolMode, emitDocumentCommand]);

  useEffect(() => {
    if (chart.chartType !== "bidask" || isBidAskChartInterval(document.timeframe)) {
      return;
    }
    const followsLatest = chart.rightOffset <= 0;
    pendingViewportAnchorRef.current = {
      key: chartMemoryKey(chart.symbol, defaultBidAskInterval),
      anchor: {
        mode: followsLatest ? "latest" : "right",
        timestamp: followsLatest ? undefined : visibleRightAnchorTimestamp(sceneRef.current, chart),
        visibleCount: defaultVisibleBarsForBidAskInterval(defaultBidAskInterval)
      }
    };
    dispatchDocumentCommand("chart.timeframe.set", { timeframe: defaultBidAskInterval }, "system");
  }, [
    chart.candles,
    chart.chartType,
    chart.rightOffset,
    chart.symbol,
    chart.visibleCount,
    dispatchDocumentCommand,
    document.timeframe
  ]);

  const loadOlderCandles = useCallback((
    symbol: string,
    interval: ChartInterval,
    before: string,
    limit: number,
    requestedViewport?: ChartViewport
  ) => {
    const requestKey = olderRangeRequestKey(symbol, interval, before, limit);
    if (olderRangeRequestsRef.current.has(requestKey)) {
      return;
    }
    if (!shouldRequestOlderRange(olderRangeRetryAfterRef.current.get(requestKey))) {
      return;
    }
    olderRangeRequestsRef.current.add(requestKey);
    const controller = new AbortController();
    fetchCandles({
      symbol,
      interval: candleSourceInterval(interval),
      before,
      limit,
      ma: candleMovingAverageWindows
    }, controller.signal)
      .then((response) => {
        const current = chartRef.current;
        if (current.symbol !== symbol || current.interval !== interval) {
          return;
        }
        const merged = mergeCandlesByTimestamp(response.candles, current.candles);
        const addedCount = Math.max(0, merged.length - current.candles.length);
        const retryAfter = olderRangeRetryAfterMs(response, addedCount);
        if (retryAfter === null) {
          olderRangeRetryAfterRef.current.delete(requestKey);
        } else {
          olderRangeRetryAfterRef.current.set(requestKey, retryAfter);
        }
        if (addedCount === 0) {
          return;
        }
        const plotWidth = sceneRef.current ? sceneRef.current.plot.right - sceneRef.current.plot.left : undefined;
        const currentViewport = { visibleCount: current.visibleCount, rightOffset: current.rightOffset };
        const nextViewport = viewportAfterOlderCandlesLoaded(
          current.candles,
          merged,
          requestedViewport,
          currentViewport,
          plotWidth,
          { minimumVisibleSlots: Math.max(current.visibleCount, requestedVisibleSlotsFromResponse(response, interval)) }
        );
        onChartRuntimeAction({ kind: "chart.snapshot.loaded", snapshot: candleSnapshotFromResponse(response, interval) });
        dispatchDocumentCommand("chart.viewport.set", nextViewport, "system", "external");
      })
      .catch(() => {
        olderRangeRetryAfterRef.current.set(requestKey, Date.now() + olderRangeQueuedRetryDelayMs);
      })
      .finally(() => {
        olderRangeRequestsRef.current.delete(requestKey);
      });
  }, [dispatchDocumentCommand, onChartRuntimeAction]);

  useEffect(() => {
    const oldest = chart.candles[0]?.timestamp;
    if (!oldest || chart.hasMoreBefore === false) {
      return;
    }
    const currentScene = sceneRef.current;
    const matchingScene = currentScene?.chart.symbol === chart.symbol && currentScene.chart.interval === chart.interval
      ? currentScene
      : null;
    const plotWidth = matchingScene ? matchingScene.plot.right - matchingScene.plot.left : undefined;
    const visibleViewport = normalizeViewport(
      { visibleCount: chart.visibleCount, rightOffset: chart.rightOffset },
      chart.candles.length,
      plotWidth,
      viewportClampOptionsForChart(chart, matchingScene, commentaryExtraFutureSlotsRef.current)
    );
    if (!viewportNeedsOlderCandles(visibleViewport, chart.candles.length)) {
      return;
    }
    loadOlderCandles(
      chart.symbol,
      chart.interval,
      oldest,
      Math.max(defaultVisibleBarsForInterval(chart.interval), visibleViewport.visibleCount),
      visibleViewport
    );
  }, [
    chart.candles,
    chart.hasMoreBefore,
    chart.interval,
    chart.rightOffset,
    chart.symbol,
    chart.visibleCount,
    loadOlderCandles
  ]);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const requestedSymbol = chart.symbol;
    const requestedInterval = chart.interval;
    const requestedSourceInterval = candleSourceInterval(requestedInterval);
    const requestKey = chartMemoryKey(requestedSymbol, requestedInterval);
    const loadGeneration = candleLoadGenerationRef.current + 1;
    candleLoadGenerationRef.current = loadGeneration;
    loadedCandleSnapshotRef.current = null;
    const pendingLoad = pendingViewportAnchorRef.current?.key === requestKey ? pendingViewportAnchorRef.current : null;
    onChartRuntimeAction({
      kind: "chart.data.status",
      symbol: requestedSymbol,
      interval: requestedInterval,
      status: { state: "loading", message: "Loading CDC candles..." }
    });
    setPreviousClose(null);
    const applyResponse = (response: CandleQueryResponseDto) => {
      if (controller.signal.aborted) {
        return;
      }
      const current = chartRef.current;
      if (current.symbol !== requestedSymbol || current.interval !== requestedInterval) {
        return;
      }
      const merged = mergeCandlesByTimestamp(response.candles, current.candles);
      const latestClosed = latestClosedTimestamp(merged);
      loadedCandleSnapshotRef.current = latestClosed ? {
        requestKey,
        generation: loadGeneration,
        latestClosedTimestamp: latestClosed
      } : null;
      const nextViewport = viewportAfterSnapshotCandlesChange(
        current.candles,
        merged,
        current.interval,
        {
          visibleCount: current.visibleCount,
          rightOffset: current.rightOffset
        },
        pendingLoad?.anchor ?? null,
        sceneRef.current ? sceneRef.current.plot.right - sceneRef.current.plot.left : undefined,
        { minimumVisibleSlots: requestedVisibleSlotsFromResponse(response, current.interval) }
      );
      onChartRuntimeAction({ kind: "chart.snapshot.loaded", snapshot: candleSnapshotFromResponse(response, requestedInterval) });
      setPreviousClose(typeof response.previousClose === "number" && Number.isFinite(response.previousClose) ? response.previousClose : null);
      dispatchDocumentCommand("chart.viewport.set", nextViewport, "system", "external");
      if (pendingViewportAnchorRef.current?.key === requestKey) {
        pendingViewportAnchorRef.current = null;
      }
    };
    const loadCandles = (attempt: number) => {
      fetchCandles({
        symbol: requestedSymbol,
        interval: requestedSourceInterval,
        limit: defaultVisibleBarsForInterval(requestedInterval),
        ma: candleMovingAverageWindows,
        includePreviousClose: true
      }, controller.signal)
        .then((response) => {
          applyResponse(response);
          if (!controller.signal.aborted && shouldRetryRealtimeSnapshot(response, requestedInterval, attempt)) {
            retryTimer = window.setTimeout(() => loadCandles(attempt + 1), realtimeSnapshotRetryDelayMs);
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          onChartRuntimeAction({
            kind: "chart.snapshot.failed",
            symbol: requestedSymbol,
            interval: requestedInterval,
            message: error instanceof Error ? error.message : "Candle request failed"
          });
        });
    };
    const warmAndLoad = async () => {
      const activeSymbol = requestedSymbol.trim().toUpperCase();
      if (activeSymbol && isRealtimeStreamInterval(requestedInterval)) {
        try {
          await refreshActiveChartSymbol({
            symbol: activeSymbol,
            sessionId: activeChartSessionIdRef.current,
            ttlSeconds: 45
          }, controller.signal);
        } catch {
          // Snapshot loading can still proceed; the steady heartbeat effect retries.
        }
      }
      if (!controller.signal.aborted) {
        loadCandles(0);
      }
    };
    void warmAndLoad();
    return () => {
      controller.abort();
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [chart.interval, chart.symbol, dispatchDocumentCommand, onChartRuntimeAction]);

  useEffect(() => {
    const activeSymbol = chart.symbol.trim().toUpperCase();
    if (!activeSymbol) {
      return undefined;
    }
    let stopped = false;
    let controller: AbortController | null = null;
    const refresh = () => {
      if (stopped) {
        return;
      }
      controller?.abort();
      controller = new AbortController();
      refreshActiveChartSymbol({
        symbol: activeSymbol,
        sessionId: activeChartSessionIdRef.current,
        ttlSeconds: 45
      }, controller.signal).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [chart.symbol]);

  useEffect(() => {
    const socketSymbol = chart.symbol.trim().toUpperCase();
    if (!socketSymbol || !isRealtimeStreamInterval(chart.interval)) {
      onChartRuntimeAction({
        kind: "chart.stream.status",
        symbol: chart.symbol,
        interval: chart.interval,
        status: "idle"
      });
      return undefined;
    }
    return openChartSocket(
      socketSymbol,
      candleSourceInterval(chart.interval),
      (event) => {
        if (isOrderFlowEventDto(event)) {
          if (chartRef.current.chartType === "bidask" && chartRef.current.symbol === event.symbol.toUpperCase()) {
            const previousSessionDate = orderFlowTodaySessionDateRef.current;
            orderFlowTodaySessionDateRef.current = event.data.sessionDate;
            setOrderFlowTodaySessionDate(event.data.sessionDate);
            setOrderFlowDataStatus("ready");
            setOrderFlowPriceBinSize(normalizeOrderFlowPriceBinSize(event.data.priceBinSize));
            setOrderFlowToday((current) => replaceOrderFlowMinute(current, event.data, previousSessionDate));
          }
          return;
        }
        if (isRealtimeLayerEventDto(event)) {
          onChartRuntimeAction({ kind: "chart.layer.live", event: normalizeRealtimeLayerEvent(event) });
          return;
        }
        onChartRuntimeAction({ kind: "chart.live", event: candleEventFromDto(event, chart.interval) });
      },
      (nextStreamState) => {
        if (orderFlowActive && nextStreamState === "error") {
          setOrderFlowDataStatus("error");
        }
        onChartRuntimeAction({
          kind: "chart.stream.status",
          symbol: socketSymbol,
          interval: chart.interval,
          status: normalizeStreamStatus(nextStreamState)
        });
      },
      { orderFlow: orderFlowActive }
    );
  }, [chart.interval, chart.symbol, onChartRuntimeAction, orderFlowActive]);

  useEffect(() => {
    if (!comparisonScopeRequests.length) {
      setComparisonScopeData({});
      return;
    }
    const activeKeys = new Set(comparisonScopeRequests.map((request) => request.key));
    setComparisonScopeData((current) => {
      const next: Record<string, ComparisonScopeData> = {};
      for (const request of comparisonScopeRequests) {
        next[request.key] = current[request.key] ?? {
          key: request.key,
          interval: request.interval,
          from: request.from,
          to: request.to,
          parentExpansionId: request.parentExpansionId,
          candles: [],
          status: "loading"
        };
      }
      Object.entries(current).forEach(([key, value]) => {
        if (activeKeys.has(key) && !next[key]) {
          next[key] = value;
        }
      });
      return next;
    });

    const controller = new AbortController();
    comparisonScopeRequests.forEach((request) => {
      fetchCandles({
        symbol: request.symbol,
        interval: request.interval,
        from: request.from,
        to: request.to,
        limit: request.limit,
        ma: candleMovingAverageWindows
      }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) {
            return;
          }
          setComparisonScopeData((current) => ({
            ...current,
            [request.key]: {
              key: request.key,
              interval: request.interval,
              from: request.from,
              to: request.to,
              parentExpansionId: request.parentExpansionId,
              candles: response.candles,
              status: comparisonStatusForCandleResponse(response),
              message: response.error?.message ?? response.message ?? fillTraceMessage(response.fill)
            }
          }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setComparisonScopeData((current) => ({
            ...current,
            [request.key]: {
              key: request.key,
              interval: request.interval,
              from: request.from,
              to: request.to,
              parentExpansionId: request.parentExpansionId,
              candles: [],
              status: "error",
              message: error instanceof Error ? error.message : "Comparison candle request failed"
            }
          }));
        });
    });
    return () => controller.abort();
  }, [comparisonScopeRequestKey]);

  useEffect(() => {
    if (!baseIndicatorRequest) {
      setBaseIndicatorSeries({});
      setBaseIndicatorRequestStatus("idle");
      return;
    }
    const controller = new AbortController();
    setBaseIndicatorRequestStatus("loading");
    fetchIndicators({
      symbol: baseIndicatorRequest.symbol,
      interval: baseIndicatorRequest.interval,
      from: baseIndicatorRequest.from,
      to: baseIndicatorRequest.to,
      limit: baseIndicatorRequest.limit,
      layers: baseIndicatorRequest.layers
    }, controller.signal)
      .then((response) => {
        if (chartRef.current.symbol !== baseIndicatorRequest.symbol || chartRef.current.interval !== chart.interval) {
          return;
        }
        if (response.derived?.state === "failed") {
          setBaseIndicatorSeries({});
          setBaseIndicatorRequestStatus("error");
          return;
        }
        setBaseIndicatorSeries(response.series);
        setBaseIndicatorRequestStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBaseIndicatorSeries({});
          setBaseIndicatorRequestStatus("error");
        }
      });
    return () => {
      controller.abort();
    };
  }, [baseIndicatorRequest?.key]);

  useEffect(() => {
    if (!activeIndicatorLayers.length) {
      setExpansionIndicatorSeries({});
      return;
    }
    const requests = activeExpansions
      .filter((expansion) => expansion.status === "ready" && expansion.candles.length > 0)
      .map((expansion) => {
        const first = expansion.candles[0];
        const last = expansion.candles[expansion.candles.length - 1];
        return first && last
          ? {
              id: expansion.id,
              interval: expansion.childInterval,
              from: first.timestamp,
              to: last.timestamp,
              candleCount: expansion.candles.length
            }
          : null;
      })
      .filter((request): request is { id: string; interval: ChartInterval; from: string; to: string; candleCount: number } => Boolean(request));
    if (!requests.length) {
      setExpansionIndicatorSeries({});
      return;
    }
    const controller = new AbortController();
    Promise.allSettled(requests.map((request) => (
      fetchIndicators({
        symbol: chart.symbol,
        interval: request.interval,
        from: request.from,
        to: request.to,
        limit: indicatorRequestLimitForInterval(request.interval, request.candleCount),
        layers: activeIndicatorLayers
      }, controller.signal).then((response) => ({ request, response }))
    )))
      .then((results) => {
        if (controller.signal.aborted || chartRef.current.symbol !== chart.symbol || chartRef.current.interval !== chart.interval) {
          return;
        }
        const fulfilled = results
          .filter((result): result is PromiseFulfilledResult<{
            request: { id: string; interval: ChartInterval; from: string; to: string; candleCount: number };
            response: Awaited<ReturnType<typeof fetchIndicators>>;
          }> => result.status === "fulfilled")
          .map((result) => result.value);
        setExpansionIndicatorSeries(mergeIndicatorSeries(
          ...fulfilled
            .filter(({ response }) => response.derived?.state !== "failed")
            .map(({ request, response }) => scopeIndicatorSeries(request.interval, response.series))
        ));
      });
    return () => {
      controller.abort();
    };
  }, [
    activeExpansions,
    activeIndicatorLayers,
    chart.interval,
    chart.symbol,
  ]);

  useEffect(() => {
    if (orderFlowActive) {
      setVolumeProfile(null);
      setVolumeProfileRuntimeStatus("unavailable");
      return;
    }
    if (!chart.layers["volume-profile"]) {
      setVolumeProfile(null);
      setVolumeProfileRuntimeStatus("off");
      return;
    }
    if (!volumeProfileRequest) {
      setVolumeProfile(null);
      setVolumeProfileRuntimeStatus("loading");
      return;
    }
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const requestProfile = (retryIndex: number) => {
      fetchVolumeProfile({
        ...volumeProfileRequest,
        priceBinSize: "auto"
      }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted || chartRef.current.symbol !== chart.symbol || chartRef.current.interval !== chart.interval) {
            return;
          }
          if (response.dataStatus === "partial") {
            setVolumeProfile(null);
            const delay = volumeProfilePartialRetryDelaysMs[retryIndex];
            if (delay !== undefined) {
              retryTimer = window.setTimeout(() => requestProfile(retryIndex + 1), delay);
            } else {
              setVolumeProfileRuntimeStatus("empty");
            }
            return;
          }
          if (response.dataStatus === "failed") {
            setVolumeProfile(null);
            setVolumeProfileRuntimeStatus("error");
            return;
          }
          if (response.dataStatus === "empty" || response.totalVolume <= 0 || !response.bins.length) {
            setVolumeProfile(null);
            setVolumeProfileRuntimeStatus("empty");
            return;
          }
          if (!volumeProfileResponseMatchesRequest(response, volumeProfileRequest)) {
            setVolumeProfile(null);
            setVolumeProfileRuntimeStatus("error");
            return;
          }
          setVolumeProfile(response);
          setVolumeProfileRuntimeStatus("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setVolumeProfile(null);
            setVolumeProfileRuntimeStatus("error");
          }
        });
    };
    setVolumeProfile(null);
    setVolumeProfileRuntimeStatus("loading");
    const timer = window.setTimeout(() => requestProfile(0), 120);
    return () => {
      window.clearTimeout(timer);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      controller.abort();
    };
  }, [
    chart.interval,
    chart.layers["volume-profile"],
    chart.symbol,
    orderFlowActive,
    volumeProfileRequestKey,
  ]);

  useEffect(() => {
    if (!orderFlowActive) {
      setOrderFlowToday(new Map());
      setOrderFlowTodaySessionDate(null);
      orderFlowTodaySessionDateRef.current = null;
      setOrderFlowDataStatus("empty");
      setOrderFlowSupportedSymbols(undefined);
      setOrderFlowPriceBinSize(defaultOrderFlowPriceBinSize);
      return;
    }
    const controller = new AbortController();
    setOrderFlowDataStatus("loading");
    const handleOrderFlowEvent = (event: CandleEventDto) => {
      if (event.type !== "ORDER_FLOW_BINS_UPDATE" || event.symbol.toUpperCase() !== chart.symbol) {
        return;
      }
      const previousSessionDate = orderFlowTodaySessionDateRef.current;
      orderFlowTodaySessionDateRef.current = event.data.sessionDate;
      setOrderFlowTodaySessionDate(event.data.sessionDate);
      setOrderFlowDataStatus("ready");
      setOrderFlowPriceBinSize(normalizeOrderFlowPriceBinSize(event.data.priceBinSize));
      setOrderFlowToday((current) => replaceOrderFlowMinute(current, event.data, previousSessionDate));
    };
    fetchOrderFlowIntraday(chart.symbol, controller.signal, orderFlowDemoAnchor)
      .then((response) => {
        if (
          controller.signal.aborted ||
          chartRef.current.symbol !== chart.symbol
        ) {
          return;
        }
        orderFlowTodaySessionDateRef.current = response.sessionDate;
        setOrderFlowTodaySessionDate(response.sessionDate);
        setOrderFlowDataStatus(response.dataStatus);
        setOrderFlowSupportedSymbols(response.supportedSymbols);
        setOrderFlowPriceBinSize(normalizeOrderFlowPriceBinSize(response.priceBinSize));
        setOrderFlowToday(new Map(response.minutes.map((minute) => [minute.eventMinute, minute])));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOrderFlowToday(new Map());
          setOrderFlowTodaySessionDate(null);
          orderFlowTodaySessionDateRef.current = null;
          setOrderFlowDataStatus("error");
          setOrderFlowSupportedSymbols(undefined);
          setOrderFlowPriceBinSize(defaultOrderFlowPriceBinSize);
        }
      });
    const demoCleanup = subscribeOrderFlowDemoTicks(
      chart.symbol,
      handleOrderFlowEvent,
      () => undefined,
      orderFlowDemoAnchor
    );
    return () => {
      controller.abort();
      demoCleanup?.();
    };
  }, [
    chart.symbol,
    orderFlowActive,
    orderFlowDemoAnchor?.basePrice,
    orderFlowDemoAnchor?.sessionDate
  ]);

  useEffect(() => {
    onSemanticSelectionChange?.(selectedSemanticNode ? {
      ...selectedSemanticNode,
      chartDocumentId: document.id,
      sourcePanelId: panelId
    } : null);
  }, [document.id, onSemanticSelectionChange, panelId, selectedSemanticNode]);

  useEffect(() => {
    if (typeof laneHeight !== "number") {
      return;
    }
    const capacity = maxBelowPaneCountForHeight(laneHeight);
    if (activeBelowPaneOrder.length > capacity) {
      const paneId = activeBelowPaneOrder[activeBelowPaneOrder.length - 1];
      const layer = belowLayerForPaneId(paneId);
      if (layer) {
        dispatchDocumentCommand("chart.layer.visibility.set", { layer, visible: false });
      }
    }
  }, [activeBelowPaneOrder, dispatchDocumentCommand, laneHeight]);

  const renderComparisons = useMemo(() => (
    chart.comparisons.map((comparison) => {
      const scopes = comparisonScopeRequests
        .filter((request) => request.symbol === comparison.symbol)
        .map((request): ChartComparisonCandleScope => comparisonScopeData[request.key] ?? {
          key: request.key,
          interval: request.interval,
          from: request.from,
          to: request.to,
          parentExpansionId: request.parentExpansionId,
          candles: [],
          status: "loading"
        });
      const candlesForComparison = mergeCandlesByTimestamp(...scopes.map((scope) => scope.candles));
      return {
        ...comparison,
        candles: candlesForComparison,
        scopes,
        interval: chart.interval,
        status: comparisonStatusFromScopes(scopes),
        message: comparisonMessageFromScopes(scopes)
      };
    })
  ), [chart.comparisons, chart.interval, comparisonScopeData, comparisonScopeRequests]);
  const renderChart = useMemo(() => ({
    ...chart,
    holdingOverlay,
    indicatorSeries,
    volumeProfile,
    orderFlow: orderFlowActive ? {
      dataStatus: orderFlowDataStatus,
      supportedSymbols: orderFlowSupportedSymbols,
      priceBinSize: orderFlowPriceBinSize,
      sessionDate: orderFlowTodaySessionDate,
      minutes: orderFlowToday
    } : null,
    comparisons: renderComparisons,
    visibleCount: transientViewport?.visibleCount ?? chart.visibleCount,
    rightOffset: transientViewport?.rightOffset ?? chart.rightOffset,
    volumeRatio: transientPaneRatios?.["volume"] ?? chart.volumeRatio,
    panes: chart.panes?.map((pane) => ({
      ...pane,
      heightRatio: transientPaneRatios?.[pane.id] ?? pane.heightRatio
    })) ?? [],
    drawings: transientDrawings ?? chart.drawings
  }), [chart, holdingOverlay, indicatorSeries, orderFlowActive, orderFlowDataStatus, orderFlowPriceBinSize, orderFlowSupportedSymbols, orderFlowToday, orderFlowTodaySessionDate, renderComparisons, transientDrawings, transientViewport, transientPaneRatios, volumeProfile]);
  const renderExpansions = activeExpansions;
  const previewDrawings = useMemo<DrawingEntity[]>(() => [], []);
  const currentPriceTimeText = useMemo(() => (
    currentPriceMarker ? currentPriceMarkerTimeText(currentPriceMarker, currentPriceClock) : null
  ), [currentPriceClock, currentPriceMarker]);
  const currentSymbol = symbols.find((symbol) => symbol.symbol === chart.symbol) ?? {
    symbol: chart.symbol,
    name: chart.symbol,
    sector: undefined,
    isMock: false
  };
  const liveQuote = useMemo(() => buildLiveQuote(chart, previousClose), [chart, previousClose]);
  const currentSymbolLabel = `${currentSymbol.symbol} - ${currentSymbol.name}`;

  useEffect(() => {
    onHeaderChange?.({
      symbol: currentSymbol.symbol,
      interval: chart.interval,
      name: currentSymbol.name,
      searchLabel: currentSymbolLabel,
      liveQuote
    });
  }, [
    chart.interval,
    currentSymbol.name,
    currentSymbol.symbol,
    currentSymbolLabel,
    liveQuote,
    onHeaderChange
  ]);

  const clearSemanticState = useCallback(() => {
    setHoveredSemanticUnit(null);
    setSelectedSemanticNode(null);
    setExpansionOverlays([]);
  }, [setHoveredSemanticUnit]);

  useEffect(() => {
    activeExpansionsRef.current = [];
    olderRangeRequestsRef.current.clear();
    olderRangeRetryAfterRef.current.clear();
    setActiveExpansions([]);
    pendingViewportAnchorRef.current = null;
    setDrawingDraft(null);
    setDrawingDraftError(null);
    setTransientDrawings(null);
    setBaseIndicatorSeries({});
    setBaseIndicatorRequestStatus("idle");
    setVolumeProfile(null);
    setVolumeProfileRuntimeStatus("off");
    setExpansionIndicatorSeries({});
    setComparisonScopeData({});
    clearSemanticState();
  }, [chart.interval, chart.symbol, clearSemanticState]);

  useEffect(() => {
    setOrderFlowToday(new Map());
    setOrderFlowTodaySessionDate(null);
    setOrderFlowDataStatus("empty");
    setOrderFlowSupportedSymbols(undefined);
    setOrderFlowPriceBinSize(defaultOrderFlowPriceBinSize);
  }, [chart.symbol]);

  const semanticSelectionEnabled = chart.chartType !== "line";
  const semanticDigEnabled = semanticSelectionEnabled && chart.chartType !== "bidask";
  const previousChartTypeRef = useRef(chart.chartType);

  useEffect(() => {
    const activeCandleKey = selectedSemanticNode?.kind === "candle"
      && selectedSemanticNode.depth === 0
      && selectedSemanticNode.interval === chart.interval
      && selectedSemanticNode.timestamp
      && isAnalysisAssetInterval(chart.interval)
      ? candleKeyForTimestamp(selectedSemanticNode.timestamp, chart.interval)
      : null;
    updateChartCommentaryInteraction(document.id, {
      activeCandleKey,
      candleSelectionAvailable: semanticSelectionEnabled
    });
  }, [chart.interval, document.id, selectedSemanticNode, semanticSelectionEnabled]);

  useEffect(() => {
    const previousChartType = previousChartTypeRef.current;
    previousChartTypeRef.current = chart.chartType;
    if (chart.chartType === "bidask" && previousChartType !== "bidask") {
      setSelectedSemanticNode(null);
    }
  }, [chart.chartType]);

  useEffect(() => {
    if (semanticDigEnabled) {
      return;
    }
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    pendingSemanticClickRef.current = null;
    setExpansionOverlays([]);
    if (!semanticSelectionEnabled) {
      setSelectedSemanticNode(null);
    }
  }, [semanticDigEnabled, semanticSelectionEnabled]);

  const setInterval = useCallback((interval: ChartInterval) => {
    const current = chartRef.current;
    const nextInterval = current.chartType === "bidask" ? normalizeBidAskChartInterval(interval) : interval;
    if (current.interval === nextInterval) {
      return;
    }
    const nextVisibleCount = current.chartType === "bidask"
      ? defaultVisibleBarsForBidAskInterval(nextInterval)
      : defaultVisibleBarsForInterval(nextInterval);
    const followsLatest = current.rightOffset <= 0;
    pendingViewportAnchorRef.current = {
      key: chartMemoryKey(current.symbol, nextInterval),
      anchor: {
        mode: followsLatest ? "latest" : "right",
        timestamp: followsLatest ? undefined : visibleRightAnchorTimestamp(sceneRef.current, current),
        visibleCount: nextVisibleCount
      }
    };
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    clearSemanticState();
    dispatchExternalCommandGroup(
      analysisAssetRemovalCommands(commandTarget, current.drawings),
      "Clear chart analysis asset for interval change"
    );
    appliedAnalysisAssetKeyRef.current = "";
    dispatchDocumentCommand("chart.timeframe.set", { timeframe: nextInterval });
  }, [clearSemanticState, commandTarget, dispatchDocumentCommand, dispatchExternalCommandGroup]);

  const setChartType = useCallback((chartType: ChartType) => {
    const current = chartRef.current;
    if (current.chartType === chartType) {
      return;
    }
    if (chartType === "bidask") {
      const nextInterval = isBidAskChartInterval(current.interval) ? current.interval : defaultBidAskInterval;
      const nextVisibleCount = defaultVisibleBarsForBidAskInterval(nextInterval);
      if (current.interval !== nextInterval) {
        const followsLatest = current.rightOffset <= 0;
        pendingViewportAnchorRef.current = {
          key: chartMemoryKey(current.symbol, nextInterval),
          anchor: {
            mode: followsLatest ? "latest" : "right",
            timestamp: followsLatest ? undefined : visibleRightAnchorTimestamp(sceneRef.current, current),
            visibleCount: nextVisibleCount
          }
        };
        dispatchDocumentCommand("chart.timeframe.set", { timeframe: nextInterval });
      } else if (current.visibleCount > nextVisibleCount) {
        const currentScene = sceneRef.current;
        const plotWidth = currentScene ? currentScene.plot.right - currentScene.plot.left : undefined;
        dispatchDocumentCommand("chart.viewport.set", normalizeViewport(
          {
            visibleCount: nextVisibleCount,
            rightOffset: latestCandleRightOffset(nextVisibleCount)
          },
          current.candles.length,
          plotWidth,
          viewportClampOptionsForChart(current, currentScene, commentaryExtraFutureSlotsRef.current)
        ));
      }
    }
    if (chartType === "line") {
      activeExpansionsRef.current = [];
      setActiveExpansions([]);
      pendingSemanticClickRef.current = null;
      setSelectedSemanticNode(null);
      setExpansionOverlays([]);
    }
    dispatchDocumentCommand("chart.type.set", { chartType });
  }, [dispatchDocumentCommand]);

  const applyViewport = useCallback((viewport: ChartViewport, historyScope?: ChartCommandHistoryScope) => {
    const currentChart = chartRef.current;
    const currentScene = sceneRef.current;
    const plotWidth = currentScene ? currentScene.plot.right - currentScene.plot.left : undefined;
    const clampOptions = viewportClampOptionsForChart(
      currentChart,
      currentScene,
      commentaryExtraFutureSlotsRef.current
    );
    const requestedViewport = normalizeViewport(viewport, currentChart.candles.length, plotWidth, clampOptions);
    const nextViewport = requestedViewport;
    if (nextViewport.visibleCount === currentChart.visibleCount && nextViewport.rightOffset === currentChart.rightOffset) {
      return;
    }
    dispatchDocumentCommand("chart.viewport.set", nextViewport, "user", historyScope);
  }, [dispatchDocumentCommand]);

  useEffect(() => {
    const moveToLogicalIndex = (index: number) => {
      const current = chartRef.current;
      const scene = sceneRef.current;
      const plotWidth = scene ? scene.plot.right - scene.plot.left : undefined;
      const nextViewport = viewportCenteredOnLogicalIndex(
        current.candles.length,
        index,
        { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
        plotWidth,
        viewportClampOptionsForChart(current, scene, commentaryExtraFutureSlotsRef.current)
      );
      const changed = nextViewport.visibleCount !== current.visibleCount
        || Math.abs(nextViewport.rightOffset - current.rightOffset) > 0.0001;
      if (changed) applyViewport(nextViewport, "external");
      return changed;
    };
    const handleIndicatorToggle = (event: Event) => {
      const detail = (event as CustomEvent<ChartCommentaryIndicatorToggleRequest>).detail;
      if (detail?.chartDocumentId !== document.id) return;
      const current = chartRef.current;
      const visible = !Boolean(current.layers[detail.layer]);
      if (visible && commentaryIndicatorStatuses[detail.layer] === "unavailable") return;
      dispatchDocumentCommand("chart.layer.visibility.set", { layer: detail.layer, visible });
    };
    const handleReferenceOpen = (event: Event) => {
      const detail = (event as CustomEvent<ChartCommentaryReferenceOpenRequest>).detail;
      if (detail?.chartDocumentId !== document.id || !detail.reference) return;
      const reference = detail.reference;
      const current = chartRef.current;
      if (reference.type !== "candle" && selectedCommentaryEventIdRef.current === reference.eventId) {
        pendingCommentaryNavigationRef.current = null;
        setCommentaryEventOpenRequest((previous) => ({
          eventId: reference.eventId,
          revision: (previous?.revision ?? 0) + 1
        }));
        return;
      }
      if (reference.type === "earnings" && reference.eventId.endsWith(":upcoming")) {
        if (current.layers["events:earnings"] === false) {
          dispatchDocumentCommand("chart.layer.visibility.set", { layer: "events:earnings", visible: true });
        }
        if (current.interval === "1D") {
          const targetLogicalIndex = upcomingDailyEventLogicalIndex(current.candles, reference.eventAt);
          if (targetLogicalIndex !== null) {
            const desiredRightOffset = current.candles.length
              - targetLogicalIndex
              - 0.5
              - current.visibleCount / 2;
            const extraFutureSlots = Math.max(
              0,
              Math.ceil(-desiredRightOffset) - futureEmptySlotCount(current.visibleCount)
            );
            if (extraFutureSlots > commentaryExtraFutureSlotsRef.current) {
              commentaryExtraFutureSlotsRef.current = extraFutureSlots;
              setCommentaryExtraFutureSlots(extraFutureSlots);
            }
            pendingCommentaryNavigationRef.current = {
              kind: "upcoming",
              eventId: reference.eventId,
              targetLogicalIndex,
              attempts: 0
            };
            if (moveToLogicalIndex(targetLogicalIndex)) return;
          }
        }
        pendingCommentaryNavigationRef.current = null;
        setCommentaryEventOpenRequest((previous) => ({
          eventId: reference.eventId,
          revision: (previous?.revision ?? 0) + 1,
          anchor: commentaryPlotCenterAnchor(sceneRef.current, chartWrapRef.current)
        }));
        return;
      }
      const index = commentaryReferenceCandleIndex(
        reference,
        current.candles,
        current.interval,
        chartEventsRef.current
      );
      if (index < 0) return;
      if (reference.type === "candle") {
        if (!isAnalysisAssetInterval(current.interval)) return;
        const expectedCandleKey = reference.candleKey ?? candleKeyForTimestamp(reference.timestamp, current.interval);
        const selected = selectedSemanticNodeRef.current;
        const selectedCandleKey = selected?.kind === "candle"
          && selected.depth === 0
          && selected.interval === current.interval
          && selected.timestamp
          ? candleKeyForTimestamp(selected.timestamp, current.interval)
          : null;
        if (expectedCandleKey && expectedCandleKey === selectedCandleKey) {
          pendingCommentaryNavigationRef.current = null;
          setSelectedSemanticNode(null);
          return;
        }
        pendingCommentaryNavigationRef.current = {
          kind: "candle",
          timestamp: reference.timestamp,
          attempts: 0,
          ...(reference.candleKey ? { candleKey: reference.candleKey } : {})
        };
        if (!moveToLogicalIndex(index)) {
          const unit = commentarySemanticCandle(sceneRef.current, reference.timestamp, reference.candleKey, current.interval);
          if (!unit) return;
          setSelectedSemanticNode(snapshotFromSemanticUnit(unit));
          pendingCommentaryNavigationRef.current = null;
        }
        return;
      }
      const layer: ChartLayerKey = reference.type === "news" ? "events:news" : "events:earnings";
      if (current.layers[layer] === false) {
        dispatchDocumentCommand("chart.layer.visibility.set", { layer, visible: true });
      }
      pendingCommentaryNavigationRef.current = { kind: "event", eventId: reference.eventId, attempts: 0 };
      if (!moveToLogicalIndex(index)) {
        pendingCommentaryNavigationRef.current = null;
        setCommentaryEventOpenRequest((previous) => ({
          eventId: reference.eventId,
          revision: (previous?.revision ?? 0) + 1
        }));
      }
    };
    window.addEventListener(chartCommentaryIndicatorToggleEventName, handleIndicatorToggle);
    window.addEventListener(chartCommentaryReferenceOpenEventName, handleReferenceOpen);
    return () => {
      window.removeEventListener(chartCommentaryIndicatorToggleEventName, handleIndicatorToggle);
      window.removeEventListener(chartCommentaryReferenceOpenEventName, handleReferenceOpen);
    };
  }, [applyViewport, commentaryIndicatorStatuses, dispatchDocumentCommand, document.id]);

  useEffect(() => {
    proposalAutoFrameKeyRef.current = "";
  }, [
    chart.interval,
    chart.symbol,
    chartTradeSetupSnapshot?.assetIdentity.algorithmVersion,
    chartTradeSetupSnapshot?.assetIdentity.asOf,
    chartTradeSetupSnapshot?.assetIdentity.inputDigest,
    chartTradeSetupSnapshot?.setup.drawingIds.plan,
    document.id
  ]);

  useEffect(() => {
    pendingCommentaryNavigationRef.current = null;
    commentaryExtraFutureSlotsRef.current = 0;
    setCommentaryExtraFutureSlots(0);
    setCommentaryEventOpenRequest(null);
    updateChartCommentaryInteraction(document.id, { activeEventId: null });
  }, [chart.interval, chart.symbol, document.id]);

  const handleCommentaryEventSelectionChange = useCallback((eventId: string | null) => {
    selectedCommentaryEventIdRef.current = eventId;
    updateChartCommentaryInteraction(document.id, { activeEventId: eventId });
  }, [document.id]);

  useEffect(() => {
    const proposalDrawing = chartTradeSetupSnapshot
      ? chart.drawings.find((drawing) => (
        drawing.id === chartTradeSetupSnapshot.setup.drawingIds.plan
        && drawing.style.zoneSplit === true
      ))
      : undefined;
    if (!proposalDrawing || !chartTradeSetupSnapshot) return;
    const proposalDisplayed = analysisLayerVisibility.proposal
      || effectiveSpotlightDrawingIds.includes(proposalDrawing.id);
    if (!proposalDisplayed || chart.rightOffset > 0) return;
    const autoFrameKey = [
      document.id,
      chartTradeSetupSnapshot.assetIdentity.algorithmVersion,
      chartTradeSetupSnapshot.assetIdentity.inputDigest,
      chartTradeSetupSnapshot.assetIdentity.asOf,
      proposalDrawing.id
    ].join("|");
    if (proposalAutoFrameKeyRef.current === autoFrameKey) return;
    const lastCandleIndex = chart.candles.length - 1;
    const anchorProjectionBars = proposalDrawing.anchors
      .map((anchor) => anchor.logicalIndex)
      .filter((logicalIndex): logicalIndex is number => typeof logicalIndex === "number" && Number.isFinite(logicalIndex))
      .reduce((maximum, logicalIndex) => Math.max(maximum, logicalIndex - lastCandleIndex), 0);
    const projectionBars = Math.max(chartTradeSetupSnapshot.setup.projectionBars, anchorProjectionBars);
    if (projectionBars <= 0) return;
    const scene = sceneRef.current;
    const slotWidth = scene?.scales.slotWidth
      ?? Math.max(1, ((scene?.plot.right ?? chart.visibleCount) - (scene?.plot.left ?? 0)) / Math.max(1, chart.visibleCount));
    const minimumBoxSlots = Math.ceil(proposalRiskRewardMinimumWidth / Math.max(1, slotWidth));
    const labelSlots = Math.ceil(proposalPriceLabelReserveWidth / Math.max(1, slotWidth));
    const futureSlots = Math.max(projectionBars, minimumBoxSlots) + labelSlots + 2;
    proposalAutoFrameKeyRef.current = autoFrameKey;
    applyViewport({ visibleCount: chart.visibleCount, rightOffset: -futureSlots }, "external");
  }, [
    analysisLayerVisibility.proposal,
    applyViewport,
    chart.candles.length,
    chart.drawings,
    chart.rightOffset,
    chart.visibleCount,
    chartTradeSetupSnapshot,
    document.id,
    effectiveSpotlightDrawingIds
  ]);

  const handleScene = useCallback((scene: ChartScene) => {
    sceneRef.current = scene;
    const loadedCandleSnapshot = loadedCandleSnapshotRef.current;
    const sceneRequestKey = chartMemoryKey(scene.chart.symbol, scene.chart.interval);
    if (chartAnalysisAssetSceneContainsLoadedSnapshot(loadedCandleSnapshot, sceneRequestKey, scene.chart.candles)) {
      const readyTokenKey = `${loadedCandleSnapshot.requestKey}:${loadedCandleSnapshot.generation}`;
      if (analysisSceneReadyTokenRef.current !== readyTokenKey) {
        analysisSceneReadyTokenRef.current = readyTokenKey;
        setAnalysisSceneReadyToken({
          requestKey: loadedCandleSnapshot.requestKey,
          generation: loadedCandleSnapshot.generation
        });
      }
    }
    const settlePendingAtX = (targetX: number, pending: PendingCommentaryNavigation) => {
      const centerX = (scene.plot.left + scene.plot.right) / 2;
      if (Math.abs(targetX - centerX) <= 1 || pending.attempts >= 2) return true;
      const nextViewport = viewportCenteredOnSceneX(
        scene.chart.candles.length,
        { visibleCount: scene.chart.visibleCount, rightOffset: scene.chart.rightOffset },
        targetX,
        centerX,
        scene.scales.slotWidth,
        scene.plot.right - scene.plot.left,
        viewportClampOptionsForChart(scene.chart, scene, commentaryExtraFutureSlotsRef.current)
      );
      if (
        nextViewport.visibleCount === scene.chart.visibleCount
        && Math.abs(nextViewport.rightOffset - scene.chart.rightOffset) <= 0.0001
      ) return true;
      pending.attempts += 1;
      applyViewport(nextViewport, "external");
      return false;
    };
    const pendingCommentaryNavigation = pendingCommentaryNavigationRef.current;
    if (pendingCommentaryNavigation?.kind === "candle") {
      const unit = commentarySemanticCandle(
        scene,
        pendingCommentaryNavigation.timestamp,
        pendingCommentaryNavigation.candleKey,
        scene.chart.interval
      );
      if (unit && settlePendingAtX(unitBoundsX(scene, unit).center, pendingCommentaryNavigation)) {
        setSelectedSemanticNode(snapshotFromSemanticUnit(unit));
        pendingCommentaryNavigationRef.current = null;
      }
    } else if (
      pendingCommentaryNavigation?.kind === "upcoming"
      && typeof pendingCommentaryNavigation.targetLogicalIndex === "number"
    ) {
      const targetX = createCoordinateTransform(scene).logicalToX(pendingCommentaryNavigation.targetLogicalIndex);
      if (settlePendingAtX(targetX, pendingCommentaryNavigation)) {
        pendingCommentaryNavigationRef.current = null;
        setCommentaryEventOpenRequest((previous) => ({
          eventId: pendingCommentaryNavigation.eventId,
          revision: (previous?.revision ?? 0) + 1,
          anchor: commentaryPlotCenterAnchor(scene, chartWrapRef.current)
        }));
      }
    }
    const planDrawingId = chartTradeSetupSnapshot?.setup.drawingIds.plan;
    const planDrawing = planDrawingId
      ? scene.chart.drawings.find((drawing) => drawing.id === planDrawingId)
      : undefined;
    const proposalDisplayed = Boolean(planDrawingId && (
      analysisLayerVisibilityRef.current.proposal || effectiveSpotlightDrawingIds.includes(planDrawingId)
    ));
    const nextTradePlanOverlay = proposalDisplayed && planDrawing
      ? buildTradePlanOverlayLayout(scene, planDrawing, chartTradeSetupSnapshot?.setup)
      : null;
    tradePlanOverlayLayoutRef.current = nextTradePlanOverlay;
    syncTradePlanOverlayElement(tradePlanOverlayRef.current, nextTradePlanOverlay, scene, chartWrapRef.current);
    const nextTradePlanOverlayKey = tradePlanOverlayContentKey(nextTradePlanOverlay);
    if (nextTradePlanOverlayKey !== tradePlanOverlayKeyRef.current) {
      tradePlanOverlayKeyRef.current = nextTradePlanOverlayKey;
      setTradePlanOverlay(nextTradePlanOverlay);
    }
    const nextPatternBadge = buildPatternBadgeLayout(scene, activeAnalysisAsset, effectiveSpotlightDrawingIds);
    const nextPatternBadgeKey = nextPatternBadge
      ? `${nextPatternBadge.text}:${Math.round(nextPatternBadge.right)}:${Math.round(nextPatternBadge.top)}:${nextPatternBadge.drawingIds.join(",")}`
      : "none";
    if (nextPatternBadgeKey !== patternBadgeKeyRef.current) {
      patternBadgeKeyRef.current = nextPatternBadgeKey;
      setPatternBadge(nextPatternBadge);
    }
    const nextCandidateCounts = analysisTraceCandidateCounts(analysisTraceDiagnosticOverlay, scene);
    setAnalysisCandidateCounts((current) => (
      analysisCandidateCountsEqual(current, nextCandidateCounts) ? current : nextCandidateCounts
    ));
    const nextProfileSceneRange = volumeProfileSceneRangeFromScene(scene);
    setVolumeProfileSceneRange((current) => (
      volumeProfileSceneRangeEquals(current, nextProfileSceneRange) ? current : nextProfileSceneRange
    ));
    const nextPriceMarker = currentPriceMarkerFromScene(scene);
    setCurrentPriceMarker((current) => (
      currentPriceMarkerEquals(current, nextPriceMarker) ? current : nextPriceMarker
    ));
    const markerCoordinateSpace = chartWrapRef.current
      ? { width: chartWrapRef.current.clientWidth, height: chartWrapRef.current.clientHeight }
      : scene;
    const nextHoldingPriceMarker = paperHoldingPriceMarkerForScene(scene, markerCoordinateSpace);
    syncPaperHoldingPriceMarkerPosition(holdingPriceMarkerRef.current, nextHoldingPriceMarker);
    setHoldingPriceMarker((current) => (
      holdingPriceMarkerEquals(current, nextHoldingPriceMarker) ? current : nextHoldingPriceMarker
    ));
    const overlays = scene.semantic.expansionRanges.map((range): ExpansionOverlay => ({
      id: range.id,
      label: `${range.childInterval}`,
      left: expansionCloseLeft(scene, range),
      right: range.right,
      top: expansionMetadataCenterY(scene.plot.top) - expansionCloseButtonSize / 2,
      status: range.status
    }));
    const key = JSON.stringify(overlays.map((overlay) => [
      overlay.id,
      Math.round(overlay.left),
      Math.round(overlay.right),
      Math.round(overlay.top),
      overlay.status
    ]));
    if (key !== overlayKeyRef.current) {
      overlayKeyRef.current = key;
      setExpansionOverlays(overlays);
    }
    const markerScaleX = scene.width > 0 ? markerCoordinateSpace.width / scene.width : 1;
    const markerScaleY = scene.height > 0 ? markerCoordinateSpace.height / scene.height : 1;
    const nextEventMarkers = chartEventMarkersForScene(
      scene,
      chartEvents,
      {
        earnings: earningsEventsVisible,
        news: newsEventsVisible
      },
      markerCoordinateSpace
    );
    syncChartEventMarkerPositions(chartWrapRef.current, nextEventMarkers);
    const nextEventMarkerKey = chartEventMarkerLayoutKey(nextEventMarkers);
    if (nextEventMarkerKey !== chartEventMarkerKeyRef.current) {
      chartEventMarkerKeyRef.current = nextEventMarkerKey;
      setChartEventMarkers(nextEventMarkers);
    }
    const pendingEventNavigation = pendingCommentaryNavigationRef.current;
    if (pendingEventNavigation?.kind === "event") {
      const marker = nextEventMarkers.find((item) => item.id === pendingEventNavigation.eventId);
      if (marker) {
        const targetX = markerScaleX > 0 ? marker.x / markerScaleX : marker.x;
        if (settlePendingAtX(targetX, pendingEventNavigation)) {
          pendingCommentaryNavigationRef.current = null;
          setCommentaryEventOpenRequest((previous) => ({
            eventId: pendingEventNavigation.eventId,
            revision: (previous?.revision ?? 0) + 1
          }));
        }
      }
    }
    const nextTradeMarkers = chartTradeMarkersForScene(
      scene,
      chartTradeFills,
      markerCoordinateSpace
    );
    syncChartTradeMarkerPositions(chartWrapRef.current, nextTradeMarkers);
    const nextTradeMarkerKey = chartTradeMarkerLayoutKey(nextTradeMarkers);
    if (nextTradeMarkerKey !== chartTradeMarkerKeyRef.current) {
      chartTradeMarkerKeyRef.current = nextTradeMarkerKey;
      setChartTradeMarkers(nextTradeMarkers);
    }
    const upcomingRight = Math.max(8, (scene.width - scene.plot.right + 8) * markerScaleX);
    const upcomingBottom = Math.max(30, (scene.height - scene.plot.bottom + 3) * markerScaleY);
    const upcomingStyleKey = `${Math.round(upcomingRight)}:${Math.round(upcomingBottom)}`;
    if (upcomingStyleKey !== chartEventUpcomingStyleKeyRef.current) {
      chartEventUpcomingStyleKeyRef.current = upcomingStyleKey;
      setChartEventUpcomingStyle({ right: upcomingRight, bottom: upcomingBottom });
    }
  }, [activeAnalysisAsset, analysisTraceDiagnosticOverlay, applyViewport, chartEvents, chartTradeFills, chartTradeSetupSnapshot, earningsEventsVisible, effectiveSpotlightDrawingIds, newsEventsVisible]);

  const toggleAgentSemanticUnitSelection = useCallback((unit: SemanticRenderUnit) => {
    if (unit.kind !== "candle") {
      return;
    }
    setSelectedSemanticNode((current) => (
      current?.nodeId === unit.id ? null : snapshotFromSemanticUnit(unit)
    ));
  }, []);

  const closeExpansion = useCallback((expansionId: string) => {
    setActiveExpansions((current) => {
      const next = removeExpansionTree(current, expansionId);
      activeExpansionsRef.current = next;
      return next;
    });
    setSelectedSemanticNode((current) => current?.nodeId.includes(expansionId) ? null : current);
  }, []);

  const loadExpansionCandles = useCallback(async (expansion: SemanticExpansion, symbol: string) => {
    const queryRange = childQueryRange({ from: expansion.from, to: expansion.to }, expansion.childInterval);
    try {
      const response = await fetchCandles({
        symbol,
        interval: expansion.childInterval,
        from: queryRange.from,
        to: queryRange.to,
        limit: expansionLimitForInterval(expansion.childInterval),
        ma: candleMovingAverageWindows
      });
      setActiveExpansions((current) => current.map((item) => (
        item.id === expansion.id &&
        chartRef.current.symbol === symbol
          ? {
              ...item,
              status: expansionStatusForCandleResponse(response),
              candles: response.candles,
              message: response.error?.message ?? response.message ?? fillTraceMessage(response.fill)
            }
          : item
      )));
    } catch (error: unknown) {
      setActiveExpansions((current) => current.map((item) => (
        item.id === expansion.id &&
        chartRef.current.symbol === symbol
          ? {
              ...item,
              status: "error",
              message: error instanceof Error ? error.message : "Expansion candle request failed"
            }
          : item
      )));
    }
  }, []);

  const openSemanticExpansion = useCallback((unit: SemanticRenderUnit) => {
    if (chartRef.current.chartType === "line") {
      return;
    }
    if (unit.kind !== "candle") {
      return;
    }
    if (nextDigTargetInterval(unit.interval) === unit.interval) {
      return;
    }
    const expansion = buildSemanticExpansion(unit);
    activeExpansionsRef.current = upsertExpansion(activeExpansionsRef.current, expansion);
    setActiveExpansions((current) => upsertExpansion(current, expansion));
    void loadExpansionCandles(expansion, unit.symbol);
  }, [loadExpansionCandles]);

  useImperativeHandle(ref, () => ({
    getSnapshot: () => chartRef.current,
    getChartDocumentId: () => document.id,
    getAnalysisAssetIdentity: () => activeAnalysisAsset ? {
      assetVersion: activeAnalysisAsset.assetVersion,
      algorithmVersion: activeAnalysisAsset.algorithmVersion,
      inputDigest: activeAnalysisAsset.inputDigest,
      asOf: activeAnalysisAsset.asOf,
      symbol: activeAnalysisAsset.symbol,
      interval: activeAnalysisAsset.interval
    } : null,
    getTradeSetupSnapshot: () => chartTradeSetupSnapshot,
    setInterval,
    setChartType,
    // Lets the agent reference chip clear this chart's candle highlight when the
    // reference is removed from the input strip.
    clearSemanticSelection: () => setSelectedSemanticNode(null)
  }), [activeAnalysisAsset, chartTradeSetupSnapshot, document.id, setChartType, setInterval]);

  const queueWheelViewport = useCallback((viewport: ChartViewport) => {
    wheelViewportRef.current = viewport;
    transientViewportRef.current = viewport;
    if (wheelRenderFrameRef.current === null) {
      wheelRenderFrameRef.current = window.requestAnimationFrame(() => {
        wheelRenderFrameRef.current = null;
        const nextViewport = wheelViewportRef.current;
        if (nextViewport) {
          setTransientViewport(nextViewport);
        }
      });
    }
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
    }
    wheelCommitTimerRef.current = window.setTimeout(() => {
      wheelCommitTimerRef.current = null;
      const finalViewport = wheelViewportRef.current;
      wheelViewportRef.current = null;
      transientViewportRef.current = null;
      if (finalViewport) {
        applyViewport(finalViewport, "external");
      }
      setTransientViewport(null);
    }, 100);
  }, [applyViewport]);

  const scheduleInteractionRender = useCallback(() => {
    if (interactionRenderFrameRef.current !== null) return;
    interactionRenderFrameRef.current = window.requestAnimationFrame(() => {
      interactionRenderFrameRef.current = null;
      if (pendingViewportRenderRef.current) {
        pendingViewportRenderRef.current = false;
        setTransientViewport(transientViewportRef.current);
      }
      if (pendingDrawingsRenderRef.current) {
        pendingDrawingsRenderRef.current = false;
        setTransientDrawings(pendingTransientDrawingsRef.current);
      }
    });
  }, []);

  const cancelInteractionRender = useCallback(() => {
    if (interactionRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(interactionRenderFrameRef.current);
      interactionRenderFrameRef.current = null;
    }
    pendingViewportRenderRef.current = false;
    pendingDrawingsRenderRef.current = false;
    pendingTransientDrawingsRef.current = null;
  }, []);

  const queueTransientDrawings = useCallback((drawings: DrawingEntity[] | null) => {
    pendingTransientDrawingsRef.current = drawings;
    pendingDrawingsRenderRef.current = true;
    scheduleInteractionRender();
  }, [scheduleInteractionRender]);

  useEffect(() => cancelInteractionRender, [cancelInteractionRender]);

  useEffect(() => () => {
    if (wheelRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelRenderFrameRef.current);
      wheelRenderFrameRef.current = null;
    }
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = null;
    }
    wheelViewportRef.current = null;
  }, [chart.chartType, chart.interval, chart.symbol]);

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    onChartHoverChange?.(true);
    const horizontalDelta = event.deltaX;
    const verticalDelta = event.deltaY;
    const deltaMode = event.deltaMode;
    const resolvedHorizontalDelta = resolveHorizontalWheelDelta(horizontalDelta, verticalDelta, event.shiftKey);
    const scene = sceneRef.current;
    const current = chartRef.current;
    const plotWidth = scene ? Math.max(1, scene.plot.right - scene.plot.left) : undefined;
    const currentViewport = wheelViewportRef.current ?? normalizeViewport(
      { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
      current.candles.length,
      plotWidth,
      viewportClampOptionsForChart(current, scene, commentaryExtraFutureSlotsRef.current)
    );
    if (resolvedHorizontalDelta !== null) {
      const slotWidth = scene
        ? scene.scales.slotWidth
        : Math.max(1, (plotWidth ?? currentViewport.visibleCount) / Math.max(1, currentViewport.visibleCount));
      const nextRightOffset = horizontalWheelDeltaToRightOffset(
        currentViewport.rightOffset,
        resolvedHorizontalDelta,
        slotWidth,
        currentViewport.visibleCount,
        current.candles.length,
        deltaMode,
        plotWidth,
        viewportClampOptionsForChart(current, scene, commentaryExtraFutureSlotsRef.current)
      );
      queueWheelViewport({
        visibleCount: currentViewport.visibleCount,
        rightOffset: nextRightOffset
      });
      return;
    }
    if (verticalDelta === 0) {
      return;
    }
    const effectiveVisibleCount = currentViewport.visibleCount;
    const step = Math.max(3, Math.round(effectiveVisibleCount * 0.12));
    const delta = verticalDelta > 0 ? step : -step;
    if (!scene) {
      queueWheelViewport(zoomViewport(
        currentViewport,
        delta,
        current.candles.length,
        plotWidth,
        viewportClampOptionsForChart(current, scene, commentaryExtraFutureSlotsRef.current)
      ));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const anchorRatio = viewportAnchorRatioAtX(scene, x);
    const nextViewport = zoomViewportAt(
      currentViewport,
      delta,
      current.candles.length,
      anchorRatio,
      plotWidth,
      viewportClampOptionsForChart(current, scene, commentaryExtraFutureSlotsRef.current)
    );
    queueWheelViewport(nextViewport);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    onChartHoverChange?.(true);
    if (event.button !== 0) {
      return;
    }
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const priceAxisPoint = chartPriceAxisPoint(scene, point.x, point.y);
    if (priceAxisPoint) {
      priceAxisPointerRef.current = { pointerId: event.pointerId, x: point.x, y: point.y };
      setHoveredSemanticUnit(null);
      event.currentTarget.style.cursor = "crosshair";
      return;
    }
    if (isChartRightAxisPoint(scene, point.x, point.y)) {
      return;
    }
    const drawingHit = chart.toolMode === "select" ? hitTestDrawing(scene, point.x, point.y) : null;

    // A canvas pointer-down can unmount the absolute editor before the browser
    // emits blur. Commit explicitly when moving away from the edited drawing;
    // queued React updates then allow a different drawing editor to open in
    // the same interaction without losing the prior value.
    if (labelEditor && drawingHit?.drawing.id !== labelEditor.drawingId) {
      commitLabelEdit();
    }
    const boundary = findBoundaryHit(scene, point);
    // While a freshly-created drawing owns the temporary Select focus, every
    // click outside that drawing must dismiss to Pan—even over a pane divider.
    // Let drawing hit-testing below win when the focused drawing overlaps one.
    if (boundary && !postCreateFocusDrawingId) {
      const allActivePaneIds = ["price", ...activeBelowPaneIds(chart)];
      const startRatios = allActivePaneIds.map((id) => getPaneRatio(chart, id));
      const startHeights = [
        scene.plot.priceBottom - scene.plot.top,
        ...scene.plot.belowPanes.map((p) => p.bottom - p.top)
      ];
      paneResizeRef.current = {
        pointerId: event.pointerId,
        index: boundary.index,
        startY: point.y,
        paneIds: allActivePaneIds,
        startRatios,
        startHeights
      };
      transientPaneRatiosRef.current = Object.fromEntries(
        allActivePaneIds.map((id, index) => [id, startRatios[index]])
      );
      setTransientPaneRatios(transientPaneRatiosRef.current);
      return;
    }
    const transform = createCoordinateTransform(scene);
    const semanticHit = hitTestSemanticNode(scene, point.x, point.y);

    // Time-axis digging: a click on the bottom time axis opens (digs) the bar above the cursor.
    if ((chart.toolMode === "select" || chart.toolMode === "pan") && semanticDigEnabled && !postCreateFocusDrawingId) {
      const axisUnit = hitTestTimeAxisUnit(scene, point.x, point.y);
      if (axisUnit && axisUnit.kind === "candle") {
        pendingSemanticClickRef.current = { unit: axisUnit, action: "dig", x: event.clientX, y: event.clientY };
        return;
      }
    }

    if (chart.toolMode === "select") {
      const hit = drawingHit;
      if (postCreateFocusDrawingId && hit?.drawing.id !== postCreateFocusDrawingId) {
        drawingDragRef.current = null;
        setPostCreateFocusDrawingId(null);
        setLabelEditor(null);
        dispatchDocumentCommand("chart.drawing.clearSelection", { mode: "pan" });
        return;
      }
      if (!hit) {
        if (semanticHit && semanticSelectionEnabled) {
          toggleAgentSemanticUnitSelection(semanticHit);
          return;
        }
        dispatchDocumentCommand("chart.drawing.clearSelection", { mode: chart.toolMode });
        return;
      }
      const anchor = transform.pointToAnchor(point.x, point.y, chart.symbol);
      if (anchor) {
        drawingDragRef.current = {
          drawing: hit.drawing,
          anchor,
          anchorIndex: hit.anchorIndex,
          startPoint: point,
          moved: false,
          rangeHandle: hit.rangeHandle
        };
      }
      dispatchDocumentCommand("chart.drawing.select", { drawingId: hit.drawing.id });
      if (labelEditor?.drawingId !== hit.drawing.id) {
        beginLabelEdit(hit.drawing);
      }
      return;
    }

    const drawingType = drawingTypeFromToolMode(chart.toolMode);
    if (drawingType) {
      const anchor = transform.pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        return;
      }
      const requiredAnchors = drawingRequiredAnchorCount(drawingType);
      if (requiredAnchors === 1) {
        const drawing = makeDrawing(drawingType, [anchor], {
          trendLineExtension: chart.trendLineExtension,
          sourceInterval: sourceIntervalForDrawingAnchors([anchor], chart.interval),
          parallelLineCount: chart.parallelLineCount
        });
        setPostCreateFocusDrawingId(drawing.id);
        beginLabelEdit(drawing);
        dispatchDocumentCommand("chart.drawing.add", { drawing });
        return;
      }
      const anchors = drawingDraft?.type === drawingType ? [...drawingDraft.anchors, anchor] : [anchor];
      if (anchors.length >= requiredAnchors) {
        if (drawingType === "riskRewardBox" && !isValidRiskRewardAnchors(anchors)) {
          setDrawingDraftError("Target은 Entry의 Stop 반대편에 지정하세요");
          setTransientDrawings([
            ...chart.drawings,
            buildDraftPreviewDrawing(
              { type: drawingType, anchors: anchors.slice(0, 2), sourceInterval: chart.interval },
              anchor,
              chart.trendLineExtension,
              chart.parallelLineCount
            )
          ]);
          return;
        }
        const drawing = makeDrawing(drawingType, anchors, {
          trendLineExtension: chart.trendLineExtension,
          sourceInterval: sourceIntervalForDrawingAnchors(anchors, chart.interval),
          parallelLineCount: chart.parallelLineCount
        });
        setDrawingDraft(null);
        setDrawingDraftError(null);
        setTransientDrawings(null);
        setPostCreateFocusDrawingId(drawing.id);
        beginLabelEdit(drawing);
        dispatchDocumentCommand("chart.drawing.add", { drawing });
      } else {
        setDrawingDraftError(null);
        setDrawingDraft({
          type: drawingType,
          anchors,
          sourceInterval: sourceIntervalForDrawingAnchors(anchors, chart.interval)
        });
        setTransientDrawings(null);
      }
      return;
    }

    if (semanticHit && semanticSelectionEnabled) {
      pendingSemanticClickRef.current = {
        unit: semanticHit,
        action: "agent-select",
        x: event.clientX,
        y: event.clientY
      };
    }
    const currentViewport = normalizeViewport(
      { visibleCount: chart.visibleCount, rightOffset: chart.rightOffset },
      chart.candles.length,
      scene.plot.right - scene.plot.left,
      viewportClampOptionsForChart(chart, scene, commentaryExtraFutureSlotsRef.current)
    );
    dragAnchorRef.current = {
      x: event.clientX,
      y: event.clientY,
      rightOffset: currentViewport.rightOffset,
      visibleCount: currentViewport.visibleCount
    };
    transientViewportRef.current = currentViewport;
    setTransientViewport(currentViewport);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    onChartHoverChange?.(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    const paneResize = paneResizeRef.current;
    const rightAxisPoint = isChartRightAxisPoint(scene, point.x, point.y);
    const boundaryHit = findBoundaryHit(scene, point);
    const axisDigUnit = !paneResize && !boundaryHit && semanticDigEnabled
      ? hitTestTimeAxisUnit(scene, point.x, point.y)
      : null;
    if (paneResize || boundaryHit) {
      event.currentTarget.style.cursor = "ns-resize";
    } else if (axisDigUnit) {
      // Hide the OS cursor over the time axis so the canvas-drawn dig marker isn't occluded.
      event.currentTarget.style.cursor = "none";
    } else {
      event.currentTarget.style.cursor = "crosshair";
    }

    if (rightAxisPoint && !paneResize && !drawingDragRef.current && !dragAnchorRef.current) {
      setHoveredSemanticUnit(null);
      setTransientDrawings(null);
      return;
    }

    if (paneResize) {
      const deltaY = point.y - paneResize.startY;
      const i = paneResize.index;
      const minH_i = i === 0 ? 92 : 54;
      const minH_next = 54;

      let newH_i = paneResize.startHeights[i] + deltaY;
      let newH_next = paneResize.startHeights[i + 1] - deltaY;

      if (newH_i < minH_i) {
        const diff = minH_i - newH_i;
        newH_i = minH_i;
        newH_next -= diff;
      }
      if (newH_next < minH_next) {
        const diff = minH_next - newH_next;
        newH_next = minH_next;
        newH_i -= diff;
      }

      const nextRatios = [...paneResize.startRatios];
      nextRatios[i] = paneResize.startRatios[i] * (newH_i / paneResize.startHeights[i]);
      nextRatios[i + 1] = paneResize.startRatios[i + 1] * (newH_next / paneResize.startHeights[i + 1]);

      transientPaneRatiosRef.current = Object.fromEntries(
        paneResize.paneIds.map((id, idx) => [id, nextRatios[idx]])
      );
      setTransientPaneRatios(transientPaneRatiosRef.current);
      return;
    }
    const semanticHit = hitTestSemanticNode(scene, point.x, point.y);
    const hoveredUnit = semanticHit ?? axisDigUnit;
    setHoveredSemanticUnit(hoveredUnit);

    const drawingDrag = drawingDragRef.current;
    if (drawingDrag) {
      if (!drawingDrag.moved && Math.hypot(point.x - drawingDrag.startPoint.x, point.y - drawingDrag.startPoint.y) < 3) {
        return;
      }
      drawingDrag.moved = true;
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        return;
      }
      const anchors = buildDraggedAnchors(drawingDrag, anchor, scene);
      queueTransientDrawings(chart.drawings.map((drawing) => (
        drawing.id === drawingDrag.drawing.id ? { ...drawing, anchors, updatedAt: new Date().toISOString() } : drawing
      )));
      return;
    }

    const activeDrawingType = drawingTypeFromToolMode(chart.toolMode);
    if (activeDrawingType && drawingRequiredAnchorCount(activeDrawingType) === 1) {
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        queueTransientDrawings(null);
        return;
      }
      queueTransientDrawings([
        ...chart.drawings,
        buildSingleAnchorPreviewDrawing(activeDrawingType, anchor, chart.trendLineExtension, chart.interval)
      ]);
      return;
    }

    if (drawingDraft && drawingTypeFromToolMode(chart.toolMode) === drawingDraft.type) {
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        queueTransientDrawings(null);
        return;
      }
      queueTransientDrawings([
        ...chart.drawings,
        buildDraftPreviewDrawing(drawingDraft, anchor, chart.trendLineExtension, chart.parallelLineCount)
      ]);
      return;
    }

    const dragAnchor = dragAnchorRef.current;
    if (!dragAnchor) {
      return;
    }
    const nextViewport = {
      visibleCount: dragAnchor.visibleCount,
      rightOffset: dragDeltaToRightOffset(
        dragAnchor.rightOffset,
        event.clientX - dragAnchor.x,
        scene.scales.slotWidth,
        dragAnchor.visibleCount,
        chart.candles.length,
        viewportClampOptionsForChart(chartRef.current, scene, commentaryExtraFutureSlotsRef.current)
      )
    };
    transientViewportRef.current = nextViewport;
    pendingViewportRenderRef.current = true;
    scheduleInteractionRender();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const priceAxisPointer = priceAxisPointerRef.current;
    const drawingDrag = drawingDragRef.current;
    const dragAnchor = dragAnchorRef.current;
    const paneResize = paneResizeRef.current;
    const pendingSemanticClick = pendingSemanticClickRef.current;
    const nextViewport = transientViewportRef.current;
    const nextRatios = transientPaneRatiosRef.current;
    cancelInteractionRender();
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    paneResizeRef.current = null;
    pendingSemanticClickRef.current = null;
    priceAxisPointerRef.current = null;
    transientViewportRef.current = null;
    transientPaneRatiosRef.current = null;
    setTransientViewport(null);
    setTransientDrawings(null);
    setTransientPaneRatios(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can be released by the browser before this handler runs.
    }
    if (priceAxisPointer) {
      const scene = sceneRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const axisPoint = scene ? chartPriceAxisPoint(scene, point.x, point.y) : null;
      const clickDistance = Math.hypot(point.x - priceAxisPointer.x, point.y - priceAxisPointer.y);
      if (axisPoint && priceAxisPointer.pointerId === event.pointerId && clickDistance <= 5) {
        const selection = createChartPriceSelection({
          chartDocumentId: document.id,
          sourcePanelId: panelId,
          symbol: chart.symbol,
          interval: chart.interval,
          price: axisPoint.price,
          formattedPrice: axisPoint.formattedPrice
        });
        if (selection) onPriceSelection?.(selection);
      }
      return;
    }
    if (drawingDrag) {
      if (!drawingDrag.moved) {
        return;
      }
      const scene = sceneRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const anchor = scene ? createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol) : null;
      if (scene && anchor) {
        const anchors = buildDraggedAnchors(drawingDrag, anchor, scene);
        dispatchDocumentCommand("chart.drawing.update", {
          drawingId: drawingDrag.drawing.id,
          drawingPatch: { anchors }
        });
      }
      return;
    }
    if (paneResize && nextRatios) {
      paneResize.paneIds.forEach((id) => {
        const startR = paneResize.startRatios[paneResize.paneIds.indexOf(id)];
        const finalR = nextRatios[id];
        if (typeof finalR === "number" && Math.abs(finalR - startR) > 0.001) {
          dispatchDocumentCommand("chart.pane.ratio.set", { paneId: id, heightRatio: finalR });
        }
      });
      return;
    }
    if (pendingSemanticClick) {
      const distance = Math.hypot(event.clientX - pendingSemanticClick.x, event.clientY - pendingSemanticClick.y);
      if (distance <= 5) {
        if (pendingSemanticClick.action === "dig") {
          void openSemanticExpansion(pendingSemanticClick.unit);
        } else {
          toggleAgentSemanticUnitSelection(pendingSemanticClick.unit);
        }
        return;
      }
    }
    if (dragAnchor && nextViewport && (
      nextViewport.rightOffset !== dragAnchor.rightOffset ||
      event.clientX - dragAnchor.x > 5
    )) {
      applyViewport(nextViewport);
    }
  };

  const cancelDrag = () => {
    cancelInteractionRender();
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    paneResizeRef.current = null;
    pendingSemanticClickRef.current = null;
    priceAxisPointerRef.current = null;
    transientViewportRef.current = null;
    transientPaneRatiosRef.current = null;
    setTransientViewport(null);
    setTransientDrawings(null);
    setTransientPaneRatios(null);
    setHoveredSemanticUnit(null);
    onChartHoverChange?.(false);
  };

  const clearAllDigging = () => {
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    pendingSemanticClickRef.current = null;
    setExpansionOverlays([]);
  };

  const resetChart = () => {
    clearAllDigging();
    setSelectedSemanticNode(null);
    const interval = chartRef.current.interval;
    const visibleCount = defaultVisibleBarsForInterval(interval);
    applyViewport({ visibleCount, rightOffset: latestCandleRightOffset(visibleCount) });
  };

  const removeComparisonFromChart = useCallback((comparisonId: string) => {
    dispatchDocumentCommand("chart.comparison.remove", { comparisonId });
  }, [dispatchDocumentCommand]);

  const labelEditorDrawing = labelEditor
    ? chart.drawings.find((drawing) => drawing.id === labelEditor.drawingId)
    : undefined;
  const labelEditorScene = sceneRef.current;
  const labelEditorLayout = labelEditorDrawing && labelEditorScene
    ? drawingLabelLayout(labelEditorScene, labelEditorDrawing, labelEditor?.value)
    : null;
  const labelEditorScaleX = labelEditorScene && chartWrapRef.current?.clientWidth
    ? chartWrapRef.current.clientWidth / labelEditorScene.width
    : 1;
  const labelEditorScaleY = labelEditorScene && chartWrapRef.current?.clientHeight
    ? chartWrapRef.current.clientHeight / labelEditorScene.height
    : 1;
  const labelEditorPositionStyle = labelEditorLayout ? {
    left: labelEditorLayout.left * labelEditorScaleX,
    top: labelEditorLayout.top * labelEditorScaleY,
    width: labelEditorLayout.width,
    height: labelEditorLayout.height,
    fontSize: labelEditorLayout.fontSize,
    lineHeight: `${labelEditorLayout.height}px`,
    textAlign: labelEditorLayout.textAlign,
    transform: `scale(${labelEditorScaleX}, ${labelEditorScaleY})`
  } : undefined;
  const applyTradePlanLabelPrice = useCallback((label: TradePlanOverlayLayout["labels"][number]) => {
    const selection = createChartPriceSelection({
      chartDocumentId: document.id,
      sourcePanelId: panelId,
      symbol: chart.symbol,
      interval: chart.interval,
      price: label.price,
      formattedPrice: label.formattedPrice
    });
    if (selection) onPriceSelection?.(selection);
  }, [chart.interval, chart.symbol, document.id, onPriceSelection, panelId]);

  return (
    <section
      ref={chartPanelRef}
      className="chart-panel"
      data-chart-visible-count={renderChart.visibleCount}
      data-chart-right-offset={renderChart.rightOffset}
      data-chart-history-count={document.history.length}
      data-chart-candle-count={renderChart.candles.length}
      data-bidask-session-date={orderFlowActive ? bidAskSessionDate : undefined}
      data-order-flow-status={orderFlowActive ? orderFlowDataStatus : undefined}
      data-order-flow-minute-count={orderFlowActive ? orderFlowToday.size : undefined}
      data-commentary-volume-profile-status={volumeProfileRuntimeStatus}
    >
      {hoverSnapshot?.kind === "candle" && (
        <dl
          className="hover-ohlc hover-ohlc-overlay"
          aria-label="Hovered candle data"
        >
          <div className="hover-ohlc-time"><dt>Time</dt><dd>{formatHoverTimestamp(hoverSnapshot.timestamp ?? hoverSnapshot.from)}</dd></div>
          <div><dt>O</dt><dd>{formatMetric(hoverSnapshot.open)}</dd></div>
          <div><dt>C</dt><dd>{formatMetric(hoverSnapshot.close)}</dd></div>
          <div><dt>H</dt><dd>{formatMetric(hoverSnapshot.high)}</dd></div>
          <div><dt>L</dt><dd>{formatMetric(hoverSnapshot.low)}</dd></div>
        </dl>
      )}

      <div className={chartAddActive ? "chart-panel-navigation has-open-chart-menu" : "chart-panel-navigation"} aria-label="Chart controls">
        <div className="chart-panel-navigation-leading">
          {toolbarLeading}
          <div className="chart-panel-navigation-adjacent chart-panel-hover-controls">
            {toolbarAfterViewControls}
            <div className="chart-add-control">
              <button
                ref={chartAddButtonRef}
                type="button"
                className={`${iconButtonClass(chartAddActive)} chart-add-target-button ${chartAddActive ? "is-active" : ""}`}
                aria-label={chartAddActive ? "차트 추가 도구 닫기" : "차트 추가 도구 열기"}
                aria-pressed={chartAddActive}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onChartAddToggle}
                {...chartControlTooltip.tooltipProps(chartAddActive ? "차트 추가 도구 닫기" : "차트 추가 도구 열기")}
              >
                <ChartNoAxesCombined size={16} />
              </button>
              {chartAddActive && (
                <div ref={chartAddMenuRef} className="chart-add-dropdown-anchor">
                  <ChartAddDock
                    document={document}
                    panelId={panelId}
                    laneHeight={laneHeight ?? 120}
                    onChartRuntimeAction={onChartRuntimeAction}
                    onClose={() => onChartAddToggle?.()}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="chart-panel-navigation-right chart-panel-hover-controls">
          <ChartDrawingDock
            document={document}
            panelId={panelId}
            onChartRuntimeAction={onChartRuntimeAction}
          />
          <span className="toolbar-separator chart-navigation-action-separator" aria-hidden="true" />
          <button
            className={`${iconButtonClass()} chart-panel-navigation-reset`}
            onClick={resetChart}
            type="button"
            aria-label="차트 초기화"
            {...chartControlTooltip.tooltipProps("차트 초기화 (디깅 해제 · 현재가 위치 복귀)")}
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {drawingDraft && (
        <span className={`draft-pill chart-drawing-draft-pill ${drawingDraftError ? "is-error" : ""}`}>
          {drawingDraftError ?? `${defaultDrawingLabel(drawingDraft.type) ?? drawingDraft.type} ${drawingDraft.anchors.length + 1}/${drawingRequiredAnchorCount(drawingDraft.type)}`}
        </span>
      )}
      {chartControlTooltip.tooltipOverlay}

      <div className="chart-wrap" ref={chartWrapRef}>
        <ChartCanvas
          chart={renderChart}
          expansions={renderExpansions}
          extraFutureSlots={commentaryExtraFutureSlots}
          previewDrawings={previewDrawings}
          hoveredNodeId={hoveredSemanticNodeId}
          selectedNodeId={selectedSemanticNode?.nodeId}
          emphasizeSelectedNode={emphasizeSelection}
          editingDrawingId={labelEditor?.drawingId}
          spotlightDrawingIds={effectiveSpotlightDrawingIds}
          spotlightCandleTimestamp={spotlightCandleTimestamp}
          analysisTraceOverlay={analysisTraceOverlay}
          onScene={handleScene}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            priceAxisPointerRef.current = null;
            setHoveredSemanticUnit(null);
            if (!dragAnchorRef.current && !drawingDragRef.current && !paneResizeRef.current) {
              onChartHoverChange?.(false);
            }
            if (!dragAnchorRef.current && !drawingDragRef.current && !paneResizeRef.current) {
              setTransientDrawings(null);
            }
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        />
        {holdingOverlay && holdingPriceMarker && (
          <span
            ref={holdingPriceMarkerRef}
            className={`chart-holding-price-marker is-tooltip-${holdingPriceMarker.tooltipPlacement}`}
            style={{
              "--chart-holding-price-y": `${holdingPriceMarker.y}px`,
              "--chart-holding-axis-left": `${holdingPriceMarker.axisLeft}px`,
              "--chart-holding-axis-width": `${holdingPriceMarker.axisWidth}px`
            } as CSSProperties}
            role="img"
            tabIndex={0}
            aria-label={`${chart.symbol} ${paperHoldingOverlayLabel(holdingOverlay)}`}
            aria-describedby={holdingPriceTooltipId}
          >
            <span id={holdingPriceTooltipId} className="chart-holding-price-tooltip" role="tooltip">
              <span className="chart-holding-price-tooltip-heading">
                <strong>{chart.symbol}</strong>
                <span>보유 포지션</span>
              </span>
              <span className="chart-holding-price-tooltip-row">
                <span>평균 매입가</span>
                <strong>{paperHoldingOverlayPriceLabel(holdingOverlay)}</strong>
              </span>
              <span className="chart-holding-price-tooltip-row">
                <span>보유 수량</span>
                <strong>{formatPaperHoldingQuantity(holdingOverlay.quantity)}</strong>
              </span>
            </span>
          </span>
        )}
        <ChartEventOverlay
          containerRef={chartWrapRef}
          markers={chartEventMarkers}
          response={chartEvents}
          earningsVisible={earningsEventsVisible}
          upcomingStyle={chartEventUpcomingStyle}
          openRequest={commentaryEventOpenRequest}
          onSelectedEventChange={handleCommentaryEventSelectionChange}
        />
        <ChartTradeOverlay
          markers={chartTradeMarkers}
          fills={chartTradeFills}
          referencePrice={liveTradePrice(liveTrade) ?? chart.candles.at(-1)?.close ?? null}
        />
        {tradePlanOverlay && (
          <div ref={tradePlanOverlayRef} className="chart-trade-plan-price-overlay" data-drawing-id={tradePlanOverlay.drawingId}>
            <svg aria-hidden="true">
              {tradePlanOverlay.labels.map((label) => <polyline
                key={`connector-${label.role}`}
                className={`is-${label.tone}`}
                data-trade-plan-connector-role={label.role}
                points={`${label.connector.startX},${label.connector.startY} ${label.connector.bendX},${label.connector.startY} ${label.connector.endX},${label.connector.endY}`}
              />)}
            </svg>
            {tradePlanOverlay.labels.map((label) => <button
              key={label.role}
              type="button"
              className={`chart-trade-plan-price-label is-${label.tone}`}
              data-trade-plan-label-role={label.role}
              style={{ left: label.left, top: label.top, width: label.width }}
              aria-label={label.ariaLabel}
              data-source-drawing-ids={label.sourceDrawingIds.join(",")}
              onPointerEnter={() => setProposalPriceSourceSpotlightIds(label.sourceDrawingIds)}
              onPointerLeave={() => setProposalPriceSourceSpotlightIds([])}
              onFocus={() => setProposalPriceSourceSpotlightIds(label.sourceDrawingIds)}
              onBlur={() => setProposalPriceSourceSpotlightIds([])}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                applyTradePlanLabelPrice(label);
              }}
            >{label.text}</button>)}
          </div>
        )}
        {patternBadge && (
          <span
            className="chart-primary-pattern-badge"
            data-pattern-drawing-ids={patternBadge.drawingIds.join(",")}
            style={{ right: patternBadge.right, top: patternBadge.top }}
          >{patternBadge.text}</span>
        )}
        <ChartAnalysisLayerToggles
          visibility={analysisLayerVisibility}
          disabled={{
            interpretation: !hasAnalysisLayerDrawings(activeAnalysisAsset, "interpretation"),
            levels: !hasAnalysisLayerDrawings(activeAnalysisAsset, "levels"),
            trend: !hasAnalysisLayerDrawings(activeAnalysisAsset, "trend"),
            pattern: !hasAnalysisLayerDrawings(activeAnalysisAsset, "pattern"),
            proposal: !hasAnalysisLayerDrawings(activeAnalysisAsset, "proposal")
          }}
          asOf={activeAnalysisAsset?.asOf}
          freshness={activeAnalysisAssetFreshness}
          interpretationMode={analysisTraceDataMode(activeAnalysisAsset)}
          candidateCounts={analysisCandidateCounts}
          loadPhase={analysisAssetsLoadPhase}
          loadError={analysisAssetsLoadError}
          onToggle={toggleAnalysisLayer}
        />
        {selectedSemanticNode && onAgentAsk && (
          <ContextualAgentAskButton
            onAsk={onAgentAsk}
            style={{ position: "absolute", right: 12, bottom: 12, zIndex: 12 }}
          />
        )}
        {labelEditor && labelEditorLayout && (
          <input
            key={labelEditor.drawingId}
            ref={labelEditorInputRef}
            className={`chart-drawing-label-editor is-${labelEditorLayout.boxStyle}`}
            aria-label="Drawing label editor"
            data-drawing-id={labelEditor.drawingId}
            style={labelEditorPositionStyle}
            value={labelEditor.value}
            placeholder="텍스트 입력"
            onChange={(event) => setLabelEditor((current) => current ? { ...current, value: event.target.value } : current)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onBlur={commitLabelEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelLabelEditRef.current = true;
                setLabelEditor(null);
              }
            }}
          />
        )}
        {renderComparisons.length > 0 && (
          <div className="chart-comparison-legend" aria-label="Comparison overlays">
            {renderComparisons.map((comparison, index) => (
              <button
                key={comparison.id}
                type="button"
                className={`chart-comparison-legend-item ${comparison.status}`}
                style={{ "--comparison-color": comparisonLegendColor(comparison.style, index) } as CSSProperties}
                title={`${comparison.symbol} 비교 삭제`}
                onClick={() => removeComparisonFromChart(comparison.id)}
              >
                <span className="chart-comparison-legend-swatch" aria-hidden="true" />
                <span>{comparison.label ?? comparison.symbol}</span>
                <span className="chart-comparison-legend-status">{comparisonStatusLabel(comparison.status)}</span>
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {currentPriceMarker && (
          <div
            className="chart-current-price-overlay"
            style={{
              "--current-price-y": `${currentPriceMarker.y}px`,
              "--current-price-line-left": `${currentPriceMarker.lineLeft}px`,
              "--current-price-line-right": `${currentPriceMarker.lineRight}px`,
              "--current-price-label-left": `${currentPriceMarker.labelLeft}px`,
              "--current-price-label-top": `${currentPriceMarker.labelTop}px`
            } as CSSProperties}
            aria-hidden="true"
          >
            <span className="chart-current-price-line" />
            <span className="chart-current-price-pill">
              <span>{currentPriceMarker.priceText}</span>
              {currentPriceTimeText && <span>{currentPriceTimeText}</span>}
            </span>
          </div>
        )}
        {expansionOverlays.map((overlay) => (
          <button
            key={overlay.id}
            type="button"
            className={`semantic-expansion-close ${overlay.status}`}
            style={{ left: overlay.left, top: overlay.top }}
            aria-label={`Close ${overlay.label} expansion`}
            title={`Close ${overlay.label} expansion`}
            onClick={() => closeExpansion(overlay.id)}
          >
            <X size={13} />
          </button>
        ))}
      </div>

    </section>
  );
});

type ChartDrawingDockProps = {
  document: ChartDocument;
  panelId: string;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
};

export function ChartDrawingDock({
  document,
  panelId,
  onChartRuntimeAction
}: ChartDrawingDockProps) {
  type ToolGroup = "horizontal" | "vertical" | "trend";
  type HorizontalToolMode = "draw-horizontalLine" | "draw-horizontalParallelLines";
  type VerticalToolMode = "draw-verticalMarker" | "draw-verticalParallelLines";
  type ParallelLineCountValue = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
  type DrawingMenu = ToolGroup | "parallel-count" | "color";
  const [openDrawingMenu, setOpenDrawingMenu] = useState<DrawingMenu | null>(null);
  const [colorMenuStyle, setColorMenuStyle] = useState<CSSProperties | null>(null);
  const [horizontalToolMode, setHorizontalToolMode] = useState<HorizontalToolMode>(() => (
    document.interactionState.mode === "draw-horizontalParallelLines" ? "draw-horizontalParallelLines" : "draw-horizontalLine"
  ));
  const [verticalToolMode, setVerticalToolMode] = useState<VerticalToolMode>(() => (
    document.interactionState.mode === "draw-verticalParallelLines" ? "draw-verticalParallelLines" : "draw-verticalMarker"
  ));
  const [scrollState, setScrollState] = useState({ hasOverflow: false, canScrollLeft: false, canScrollRight: false });
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const colorButtonRef = useRef<HTMLButtonElement | null>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const drawingTooltip = useImmediateChartTooltip();
  const target = useMemo(() => ({ panelId, chartDocumentId: document.id }), [document.id, panelId]);
  const selectedDrawing = document.drawings.find((drawing) => drawing.id === document.selectedDrawingId);
  const dispatchCommand = useCallback((type: ChartCommandType, payload: Record<string, unknown> = {}) => {
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand(type, "user", target, payload)
    });
  }, [onChartRuntimeAction, target]);
  const dispatchCommandGroup = useCallback((commands: ChartCommand[], label: string) => {
    if (!commands.length) {
      return;
    }
    onChartRuntimeAction({ kind: "chart.command.group", commands, label });
  }, [onChartRuntimeAction]);
  const setToolMode = (toolMode: ChartToolMode) => {
    dispatchCommand("chart.drawing.clearSelection", { mode: toolMode });
  };
  const setTrendLineExtension = (extension: ChartLineExtension) => {
    dispatchCommand("chart.drawing.clearSelection", { mode: "draw-trendLine", trendLineExtension: extension });
  };
  const setParallelLineCount = (lineCount: number) => {
    const normalized = normalizeParallelLineCount(lineCount);
    if (selectedDrawing?.type === "trendParallelLines") {
      dispatchCommand("chart.drawing.update", {
        drawingId: selectedDrawing.id,
        drawingPatch: { parallelLineCount: normalized }
      });
      return;
    }
    dispatchCommand("chart.drawing.clearSelection", {
      mode: "draw-trendParallelLines",
      parallelLineCount: normalized
    });
  };
  useEffect(() => {
    if (document.interactionState.mode === "draw-horizontalLine" || document.interactionState.mode === "draw-horizontalParallelLines") {
      setHorizontalToolMode(document.interactionState.mode);
    }
    if (document.interactionState.mode === "draw-verticalMarker" || document.interactionState.mode === "draw-verticalParallelLines") {
      setVerticalToolMode(document.interactionState.mode);
    }
  }, [document.interactionState.mode]);
  const colorMenuOpen = openDrawingMenu === "color";

  const updateScrollState = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    setScrollState({
      hasOverflow: maxScrollLeft > 1,
      canScrollLeft: scroller.scrollLeft > 1,
      canScrollRight: scroller.scrollLeft < maxScrollLeft - 1
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return undefined;
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState);
    observer?.observe(scroller);
    if (scroller.firstElementChild) {
      observer?.observe(scroller.firstElementChild);
    }
    scroller.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    updateScrollState();
    return () => {
      observer?.disconnect();
      scroller.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);

  useLayoutEffect(() => {
    if (!colorMenuOpen) {
      setColorMenuStyle(null);
      return undefined;
    }
    const updateColorMenuPosition = () => {
      const button = colorButtonRef.current;
      if (!button) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const panelRect = button.closest(".chart-panel")?.getBoundingClientRect();
      const menuWidth = 132;
      const viewportWidth = window.innerWidth || rect.right + menuWidth;
      const viewportHeight = window.innerHeight || rect.bottom + 320;
      const minLeft = Math.max(8, (panelRect?.left ?? 4) + 4);
      const maxLeft = Math.max(
        minLeft,
        Math.min(viewportWidth - menuWidth - 8, (panelRect?.right ?? viewportWidth) - menuWidth - 4)
      );
      const top = rect.bottom + 6;
      setColorMenuStyle({
        left: Math.max(minLeft, Math.min(rect.left, maxLeft)),
        top,
        width: menuWidth,
        maxHeight: Math.max(0, viewportHeight - top - 8)
      });
    };
    updateColorMenuPosition();
    window.addEventListener("resize", updateColorMenuPosition);
    window.addEventListener("scroll", updateColorMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateColorMenuPosition);
      window.removeEventListener("scroll", updateColorMenuPosition, true);
    };
  }, [colorMenuOpen]);

  useEffect(() => {
    if (!colorMenuOpen) {
      return undefined;
    }
    const closeColorMenu = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode
        || colorButtonRef.current?.contains(targetNode)
        || colorMenuRef.current?.contains(targetNode)) {
        return;
      }
      setOpenDrawingMenu(null);
    };
    const closeColorMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenDrawingMenu(null);
        colorButtonRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeColorMenu, true);
    window.document.addEventListener("keydown", closeColorMenuOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeColorMenu, true);
      window.document.removeEventListener("keydown", closeColorMenuOnEscape);
    };
  }, [colorMenuOpen]);

  const toggleColorMenu = () => {
    if (!selectedDrawing) {
      return;
    }
    drawingTooltip.hideTooltip();
    setOpenDrawingMenu((open) => open === "color" ? null : "color");
  };

  const updateSelectedDrawingStyle = (colorToken: DrawingPaletteToken) => {
    if (!selectedDrawing) {
      return;
    }
    const supportsPaletteFill = selectedDrawing.type === "rangeBox"
      || selectedDrawing.type === "fibonacciRetracement"
      || selectedDrawing.type === "horizontalParallelLines"
      || selectedDrawing.type === "verticalParallelLines"
      || selectedDrawing.type === "trendParallelLines";
    const nextStyle = {
      ...selectedDrawing.style,
      color: undefined,
      textColor: undefined,
      colorToken,
      textToken: colorToken,
      ...(supportsPaletteFill ? { fillColor: undefined, fillToken: colorToken } : {})
    };
    dispatchCommand("chart.drawing.update", {
      drawingId: selectedDrawing.id,
      drawingPatch: { style: nextStyle }
    });
    setOpenDrawingMenu(null);
  };
  const updateSelectedDrawingLineWidth = (lineWidth: number) => {
    if (!selectedDrawing) {
      return;
    }
    dispatchCommand("chart.drawing.update", {
      drawingId: selectedDrawing.id,
      drawingPatch: { style: { lineWidth } }
    });
  };
  const removeSelectedDrawing = () => {
    if (selectedDrawing) {
      dispatchCommand("chart.drawing.remove", { drawingId: selectedDrawing.id });
    }
  };
  const clearAllDrawings = () => {
    dispatchCommandGroup(
      document.drawings
        .filter((drawing) => !isChartAssetDrawing(drawing))
        .map((drawing) => makeChartCommand("chart.drawing.remove", "user", target, { drawingId: drawing.id })),
      "Clear drawings"
    );
  };

  const scrollDrawingTools = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollBy({ left: direction * Math.max(120, scroller.clientWidth * 0.7), behavior: "smooth" });
  };
  const handleDrawingToolsWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || !scrollState.hasOverflow) {
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    scroller.scrollLeft += delta;
    setOpenDrawingMenu(null);
    drawingTooltip.hideTooltip();
  };

  const selectedColorToken = normalizeDrawingPaletteToken(selectedDrawing?.style.colorToken);
  const selectedLineWidthStage = nearestDrawingLineWidthStage(selectedDrawing?.style.lineWidth);

  const horizontalLabel = horizontalToolMode === "draw-horizontalParallelLines" ? "가격 평행선" : "수평선";
  const verticalLabel = verticalToolMode === "draw-verticalParallelLines" ? "세로 평행선" : "세로선";
  const horizontalToolOptions: readonly ChartToolbarSelectOption<HorizontalToolMode>[] = [
    { value: "draw-horizontalLine", label: "수평선", icon: <ToolIcon toolMode="draw-horizontalLine" /> },
    { value: "draw-horizontalParallelLines", label: "가격 평행선", icon: <ToolIcon toolMode="draw-horizontalParallelLines" /> }
  ];
  const verticalToolOptions: readonly ChartToolbarSelectOption<VerticalToolMode>[] = [
    { value: "draw-verticalMarker", label: "세로선", icon: <ToolIcon toolMode="draw-verticalMarker" /> },
    { value: "draw-verticalParallelLines", label: "세로 평행선", icon: <ToolIcon toolMode="draw-verticalParallelLines" /> }
  ];
  const trendToolOptions: readonly ChartToolbarSelectOption<ChartLineExtension>[] = trendExtensionButtons.map(([extension, label]) => ({
    value: extension,
    label,
    icon: <TrendExtensionIcon extension={extension} />
  }));
  const parallelLineCountValue = String(
    selectedDrawing?.type === "trendParallelLines"
      ? normalizeParallelLineCount(selectedDrawing.parallelLineCount)
      : normalizeParallelLineCount(document.interactionState.parallelLineCount)
  ) as ParallelLineCountValue;
  const parallelLineCountOptions: readonly ChartToolbarSelectOption<ParallelLineCountValue>[] = Array.from(
    { length: 9 },
    (_, index) => {
      const value = String(index + 2) as ParallelLineCountValue;
      return { value, label: value };
    }
  );
  const colorMenu = colorMenuOpen
    && selectedDrawing
    && colorMenuStyle
    && typeof window !== "undefined"
    ? createPortal(
        <div
          ref={colorMenuRef}
          className="chart-drawing-color-menu surface-raised"
          role="menu"
          aria-label="그리기 색상"
          style={colorMenuStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {drawingPaletteOptions.map((option) => {
            const active = selectedColorToken === option.token;
            return (
              <button
                key={option.token}
                type="button"
                role="menuitemradio"
                className={active ? "active" : ""}
                aria-label={option.label}
                aria-checked={active}
                style={{ "--drawing-swatch-color": option.cssColor } as CSSProperties}
                onClick={() => updateSelectedDrawingStyle(option.token)}
                {...drawingTooltip.tooltipProps(option.label)}
              >
                <span className="chart-drawing-color-swatch" aria-hidden="true" />
                {active && <Check size={12} aria-hidden="true" />}
              </button>
            );
          })}
          <div className="chart-drawing-width-divider" aria-hidden="true" />
          <div className="chart-drawing-width-options" role="group" aria-label="선 두께">
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={selectedLineWidthStage}
              aria-label="선 두께 1에서 5"
              aria-valuetext={`${selectedLineWidthStage}`}
              onChange={(event) => updateSelectedDrawingLineWidth(Number(event.target.value))}
            />
            <output aria-live="polite">{selectedLineWidthStage.toFixed(1)}</output>
          </div>
        </div>,
        window.document.body
      )
    : null;

  return (
    <div className="chart-drawing-dock" role="toolbar" aria-label="차트 그리기 도구" onPointerDown={(event) => event.stopPropagation()}>
      {scrollState.hasOverflow && (
        <button
          type="button"
          className="chart-drawing-scroll-button is-previous"
          aria-label="이전 그리기 도구"
          disabled={!scrollState.canScrollLeft}
          onClick={() => scrollDrawingTools(-1)}
          {...drawingTooltip.tooltipProps("이전 그리기 도구")}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
      )}
      <div
        ref={scrollerRef}
        className={`chart-drawing-dock-scroller ${scrollState.canScrollLeft ? "has-overflow-left" : ""} ${scrollState.canScrollRight ? "has-overflow-right" : ""}`}
        onScroll={() => {
          setOpenDrawingMenu(null);
          drawingTooltip.hideTooltip();
        }}
        onWheel={handleDrawingToolsWheel}
      >
        <div className="chart-drawing-dock-track">
        {drawingTools.flatMap((tool) => {
          if (tool.mode === "draw-horizontalParallelLines" || tool.mode === "draw-verticalParallelLines") {
            return [];
          }
          const controls = tool.mode === "draw-horizontalLine"
            ? [(
              <ChartToolbarSelect
                key="horizontal"
                value={horizontalToolMode}
                options={horizontalToolOptions}
                ariaLabel={`가로선 도구 (${horizontalLabel})`}
                optionsAriaLabel="가로선 종류"
                variant="drawing-tool"
                open={openDrawingMenu === "horizontal"}
                onOpenChange={(open) => {
                  drawingTooltip.hideTooltip();
                  setOpenDrawingMenu(open ? "horizontal" : null);
                }}
                onChange={(mode) => {
                  setHorizontalToolMode(mode);
                  setToolMode(mode);
                }}
                onReselect={() => setToolMode(horizontalToolMode)}
                showSelectedLabel={false}
                active={document.interactionState.mode === "draw-horizontalLine" || document.interactionState.mode === "draw-horizontalParallelLines"}
              />
            )]
            : tool.mode === "draw-verticalMarker"
              ? [(
                <ChartToolbarSelect
                  key="vertical"
                  value={verticalToolMode}
                  options={verticalToolOptions}
                  ariaLabel={`세로선 도구 (${verticalLabel})`}
                  optionsAriaLabel="세로선 종류"
                  variant="drawing-tool"
                  open={openDrawingMenu === "vertical"}
                  onOpenChange={(open) => {
                    drawingTooltip.hideTooltip();
                    setOpenDrawingMenu(open ? "vertical" : null);
                  }}
                  onChange={(mode) => {
                    setVerticalToolMode(mode);
                    setToolMode(mode);
                  }}
                  onReselect={() => setToolMode(verticalToolMode)}
                  showSelectedLabel={false}
                  active={document.interactionState.mode === "draw-verticalMarker" || document.interactionState.mode === "draw-verticalParallelLines"}
                />
              )]
            : tool.mode === "draw-trendLine"
            ? [(
              <ChartToolbarSelect
                key="trend"
                value={document.interactionState.trendLineExtension}
                options={trendToolOptions}
                ariaLabel={`추세선 도구 (${trendExtensionLabel(document.interactionState.trendLineExtension)})`}
                optionsAriaLabel="추세선 종류"
                variant="drawing-tool"
                open={openDrawingMenu === "trend"}
                onOpenChange={(open) => {
                  drawingTooltip.hideTooltip();
                  setOpenDrawingMenu(open ? "trend" : null);
                }}
                onChange={setTrendLineExtension}
                onReselect={() => setTrendLineExtension(document.interactionState.trendLineExtension)}
                showSelectedLabel={false}
                active={document.interactionState.mode === "draw-trendLine"}
              />
            )]
            : tool.mode === "draw-trendParallelLines"
            ? [
              <button
                key={tool.mode}
                type="button"
                className={iconButtonClass(document.interactionState.mode === tool.mode)}
                aria-label={tool.label}
                onClick={() => setToolMode(tool.mode)}
                {...drawingTooltip.tooltipProps(tool.label)}
              >
                <ToolIcon toolMode={tool.mode} />
              </button>,
              <ChartToolbarSelect
                key={`${tool.mode}-line-count`}
                value={parallelLineCountValue}
                options={parallelLineCountOptions}
                ariaLabel="평행선 개수"
                optionsAriaLabel="평행선 개수 선택"
                variant="drawing-count"
                open={openDrawingMenu === "parallel-count"}
                onOpenChange={(open) => {
                  drawingTooltip.hideTooltip();
                  setOpenDrawingMenu(open ? "parallel-count" : null);
                }}
                onChange={(value) => setParallelLineCount(Number(value))}
                onReselect={() => setParallelLineCount(Number(parallelLineCountValue))}
                menuMinWidth={72}
                active={document.interactionState.mode === "draw-trendParallelLines" || selectedDrawing?.type === "trendParallelLines"}
              />
            ]
            : [(
              <button
                key={tool.mode}
                type="button"
                className={iconButtonClass(document.interactionState.mode === tool.mode)}
                aria-label={tool.label}
                onClick={() => setToolMode(tool.mode)}
                {...drawingTooltip.tooltipProps(tool.label)}
              >
                <ToolIcon toolMode={tool.mode} />
              </button>
            )];
          return tool.mode === "draw-horizontalLine"
            ? [<span key="drawing-tools-line-separator" className="toolbar-separator" aria-hidden="true" />, ...controls]
            : controls;
        })}
        <span className="toolbar-separator" aria-hidden="true" />
        <button
          ref={colorButtonRef}
          type="button"
          className={`${iconButtonClass(colorMenuOpen)} chart-drawing-color-button`}
          aria-label="선택한 그리기 색상 변경"
          aria-haspopup="menu"
          aria-expanded={colorMenuOpen}
          data-color-token={selectedDrawing ? selectedColorToken : undefined}
          data-fill-token={selectedDrawing?.style.fillToken}
          disabled={!selectedDrawing}
          style={{ "--drawing-color": drawingPaletteOptions.find((option) => option.token === selectedColorToken)?.cssColor } as CSSProperties}
          onClick={toggleColorMenu}
          {...drawingTooltip.tooltipProps("선택한 그리기 색상 변경")}
        >
          <Palette size={16} />
          {selectedDrawing && <span className="chart-drawing-current-color" aria-hidden="true" />}
        </button>
        <button type="button" className={iconButtonClass()} aria-label="선택한 그리기 삭제" disabled={!selectedDrawing} onClick={removeSelectedDrawing} {...drawingTooltip.tooltipProps("선택한 그리기 삭제")}>
          <Eraser size={16} />
        </button>
        <button type="button" className={iconButtonClass()} aria-label="모든 그리기 삭제" disabled={document.drawings.length === 0} onClick={clearAllDrawings} {...drawingTooltip.tooltipProps("모든 그리기 삭제")}>
          <Trash2 size={16} />
        </button>
        </div>
      </div>
      {scrollState.hasOverflow && (
        <button
          type="button"
          className="chart-drawing-scroll-button is-next"
          aria-label="다음 그리기 도구"
          disabled={!scrollState.canScrollRight}
          onClick={() => scrollDrawingTools(1)}
          {...drawingTooltip.tooltipProps("다음 그리기 도구")}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      )}
      {colorMenu}
      {drawingTooltip.tooltipOverlay}
    </div>
  );
}

function trendExtensionLabel(extension: ChartLineExtension): string {
  return trendExtensionButtons.find(([value]) => value === extension)?.[1] ?? "선분";
}

function normalizeDrawingPaletteToken(value: string | undefined): DrawingPaletteToken {
  if (value === "up") {
    return "bullish";
  }
  if (value === "down") {
    return "bearish";
  }
  return drawingPaletteOptions.some((option) => option.token === value)
    ? value as DrawingPaletteToken
    : "drawing";
}

type ChartAddPlacement = "overlay" | "events" | "below";

type ChartAddDockProps = {
  document: ChartDocument;
  panelId: string;
  laneHeight: number;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onClose: () => void;
};

type ChartAddLayerConfig = {
  layer: ChartLayerKey;
  label: string;
  placement: ChartAddPlacement;
  title: string;
  disabledReason?: string;
};

type ChartLayerButtonStyle = CSSProperties & {
  "--chart-layer-accent"?: string;
};

const chartAddLayers: ChartAddLayerConfig[] = [
  { layer: "sma:5", label: "5기간 단순 이동평균선", placement: "overlay", title: "5기간 단순 이동평균선" },
  { layer: "sma:20", label: "20기간 단순 이동평균선", placement: "overlay", title: "20기간 단순 이동평균선" },
  { layer: "sma:60", label: "60기간 단순 이동평균선", placement: "overlay", title: "60기간 단순 이동평균선" },
  { layer: "sma:120", label: "120기간 단순 이동평균선", placement: "overlay", title: "120기간 단순 이동평균선" },
  { layer: "ema:20", label: "20기간 지수 이동평균선", placement: "overlay", title: "20기간 지수 이동평균선" },
  { layer: "wma:20", label: "20기간 가중 이동평균선", placement: "overlay", title: "20기간 가중 이동평균선" },
  { layer: "bollinger:20:2", label: "볼린저 밴드 (20, 2)", placement: "overlay", title: "볼린저 밴드 (20, 2)" },
  { layer: "volume-profile", label: "거래량 프로파일", placement: "overlay", title: "거래량 프로파일" },
  { layer: "events:earnings", label: "실적 이벤트", placement: "events", title: "실적 이벤트" },
  { layer: "events:news", label: "뉴스 이벤트", placement: "events", title: "뉴스 이벤트" },
  { layer: "volume", label: "거래량 막대 차트", placement: "below", title: "거래량 막대 차트" },
  { layer: "rsi:14", label: "상대강도지수 (14)", placement: "below", title: "상대강도지수 (14)" },
  { layer: "stochastic:14:3:3", label: "스토캐스틱 오실레이터 (14, 3, 3)", placement: "below", title: "스토캐스틱 오실레이터 (14, 3, 3)" },
  { layer: "macd:12:26:9", label: "이동평균 수렴확산 (12, 26, 9)", placement: "below", title: "이동평균 수렴확산 (12, 26, 9)" }
];

const chartLayerAccentByLayer: Partial<Record<ChartLayerKey, string>> = {
  ma5: "var(--color-ma5)",
  ma20: "var(--color-ma20)",
  ma60: "var(--color-ma60)",
  "sma:5": "var(--color-ma5)",
  "sma:20": "var(--color-ma20)",
  "sma:60": "var(--color-ma60)",
  "sma:120": "var(--color-purple)",
  "ema:20": "var(--color-signal)",
  "wma:20": "var(--color-caution)",
  "bollinger:20:2": "var(--color-purple)",
  "volume-profile": "var(--color-purple)",
  "events:earnings": "var(--color-signal)",
  "events:news": "var(--color-info)",
  volume: "var(--color-muted)",
  "rsi:14": "var(--color-signal)",
  "stochastic:14:3:3": "var(--color-caution)",
  "macd:12:26:9": "var(--color-caution)"
};

function chartAddLayerButtonStyle(layer: ChartLayerKey): ChartLayerButtonStyle | undefined {
  const accent = chartLayerAccentByLayer[layer];
  return accent ? { "--chart-layer-accent": accent } : undefined;
}

export function ChartAddDock({
  document,
  panelId,
  laneHeight,
  onChartRuntimeAction,
  onClose
}: ChartAddDockProps) {
  const indicatorTooltip = useImmediateChartTooltip();
  const target = useMemo(() => ({ panelId, chartDocumentId: document.id }), [document.id, panelId]);
  const activeBelowCount = documentBelowPaneOrder(document).length;
  const canAddBelow = activeBelowCount < maxBelowPaneCountForHeight(laneHeight);

  const dispatchLayer = useCallback((layer: ChartLayerKey, visible: boolean) => {
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand("chart.layer.visibility.set", "user", target, { layer, visible })
    });
  }, [onChartRuntimeAction, target]);

  const overlayLayers = chartAddLayers.filter(item => item.placement === "overlay");
  const eventLayers = chartAddLayers.filter(item => item.placement === "events");
  const belowLayers = chartAddLayers.filter(item => item.placement === "below");

  return (
    <div
      className="chart-add-dock surface-raised"
      role="menu"
      aria-label="차트 추가 도구"
      style={{ maxHeight: Math.max(92, laneHeight - 50) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="chart-add-dock-header">
        <span>차트 추가</span>
        <button type="button" className="icon-button chart-add-dock-close" aria-label="차트 추가 도구 닫기" onClick={onClose} {...indicatorTooltip.tooltipProps("차트 추가 도구 닫기")}>
          <X size={15} />
        </button>
      </div>
      <div className="chart-add-dock-group" role="group" aria-label="가격 오버레이">
        {overlayLayers.map((item) => {
          const active = Boolean(document.layers[item.layer]);
          const disabled = !active && Boolean(item.disabledReason);
          return (
            <span key={item.layer} className="chart-add-layer-tooltip-anchor" {...indicatorTooltip.tooltipProps(item.disabledReason ?? item.label)}>
            <button
              type="button"
              role="menuitemcheckbox"
              className={`${iconButtonClass(active)} chart-add-layer-button`}
              aria-label={item.label}
              aria-checked={active}
              disabled={disabled}
              style={chartAddLayerButtonStyle(item.layer)}
              onClick={() => dispatchLayer(item.layer, !active)}
            >
              <ChartAddLayerIcon layer={item.layer} />
            </button>
            </span>
          );
        })}
      </div>
      <span className="chart-add-dock-divider" aria-hidden="true" />
      <div className="chart-add-dock-group" role="group" aria-label="차트 이벤트">
        {eventLayers.map((item) => {
          const active = document.layers[item.layer] !== false;
          return (
            <span key={item.layer} className="chart-add-layer-tooltip-anchor" {...indicatorTooltip.tooltipProps(item.label)}>
              <button
                type="button"
                role="menuitemcheckbox"
                className={`${iconButtonClass(active)} chart-add-layer-button`}
                aria-label={item.label}
                aria-checked={active}
                style={chartAddLayerButtonStyle(item.layer)}
                onClick={() => dispatchLayer(item.layer, !active)}
              >
                <ChartAddLayerIcon layer={item.layer} />
              </button>
            </span>
          );
        })}
      </div>
      <span className="chart-add-dock-divider" aria-hidden="true" />
      <div className="chart-add-dock-group" role="group" aria-label="하단 차트">
        {belowLayers.map((item) => {
          const active = Boolean(document.layers[item.layer]);
          const disabled = !active && (!canAddBelow || Boolean(item.disabledReason));
          const tooltipLabel = item.disabledReason ?? (canAddBelow ? item.label : "현재 패널 높이에서는 하단 차트를 더 추가할 수 없습니다");
          return (
            <span key={item.layer} className="chart-add-layer-tooltip-anchor" {...indicatorTooltip.tooltipProps(tooltipLabel)}>
            <button
              type="button"
              role="menuitemcheckbox"
              className={`${iconButtonClass(active)} chart-add-layer-button`}
              aria-label={item.label}
              aria-checked={active}
              disabled={disabled}
              style={chartAddLayerButtonStyle(item.layer)}
              onClick={() => dispatchLayer(item.layer, !active)}
            >
              <ChartAddLayerIcon layer={item.layer} />
            </button>
            </span>
          );
        })}
      </div>
      {indicatorTooltip.tooltipOverlay}
    </div>
  );
}

function ChartAddLayerIcon({ layer }: { layer: ChartLayerKey }) {
  switch (layer) {
    case "sma:5":
      return <span className="chart-layer-icon"><ChartSpline size={16} /><small>5</small></span>;
    case "sma:20":
      return <span className="chart-layer-icon"><ChartSpline size={16} /><small>20</small></span>;
    case "sma:60":
      return <span className="chart-layer-icon"><ChartSpline size={16} /><small>60</small></span>;
    case "sma:120":
      return <span className="chart-layer-icon"><ChartSpline size={16} /><small>120</small></span>;
    case "ema:20":
      return <span className="chart-layer-icon"><TrendingUp size={16} /><small>20</small></span>;
    case "wma:20":
      return <span className="chart-layer-icon"><Waves size={16} /><small>20</small></span>;
    case "bollinger:20:2":
      return <AudioWaveform size={17} />;
    case "volume-profile":
      return <Activity size={17} />;
    case "events:earnings":
      return <span className="chart-layer-icon"><CalendarClock size={16} /><small>E</small></span>;
    case "events:news":
      return <span className="chart-layer-icon"><Newspaper size={16} /><small>N</small></span>;
    case "volume":
      return <ChartColumn size={17} />;
    case "rsi:14":
      return <Gauge size={17} />;
    case "stochastic:14:3:3":
      return <Waves size={17} />;
    case "macd:12:26:9":
      return <AudioWaveform size={17} />;
    default:
      return <ChartNoAxesCombined size={17} />;
  }
}

function comparisonDefaultColorToken(index: number): string {
  if (index === 0) {
    return "signal";
  }
  if (index === 1) {
    return "caution";
  }
  if (index === 2) {
    return "purple";
  }
  return "drawing";
}

function comparisonLegendColor(style: { color?: string; colorToken?: string }, index: number): string {
  if (style.color) {
    return style.color;
  }
  switch (style.colorToken ?? comparisonDefaultColorToken(index)) {
    case "signal":
      return "var(--color-signal)";
    case "caution":
      return "var(--color-caution)";
    case "purple":
      return "var(--color-purple)";
    case "drawing":
      return "var(--color-drawing)";
    case "down":
      return "var(--color-down)";
    case "up":
      return "var(--color-up)";
    default:
      return "var(--color-preview)";
  }
}

function comparisonStatusLabel(status: ChartComparisonStatus): string {
  switch (status) {
    case "loading":
      return "loading";
    case "empty":
      return "empty";
    case "error":
      return "error";
    case "ready":
      return "ready";
    case "idle":
    default:
      return "idle";
  }
}

function mergeCandlesByTimestamp(...groups: CandleDto[][]): CandleDto[] {
  const byTimestamp = new Map<string, CandleDto>();
  groups.forEach((candles) => {
    candles.forEach((candle) => {
      byTimestamp.set(candle.timestamp, candle);
    });
  });
  return Array.from(byTimestamp.values()).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function activeServerIndicatorLayers(chart: ChartState): ChartLayerKey[] {
  return serverIndicatorLayersForLayers(chart.layers);
}

function visibleCandleRangeForProfile(chart: ChartState, transientViewport: ChartViewport | null): {
  from: string;
  to: string;
  candleCount: number;
} | null {
  if (!chart.candles.length) {
    return null;
  }
  const visibleCount = Math.max(1, Math.floor(transientViewport?.visibleCount ?? chart.visibleCount));
  const rightOffset = Math.max(0, Math.floor(transientViewport?.rightOffset ?? chart.rightOffset));
  const viewportEnd = Math.max(0, chart.candles.length - rightOffset);
  const startIndex = Math.max(0, Math.min(chart.candles.length - 1, Math.floor(viewportEnd - visibleCount)));
  const endIndex = Math.max(startIndex + 1, Math.min(chart.candles.length, Math.ceil(viewportEnd)));
  const visibleCandles = chart.candles.slice(startIndex, endIndex);
  if (!visibleCandles.length) {
    return null;
  }
  const closedVisibleCandles = visibleCandles.filter((candle) => candle.isClosed !== false);
  if (!closedVisibleCandles.length) {
    return null;
  }
  const profileCandles = closedVisibleCandles;
  const first = profileCandles[0];
  const last = profileCandles[profileCandles.length - 1];
  return {
    from: first.timestamp,
    to: last.timestamp,
    candleCount: profileCandles.length
  };
}

function volumeProfileSceneRangeFromScene(scene: ChartScene): VolumeProfileSceneRange | null {
  const visibleRange = visibleCandleRangeForProfile(scene.chart, null);
  const priceMin = scene.scales.minPrice;
  const priceMax = scene.scales.maxPrice;
  if (!visibleRange || !Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMax <= priceMin) {
    return null;
  }
  return {
    symbol: scene.chart.symbol,
    interval: scene.chart.interval,
    ...visibleRange,
    targetBins: chartVolumeProfileBinCount,
    priceMin,
    priceMax
  };
}

function volumeProfileSceneRangeEquals(
  current: VolumeProfileSceneRange | null,
  next: VolumeProfileSceneRange | null
): boolean {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return false;
  }
  return stableVolumeProfileRangeKey({ ...current, priceBinSize: "auto" }) ===
    stableVolumeProfileRangeKey({ ...next, priceBinSize: "auto" });
}

function visibleCandleRangeForComparison(chart: ChartState, transientViewport: ChartViewport | null): {
  from: string;
  to: string;
  candleCount: number;
} | null {
  if (!chart.candles.length) {
    return null;
  }
  const visibleCount = Math.max(1, Math.floor(transientViewport?.visibleCount ?? chart.visibleCount));
  const rightOffset = Math.max(0, Math.floor(transientViewport?.rightOffset ?? chart.rightOffset));
  const viewportEnd = Math.max(0, chart.candles.length - rightOffset);
  const startIndex = Math.max(0, Math.min(chart.candles.length - 1, Math.floor(viewportEnd - visibleCount)));
  const endIndex = Math.max(startIndex + 1, Math.min(chart.candles.length, Math.ceil(viewportEnd)));
  const visibleCandles = chart.candles.slice(startIndex, endIndex);
  const first = visibleCandles[0];
  const last = visibleCandles[visibleCandles.length - 1];
  if (!first || !last) {
    return null;
  }
  return {
    from: first.timestamp,
    to: last.timestamp,
    candleCount: visibleCandles.length
  };
}

function buildComparisonScopeRequests(
  chart: ChartState,
  visibleRange: ReturnType<typeof visibleCandleRangeForComparison>,
  activeExpansions: SemanticExpansion[]
): ComparisonScopeRequest[] {
  const comparisonSymbols = Array.from(new Set(
    chart.comparisons
      .map((comparison) => comparison.symbol.toUpperCase())
      .filter((symbol) => symbol && symbol !== chart.symbol.toUpperCase())
  )).slice(0, maxComparisonCount);
  if (!comparisonSymbols.length) {
    return [];
  }
  const requests: ComparisonScopeRequest[] = [];
  comparisonSymbols.forEach((symbol) => {
    if (visibleRange) {
      requests.push({
        key: comparisonScopeKey(symbol, chart.interval, visibleRange.from, visibleRange.to),
        symbol,
        interval: chart.interval,
        from: visibleRange.from,
        to: visibleRange.to,
        limit: Math.max(visibleRange.candleCount, defaultVisibleBarsForInterval(chart.interval))
      });
    }
    activeExpansions
      .filter((expansion) => expansion.status === "ready" && expansion.candles.length > 0)
      .forEach((expansion) => {
        const first = expansion.candles[0];
        const last = expansion.candles[expansion.candles.length - 1];
        if (!first || !last) {
          return;
        }
        requests.push({
          key: comparisonScopeKey(symbol, expansion.childInterval, first.timestamp, last.timestamp, expansion.id),
          symbol,
          interval: expansion.childInterval,
          from: first.timestamp,
          to: last.timestamp,
          limit: Math.max(expansion.candles.length, defaultVisibleBarsForInterval(expansion.childInterval)),
          parentExpansionId: expansion.id
        });
      });
  });
  return requests;
}

function comparisonScopeKey(
  symbol: string,
  interval: ChartInterval,
  from: string,
  to: string,
  parentExpansionId = "root"
): string {
  return [symbol.toUpperCase(), parentExpansionId, interval, from, to].join("|");
}

function comparisonStatusForCandleResponse(response: CandleQueryResponseDto): ChartComparisonStatus {
  if (response.candles.length) {
    return "ready";
  }
  if (response.status === "error" || response.fill?.status === "timeout" || response.fill?.status === "failed") {
    return "error";
  }
  return "empty";
}

function comparisonStatusFromScopes(scopes: ChartComparisonCandleScope[]): ChartComparisonStatus {
  if (!scopes.length) {
    return "idle";
  }
  if (scopes.some((scope) => scope.status === "loading")) {
    return "loading";
  }
  if (scopes.some((scope) => scope.status === "ready")) {
    return "ready";
  }
  if (scopes.some((scope) => scope.status === "error")) {
    return "error";
  }
  if (scopes.some((scope) => scope.status === "empty")) {
    return "empty";
  }
  return "idle";
}

function comparisonMessageFromScopes(scopes: ChartComparisonCandleScope[]): string | undefined {
  return scopes.find((scope) => scope.status === "error" && scope.message)?.message
    ?? scopes.find((scope) => scope.status === "empty" && scope.message)?.message
    ?? scopes.find((scope) => scope.status === "loading")?.message;
}

const belowLayerPaneMap: Partial<Record<ChartLayerKey, string>> = {
  volume: "volume",
  "rsi:14": "rsi:14",
  "stochastic:14:3:3": "stochastic:14:3:3",
  "macd:12:26:9": "macd:12:26:9"
};

function belowLayerForPaneId(paneId: string): ChartLayerKey | null {
  const found = Object.entries(belowLayerPaneMap).find(([, id]) => id === paneId);
  return found ? found[0] as ChartLayerKey : null;
}

function maxBelowPaneCountForHeight(height: number): number {
  return Math.max(0, Math.floor((height - baseChartMinHeightForBelowPanes) / belowPaneMinHeight));
}

function documentBelowPaneOrder(document: ChartDocument): string[] {
  const visiblePaneIds = Object.entries(belowLayerPaneMap)
    .filter(([layer]) => Boolean(document.layers[layer as ChartLayerKey]))
    .map(([, paneId]) => paneId)
    .filter((paneId): paneId is string => Boolean(paneId));
  const visible = new Set(visiblePaneIds);
  const ordered = document.panes
    .map((pane) => pane.id)
    .filter((paneId) => paneId !== "price" && visible.has(paneId));
  const missing = visiblePaneIds.filter((paneId) => !ordered.includes(paneId));
  return [...ordered, ...missing];
}

function candleSnapshotFromResponse(response: CandleQueryResponseDto, intervalOverride?: ChartInterval): CandleSnapshot {
  const interval = intervalOverride ?? response.interval;
  return {
    symbol: response.symbol.toUpperCase(),
    interval,
    source: "api",
    feed: "local",
    dataStatus: response.status === "pending" ? "partial" : response.status,
    sourceInterval: response.sourceInterval ?? (interval !== response.interval ? response.interval : undefined),
    message: response.error?.message ?? response.message ?? fillTraceMessage(response.fill) ?? (response.status === "empty" ? `No chart data for ${response.symbol}` : undefined),
    requestedLimit: response.requestedLimit ?? response.request.limit,
    returnedCount: response.returnedCount ?? response.candles.length,
    targetStoredCount: response.targetStoredCount,
    targetRangeFrom: response.targetRangeFrom,
    storedCandleCount: response.storedCandleCount,
    availableFrom: response.availableFrom,
    availableTo: response.availableTo,
    hasMoreBefore: response.hasMoreBefore,
    hasMoreAfter: response.hasMoreAfter,
    coverage: response.coverage as CandleSnapshot["coverage"],
    indicators: {
      ma: response.indicators?.ma ?? [],
      volume: response.indicators?.volume ?? true
    },
    candles: response.candles
  };
}

type RealtimeLayerEventDto = Extract<CandleEventDto, { type: "LIVE_TRADE_UPDATE" | "LIVE_QUOTE_UPDATE" }>;
type OrderFlowEventDto = Extract<CandleEventDto, { type: "ORDER_FLOW_BINS_UPDATE" }>;
type ChartCandleEventDto = Exclude<CandleEventDto, RealtimeLayerEventDto | OrderFlowEventDto>;

function candleEventFromDto(event: ChartCandleEventDto, intervalOverride?: ChartInterval): CandleEvent {
  return {
    type: event.type,
    symbol: event.symbol.toUpperCase(),
    interval: intervalOverride ?? event.interval,
    sourceInterval: intervalOverride && intervalOverride !== event.interval ? event.interval : undefined,
    data: event.data
  };
}

function isRealtimeLayerEventDto(event: CandleEventDto): event is RealtimeLayerEventDto {
  return event.type === "LIVE_TRADE_UPDATE" || event.type === "LIVE_QUOTE_UPDATE";
}

function isOrderFlowEventDto(event: CandleEventDto): event is OrderFlowEventDto {
  return event.type === "ORDER_FLOW_BINS_UPDATE";
}

function normalizeOrderFlowPriceBinSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : defaultOrderFlowPriceBinSize;
}

function normalizeStreamStatus(status: ChartState["streamState"]): StreamStatus {
  return status === "connecting" || status === "idle" || status === "live" || status === "error" ? status : "idle";
}

function fillTraceMessage(fill?: CandleFillTraceDto): string | undefined {
  if (!fill || fill.status === "not_needed" || fill.status === "filled") {
    return undefined;
  }
  const sources = fill.sources ?? {};
  const sourceError = (["alpaca", "s3", "clickhouse", "redis"] as const)
    .map((source) => sources[source]?.error)
    .find((error): error is string => typeof error === "string" && error.trim().length > 0);
  if (sourceError) {
    return sourceError;
  }
  if (fill.status === "timeout") {
    return "Candle fill timed out before all sources finished.";
  }
  if (fill.status === "empty") {
    return "No candles were found for the requested range.";
  }
  if (fill.status === "partial") {
    return "Only partial candles were found for the requested range.";
  }
  return "Candle fill failed for the requested range.";
}

function expansionStatusForCandleResponse(response: CandleQueryResponseDto): ExpansionStatus {
  if (response.candles.length) {
    return "ready";
  }
  if (response.status === "error" || response.fill?.status === "timeout" || response.fill?.status === "failed") {
    return "error";
  }
  return "empty";
}

function chartMemoryKey(symbol: string, interval: ChartInterval): string {
  return `${symbol.toUpperCase()}:${interval}`;
}

function candleSourceInterval(interval: ChartInterval): ChartInterval {
  return interval;
}

function isAnalysisAssetInterval(interval: ChartInterval): interval is AnalysisAssetInterval {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h" || interval === "1D" || interval === "1W";
}

function latestClosedTimestamp(candles: CandleDto[]): string | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index]?.isClosed === true) {
      return candles[index]?.timestamp ?? null;
    }
  }
  return null;
}

function scheduleChartAnalysisAssetRequest(callback: () => void): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1_000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

function isRealtimeStreamInterval(interval: ChartInterval): boolean {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h" || interval === "1D";
}

function shouldRetryRealtimeSnapshot(response: CandleQueryResponseDto, interval: ChartInterval, attempt: number): boolean {
  if (!isRealtimeStreamInterval(interval) || attempt >= 1) {
    return false;
  }
  if (response.status === "empty" || response.status === "pending") {
    return true;
  }
  const fillState = response.fill?.backgroundFill?.state;
  if (fillState === "queued" || fillState === "already_queued") {
    return true;
  }
  return response.status === "partial" && response.candles.length < requestedVisibleSlotsFromResponse(response, interval);
}

function findBoundaryHit(scene: ChartScene, point: { x: number; y: number }): { type: "price" | "below"; index: number; y: number } | null {
  if (point.x < scene.plot.left || point.x > scene.plot.right) {
    return null;
  }
  // Check priceBottom boundary
  if (scene.plot.belowPanes.length > 0 && Math.abs(point.y - scene.plot.priceBottom) <= 7) {
    return { type: "price", index: 0, y: scene.plot.priceBottom };
  }
  // Check subsequent boundaries
  for (let i = 1; i < scene.plot.belowPanes.length; i++) {
    const pane = scene.plot.belowPanes[i];
    const boundaryY = pane.top - 3;
    if (Math.abs(point.y - boundaryY) <= 7) {
      return { type: "below", index: i, y: boundaryY };
    }
  }
  return null;
}

function expansionCloseLeft(scene: ChartScene, range: ChartScene["semantic"]["expansionRanges"][number]): number {
  const rightInset = 8;
  const thumbnailGap = 8;
  const desiredLeft = range.right - expansionCloseButtonSize - rightInset;
  const maxVisibleLeft = scene.plot.right - expansionCloseButtonSize - rightInset;
  const thumbnailStopLeft = expansionParentThumbnailRight(scene.plot, range) + thumbnailGap;

  if (desiredLeft > maxVisibleLeft) {
    return maxVisibleLeft >= thumbnailStopLeft ? maxVisibleLeft : desiredLeft;
  }
  return Math.max(desiredLeft, thumbnailStopLeft);
}

function upsertExpansion(expansions: SemanticExpansion[], expansion: SemanticExpansion): SemanticExpansion[] {
  const index = expansions.findIndex((item) => item.id === expansion.id);
  if (index < 0) {
    return [...expansions, expansion];
  }
  const next = [...expansions];
  next[index] = expansion;
  return next;
}

function removeExpansionTree(expansions: SemanticExpansion[], expansionId: string): SemanticExpansion[] {
  const removed = new Set<string>([expansionId]);
  let changed = true;
  while (changed) {
    changed = false;
    expansions.forEach((expansion) => {
      if (!removed.has(expansion.id) && removed.has(expansion.parentExpansionId ?? "")) {
        removed.add(expansion.id);
        changed = true;
      }
    });
  }
  return expansions.filter((expansion) => !removed.has(expansion.id));
}

function currentPriceMarkerFromScene(scene: ChartScene): CurrentPriceMarker | null {
  const latest = scene.chart.candles.at(-1);
  if (!latest || !Number.isFinite(latest.close)) {
    return null;
  }
  const price = latest.close;
  const y = priceToY(scene, price);
  if (y < scene.plot.top - 1 || y > scene.plot.priceBottom + 1) {
    return null;
  }
  const priceText = formatPriceAxisValue(price);
  const isClosed = latest.isClosed;
  const showClock = currentPriceMarkerCanShowClock(scene.chart.interval, isClosed, scene.chart.streamState);
  const labelWidth = currentPriceMarkerLabelWidth(priceText, showClock);
  const labelHeight = showClock ? 45 : 31;
  const labelLeft = clampNumber(scene.plot.right - 1, scene.plot.left + 8, scene.width - labelWidth - 4);
  const labelTop = clampNumber(y - labelHeight / 2, scene.plot.top, Math.max(scene.plot.top, scene.plot.priceBottom - labelHeight));
  return {
    priceText,
    timestamp: latest.timestamp,
    interval: scene.chart.interval,
    streamState: scene.chart.streamState,
    isClosed,
    lineLeft: scene.plot.left,
    lineRight: Math.max(scene.plot.left, labelLeft - 7),
    labelLeft,
    labelTop,
    y
  };
}

function holdingPriceMarkerEquals(left: PaperHoldingPriceMarker | null, right: PaperHoldingPriceMarker | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.priceText === right.priceText
    && left.tooltipPlacement === right.tooltipPlacement
    && Math.abs(left.y - right.y) < 0.5
    && Math.abs(left.axisLeft - right.axisLeft) < 0.5
    && Math.abs(left.axisWidth - right.axisWidth) < 0.5;
}

function currentPriceMarkerEquals(left: CurrentPriceMarker | null, right: CurrentPriceMarker | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.priceText === right.priceText &&
    left.timestamp === right.timestamp &&
    left.interval === right.interval &&
    left.streamState === right.streamState &&
    left.isClosed === right.isClosed &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.lineLeft - right.lineLeft) < 0.5 &&
    Math.abs(left.lineRight - right.lineRight) < 0.5 &&
    Math.abs(left.labelLeft - right.labelLeft) < 0.5 &&
    Math.abs(left.labelTop - right.labelTop) < 0.5
  );
}

function currentPriceMarkerTimeText(marker: CurrentPriceMarker, nowMs: number): string | null {
  if (marker.isClosed || marker.streamState !== "live" || !currentPriceIntervalCanShowClock(marker.interval)) {
    return null;
  }
  const candleEnd = Date.parse(candleRange({
    timestamp: marker.timestamp,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    isClosed: false
  }, marker.interval).to);
  if (!Number.isFinite(candleEnd)) {
    return null;
  }
  const remainingSeconds = Math.max(0, Math.ceil((candleEnd - nowMs) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

function currentPriceMarkerCanShowClock(
  interval: ChartInterval,
  isClosed: boolean,
  streamState: ChartState["streamState"]
): boolean {
  return streamState === "live" && !isClosed && currentPriceIntervalCanShowClock(interval);
}

function syncTradePlanOverlayElement(
  element: HTMLDivElement | null,
  layout: TradePlanOverlayLayout | null,
  scene: ChartScene | null,
  chartWrap: HTMLDivElement | null
): void {
  if (!element) return;
  if (!layout || !scene || !chartWrap) {
    element.style.display = "none";
    return;
  }
  const scaled = scaleTradePlanOverlayLayout(
    layout,
    { width: scene.width, height: scene.height },
    { width: chartWrap.clientWidth, height: chartWrap.clientHeight }
  );
  element.style.display = "";
  element.dataset.drawingId = scaled.drawingId;
  element.dataset.boxLeft = String(scaled.boxLeft);
  element.dataset.boxRight = String(scaled.boxRight);
  scaled.labels.forEach((label) => {
    const button = element.querySelector<HTMLButtonElement>(`[data-trade-plan-label-role="${label.role}"]`);
    if (button) {
      button.style.left = `${label.left}px`;
      button.style.top = `${label.top}px`;
      button.style.width = `${label.width}px`;
    }
    const connector = element.querySelector<SVGPolylineElement>(`[data-trade-plan-connector-role="${label.role}"]`);
    connector?.setAttribute("points", [
      `${label.connector.startX},${label.connector.startY}`,
      `${label.connector.bendX},${label.connector.startY}`,
      `${label.connector.endX},${label.connector.endY}`
    ].join(" "));
  });
}

function currentPriceIntervalCanShowClock(interval: ChartInterval): boolean {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h";
}

function currentPriceMarkerLabelWidth(priceText: string, showClock: boolean): number {
  return Math.min(138, priceAxisLabelWidth(priceText, showClock));
}

function clampNumber(value: number, min: number, max: number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.max(safeMin, Math.min(safeMax, value));
}

function visibleRightAnchorTimestamp(scene: ChartScene | null, chart: ChartState): string | undefined {
  if (scene && scene.chart.symbol === chart.symbol && scene.chart.interval === chart.interval) {
    const index = Math.max(0, scene.visibleEndIndex - 1);
    return scene.allCandles[index]?.timestamp ?? chart.candles.at(-1)?.timestamp;
  }
  return chart.candles.at(-1)?.timestamp;
}

function analysisTraceCandidateCounts(
  overlay: AnalysisTraceOverlay | null,
  scene: ChartScene
): { total: number; visible: number; stored: number } | null {
  if (!overlay || overlay.dataMode === "legacy") return null;
  const transform = createCoordinateTransform(scene);
  const pivotById = new Map(overlay.pivots.map((pivot) => [pivot.id, pivot]));
  const visible = overlay.candidates.filter((candidate) => {
    const anchors = candidate.anchors.length
      ? candidate.anchors
      : candidate.anchorPivotIds.map((id) => pivotById.get(id)).filter((pivot): pivot is NonNullable<typeof pivot> => Boolean(pivot));
    const points = anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is { x: number; y: number } => Boolean(point));
    if (!points.length) return false;
    if (candidate.category === "levels") {
      return points[0].y >= scene.plot.top && points[0].y <= scene.plot.priceBottom;
    }
    if (candidate.category === "trend" && points.length >= 2) {
      return projectedLineIntersectsPlot(points[0], points[1], scene);
    }
    for (let index = 0; index + 1 < points.length; index += 2) {
      if (segmentIntersectsPlot(points[index], points[index + 1], scene)) return true;
    }
    return points.some((point) => point.x >= scene.plot.left && point.x <= scene.plot.right
      && point.y >= scene.plot.top && point.y <= scene.plot.priceBottom);
  }).length;
  return { total: overlay.candidates.length, visible, stored: overlay.storedCandidateCount };
}

function projectedLineIntersectsPlot(
  start: { x: number; y: number },
  end: { x: number; y: number },
  scene: ChartScene
): boolean {
  const span = end.x - start.x;
  if (Math.abs(span) < 0.0001) return start.x >= scene.plot.left && start.x <= scene.plot.right;
  const yAt = (x: number) => start.y + ((x - start.x) / span) * (end.y - start.y);
  const fromX = Math.max(scene.plot.left, Math.min(start.x, scene.plot.right));
  const toX = scene.plot.right;
  const fromY = yAt(fromX);
  const toY = yAt(toX);
  return Math.max(fromY, toY) >= scene.plot.top && Math.min(fromY, toY) <= scene.plot.priceBottom;
}

function segmentIntersectsPlot(
  start: { x: number; y: number },
  end: { x: number; y: number },
  scene: ChartScene
): boolean {
  if (Math.max(start.x, end.x) < scene.plot.left || Math.min(start.x, end.x) > scene.plot.right) return false;
  const span = end.x - start.x;
  if (Math.abs(span) < 0.0001) {
    return Math.max(start.y, end.y) >= scene.plot.top && Math.min(start.y, end.y) <= scene.plot.priceBottom;
  }
  const left = Math.max(scene.plot.left, Math.min(start.x, end.x));
  const right = Math.min(scene.plot.right, Math.max(start.x, end.x));
  const yAt = (x: number) => start.y + ((x - start.x) / span) * (end.y - start.y);
  const leftY = yAt(left), rightY = yAt(right);
  return Math.max(leftY, rightY) >= scene.plot.top && Math.min(leftY, rightY) <= scene.plot.priceBottom;
}

function analysisCandidateCountsEqual(
  left: { total: number; visible: number; stored: number } | null,
  right: { total: number; visible: number; stored: number } | null
): boolean {
  return left === right || Boolean(left && right
    && left.total === right.total && left.visible === right.visible && left.stored === right.stored);
}

function viewportClampOptionsForChart(
  chart: ChartState,
  scene: ChartScene | null | undefined,
  commentaryExtraFutureSlots = 0
): ViewportClampOptions {
  const extraFutureSlots = (scene ? Math.max(0, Math.ceil(scene.semantic.expansionExtraSlots)) : 0)
    + Math.max(0, Math.ceil(commentaryExtraFutureSlots));
  const minimumVisibleSlots = Math.max(0, Math.ceil(chart.requestedLimit ?? 0));
  return {
    ...(extraFutureSlots > 0 ? { extraFutureSlots } : {}),
    ...(minimumVisibleSlots > 0 ? { minimumVisibleSlots } : {})
  };
}

function requestedVisibleSlotsFromResponse(response: CandleQueryResponseDto, interval: ChartInterval): number {
  return Math.max(
    defaultVisibleBarsForInterval(interval),
    Math.ceil(response.requestedLimit ?? response.request?.limit ?? 0)
  );
}

function buildSemanticExpansion(unit: Extract<SemanticRenderUnit, { kind: "candle" }>): SemanticExpansion {
  const childInterval = nextDigTargetInterval(unit.interval);
  const range = candleRange(unit.candle, unit.interval);
  return {
    id: semanticExpansionId(unit.id),
    symbol: unit.symbol,
    parentExpansionId: unit.parentExpansionId,
    parentNodeId: unit.id,
    parentTimestamp: unit.timestamp,
    parentInterval: unit.interval,
    parentCandle: unit.candle,
    childInterval,
    from: range.from,
    to: range.to,
    depth: unit.depth + 1,
    status: "loading",
    candles: [],
    openedAt: new Date().toISOString()
  };
}

function buildLiveQuote(chart: ChartState, previousClose: number | null): LiveQuote {
  if (chart.streamState !== "live" || !previousClose || previousClose <= 0) {
    return unavailableQuote;
  }
  const latest = chart.candles.at(-1);
  if (!latest || !Number.isFinite(latest.close)) {
    return unavailableQuote;
  }
  const price = liveTradePrice(chart.liveTrade) ?? latest.close;
  const change = price - previousClose;
  const percent = (change / previousClose) * 100;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return {
    priceText: priceFormatter.format(price),
    changeText: formatSignedNumber(change),
    percentText: `${formatSignedNumber(percent)}%`,
    tone
  };
}

function liveTradePrice(liveTrade: TradeTickData | undefined): number | null {
  const price = liveTrade?.price;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}

function formatSignedNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${priceFormatter.format(Math.abs(value))}`;
}

function formatMetric(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatHoverTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function commentaryReferenceCandleIndex(
  reference: ChartCommentaryReferenceOpenRequest["reference"],
  candles: CandleDto[],
  interval: ChartInterval,
  events: ChartEventsResponse | null
): number {
  if (!isCommentaryAssetInterval(interval)) return -1;
  if (reference.type === "candle") {
    const expected = reference.candleKey ?? candleKeyForTimestamp(reference.timestamp, interval);
    return candles.findIndex((candle) => candleKeyForTimestamp(candle.timestamp, interval) === expected);
  }
  const storedEvent = reference.type === "news"
    ? events?.newsDays.find((event) => event.id === reference.eventId)
    : events?.earnings.find((event) => event.id === reference.eventId);
  if (storedEvent) return chartEventTargetCandleIndex(candles, interval, storedEvent);
  const marketDate = reference.type === "news"
    ? reference.marketDate
    : marketDateForTimestamp(reference.eventAt);
  return candles.findIndex((candle) => marketDateForTimestamp(candle.timestamp) === marketDate);
}

function commentaryPlotCenterAnchor(
  scene: ChartScene | null,
  container: HTMLDivElement | null
): ChartEventOpenRequest["anchor"] | undefined {
  if (!scene || !container) return undefined;
  const scaleX = scene.width > 0 ? container.clientWidth / scene.width : 1;
  const scaleY = scene.height > 0 ? container.clientHeight / scene.height : 1;
  return {
    x: ((scene.plot.left + scene.plot.right) / 2) * scaleX,
    top: Math.max(scene.plot.top + 4, scene.plot.bottom - 28) * scaleY
  };
}

function commentarySemanticCandle(
  scene: ChartScene | null,
  timestamp: string,
  candleKey: string | undefined,
  interval: ChartInterval
): Extract<SemanticRenderUnit, { kind: "candle" }> | null {
  if (!scene || !isCommentaryAssetInterval(interval)) return null;
  const expected = candleKey ?? candleKeyForTimestamp(timestamp, interval);
  return scene.semantic.units.find((unit): unit is Extract<SemanticRenderUnit, { kind: "candle" }> => (
    unit.kind === "candle"
    && unit.depth === 0
    && candleKeyForTimestamp(unit.timestamp, interval) === expected
  )) ?? null;
}

function isCommentaryAssetInterval(interval: ChartInterval): interval is AnalysisAssetInterval {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h"
    || interval === "4h" || interval === "1D" || interval === "1W";
}

function bidAskCandlesForSession(candles: CandleDto[], sessionDate: string): CandleDto[] {
  return candles.filter((candle) => (
    sessionDateFromTimestamp(candle.timestamp) === sessionDate && isRegularSessionCandle(candle)
  ));
}

function isRegularSessionCandle(candle: CandleDto): boolean {
  if (candle.marketSession) {
    return candle.marketSession.toLowerCase() === "regular";
  }
  const date = new Date(candle.timestamp);
  if (!Number.isFinite(date.getTime())) {
    return false;
  }
  const parts = Object.fromEntries(marketClockFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function TrendExtensionIcon({ extension }: { extension: ChartLineExtension }) {
  switch (extension) {
    case "segment":
      return (
        <svg className="trend-extension-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <line x1="4" y1="14" x2="14" y2="4" />
          <circle cx="4" cy="14" r="1.8" />
          <circle cx="14" cy="4" r="1.8" />
        </svg>
      );
    case "ray":
      return (
        <svg className="trend-extension-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <line x1="4" y1="14" x2="14" y2="4" />
          <circle cx="4" cy="14" r="1.8" />
          <polyline points="10 4 14 4 14 8" />
        </svg>
      );
    case "line":
      return (
        <svg className="trend-extension-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <line x1="4" y1="14" x2="14" y2="4" />
          <polyline points="10 4 14 4 14 8" />
          <polyline points="8 14 4 14 4 10" />
        </svg>
      );
  }
}

function ToolIcon({ toolMode }: { toolMode: ChartToolMode }) {
  switch (toolMode) {
    case "select":
      return <MousePointer2 size={16} />;
    case "pan":
      return <Hand size={16} />;
    case "draw-horizontalLine":
      return <span className="tool-glyph horizontal-line" aria-hidden="true" />;
    case "draw-horizontalParallelLines":
      return <span className="tool-glyph horizontal-parallel-lines" aria-hidden="true" />;
    case "draw-trendLine":
      return <span className="tool-glyph diagonal-line" aria-hidden="true" />;
    case "draw-trendParallelLines":
      return <span className="tool-glyph diagonal-parallel-lines" aria-hidden="true" />;
    case "draw-verticalMarker":
      return <span className="tool-glyph vertical-line" aria-hidden="true" />;
    case "draw-verticalParallelLines":
      return <span className="tool-glyph vertical-parallel-lines" aria-hidden="true" />;
    case "draw-textLabel":
      return <Type size={16} />;
    case "draw-flagMarker":
      return <Flag size={16} />;
    case "draw-rangeBox":
      return <Square size={16} />;
    case "draw-riskRewardBox":
      return (
        <svg className="drawing-tool-svg" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="3" y="3" width="12" height="12" rx="1" />
          <line x1="3" y1="9" x2="15" y2="9" />
          <path className="risk-reward-up" d="M4 4h10v4H4z" />
          <path className="risk-reward-down" d="M4 10h10v4H4z" />
        </svg>
      );
    case "draw-fibonacciRetracement":
      return (
        <svg className="drawing-tool-svg fibonacci-tool-icon" viewBox="0 0 18 18" aria-hidden="true">
          <line x1="3" y1="3" x2="15" y2="15" />
          <line x1="3" y1="5" x2="15" y2="5" />
          <line x1="3" y1="9" x2="15" y2="9" />
          <line x1="3" y1="13" x2="15" y2="13" />
        </svg>
      );
    default:
      return <MousePointer2 size={16} />;
  }
}
