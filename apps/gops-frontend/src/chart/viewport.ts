const MIN_VISIBLE_CANDLES = 6;
const MAX_VISIBLE_CANDLES = 500;
const MIN_READABLE_SLOT_WIDTH = 4;
const FUTURE_EMPTY_SPACE_RATIO = 2 / 3;
const INITIAL_RIGHT_EMPTY_SPACE_RATIO = 1 / 3;
const WHEEL_AXIS_EPSILON = 0.5;

export type ChartViewport = {
  visibleCount: number;
  rightOffset: number;
};

export type ViewportClampOptions = {
  extraFutureSlots?: number;
  minimumVisibleSlots?: number;
};

export function clampVisibleCount(
  visibleCount: number,
  candleCount: number,
  plotWidth?: number,
  options: Pick<ViewportClampOptions, "minimumVisibleSlots"> = {}
): number {
  const widthBound = typeof plotWidth === "number"
    ? Math.max(MIN_VISIBLE_CANDLES, Math.floor(Math.max(1, plotWidth) / MIN_READABLE_SLOT_WIDTH))
    : MAX_VISIBLE_CANDLES;
  const minimumVisibleSlots = Math.max(0, Math.ceil(options.minimumVisibleSlots ?? 0));
  const visibleDataBound = Math.max(candleCount, minimumVisibleSlots);
  const dataBound = visibleDataBound > 0 ? Math.max(MIN_VISIBLE_CANDLES, visibleDataBound) : MAX_VISIBLE_CANDLES;
  const maxVisibleCount = Math.max(MIN_VISIBLE_CANDLES, Math.min(MAX_VISIBLE_CANDLES, widthBound, dataBound));
  return Math.max(MIN_VISIBLE_CANDLES, Math.min(maxVisibleCount, Math.round(visibleCount)));
}

export function clampRightOffset(
  rightOffset: number,
  visibleCount: number,
  candleCount: number,
  options: ViewportClampOptions = {}
): number {
  const safeCandleCount = Math.max(0, Math.floor(candleCount));
  const safeVisibleCount = Math.max(1, Math.round(visibleCount));
  const maxRightOffset = Math.max(0, safeCandleCount - Math.min(safeVisibleCount, safeCandleCount));
  const extraFutureSlots = Math.max(0, Math.ceil(options.extraFutureSlots ?? 0));
  const minRightOffset = -(futureEmptySlotCount(safeVisibleCount) + extraFutureSlots);
  const safeRightOffset = Number.isFinite(rightOffset) ? rightOffset : 0;
  return Math.max(minRightOffset, Math.min(maxRightOffset, safeRightOffset));
}

export function normalizeViewport(
  viewport: ChartViewport,
  candleCount: number,
  plotWidth?: number,
  options: ViewportClampOptions = {}
): ChartViewport {
  const visibleCount = clampVisibleCount(viewport.visibleCount, candleCount, plotWidth, options);
  return {
    visibleCount,
    rightOffset: clampRightOffset(viewport.rightOffset, visibleCount, candleCount, options)
  };
}

export function zoomViewport(
  viewport: ChartViewport,
  visibleCountDelta: number,
  candleCount: number,
  plotWidth?: number,
  options: ViewportClampOptions = {}
): ChartViewport {
  return normalizeViewport(
    {
      visibleCount: viewport.visibleCount + visibleCountDelta,
      rightOffset: viewport.rightOffset
    },
    candleCount,
    plotWidth,
    options
  );
}

export function zoomViewportAt(
  viewport: ChartViewport,
  visibleCountDelta: number,
  candleCount: number,
  anchorRatio: number,
  plotWidth?: number,
  options: ViewportClampOptions = {}
): ChartViewport {
  const current = normalizeViewport(viewport, candleCount, plotWidth, options);
  const nextVisibleCount = clampVisibleCount(current.visibleCount + visibleCountDelta, candleCount, plotWidth);
  const ratio = Math.max(0, Math.min(1, Number.isFinite(anchorRatio) ? anchorRatio : 0.5));
  const currentEndIndex = candleCount - current.rightOffset;
  const currentStartIndex = currentEndIndex - current.visibleCount;
  const anchorIndex = currentStartIndex + current.visibleCount * ratio;
  const nextStartIndex = anchorIndex - nextVisibleCount * ratio;
  const nextRightOffset = candleCount - (nextStartIndex + nextVisibleCount);
  return normalizeViewport(
    {
      visibleCount: nextVisibleCount,
      rightOffset: nextRightOffset
    },
    candleCount,
    plotWidth,
    options
  );
}

export function dragDeltaToRightOffset(
  startRightOffset: number,
  dragPixels: number,
  slotWidth: number,
  visibleCount: number,
  candleCount: number,
  options: ViewportClampOptions = {}
): number {
  const slotDelta = dragPixels / Math.max(0.0001, slotWidth);
  return clampRightOffset(startRightOffset + slotDelta, visibleCount, candleCount, options);
}

export function horizontalWheelDeltaToRightOffset(
  startRightOffset: number,
  deltaX: number,
  slotWidth: number,
  visibleCount: number,
  candleCount: number,
  deltaMode = 0,
  pageWidth = Math.max(1, slotWidth * visibleCount),
  options: ViewportClampOptions = {}
): number {
  const pixelDelta = wheelDeltaToPixels(deltaX, deltaMode, pageWidth);
  const slotDelta = -pixelDelta / Math.max(0.0001, slotWidth);
  return clampRightOffset(startRightOffset + slotDelta, visibleCount, candleCount, options);
}

export function resolveHorizontalWheelDelta(deltaX: number, deltaY: number, shiftKey = false): number | null {
  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
  if (Math.abs(safeDeltaX) > WHEEL_AXIS_EPSILON) {
    return safeDeltaX;
  }
  if (shiftKey && Math.abs(safeDeltaY) > WHEEL_AXIS_EPSILON) {
    return safeDeltaY;
  }
  return null;
}

function wheelDeltaToPixels(delta: number, deltaMode: number, pageWidth: number): number {
  if (!Number.isFinite(delta)) {
    return 0;
  }
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * Math.max(1, pageWidth);
  }
  return delta;
}

export function futureEmptySlotCount(visibleCount: number): number {
  return Math.max(0, Math.ceil(Math.max(1, Math.round(visibleCount)) * FUTURE_EMPTY_SPACE_RATIO));
}

export function latestCandleRightOffset(visibleCount: number): number {
  return -Math.max(0, Math.ceil(Math.max(1, Math.round(visibleCount)) * INITIAL_RIGHT_EMPTY_SPACE_RATIO));
}
