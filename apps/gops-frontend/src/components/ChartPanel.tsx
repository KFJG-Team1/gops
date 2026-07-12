import {
  ChartNoAxesCombined,
  Eraser,
  Flag,
  Hand,
  MousePointer2,
  Palette,
  Paintbrush,
  RotateCcw,
  Square,
  Trash2,
  Type,
  X
} from "lucide-react";
import {
  type CSSProperties,
  forwardRef,
  PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  normalizeRealtimeLayerEvent
} from "@gops/chart-engine";
import { chartStateFromDocument } from "../chart/chartDocumentAdapter";
import { ChartCanvas } from "../chart/ChartCanvas";
import { isAnalysisAssetStale, resolveAnalysisAssetForCandles, staleAnalysisAsset } from "../chart/analysisAssetPresentation";
import {
  fetchAnalysisAssets,
  subscribeAnalysisAssetsInvalidation,
  type AnalysisAssetInterval,
  type AnalysisAssetsResponse
} from "../chart/analysisAssetsApi";
import {
  analysisAssetApplyCommands,
  analysisAssetRemovalCommands,
  analysisLayerToggleCommands,
  isChartAssetDrawing,
  type AnalysisLayerKey,
  type AnalysisLayerVisibility
} from "../chart/analysisLayerController";
import { fetchCandles, fetchIndicators, fetchVolumeProfile, openChartSocket, refreshActiveChartSymbol } from "../chart/cdcClient";
import {
  buildDraftPreviewDrawing,
  buildSingleAnchorPreviewDrawing,
  buildDraggedAnchors,
  defaultDrawingLabel,
  defaultDrawingStyle,
  drawingLabelLayout,
  drawingRequiredAnchorCount,
  drawingSupportsTextEditing,
  drawingTools,
  drawingTypeFromToolMode,
  hitTestDrawing,
  isValidRiskRewardAnchors,
  makeDrawing,
  normalizeParallelLineCount,
  sourceIntervalForDrawingAnchors,
  type DrawingDraft,
  type DrawingDrag
} from "../chart/drawings";
import { expansionCloseButtonSize, expansionMetadataCenterY, expansionParentThumbnailRight } from "../chart/expansionLayout";
import { stableVolumeProfileRangeKey } from "../chart/derivedRequestPolicy";
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
import { activeBelowPaneIds, createCoordinateTransform, getPaneRatio, hitTestSemanticNode, hitTestTimeAxisUnit, priceToY, topPriceGridY, viewportAnchorRatioAtX, type ChartScene } from "../chart/scene";
import {
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
import {
  defaultBidAskInterval,
  defaultVisibleBarsForBidAskInterval,
  defaultVisibleBarsForInterval,
  isBidAskChartInterval,
  normalizeBidAskChartInterval
} from "../chart/types";
import {
  dragDeltaToRightOffset,
  horizontalWheelDeltaToRightOffset,
  latestCandleRightOffset,
  normalizeViewport,
  resolveHorizontalWheelDelta,
  zoomViewport,
  zoomViewportAt,
  type ChartViewport,
  type ViewportClampOptions
} from "../chart/viewport";
import { ChartAnalysisLayerToggles } from "./ChartAnalysisLayerToggles";

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

type ExpansionOverlay = {
  id: string;
  label: string;
  left: number;
  right: number;
  top: number;
  status: string;
};

type OrderFlowChartDataStatus = "ready" | "empty" | "unsupported";

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
  chartDrawingActive?: boolean;
  chartAddActive?: boolean;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartDrawingToggle?: () => void;
  onChartAddToggle?: () => void;
  onSemanticSelectionChange?: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentAsk?: () => void;
  emphasizeSelection?: boolean;
  onChartHoverChange?: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
  toolbarLeading?: ReactNode;
};

export type ChartPanelHandle = {
  getSnapshot: () => ChartState;
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
const defaultOrderFlowPriceBinSize = 0.01;
const trendExtensionButtons: Array<[ChartLineExtension, string]> = [
  ["segment", "Segment"],
  ["ray", "Ray"],
  ["line", "Line"]
];

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
  chartDrawingActive = false,
  chartAddActive = false,
  onChartRuntimeAction,
  onChartDrawingToggle,
  onChartAddToggle,
  onSemanticSelectionChange,
  emphasizeSelection = false,
  onChartHoverChange,
  onHeaderChange,
  toolbarLeading
}: ChartPanelProps, ref) {
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [activeExpansions, setActiveExpansions] = useState<SemanticExpansion[]>([]);
  const [hoveredSemanticNodeId, setHoveredSemanticNodeId] = useState<string | undefined>();
  const [hoverSnapshot, setHoverSnapshot] = useState<SemanticSelectionSnapshot | null>(null);
  const [selectedSemanticNode, setSelectedSemanticNode] = useState<SemanticSelectionSnapshot | null>(null);
  const [expansionOverlays, setExpansionOverlays] = useState<ExpansionOverlay[]>([]);
  const [currentPriceMarker, setCurrentPriceMarker] = useState<CurrentPriceMarker | null>(null);
  const [currentPriceClock, setCurrentPriceClock] = useState(() => Date.now());
  const [hoverOhlcTop, setHoverOhlcTop] = useState(86);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | undefined>();
  const [drawingDraft, setDrawingDraft] = useState<DrawingDraft | null>(null);
  const [drawingDraftError, setDrawingDraftError] = useState<string | null>(null);
  const [postCreateFocusDrawingId, setPostCreateFocusDrawingId] = useState<string | null>(null);
  const [labelEditor, setLabelEditor] = useState<{ drawingId: string; value: string; originalValue: string } | null>(null);
  const [transientViewport, setTransientViewport] = useState<ChartViewport | null>(null);
  const [transientDrawings, setTransientDrawings] = useState<DrawingEntity[] | null>(null);
  const [transientPaneRatios, setTransientPaneRatios] = useState<Record<string, number> | null>(null);
  const [baseIndicatorSeries, setBaseIndicatorSeries] = useState<IndicatorSeries>({});
  const [expansionIndicatorSeries, setExpansionIndicatorSeries] = useState<IndicatorSeries>({});
  const [volumeProfile, setVolumeProfile] = useState<ChartState["volumeProfile"]>(null);
  const [orderFlowToday, setOrderFlowToday] = useState<Map<string, OrderFlowMinuteDto>>(new Map());
  const [orderFlowTodaySessionDate, setOrderFlowTodaySessionDate] = useState<string | null>(null);
  const [orderFlowDataStatus, setOrderFlowDataStatus] = useState<OrderFlowChartDataStatus>("empty");
  const [orderFlowSupportedSymbols, setOrderFlowSupportedSymbols] = useState<string[] | undefined>();
  const [orderFlowPriceBinSize, setOrderFlowPriceBinSize] = useState(defaultOrderFlowPriceBinSize);
  const [comparisonScopeData, setComparisonScopeData] = useState<Record<string, ComparisonScopeData>>({});
  const [analysisAssets, setAnalysisAssets] = useState<AnalysisAssetsResponse | null>(null);
  const [analysisAssetsRevision, setAnalysisAssetsRevision] = useState(0);
  const [analysisLayerVisibility, setAnalysisLayerVisibility] = useState<AnalysisLayerVisibility>({
    geometry: true
  });
  const sourceChart = useMemo(() => ({
    ...chartStateFromDocument(document, candles, dataStatus, streamStatus, streamMessage),
    liveTrade
  }), [candles, dataStatus, document, liveTrade, streamMessage, streamStatus]);
  const bidAskSessionDate = useMemo(() => {
    if (orderFlowTodaySessionDate) {
      return orderFlowTodaySessionDate;
    }
    if (isOrderFlowDemoRuntimeEnabled()) {
      return sourceChart.candles.length
        ? sessionDateFromTimestamp(sourceChart.candles[sourceChart.candles.length - 1].timestamp)
        : sessionDateFromTimestamp(new Date().toISOString());
    }
    return sessionDateFromTimestamp(new Date().toISOString());
  }, [orderFlowTodaySessionDate, sourceChart.candles]);
  const chart = useMemo(() => (
    sourceChart.chartType === "bidask"
      ? { ...sourceChart, candles: bidAskCandlesForSession(sourceChart.candles, bidAskSessionDate) }
      : sourceChart
  ), [bidAskSessionDate, sourceChart]);
  const orderFlowActive = chart.chartType === "bidask" && isBidAskChartInterval(chart.interval);
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
  const visibleProfileRangeKey = useMemo(() => (
    visibleProfileRange
      ? stableVolumeProfileRangeKey({
          symbol: chart.symbol,
          interval: chart.interval,
          from: visibleProfileRange.from,
          to: visibleProfileRange.to,
          targetBins: 10,
          priceBinSize: "auto"
        })
      : ""
  ), [
    chart.interval,
    chart.symbol,
    visibleProfileRange?.from,
    visibleProfileRange?.to
  ]);
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
  const sceneRef = useRef<ChartScene | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartState>(chart);
  const activeExpansionsRef = useRef<SemanticExpansion[]>(activeExpansions);
  const olderRangeRequestsRef = useRef<Set<string>>(new Set());
  const olderRangeRetryAfterRef = useRef<Map<string, number>>(new Map());
  const pendingViewportAnchorRef = useRef<{ key: string; anchor: ViewportAnchor } | null>(null);
  const overlayKeyRef = useRef("");
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  const paneResizeRef = useRef<PaneResizeAnchor | null>(null);
  const drawingDragRef = useRef<DrawingDrag | null>(null);
  const labelEditorInputRef = useRef<HTMLInputElement | null>(null);
  const cancelLabelEditRef = useRef(false);
  const pendingSemanticClickRef = useRef<PendingSemanticClick | null>(null);
  const transientViewportRef = useRef<ChartViewport | null>(null);
  const wheelViewportRef = useRef<ChartViewport | null>(null);
  const wheelRenderFrameRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const transientPaneRatiosRef = useRef<Record<string, number> | null>(null);
  const activeChartSessionIdRef = useRef(`chart-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const analysisLayerVisibilityRef = useRef(analysisLayerVisibility);
  const appliedAnalysisAssetKeyRef = useRef("");
  const indicatorSeries = useMemo(() => (
    mergeIndicatorSeries(baseIndicatorSeries, expansionIndicatorSeries)
  ), [baseIndicatorSeries, expansionIndicatorSeries]);

  useEffect(() => subscribeAnalysisAssetsInvalidation((invalidatedSymbol) => {
    const activeSymbol = chart.symbol.trim().toUpperCase();
    if (!invalidatedSymbol || invalidatedSymbol === activeSymbol) {
      setAnalysisAssets(null);
      appliedAnalysisAssetKeyRef.current = "";
      setAnalysisAssetsRevision((current) => current + 1);
    }
  }), [chart.symbol]);

  useEffect(() => {
    chartRef.current = chart;
  }, [chart]);

  useEffect(() => {
    analysisLayerVisibilityRef.current = analysisLayerVisibility;
  }, [analysisLayerVisibility]);

  useEffect(() => {
    if (!currentPriceMarker || currentPriceMarker.isClosed || currentPriceMarker.streamState !== "live") {
      return undefined;
    }
    const timer = window.setInterval(() => setCurrentPriceClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentPriceMarker]);

  useEffect(() => {
    activeExpansionsRef.current = activeExpansions;
  }, [activeExpansions]);

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
    let active = true;
    setAnalysisAssets((current) => current?.symbol === requestedSymbol ? current : null);
    appliedAnalysisAssetKeyRef.current = "";
    fetchAnalysisAssets(requestedSymbol)
      .then((response) => {
        if (active && response.symbol === requestedSymbol) {
          setAnalysisAssets(response);
        }
      })
      .catch(() => {
        if (active) {
          setAnalysisAssets(null);
        }
      });
    return () => {
      active = false;
    };
  }, [analysisAssetsRevision, chart.symbol]);

  const rawActiveAnalysisAsset = isAnalysisAssetInterval(chart.interval)
    && analysisAssets?.symbol === chart.symbol.trim().toUpperCase()
    ? analysisAssets.assets[chart.interval]
    : null;
  const activeAnalysisAsset = resolveAnalysisAssetForCandles(rawActiveAnalysisAsset, chart.candles);
  const activeAnalysisAssetStale = activeAnalysisAsset ? isAnalysisAssetStale(
    activeAnalysisAsset.asOf,
    chart.candles,
    activeAnalysisAsset.assetVersion,
    activeAnalysisAsset.interval
  ) : false;
  const latestClosedAssetCandleTimestamp = latestClosedTimestamp(chart.candles);

  useEffect(() => {
    const interval = chart.interval;
    const supportedInterval = isAnalysisAssetInterval(interval);
    const rawAsset = supportedInterval
      && latestClosedAssetCandleTimestamp
      && analysisAssets?.symbol === chart.symbol.trim().toUpperCase()
      ? analysisAssets.assets[interval]
      : null;
    const resolvedAsset = resolveAnalysisAssetForCandles(rawAsset, chart.candles);
    const asset = resolvedAsset
      ? staleAnalysisAsset(resolvedAsset, isAnalysisAssetStale(
          resolvedAsset.asOf, chart.candles, resolvedAsset.assetVersion, resolvedAsset.interval
        ))
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
    analysisAssets,
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
    const handleFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: string; interval?: string; drawingIds?: string[] }>).detail;
      if (detail?.symbol !== chart.symbol.trim().toUpperCase() || detail.interval !== chart.interval) return;
      const drawingId = detail.drawingIds?.find((id) => chartRef.current.drawings.some((drawing) => drawing.id === id));
      if (!drawingId) return;
      dispatchExternalCommandGroup([
        makeChartCommand("chart.drawing.clearSelection", "system", commandTarget, { mode: "select" }, undefined, "external"),
        makeChartCommand("chart.drawing.select", "system", commandTarget, { drawingId }, undefined, "external")
      ], "Focus chart analysis drawing");
    };
    window.addEventListener("gops:chart-asset-focus", handleFocus);
    return () => window.removeEventListener("gops:chart-asset-focus", handleFocus);
  }, [chart.interval, chart.symbol, commandTarget, dispatchExternalCommandGroup]);

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
    const handleParallelLineCountKey = (event: KeyboardEvent) => {
      // Only the chart that owns the visible drawing dock may consume the
      // global shortcut. Multiple ChartPanel instances mount this effect.
      if (!chartDrawingActive) {
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
  }, [chart.drawings, chart.parallelLineCount, chart.selectedDrawingId, chart.toolMode, chartDrawingActive, emitDocumentCommand]);

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
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const requestedSymbol = chart.symbol;
    const requestedInterval = chart.interval;
    const requestedSourceInterval = candleSourceInterval(requestedInterval);
    const requestKey = chartMemoryKey(requestedSymbol, requestedInterval);
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
            setOrderFlowTodaySessionDate(event.data.sessionDate);
            setOrderFlowDataStatus("ready");
            setOrderFlowPriceBinSize(normalizeOrderFlowPriceBinSize(event.data.priceBinSize));
            setOrderFlowToday((current) => replaceOrderFlowMinute(current, event.data));
          }
          return;
        }
        if (isRealtimeLayerEventDto(event)) {
          onChartRuntimeAction({ kind: "chart.layer.live", event: normalizeRealtimeLayerEvent(event) });
          return;
        }
        onChartRuntimeAction({ kind: "chart.live", event: candleEventFromDto(event, chart.interval) });
      },
      (nextStreamState) => onChartRuntimeAction({
        kind: "chart.stream.status",
        symbol: socketSymbol,
        interval: chart.interval,
        status: normalizeStreamStatus(nextStreamState)
      })
    );
  }, [chart.interval, chart.symbol, onChartRuntimeAction]);

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
      return;
    }
    const controller = new AbortController();
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
        setBaseIndicatorSeries(response.derived?.state === "failed" ? {} : response.series);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBaseIndicatorSeries({});
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
    if (orderFlowActive || !chart.layers["volume-profile"] || !visibleProfileRange) {
      setVolumeProfile(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchVolumeProfile({
        symbol: chart.symbol,
        interval: chart.interval,
        from: visibleProfileRange.from,
        to: visibleProfileRange.to,
        targetBins: 10,
        priceMin: visibleProfileRange.priceMin,
        priceMax: visibleProfileRange.priceMax
      }, controller.signal)
        .then((response) => {
          if (chartRef.current.symbol !== chart.symbol || chartRef.current.interval !== chart.interval) {
            return;
          }
          setVolumeProfile(response.derived?.state === "failed" ? null : response);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setVolumeProfile(null);
          }
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    chart.interval,
    chart.layers["volume-profile"],
    chart.symbol,
    orderFlowActive,
    visibleProfileRangeKey,
  ]);

  useEffect(() => {
    if (!orderFlowActive) {
      setOrderFlowToday(new Map());
      setOrderFlowTodaySessionDate(null);
      setOrderFlowDataStatus("empty");
      setOrderFlowSupportedSymbols(undefined);
      setOrderFlowPriceBinSize(defaultOrderFlowPriceBinSize);
      return;
    }
    const controller = new AbortController();
    const handleOrderFlowEvent = (event: CandleEventDto) => {
      if (event.type !== "ORDER_FLOW_BINS_UPDATE" || event.symbol.toUpperCase() !== chart.symbol) {
        return;
      }
      setOrderFlowTodaySessionDate(event.data.sessionDate);
      setOrderFlowDataStatus("ready");
      setOrderFlowPriceBinSize(normalizeOrderFlowPriceBinSize(event.data.priceBinSize));
      setOrderFlowToday((current) => replaceOrderFlowMinute(current, event.data));
    };
    fetchOrderFlowIntraday(chart.symbol, controller.signal, orderFlowDemoAnchor)
      .then((response) => {
        if (
          controller.signal.aborted ||
          chartRef.current.symbol !== chart.symbol
        ) {
          return;
        }
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
          setOrderFlowDataStatus("empty");
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
    onSemanticSelectionChange?.(selectedSemanticNode);
  }, [onSemanticSelectionChange, selectedSemanticNode]);

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
  }), [chart, indicatorSeries, orderFlowActive, orderFlowDataStatus, orderFlowPriceBinSize, orderFlowSupportedSymbols, orderFlowToday, orderFlowTodaySessionDate, renderComparisons, transientDrawings, transientViewport, transientPaneRatios, volumeProfile]);
  const renderExpansions = activeExpansions;
  const previewDrawings: DrawingEntity[] = [];
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
    setHoveredSemanticNodeId(undefined);
    setHoverSnapshot(null);
    setSelectedSemanticNode(null);
    setExpansionOverlays([]);
  }, []);

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
    setVolumeProfile(null);
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
          viewportClampOptionsForChart(current, currentScene)
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
    const clampOptions = viewportClampOptionsForChart(currentChart, currentScene);
    const requestedViewport = normalizeViewport(viewport, currentChart.candles.length, plotWidth, clampOptions);
    const maxRightOffset = Math.max(0, currentChart.candles.length - Math.min(requestedViewport.visibleCount, currentChart.candles.length));
    const oldest = currentChart.candles[0]?.timestamp;
    if (oldest && currentChart.hasMoreBefore !== false && requestedViewport.rightOffset >= maxRightOffset - 1) {
      loadOlderCandles(
        currentChart.symbol,
        currentChart.interval,
        oldest,
        Math.max(defaultVisibleBarsForInterval(currentChart.interval), requestedViewport.visibleCount),
        requestedViewport
      );
    }
    const nextViewport = requestedViewport;
    if (nextViewport.visibleCount === currentChart.visibleCount && nextViewport.rightOffset === currentChart.rightOffset) {
      return;
    }
    dispatchDocumentCommand("chart.viewport.set", nextViewport, "user", historyScope);
  }, [dispatchDocumentCommand, loadOlderCandles]);

  const handleScene = useCallback((scene: ChartScene) => {
    sceneRef.current = scene;
    const nextPriceMarker = currentPriceMarkerFromScene(scene);
    setCurrentPriceMarker((current) => (
      currentPriceMarkerEquals(current, nextPriceMarker) ? current : nextPriceMarker
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
    const nextHoverOhlcTop = topPriceGridY(scene) + 2;
    setHoverOhlcTop((current) => (
      Math.abs(current - nextHoverOhlcTop) < 0.5 ? current : nextHoverOhlcTop
    ));
  }, []);

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
    setInterval,
    setChartType,
    // Lets the agent reference chip clear this chart's candle highlight when the
    // reference is removed from the input strip.
    clearSemanticSelection: () => setSelectedSemanticNode(null)
  }), [setChartType, setInterval]);

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
      viewportClampOptionsForChart(current, scene)
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
        viewportClampOptionsForChart(current, scene)
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
        viewportClampOptionsForChart(current, scene)
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
      viewportClampOptionsForChart(current, scene)
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
      viewportClampOptionsForChart(chart, scene)
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
    setCrosshair(point);
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    const paneResize = paneResizeRef.current;
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
    setHoveredSemanticNodeId(hoveredUnit?.id);
    setHoverSnapshot(hoveredUnit ? snapshotFromSemanticUnit(hoveredUnit) : null);

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
      setTransientDrawings(chart.drawings.map((drawing) => (
        drawing.id === drawingDrag.drawing.id ? { ...drawing, anchors, updatedAt: new Date().toISOString() } : drawing
      )));
      return;
    }

    const activeDrawingType = drawingTypeFromToolMode(chart.toolMode);
    if (activeDrawingType && drawingRequiredAnchorCount(activeDrawingType) === 1) {
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        setTransientDrawings(null);
        return;
      }
      setTransientDrawings([
        ...chart.drawings,
        buildSingleAnchorPreviewDrawing(activeDrawingType, anchor, chart.trendLineExtension, chart.interval)
      ]);
      return;
    }

    if (drawingDraft && drawingTypeFromToolMode(chart.toolMode) === drawingDraft.type) {
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        setTransientDrawings(null);
        return;
      }
      setTransientDrawings([
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
        viewportClampOptionsForChart(chartRef.current, scene)
      )
    };
    transientViewportRef.current = nextViewport;
    setTransientViewport(nextViewport);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawingDrag = drawingDragRef.current;
    const dragAnchor = dragAnchorRef.current;
    const paneResize = paneResizeRef.current;
    const pendingSemanticClick = pendingSemanticClickRef.current;
    const nextViewport = transientViewportRef.current;
    const nextRatios = transientPaneRatiosRef.current;
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    paneResizeRef.current = null;
    pendingSemanticClickRef.current = null;
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
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    paneResizeRef.current = null;
    pendingSemanticClickRef.current = null;
    transientViewportRef.current = null;
    transientPaneRatiosRef.current = null;
    setTransientViewport(null);
    setTransientDrawings(null);
    setTransientPaneRatios(null);
    setHoveredSemanticNodeId(undefined);
    setHoverSnapshot(null);
    setCrosshair(undefined);
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

  return (
    <section
      className="chart-panel"
      data-chart-visible-count={renderChart.visibleCount}
      data-chart-right-offset={renderChart.rightOffset}
      data-chart-history-count={document.history.length}
      data-chart-candle-count={renderChart.candles.length}
      data-bidask-session-date={orderFlowActive ? bidAskSessionDate : undefined}
      data-order-flow-status={orderFlowActive ? orderFlowDataStatus : undefined}
      data-order-flow-minute-count={orderFlowActive ? orderFlowToday.size : undefined}
    >
      {hoverSnapshot?.kind === "candle" && (
        <dl
          className="hover-ohlc hover-ohlc-overlay"
          style={{ "--hover-ohlc-top": `${hoverOhlcTop}px` } as CSSProperties}
          aria-label="Hovered candle data"
        >
          <div className="hover-ohlc-time"><dt>Time</dt><dd>{formatHoverTimestamp(hoverSnapshot.timestamp ?? hoverSnapshot.from)}</dd></div>
          <div><dt>O</dt><dd>{formatMetric(hoverSnapshot.open)}</dd></div>
          <div><dt>C</dt><dd>{formatMetric(hoverSnapshot.close)}</dd></div>
          <div><dt>H</dt><dd>{formatMetric(hoverSnapshot.high)}</dd></div>
          <div><dt>L</dt><dd>{formatMetric(hoverSnapshot.low)}</dd></div>
        </dl>
      )}

      <div className={chartDrawingActive || chartAddActive ? "toolbar has-active-chart-target" : "toolbar"} aria-label="Chart controls">
        <div className="toolbar-row">
          {toolbarLeading}
          <button
            type="button"
            className={`${iconButtonClass(chartAddActive)} chart-add-target-button ${chartAddActive ? "is-active" : ""}`}
            aria-label={chartAddActive ? "차트 추가 도구 닫기" : "차트 추가 도구 열기"}
            title={chartAddActive ? "차트 추가 도구 닫기" : "차트 추가 도구 열기"}
            aria-pressed={chartAddActive}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onChartAddToggle}
          >
            <ChartNoAxesCombined size={16} />
          </button>
          <button
            type="button"
            className={`${iconButtonClass(chartDrawingActive)} chart-drawing-target-button ${chartDrawingActive ? "is-active" : ""}`}
            aria-label={chartDrawingActive ? "차트 그리기 도구 닫기" : "차트 그리기 도구 열기"}
            title={chartDrawingActive ? "그리기 도구 닫기" : "그리기 도구 열기"}
            aria-pressed={chartDrawingActive}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onChartDrawingToggle}
          >
            <Paintbrush size={16} />
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            className={iconButtonClass()}
            onClick={resetChart}
            type="button"
            aria-label="차트 초기화"
            title="차트 초기화 (디깅 해제 · 현재가 위치 복귀)"
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          {drawingDraft && (
            <span className={`draft-pill ${drawingDraftError ? "is-error" : ""}`}>
              {drawingDraftError ?? `${defaultDrawingLabel(drawingDraft.type) ?? drawingDraft.type} ${drawingDraft.anchors.length + 1}/${drawingRequiredAnchorCount(drawingDraft.type)}`}
            </span>
          )}
        </div>
      </div>

      <div className="chart-wrap" ref={chartWrapRef}>
        <ChartCanvas
          chart={renderChart}
          expansions={renderExpansions}
          previewDrawings={previewDrawings}
          hoveredNodeId={hoveredSemanticNodeId}
          selectedNodeId={selectedSemanticNode?.nodeId}
          emphasizeSelectedNode={emphasizeSelection}
          crosshair={crosshair}
          editingDrawingId={labelEditor?.drawingId}
          onScene={handleScene}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            setHoveredSemanticNodeId(undefined);
            setHoverSnapshot(null);
            if (!dragAnchorRef.current && !drawingDragRef.current && !paneResizeRef.current) {
              onChartHoverChange?.(false);
            }
            if (!dragAnchorRef.current && !paneResizeRef.current) {
              setCrosshair(undefined);
            }
            if (!dragAnchorRef.current && !drawingDragRef.current && !paneResizeRef.current) {
              setTransientDrawings(null);
            }
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        />
        <ChartAnalysisLayerToggles
          visibility={analysisLayerVisibility}
          disabled={{
            geometry: !activeAnalysisAsset?.geometry.drawings.length
          }}
          asOf={activeAnalysisAsset?.asOf}
          stale={activeAnalysisAssetStale}
          onToggle={toggleAnalysisLayer}
        />
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
  onClose: () => void;
};

export function ChartDrawingDock({
  document,
  panelId,
  onChartRuntimeAction,
  onClose
}: ChartDrawingDockProps) {
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
  const closeDock = () => {
    dispatchCommand("chart.drawing.clearSelection", { mode: "pan" });
    onClose();
  };
  const updateSelectedDrawingStyle = () => {
    if (!selectedDrawing) {
      return;
    }
    const defaultStyle = defaultDrawingStyle(selectedDrawing.type as DrawingEntity["type"], document.interactionState.trendLineExtension);
    const nextToken = selectedDrawing.style.colorToken === "down" ? defaultStyle.colorToken : "down";
    dispatchCommand("chart.drawing.update", {
      drawingId: selectedDrawing.id,
      drawingPatch: { style: { ...selectedDrawing.style, color: undefined, textColor: undefined, colorToken: nextToken, textToken: nextToken } }
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

  return (
    <div className="chart-drawing-dock surface-flat" role="toolbar" aria-label="Chart drawing tools" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="icon-button chart-drawing-dock-close" aria-label="그리기 도구 닫기" title="그리기 도구 닫기" onClick={closeDock}>
        <X size={15} />
      </button>
      {drawingTools.flatMap((tool) => {
        const controls = tool.mode === "draw-trendLine"
          ? trendExtensionButtons.map(([extension, label]) => (
            <button
              key={`${tool.mode}-${extension}`}
              type="button"
              className={iconButtonClass(document.interactionState.mode === tool.mode && document.interactionState.trendLineExtension === extension)}
              aria-label={`Trend ${label}`}
              title={`Trend ${label}`}
              onClick={() => setTrendLineExtension(extension)}
            >
              <TrendExtensionIcon extension={extension} />
            </button>
          ))
          : tool.mode === "draw-trendParallelLines"
            ? [
              <button
                key={tool.mode}
                type="button"
                className={iconButtonClass(document.interactionState.mode === tool.mode)}
                aria-label={tool.label}
                title={tool.label}
                onClick={() => setToolMode(tool.mode)}
              >
                <ToolIcon toolMode={tool.mode} />
              </button>,
              <select
                key={`${tool.mode}-line-count`}
                className="chart-parallel-line-count"
                aria-label="Parallel line count"
                title="평행선 개수"
                value={selectedDrawing?.type === "trendParallelLines"
                  ? normalizeParallelLineCount(selectedDrawing.parallelLineCount)
                  : normalizeParallelLineCount(document.interactionState.parallelLineCount)}
                onChange={(event) => setParallelLineCount(Number(event.target.value))}
              >
                {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            ]
          : [(
            <button
              key={tool.mode}
              type="button"
              className={iconButtonClass(document.interactionState.mode === tool.mode)}
              aria-label={tool.label}
              title={tool.label}
              onClick={() => setToolMode(tool.mode)}
            >
              <ToolIcon toolMode={tool.mode} />
            </button>
          )];
        return tool.mode === "draw-horizontalLine"
          ? [<span key="drawing-tools-line-separator" className="toolbar-separator" aria-hidden="true" />, ...controls]
          : controls;
      })}
      <span className="toolbar-separator" aria-hidden="true" />
      <button type="button" className={iconButtonClass()} aria-label="Selected drawing color" title="Selected drawing color" disabled={!selectedDrawing} onClick={updateSelectedDrawingStyle}>
        <Palette size={16} />
      </button>
      <button type="button" className={iconButtonClass()} aria-label="Delete selected drawing" title="Delete selected drawing" disabled={!selectedDrawing} onClick={removeSelectedDrawing}>
        <Eraser size={16} />
      </button>
      <button type="button" className={iconButtonClass()} aria-label="Clear drawings" title="Clear drawings" disabled={document.drawings.length === 0} onClick={clearAllDrawings}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

type ChartAddPlacement = "overlay" | "below";

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
  { layer: "sma:5", label: "SMA 5", placement: "overlay", title: "SMA 5" },
  { layer: "sma:20", label: "SMA 20", placement: "overlay", title: "SMA 20" },
  { layer: "sma:60", label: "SMA 60", placement: "overlay", title: "SMA 60" },
  { layer: "sma:120", label: "SMA 120", placement: "overlay", title: "SMA 120" },
  { layer: "ema:20", label: "EMA 20", placement: "overlay", title: "EMA 20" },
  { layer: "wma:20", label: "WMA 20", placement: "overlay", title: "WMA 20" },
  { layer: "bollinger:20:2", label: "Bollinger Bands", placement: "overlay", title: "Bollinger Bands 20,2" },
  { layer: "volume-profile", label: "Volume Profile", placement: "overlay", title: "Volume Profile" },
  { layer: "volume", label: "VOL", placement: "below", title: "VOL" },
  { layer: "rsi:14", label: "RSI 14", placement: "below", title: "RSI 14" },
  { layer: "stochastic:14:3:3", label: "Stochastic", placement: "below", title: "Stochastic 14,3,3" },
  { layer: "macd:12:26:9", label: "MACD", placement: "below", title: "MACD 12,26,9" }
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
  const belowLayers = chartAddLayers.filter(item => item.placement === "below");

  return (
    <div className="chart-add-dock chart-drawing-dock surface-flat" role="toolbar" aria-label="Chart add tools" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="icon-button chart-drawing-dock-close" aria-label="차트 추가 도구 닫기" title="차트 추가 도구 닫기" onClick={onClose}>
        <X size={15} />
      </button>
      {overlayLayers.map((item) => {
        const active = Boolean(document.layers[item.layer]);
        const disabled = !active && Boolean(item.disabledReason);
        return (
          <button
            key={item.layer}
            type="button"
            className={`${iconButtonClass(active)} chart-add-layer-button`}
            aria-label={item.label}
            title={item.disabledReason ?? item.title}
            disabled={disabled}
            style={chartAddLayerButtonStyle(item.layer)}
            onClick={() => dispatchLayer(item.layer, !active)}
          >
            <ChartAddLayerIcon layer={item.layer} />
          </button>
        );
      })}
      <span className="toolbar-separator" aria-hidden="true" />
      {belowLayers.map((item) => {
        const active = Boolean(document.layers[item.layer]);
        const disabled = !active && (!canAddBelow || Boolean(item.disabledReason));
        return (
          <button
            key={item.layer}
            type="button"
            className={`${iconButtonClass(active)} chart-add-layer-button`}
            aria-label={item.label}
            title={item.disabledReason ?? (canAddBelow ? item.title : "Below pane unavailable at this height")}
            disabled={disabled}
            style={chartAddLayerButtonStyle(item.layer)}
            onClick={() => dispatchLayer(item.layer, !active)}
          >
            <ChartAddLayerIcon layer={item.layer} />
          </button>
        );
      })}
    </div>
  );
}

function ChartAddLayerIcon({ layer }: { layer: ChartLayerKey }) {
  switch (layer) {
    case "sma:5":
      return <>MA5</>;
    case "sma:20":
      return <>MA20</>;
    case "sma:60":
      return <>MA60</>;
    case "sma:120":
      return <>MA120</>;
    case "ema:20":
      return <>EMA</>;
    case "wma:20":
      return <>WMA</>;
    case "bollinger:20:2":
      return <>BB</>;
    case "volume-profile":
      return <>VP</>;
    case "volume":
      return <>VOL</>;
    case "rsi:14":
      return <>RSI</>;
    case "stochastic:14:3:3":
      return <>STO</>;
    case "macd:12:26:9":
      return <>MACD</>;
    default:
      return <>{layer}</>;
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
  priceMin: number;
  priceMax: number;
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
  const profileCandles = closedVisibleCandles.length > 0 ? closedVisibleCandles : visibleCandles;
  const priceValues = profileCandles
    .flatMap((candle) => [candle.low, candle.high])
    .filter((value): value is number => Number.isFinite(value));
  if (!priceValues.length) {
    return null;
  }
  const first = profileCandles[0];
  const last = profileCandles[profileCandles.length - 1];
  return {
    from: first.timestamp,
    to: last.timestamp,
    priceMin: Math.min(...priceValues),
    priceMax: Math.max(...priceValues)
  };
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
    if (candles[index]?.isClosed !== false) {
      return candles[index]?.timestamp ?? null;
    }
  }
  return null;
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
  const tradePrice = scene.chart.streamState === "live" ? liveTradePrice(scene.chart.liveTrade) : null;
  const price = tradePrice ?? latest.close;
  const y = priceToY(scene, price);
  if (y < scene.plot.top - 1 || y > scene.plot.priceBottom + 1) {
    return null;
  }
  const priceText = priceFormatter.format(price);
  const isClosed = tradePrice === null ? latest.isClosed : false;
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

function currentPriceIntervalCanShowClock(interval: ChartInterval): boolean {
  return interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h";
}

function currentPriceMarkerLabelWidth(priceText: string, showClock: boolean): number {
  return Math.max(82, Math.min(138, priceText.length * 8 + (showClock ? 38 : 24)));
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

function viewportClampOptionsForChart(chart: ChartState, scene: ChartScene | null | undefined): ViewportClampOptions {
  const extraFutureSlots = scene ? Math.max(0, Math.ceil(scene.semantic.expansionExtraSlots)) : 0;
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
