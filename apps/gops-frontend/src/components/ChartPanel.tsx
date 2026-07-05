import {
  ArrowUpRight,
  Bot,
  CircleDot,
  Eraser,
  Hand,
  MousePointer2,
  Palette,
  Paintbrush,
  Square,
  Trash2,
  Type,
  X
} from "lucide-react";
import {
  type CSSProperties,
  forwardRef,
  PointerEvent as ReactPointerEvent,
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
  type ChartCommandType,
  type ChartDataStatus,
  type ChartDocument,
  type ChartRuntimeAction,
  type StreamStatus
} from "@gops/chart-engine";
import { requestChartAgentActions } from "../agent/chartAgent";
import { chartStateFromDocument } from "../chart/chartDocumentAdapter";
import { ChartCanvas } from "../chart/ChartCanvas";
import { fetchCandles, openChartSocket } from "../chart/cdcClient";
import {
  buildDraftPreviewDrawing,
  buildSingleAnchorPreviewDrawing,
  buildDraggedAnchors,
  defaultDrawingLabel,
  defaultDrawingStyle,
  drawingNeedsTwoAnchors,
  drawingTools,
  drawingTypeFromToolMode,
  hitTestDrawing,
  makeDrawing,
  sourceIntervalForDrawingAnchors,
  type DrawingDraft,
  type DrawingDrag
} from "../chart/drawings";
import { expansionCloseButtonSize, expansionMetadataCenterY, expansionParentThumbnailRight } from "../chart/expansionLayout";
import { createCoordinateTransform, hitTestSemanticNode, topPriceGridY, type ChartScene } from "../chart/scene";
import {
  anchoredViewportForCandles,
  viewportPreservingRightEdgeAfterCandlesChange,
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
import type { CandleDto, CandleEventDto, CandleFillTraceDto, CandleQueryResponseDto, ChartAction, ChartInterval, ChartLayerKey, ChartLineExtension, ChartState, ChartSymbolDto, ChartToolMode, DrawingEntity } from "../chart/types";
import { defaultVisibleBarsForInterval } from "../chart/types";
import {
  dragDeltaToRightOffset,
  horizontalWheelDeltaToRightOffset,
  normalizeViewport,
  resolveHorizontalWheelDelta,
  zoomViewport,
  zoomViewportAt,
  type ChartViewport,
  type ViewportClampOptions
} from "../chart/viewport";

function segmentedClass(active = false): string {
  return active ? "segmented active" : "segmented";
}

function iconButtonClass(active = false): string {
  return active ? "icon-button active" : "icon-button";
}

type DragAnchor = {
  x: number;
  y: number;
  rightOffset: number;
  visibleCount: number;
};

type PendingSemanticClick = {
  unit: SemanticRenderUnit;
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
  symbols: ChartSymbolDto[];
  laneHeight?: number;
  chartCommandActive?: boolean;
  chartCommandEnabled?: boolean;
  chartDrawingActive?: boolean;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartCommandToggle?: () => void;
  onChartDrawingToggle?: () => void;
  onSemanticSelectionChange?: (selection: SemanticSelectionSnapshot | null) => void;
  onChartHoverChange?: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
};

export type ChartPanelHandle = {
  runAgentPrompt: (prompt: string) => Promise<ChartAgentPromptResult>;
  getSnapshot: () => ChartState;
  setInterval: (interval: ChartInterval) => void;
};

export type ChartAgentPromptResult = {
  message: string;
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

const minLaneHeightForVolume = 245;
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
  symbols,
  laneHeight,
  chartCommandActive = false,
  chartCommandEnabled = true,
  chartDrawingActive = false,
  onChartRuntimeAction,
  onChartCommandToggle,
  onChartDrawingToggle,
  onSemanticSelectionChange,
  onChartHoverChange,
  onHeaderChange
}: ChartPanelProps, ref) {
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [activeExpansions, setActiveExpansions] = useState<SemanticExpansion[]>([]);
  const [hoveredSemanticNodeId, setHoveredSemanticNodeId] = useState<string | undefined>();
  const [hoverSnapshot, setHoverSnapshot] = useState<SemanticSelectionSnapshot | null>(null);
  const [selectedSemanticNode, setSelectedSemanticNode] = useState<SemanticSelectionSnapshot | null>(null);
  const [expansionOverlays, setExpansionOverlays] = useState<ExpansionOverlay[]>([]);
  const [hoverOhlcTop, setHoverOhlcTop] = useState(86);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | undefined>();
  const [drawingDraft, setDrawingDraft] = useState<DrawingDraft | null>(null);
  const [maMenuOpen, setMaMenuOpen] = useState(false);
  const [transientViewport, setTransientViewport] = useState<ChartViewport | null>(null);
  const [transientDrawings, setTransientDrawings] = useState<DrawingEntity[] | null>(null);
  const chart = useMemo(() => (
    chartStateFromDocument(document, candles, dataStatus, streamStatus, streamMessage)
  ), [candles, dataStatus, document, streamMessage, streamStatus]);
  const sceneRef = useRef<ChartScene | null>(null);
  const chartRef = useRef<ChartState>(chart);
  const activeExpansionsRef = useRef<SemanticExpansion[]>(activeExpansions);
  const olderRangeRequestsRef = useRef<Set<string>>(new Set());
  const pendingViewportAnchorRef = useRef<{ key: string; anchor: ViewportAnchor } | null>(null);
  const overlayKeyRef = useRef("");
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  const drawingDragRef = useRef<DrawingDrag | null>(null);
  const pendingSemanticClickRef = useRef<PendingSemanticClick | null>(null);
  const transientViewportRef = useRef<ChartViewport | null>(null);

  useEffect(() => {
    chartRef.current = chart;
  }, [chart]);

  useEffect(() => {
    activeExpansionsRef.current = activeExpansions;
  }, [activeExpansions]);

  const commandTarget = useMemo(() => ({
    panelId,
    chartDocumentId: document.id
  }), [document.id, panelId]);

  const dispatchDocumentCommand = useCallback((
    type: ChartCommandType,
    payload: Record<string, unknown> = {},
    actor: ChartCommandActor = "user"
  ) => {
    setDrawingDraft(null);
    setTransientDrawings(null);
    onChartRuntimeAction({
      kind: "chart.command",
      command: makeChartCommand(type, actor, commandTarget, payload)
    });
  }, [commandTarget, onChartRuntimeAction]);

  const dispatchDocumentCommandGroup = useCallback((
    commands: ChartCommand[],
    label: string
  ) => {
    if (!commands.length) {
      return;
    }
    setDrawingDraft(null);
    setTransientDrawings(null);
    onChartRuntimeAction({ kind: "chart.command.group", commands, label });
  }, [onChartRuntimeAction]);

  const loadOlderCandles = useCallback((
    symbol: string,
    interval: ChartInterval,
    before: string,
    limit: number
  ) => {
    const requestKey = `${symbol}:${interval}:before:${before}:${limit}`;
    if (olderRangeRequestsRef.current.has(requestKey)) {
      return;
    }
    olderRangeRequestsRef.current.add(requestKey);
    const controller = new AbortController();
    fetchCandles({
      symbol,
      interval,
      before,
      limit,
      ma: [5, 20, 60]
    }, controller.signal)
      .then((response) => {
        const current = chartRef.current;
        if (current.symbol !== symbol || current.interval !== interval) {
          return;
        }
        const merged = mergeCandlesByTimestamp(response.candles, current.candles);
        const plotWidth = sceneRef.current ? sceneRef.current.plot.right - sceneRef.current.plot.left : undefined;
        const nextViewport = viewportPreservingRightEdgeAfterCandlesChange(
          current.candles,
          merged,
          { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
          plotWidth
        );
        onChartRuntimeAction({ kind: "chart.snapshot.loaded", snapshot: candleSnapshotFromResponse(response) });
        dispatchDocumentCommand("chart.viewport.set", nextViewport);
      })
      .catch((error: unknown) => {
        onChartRuntimeAction({
          kind: "chart.snapshot.failed",
          symbol,
          interval,
          message: error instanceof Error ? error.message : "Historical range request failed"
        });
      })
      .finally(() => {
        olderRangeRequestsRef.current.delete(requestKey);
      });
  }, [dispatchDocumentCommand, onChartRuntimeAction]);

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = chartMemoryKey(chart.symbol, chart.interval);
    const pendingLoad = pendingViewportAnchorRef.current?.key === requestKey ? pendingViewportAnchorRef.current : null;
    onChartRuntimeAction({
      kind: "chart.data.status",
      symbol: chart.symbol,
      interval: chart.interval,
      status: { state: "loading", message: "Loading CDC candles..." }
    });
    fetchCandles({
      symbol: chart.symbol,
      interval: chart.interval,
      limit: defaultVisibleBarsForInterval(chart.interval),
      ma: [5, 20, 60]
    }, controller.signal)
      .then((response) => {
        const current = chartRef.current;
        const nextViewport = anchoredViewportForCandles(
          response.candles,
          current.interval,
          pendingLoad?.anchor ?? null,
          {
            visibleCount: current.visibleCount,
            rightOffset: current.rightOffset
          },
          sceneRef.current ? sceneRef.current.plot.right - sceneRef.current.plot.left : undefined
        );
        onChartRuntimeAction({ kind: "chart.snapshot.loaded", snapshot: candleSnapshotFromResponse(response) });
        dispatchDocumentCommand("chart.viewport.set", nextViewport);
        if (pendingViewportAnchorRef.current?.key === requestKey) {
          pendingViewportAnchorRef.current = null;
        }
      })
      .catch((error: unknown) => {
        onChartRuntimeAction({
          kind: "chart.snapshot.failed",
          symbol: chart.symbol,
          interval: chart.interval,
          message: error instanceof Error ? error.message : "Candle request failed"
        });
      });
    return () => controller.abort();
  }, [chart.interval, chart.symbol, dispatchDocumentCommand, onChartRuntimeAction]);

  useEffect(() => {
    const controller = new AbortController();
    setPreviousClose(null);
    fetchCandles({ symbol: chart.symbol, interval: "1D", limit: 5, ma: [] }, controller.signal)
      .then((response) => {
        const closed = [...response.candles].reverse().find((candle) => candle.isClosed && Number.isFinite(candle.close));
        setPreviousClose(closed?.close ?? null);
      })
      .catch(() => {
        setPreviousClose(null);
      });
    return () => controller.abort();
  }, [chart.symbol]);

  useEffect(() => {
    return openChartSocket(
      chart.symbol,
      chart.interval,
      (event) => onChartRuntimeAction({ kind: "chart.live", event: candleEventFromDto(event) }),
      (nextStreamState) => onChartRuntimeAction({
        kind: "chart.stream.status",
        symbol: chart.symbol,
        interval: chart.interval,
        status: normalizeStreamStatus(nextStreamState)
      })
    );
  }, [chart.interval, chart.symbol, onChartRuntimeAction]);

  useEffect(() => {
    onSemanticSelectionChange?.(selectedSemanticNode);
  }, [onSemanticSelectionChange, selectedSemanticNode]);

  useEffect(() => {
    if (typeof laneHeight !== "number" || laneHeight >= minLaneHeightForVolume) {
      return;
    }
    if (chart.layers.volume) {
      dispatchDocumentCommand("chart.layer.visibility.set", { layer: "volume", visible: false });
    }
  }, [chart.layers.volume, dispatchDocumentCommand, laneHeight]);

  const renderChart = useMemo(() => ({
    ...chart,
    visibleCount: transientViewport?.visibleCount ?? chart.visibleCount,
    rightOffset: transientViewport?.rightOffset ?? chart.rightOffset,
    drawings: transientDrawings ?? chart.drawings
  }), [chart, transientDrawings, transientViewport]);
  const renderExpansions = activeExpansions;
  const previewDrawings: DrawingEntity[] = [];
  const selectedDrawing = chart.drawings.find((drawing) => drawing.id === chart.selectedDrawingId);
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
    setMaMenuOpen(false);
  }, []);

  useEffect(() => {
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    pendingViewportAnchorRef.current = null;
    setDrawingDraft(null);
    setTransientDrawings(null);
    clearSemanticState();
  }, [chart.interval, chart.symbol, clearSemanticState]);

  const setInterval = useCallback((interval: ChartInterval) => {
    const current = chartRef.current;
    if (current.interval === interval) {
      return;
    }
    pendingViewportAnchorRef.current = {
      key: chartMemoryKey(current.symbol, interval),
      anchor: {
        mode: "right",
        timestamp: visibleRightAnchorTimestamp(sceneRef.current, current),
        visibleCount: defaultVisibleBarsForInterval(interval)
      }
    };
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    clearSemanticState();
    dispatchDocumentCommand("chart.timeframe.set", { timeframe: interval });
  }, [clearSemanticState, dispatchDocumentCommand]);

  const setToolMode = useCallback((toolMode: ChartToolMode) => {
    dispatchDocumentCommand("chart.drawing.clearSelection", { mode: toolMode });
  }, [dispatchDocumentCommand]);

  const setTrendLineExtension = useCallback((extension: ChartLineExtension) => {
    dispatchDocumentCommand("chart.drawing.clearSelection", { mode: "draw-trendLine", trendLineExtension: extension });
  }, [dispatchDocumentCommand]);

  const toggleLayer = useCallback((layer: ChartLayerKey) => {
    setDrawingDraft(null);
    setTransientDrawings(null);
    const enabled = !chartRef.current.layers[layer];
    if (layer === "volume" && enabled && typeof laneHeight === "number" && laneHeight < minLaneHeightForVolume) {
      return;
    }
    dispatchDocumentCommand("chart.layer.visibility.set", { layer, visible: enabled });
  }, [dispatchDocumentCommand, laneHeight]);

  const applyAgentActions = useCallback((actions: ChartAction[]) => {
    const commands = actionsToChartCommands(actions, chartRef.current, commandTarget, "llm");
    dispatchDocumentCommandGroup(commands, "Chart agent actions");
  }, [commandTarget, dispatchDocumentCommandGroup]);

  const applyViewport = useCallback((viewport: ChartViewport) => {
    const currentChart = chartRef.current;
    const currentScene = sceneRef.current;
    const plotWidth = currentScene ? currentScene.plot.right - currentScene.plot.left : undefined;
    const clampOptions = viewportClampOptionsForScene(currentScene);
    const requestedViewport = normalizeViewport(viewport, currentChart.candles.length, plotWidth, clampOptions);
    const maxRightOffset = Math.max(0, currentChart.candles.length - Math.min(requestedViewport.visibleCount, currentChart.candles.length));
    const oldest = currentChart.candles[0]?.timestamp;
    if (oldest && requestedViewport.rightOffset >= maxRightOffset - 1) {
      loadOlderCandles(
        currentChart.symbol,
        currentChart.interval,
        oldest,
        Math.max(defaultVisibleBarsForInterval(currentChart.interval), requestedViewport.visibleCount)
      );
    }
    const nextViewport = requestedViewport;
    if (nextViewport.visibleCount === currentChart.visibleCount && nextViewport.rightOffset === currentChart.rightOffset) {
      return;
    }
    dispatchDocumentCommand("chart.viewport.set", nextViewport);
  }, [dispatchDocumentCommand, loadOlderCandles]);

  const handleScene = useCallback((scene: ChartScene) => {
    sceneRef.current = scene;
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

  const selectSemanticUnit = useCallback((unit: SemanticRenderUnit) => {
    setSelectedSemanticNode(snapshotFromSemanticUnit(unit));
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
    if (expansion.childInterval === "footprint") {
      return;
    }
    const queryRange = childQueryRange({ from: expansion.from, to: expansion.to }, expansion.childInterval);
    try {
      const response = await fetchCandles({
        symbol,
        interval: expansion.childInterval,
        from: queryRange.from,
        to: queryRange.to,
        limit: expansionLimitForInterval(expansion.childInterval),
        ma: [5, 20, 60]
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
    selectSemanticUnit(unit);
    if (unit.kind !== "candle") {
      return;
    }
    const expansion = buildSemanticExpansion(unit);
    activeExpansionsRef.current = upsertExpansion(activeExpansionsRef.current, expansion);
    setActiveExpansions((current) => upsertExpansion(current, expansion));
    if (expansion.childInterval === "footprint") {
      setSelectedSemanticNode({
        ...snapshotFromSemanticUnit(unit),
        status: "ready"
      });
      return;
    }
    void loadExpansionCandles(expansion, unit.symbol);
  }, [loadExpansionCandles, selectSemanticUnit]);

  const zoomBy = useCallback((delta: number) => {
    const current = chartRef.current;
    const currentScene = sceneRef.current;
    const plotWidth = currentScene ? currentScene.plot.right - currentScene.plot.left : undefined;
    const nextViewport = zoomViewport(
      { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
      delta,
      current.candles.length,
      plotWidth,
      viewportClampOptionsForScene(currentScene)
    );
    applyViewport(nextViewport);
  }, [applyViewport]);

  const runAgentPrompt = useCallback(async (rawPrompt: string): Promise<ChartAgentPromptResult> => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return { message: "" };
    }
    const result = await requestChartAgentActions({ prompt, chart: chartRef.current });
    if (result.actions.length) {
      applyAgentActions(result.actions);
    }
    return { message: result.message };
  }, [applyAgentActions]);

  useImperativeHandle(ref, () => ({
    runAgentPrompt,
    getSnapshot: () => chartRef.current,
    setInterval
  }), [runAgentPrompt, setInterval]);

  const maLayerButtons = useMemo(() => ([
    ["ma5", "MA5"],
    ["ma20", "MA20"],
    ["ma60", "MA60"]
  ] as Array<[ChartLayerKey, string]>), []);
  const anyMaEnabled = chart.layers.ma5 || chart.layers.ma20 || chart.layers.ma60;

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    onChartHoverChange?.(true);
    const horizontalDelta = event.deltaX;
    const verticalDelta = event.deltaY;
    const deltaMode = event.deltaMode;
    const resolvedHorizontalDelta = resolveHorizontalWheelDelta(horizontalDelta, verticalDelta, event.shiftKey);
    const scene = sceneRef.current;
    if (resolvedHorizontalDelta !== null) {
      const plotWidth = scene ? Math.max(1, scene.plot.right - scene.plot.left) : undefined;
      const sceneSlotWidth = scene?.scales.slotWidth;
      const current = chartRef.current;
      const currentViewport = normalizeViewport(
        { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
        current.candles.length,
        plotWidth,
        viewportClampOptionsForScene(scene)
      );
      const slotWidth = sceneSlotWidth
        ?? Math.max(1, (plotWidth ?? currentViewport.visibleCount) / Math.max(1, currentViewport.visibleCount));
      const nextRightOffset = horizontalWheelDeltaToRightOffset(
        currentViewport.rightOffset,
        resolvedHorizontalDelta,
        slotWidth,
        currentViewport.visibleCount,
        current.candles.length,
        deltaMode,
        plotWidth,
        viewportClampOptionsForScene(scene)
      );
      applyViewport({
        visibleCount: currentViewport.visibleCount,
        rightOffset: nextRightOffset
      });
      return;
    }
    if (verticalDelta === 0) {
      return;
    }
    const step = Math.max(3, Math.round(chart.visibleCount * 0.12));
    const delta = verticalDelta > 0 ? step : -step;
    if (!scene) {
      zoomBy(delta);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const plotWidth = Math.max(1, scene.plot.right - scene.plot.left);
    const anchorRatio = (x - scene.plot.left) / plotWidth;
    const current = chartRef.current;
    const nextViewport = zoomViewportAt(
      { visibleCount: current.visibleCount, rightOffset: current.rightOffset },
      delta,
      current.candles.length,
      anchorRatio,
      plotWidth,
      viewportClampOptionsForScene(scene)
    );
    applyViewport(nextViewport);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    onChartHoverChange?.(true);
    if (event.button !== 0) {
      return;
    }
    setMaMenuOpen(false);
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const transform = createCoordinateTransform(scene);
    const semanticHit = hitTestSemanticNode(scene, point.x, point.y);

    if (chart.toolMode === "select") {
      const hit = hitTestDrawing(scene, point.x, point.y);
      if (!hit) {
        if (semanticHit) {
          pendingSemanticClickRef.current = { unit: semanticHit, x: event.clientX, y: event.clientY };
          selectSemanticUnit(semanticHit);
          return;
        }
        dispatchDocumentCommand("chart.drawing.clearSelection", { mode: chart.toolMode });
        return;
      }
      const anchor = transform.pointToAnchor(point.x, point.y, chart.symbol);
      if (anchor) {
        drawingDragRef.current = { drawing: hit.drawing, anchor, anchorIndex: hit.anchorIndex };
      }
      dispatchDocumentCommand("chart.drawing.select", { drawingId: hit.drawing.id });
      return;
    }

    const drawingType = drawingTypeFromToolMode(chart.toolMode);
    if (drawingType) {
      const anchor = transform.pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        return;
      }
      if (!drawingNeedsTwoAnchors(drawingType)) {
        const drawing = makeDrawing(drawingType, [anchor], {
          trendLineExtension: chart.trendLineExtension,
          sourceInterval: sourceIntervalForDrawingAnchors([anchor], chart.interval)
        });
        dispatchDocumentCommand("chart.drawing.add", { drawing });
        return;
      }
      if (drawingDraft?.type === drawingType) {
        const anchors = [drawingDraft.first, anchor];
        const drawing = makeDrawing(drawingType, anchors, {
          trendLineExtension: chart.trendLineExtension,
          sourceInterval: sourceIntervalForDrawingAnchors(anchors, chart.interval)
        });
        setDrawingDraft(null);
        setTransientDrawings(null);
        dispatchDocumentCommand("chart.drawing.add", { drawing });
      } else {
        setDrawingDraft({ type: drawingType, first: anchor, sourceInterval: sourceIntervalForDrawingAnchors([anchor], chart.interval) });
        setTransientDrawings(null);
      }
      return;
    }

    if (semanticHit) {
      pendingSemanticClickRef.current = { unit: semanticHit, x: event.clientX, y: event.clientY };
    }
    const currentViewport = normalizeViewport(
      { visibleCount: chart.visibleCount, rightOffset: chart.rightOffset },
      chart.candles.length,
      scene.plot.right - scene.plot.left,
      viewportClampOptionsForScene(scene)
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
    const semanticHit = hitTestSemanticNode(scene, point.x, point.y);
    setHoveredSemanticNodeId(semanticHit?.id);
    setHoverSnapshot(semanticHit ? snapshotFromSemanticUnit(semanticHit) : null);

    const drawingDrag = drawingDragRef.current;
    if (drawingDrag) {
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
    if (activeDrawingType && !drawingNeedsTwoAnchors(activeDrawingType)) {
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

    if (drawingDraft && chart.toolMode === `draw-${drawingDraft.type}`) {
      const anchor = createCoordinateTransform(scene).pointToAnchor(point.x, point.y, chart.symbol);
      if (!anchor) {
        setTransientDrawings(null);
        return;
      }
      setTransientDrawings([
        ...chart.drawings,
        buildDraftPreviewDrawing(drawingDraft, anchor, chart.trendLineExtension)
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
        viewportClampOptionsForScene(scene)
      )
    };
    transientViewportRef.current = nextViewport;
    setTransientViewport(nextViewport);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawingDrag = drawingDragRef.current;
    const dragAnchor = dragAnchorRef.current;
    const pendingSemanticClick = pendingSemanticClickRef.current;
    const nextViewport = transientViewportRef.current;
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    pendingSemanticClickRef.current = null;
    transientViewportRef.current = null;
    setTransientViewport(null);
    setTransientDrawings(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can be released by the browser before this handler runs.
    }
    if (drawingDrag) {
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
    if (pendingSemanticClick) {
      const distance = Math.hypot(event.clientX - pendingSemanticClick.x, event.clientY - pendingSemanticClick.y);
      if (distance <= 5) {
        void openSemanticExpansion(pendingSemanticClick.unit);
        return;
      }
    }
    if (dragAnchor && nextViewport && nextViewport.rightOffset !== dragAnchor.rightOffset) {
      applyViewport(nextViewport);
    }
  };

  const cancelDrag = () => {
    drawingDragRef.current = null;
    dragAnchorRef.current = null;
    pendingSemanticClickRef.current = null;
    transientViewportRef.current = null;
    setTransientViewport(null);
    setTransientDrawings(null);
    setHoveredSemanticNodeId(undefined);
    setHoverSnapshot(null);
    setCrosshair(undefined);
    onChartHoverChange?.(false);
  };

  const clearChartHover = useCallback(() => {
    if (dragAnchorRef.current || drawingDragRef.current) {
      return;
    }
    setHoveredSemanticNodeId(undefined);
    setHoverSnapshot(null);
    setCrosshair(undefined);
    onChartHoverChange?.(false);
  }, [onChartHoverChange]);

  const removeSelectedDrawing = () => {
    if (!selectedDrawing) {
      return;
    }
    dispatchDocumentCommand("chart.drawing.remove", { drawingId: selectedDrawing.id });
  };

  const updateSelectedDrawingStyle = () => {
    if (!selectedDrawing) {
      return;
    }
    const defaultStyle = defaultDrawingStyle(selectedDrawing.type, chart.trendLineExtension);
    const nextToken = selectedDrawing.style.colorToken === "down" ? defaultStyle.colorToken : "down";
    dispatchDocumentCommand("chart.drawing.update", {
      drawingId: selectedDrawing.id,
      drawingPatch: { style: { ...selectedDrawing.style, color: undefined, textColor: undefined, colorToken: nextToken, textToken: nextToken } }
    });
  };

  const clearAllDrawings = () => {
    setDrawingDraft(null);
    setTransientDrawings(null);
    const commands = chart.drawings.map((drawing) => makeChartCommand(
      "chart.drawing.remove",
      "user",
      commandTarget,
      { drawingId: drawing.id }
    ));
    dispatchDocumentCommandGroup(commands, "Clear drawings");
  };

  const hasAnyCurrentSymbolExpansion = activeExpansions.length > 0;

  const clearAllDigging = () => {
    activeExpansionsRef.current = [];
    setActiveExpansions([]);
    setSelectedSemanticNode(null);
    setExpansionOverlays([]);
  };

  return (
    <section className="chart-panel">
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

      <div className={chartCommandActive || chartDrawingActive ? "toolbar has-active-chart-target" : "toolbar"} aria-label="Chart controls">
        <div className="toolbar-row">
          <button className={segmentedClass(chart.layers.volume)} onClick={() => toggleLayer("volume")} type="button">
            VOL
          </button>
          <button className={segmentedClass()} disabled={!hasAnyCurrentSymbolExpansion} onClick={clearAllDigging} type="button" title="Clear all digging">
            DIG OFF
          </button>
          <div className="ma-control">
            <button
              type="button"
              className={segmentedClass(anyMaEnabled)}
              aria-expanded={maMenuOpen}
              onClick={() => {
                setMaMenuOpen((current) => !current);
              }}
            >
              MA
            </button>
            {maMenuOpen && (
              <div className="ma-menu" role="menu" aria-label="Moving averages">
                {maLayerButtons.map(([layer, label]) => (
                  <button
                    key={layer}
                    type="button"
                    className={segmentedClass(chart.layers[layer])}
                    onClick={() => toggleLayer(layer)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="toolbar-separator" aria-hidden="true" />
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
          <button
            type="button"
            className={`${iconButtonClass(chartCommandActive)} chart-command-target-button ${chartCommandActive ? "is-active" : ""}`}
            aria-label={chartCommandActive ? "차트 조작 Agent 대상 해제" : "차트 조작 Agent 대상으로 선택"}
            title={chartCommandActive ? "차트 조작 Agent 대상 해제" : "차트 조작 Agent 대상으로 선택"}
            aria-pressed={chartCommandActive}
            disabled={!chartCommandEnabled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onChartCommandToggle}
          >
            <Bot size={16} />
          </button>
          {drawingDraft && <span className="draft-pill">{defaultDrawingLabel(drawingDraft.type) ?? drawingDraft.type} 2nd point</span>}
        </div>
      </div>

      <div className="chart-wrap">
        <ChartCanvas
          chart={renderChart}
          expansions={renderExpansions}
          previewDrawings={previewDrawings}
          hoveredNodeId={hoveredSemanticNodeId}
          selectedNodeId={selectedSemanticNode?.nodeId}
          crosshair={crosshair}
          onScene={handleScene}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            setHoveredSemanticNodeId(undefined);
            setHoverSnapshot(null);
            if (!dragAnchorRef.current && !drawingDragRef.current) {
              onChartHoverChange?.(false);
            }
            if (!dragAnchorRef.current) {
              setCrosshair(undefined);
            }
            if (!dragAnchorRef.current && !drawingDragRef.current) {
              setTransientDrawings(null);
            }
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        />
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
      document.drawings.map((drawing) => makeChartCommand("chart.drawing.remove", "user", target, { drawingId: drawing.id })),
      "Clear drawings"
    );
  };

  return (
    <div className="chart-drawing-dock surface-floating" role="toolbar" aria-label="Chart drawing tools" onPointerDown={(event) => event.stopPropagation()}>
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

function mergeCandlesByTimestamp(...groups: CandleDto[][]): CandleDto[] {
  const byTimestamp = new Map<string, CandleDto>();
  groups.forEach((candles) => {
    candles.forEach((candle) => {
      byTimestamp.set(candle.timestamp, candle);
    });
  });
  return Array.from(byTimestamp.values()).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function candleSnapshotFromResponse(response: CandleQueryResponseDto): CandleSnapshot {
  return {
    symbol: response.symbol.toUpperCase(),
    interval: response.interval,
    source: "api",
    feed: "local",
    dataStatus: response.status === "pending" ? "partial" : response.status,
    sourceInterval: response.sourceInterval,
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
      ma: [5, 20, 60],
      volume: true
    },
    candles: response.candles
  };
}

function candleEventFromDto(event: CandleEventDto): CandleEvent {
  return {
    type: event.type,
    symbol: event.symbol.toUpperCase(),
    interval: event.interval,
    data: event.data
  };
}

function normalizeStreamStatus(status: ChartState["streamState"]): StreamStatus {
  return status === "connecting" || status === "idle" || status === "live" || status === "error" ? status : "idle";
}

function actionsToChartCommands(
  actions: ChartAction[],
  chart: ChartState,
  target: ChartCommand["target"],
  actor: ChartCommandActor
): ChartCommand[] {
  return actions.flatMap((action) => chartActionToCommands(action, chart, target, actor));
}

function chartActionToCommands(
  action: ChartAction,
  chart: ChartState,
  target: ChartCommand["target"],
  actor: ChartCommandActor
): ChartCommand[] {
  switch (action.type) {
    case "setSymbol":
      return [makeChartCommand("chart.symbol.set", actor, target, { symbol: action.symbol })];
    case "setInterval":
      return [makeChartCommand("chart.timeframe.set", actor, target, { timeframe: action.interval })];
    case "setTool":
      return [makeChartCommand("chart.drawing.clearSelection", actor, target, { mode: action.toolMode })];
    case "toggleLayer":
      return [makeChartCommand("chart.layer.visibility.set", actor, target, { layer: action.layer, visible: !chart.layers[action.layer] })];
    case "setLayer":
      return [makeChartCommand("chart.layer.visibility.set", actor, target, { layer: action.layer, visible: action.enabled })];
    case "setViewport":
      return [makeChartCommand("chart.viewport.set", actor, target, { visibleCount: action.visibleCount, rightOffset: action.rightOffset })];
    case "addDrawing":
      return [makeChartCommand("chart.drawing.add", actor, target, { drawing: action.drawing })];
    case "updateDrawing":
      return [makeChartCommand("chart.drawing.update", actor, target, { drawingId: action.drawingId, drawingPatch: action.patch })];
    case "deleteDrawing":
      return [makeChartCommand("chart.drawing.remove", actor, target, { drawingId: action.drawingId })];
    case "selectDrawing":
      return action.drawingId
        ? [makeChartCommand("chart.drawing.select", actor, target, { drawingId: action.drawingId })]
        : [makeChartCommand("chart.drawing.clearSelection", actor, target, { mode: chart.toolMode })];
    case "clearDrawings":
      return chart.drawings.map((drawing) => makeChartCommand("chart.drawing.remove", actor, target, { drawingId: drawing.id }));
    case "setVolumeRatio":
      return [];
    default:
      return [];
  }
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

function visibleRightAnchorTimestamp(scene: ChartScene | null, chart: ChartState): string | undefined {
  if (scene && scene.chart.symbol === chart.symbol && scene.chart.interval === chart.interval) {
    const index = Math.max(0, scene.visibleEndIndex - 1);
    return scene.allCandles[index]?.timestamp ?? chart.candles.at(-1)?.timestamp;
  }
  return chart.candles.at(-1)?.timestamp;
}

function viewportClampOptionsForScene(scene: ChartScene | null | undefined): ViewportClampOptions {
  if (!scene) {
    return {};
  }
  const extraFutureSlots = Math.max(0, Math.ceil(scene.semantic.expansionExtraSlots));
  return extraFutureSlots > 0 ? { extraFutureSlots } : {};
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
    status: childInterval === "footprint" ? "ready" : "loading",
    candles: [],
    openedAt: new Date().toISOString()
  };
}

function isDrawingAction(action: ChartAction): boolean {
  return action.type === "addDrawing" ||
    action.type === "updateDrawing" ||
    action.type === "deleteDrawing" ||
    action.type === "clearDrawings";
}

function changedPreviewDrawings(baseDrawings: DrawingEntity[], previewDrawings: DrawingEntity[]): DrawingEntity[] {
  return previewDrawings.filter((drawing) => {
    const base = baseDrawings.find((item) => item.id === drawing.id);
    return !base || JSON.stringify(base) !== JSON.stringify(drawing);
  });
}

function buildLiveQuote(chart: ChartState, previousClose: number | null): LiveQuote {
  if (chart.streamState !== "live" || !previousClose || previousClose <= 0) {
    return unavailableQuote;
  }
  const latest = chart.candles.at(-1);
  if (!latest || !Number.isFinite(latest.close)) {
    return unavailableQuote;
  }
  const change = latest.close - previousClose;
  const percent = (change / previousClose) * 100;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return {
    priceText: priceFormatter.format(latest.close),
    changeText: formatSignedNumber(change),
    percentText: `${formatSignedNumber(percent)}%`,
    tone
  };
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
    case "draw-trendLine":
      return <span className="tool-glyph diagonal-line" aria-hidden="true" />;
    case "draw-verticalMarker":
      return <span className="tool-glyph vertical-line" aria-hidden="true" />;
    case "draw-textLabel":
      return <Type size={16} />;
    case "draw-pointMarker":
      return <CircleDot size={16} />;
    case "draw-arrow":
      return <ArrowUpRight size={16} />;
    case "draw-rangeBox":
      return <Square size={16} />;
    default:
      return <MousePointer2 size={16} />;
  }
}

function applyCandleEvent(chart: ChartState, event: CandleEventDto): ChartState {
  if (event.symbol !== chart.symbol || event.interval !== chart.interval) {
    return chart;
  }
  const timestamp = event.data.timestamp;
  const nextCandle = { ...event.data };
  const candles = [...chart.candles].sort(compareCandles);
  const index = candles.findIndex((candle) => candle.timestamp === timestamp);
  if (index >= 0) {
    candles[index] = nextCandle;
    return { ...chart, candles: candles.sort(compareCandles), status: "ready" };
  }
  const latest = candles.at(-1);
  if (latest && Date.parse(timestamp) < Date.parse(latest.timestamp)) {
    return chart;
  }
  candles.push(nextCandle);
  return { ...chart, candles: candles.sort(compareCandles), status: "ready" };
}

function compareCandles(left: CandleDto, right: CandleDto): number {
  return Date.parse(left.timestamp) - Date.parse(right.timestamp);
}
