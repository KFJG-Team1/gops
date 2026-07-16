import type { CandleDto, ChartInterval, ChartLayerKey, ChartState, DrawingAnchor } from "./types";
import { createIndicatorPointLookup, createIndicatorValueLookup } from "./indicatorSeries";
import {
  buildBidAskPriceGrid,
  ORDER_FLOW_CHART_FOOTER_HEIGHT,
  orderFlowMinutesForBucket,
  orderFlowWindowMinutesForInterval,
  type BidAskPriceGrid
} from "./orderFlow";
import { normalizeViewport, type ChartViewport, type ViewportClampOptions } from "./viewport";
import {
  advanceTimestampByInterval,
  buildSemanticTimeline,
  semanticNodeId,
  type SemanticExpansion,
  type SemanticExpansionRange,
  type SemanticRenderUnit,
  type SemanticTimeline
} from "./semanticTimeline";
import { decimalPlacesForPriceStep, resolvePriceScale } from "./priceScale";

const volumeScalePadding = 1.18;
const fourDigitPriceAxisWidth = 68;
const fourDigitPriceLabelLength = "1356.22".length;
const priceAxisLabelContentWidth = 60;

export function formatPriceAxisValue(value: number, decimalPlaces = 2): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const fractionDigits = Math.max(2, Math.min(8, Math.round(decimalPlaces)));
  return value.toFixed(fractionDigits);
}

export function priceAxisLabelWidth(label: string, showClock = false): number {
  const priceWidth = priceAxisLabelContentWidth
    + Math.max(0, label.length - fourDigitPriceLabelLength) * 6;
  const clockWidth = showClock ? priceAxisLabelContentWidth : 0;
  return Math.max(priceAxisLabelContentWidth, priceWidth, clockWidth);
}

// The price axis is sized to the widest expected tick label so the plot can extend as close
// to the numbers as possible without overlapping them. Ticks and boxed labels share a fixed
// right-side text column near the panel edge. Adaptive by magnitude: cheap 2-3 digit tickers
// get a tight axis, while high-priced names (e.g. BRK.A) keep enough room.
function priceAxisWidthForChart(chart: ChartState): number {
  const lookback = Math.max(1, Math.round(chart.visibleCount + Math.max(0, chart.rightOffset)));
  let maxPrice = 0;
  for (const candle of chart.candles.slice(-lookback)) {
    if (Number.isFinite(candle.high) && candle.high > maxPrice) {
      maxPrice = candle.high;
    }
  }
  if (maxPrice <= 0) {
    maxPrice = chart.candles[chart.candles.length - 1]?.close ?? 0;
  }
  // Inflate slightly so a top tick that rounds up to an extra digit still fits.
  const decimalPlaces = chart.chartType === "bidask"
    ? decimalPlacesForPriceStep(chart.orderFlow?.priceBinSize ?? 0.01)
    : 2;
  const tickLabel = formatPriceAxisValue(maxPrice * (chart.chartType === "bidask" ? 1.006 : 1.06), decimalPlaces);
  const latest = chart.candles[chart.candles.length - 1];
  const livePrice = chart.streamState === "live" && Number.isFinite(chart.liveTrade?.price)
    ? chart.liveTrade?.price
    : undefined;
  const currentPrice = livePrice ?? latest?.close;
  const currentPriceLabel = typeof currentPrice === "number" && Number.isFinite(currentPrice)
    ? formatPriceAxisValue(currentPrice, decimalPlaces)
    : "0.00";
  const showsClock = chart.streamState === "live"
    && latest?.isClosed === false
    && (chart.interval === "1m" || chart.interval === "5m" || chart.interval === "10m" || chart.interval === "1h" || chart.interval === "4h");
  const widestLabelWidth = Math.max(
    priceAxisLabelWidth(tickLabel),
    priceAxisLabelWidth(currentPriceLabel, showsClock)
  );
  return Math.round(Math.min(146, Math.max(fourDigitPriceAxisWidth, widestLabelWidth + 8)));
}

function priceAxisWidthForResolvedTicks(chart: ChartState, ticks: number[], decimalPlaces: number): number {
  const latest = chart.candles[chart.candles.length - 1];
  const livePrice = chart.streamState === "live" && Number.isFinite(chart.liveTrade?.price)
    ? chart.liveTrade?.price
    : undefined;
  const currentPrice = livePrice ?? latest?.close;
  const showsClock = chart.streamState === "live"
    && latest?.isClosed === false
    && (chart.interval === "1m" || chart.interval === "5m" || chart.interval === "10m" || chart.interval === "1h" || chart.interval === "4h");
  const labels = ticks.map((tick) => priceAxisLabelWidth(formatPriceAxisValue(tick, decimalPlaces)));
  if (typeof currentPrice === "number" && Number.isFinite(currentPrice)) {
    labels.push(priceAxisLabelWidth(formatPriceAxisValue(currentPrice, decimalPlaces), showsClock));
  }
  return Math.round(Math.min(146, Math.max(fourDigitPriceAxisWidth, Math.max(0, ...labels) + 8)));
}

export type ChartPlot = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  priceBottom: number;
  volumeTop: number;
  belowPanes: ChartBelowPanePlot[];
};

export type ChartBelowPanePlot = {
  id: string;
  top: number;
  bottom: number;
};

export function paneSeparatorYs(plot: ChartPlot): number[] {
  return plot.belowPanes.map((pane, index) => {
    const previousBottom = index === 0
      ? plot.priceBottom
      : plot.belowPanes[index - 1].bottom;
    return (previousBottom + pane.top) / 2;
  });
}

export type ChartScene = {
  width: number;
  height: number;
  chart: ChartState;
  allCandles: CandleDto[];
  candles: CandleDto[];
  visibleStartIndex: number;
  visibleEndIndex: number;
  viewportStartIndex: number;
  viewportEndIndex: number;
  visibleSlotCount: number;
  semantic: Omit<SemanticTimeline, "expansionRanges"> & { expansionRanges: SemanticExpansionRange[] };
  hoveredNodeId?: string;
  selectedNodeId?: string;
  emphasizeSelectedNode?: boolean;
  plot: ChartPlot;
  scales: {
    minPrice: number;
    maxPrice: number;
    priceTicks: number[];
    maxVolume: number;
    volumeTicks: number[];
    slotWidth: number;
    candleWidth: number;
    priceBottomInset?: number;
    bidAskPriceGrid?: BidAskPriceGrid;
  };
};

export type CoordinateTransform = {
  anchorToPoint: (anchor: DrawingAnchor) => { x: number; y: number } | null;
  pointToAnchor: (x: number, y: number, symbol: string) => DrawingAnchor | null;
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
  logicalToX: (logicalIndex: number) => number;
  xToLogical: (x: number) => number;
  timestampToX: (timestamp: string) => number | null;
};

export type ChartSceneOptions = {
  expansions?: SemanticExpansion[];
  hoveredNodeId?: string;
  selectedNodeId?: string;
  emphasizeSelectedNode?: boolean;
};

export type ChartPriceAxisPoint = {
  price: number;
  formattedPrice: string;
};

export function isChartRightAxisPoint(scene: ChartScene, x: number, y: number): boolean {
  return Number.isFinite(x)
    && Number.isFinite(y)
    && x >= scene.plot.right
    && x <= scene.width
    && y >= scene.plot.top
    && y <= scene.plot.bottom;
}

export function isPriceAxisPricePanePoint(scene: ChartScene, x: number, y: number): boolean {
  return isChartRightAxisPoint(scene, x, y)
    && y <= scene.plot.priceBottom;
}

export function chartPriceAxisPoint(scene: ChartScene, x: number, y: number): ChartPriceAxisPoint | null {
  if (!isPriceAxisPricePanePoint(scene, x, y)) {
    return null;
  }
  const decimalPlaces = scene.chart.chartType === "bidask"
    ? scene.scales.bidAskPriceGrid?.decimalPlaces ?? decimalPlacesForPriceStep(scene.chart.orderFlow?.priceBinSize ?? 0.01)
    : 2;
  const formattedPrice = formatPriceAxisValue(createCoordinateTransform(scene).yToPrice(y), decimalPlaces);
  const price = Number(formattedPrice);
  return Number.isFinite(price) && price > 0 ? { price, formattedPrice } : null;
}

export function buildChartScene(chart: ChartState, width: number, height: number, options: ChartSceneOptions = {}): ChartScene {
  const initialAxisWidth = priceAxisWidthForChart(chart);
  const initialScene = buildChartScenePass(chart, width, height, options, initialAxisWidth);
  const resolvedAxisWidth = priceAxisWidthForResolvedTicks(
    chart,
    initialScene.scales.priceTicks,
    initialScene.scales.bidAskPriceGrid?.decimalPlaces ?? 2
  );
  const finalAxisWidth = Math.max(initialAxisWidth, resolvedAxisWidth);
  return finalAxisWidth > initialAxisWidth
    ? buildChartScenePass(chart, width, height, options, finalAxisWidth)
    : initialScene;
}

function buildChartScenePass(
  chart: ChartState,
  width: number,
  height: number,
  options: ChartSceneOptions,
  priceAxisWidth: number
): ChartScene {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const belowPaneIds = activeBelowPaneIds(chart);
  // Keep the plot snug under the panel's top control bar; only reserve extra headroom
  // for digging metadata when an expansion is actually present, shrinking the price
  // area downward to make that room.
  const hasDigExpansions = (options.expansions?.length ?? 0) > 0;
  const padding = {
    top: hasDigExpansions ? 60 : 34,
    right: priceAxisWidth,
    bottom: belowPaneIds.length ? 40 : 34,
    left: 0
  };
  const allActivePaneIds = ["price", ...belowPaneIds];
  const activeRatios = allActivePaneIds.map(id => getPaneRatio(chart, id));
  const minHeights = allActivePaneIds.map((id) => id === "price" ? 92 : 54);
  const availablePlotHeight = Math.max(1, safeHeight - padding.top - padding.bottom);
  const gapTotal = belowPaneIds.length ? (10 + 6 * (belowPaneIds.length - 1)) : 0;
  const netHeight = Math.max(1, availablePlotHeight - gapTotal);

  let heights = new Array(allActivePaneIds.length).fill(0);
  const totalMinHeight = minHeights.reduce((sum, h) => sum + h, 0);
  if (netHeight <= totalMinHeight) {
    // Panel is shorter than the combined minimum pane heights (e.g. a 1-row chart).
    // Scale the panes down proportionally so they fit the available height; otherwise
    // the price pane keeps its 92px minimum and priceBottom overflows past the time axis.
    const scale = netHeight / totalMinHeight;
    heights = minHeights.map((h) => h * scale);
  } else {
    let remainingHeight = netHeight;
    let remainingRatiosSum = activeRatios.reduce((sum, r) => sum + r, 0);
    const activeIndices = new Set(allActivePaneIds.keys());
    for (let iter = 0; iter < allActivePaneIds.length; iter++) {
      let changed = false;
      for (const i of activeIndices) {
        const ratio = activeRatios[i];
        const share = (ratio / Math.max(0.0001, remainingRatiosSum)) * remainingHeight;
        const minH = minHeights[i];
        if (share < minH) {
          heights[i] = minH;
          remainingHeight -= minH;
          remainingRatiosSum -= ratio;
          activeIndices.delete(i);
          changed = true;
          break;
        }
      }
      if (!changed) {
        for (const i of activeIndices) {
          heights[i] = (activeRatios[i] / Math.max(0.0001, remainingRatiosSum)) * remainingHeight;
        }
        break;
      }
    }
  }

  const priceBottom = Math.round(padding.top + heights[0]);
  let currentTop = priceBottom + 10;
  const belowPanes = belowPaneIds.map((id, index) => {
    const h = heights[index + 1];
    const paneTop = currentTop;
    const paneBottom = paneTop + h;
    currentTop = paneBottom + 6;
    return {
      id,
      top: paneTop,
      bottom: paneBottom
    };
  });
  const volumePane = belowPanes.find((pane) => pane.id === "volume");
  const plot: ChartPlot = {
    left: padding.left,
    right: safeWidth - padding.right,
    top: padding.top,
    bottom: safeHeight - padding.bottom,
    priceBottom,
    volumeTop: volumePane?.top ?? priceBottom,
    belowPanes
  };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const baseViewportOptions = viewportClampOptionsForChart(chart);
  const resolveViewportTimeline = (viewport: ChartViewport) => {
    const viewportEndIndex = Math.max(0, chart.candles.length - viewport.rightOffset);
    const viewportStartIndex = viewportEndIndex - viewport.visibleCount;
    const visibleStartIndex = Math.max(0, Math.min(chart.candles.length, Math.floor(viewportStartIndex)));
    const visibleEndIndex = Math.max(visibleStartIndex, Math.min(chart.candles.length, Math.ceil(viewportEndIndex)));
    const semanticBase = buildSemanticTimeline({
      symbol: chart.symbol,
      interval: chart.interval,
      candles: chart.candles,
      expansions: options.expansions ?? [],
      visibleStartIndex,
      visibleEndIndex,
      viewportStartIndex,
      visibleSlotCount: viewport.visibleCount
    });
    return {
      viewport,
      viewportEndIndex,
      viewportStartIndex,
      visibleStartIndex,
      visibleEndIndex,
      semanticBase
    };
  };
  const baseViewport = normalizeViewport(
    { visibleCount: chart.visibleCount, rightOffset: chart.rightOffset },
    chart.candles.length,
    plotWidth,
    baseViewportOptions
  );
  const baseFrame = resolveViewportTimeline(baseViewport);
  const semanticFutureSlots = futureSlotsConsumedBySemanticContent(baseFrame.semanticBase);
  const viewport = normalizeViewport(
    { visibleCount: chart.visibleCount, rightOffset: chart.rightOffset },
    chart.candles.length,
    plotWidth,
    { ...baseViewportOptions, extraFutureSlots: semanticFutureSlots }
  );
  const frame = viewport.visibleCount === baseFrame.viewport.visibleCount && viewport.rightOffset === baseFrame.viewport.rightOffset
    ? baseFrame
    : resolveViewportTimeline(viewport);
  const { viewportEndIndex, viewportStartIndex, visibleStartIndex, visibleEndIndex, semanticBase } = frame;
  const candleUnits = semanticBase.units.filter((unit): unit is Extract<SemanticRenderUnit, { kind: "candle" }> => unit.kind === "candle");
  const candles = candleUnits.map((unit) => unit.candle);
  const priceRange = priceDomain(
    semanticBase.units,
    chart,
    Math.max(1, plot.priceBottom - plot.top - (chart.chartType === "bidask" ? ORDER_FLOW_CHART_FOOTER_HEIGHT : 0))
  );
  const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume));
  const volumeRange = volumeDomain(maxVolume);
  const slotWidth = plotWidth / Math.max(1, semanticBase.totalSlots);
  const candleWidth = slotWidth < 2 ? Math.max(0.3, slotWidth * 0.75) : Math.max(2, Math.min(72, slotWidth * 0.82));
  const expansionRanges = semanticBase.expansionRanges
    .map((range) => ({
      ...range,
      left: slotBoundaryToX(plot, slotWidth, range.slotStart),
      right: slotBoundaryToX(plot, slotWidth, range.slotEnd)
    }))
    .sort((left, right) => left.depth - right.depth || left.slotStart - right.slotStart);
  return {
    width: safeWidth,
    height: safeHeight,
    chart,
    allCandles: chart.candles,
    candles,
    visibleStartIndex,
    visibleEndIndex,
    viewportStartIndex,
    viewportEndIndex,
    visibleSlotCount: viewport.visibleCount,
    semantic: {
      ...semanticBase,
      expansionRanges
    },
    hoveredNodeId: options.hoveredNodeId,
    selectedNodeId: options.selectedNodeId,
    emphasizeSelectedNode: options.emphasizeSelectedNode,
    plot,
    scales: {
      minPrice: priceRange.min,
      maxPrice: priceRange.max,
      priceTicks: priceRange.ticks,
      maxVolume: volumeRange.max,
      volumeTicks: volumeRange.ticks,
      slotWidth,
      candleWidth,
      priceBottomInset: chart.chartType === "bidask" ? ORDER_FLOW_CHART_FOOTER_HEIGHT : 0,
      ...(priceRange.bidAskPriceGrid ? { bidAskPriceGrid: priceRange.bidAskPriceGrid } : {})
    }
  };
}

function viewportClampOptionsForChart(chart: ChartState): ViewportClampOptions {
  const minimumVisibleSlots = Math.max(0, Math.ceil(chart.requestedLimit ?? 0));
  return minimumVisibleSlots > 0 ? { minimumVisibleSlots } : {};
}

function futureSlotsConsumedBySemanticContent(timeline: SemanticTimeline): number {
  return Math.max(0, Math.ceil(timeline.expansionExtraSlots));
}

const belowLayerPaneIds: Record<string, string> = {
  volume: "volume",
  "rsi:14": "rsi:14",
  "stochastic:14:3:3": "stochastic:14:3:3",
  "macd:12:26:9": "macd:12:26:9"
};

export function activeBelowPaneIds(chart: ChartState): string[] {
  if (chart.chartType === "bidask") {
    return [];
  }
  const visiblePaneIds = Object.entries(belowLayerPaneIds)
    .filter(([layer]) => Boolean(chart.layers[layer as ChartLayerKey]))
    .map(([, paneId]) => paneId);
  const visible = new Set(visiblePaneIds);
  const ordered = (chart.panes ?? [])
    .map((pane) => pane.id)
    .filter((paneId) => paneId !== "price" && visible.has(paneId));
  const missing = visiblePaneIds.filter((paneId) => !ordered.includes(paneId));
  return [...ordered, ...missing];
}

export function getPaneRatio(chart: ChartState, paneId: string): number {
  const pane = chart.panes?.find((p) => p.id === paneId);
  if (pane && typeof pane.heightRatio === "number") {
    return pane.heightRatio;
  }
  if (paneId === "price") {
    return 0.74;
  }
  return 0.22;
}

export function createCoordinateTransform(scene: ChartScene): CoordinateTransform {
  const timestampIndex = new Map(scene.allCandles.map((candle, index) => [candle.timestamp, index]));
  const anchorPriceToY = (price: number) => priceToY(scene, price);
  const yToPrice = (y: number) => {
    const range = Math.max(0.0001, scene.scales.maxPrice - scene.scales.minPrice);
    return scene.scales.maxPrice - ((y - scene.plot.top) / Math.max(1, priceContentBottom(scene) - scene.plot.top)) * range;
  };
  const logicalToX = (logicalIndex: number) => {
    const semanticSlot = scene.semantic.logicalIndexToSlot.get(logicalIndex);
    const slotCenter = typeof semanticSlot === "number" ? semanticSlot : logicalIndex - scene.viewportStartIndex + 0.5;
    return slotCenterToX(scene, slotCenter);
  };
  const xToLogical = (x: number) => (
    scene.viewportStartIndex + (x - scene.plot.left - scene.scales.slotWidth / 2) / Math.max(0.0001, scene.scales.slotWidth)
  );
  const timestampToX = (timestamp: string) => {
    const semanticSlot = scene.semantic.timestampToSlot.get(timestamp);
    if (typeof semanticSlot === "number") {
      return slotCenterToX(scene, semanticSlot);
    }
    const logicalIndex = timestampIndex.get(timestamp);
    if (typeof logicalIndex === "number") {
      return logicalToX(logicalIndex);
    }
    return continuousTimestampToX(scene, timestamp);
  };

  return {
    priceToY: anchorPriceToY,
    yToPrice,
    logicalToX,
    xToLogical,
    timestampToX,
    anchorToPoint: (anchor) => {
      const value = anchor.price;
      const timestampX = anchor.timestamp ? timestampToX(anchor.timestamp) : null;
      const x = typeof timestampX === "number"
        ? timestampX
        : typeof anchor.logicalIndex === "number"
          ? logicalToX(anchor.logicalIndex)
          : scene.plot.left;
      if (typeof x !== "number") {
        return null;
      }
      return { x, y: typeof value === "number" ? anchorPriceToY(value) : scene.plot.top };
    },
    pointToAnchor: (x, y, symbol) => {
      if (x < scene.plot.left || x > scene.plot.right || y < scene.plot.top || y > scene.plot.priceBottom) {
        return null;
      }
      const semanticHit = hitTestSemanticNode(scene, x, y);
      if (semanticHit?.kind === "candle") {
        return {
          timestamp: semanticHit.timestamp,
          logicalIndex: semanticHit.sourceIndex ?? Math.max(0, Math.round(xToLogical(x))),
          price: yToPrice(y),
          paneId: "price",
          symbol,
          interval: semanticHit.interval
        };
      }
      if (semanticHit?.kind === "time-gap") {
        const bounds = unitBoundsX(scene, semanticHit);
        const ratio = Math.max(0, Math.min(0.999999, (x - bounds.left) / Math.max(0.0001, bounds.right - bounds.left)));
        const missingIndex = Math.min(
          semanticHit.missingSlots - 1,
          Math.max(0, Math.floor(ratio * semanticHit.missingSlots))
        );
        const gapStart = Date.parse(semanticHit.from);
        const snappedTimestamp = Number.isFinite(gapStart)
          ? new Date(gapStart + missingIndex * drawingIntervalMilliseconds(semanticHit.interval)).toISOString()
          : semanticHit.from;
        return {
          timestamp: snappedTimestamp,
          price: yToPrice(y),
          paneId: "price",
          symbol,
          interval: semanticHit.interval
        };
      }
      const logicalIndex = Math.max(0, Math.min(Math.max(scene.viewportEndIndex - 1, scene.allCandles.length - 1), Math.round(xToLogical(x))));
      const candle = scene.allCandles[logicalIndex];
      if (!candle && logicalIndex < scene.allCandles.length) {
        return null;
      }
      return {
        timestamp: candle?.timestamp ?? extrapolatedDrawingTimestamp(scene.allCandles, logicalIndex, scene.chart.interval),
        logicalIndex,
        price: yToPrice(y),
        paneId: "price",
        symbol,
        interval: scene.chart.interval
      };
    }
  };
}

function extrapolatedDrawingTimestamp(candles: CandleDto[], logicalIndex: number, interval: ChartInterval): string | undefined {
  const lastIndex = candles.length - 1;
  const lastTime = Date.parse(candles[lastIndex]?.timestamp ?? "");
  if (!Number.isFinite(lastTime) || logicalIndex <= lastIndex) {
    return candles[logicalIndex]?.timestamp;
  }
  const step = drawingIntervalMilliseconds(interval);
  return new Date(lastTime + (logicalIndex - lastIndex) * step).toISOString();
}

function drawingIntervalMilliseconds(interval: ChartInterval): number {
  switch (interval) {
    case "1m": return 60_000;
    case "5m": return 5 * 60_000;
    case "10m": return 10 * 60_000;
    case "1h": return 60 * 60_000;
    case "4h": return 4 * 60 * 60_000;
    case "1D": return 24 * 60 * 60_000;
    case "1W": return 7 * 24 * 60 * 60_000;
    case "1M": return 30 * 24 * 60 * 60_000;
  }
}

function continuousTimestampToX(scene: ChartScene, timestamp: string): number | null {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return null;
  }
  const expansion = scene.semantic.expansionRanges.find((range) => {
    const start = Date.parse(range.from);
    const end = Date.parse(range.to);
    return Number.isFinite(start) && Number.isFinite(end) && time >= Math.min(start, end) && time <= Math.max(start, end);
  });
  if (expansion) {
    const start = Date.parse(expansion.from);
    const end = Date.parse(expansion.to);
    const span = Math.max(1, Math.abs(end - start));
    const ratio = Math.max(0, Math.min(1, (time - Math.min(start, end)) / span));
    return expansion.left + (expansion.right - expansion.left) * ratio;
  }
  const unit = scene.semantic.units.find((item) => {
    const start = Date.parse(item.from);
    const end = Date.parse(item.to);
    return Number.isFinite(start) && Number.isFinite(end) && time >= Math.min(start, end) && time <= Math.max(start, end);
  });
  if (!unit) {
    return null;
  }
  const start = Date.parse(unit.from);
  const end = Date.parse(unit.to);
  const span = Math.max(1, Math.abs(end - start));
  const ratio = Math.max(0, Math.min(1, (time - Math.min(start, end)) / span));
  const bounds = unitBoundsX(scene, unit);
  return bounds.left + (bounds.right - bounds.left) * ratio;
}

export function timestampAtUnitX(scene: ChartScene, unit: SemanticRenderUnit, x: number): string {
  const start = Date.parse(unit.from);
  const end = Date.parse(unit.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    return unit.kind === "candle" ? unit.timestamp : unit.from;
  }
  const bounds = unitBoundsX(scene, unit);
  const ratio = Math.max(0.000001, Math.min(0.999999, (x - bounds.left) / Math.max(0.0001, bounds.right - bounds.left)));
  return new Date(Math.min(start, end) + Math.abs(end - start) * ratio).toISOString();
}

export function priceToY(scene: Pick<ChartScene, "plot" | "scales">, value: number): number {
  const range = Math.max(0.0001, scene.scales.maxPrice - scene.scales.minPrice);
  return scene.plot.top + ((scene.scales.maxPrice - value) / range) * Math.max(1, priceContentBottom(scene) - scene.plot.top);
}

function priceContentBottom(scene: Pick<ChartScene, "plot" | "scales">): number {
  return Math.max(scene.plot.top + 1, scene.plot.priceBottom - Math.max(0, scene.scales.priceBottomInset ?? 0));
}

export function topPriceGridY(scene: Pick<ChartScene, "plot" | "scales">): number {
  const ticks = scene.scales.priceTicks.filter((tick) => Number.isFinite(tick));
  if (!ticks.length) {
    return scene.plot.top;
  }
  return priceToY(scene, Math.max(...ticks));
}

export function slotCenterToX(scene: Pick<ChartScene, "plot" | "scales">, slotCenter: number): number {
  return scene.plot.left + slotCenter * scene.scales.slotWidth;
}

export function viewportSlotWidth(scene: Pick<ChartScene, "plot" | "visibleSlotCount">): number {
  return Math.max(0.0001, (scene.plot.right - scene.plot.left) / Math.max(1, scene.visibleSlotCount));
}

export function viewportAnchorRatioAtX(scene: ChartScene, x: number): number {
  const ratio = (Math.max(scene.plot.left, Math.min(scene.plot.right, x)) - scene.plot.left)
    / Math.max(1, scene.plot.right - scene.plot.left);
  return Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.5));
}

export function unitCenterX(scene: ChartScene, unit: SemanticRenderUnit): number {
  return slotCenterToX(scene, unit.slotCenter);
}

export function unitBoundsX(scene: ChartScene, unit: SemanticRenderUnit): { left: number; right: number; center: number } {
  return {
    left: slotBoundaryToX(scene.plot, scene.scales.slotWidth, unit.slotStart),
    right: slotBoundaryToX(scene.plot, scene.scales.slotWidth, unit.slotEnd),
    center: unitCenterX(scene, unit)
  };
}

export function findSemanticUnit(scene: ChartScene, nodeId: string | undefined): SemanticRenderUnit | undefined {
  return nodeId ? scene.semantic.unitById.get(nodeId) : undefined;
}

export function hitTestSemanticNode(scene: ChartScene, x: number, y: number): SemanticRenderUnit | null {
  if (x < scene.plot.left || x > scene.plot.right || y < scene.plot.top || y > scene.plot.bottom) {
    return null;
  }
  let best: SemanticRenderUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  scene.semantic.units.forEach((unit) => {
    const bounds = unitBoundsX(scene, unit);
    if (x < bounds.left || x > bounds.right) {
      return;
    }
    const distance = Math.abs(x - bounds.center);
    if (distance < bestDistance) {
      best = unit;
      bestDistance = distance;
    }
  });
  return best;
}

export type CrosshairTimeTarget = {
  kind: "semantic" | "future";
  x: number;
  timestamp: string;
  interval: ChartInterval;
  unit?: SemanticRenderUnit;
  futureIndex?: number;
};

export function resolveCrosshairTimeTarget(
  scene: ChartScene,
  x: number,
  y: number
): CrosshairTimeTarget | null {
  if (x < scene.plot.left || x > scene.plot.right || y < scene.plot.top || y > scene.plot.bottom) {
    return null;
  }

  const semanticHit = hitTestSemanticNode(scene, x, y);
  if (semanticHit) {
    const bounds = unitBoundsX(scene, semanticHit);
    const targetX = semanticHit.kind === "time-gap"
      ? Math.max(bounds.left, Math.min(bounds.right, x))
      : bounds.center;
    return {
      kind: "semantic",
      x: targetX,
      timestamp: semanticHit.kind === "candle"
        ? semanticHit.timestamp
        : timestampAtUnitX(scene, semanticHit, targetX),
      interval: semanticHit.interval,
      unit: semanticHit
    };
  }

  const latestCandle = scene.allCandles.at(-1);
  if (!latestCandle) {
    return null;
  }
  const latestNodeId = semanticNodeId(scene.chart.symbol, scene.chart.interval, latestCandle.timestamp);
  const latestExpansion = scene.semantic.expansionRanges.find((range) => range.parentNodeId === latestNodeId);
  const latestUnit = scene.semantic.unitById.get(latestNodeId);
  const latestSlotStart = latestExpansion?.slotStart ?? latestUnit?.slotStart;
  const latestSlotEnd = latestExpansion?.slotEnd ?? latestUnit?.slotEnd;
  if (latestSlotStart === undefined || latestSlotEnd === undefined) {
    return null;
  }

  const latestStartX = slotCenterToX(scene, latestSlotStart);
  const futureStartX = slotCenterToX(scene, latestSlotEnd);
  const latestIsVisible = latestStartX < scene.plot.right && futureStartX > scene.plot.left;
  if (!latestIsVisible || futureStartX >= scene.plot.right || x < futureStartX) {
    return null;
  }

  const futureIndex = Math.max(0, Math.floor((x - futureStartX) / scene.scales.slotWidth));
  const targetX = slotCenterToX(scene, latestSlotEnd + futureIndex + 0.5);
  if (targetX < scene.plot.left || targetX > scene.plot.right) {
    return null;
  }
  const timestamp = advanceTimestampByInterval(latestCandle.timestamp, scene.chart.interval, futureIndex + 1);
  if (!timestamp) {
    return null;
  }
  return {
    kind: "future",
    x: targetX,
    timestamp,
    interval: scene.chart.interval,
    futureIndex
  };
}

export function hitTestTimeAxisUnit(scene: ChartScene, x: number, y: number): SemanticRenderUnit | null {
  if (y <= scene.plot.bottom || y > scene.height || x < scene.plot.left || x > scene.plot.right) {
    return null;
  }
  let best: SemanticRenderUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  scene.semantic.units.forEach((unit) => {
    if (unit.kind !== "candle") {
      return;
    }
    const distance = Math.abs(x - unitBoundsX(scene, unit).center);
    if (distance < bestDistance) {
      best = unit;
      bestDistance = distance;
    }
  });
  return best;
}

type PriceDomain = {
  min: number;
  max: number;
  ticks: number[];
  bidAskPriceGrid?: BidAskPriceGrid;
};

function priceDomain(units: SemanticRenderUnit[], chart: ChartState, plotHeight: number): PriceDomain {
  const candleUnits = units.filter((unit): unit is Extract<SemanticRenderUnit, { kind: "candle" }> => unit.kind === "candle");
  const carryPrices = units
    .map((unit) => unit.kind === "time-gap" ? unit.carryPrice : undefined)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (chart.chartType === "bidask") {
    const windowMinutes = orderFlowWindowMinutesForInterval(chart.interval);
    const orderFlowPrices = chart.orderFlow
      ? candleUnits.flatMap((unit) => (
        orderFlowMinutesForBucket(chart.orderFlow?.minutes ?? [], unit.timestamp, windowMinutes)
          .flatMap((minute) => minute.bins.map((level) => level.priceBin))
      ))
      : [];
    const values = candleUnits.flatMap((unit) => [
      unit.candle.high,
      unit.candle.low
    ]).concat(carryPrices, orderFlowPrices);
    const bidAskPriceGrid = buildBidAskPriceGrid(values, chart.orderFlow?.priceBinSize ?? 0.01, plotHeight);
    return {
      min: bidAskPriceGrid.domainMin,
      max: bidAskPriceGrid.domainMax,
      ticks: bidAskPriceGrid.axisTicks,
      bidAskPriceGrid
    };
  }
  const baseValues = candleUnits.flatMap((unit) => [
    unit.candle.high,
    unit.candle.low
  ])
    .concat(carryPrices)
    .filter(isPositivePrice);
  const overlayValues = candleUnits.flatMap((unit) => [
    (chart.layers["sma:5"] ?? chart.layers.ma5) ? unit.candle.ma5 : undefined,
    (chart.layers["sma:20"] ?? chart.layers.ma20) ? unit.candle.ma20 : undefined,
    (chart.layers["sma:60"] ?? chart.layers.ma60) ? unit.candle.ma60 : undefined
  ])
    .concat(indicatorDomainValues(chart, "sma:5", Boolean(chart.layers["sma:5"] ?? chart.layers.ma5), candleUnits))
    .concat(indicatorDomainValues(chart, "sma:20", Boolean(chart.layers["sma:20"] ?? chart.layers.ma20), candleUnits))
    .concat(indicatorDomainValues(chart, "sma:60", Boolean(chart.layers["sma:60"] ?? chart.layers.ma60), candleUnits))
    .concat(indicatorDomainValues(chart, "sma:120", Boolean(chart.layers["sma:120"]), candleUnits))
    .concat(indicatorDomainValues(chart, "ema:20", Boolean(chart.layers["ema:20"]), candleUnits))
    .concat(indicatorDomainValues(chart, "wma:20", Boolean(chart.layers["wma:20"]), candleUnits))
    .concat(bollingerDomainValues(chart, "bollinger:20:2", Boolean(chart.layers["bollinger:20:2"]), candleUnits))
    .concat(proposalDomainValues(chart))
    .filter(isPositivePrice);
  const livePrice = chart.streamState === "live" && isPositivePrice(chart.liveTrade?.price)
    ? [chart.liveTrade.price]
    : [];
  return priceDomainFromValues(baseValues.concat(overlayValues, livePrice), plotHeight);
}

function proposalDomainValues(chart: ChartState): number[] {
  return chart.drawings
    .filter((drawing) => drawing.visible !== false
      && drawing.type === "riskRewardBox"
      && drawing.style.zoneSplit === true
      && (drawing.id.startsWith("chart-plan:") || drawing.sourceProposalId?.startsWith("chart-plan:")))
    .flatMap((drawing) => drawing.anchors.map((anchor) => anchor.price))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function priceDomainFromValues(source: Array<number | undefined>, plotHeight: number): { min: number; max: number; ticks: number[] } {
  const scale = resolvePriceScale(source, plotHeight);
  return {
    min: scale.domainMin,
    max: scale.domainMax,
    ticks: scale.ticks
  };
}

function isPositivePrice(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function indicatorDomainValues(
  chart: ChartState,
  layerId: string,
  enabled: boolean,
  units: Extract<SemanticRenderUnit, { kind: "candle" }>[]
): number[] {
  if (!enabled) {
    return [];
  }
  const valueForUnit = createIndicatorValueLookup(chart.indicatorSeries, layerId, chart.interval);
  return units
    .map((unit) => valueForUnit(unit))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function bollingerDomainValues(
  chart: ChartState,
  layerId: string,
  enabled: boolean,
  units: Extract<SemanticRenderUnit, { kind: "candle" }>[]
): number[] {
  if (!enabled) {
    return [];
  }
  const pointForUnit = createIndicatorPointLookup(chart.indicatorSeries, layerId, chart.interval);
  return units
    .flatMap((unit) => {
      const point = pointForUnit(unit);
      return [point?.upper, point?.lower];
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function volumeDomain(maxVolume: number): { max: number; ticks: number[] } {
  const paddedMax = Math.max(1, maxVolume * volumeScalePadding);
  const top = niceIntegerCeil(paddedMax);
  const middle = Math.round(top / 2);
  return { max: top, ticks: [0, middle, top] };
}

function niceIntegerCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 1) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** Math.max(0, exponent - 1);
  return Math.max(1, Math.ceil(value / magnitude) * magnitude);
}

function slotBoundaryToX(plot: ChartPlot, slotWidth: number, slot: number): number {
  return plot.left + slot * slotWidth;
}
