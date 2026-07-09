import type { CandleDto, ChartLayerKey, ChartState, DrawingAnchor } from "./types";
import { createIndicatorPointLookup, createIndicatorValueLookup } from "./indicatorSeries";
import { normalizeViewport, type ChartViewport, type ViewportClampOptions } from "./viewport";
import {
  buildSemanticTimeline,
  type SemanticExpansion,
  type SemanticExpansionRange,
  type SemanticRenderUnit,
  type SemanticTimeline
} from "./semanticTimeline";

const volumeScalePadding = 1.18;

// The price axis is sized to the widest expected tick label so the plot can extend as close
// to the numbers as possible without overlapping them. Labels are right-aligned 8px from the
// panel edge (see drawPriceAxis), so width = right margin + estimated label width + a small
// gap. Adaptive by magnitude: cheap 2-3 digit tickers get a tight axis, high-priced names
// (e.g. BRK.A) keep enough room.
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
  // Inflate slightly so a top tick that rounds up to an extra digit (e.g. 995 -> 1,000)
  // still fits without overlapping the plot.
  const label = Math.round(maxPrice * 1.06).toLocaleString("en-US");
  // ~5.9px per glyph at 10px Inter + 8px right margin + 5px breathing gap.
  const estimated = 8 + label.length * 5.9 + 5;
  return Math.round(Math.min(64, Math.max(32, estimated)));
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

export function buildChartScene(chart: ChartState, width: number, height: number, options: ChartSceneOptions = {}): ChartScene {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const belowPaneIds = activeBelowPaneIds(chart);
  // Keep the plot snug under the panel's top control bar; only reserve extra headroom
  // for digging metadata when an expansion is actually present, shrinking the price
  // area downward to make that room.
  const hasDigExpansions = (options.expansions?.length ?? 0) > 0;
  const padding = {
    top: hasDigExpansions ? 68 : 42,
    right: priceAxisWidthForChart(chart),
    bottom: belowPaneIds.length ? 36 : 30,
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
  const priceRange = priceDomain(semanticBase.units, chart);
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
      candleWidth
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
    return scene.scales.maxPrice - ((y - scene.plot.top) / Math.max(1, scene.plot.priceBottom - scene.plot.top)) * range;
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
          timestamp: timestampAtUnitX(scene, semanticHit, x),
          logicalIndex: semanticHit.sourceIndex,
          price: yToPrice(y),
          paneId: "price",
          symbol,
          interval: semanticHit.interval
        };
      }
      if (semanticHit?.kind === "time-gap") {
        return {
          timestamp: timestampAtUnitX(scene, semanticHit, x),
          logicalIndex: Math.max(0, Math.round(xToLogical(x))),
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
        timestamp: candle?.timestamp,
        logicalIndex,
        price: yToPrice(y),
        paneId: "price",
        symbol,
        interval: scene.chart.interval
      };
    }
  };
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
  return scene.plot.top + ((scene.scales.maxPrice - value) / range) * Math.max(1, scene.plot.priceBottom - scene.plot.top);
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

function priceDomain(units: SemanticRenderUnit[], chart: ChartState): { min: number; max: number; ticks: number[] } {
  const candleUnits = units.filter((unit): unit is Extract<SemanticRenderUnit, { kind: "candle" }> => unit.kind === "candle");
  const carryPrices = units
    .map((unit) => unit.kind === "time-gap" ? unit.carryPrice : undefined)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const values = candleUnits.flatMap((unit) => [
    unit.candle.high,
    unit.candle.low,
    (chart.layers["sma:5"] ?? chart.layers.ma5) ? unit.candle.ma5 : undefined,
    (chart.layers["sma:20"] ?? chart.layers.ma20) ? unit.candle.ma20 : undefined,
    (chart.layers["sma:60"] ?? chart.layers.ma60) ? unit.candle.ma60 : undefined
  ])
    .concat(carryPrices)
    .concat(indicatorDomainValues(chart, "sma:5", Boolean(chart.layers["sma:5"] ?? chart.layers.ma5), candleUnits))
    .concat(indicatorDomainValues(chart, "sma:20", Boolean(chart.layers["sma:20"] ?? chart.layers.ma20), candleUnits))
    .concat(indicatorDomainValues(chart, "sma:60", Boolean(chart.layers["sma:60"] ?? chart.layers.ma60), candleUnits))
    .concat(indicatorDomainValues(chart, "ema:20", Boolean(chart.layers["ema:20"]), candleUnits))
    .concat(indicatorDomainValues(chart, "wma:20", Boolean(chart.layers["wma:20"]), candleUnits))
    .concat(bollingerDomainValues(chart, "bollinger:20:2", Boolean(chart.layers["bollinger:20:2"]), candleUnits))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) {
    return { min: 0, max: 4, ticks: [0, 1, 2, 3, 4] };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawRange = Math.max(0.01, max - min);
  const pad = Math.max(0.5, rawRange * 0.08);
  return integerPriceDomain(min - pad, max + pad);
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

function integerPriceDomain(min: number, max: number): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 4, ticks: [0, 1, 2, 3, 4] };
  }
  if (max <= min) {
    const center = Math.round(max || min || 0);
    return { min: center - 2, max: center + 2, ticks: [center - 2, center - 1, center, center + 1, center + 2] };
  }
  const targetGaps = 4;
  let step = niceIntegerStep((max - min) / targetGaps);
  let domainMin = Math.floor(min / step) * step;
  let domainMax = Math.ceil(max / step) * step;
  let tickCount = Math.round((domainMax - domainMin) / step) + 1;
  while (tickCount > 7) {
    step = niceIntegerStep(step * 1.5);
    domainMin = Math.floor(min / step) * step;
    domainMax = Math.ceil(max / step) * step;
    tickCount = Math.round((domainMax - domainMin) / step) + 1;
  }
  while (tickCount < 3) {
    domainMin -= step;
    domainMax += step;
    tickCount = Math.round((domainMax - domainMin) / step) + 1;
  }
  const ticks: number[] = [];
  for (let value = domainMin; value <= domainMax + step / 2; value += step) {
    ticks.push(Math.round(value));
  }
  return { min: domainMin, max: domainMax, ticks };
}

function niceIntegerStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 1) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(nice * magnitude));
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
