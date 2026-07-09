import type { CandleDto, ChartInterval } from "./types";
import { chartIntervals, defaultVisibleBarsForInterval } from "./types";
import { latestCandleRightOffset, normalizeViewport, type ChartViewport, type ViewportClampOptions } from "./viewport";

export type IntervalDirection = "smaller" | "larger";

export type ViewportAnchor = {
  mode: "right" | "center";
  timestamp?: string;
  visibleCount?: number;
};

type ViewportNavigationOptions = Pick<ViewportClampOptions, "minimumVisibleSlots">;

export function adjacentInterval(interval: ChartInterval, direction: IntervalDirection): ChartInterval | null {
  const index = chartIntervals.indexOf(interval);
  if (index < 0) {
    return null;
  }
  const nextIndex = direction === "smaller" ? index - 1 : index + 1;
  return chartIntervals[nextIndex] ?? null;
}

export function anchoredViewportForCandles(
  candles: CandleDto[],
  interval: ChartInterval,
  anchor?: ViewportAnchor | null,
  fallback?: ChartViewport,
  plotWidth?: number,
  options: ViewportNavigationOptions = {}
): ChartViewport {
  const preferredVisibleCount = anchor?.visibleCount ?? fallback?.visibleCount ?? defaultVisibleBarsForInterval(interval);
  const fallbackUsesLatestSpace = !fallback || fallback.rightOffset === latestCandleRightOffset(fallback.visibleCount);
  if (!anchor?.timestamp || candles.length === 0) {
    const visibleViewport = normalizeViewport(
      {
        visibleCount: preferredVisibleCount,
        rightOffset: fallback?.rightOffset ?? 0
      },
      candles.length,
      plotWidth,
      options
    );
    return fallbackUsesLatestSpace
      ? normalizeViewport(
          {
            visibleCount: visibleViewport.visibleCount,
            rightOffset: latestCandleRightOffset(visibleViewport.visibleCount)
          },
          candles.length,
          plotWidth,
          options
        )
      : visibleViewport;
  }

  const anchorIndex = findCandleIndexAtOrBefore(candles, anchor.timestamp);
  if (anchorIndex < 0) {
    const visibleViewport = normalizeViewport(
      {
        visibleCount: preferredVisibleCount,
        rightOffset: fallback?.rightOffset ?? 0
      },
      candles.length,
      plotWidth,
      options
    );
    return fallbackUsesLatestSpace
      ? normalizeViewport(
          {
            visibleCount: visibleViewport.visibleCount,
            rightOffset: latestCandleRightOffset(visibleViewport.visibleCount)
          },
          candles.length,
          plotWidth,
          options
        )
      : visibleViewport;
  }

  const visibleCount = normalizeViewport(
    {
      visibleCount: preferredVisibleCount,
      rightOffset: fallback?.rightOffset ?? 0
    },
    candles.length,
    plotWidth,
    options
  ).visibleCount;
  const viewportEndIndex = anchor.mode === "center"
    ? anchorIndex + 1 + Math.floor(visibleCount / 2)
    : anchorIndex + 1;

  return normalizeViewport(
    {
      visibleCount,
      rightOffset: candles.length - viewportEndIndex
    },
    candles.length,
    plotWidth,
    options
  );
}

export function viewportPreservingRightEdgeAfterCandlesChange(
  previousCandles: CandleDto[],
  nextCandles: CandleDto[],
  viewport: ChartViewport,
  plotWidth?: number,
  options: ViewportNavigationOptions = {}
): ChartViewport {
  const previousViewport = normalizeViewport(viewport, previousCandles.length, plotWidth, options);
  if (previousViewport.rightOffset < 0) {
    return normalizeViewport(previousViewport, nextCandles.length, plotWidth, options);
  }

  const previousRightEdgeTimestamp = visibleRightEdgeTimestamp(previousCandles, previousViewport);
  if (!previousRightEdgeTimestamp) {
    return normalizeViewport(previousViewport, nextCandles.length, plotWidth, options);
  }

  const nextRightEdgeIndex = findCandleIndexByTimestamp(nextCandles, previousRightEdgeTimestamp);
  if (nextRightEdgeIndex < 0) {
    return normalizeViewport(previousViewport, nextCandles.length, plotWidth, options);
  }

  return normalizeViewport(
    {
      visibleCount: previousViewport.visibleCount,
      rightOffset: nextCandles.length - nextRightEdgeIndex - 1
    },
    nextCandles.length,
    plotWidth,
    options
  );
}

export function viewportRevealingPrependedCandlesAfterChange(
  previousCandles: CandleDto[],
  nextCandles: CandleDto[],
  viewport: ChartViewport,
  plotWidth?: number,
  options: ViewportNavigationOptions = {}
): ChartViewport {
  const previousViewport = normalizeViewport(viewport, previousCandles.length, plotWidth, options);
  const previousOldestTimestamp = previousCandles[0]?.timestamp;
  if (!previousOldestTimestamp) {
    return normalizeViewport(previousViewport, nextCandles.length, plotWidth, options);
  }

  const previousOldestIndex = findCandleIndexByTimestamp(nextCandles, previousOldestTimestamp);
  if (previousOldestIndex <= 0) {
    return viewportPreservingRightEdgeAfterCandlesChange(previousCandles, nextCandles, previousViewport, plotWidth, options);
  }

  return normalizeViewport(
    {
      visibleCount: previousViewport.visibleCount,
      rightOffset: previousViewport.rightOffset + previousOldestIndex
    },
    nextCandles.length,
    plotWidth,
    options
  );
}

function findCandleIndexAtOrBefore(candles: CandleDto[], timestamp: string): number {
  const target = new Date(timestamp).getTime();
  if (!Number.isFinite(target)) {
    return -1;
  }
  let best = -1;
  for (let index = 0; index < candles.length; index += 1) {
    const value = new Date(candles[index].timestamp).getTime();
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value <= target) {
      best = index;
      continue;
    }
    break;
  }
  return best;
}

function visibleRightEdgeTimestamp(candles: CandleDto[], viewport: ChartViewport): string | undefined {
  if (!candles.length) {
    return undefined;
  }
  const visibleEndIndex = Math.max(1, Math.min(candles.length, candles.length - viewport.rightOffset));
  return candles[visibleEndIndex - 1]?.timestamp ?? candles.at(-1)?.timestamp;
}

function findCandleIndexByTimestamp(candles: CandleDto[], timestamp: string): number {
  const targetTime = new Date(timestamp).getTime();
  if (!Number.isFinite(targetTime)) {
    return -1;
  }
  return candles.findIndex((candle) => {
    const candleTime = new Date(candle.timestamp).getTime();
    return Number.isFinite(candleTime) && candleTime === targetTime;
  });
}
