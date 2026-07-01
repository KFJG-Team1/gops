import { createPercentScale, createTimeScale } from "./scales";
import { applyDisplayContinuity } from "./displayContinuity";
import type { CandleData, ChartCrosshair, ChartDocument, ChartLoadState, ChartPendingPreview, RenderScene, StreamStatus } from "./types";
import { resolveViewportVisibleCount } from "./viewport";

export function buildRenderScene({
  state,
  message,
  document,
  candles,
  width,
  height,
  crosshair,
  streamStatus,
  comparisonCandlesBySymbol = {},
  pendingPreview
}: {
  state: ChartLoadState;
  message?: string;
  document: ChartDocument;
  candles: CandleData[];
  width: number;
  height: number;
  crosshair?: { x: number; y: number };
  streamStatus?: StreamStatus;
  comparisonCandlesBySymbol?: Record<string, CandleData[]>;
  pendingPreview?: ChartPendingPreview;
}): RenderScene {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const variant = resolveChartSizeVariant(safeWidth, safeHeight);
  const left = variant === "compact" ? 14 : 18;
  const right = safeWidth - (variant === "compact" ? 54 : 64);
  const top = chartPlotTop(variant);
  const bottom = safeHeight - (variant === "compact" ? 20 : 24);
  const volumeHeight = variant === "compact" ? Math.max(30, safeHeight * 0.14) : Math.max(40, safeHeight * 0.16);
  const priceBottom = Math.max(top + 40, bottom - volumeHeight - 12);
  const volumeTop = priceBottom + 12;
  const plotWidth = Math.max(1, right - left);
  const visibleCount = resolveViewportVisibleCount(plotWidth, document.viewport.visibleCount);
  const rightOffset = Math.min(Math.max(0, document.viewport.rightOffset), Math.max(0, candles.length - 1));
  const visibleEnd = Math.max(0, candles.length - rightOffset);
  const visibleStart = Math.max(0, visibleEnd - visibleCount);
  const rawVisibleCandles = candles.slice(visibleStart, visibleEnd);
  const visibleCandles = applyDisplayContinuity(rawVisibleCandles, document.timeframe);
  const timeScale = createTimeScale({
    candles,
    visibleCandles,
    visibleStartIndex: visibleStart,
    visibleEndIndex: visibleEnd,
    left,
    right
  });
  const prices = visibleCandles.flatMap((candle) => [
    candle.high,
    candle.low,
    candle.ma5,
    candle.ma20,
    candle.ma60
  ]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rawMinPrice = prices.length ? Math.min(...prices) : 0;
  const rawMaxPrice = prices.length ? Math.max(...prices) : 1;
  const { minPrice, maxPrice } = padPriceRange(rawMinPrice, rawMaxPrice);
  const maxVolume = Math.max(1, ...visibleCandles.map((candle) => candle.volume));
  const comparisonSeries = buildComparisonSeries({
    document,
    pendingPreview,
    comparisonCandlesBySymbol,
    visibleCandles,
    timeScale,
    top,
    priceBottom
  });
  const comparisonPercents = comparisonSeries.flatMap((series) => series.points.map((point) => point.percent));
  const minPercent = comparisonPercents.length ? Math.min(-1, ...comparisonPercents) : -1;
  const maxPercent = comparisonPercents.length ? Math.max(1, ...comparisonPercents) : 1;
  const percentScale = createPercentScale(minPercent, maxPercent, top, priceBottom);
  const scaledComparisonSeries = comparisonSeries.map((series) => ({
    ...series,
    points: series.points.map((point) => ({ ...point, y: percentScale.percentToY(point.percent) }))
  }));
  const slotWidth = plotWidth / Math.max(1, visibleCandles.length);
  const maxCandleWidth = variant === "large" ? 18 : variant === "wide" ? 16 : 13;
  const candleWidth = slotWidth < 2
    ? Math.max(0.2, slotWidth * 0.8)
    : Math.max(2, Math.min(maxCandleWidth, slotWidth * 0.66));
  const last = visibleCandles[visibleCandles.length - 1];
  const first = visibleCandles[0];
  const change = first && last ? ((last.close - first.open) / Math.max(0.0001, first.open)) * 100 : undefined;

  const sceneBase = {
    state,
    message,
    width: safeWidth,
    height: safeHeight,
    document,
    candles: visibleCandles,
    allCandles: candles,
    visibleStartIndex: visibleStart,
    visibleEndIndex: visibleEnd,
    pendingPreview,
    variant,
    plot: {
      left,
      top,
      right,
      bottom,
      priceBottom,
      volumeTop
    },
    scales: {
      minPrice,
      maxPrice,
      maxVolume,
      minPercent,
      maxPercent,
      candleWidth,
      gap: Math.max(0, slotWidth - candleWidth)
    },
    comparisonSeries: scaledComparisonSeries,
    labels: {
      symbol: document.symbol,
      timeframe: document.timeframe,
      lastPrice: last ? last.close.toFixed(2) : undefined,
      range: prices.length ? `${rawMinPrice.toFixed(2)} - ${rawMaxPrice.toFixed(2)}` : undefined,
      change: typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : undefined,
      visibleHigh: prices.length ? rawMaxPrice.toFixed(2) : undefined,
      visibleLow: prices.length ? rawMinPrice.toFixed(2) : undefined,
      streamStatus
    }
  } satisfies RenderScene;

  return {
    ...sceneBase,
    crosshair: crosshair ? resolveCrosshair(sceneBase, crosshair.x, crosshair.y) : undefined
  };
}

function buildComparisonSeries({
  document,
  pendingPreview,
  comparisonCandlesBySymbol,
  visibleCandles,
  timeScale,
  top,
  priceBottom
}: {
  document: ChartDocument;
  pendingPreview?: ChartPendingPreview;
  comparisonCandlesBySymbol: Record<string, CandleData[]>;
  visibleCandles: CandleData[];
  timeScale: ReturnType<typeof createTimeScale>;
  top: number;
  priceBottom: number;
}): RenderScene["comparisonSeries"] {
  void top;
  void priceBottom;
  const previewComparisons = pendingPreview?.visible
    ? pendingPreview.comparisons
      .filter((comparison) => !document.comparisons.some((existing) => existing.symbol === comparison.symbol))
      .map((comparison) => ({
        ...comparison,
        label: comparison.label ?? `${comparison.symbol} preview`,
        style: {
          ...(comparison.style ?? {}),
          lineDash: comparison.style?.lineDash ?? [6, 4],
          opacity: comparison.style?.opacity ?? 0.62
        }
      }))
    : [];
  return [...document.comparisons, ...previewComparisons].map((comparison) => {
    const candles = comparisonCandlesBySymbol[comparison.symbol] ?? [];
    const visibleTimestampSet = new Set(visibleCandles.map((candle) => candle.timestamp));
    const aligned = candles.filter((candle) => visibleTimestampSet.has(candle.timestamp));
    const baseCandle = comparison.base?.mode === "timestamp" && comparison.base.timestamp
      ? candles.find((candle) => candle.timestamp === comparison.base?.timestamp)
      : aligned[0];
    const baseClose = baseCandle?.close ?? aligned[0]?.close ?? candles[0]?.close;
    const points = typeof baseClose === "number" && baseClose !== 0
      ? aligned.flatMap((candle) => {
        const x = timeScale.timestampToX(candle.timestamp);
        if (x === null) {
          return [];
        }
        const percent = ((candle.close - baseClose) / Math.max(0.0001, baseClose)) * 100;
        return [{ x, y: 0, percent, candle }];
      })
      : [];

    return { comparison, candles: aligned, points };
  });
}

function resolveVisibleCount(plotWidth: number, requestedVisibleCount: number): number {
  void plotWidth;
  return Math.max(1, Math.floor(requestedVisibleCount));
}

function chartPlotTop(variant: RenderScene["variant"]): number {
  switch (variant) {
    case "compact":
      return 12;
    case "standard":
      return 14;
    case "wide":
      return 16;
    case "large":
      return 18;
    default:
      return 16;
  }
}

function padPriceRange(rawMinPrice: number, rawMaxPrice: number): { minPrice: number; maxPrice: number } {
  const rawRange = Math.max(0.0001, rawMaxPrice - rawMinPrice);
  const magnitude = Math.max(1, Math.abs(rawMinPrice), Math.abs(rawMaxPrice));
  const minimumPad = magnitude * 0.004;
  const topPad = Math.max(rawRange * 0.28, minimumPad);
  const bottomPad = Math.max(rawRange * 0.08, minimumPad * 0.5);
  return {
    minPrice: rawMinPrice - bottomPad,
    maxPrice: rawMaxPrice + topPad
  };
}

export function resolveChartSizeVariant(width: number, height: number): RenderScene["variant"] {
  if (width < 280 || height < 190) {
    return "compact";
  }
  if (width >= 640 && height >= 320) {
    return "large";
  }
  if (width >= 470) {
    return "wide";
  }
  return "standard";
}

export function resolveCrosshair(scene: RenderScene, x: number, y: number): ChartCrosshair | undefined {
  if (scene.state !== "ready" || scene.candles.length === 0) {
    return undefined;
  }

  if (x < scene.plot.left || x > scene.plot.right || y < scene.plot.top || y > scene.plot.bottom) {
    return undefined;
  }

  const slot = (scene.plot.right - scene.plot.left) / Math.max(1, scene.candles.length);
  const candleIndex = Math.max(0, Math.min(scene.candles.length - 1, Math.floor((x - scene.plot.left) / slot)));
  const candle = scene.candles[candleIndex];
  if (!candle) {
    return undefined;
  }

  return {
    x: scene.plot.left + slot * candleIndex + slot / 2,
    y,
    candleIndex,
    candle,
    price: priceFromY(scene, y)
  };
}

export function priceFromY(scene: RenderScene, y: number): number {
  const range = Math.max(0.0001, scene.scales.maxPrice - scene.scales.minPrice);
  const ratio = (y - scene.plot.top) / Math.max(1, scene.plot.priceBottom - scene.plot.top);
  return scene.scales.maxPrice - range * ratio;
}
