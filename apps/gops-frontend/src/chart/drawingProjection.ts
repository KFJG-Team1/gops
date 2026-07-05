import type { ChartInterval, DrawingEntity } from "./types";
import { createCoordinateTransform, priceToY, slotCenterToX, type ChartScene } from "./scene";

export type DrawingRenderItem =
  | { kind: "full"; drawing: DrawingEntity }
  | {
    kind: "expansionProjection";
    drawing: DrawingEntity;
    expansionId: string;
    left: number;
    right: number;
    top: number;
    bottom: number;
    label?: string;
  }
  | {
    kind: "collapsed";
    drawing: DrawingEntity;
    x: number;
    y: number;
    label: string;
  };

export type DrawingRenderOptions = {
  enableSemanticProjection?: boolean;
};

export function resolveDrawingRenderItems(
  scene: ChartScene,
  drawings: DrawingEntity[],
  options: DrawingRenderOptions = {}
): DrawingRenderItem[] {
  if (options.enableSemanticProjection === false) {
    return drawings.filter((drawing) => drawing.visible !== false).map((drawing) => ({ kind: "full", drawing }));
  }

  const items: DrawingRenderItem[] = [];
  drawings.filter((drawing) => drawing.visible !== false).forEach((drawing) => {
    const sourceInterval = drawing.sourceInterval;
    const timeRange = drawingTimeRange(drawing);

    if (
      sourceInterval &&
      timeRange &&
      isFinerInterval(sourceInterval, scene.chart.interval) &&
      shouldCollapseOnParent(drawing) &&
      !hasDetailExpansionForDrawing(scene, drawing, sourceInterval, timeRange)
    ) {
      const collapsed = collapsedDrawingItem(scene, drawing, timeRange);
      if (collapsed) {
        items.push(collapsed);
      }
      return;
    }

    items.push({ kind: "full", drawing });
    items.push(...expansionProjectionItems(scene, drawing, timeRange));
  });
  return items;
}

function expansionProjectionItems(scene: ChartScene, drawing: DrawingEntity, timeRange: TimeRange | null): DrawingRenderItem[] {
  if (drawing.type !== "rangeBox" || !timeRange) {
    return [];
  }
  const priceRange = drawingPriceRange(drawing);
  if (!priceRange) {
    return [];
  }
  const sourceInterval = drawing.sourceInterval;
  return scene.semantic.expansionRanges
    .filter((range) => intervalsOverlap(timeRange, isoRange(range.from, range.to)))
    .filter((range) => !sourceInterval || intervalRank(sourceInterval) >= intervalRank(range.parentInterval))
    .map((range) => ({
      kind: "expansionProjection" as const,
      drawing,
      expansionId: range.id,
      left: range.left,
      right: range.right,
      top: priceToY(scene, priceRange.max),
      bottom: priceToY(scene, priceRange.min),
      label: drawing.label
    }));
}

function collapsedDrawingItem(scene: ChartScene, drawing: DrawingEntity, timeRange: TimeRange): DrawingRenderItem | null {
  const midpoint = new Date((timeRange.start + timeRange.end) / 2).toISOString();
  const x = xForTimestampOrContainingUnit(scene, midpoint);
  const priceRange = drawingPriceRange(drawing);
  if (x === null || !priceRange) {
    return null;
  }
  return {
    kind: "collapsed",
    drawing,
    x,
    y: priceToY(scene, (priceRange.min + priceRange.max) / 2),
    label: drawing.label ?? collapsedLabel(drawing)
  };
}

function hasDetailExpansionForDrawing(
  scene: ChartScene,
  drawing: DrawingEntity,
  sourceInterval: ChartInterval,
  timeRange: TimeRange
): boolean {
  return scene.semantic.expansionRanges.some((range) => (
    intervalsOverlap(timeRange, isoRange(range.from, range.to)) &&
    range.childInterval !== "footprint" &&
    intervalRank(range.childInterval) <= intervalRank(sourceInterval) &&
    drawing.anchors.some((anchor) => anchor.timestamp && timestampInRange(anchor.timestamp, isoRange(range.from, range.to)))
  ));
}

function shouldCollapseOnParent(drawing: DrawingEntity): boolean {
  return drawing.type !== "horizontalLine";
}

function xForTimestampOrContainingUnit(scene: ChartScene, timestamp: string): number | null {
  const transform = createCoordinateTransform(scene);
  const direct = transform.timestampToX(timestamp);
  if (typeof direct === "number") {
    return direct;
  }
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return null;
  }
  const unit = scene.semantic.units.find((item) => {
    const range = isoRange(item.from, item.to);
    return time >= range.start && time < range.end;
  });
  return unit ? slotCenterToX(scene, unit.slotCenter) : null;
}

function collapsedLabel(drawing: DrawingEntity): string {
  switch (drawing.type) {
    case "trendLine":
      return "line";
    case "rangeBox":
      return "range";
    case "measurement":
      return "measure";
    default:
      return drawing.type;
  }
}

type TimeRange = {
  start: number;
  end: number;
};

function drawingTimeRange(drawing: DrawingEntity): TimeRange | null {
  const timestamps = drawing.anchors
    .map((anchor) => anchor.timestamp ? Date.parse(anchor.timestamp) : Number.NaN)
    .filter((time) => Number.isFinite(time));
  if (!timestamps.length) {
    return null;
  }
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);
  return { start, end: Math.max(start + 1, end) };
}

function drawingPriceRange(drawing: DrawingEntity): { min: number; max: number } | null {
  const prices = drawing.anchors
    .map((anchor) => anchor.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
  if (!prices.length) {
    return null;
  }
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function timestampInRange(timestamp: string, range: TimeRange): boolean {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time >= range.start && time <= range.end;
}

function intervalsOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function isoRange(from: string, to: string): TimeRange {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: 0 };
  }
  return { start: Math.min(start, end), end: Math.max(start + 1, end) };
}

function isFinerInterval(left: ChartInterval, right: ChartInterval): boolean {
  return intervalRank(left) < intervalRank(right);
}

function intervalRank(interval: ChartInterval | string): number {
  switch (interval) {
    case "1m":
      return 1;
    case "5m":
      return 5;
    case "10m":
      return 10;
    case "1D":
      return 1_440;
    case "1W":
      return 10_080;
    case "1M":
      return 43_200;
    default:
      return Number.POSITIVE_INFINITY;
  }
}
