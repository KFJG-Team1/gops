import type { PointerEventHandler, WheelEventHandler } from "react";
import { useEffect, useRef } from "react";
import type { AgentVisualOverlay } from "../agent/agentVisualOverlay";
import type { ChartComparisonSeries, ChartState, DrawingEntity, IndicatorPointDto } from "./types";
import { buildChartScene, createCoordinateTransform, hitTestSemanticNode, hitTestTimeAxisUnit, priceToY, timestampAtUnitX, unitBoundsX, unitCenterX, type ChartScene } from "./scene";
import { normalizeLineExtension, projectTrendLine } from "./drawings";
import { resolveDrawingRenderItems, type DrawingRenderItem } from "./drawingProjection";
import { expansionMetadataTop, expansionParentCandleHeight, expansionParentCandleWidth, expansionSummaryVisibleBounds } from "./expansionLayout";
import { createIndicatorPointLookup, createIndicatorValueLookup } from "./indicatorSeries";
import {
  autoPriceStep,
  buildLadder,
  orderFlowWindowMinutesForInterval,
  rebinLevels,
  sessionDateFromTimestamp,
  sumOrderFlowBucketLevels,
  visibleScaleMax,
  type OrderFlowLadder,
  type OrderFlowLevelDto,
  type OrderFlowMinuteDto
} from "./orderFlow";
import { chartColumnTier, drawEstimatedBadge, drawOrderFlowChartColumn } from "./orderFlowRender";
import { formatSemanticTimestamp, type SemanticCandleUnit, type SemanticExpansion, type SemanticRenderUnit, type SemanticTimeGapUnit } from "./semanticTimeline";
import { readThemeColors, resolveRawPaletteColor, resolveThemeColor, type ThemeColors, type ThemeColorToken } from "../theme/colors";

type ChartCanvasProps = {
  chart: ChartState;
  expansions?: SemanticExpansion[];
  previewDrawings?: DrawingEntity[];
  agentVisualOverlays?: AgentVisualOverlay[];
  hoveredNodeId?: string;
  selectedNodeId?: string;
  emphasizeSelectedNode?: boolean;
  crosshair?: { x: number; y: number };
  onScene?: (scene: ChartScene) => void;
  onWheel?: WheelEventHandler<HTMLCanvasElement>;
  onPointerDown?: PointerEventHandler<HTMLCanvasElement>;
  onPointerMove?: PointerEventHandler<HTMLCanvasElement>;
  onPointerLeave?: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp?: PointerEventHandler<HTMLCanvasElement>;
  onPointerCancel?: PointerEventHandler<HTMLCanvasElement>;
  onLostPointerCapture?: PointerEventHandler<HTMLCanvasElement>;
};

let colors: ThemeColors;
const canvasFontFamily = "'Coinbase Sans', Inter, Arial, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const bollingerFillAlpha = 0.1;
const volumeProfileAlpha = {
  poc: 0.28,
  valueAreaBase: 0.12,
  valueAreaScale: 0.1,
  tailBase: 0.08,
  tailScale: 0.06,
  pocLine: 0.34,
  label: 0.84
} as const;
type OrderFlowBucket = {
  key: string;
  label: string;
  levels: OrderFlowLevelDto[];
};

const orderFlowBucketCache = new WeakMap<Map<string, OrderFlowMinuteDto>, Map<string, OrderFlowBucket>>();
const orderFlowLadderCache = new WeakMap<OrderFlowBucket, Map<number, OrderFlowLadder>>();

export function ChartCanvas({
  chart,
  expansions = [],
  previewDrawings = [],
  agentVisualOverlays = [],
  hoveredNodeId,
  selectedNodeId,
  emphasizeSelectedNode = false,
  crosshair,
  onScene,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let animationFrame: number | null = null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const scene = buildChartScene(chart, rect.width, rect.height, { expansions, hoveredNodeId, selectedNodeId, emphasizeSelectedNode });
      onScene?.(scene);
      drawChart(context, scene, crosshair, previewDrawings, agentVisualOverlays);
    };

    const scheduleDraw = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        draw();
      });
    };

    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    scheduleDraw();
    return () => {
      observer.disconnect();
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [agentVisualOverlays, chart, crosshair, emphasizeSelectedNode, expansions, hoveredNodeId, onScene, previewDrawings, selectedNodeId]);

  return (
    <canvas
      ref={canvasRef}
      className="chart-canvas"
      aria-label={`GOPS ${chart.chartType} chart`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    />
  );
}

function drawChart(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  crosshair?: { x: number; y: number },
  previewDrawings: DrawingEntity[] = [],
  agentVisualOverlays: AgentVisualOverlay[] = []
) {
  colors = readThemeColors();
  context.clearRect(0, 0, scene.width, scene.height);

  if (!scene.candles.length && !scene.semantic.units.length) {
    drawEmpty(context, scene.width, scene.height, scene.chart.message ?? "Waiting for chart data");
    return;
  }

  const layers: Array<() => void> = [
    () => drawExpansionRanges(context, scene, Boolean(crosshair)),
    () => drawTimeGrid(context, scene),
    () => drawGrid(context, scene),
    () => drawTimePeriodDividers(context, scene),
    () => drawAgentVisualOverlays(context, scene, agentVisualOverlays),
    () => hasVolumePane(scene) && drawPaneClipped(context, scene, paneById(scene, "volume"), () => drawVolume(context, scene)),
    () => drawPlotClipped(context, scene, () => drawVolumeProfile(context, scene)),
    () => drawPlotClipped(context, scene, () => drawMovingAverage(context, scene, "ma5", movingAverageLayerVisible(scene, "ma5"), colors.ma5)),
    () => drawPlotClipped(context, scene, () => drawMovingAverage(context, scene, "ma20", movingAverageLayerVisible(scene, "ma20"), colors.ma20)),
    () => drawPlotClipped(context, scene, () => drawMovingAverage(context, scene, "ma60", movingAverageLayerVisible(scene, "ma60"), colors.ma60)),
    () => drawPlotClipped(context, scene, () => drawLineIndicator(context, scene, "ema:20", Boolean(scene.chart.layers["ema:20"]), colors.signal)),
    () => drawPlotClipped(context, scene, () => drawLineIndicator(context, scene, "wma:20", Boolean(scene.chart.layers["wma:20"]), colors.caution)),
    () => drawPlotClipped(context, scene, () => drawBollinger(context, scene, "bollinger:20:2", Boolean(scene.chart.layers["bollinger:20:2"]))),
    () => basePriceLayerVisible(scene) && drawPlotClipped(context, scene, () => drawBasePriceLayer(context, scene)),
    () => drawPlotClipped(context, scene, () => drawComparisons(context, scene)),
    () => drawBelowIndicatorPanes(context, scene),
    () => drawExpansionParentSummaries(context, scene),
    () => drawAxes(context, scene),
    () => drawPriceAxis(context, scene),
    () => drawDrawingLabelsOnAxes(context, scene),
    () => drawCurrentPriceMarker(context, scene),
    () => drawOpenedDigMarkers(context, scene),
    () => drawCrosshair(context, scene, crosshair),
    () => drawLineHoverDot(context, scene, crosshair),
    () => drawTimeAxisDigHover(context, scene, crosshair),
    () => drawDrawings(context, scene, scene.chart.drawings, false),
    () => drawDrawings(context, scene, previewDrawings, true)
  ];
  layers.forEach((drawLayer) => drawLayer());
}

function basePriceLayerVisible(scene: ChartScene): boolean {
  return scene.chart.layers.candles !== false;
}

function movingAverageLayerVisible(scene: ChartScene, key: "ma5" | "ma20" | "ma60"): boolean {
  if (key === "ma5") {
    return Boolean(scene.chart.layers["sma:5"] ?? scene.chart.layers.ma5);
  }
  if (key === "ma20") {
    return Boolean(scene.chart.layers["sma:20"] ?? scene.chart.layers.ma20);
  }
  return Boolean(scene.chart.layers["sma:60"] ?? scene.chart.layers.ma60);
}

function drawBasePriceLayer(context: CanvasRenderingContext2D, scene: ChartScene) {
  if (scene.chart.chartType === "bidask") {
    drawOrderFlowColumns(context, scene);
    return;
  }
  if (scene.chart.chartType === "line") {
    drawLineChart(context, scene);
    return;
  }
  if (scene.chart.chartType === "ohlc") {
    drawOhlcBars(context, scene);
    drawCarryForwardGapCandles(context, scene, "ohlc");
    return;
  }
  drawCandles(context, scene);
  drawCarryForwardGapCandles(context, scene, "candle");
}

type ComparisonRenderPoint = {
  x: number;
  percent: number;
};

type ComparisonRenderSeries = {
  comparison: ChartComparisonSeries;
  segments: Array<{ points: ComparisonRenderPoint[] }>;
};

function drawComparisons(context: CanvasRenderingContext2D, scene: ChartScene) {
  const series = scene.chart.comparisons
    .map((comparison) => buildComparisonRenderSeries(scene, comparison))
    .filter((item) => item.segments.some((segment) => segment.points.length >= 2));
  const percents = series.flatMap((item) => item.segments.flatMap((segment) => segment.points.map((point) => point.percent)));
  if (!percents.length) {
    return;
  }
  const percentRange = comparisonPercentRange(percents);
  const zeroY = comparisonPercentToY(scene, 0, percentRange);

  context.save();
  if (zeroY >= scene.plot.top && zeroY <= scene.plot.priceBottom) {
    context.globalAlpha = 0.38;
    context.strokeStyle = colors.axis;
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    line(context, scene.plot.left, zeroY, scene.plot.right, zeroY);
  }
  context.restore();

  series.forEach((item, index) => {
    const fallbackToken = comparisonDefaultColorToken(index);
    const stroke = resolveDrawingColor(item.comparison.style, "colorToken", "color", fallbackToken);
    const text = resolveDrawingColor(item.comparison.style, "textToken", "textColor", fallbackToken);
    const allPoints = item.segments.flatMap((segment) => segment.points).sort((left, right) => left.x - right.x);
    const lastPoint = allPoints[allPoints.length - 1];
    context.save();
    context.globalAlpha = item.comparison.style.opacity ?? 0.92;
    context.strokeStyle = stroke;
    context.lineWidth = item.comparison.style.lineWidth ?? 1.45;
    context.setLineDash(item.comparison.style.lineDash ?? []);
    item.segments.forEach((segment) => {
      if (segment.points.length < 2) {
        return;
      }
      context.beginPath();
      segment.points.forEach((point, pointIndex) => {
        const y = comparisonPercentToY(scene, point.percent, percentRange);
        if (pointIndex === 0) {
          context.moveTo(point.x, y);
        } else {
          context.lineTo(point.x, y);
        }
      });
      context.stroke();
    });
    if (lastPoint) {
      const y = Math.max(scene.plot.top + 12, Math.min(scene.plot.priceBottom - 5, comparisonPercentToY(scene, lastPoint.percent, percentRange) - 7));
      context.globalAlpha = 0.98;
      context.fillStyle = text;
      context.font = "700 11px Inter, system-ui, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "middle";
      const label = `${item.comparison.label ?? item.comparison.symbol} ${lastPoint.percent >= 0 ? "+" : ""}${lastPoint.percent.toFixed(2)}%`;
      context.fillText(label, scene.plot.right - 4, y, 116);
    }
    context.restore();
  });
}

function buildComparisonRenderSeries(scene: ChartScene, comparison: ChartComparisonSeries): ComparisonRenderSeries {
  const scopes = comparison.scopes?.length
    ? comparison.scopes
    : [{
        key: `${comparison.symbol}:root`,
        interval: comparison.interval ?? scene.chart.interval,
        candles: comparison.candles,
        status: comparison.status
      }];
  const baseClose = comparisonBaseClose(scene, comparison, scopes);
  if (typeof baseClose !== "number" || !Number.isFinite(baseClose) || baseClose === 0) {
    return { comparison, segments: [] };
  }
  const units = candleUnits(scene).filter((unit) => semanticUnitVisibleInPlot(scene, unit));
  const segments = scopes.flatMap((scope) => {
    const candlesByTimestamp = new Map(scope.candles.map((candle) => [candle.timestamp, candle]));
    const scopeSegments: Array<{ points: ComparisonRenderPoint[] }> = [];
    let current: ComparisonRenderPoint[] = [];
    const flush = () => {
      if (current.length >= 2) {
        scopeSegments.push({ points: current });
      }
      current = [];
    };
    units.forEach((unit) => {
      if (!comparisonScopeMatchesUnit(scope, unit)) {
        flush();
        return;
      }
      const candle = candlesByTimestamp.get(unit.timestamp);
      if (!candle || !Number.isFinite(candle.close)) {
        flush();
        return;
      }
      current.push({
        x: unitCenterX(scene, unit),
        percent: ((candle.close - baseClose) / Math.max(0.0001, baseClose)) * 100
      });
    });
    flush();
    return scopeSegments;
  });
  return { comparison, segments };
}

function comparisonBaseClose(
  scene: ChartScene,
  comparison: ChartComparisonSeries,
  scopes: NonNullable<ChartComparisonSeries["scopes"]>
): number | null {
  if (comparison.base?.mode === "timestamp" && comparison.base.timestamp) {
    const timestampMatch = scopes
      .flatMap((scope) => scope.candles)
      .find((candle) => candle.timestamp === comparison.base?.timestamp);
    if (typeof timestampMatch?.close === "number" && Number.isFinite(timestampMatch.close)) {
      return timestampMatch.close;
    }
  }
  const units = candleUnits(scene).filter((unit) => semanticUnitVisibleInPlot(scene, unit));
  for (const unit of units) {
    for (const scope of scopes) {
      if (!comparisonScopeMatchesUnit(scope, unit)) {
        continue;
      }
      const candle = scope.candles.find((candidate) => candidate.timestamp === unit.timestamp);
      if (typeof candle?.close === "number" && Number.isFinite(candle.close)) {
        return candle.close;
      }
    }
  }
  return null;
}

function comparisonScopeMatchesUnit(
  scope: { interval: string; parentExpansionId?: string },
  unit: SemanticCandleUnit
): boolean {
  return scope.interval === unit.interval && (scope.parentExpansionId ?? undefined) === (unit.parentExpansionId ?? undefined);
}

function semanticUnitVisibleInPlot(scene: ChartScene, unit: SemanticCandleUnit): boolean {
  const bounds = unitBoundsX(scene, unit);
  return bounds.right >= scene.plot.left && bounds.left <= scene.plot.right;
}

function comparisonPercentRange(percents: number[]): { min: number; max: number } {
  const min = Math.min(-1, ...percents);
  const max = Math.max(1, ...percents);
  const pad = Math.max(0.25, (max - min) * 0.08);
  return { min: min - pad, max: max + pad };
}

function comparisonPercentToY(scene: ChartScene, percent: number, range: { min: number; max: number }): number {
  const span = Math.max(0.0001, range.max - range.min);
  return scene.plot.top + ((range.max - percent) / span) * Math.max(1, scene.plot.priceBottom - scene.plot.top);
}

function comparisonDefaultColorToken(index: number): ThemeColorToken {
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

function drawPlotClipped(context: CanvasRenderingContext2D, scene: ChartScene, draw: () => void) {
  context.save();
  context.beginPath();
  context.rect(scene.plot.left, 0, Math.max(1, scene.plot.right - scene.plot.left), scene.height);
  context.clip();
  draw();
  context.restore();
}

function drawPaneClipped(context: CanvasRenderingContext2D, scene: ChartScene, pane: ChartScene["plot"]["belowPanes"][number] | undefined, draw: () => void) {
  if (!pane) {
    return;
  }
  context.save();
  context.beginPath();
  context.rect(scene.plot.left, pane.top, Math.max(1, scene.plot.right - scene.plot.left), Math.max(1, pane.bottom - pane.top));
  context.clip();
  draw();
  context.restore();
}

function paneById(scene: ChartScene, id: string): ChartScene["plot"]["belowPanes"][number] | undefined {
  return scene.plot.belowPanes.find((pane) => pane.id === id);
}

function volumeY(scene: ChartScene, value: number): number {
  const pane = paneById(scene, "volume");
  if (!pane) {
    return scene.plot.bottom;
  }
  const range = Math.max(1, scene.scales.maxVolume);
  const height = Math.max(1, pane.bottom - pane.top);
  return pane.bottom - (Math.max(0, value) / range) * height;
}

function volumeAtY(scene: ChartScene, y: number): number {
  const pane = paneById(scene, "volume");
  if (!pane) {
    return 0;
  }
  const range = Math.max(1, scene.scales.maxVolume);
  const height = Math.max(1, pane.bottom - pane.top);
  const clampedY = Math.max(pane.top, Math.min(pane.bottom, y));
  return ((pane.bottom - clampedY) / height) * range;
}

function drawGrid(context: CanvasRenderingContext2D, scene: ChartScene) {
  context.save();
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  const right = horizontalGuideRight(scene);
  scene.scales.priceTicks.forEach((price) => {
    const y = priceToY(scene, price);
    line(context, scene.plot.left, y, right, y);
  });
  if (hasVolumePane(scene)) {
    scene.scales.volumeTicks.forEach((volume) => {
      line(context, scene.plot.left, volumeY(scene, volume), right, volumeY(scene, volume));
    });
  }
  if (scene.plot.belowPanes.length) {
    context.save();
    context.strokeStyle = colors.border;
    context.lineWidth = 1.2;
    line(context, scene.plot.left, scene.plot.priceBottom, right, scene.plot.priceBottom);
    scene.plot.belowPanes.slice(1).forEach((pane) => {
      line(context, scene.plot.left, pane.top - 3, right, pane.top - 3);
    });
    context.restore();
  }
  context.restore();
}

function drawAgentVisualOverlays(context: CanvasRenderingContext2D, scene: ChartScene, overlays: AgentVisualOverlay[]) {
  const active = overlays.filter((overlay) => !overlay.expiresAt || Date.parse(overlay.expiresAt) > Date.now());
  if (!active.length) {
    return;
  }
  context.save();
  active.forEach((overlay) => {
    const fill = overlayColor(overlay.styleToken);
    if (overlay.kind === "candleHighlight") {
      overlay.anchors.forEach((anchor) => {
        const unit = candleUnits(scene).find((item) => (
          item.symbol === anchor.symbol &&
          item.interval === anchor.interval &&
          item.timestamp === anchor.timestamp
        ));
        if (!unit) {
          return;
        }
        const bounds = unitBoundsX(scene, unit);
        drawOverlayBand(context, scene, bounds.left, bounds.right, fill, 0.16);
      });
      return;
    }
    overlay.anchors.forEach((anchor) => {
      const units = candleUnits(scene).filter((unit) => (
        unit.symbol === anchor.symbol &&
        unit.interval === anchor.interval &&
        rangesOverlap(unit.from, unit.to, anchor.from, anchor.to)
      ));
      if (!units.length) {
        return;
      }
      const left = Math.min(...units.map((unit) => unitBoundsX(scene, unit).left));
      const right = Math.max(...units.map((unit) => unitBoundsX(scene, unit).right));
      drawOverlayBand(context, scene, left, right, fill, 0.12);
    });
  });
  context.restore();
}

function drawOverlayBand(context: CanvasRenderingContext2D, scene: ChartScene, left: number, right: number, color: string, alpha: number) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(
    Math.max(scene.plot.left, left),
    scene.plot.top,
    Math.max(1, Math.min(scene.plot.right, right) - Math.max(scene.plot.left, left)),
    Math.max(1, scene.plot.priceBottom - scene.plot.top)
  );
  context.globalAlpha = Math.min(1, alpha + 0.14);
  context.strokeStyle = color;
  context.lineWidth = 1;
  line(context, Math.max(scene.plot.left, left), scene.plot.top, Math.max(scene.plot.left, left), scene.plot.priceBottom);
  line(context, Math.min(scene.plot.right, right), scene.plot.top, Math.min(scene.plot.right, right), scene.plot.priceBottom);
  context.restore();
}

function overlayColor(token: AgentVisualOverlay["styleToken"]): string {
  if (token === "caution") {
    return colors.caution;
  }
  if (token === "preview") {
    return colors.preview;
  }
  return colors.signal;
}

function rangesOverlap(leftFrom: string, leftTo: string, rightFrom: string, rightTo: string): boolean {
  const leftStart = Date.parse(leftFrom);
  const leftEnd = Date.parse(leftTo);
  const rightStart = Date.parse(rightFrom);
  const rightEnd = Date.parse(rightTo);
  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) {
    return leftFrom <= rightTo && rightFrom <= leftTo;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
}

function drawCandles(context: CanvasRenderingContext2D, scene: ChartScene) {
  candleUnits(scene).forEach((unit) => {
    const candle = unit.candle;
    const center = unitCenterX(scene, unit);
    const open = priceToY(scene, candle.open);
    const close = priceToY(scene, candle.close);
    const high = priceToY(scene, candle.high);
    const low = priceToY(scene, candle.low);
    const up = candle.close >= candle.open;
    const hovered = scene.hoveredNodeId === unit.id;
    const selected = scene.selectedNodeId === unit.id;
    const candleColor = selected ? colors.caution : candleStrokeColor(up);
    const candleWidth = candleBodyWidth(scene, unit, hovered);
    if (selected) {
      drawSelectedCandleHighlight(context, scene, unit);
    }
    context.save();
    context.strokeStyle = candleColor;
    context.fillStyle = candleColor;
    context.lineWidth = selected ? 2.4 : hovered ? 2.2 : 1.25;
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(2, Math.abs(close - open));
    const bodyBottom = bodyTop + bodyHeight;
    line(context, center, high, center, bodyTop);
    line(context, center, bodyBottom, center, low);
    context.fillRect(center - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    context.restore();
  });
}

function drawLineChart(context: CanvasRenderingContext2D, scene: ChartScene) {
  context.save();
  context.strokeStyle = colors.upSoft;
  context.lineWidth = 1.7;
  context.beginPath();
  let started = false;
  let lastSegmentKey = "";
  pricePathUnits(scene).forEach((unit) => {
    const segmentKey = pricePathSegmentKey(unit);
    if (started && segmentKey !== lastSegmentKey) {
      context.stroke();
      context.beginPath();
      started = false;
    }
    if (unit.kind === "time-gap") {
      const y = priceToY(scene, unit.carryPrice);
      const bounds = unitBoundsX(scene, unit);
      if (!started) {
        context.moveTo(bounds.left, y);
        started = true;
      } else {
        context.lineTo(bounds.left, y);
      }
      context.lineTo(bounds.right, y);
      lastSegmentKey = segmentKey;
      return;
    }
    const x = unitCenterX(scene, unit);
    const y = priceToY(scene, unit.candle.close);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
    lastSegmentKey = segmentKey;
  });
  if (started) {
    context.stroke();
  }
  context.restore();
}

function drawCarryForwardGapCandles(context: CanvasRenderingContext2D, scene: ChartScene, style: "candle" | "ohlc") {
  const gaps = timeGapUnits(scene).filter((unit) => Number.isFinite(unit.carryPrice));
  if (!gaps.length) {
    return;
  }
  context.save();
  context.strokeStyle = colors.upSoft;
  context.fillStyle = colors.upSoft;
  context.globalAlpha = 0.7;
  context.setLineDash([]);
  gaps.forEach((unit) => {
    const y = priceToY(scene, unit.carryPrice);
    carryForwardGapBars(scene, unit).forEach((bar) => {
      if (bar.right < scene.plot.left || bar.left > scene.plot.right || bar.width <= 0.4) {
        return;
      }
      if (style === "ohlc") {
        drawCarryForwardOhlcBar(context, bar, y);
        return;
      }
      drawCarryForwardCandle(context, bar, y);
    });
  });
  context.restore();
}

type CarryForwardGapBar = {
  left: number;
  right: number;
  center: number;
  width: number;
};

function carryForwardGapBars(scene: ChartScene, unit: SemanticTimeGapUnit): CarryForwardGapBar[] {
  const slotStart = unit.slotStart;
  const slotEnd = unit.slotEnd;
  const slotCount = Math.max(1, Math.ceil(Math.max(0.0001, slotEnd - slotStart)));
  const bars: CarryForwardGapBar[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const leftSlot = slotStart + index;
    const rightSlot = Math.min(slotEnd, leftSlot + 1);
    const left = scene.plot.left + leftSlot * scene.scales.slotWidth;
    const right = scene.plot.left + rightSlot * scene.scales.slotWidth;
    const visibleLeft = Math.max(scene.plot.left, left);
    const visibleRight = Math.min(scene.plot.right, right);
    bars.push({
      left: visibleLeft,
      right: visibleRight,
      center: (visibleLeft + visibleRight) / 2,
      width: Math.max(0, visibleRight - visibleLeft)
    });
  }
  return bars;
}

function drawCarryForwardCandle(context: CanvasRenderingContext2D, bar: CarryForwardGapBar, y: number) {
  const bodyWidth = Math.max(1, Math.min(72, bar.width * 0.78));
  const bodyHeight = Math.max(2, Math.min(4, bar.width * 0.24));
  const top = y - bodyHeight / 2;
  context.lineWidth = 1.1;
  context.fillRect(bar.center - bodyWidth / 2, top, bodyWidth, bodyHeight);
}

function drawCarryForwardOhlcBar(context: CanvasRenderingContext2D, bar: CarryForwardGapBar, y: number) {
  const tickWidth = Math.max(2, Math.min(12, bar.width * 0.36));
  context.lineWidth = 1.1;
  line(context, bar.center, y - 2, bar.center, y + 2);
  line(context, bar.center - tickWidth, y, bar.center, y);
  line(context, bar.center, y, bar.center + tickWidth, y);
}

function drawOhlcBars(context: CanvasRenderingContext2D, scene: ChartScene) {
  candleUnits(scene).forEach((unit) => {
    const candle = unit.candle;
    const center = unitCenterX(scene, unit);
    const open = priceToY(scene, candle.open);
    const close = priceToY(scene, candle.close);
    const high = priceToY(scene, candle.high);
    const low = priceToY(scene, candle.low);
    const up = candle.close >= candle.open;
    const hovered = scene.hoveredNodeId === unit.id;
    const selected = scene.selectedNodeId === unit.id;
    const tickWidth = Math.max(3, Math.min(12, candleBodyWidth(scene, unit, hovered) * 0.72));
    if (selected) {
      drawSelectedCandleHighlight(context, scene, unit);
    }
    context.save();
    context.strokeStyle = selected ? colors.caution : candleStrokeColor(up);
    context.lineWidth = selected ? 2.4 : hovered ? 2.2 : 1.35;
    line(context, center, high, center, low);
    line(context, center - tickWidth, open, center, open);
    line(context, center, close, center + tickWidth, close);
    context.restore();
  });
}

function candleStrokeColor(up: boolean): string {
  return up ? colors.upSoft : colors.downSoft;
}

function drawSelectedCandleHighlight(context: CanvasRenderingContext2D, scene: ChartScene, unit: SemanticCandleUnit) {
  const bounds = unitBoundsX(scene, unit);
  const emphasized = Boolean(scene.emphasizeSelectedNode);
  const left = Math.min(bounds.left, bounds.center - 4);
  const right = Math.max(bounds.right, bounds.center + 4);
  drawOverlayBand(context, scene, left, right, colors.caution, emphasized ? 0.36 : 0.18);
  if (emphasized) {
    // When a reference chip is hovered, outline the selected candle band so it reads
    // as strongly emphasized against the rest of the chart.
    const clampedLeft = Math.max(scene.plot.left, left);
    const clampedRight = Math.min(scene.plot.right, right);
    context.save();
    context.strokeStyle = colors.caution;
    context.lineWidth = 1.5;
    context.strokeRect(
      clampedLeft,
      scene.plot.top,
      Math.max(1, clampedRight - clampedLeft),
      Math.max(1, scene.plot.priceBottom - scene.plot.top)
    );
    context.restore();
  }
}

function drawOrderFlowColumns(context: CanvasRenderingContext2D, scene: ChartScene) {
  const orderFlow = scene.chart.orderFlow;
  if (!orderFlow) {
    drawOrderFlowState(context, scene, "오더플로우 데이터를 불러오는 중입니다");
    return;
  }
  const minutes = orderFlow.minutes;
  if (orderFlow.dataStatus === "unsupported") {
    drawOrderFlowState(context, scene, unsupportedOrderFlowMessage(scene.chart.symbol, orderFlow.supportedSymbols));
    return;
  }
  if (!minutes.size && orderFlow.dataStatus === "empty") {
    drawOrderFlowState(context, scene, "아직 수집된 오더플로우 데이터가 없어요");
    return;
  }
  if (!minutes.size) {
    drawOrderFlowState(context, scene, "오더플로우 데이터를 불러오는 중입니다");
    return;
  }

  const units = candleUnits(scene);
  const windowMinutes = orderFlowWindowMinutesForInterval(scene.chart.interval);
  const visibleBuckets = units
    .map((unit) => cachedOrderFlowBucket(minutes, unit, windowMinutes))
    .filter((bucket) => bucket.levels.length);
  const sourceStep = Math.max(0.01, orderFlow.priceBinSize);
  const displayStep = orderFlowDisplayStep(scene, sourceStep, visibleBuckets);
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  units.forEach((unit) => rects.set(unit.id, orderFlowColumnRect(scene, unit)));
  const positiveWidths = Array.from(rects.values()).map((rect) => rect.width).filter((width) => width > 0);
  const tier = chartColumnTier(positiveWidths.length ? Math.min(...positiveWidths) : 0);
  const drawable = units
    .map((unit) => {
      const bucket = cachedOrderFlowBucket(minutes, unit, windowMinutes);
      return bucket.levels.length
        ? { unit, bucket, ladder: cachedOrderFlowLadder(bucket, sourceStep, displayStep) }
        : null;
    })
    .filter((item): item is { unit: SemanticCandleUnit; bucket: OrderFlowBucket; ladder: OrderFlowLadder } => Boolean(item));
  const scaleMax = visibleScaleMax(drawable.map((item) => item.ladder));
  units.forEach((unit) => {
    const bucket = cachedOrderFlowBucket(minutes, unit, windowMinutes);
    if (!bucket.levels.length) {
      if (tier !== "micro") {
        drawOrderFlowGhostCandle(context, scene, unit);
      }
      return;
    }
    const rect = rects.get(unit.id) ?? orderFlowColumnRect(scene, unit);
    const ladder = cachedOrderFlowLadder(bucket, sourceStep, displayStep);
    drawOrderFlowChartColumn(context, rect, ladder, colors, {
      tier,
      scaleMax,
      priceToY: (price) => priceToY(scene, price),
      isLive: orderFlow.sessionDate === sessionDateFromTimestamp(unit.timestamp),
      selected: scene.selectedNodeId === unit.id
    });
  });
  drawEstimatedBadge(context, scene.plot.left + 7, scene.plot.top + 6, colors);
}

function orderFlowColumnRect(scene: ChartScene, unit: SemanticCandleUnit): { x: number; y: number; width: number; height: number } {
  const bounds = unitBoundsX(scene, unit);
  const x = Math.max(scene.plot.left, bounds.left + 1);
  return {
    x,
    y: scene.plot.top + 4,
    width: Math.max(2, Math.min(scene.plot.right, bounds.right - 1) - x),
    height: Math.max(16, scene.plot.priceBottom - scene.plot.top - 8)
  };
}

function cachedOrderFlowBucket(
  minutes: Map<string, OrderFlowMinuteDto>,
  unit: SemanticCandleUnit,
  windowMinutes: number
): OrderFlowBucket {
  let byKey = orderFlowBucketCache.get(minutes);
  if (!byKey) {
    byKey = new Map();
    orderFlowBucketCache.set(minutes, byKey);
  }
  const key = `${unit.timestamp}|${windowMinutes}`;
  const cached = byKey.get(key);
  if (cached) {
    return cached;
  }
  const bucket = {
    key,
    label: unit.timestamp,
    levels: sumOrderFlowBucketLevels(minutes, unit.timestamp, windowMinutes)
  };
  byKey.set(key, bucket);
  return bucket;
}

function cachedOrderFlowLadder(bucket: OrderFlowBucket, sourceStep: number, displayStep: number): OrderFlowLadder {
  let byStep = orderFlowLadderCache.get(bucket);
  if (!byStep) {
    byStep = new Map();
    orderFlowLadderCache.set(bucket, byStep);
  }
  const cached = byStep.get(displayStep);
  if (cached) {
    return cached;
  }
  const levels = rebinLevels(bucket.levels, sourceStep, displayStep);
  const ladder = buildLadder(levels, displayStep, bucket.label);
  byStep.set(displayStep, ladder);
  return ladder;
}

function orderFlowDisplayStep(scene: ChartScene, sourceStep: number, buckets: OrderFlowBucket[]): number {
  const visiblePrices = buckets.flatMap((bucket) => bucket.levels.map((level) => level.priceBin).filter((price) => Number.isFinite(price)));
  const dataPriceRange = visiblePrices.length
    ? Math.max(...visiblePrices) - Math.min(...visiblePrices)
    : 0;
  const priceRange = Math.max(0.01, dataPriceRange || scene.scales.maxPrice - scene.scales.minPrice);
  const rowBudget = Math.max(12, Math.min(64, Math.floor((scene.plot.priceBottom - scene.plot.top) / 6)));
  return Math.max(sourceStep, autoPriceStep(priceRange, rowBudget));
}

function drawOrderFlowState(context: CanvasRenderingContext2D, scene: ChartScene, message: string) {
  context.save();
  context.globalAlpha = 0.22;
  drawCandles(context, scene);
  context.globalAlpha = 0.88;
  context.fillStyle = colors.muted;
  context.font = `700 11px ${canvasFontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, (scene.plot.left + scene.plot.right) / 2, scene.plot.top + 30, Math.max(120, scene.plot.right - scene.plot.left - 18));
  drawEstimatedBadge(context, scene.plot.left + 7, scene.plot.top + 6, colors);
  context.restore();
}

function unsupportedOrderFlowMessage(symbol: string, supportedSymbols: string[] | undefined): string {
  const supported = supportedSymbols?.length ? ` · 지원: ${supportedSymbols.join(", ")}` : "";
  return `Order Flow는 아직 ${symbol.toUpperCase()}을 지원하지 않아요${supported}`;
}

function drawOrderFlowGhostCandle(context: CanvasRenderingContext2D, scene: ChartScene, unit: SemanticCandleUnit) {
  context.save();
  context.globalAlpha = 0.28;
  const center = unitCenterX(scene, unit);
  line(context, center, priceToY(scene, unit.candle.high), center, priceToY(scene, unit.candle.low));
  context.restore();
}

function drawVolume(context: CanvasRenderingContext2D, scene: ChartScene) {
  const pane = paneById(scene, "volume");
  if (!pane) {
    return;
  }
  candleUnits(scene).forEach((unit) => {
    const candle = unit.candle;
    const y = volumeY(scene, candle.volume);
    const hovered = scene.hoveredNodeId === unit.id;
    context.save();
    const bodyWidth = candleBodyWidth(scene, unit, hovered);
    context.fillStyle = colors.volume;
    context.fillRect(
      unitCenterX(scene, unit) - bodyWidth / 2,
      y,
      bodyWidth,
      pane.bottom - y
    );
    context.restore();
  });
}

function drawMovingAverage(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  key: "ma5" | "ma20" | "ma60",
  enabled: boolean,
  stroke: string
) {
  if (!enabled) {
    return;
  }
  const serverValueForUnit = createIndicatorValueLookup(scene.chart.indicatorSeries, movingAverageLayerId(key), scene.chart.interval);
  context.save();
  context.strokeStyle = stroke;
  context.lineWidth = 1.05;
  let started = false;
  let lastSegmentKey = "";
  context.beginPath();
  candleUnits(scene).forEach((unit) => {
    const candle = unit.candle;
    const serverValue = serverValueForUnit(unit);
    const value = typeof serverValue === "number"
      ? serverValue
      : candle[key];
    const segmentKey = `${unit.parentExpansionId ?? "root"}:${unit.interval}`;
    if (typeof value !== "number") {
      if (started) {
        context.stroke();
        context.beginPath();
        started = false;
      }
      return;
    }
    if (started && segmentKey !== lastSegmentKey) {
      context.stroke();
      context.beginPath();
      started = false;
    }
    const x = unitCenterX(scene, unit);
    const y = priceToY(scene, value);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
    lastSegmentKey = segmentKey;
  });
  if (started) {
    context.stroke();
  }
  context.restore();
}

function movingAverageLayerId(key: "ma5" | "ma20" | "ma60"): "sma:5" | "sma:20" | "sma:60" {
  if (key === "ma5") {
    return "sma:5";
  }
  if (key === "ma20") {
    return "sma:20";
  }
  return "sma:60";
}

function drawLineIndicator(context: CanvasRenderingContext2D, scene: ChartScene, layerId: string, enabled: boolean, stroke: string) {
  if (!enabled) {
    return;
  }
  const valueForUnit = createIndicatorValueLookup(scene.chart.indicatorSeries, layerId, scene.chart.interval);
  drawSeriesLine(context, scene, valueForUnit, (value) => priceToY(scene, value), stroke, 1.05);
}

function drawBollinger(context: CanvasRenderingContext2D, scene: ChartScene, layerId: string, enabled: boolean) {
  if (!enabled) {
    return;
  }
  const pointForUnit = createIndicatorPointLookup(scene.chart.indicatorSeries, layerId, scene.chart.interval);
  const units = candleUnits(scene);

  // 1. Draw transparent area between upper and lower bands.
  context.save();
  context.beginPath();
  let started = false;

  units.forEach((unit) => {
    const pt = pointForUnit(unit);
    if (typeof pt?.upper === "number" && Number.isFinite(pt.upper)) {
      const x = unitCenterX(scene, unit);
      const y = priceToY(scene, pt.upper);
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    }
  });

  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    const pt = pointForUnit(unit);
    if (typeof pt?.lower === "number" && Number.isFinite(pt.lower)) {
      const x = unitCenterX(scene, unit);
      const y = priceToY(scene, pt.lower);
      context.lineTo(x, y);
    }
  }

  if (started) {
    context.closePath();
    context.fillStyle = colors.purple;
    context.globalAlpha = bollingerFillAlpha;
    context.fill();
  }
  context.restore();

  // 2. Draw upper and lower lines.
  drawSeriesLine(
    context,
    scene,
    (unit) => pointForUnit(unit)?.upper,
    (value) => priceToY(scene, value),
    colors.purple,
    1.25,
    { connectAcrossMissing: true }
  );
  drawSeriesLine(
    context,
    scene,
    (unit) => pointForUnit(unit)?.lower,
    (value) => priceToY(scene, value),
    colors.purple,
    1.25,
    { connectAcrossMissing: true }
  );

  // 3. Draw middle line (굵은 점선)
  context.save();
  context.setLineDash([6, 4]);
  drawSeriesLine(
    context,
    scene,
    (unit) => pointForUnit(unit)?.middle,
    (value) => priceToY(scene, value),
    colors.purple,
    1.8,
    { connectAcrossMissing: true }
  );
  context.restore();
}

function drawVolumeProfile(context: CanvasRenderingContext2D, scene: ChartScene) {
  // Phase 2 candidate: adopt tick-based order-flow bins when symbol coverage allows.
  const profile = scene.chart.volumeProfile;
  if (!scene.chart.layers["volume-profile"] || !profile?.bins?.length || profile.totalVolume <= 0) {
    return;
  }
  const maxVolume = Math.max(...profile.bins.map((bucket) => bucket.volume));
  if (!Number.isFinite(maxVolume) || maxVolume <= 0) {
    return;
  }
  const plotWidth = Math.max(1, scene.plot.right - scene.plot.left);
  const profileLeft = scene.plot.left + 8;
  const profileWidth = Math.max(1, Math.min(920, Math.max(320, plotWidth * 0.82), plotWidth - 16));
  const right = profileLeft + profileWidth;
  context.save();
  profile.bins.forEach((bucket) => {
    const yTop = Math.max(scene.plot.top, Math.min(scene.plot.priceBottom, priceToY(scene, bucket.priceMax)));
    const yBottom = Math.max(scene.plot.top, Math.min(scene.plot.priceBottom, priceToY(scene, bucket.priceMin)));
    const top = Math.min(yTop, yBottom);
    const bottom = Math.max(yTop, yBottom);
    const height = Math.max(2, bottom - top - 1);
    if (!Number.isFinite(bucket.volume) || bucket.volume <= 0) {
      return;
    }
    const normalizedVolume = Math.max(0, Math.min(1, bucket.volume / maxVolume));
    const width = Math.max(4, profileWidth * normalizedVolume);
    context.globalAlpha = bucket.isPoc
      ? volumeProfileAlpha.poc
      : bucket.inValueArea
        ? volumeProfileAlpha.valueAreaBase + normalizedVolume * volumeProfileAlpha.valueAreaScale
        : volumeProfileAlpha.tailBase + normalizedVolume * volumeProfileAlpha.tailScale;
    context.fillStyle = colors.purple;
    context.fillRect(profileLeft, top, width, height);
  });
  if (profile.poc) {
    const y = priceToY(scene, profile.poc.priceMid);
    context.globalAlpha = volumeProfileAlpha.pocLine;
    context.strokeStyle = colors.purple;
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    line(context, profileLeft, y, right, y);
    context.setLineDash([]);
  }
  context.globalAlpha = volumeProfileAlpha.label;
  context.fillStyle = colors.muted;
  context.font = "10px Inter, system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(profile.sideClassification === "estimated" ? "Estimated VP" : "VP", profileLeft, scene.plot.top + 6);
  context.restore();
}

function drawBelowIndicatorPanes(context: CanvasRenderingContext2D, scene: ChartScene) {
  scene.plot.belowPanes.forEach((pane) => {
    if (pane.id === "volume") {
      return;
    }
    drawPaneClipped(context, scene, pane, () => drawBelowIndicatorPane(context, scene, pane));
    drawPaneLabel(context, pane, indicatorPaneLabel(pane.id));
  });
}

function drawBelowIndicatorPane(context: CanvasRenderingContext2D, scene: ChartScene, pane: ChartScene["plot"]["belowPanes"][number]) {
  if (pane.id === "rsi:14") {
    const domain = { min: 0, max: 100 };
    drawPaneGuide(context, scene, pane, domain, 70);
    drawPaneGuide(context, scene, pane, domain, 30);
    drawPaneSeries(context, scene, pane, pane.id, "value", domain, colors.signal);
    return;
  }
  if (pane.id === "stochastic:14:3:3") {
    const domain = { min: 0, max: 100 };
    drawPaneGuide(context, scene, pane, domain, 80);
    drawPaneGuide(context, scene, pane, domain, 20);
    drawPaneSeries(context, scene, pane, pane.id, "k", domain, colors.caution);
    drawPaneSeries(context, scene, pane, pane.id, "d", domain, colors.purple);
    return;
  }
  if (pane.id === "macd:12:26:9") {
    const domain = macdDomain(scene, pane.id);
    drawPaneGuide(context, scene, pane, domain, 0);
    drawMacdHistogram(context, scene, pane, pane.id, domain);
    drawPaneSeries(context, scene, pane, pane.id, "macd", domain, colors.caution);
    drawPaneSeries(context, scene, pane, pane.id, "signal", domain, colors.signal);
  }
}

function drawPaneSeries(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  pane: ChartScene["plot"]["belowPanes"][number],
  layerId: string,
  field: keyof IndicatorPointDto,
  domain: { min: number; max: number },
  stroke: string
) {
  const pointForUnit = createIndicatorPointLookup(scene.chart.indicatorSeries, layerId, scene.chart.interval);
  drawSeriesLine(
    context,
    scene,
    (unit) => {
      const value = pointForUnit(unit)?.[field];
      return typeof value === "number" ? value : undefined;
    },
    (value) => indicatorY(pane, domain, value),
    stroke,
    1.05
  );
}

type DrawSeriesLineOptions = {
  connectAcrossMissing?: boolean;
};

function drawSeriesLine(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  valueForUnit: (unit: SemanticCandleUnit) => number | null | undefined,
  yForValue: (value: number) => number,
  stroke: string,
  width: number,
  options: DrawSeriesLineOptions = {}
) {
  context.save();
  context.strokeStyle = stroke;
  context.lineWidth = width;
  let started = false;
  let lastSegmentKey = "";
  context.beginPath();
  candleUnits(scene).forEach((unit) => {
    const value = valueForUnit(unit);
    const segmentKey = `${unit.parentExpansionId ?? "root"}:${unit.interval}`;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (!options.connectAcrossMissing && started) {
        context.stroke();
        context.beginPath();
        started = false;
      }
      return;
    }
    if (started && segmentKey !== lastSegmentKey) {
      context.stroke();
      context.beginPath();
      started = false;
    }
    const x = unitCenterX(scene, unit);
    const y = yForValue(value);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
    lastSegmentKey = segmentKey;
  });
  if (started) {
    context.stroke();
  }
  context.restore();
}

function drawPaneGuide(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  pane: ChartScene["plot"]["belowPanes"][number],
  domain: { min: number; max: number },
  value: number
) {
  context.save();
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  line(context, scene.plot.left, indicatorY(pane, domain, value), horizontalGuideRight(scene), indicatorY(pane, domain, value));
  context.restore();
}

function drawPaneLabel(context: CanvasRenderingContext2D, pane: ChartScene["plot"]["belowPanes"][number], label: string) {
  context.save();
  context.font = "700 9px var(--font-data-sans)";
  context.fillStyle = colors.axis;
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillText(label, Math.max(0, paneRightForLabel(context)), pane.top + 3);
  context.restore();
}

function paneRightForLabel(context: CanvasRenderingContext2D): number {
  return Math.max(40, context.canvas.clientWidth - 68);
}

function indicatorPaneLabel(id: string): string {
  if (id === "rsi:14") {
    return "RSI 14";
  }
  if (id === "stochastic:14:3:3") {
    return "STOCH 14,3,3";
  }
  if (id === "macd:12:26:9") {
    return "MACD 12,26,9";
  }
  return id.toUpperCase();
}

function indicatorY(pane: ChartScene["plot"]["belowPanes"][number], domain: { min: number; max: number }, value: number): number {
  const range = Math.max(0.0001, domain.max - domain.min);
  return pane.bottom - ((value - domain.min) / range) * Math.max(1, pane.bottom - pane.top);
}

function macdDomain(scene: ChartScene, layerId: string): { min: number; max: number } {
  const pointForUnit = createIndicatorPointLookup(scene.chart.indicatorSeries, layerId, scene.chart.interval);
  const values = candleUnits(scene)
    .flatMap((unit) => {
      const point = pointForUnit(unit);
      return [point?.macd, point?.signal, point?.histogram];
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) {
    return { min: -1, max: 1 };
  }
  const maxAbs = Math.max(0.01, ...values.map((value) => Math.abs(value)));
  return { min: -maxAbs * 1.15, max: maxAbs * 1.15 };
}

function drawMacdHistogram(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  pane: ChartScene["plot"]["belowPanes"][number],
  layerId: string,
  domain: { min: number; max: number }
) {
  const pointForUnit = createIndicatorPointLookup(scene.chart.indicatorSeries, layerId, scene.chart.interval);
  const zeroY = indicatorY(pane, domain, 0);
  candleUnits(scene).forEach((unit) => {
    const histogram = pointForUnit(unit)?.histogram;
    if (typeof histogram !== "number" || !Number.isFinite(histogram)) {
      return;
    }
    const y = indicatorY(pane, domain, histogram);
    const width = Math.max(1, Math.min(9, candleBodyWidth(scene, unit) * 0.72));
    context.save();
    context.fillStyle = histogram >= 0 ? colors.upSoft : colors.downSoft;
    context.globalAlpha = 0.55;
    context.fillRect(unitCenterX(scene, unit) - width / 2, Math.min(y, zeroY), width, Math.max(1, Math.abs(zeroY - y)));
    context.restore();
  });
}

function drawDrawings(context: CanvasRenderingContext2D, scene: ChartScene, drawings: DrawingEntity[], previewLayer: boolean) {
  const transform = createCoordinateTransform(scene);
  const renderItems = resolveDrawingRenderItems(scene, drawings, { enableSemanticProjection: !previewLayer });
  const fullDrawingIds = new Set(renderItems.filter((item) => item.kind === "full").map((item) => item.drawing.id));
  drawings.filter((drawing) => drawing.visible !== false && fullDrawingIds.has(drawing.id)).forEach((drawing) => {
    const selected = !previewLayer && scene.chart.selectedDrawingId === drawing.id;
    const preview = previewLayer || drawing.id === "drawing-draft-preview";
    const style = drawing.style ?? {};
    const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is { x: number; y: number } => Boolean(point));
    const strokeColor = resolveDrawingColor(style, "colorToken", "color", preview ? "preview" : "drawing");

    context.save();
    context.globalAlpha = preview ? 0.58 : style.opacity ?? 1;
    context.strokeStyle = strokeColor;
    context.fillStyle = resolveDrawingColor(style, "fillToken", "fillColor", preview ? "preview" : "drawing");
    context.lineWidth = selected ? Math.max(1.8, style.lineWidth ?? 1.0) : style.lineWidth ?? 1.0;
    context.setLineDash(preview ? [6, 4] : style.lineDash ?? []);

    if (drawing.type === "horizontalLine" && points[0]) {
      line(context, scene.plot.left, points[0].y, horizontalGuideRight(scene), points[0].y);
      drawDrawingLabel(context, drawing.label, scene.plot.right - 54, points[0].y - 8, drawing);
    } else if (drawing.type === "verticalMarker" && points[0]) {
      line(context, points[0].x, scene.plot.top, points[0].x, scene.plot.priceBottom);
      drawDrawingLabel(context, drawing.label, points[0].x + 5, scene.plot.top + 12, drawing);
    } else if (drawing.type === "trendLine" && points.length >= 2) {
      const [start, end] = projectTrendLine(points[0], points[1], scene.plot, normalizeLineExtension(style.extension));
      line(context, start.x, start.y, end.x, end.y);
      drawDrawingLabel(context, drawing.label ?? lineMetricLabel(drawing), (start.x + end.x) / 2, (start.y + end.y) / 2 - 8, drawing);
    } else if (drawing.type === "rangeBox" && points.length >= 2) {
      const x = Math.min(points[0].x, points[1].x);
      const y = Math.min(points[0].y, points[1].y);
      const width = Math.abs(points[1].x - points[0].x);
      const height = Math.abs(points[1].y - points[0].y);
      const previousAlpha = context.globalAlpha;
      context.globalAlpha = previousAlpha * (style.fillOpacity ?? (preview ? 0.22 : 0.14));
      context.fillRect(x, y, width, height);
      context.globalAlpha = previousAlpha;
      context.strokeRect(x, y, width, height);
      drawDrawingLabel(context, drawing.label, x + 5, y + 13, drawing);
    } else if ((drawing.type === "pointMarker" || drawing.type === "textLabel") && points[0]) {
      circle(context, points[0].x, points[0].y, drawing.type === "pointMarker" ? 4 : 3);
      context.fill();
      drawDrawingLabel(context, drawing.label ?? (drawing.type === "textLabel" ? "메모" : ""), points[0].x + 7, points[0].y - 7, drawing);
    }

    if (selected && points.length) {
      context.setLineDash([]);
      context.fillStyle = colors.surface;
      context.strokeStyle = colors.drawing;
      points.forEach((point) => {
        circle(context, point.x, point.y, 4);
        context.fill();
        context.stroke();
      });
    }
    context.restore();
  });

  renderItems.forEach((item) => {
    if (item.kind === "timeWarpedLine") {
      drawTimeWarpedLine(context, scene, item, previewLayer);
    } else if (item.kind === "expansionProjection") {
      drawExpansionProjectionDrawing(context, scene, item, previewLayer);
    } else if (item.kind === "collapsed") {
      drawCollapsedDrawing(context, scene, item, previewLayer);
    }
  });
}

function drawTimeWarpedLine(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  item: Extract<DrawingRenderItem, { kind: "timeWarpedLine" }>,
  previewLayer: boolean
) {
  if (item.points.length < 2) {
    return;
  }
  const drawing = item.drawing;
  const selected = !previewLayer && scene.chart.selectedDrawingId === drawing.id;
  const preview = previewLayer || drawing.id === "drawing-draft-preview";
  const style = drawing.style ?? {};
  context.save();
  context.globalAlpha = preview ? 0.58 : style.opacity ?? 1;
  context.strokeStyle = resolveDrawingColor(style, "colorToken", "color", preview ? "preview" : "drawing");
  context.fillStyle = context.strokeStyle;
  context.lineWidth = selected ? Math.max(2.2, style.lineWidth ?? 1.5) : style.lineWidth ?? 1.5;
  context.setLineDash(preview ? [6, 4] : style.lineDash ?? []);
  context.beginPath();
  item.points.forEach((point, index) => {
    const x = Math.round(point.x) + 0.5;
    const y = Math.round(point.y) + 0.5;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  const midpoint = item.points[Math.floor((item.points.length - 1) / 2)];
  if (midpoint) {
    drawDrawingLabel(context, item.label ?? lineMetricLabel(drawing), midpoint.x + 5, midpoint.y - 8, drawing);
  }
  if (selected) {
    context.setLineDash([]);
    context.fillStyle = colors.surface;
    context.strokeStyle = colors.drawing;
    [item.points[0], item.points[item.points.length - 1]].forEach((point) => {
      circle(context, point.x, point.y, 4);
      context.fill();
      context.stroke();
    });
  }
  context.restore();
}

function drawExpansionProjectionDrawing(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  item: Extract<DrawingRenderItem, { kind: "expansionProjection" }>,
  preview: boolean
) {
  const style = item.drawing.style ?? {};
  const left = Math.max(scene.plot.left, Math.min(scene.plot.right, item.left));
  const right = Math.max(scene.plot.left, Math.min(scene.plot.right, item.right));
  const width = right - left;
  const top = Math.max(scene.plot.top, Math.min(scene.plot.priceBottom, item.top));
  const bottom = Math.max(scene.plot.top, Math.min(scene.plot.priceBottom, item.bottom));
  const height = bottom - top;
  if (width <= 3 || height <= 1) {
    return;
  }

  context.save();
  context.strokeStyle = resolveDrawingColor(style, "colorToken", "color", preview ? "preview" : "drawing");
  context.fillStyle = resolveDrawingColor(style, "fillToken", "fillColor", preview ? "preview" : "drawing");
  context.lineWidth = style.lineWidth ?? 1.4;
  context.setLineDash(style.lineDash ?? [5, 3]);
  const previousAlpha = context.globalAlpha;
  context.globalAlpha = previousAlpha * (style.fillOpacity ?? 0.1);
  context.fillRect(left, top, width, height);
  context.globalAlpha = previousAlpha * (style.opacity ?? 1) * 0.82;
  context.strokeRect(left, top, width, height);
  context.setLineDash([]);
  drawDrawingLabel(context, item.label, left + 5, top + 13, item.drawing);
  context.restore();
}

function drawCollapsedDrawing(
  context: CanvasRenderingContext2D,
  scene: ChartScene,
  item: Extract<DrawingRenderItem, { kind: "collapsed" }>,
  preview: boolean
) {
  const style = item.drawing.style ?? {};
  const x = Math.max(scene.plot.left + 8, Math.min(scene.plot.right - 8, item.x));
  const y = Math.max(scene.plot.top + 10, Math.min(scene.plot.priceBottom - 10, item.y));
  context.save();
  context.globalAlpha = preview ? 0.58 : style.opacity ?? 0.78;
  context.strokeStyle = resolveDrawingColor(style, "colorToken", "color", preview ? "preview" : "drawing");
  context.fillStyle = colors.surfaceStrong;
  context.lineWidth = 1.2;
  context.setLineDash([3, 3]);
  line(context, x, scene.plot.top, x, scene.plot.priceBottom);
  context.setLineDash([]);
  circle(context, x, y, 4);
  context.fill();
  context.stroke();
  drawDrawingLabel(context, item.label, x + 7, y - 7, item.drawing);
  context.restore();
}

function drawDrawingLabel(context: CanvasRenderingContext2D, label: string | undefined, x: number, y: number, drawing: DrawingEntity) {
  if (!label) {
    return;
  }
  const style = drawing.style ?? {};
  context.fillStyle = resolveDrawingColor(style, "textToken", "textColor", "drawing");
  context.font = `${style.fontSize ?? 11}px Inter, system-ui, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, x, y);
}

function lineMetricLabel(drawing: DrawingEntity): string | undefined {
  if (drawing.type !== "trendLine") {
    return undefined;
  }
  const [start, end] = drawing.anchors;
  if (typeof start?.price !== "number" || typeof end?.price !== "number") {
    return undefined;
  }
  const delta = end.price - start.price;
  const percent = (delta / Math.max(0.0001, start.price)) * 100;
  const bars = typeof start.logicalIndex === "number" && typeof end.logicalIndex === "number"
    ? Math.abs(end.logicalIndex - start.logicalIndex)
    : 0;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} / ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}% / ${bars}봉`;
}

type TimeTick = {
  x: number;
  label: string;
  depth: number;
  parentExpansionId?: string;
  isDivider: boolean;
};

function drawTimeGrid(context: CanvasRenderingContext2D, scene: ChartScene) {
  const ticks = buildTimeTicks(scene);
  if (!ticks.length) {
    return;
  }
  context.save();
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  ticks.forEach((tick) => {
    line(context, tick.x, scene.plot.top, tick.x, Math.min(scene.height, timeAxisY(scene) - 10));
  });
  context.restore();
}

function getKstComponents(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { year: 0, month: 0, day: 0, hour: 0, quarter: 1 };
  }
  const kstTime = date.getTime() + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstTime);
  const year = kstDate.getUTCFullYear();
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  const hour = kstDate.getUTCHours();
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { year, month, day, hour, quarter };
}

function drawTimePeriodDividers(context: CanvasRenderingContext2D, scene: ChartScene) {
  const candles = candleUnits(scene);
  if (candles.length < 2) {
    return;
  }
  const interval = scene.chart.interval;
  const isIntraday = interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h";
  const isDaily = interval === "1D";
  const isWeekly = interval === "1W";
  const isMonthly = interval === "1M";

  if (!isIntraday && !isDaily && !isWeekly && !isMonthly) {
    return;
  }

  context.save();
  context.strokeStyle = colors.grid;
  context.lineWidth = 2.0;

  let prevComp = getKstComponents(candles[0].timestamp);

  for (let i = 1; i < candles.length; i++) {
    const unit = candles[i];
    const currComp = getKstComponents(unit.timestamp);
    let trigger = false;

    if (isIntraday) {
      if (currComp.day !== prevComp.day || currComp.month !== prevComp.month || currComp.year !== prevComp.year) {
        trigger = true;
      }
    } else if (isDaily) {
      if (currComp.month !== prevComp.month || currComp.year !== prevComp.year) {
        trigger = true;
      }
    } else if (isWeekly) {
      if (currComp.quarter !== prevComp.quarter || currComp.year !== prevComp.year) {
        trigger = true;
      }
    } else if (isMonthly) {
      if (currComp.year !== prevComp.year) {
        trigger = true;
      }
    }

    if (trigger) {
      const x = unitCenterX(scene, unit);
      if (x >= scene.plot.left && x <= scene.plot.right) {
        line(context, x, scene.plot.top, x, scene.plot.bottom);
      }
    }

    prevComp = currComp;
  }

  context.restore();
}

function drawDarkAxisPill(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: "center" | "left" | "right"
) {
  context.save();
  context.font = "10px Inter, system-ui, sans-serif";
  const metrics = context.measureText(text);
  const width = metrics.width + 10;
  const height = 17;
  const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;
  const top = y - height / 2;
  context.fillStyle = colors.drawing;
  context.strokeStyle = colors.drawing;
  context.lineWidth = 1;
  roundedRect(context, left, top, width, height, 4);
  context.fill();
  context.stroke();
  context.fillStyle = colors.background;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, y + 0.5);
  context.restore();
}

function drawDrawingLabelsOnAxes(context: CanvasRenderingContext2D, scene: ChartScene) {
  const transform = createCoordinateTransform(scene);
  const drawings = scene.chart.drawings;

  drawings.forEach((drawing) => {
    if (drawing.visible === false) {
      return;
    }
    // Only show labels for completed drawings (exclude drafts during drawing process)
    if (drawing.createdAt === "draft" || drawing.id === "drawing-draft-preview" || drawing.id.includes("draft")) {
      return;
    }
    const anchor = drawing.anchors[0];
    if (!anchor) {
      return;
    }

    if (drawing.type === "horizontalLine" && typeof anchor.price === "number") {
      const pt = transform.anchorToPoint(anchor);
      if (pt && pt.y >= scene.plot.top && pt.y <= scene.plot.priceBottom) {
        const text = anchor.price.toFixed(2);
        drawDarkAxisPill(context, text, scene.width - 8, pt.y, "right");
      }
    } else if (drawing.type === "verticalMarker") {
      const pt = transform.anchorToPoint(anchor);
      if (pt && pt.x >= scene.plot.left && pt.x <= scene.plot.right) {
        const label = anchor.timestamp
          ? formatSemanticTimestamp(anchor.timestamp, scene.chart.interval)
          : "";
        if (label) {
          drawDarkAxisPill(context, label, pt.x, timeAxisY(scene), "center");
        }
      }
    }
  });
}

function drawCurrentPriceMarker(context: CanvasRenderingContext2D, scene: ChartScene) {
  const latest = scene.chart.candles.at(-1);
  if (!latest || !Number.isFinite(latest.close)) {
    return;
  }
  const y = priceToY(scene, latest.close);
  if (y < scene.plot.top - 1 || y > scene.plot.priceBottom + 1) {
    return;
  }

  context.save();
  context.strokeStyle = colors.signal;
  context.globalAlpha = 0.82;
  context.lineWidth = 1;
  context.setLineDash([2, 4]);
  line(context, scene.plot.left, y, horizontalGuideRight(scene), y);
  context.globalAlpha = 1;
  context.setLineDash([]);
  drawAxisPill(context, latest.close.toFixed(2), scene.width - 8, y, "right", "currentPrice");
  context.restore();
}

function drawAxes(context: CanvasRenderingContext2D, scene: ChartScene) {
  const ticks = buildTimeTicks(scene);
  if (!ticks.length) {
    return;
  }
  const y = timeAxisY(scene);
  let lastLabelX = Number.NEGATIVE_INFINITY;
  ticks.forEach((tick) => {
    const x = Math.max(scene.plot.left + 24, Math.min(scene.plot.right - 24, tick.x));
    const minimumGap = tick.parentExpansionId ? 46 : 62;
    if (x - lastLabelX < minimumGap) {
      return;
    }
    lastLabelX = x;

    context.save();
    context.textBaseline = "middle";
    context.textAlign = "center";
    if (tick.isDivider) {
      context.fillStyle = colors.text;
      context.font = "bold 10px Inter, system-ui, sans-serif";
    } else {
      context.fillStyle = tick.parentExpansionId ? colors.axis : colors.muted;
      context.font = "10px Inter, system-ui, sans-serif";
    }
    context.fillText(tick.label, x, y);
    context.restore();
  });
}

function buildTimeTicks(scene: ChartScene): TimeTick[] {
  const candles = candleUnits(scene);
  if (!candles.length) {
    return [];
  }

  const interval = scene.chart.interval;
  const isIntraday = interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h";
  const isDaily = interval === "1D";
  const isWeekly = interval === "1W";
  const isMonthly = interval === "1M";

  const isDivider = new Array(candles.length).fill(false);
  const dividerLabels = new Array(candles.length).fill("");

  if (candles.length >= 2 && (isIntraday || isDaily || isWeekly || isMonthly)) {
    let prevComp = getKstComponents(candles[0].timestamp);
    for (let i = 1; i < candles.length; i++) {
      const unit = candles[i];
      const currComp = getKstComponents(unit.timestamp);
      let trigger = false;
      let label = "";

      if (isIntraday) {
        if (currComp.day !== prevComp.day || currComp.month !== prevComp.month || currComp.year !== prevComp.year) {
          trigger = true;
          label = `${String(currComp.month).padStart(2, "0")}/${String(currComp.day).padStart(2, "0")}`;
        }
      } else if (isDaily) {
        if (currComp.month !== prevComp.month || currComp.year !== prevComp.year) {
          trigger = true;
          label = `${currComp.year}.${String(currComp.month).padStart(2, "0")}`;
        }
      } else if (isWeekly) {
        if (currComp.quarter !== prevComp.quarter || currComp.year !== prevComp.year) {
          trigger = true;
          label = `${currComp.year}.Q${currComp.quarter}`;
        }
      } else if (isMonthly) {
        if (currComp.year !== prevComp.year) {
          trigger = true;
          label = `${currComp.year}`;
        }
      }

      if (trigger) {
        isDivider[i] = true;
        dividerLabels[i] = label;
      }
      prevComp = currComp;
    }
  }

  const potentialTicks: TimeTick[] = [];
  candles.forEach((unit, index) => {
    const x = unitCenterX(scene, unit);
    if (x < scene.plot.left - 1 || x > scene.plot.right + 1) {
      return;
    }
    const divider = isDivider[index];
    const standard = shouldShowTimeTick(unit, scene.scales.slotWidth, index === 0 || index === candles.length - 1);
    if (divider) {
      potentialTicks.push({
        x,
        label: dividerLabels[index],
        depth: unit.depth,
        parentExpansionId: unit.parentExpansionId,
        isDivider: true
      });
    } else if (standard) {
      potentialTicks.push({
        x,
        label: formatAxisTimestamp(unit.timestamp, unit.interval),
        depth: unit.depth,
        parentExpansionId: unit.parentExpansionId,
        isDivider: false
      });
    }
  });

  if (!potentialTicks.length && candles.length) {
    const first = candles[0];
    const last = candles[candles.length - 1];
    potentialTicks.push({
      x: unitCenterX(scene, first),
      label: formatAxisTimestamp(first.timestamp, first.interval),
      depth: first.depth,
      parentExpansionId: first.parentExpansionId,
      isDivider: false
    });
    if (last !== first) {
      potentialTicks.push({
        x: unitCenterX(scene, last),
        label: formatAxisTimestamp(last.timestamp, last.interval),
        depth: last.depth,
        parentExpansionId: last.parentExpansionId,
        isDivider: false
      });
    }
  }

  const dividerTicks = potentialTicks.filter(t => t.isDivider);
  const selectedTicks: TimeTick[] = [...dividerTicks];
  const standardTicks = potentialTicks.filter(t => !t.isDivider);

  standardTicks.forEach((tick) => {
    const minGap = tick.parentExpansionId ? 46 : 62;
    const hasOverlap = selectedTicks.some(sel => Math.abs(sel.x - tick.x) < minGap);
    if (!hasOverlap) {
      selectedTicks.push(tick);
    }
  });

  return selectedTicks.sort((left, right) => left.x - right.x);
}

function shouldShowTimeTick(unit: SemanticCandleUnit, slotWidth: number, edge: boolean): boolean {
  if (edge) {
    return true;
  }
  const date = new Date(unit.timestamp);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const kstTime = date.getTime() + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstTime);
  const minute = kstDate.getUTCMinutes();
  const hour = kstDate.getUTCHours();
  const dayOfWeek = kstDate.getUTCDay();
  const dayOfMonth = kstDate.getUTCDate();
  const month = kstDate.getUTCMonth() + 1;

  const candlesPerTick = Math.ceil(62 / slotWidth);

  switch (unit.interval) {
    case "1m": {
      if (candlesPerTick <= 5) return minute % 5 === 0;
      if (candlesPerTick <= 15) return minute % 15 === 0;
      if (candlesPerTick <= 30) return minute % 30 === 0;
      if (candlesPerTick <= 60) return minute === 0;
      if (candlesPerTick <= 120) return hour % 2 === 0 && minute === 0;
      return hour % 4 === 0 && minute === 0;
    }
    case "5m": {
      const minsTotal = hour * 60 + minute;
      if (candlesPerTick <= 3) return minsTotal % 15 === 0;
      if (candlesPerTick <= 6) return minsTotal % 30 === 0;
      if (candlesPerTick <= 12) return minute === 0;
      return hour % 2 === 0 && minute === 0;
    }
    case "10m": {
      const minsTotal = hour * 60 + minute;
      if (candlesPerTick <= 3) return minsTotal % 30 === 0;
      if (candlesPerTick <= 6) return minute === 0;
      return hour % 2 === 0 && minute === 0;
    }
    case "1h": {
      if (candlesPerTick <= 2) return true;
      if (candlesPerTick <= 4) return hour % 2 === 0 && minute === 0;
      return hour % 4 === 0 && minute === 0;
    }
    case "4h": {
      if (candlesPerTick <= 2) return true;
      return hour === 0 && minute === 0;
    }
    case "1D": {
      if (slotWidth > 18 || candlesPerTick <= 2) {
        return true;
      }
      if (candlesPerTick <= 5) {
        return dayOfWeek === 1;
      }
      if (candlesPerTick <= 10) {
        const weekNum = Math.floor(kstTime / (7 * 24 * 60 * 60 * 1000));
        return dayOfWeek === 1 && weekNum % 2 === 0;
      }
      return dayOfWeek === 1 && dayOfMonth <= 7;
    }
    case "1W": {
      if (candlesPerTick <= 2) {
        return true;
      }
      return dayOfMonth <= 7;
    }
    case "1M": {
      if (candlesPerTick <= 1) {
        return true;
      }
      if (candlesPerTick <= 3) {
        return month % 3 === 1;
      }
      return month === 1;
    }
    default:
      return false;
  }
}

function formatAxisTimestamp(value: string, interval: SemanticCandleUnit["interval"]): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (interval === "1m" || interval === "5m" || interval === "10m" || interval === "1h" || interval === "4h") {
    return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  if (interval === "1M") {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(date);
}

function timeAxisY(scene: ChartScene): number {
  const target = scene.plot.belowPanes.length ? scene.plot.bottom + 20 : scene.plot.priceBottom + 20;
  return Math.min(scene.height - 15, Math.max(scene.plot.top + 22, target));
}

function drawPriceAxis(context: CanvasRenderingContext2D, scene: ChartScene) {
  context.save();
  context.font = "10px Inter, system-ui, sans-serif";
  context.fillStyle = colors.muted;
  context.textAlign = "right";
  context.textBaseline = "middle";
  scene.scales.priceTicks.forEach((price) => {
    context.fillText(formatPriceAxisValue(price), scene.width - 8, priceToY(scene, price));
  });
  drawVolumeAxisLabels(context, scene);
  context.restore();
}

function drawVolumeAxisLabels(context: CanvasRenderingContext2D, scene: ChartScene) {
  if (!hasVolumePane(scene)) {
    return;
  }
  context.save();
  context.font = "9px Inter, system-ui, sans-serif";
  context.fillStyle = colors.axis;
  context.textAlign = "right";
  context.textBaseline = "middle";
  scene.scales.volumeTicks.forEach((volume) => {
    context.fillText(formatVolumeAxisValue(volume), scene.width - 8, volumeY(scene, volume));
  });
  context.restore();
}

function formatVolumeAxisValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value < 1_000) {
    return Math.round(value).toLocaleString("en-US");
  }
  const unit = value >= 999_500 ? "M" : "K";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  return `${formatCompactVolumeNumber(value / divisor)}${unit}`;
}

function formatCompactVolumeNumber(value: number): string {
  const fractionDigits = value < 10 ? 1 : 0;
  return value.toFixed(fractionDigits).replace(/\.0$/, "");
}

function formatPriceAxisValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Math.round(value).toLocaleString("en-US");
}

function hasVolumePane(scene: ChartScene): boolean {
  return Boolean(scene.chart.layers.volume) && Boolean(paneById(scene, "volume"));
}

function drawCrosshair(context: CanvasRenderingContext2D, scene: ChartScene, crosshair?: { x: number; y: number }) {
  if (!crosshair || crosshair.x < scene.plot.left || crosshair.x > scene.plot.right || crosshair.y < scene.plot.top || crosshair.y > scene.plot.bottom) {
    return;
  }
  const semanticHit = hitTestSemanticNode(scene, crosshair.x, crosshair.y);
  if (!semanticHit) {
    return;
  }
  const gapBounds = semanticHit.kind === "time-gap" ? unitBoundsX(scene, semanticHit) : null;
  const x = gapBounds
    ? Math.max(gapBounds.left, Math.min(gapBounds.right, crosshair.x))
    : unitCenterX(scene, semanticHit);
  const y = Math.max(scene.plot.top, Math.min(scene.plot.priceBottom, crosshair.y));
  const drawingToolActive = scene.chart.toolMode !== "pan" && scene.chart.toolMode !== "select";
  const alpha = drawingToolActive ? 0.12 : 0.22;
  const label = semanticHit.kind === "candle"
    ? formatSemanticTimestamp(semanticHit.timestamp, semanticHit.interval)
    : formatSemanticTimestamp(timestampAtUnitX(scene, semanticHit, x), semanticHit.interval);
  const inPricePane = crosshair.y <= scene.plot.priceBottom;
  const activeBelowPane = scene.plot.belowPanes.find((pane) => crosshair.y >= pane.top && crosshair.y <= pane.bottom);
  const inVolumePane = activeBelowPane?.id === "volume";
  context.save();
  context.strokeStyle = colors.crosshair;
  context.globalAlpha = alpha;
  context.lineWidth = 1;
  context.setLineDash([]);
  line(context, x, 0, x, scene.height);
  if (inPricePane) {
    line(context, scene.plot.left, y, horizontalGuideRight(scene), y);
  } else if (activeBelowPane) {
    line(context, scene.plot.left, crosshair.y, horizontalGuideRight(scene), crosshair.y);
  }
  context.globalAlpha = 1;
  drawAxisPill(context, label, x, timeAxisY(scene), "center");
  if (inPricePane) {
    const price = createCoordinateTransform(scene).yToPrice(y);
    drawAxisPill(context, price.toFixed(2), scene.width - 8, y, "right");
  } else if (inVolumePane) {
    drawAxisPill(context, formatVolumeAxisValue(volumeAtY(scene, crosshair.y)), scene.width - 8, crosshair.y, "right");
  }
  context.restore();
}

function drawLineHoverDot(context: CanvasRenderingContext2D, scene: ChartScene, crosshair?: { x: number; y: number }) {
  if (!crosshair || scene.chart.chartType !== "line") {
    return;
  }
  if (crosshair.x < scene.plot.left || crosshair.x > scene.plot.right || crosshair.y < scene.plot.top || crosshair.y > scene.plot.bottom) {
    return;
  }
  let best: { x: number; close: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const hit = hitTestSemanticNode(scene, crosshair.x, crosshair.y);
  if (hit?.kind === "time-gap" && Number.isFinite(hit.carryPrice)) {
    const bounds = unitBoundsX(scene, hit);
    best = {
      x: Math.max(bounds.left, Math.min(bounds.right, crosshair.x)),
      close: hit.carryPrice
    };
    bestDistance = 0;
  }
  scene.semantic.units.forEach((unit) => {
    if (bestDistance === 0) {
      return;
    }
    if (unit.kind !== "candle") {
      return;
    }
    const centerX = unitCenterX(scene, unit);
    const distance = Math.abs(centerX - crosshair.x);
    if (distance < bestDistance) {
      best = { x: centerX, close: unit.candle.close };
      bestDistance = distance;
    }
  });
  if (!best) {
    return;
  }
  const marker = best as { x: number; close: number };
  const y = priceToY(scene, marker.close);
  context.save();
  context.fillStyle = colors.upSoft;
  context.strokeStyle = colors.surface;
  context.lineWidth = 1.5;
  circle(context, marker.x, y, 3.5);
  context.fill();
  context.stroke();
  context.restore();
}

function drawDigDarkTag(context: CanvasRenderingContext2D, text: string, cx: number, cy: number) {
  context.save();
  context.font = "10px Inter, system-ui, sans-serif";
  const metrics = context.measureText(text);
  const width = metrics.width + 10;
  const height = 17;
  const left = cx - width / 2;
  const top = cy - height / 2;
  context.fillStyle = colors.text;
  roundedRect(context, left, top, width, height, 4);
  context.fill();
  context.fillStyle = colors.surface;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, cx, cy + 0.5);
  context.restore();
}

const DIG_MARKER_TRIANGLE_HEIGHT = 10;
const DIG_MARKER_TRIANGLE_WIDTH = 9;

// Right triangle with its vertical leg on the boundary line, flaring outward. The left
// and right markers mirror each other so the dug span reads as a width rather than two
// identical points.
function drawDigTriangle(context: CanvasRenderingContext2D, boundaryX: number, plotBottom: number, side: "left" | "right", color: string) {
  const baseY = plotBottom + DIG_MARKER_TRIANGLE_HEIGHT;
  const outerX = side === "left" ? boundaryX - DIG_MARKER_TRIANGLE_WIDTH : boundaryX + DIG_MARKER_TRIANGLE_WIDTH;
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(boundaryX, plotBottom); // apex at the top of the vertical leg
  context.lineTo(boundaryX, baseY);      // vertical leg down the boundary
  context.lineTo(outerX, baseY);         // horizontal leg flaring outward
  context.closePath();                   // hypotenuse back up to the apex
  context.fill();
  context.restore();
}

function drawTimeAxisDigHover(context: CanvasRenderingContext2D, scene: ChartScene, crosshair?: { x: number; y: number }) {
  if (!crosshair) {
    return;
  }
  if (scene.chart.chartType === "line") {
    return;
  }
  const unit = hitTestTimeAxisUnit(scene, crosshair.x, crosshair.y);
  if (!unit || unit.kind !== "candle") {
    return;
  }
  const cx = unitBoundsX(scene, unit).center;
  const plotBottom = scene.plot.bottom;
  const tagY = timeAxisY(scene);
  // Black vertical guide from the marker apex up through the chart (the candle/volume
  // emphasis itself is applied via the hovered node, matching crosshair hover).
  context.save();
  context.strokeStyle = colors.text;
  context.lineWidth = 1;
  context.setLineDash([]);
  line(context, cx, scene.plot.top, cx, plotBottom);
  context.restore();
  // Up-pointing triangle whose apex meets the chart's bottom border.
  const triBaseY = tagY - 8.5;
  const triHalf = 5;
  context.save();
  context.fillStyle = colors.text;
  context.beginPath();
  context.moveTo(cx, plotBottom);
  context.lineTo(cx - triHalf, triBaseY);
  context.lineTo(cx + triHalf, triBaseY);
  context.closePath();
  context.fill();
  context.restore();
  // Time tag (black box, white text) on the axis.
  drawDigDarkTag(context, formatSemanticTimestamp(unit.timestamp, unit.interval), cx, tagY);
}

function drawOpenedDigMarkers(context: CanvasRenderingContext2D, scene: ChartScene) {
  const ranges = scene.semantic.expansionRanges;
  if (!ranges.length) {
    return;
  }
  const plotBottom = scene.plot.bottom;
  const baseY = plotBottom + DIG_MARKER_TRIANGLE_HEIGHT;
  ranges.forEach((range) => {
    const left = Math.max(scene.plot.left, range.left);
    const right = Math.min(scene.plot.right, range.right);
    if (right - left <= 4) {
      return;
    }
    // Thin black guide lines from the chart top down to each triangle's base.
    context.save();
    context.strokeStyle = colors.text;
    context.lineWidth = 0.5;
    context.setLineDash([]);
    line(context, left, scene.plot.top, left, baseY);
    line(context, right, scene.plot.top, right, baseY);
    context.restore();
    // Mirrored right-triangle markers flaring outward from each boundary.
    drawDigTriangle(context, left, plotBottom, "left", colors.text);
    drawDigTriangle(context, right, plotBottom, "right", colors.text);
  });
}

function drawAxisPill(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: "center" | "left" | "right",
  variant: "default" | "currentPrice" = "default"
) {
  context.font = "10px Inter, system-ui, sans-serif";
  const metrics = context.measureText(text);
  const width = metrics.width + 10;
  const height = 17;
  const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;
  const top = y - height / 2;
  context.fillStyle = variant === "currentPrice" ? colors.signal : colors.surfaceStrong;
  context.strokeStyle = variant === "currentPrice" ? colors.signal : colors.border;
  context.lineWidth = 1;
  roundedRect(context, left, top, width, height, 5);
  context.fill();
  context.stroke();
  context.fillStyle = variant === "currentPrice" ? colors.surface : colors.text;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, y + 0.5);
}

function drawEmpty(context: CanvasRenderingContext2D, width: number, height: number, message: string) {
  context.fillStyle = colors.text;
  context.font = "12px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(message, width / 2, height / 2);
  context.textAlign = "start";
}

function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  context.beginPath();
  context.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  context.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  context.stroke();
}

function horizontalGuideRight(scene: ChartScene): number {
  return Math.max(scene.plot.right, scene.width - 52);
}

function drawExpansionRanges(context: CanvasRenderingContext2D, scene: ChartScene, active: boolean) {
  scene.semantic.expansionRanges.forEach((range) => {
    const left = Math.max(scene.plot.left, range.left);
    const right = Math.min(scene.plot.right, range.right);
    const width = right - left;
    if (width <= 4) {
      return;
    }
    context.save();
    context.beginPath();
    context.rect(left, 0, width, scene.height);
    context.clip();
    const depthAlpha = Math.min(0.034, 0.012 + range.depth * 0.004);
    context.fillStyle = colors.shadow;
    context.globalAlpha = depthAlpha;
    context.fillRect(left, 0, width, scene.height);

    if (active) {
      if (range.left >= scene.plot.left) {
        drawExpansionSideShadow(context, left, scene.height, "left", width);
      }

      if (range.right <= scene.plot.right) {
        drawExpansionSideShadow(context, right, scene.height, "right", width);
      }
    }
    context.restore();
  });
  scene.semantic.units.forEach((unit) => {
    if (unit.kind === "time-gap") {
      return;
    }
    if (unit.kind === "placeholder") {
      drawSemanticPlaceholder(context, scene, unit);
    }
  });
}

function drawExpansionSideShadow(
  context: CanvasRenderingContext2D,
  x: number,
  height: number,
  side: "left" | "right",
  rangeWidth: number
) {
  const sideWidth = Math.min(6, Math.max(2, rangeWidth / 7));
  context.fillStyle = colors.shadow;
  for (let index = 0; index < sideWidth; index += 1) {
    context.globalAlpha = Math.max(0.008, 0.036 - index * 0.005);
    const offset = side === "left" ? index : -index - 1;
    context.fillRect(x + offset, 0, 1, height);
  }
}

function drawExpansionParentSummaries(context: CanvasRenderingContext2D, scene: ChartScene) {
  scene.semantic.expansionRanges.forEach((range) => {
    const { left, right } = expansionSummaryVisibleBounds(scene.plot, range);
    const availableWidth = right - left;
    if (availableWidth < 16) {
      return;
    }
    const candle = range.parentCandle;
    const up = candle.close >= candle.open;
    const candleHeight = expansionParentCandleHeight;
    const candleTop = expansionMetadataTop(scene.plot.top);
    const priceRange = Math.max(0.0001, candle.high - candle.low);
    const localY = (price: number) => candleTop + ((candle.high - price) / priceRange) * candleHeight;
    const open = localY(candle.open);
    const close = localY(candle.close);
    const high = localY(candle.high);
    const low = localY(candle.low);
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(3, Math.abs(close - open));
    const bodyBottom = bodyTop + bodyHeight;
    const candleWidth = expansionParentCandleWidth;
    const candleCenter = Math.round(Math.min(left + 9, left + availableWidth / 2)) + 0.5;
    const bodyLeft = candleCenter - candleWidth / 2;

    context.save();
    context.strokeStyle = up ? colors.upSoft : colors.downSoft;
    context.fillStyle = up ? colors.upSoft : colors.downSoft;
    context.lineWidth = 1;
    line(context, candleCenter, high, candleCenter, bodyTop);
    line(context, candleCenter, bodyBottom, candleCenter, low);
    context.fillRect(bodyLeft, bodyTop, candleWidth, bodyHeight);
    context.fillStyle = colors.text;
    context.font = "10px Inter, system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    const textLeft = candleCenter + 12;
    const textWidth = right - textLeft;
    const summaryColumns = buildParentSummaryColumns(range, textWidth);
    if (summaryColumns.length) {
      const columnGap = 54;
      summaryColumns.forEach((column, index) => {
        const columnX = textLeft + index * columnGap;
        context.fillText(column.top, columnX, candleTop + candleHeight / 2 - 6);
        context.fillText(column.bottom, columnX, candleTop + candleHeight / 2 + 6);
      });
    }
    context.restore();
  });
}

function buildParentSummaryColumns(
  range: ChartScene["semantic"]["expansionRanges"][number],
  width: number
): Array<{ top: string; bottom: string }> {
  if (width < 72) {
    return [];
  }
  const candle = range.parentCandle;
  const columns = [
    {
      top: formatParentSummaryDate(range.from),
      bottom: formatParentSummaryDate(range.to)
    }
  ];
  if (width >= 132) {
    columns.push({
      top: `O ${candle.open.toFixed(2)}`,
      bottom: `C ${candle.close.toFixed(2)}`
    });
  }
  if (width >= 190) {
    columns.push({
      top: `H ${candle.high.toFixed(2)}`,
      bottom: `L ${candle.low.toFixed(2)}`
    });
  }
  return columns;
}

function formatParentSummaryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit"
  }).format(date);
}

function drawSemanticPlaceholder(context: CanvasRenderingContext2D, scene: ChartScene, unit: Extract<SemanticRenderUnit, { kind: "placeholder" | "footprint" }>) {
  const bounds = unitBoundsX(scene, unit);
  const visibleLeft = Math.max(scene.plot.left, bounds.left);
  const visibleRight = Math.min(scene.plot.right, bounds.right);
  const visibleWidth = visibleRight - visibleLeft;
  if (visibleWidth <= 4) {
    return;
  }
  const x = (visibleLeft + visibleRight) / 2;
  const y = scene.plot.top + (scene.plot.priceBottom - scene.plot.top) / 2;
  context.save();
  context.fillStyle = colors.muted;
  context.font = "10px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(unit.message, x, y, Math.max(24, visibleWidth - 8));
  context.restore();
  context.restore();
}

function resolveDrawingColor(
  style: DrawingEntity["style"],
  tokenKey: "colorToken" | "fillToken" | "textToken",
  rawKey: "color" | "fillColor" | "textColor",
  fallback: ThemeColorToken
): string {
  const token = style[tokenKey];
  if (isThemeColorToken(token)) {
    return resolveThemeColor(colors, token);
  }
  return resolveRawPaletteColor(colors, style[rawKey], fallback);
}

function isThemeColorToken(value: unknown): value is ThemeColorToken {
  return typeof value === "string" && value in colors;
}

function candleUnits(scene: ChartScene): SemanticCandleUnit[] {
  return scene.semantic.units.filter((unit): unit is SemanticCandleUnit => unit.kind === "candle");
}

function timeGapUnits(scene: ChartScene): SemanticTimeGapUnit[] {
  return scene.semantic.units.filter((unit): unit is SemanticTimeGapUnit => unit.kind === "time-gap");
}

function pricePathUnits(scene: ChartScene): Array<SemanticCandleUnit | SemanticTimeGapUnit> {
  return scene.semantic.units.filter((unit): unit is SemanticCandleUnit | SemanticTimeGapUnit => (
    unit.kind === "candle" || (unit.kind === "time-gap" && Number.isFinite(unit.carryPrice))
  ));
}

function pricePathSegmentKey(unit: SemanticCandleUnit | SemanticTimeGapUnit): string {
  if (unit.kind === "time-gap") {
    return `root:${unit.interval}`;
  }
  return `${unit.parentExpansionId ?? "root"}:${unit.interval}`;
}

function candleBodyWidth(scene: ChartScene, unit: SemanticCandleUnit, hovered = false): number {
  const unitSlotWidth = Math.max(0.2, unit.slotEnd - unit.slotStart);
  const unitPixelWidth = unitSlotWidth * scene.scales.slotWidth;
  const minWidth = unit.depth > 0 ? 0.7 : 2;
  const baseWidth = Math.max(minWidth, Math.min(72, unitPixelWidth * 0.78));
  return hovered ? Math.min(unitPixelWidth, baseWidth * 1.35) : baseWidth;
}

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}
