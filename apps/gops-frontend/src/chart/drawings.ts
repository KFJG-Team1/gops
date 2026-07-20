import type {
  ChartInterval,
  ChartLineExtension,
  ChartToolMode,
  DrawingAnchor,
  DrawingEntity,
  DrawingStyle,
  DrawingType
} from "./types";
import type { ChartScene } from "./scene";
import { createCoordinateTransform } from "./scene";
import { resolveDrawingRenderItems } from "./drawingProjection";
import { nearestTypeRole, TYPE_ROLE } from "../theme/typography";
import {
  buildHorizontalParallelLines,
  buildFibonacciLevelGeometry,
  buildRiskRewardGeometry,
  buildTrendParallelLines,
  buildVerticalParallelLines,
  normalizeParallelLineCount as normalizeEngineParallelLineCount,
  parallelBandPolygons,
  riskRewardDirection,
  trendParallelBaseLineIndex,
  type DrawingLine,
  type DrawingPoint
} from "@gops/chart-engine";

export type DrawingDraft = {
  type: DrawingType;
  anchors: DrawingAnchor[];
  sourceInterval?: ChartInterval;
};

export type RangeResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type DrawingDrag = {
  drawing: DrawingEntity;
  anchor: DrawingAnchor;
  anchorIndex: number | null;
  startPoint: DrawingPoint;
  moved: boolean;
  rangeHandle?: RangeResizeHandle;
};

export const drawingTools: Array<{ mode: ChartToolMode; type?: DrawingType; label: string }> = [
  { mode: "select", label: "그리기 선택" },
  { mode: "pan", label: "차트 이동" },
  { mode: "draw-horizontalLine", type: "horizontalLine", label: "수평선" },
  { mode: "draw-horizontalParallelLines", type: "horizontalParallelLines", label: "가격 평행선" },
  { mode: "draw-verticalMarker", type: "verticalMarker", label: "시간 마커" },
  { mode: "draw-verticalParallelLines", type: "verticalParallelLines", label: "시간 평행선" },
  { mode: "draw-trendLine", type: "trendLine", label: "추세선" },
  { mode: "draw-trendParallelLines", type: "trendParallelLines", label: "추세 평행선" },
  { mode: "draw-textLabel", type: "textLabel", label: "텍스트" },
  { mode: "draw-flagMarker", type: "flagMarker", label: "플래그 마커" },
  { mode: "draw-rangeBox", type: "rangeBox", label: "범위 박스" },
  { mode: "draw-riskRewardBox", type: "riskRewardBox", label: "손익비 박스" },
  { mode: "draw-fibonacciRetracement", type: "fibonacciRetracement", label: "피보나치 되돌림" }
];

export function drawingTypeFromToolMode(mode: ChartToolMode): DrawingType | null {
  const tool = drawingTools.find((item) => item.mode === mode);
  return tool?.type ?? null;
}

export function drawingNeedsTwoAnchors(type: DrawingType): boolean {
  return drawingRequiredAnchorCount(type) > 1;
}

export function drawingRequiredAnchorCount(type: DrawingType): number {
  if (type === "trendParallelLines" || type === "riskRewardBox") {
    return 3;
  }
  if (type === "trendLine" || type === "rangeBox" || type === "horizontalParallelLines" || type === "verticalParallelLines" || type === "fibonacciRetracement") {
    return 2;
  }
  return 1;
}

export function makeDrawing(
  type: DrawingType,
  anchors: DrawingAnchor[],
  options: {
    trendLineExtension?: ChartLineExtension;
    createdBy?: "user" | "agent";
    sourceInterval?: ChartInterval;
    style?: DrawingStyle;
    label?: string;
    parallelLineCount?: number;
  } = {}
): DrawingEntity {
  const now = new Date().toISOString();
  const normalizedAnchors = normalizeDrawingAnchors(type, anchors);
  return {
    id: `drawing-${crypto.randomUUID()}`,
    type,
    anchors: normalizedAnchors,
    sourceInterval: options.sourceInterval,
    style: options.style ?? defaultDrawingStyle(type, options.trendLineExtension),
    label: options.label ?? defaultDrawingLabel(type),
    parallelLineCount: type === "trendParallelLines" ? normalizeParallelLineCount(options.parallelLineCount) : undefined,
    visible: true,
    createdBy: options.createdBy ?? "user",
    createdAt: now,
    updatedAt: now
  };
}

export function buildDraftPreviewDrawing(
  draft: DrawingDraft,
  anchor: DrawingAnchor,
  trendLineExtension: ChartLineExtension,
  parallelLineCount = 3
): DrawingEntity {
  const anchors = normalizeDrawingAnchors(draft.type, [...draft.anchors, anchor]);
  const riskValid = draft.type !== "riskRewardBox" || isValidRiskRewardAnchors(anchors);
  return {
    id: "drawing-draft-preview",
    type: draft.type,
    anchors,
    sourceInterval: draft.sourceInterval,
    style: {
      ...defaultDrawingStyle(draft.type, trendLineExtension),
      colorToken: riskValid ? defaultDrawingStyle(draft.type, trendLineExtension).colorToken : "down",
      opacity: 0.58,
      lineDash: [6, 4]
    },
    label: defaultDrawingLabel(draft.type),
    parallelLineCount: draft.type === "trendParallelLines" ? normalizeParallelLineCount(parallelLineCount) : undefined,
    visible: true,
    createdBy: "user",
    createdAt: "draft",
    updatedAt: "draft"
  };
}

export function normalizeDrawingAnchors(type: DrawingType, anchors: DrawingAnchor[]): DrawingAnchor[] {
  if (type !== "riskRewardBox" || anchors.length < 3) {
    return anchors;
  }
  const [entry, stop, target, ...rest] = anchors;
  return [
    entry,
    stop,
    { ...target, ...drawingAnchorTime(stop) },
    ...rest
  ];
}

export function isValidRiskRewardAnchors(anchors: DrawingAnchor[]): boolean {
  if (anchors.length < 3) {
    return false;
  }
  const [entry, stop, target] = anchors;
  return typeof entry.price === "number" && typeof stop.price === "number" && typeof target.price === "number" &&
    riskRewardDirection(entry.price, stop.price, target.price) !== null;
}

export function buildSingleAnchorPreviewDrawing(
  type: DrawingType,
  anchor: DrawingAnchor,
  trendLineExtension: ChartLineExtension,
  sourceInterval?: ChartInterval
): DrawingEntity {
  return {
    id: "drawing-draft-preview",
    type,
    anchors: [anchor],
    sourceInterval,
    style: { ...defaultDrawingStyle(type, trendLineExtension), opacity: 0.46, lineDash: [5, 5] },
    label: defaultDrawingLabel(type),
    visible: true,
    createdBy: "user",
    createdAt: "draft",
    updatedAt: "draft"
  };
}

export function defaultDrawingStyle(type: DrawingType, trendLineExtension: ChartLineExtension = "segment"): DrawingStyle {
  if (type === "rangeBox" || type === "fibonacciRetracement") {
    return { colorToken: "drawing", fillToken: "drawing", fillOpacity: 0.045, lineWidth: 1.0 };
  }
  if (type === "riskRewardBox") {
    return { colorToken: "drawing", fillOpacity: 0.075, lineWidth: 1.0 };
  }
  if (type === "horizontalParallelLines" || type === "verticalParallelLines" || type === "trendParallelLines") {
    return { colorToken: "drawing", fillToken: "drawing", fillOpacity: 0.04, lineWidth: 1.0 };
  }
  if (type === "trendLine") {
    return { colorToken: "drawing", lineWidth: 1.0, extension: trendLineExtension };
  }
  return { colorToken: "drawing", lineWidth: 1.0 };
}

export function defaultDrawingLabel(type?: DrawingType): string | undefined {
  switch (type) {
    case "horizontalLine":
      return "기준선";
    case "verticalMarker":
      return "이벤트";
    case "horizontalParallelLines":
      return "가격 구간";
    case "verticalParallelLines":
      return "시간 구간";
    case "textLabel":
      return "메모";
    case "flagMarker":
      return "이벤트";
    case "rangeBox":
      return "범위";
    default:
      return undefined;
  }
}

export function normalizeParallelLineCount(value: unknown): number {
  return normalizeEngineParallelLineCount(value, 3);
}

export function nearestDrawingLineWidthStage(value: number | undefined): number {
  const width = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.max(1, Math.min(5, Math.round(width * 2) / 2));
}

export function drawingSupportsTextEditing(drawing: Pick<DrawingEntity, "type" | "label">): boolean {
  return drawing.type === "horizontalLine" ||
    drawing.type === "horizontalParallelLines" ||
    drawing.type === "verticalMarker" ||
    drawing.type === "verticalParallelLines" ||
    drawing.type === "textLabel" ||
    drawing.type === "flagMarker" ||
    drawing.type === "rangeBox" ||
    typeof drawing.label === "string";
}

export function sourceIntervalForDrawingAnchors(anchors: DrawingAnchor[], fallback?: ChartInterval): ChartInterval | undefined {
  const intervals = anchors
    .map((anchor) => anchor.interval)
    .filter((interval): interval is ChartInterval => isChartInterval(interval));
  if (!intervals.length) {
    return fallback;
  }
  return intervals.reduce((best, interval) => (
    intervalGranularityRank(interval) < intervalGranularityRank(best) ? interval : best
  ), intervals[0]);
}

export function normalizeLineExtension(extension: unknown): ChartLineExtension {
  return extension === "ray" || extension === "line" ? extension : "segment";
}

export function projectTrendLine(
  start: { x: number; y: number },
  end: { x: number; y: number },
  plot: { left: number; right: number; top: number; priceBottom: number },
  extension: ChartLineExtension = "segment"
): [{ x: number; y: number }, { x: number; y: number }] {
  if (extension === "segment") {
    return [start, end];
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return [start, end];
  }
  const candidates = linePlotIntersections(start, dx, dy, plot);
  if (!candidates.length) {
    return [start, end];
  }
  if (extension === "ray") {
    const forward = candidates.filter((candidate) => candidate.t >= 0).sort((left, right) => left.t - right.t);
    const far = forward[forward.length - 1];
    return far ? [start, far.point] : [start, end];
  }
  const sorted = candidates.sort((left, right) => left.t - right.t);
  return [sorted[0].point, sorted[sorted.length - 1].point];
}

export function parallelLinesForDrawing(
  drawing: Pick<DrawingEntity, "type" | "parallelLineCount"> & { style?: DrawingEntity["style"] },
  points: DrawingPoint[],
  plot: { left: number; right: number; top: number; priceBottom: number }
): DrawingLine[] {
  if (drawing.type === "horizontalParallelLines" && points.length >= 2) {
    return buildHorizontalParallelLines(points[0], points[1], plot);
  }
  if (drawing.type === "verticalParallelLines" && points.length >= 2) {
    return buildVerticalParallelLines(points[0], points[1], plot);
  }
  if (drawing.type === "trendParallelLines") {
    if (points.length >= 3) {
      return buildTrendParallelLines(
        points[0],
        points[1],
        points[2],
        plot,
        normalizeParallelLineCount(drawing.parallelLineCount),
        normalizeLineExtension(drawing.style?.extension ?? "line")
      );
    }
    if (points.length >= 2) {
      return [projectTrendLine(points[0], points[1], plot, normalizeLineExtension(drawing.style?.extension ?? "line"))];
    }
  }
  return [];
}

export function parallelBandsForDrawing(
  drawing: Pick<DrawingEntity, "type" | "parallelLineCount"> & { style?: DrawingEntity["style"] },
  points: DrawingPoint[],
  plot: { left: number; right: number; top: number; priceBottom: number }
): DrawingPoint[][] {
  return parallelBandPolygons(parallelLinesForDrawing(drawing, points, plot), plot);
}

export function rangeResizeHandles(points: DrawingPoint[]): Array<{ handle: RangeResizeHandle; point: DrawingPoint }> {
  if (points.length < 2) {
    return [];
  }
  const left = Math.min(points[0].x, points[1].x);
  const right = Math.max(points[0].x, points[1].x);
  const top = Math.min(points[0].y, points[1].y);
  const bottom = Math.max(points[0].y, points[1].y);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return [
    { handle: "nw", point: { x: left, y: top } },
    { handle: "n", point: { x: centerX, y: top } },
    { handle: "ne", point: { x: right, y: top } },
    { handle: "e", point: { x: right, y: centerY } },
    { handle: "se", point: { x: right, y: bottom } },
    { handle: "s", point: { x: centerX, y: bottom } },
    { handle: "sw", point: { x: left, y: bottom } },
    { handle: "w", point: { x: left, y: centerY } }
  ];
}

export function buildDraggedAnchors(drag: DrawingDrag, anchor: DrawingAnchor, scene: ChartScene): DrawingAnchor[] {
  if (drag.drawing.type === "rangeBox" && drag.rangeHandle) {
    return buildRangeResizedAnchors(drag, anchor, scene);
  }
  if (drag.drawing.type === "riskRewardBox" && drag.anchorIndex !== null) {
    return buildRiskRewardDraggedAnchors(drag, anchor);
  }
  const timestampIndex = new Map(scene.allCandles.map((candle, index) => [candle.timestamp, index]));
  const dragStartLogical = anchorLogicalIndex(drag.anchor, timestampIndex);
  const dragEndLogical = anchorLogicalIndex(anchor, timestampIndex);
  const logicalDelta = Math.round(dragEndLogical - dragStartLogical);
  return drag.drawing.anchors.map((item, index) => {
    if (drag.anchorIndex !== null) {
      return index === drag.anchorIndex ? anchor : item;
    }
    const priceDelta = (anchor.price ?? 0) - (drag.anchor.price ?? 0);
    const itemLogical = anchorLogicalIndex(item, timestampIndex);
    const nextLogical = itemLogical + logicalDelta;
    const nextTimestamp = timestampAtDrawingLogicalIndex(scene, nextLogical) ?? item.timestamp;
    return {
      ...item,
      logicalIndex: nextLogical,
      timestamp: nextTimestamp,
      price: typeof item.price === "number" ? item.price + priceDelta : item.price
    };
  });
}

function buildRiskRewardDraggedAnchors(drag: DrawingDrag, anchor: DrawingAnchor): DrawingAnchor[] {
  const source = drag.drawing.anchors.slice(0, 3);
  const [entry, stop, target] = source;
  if (!entry || !stop || !target || typeof entry.price !== "number" || typeof stop.price !== "number" || typeof target.price !== "number") {
    return drag.drawing.anchors;
  }
  const originalDirection = riskRewardDirection(entry.price, stop.price, target.price);
  if (!originalDirection) {
    return drag.drawing.anchors;
  }
  if (drag.anchorIndex === 0) {
    if (typeof anchor.price !== "number" || riskRewardDirection(anchor.price, stop.price, target.price) !== originalDirection) {
      return drag.drawing.anchors;
    }
    return [{ ...entry, ...drawingAnchorTime(anchor), price: anchor.price }, stop, target];
  }
  if (drag.anchorIndex === 1) {
    if (typeof anchor.price !== "number" || riskRewardDirection(entry.price, anchor.price, target.price) !== originalDirection) {
      return drag.drawing.anchors;
    }
    const nextStop = { ...stop, ...drawingAnchorTime(anchor), price: anchor.price };
    return [entry, nextStop, { ...target, ...drawingAnchorTime(nextStop) }];
  }
  if (drag.anchorIndex === 2) {
    if (typeof anchor.price !== "number" || riskRewardDirection(entry.price, stop.price, anchor.price) !== originalDirection) {
      return drag.drawing.anchors;
    }
    return [entry, stop, { ...target, price: anchor.price, ...drawingAnchorTime(stop) }];
  }
  return drag.drawing.anchors;
}

function timestampAtDrawingLogicalIndex(scene: ChartScene, logicalIndex: number): string | undefined {
  const roundedIndex = Math.round(logicalIndex);
  const candle = scene.allCandles[roundedIndex];
  if (candle) {
    return candle.timestamp;
  }
  const boundaryIndex = roundedIndex < 0 ? 0 : scene.allCandles.length - 1;
  const boundaryTime = Date.parse(scene.allCandles[boundaryIndex]?.timestamp ?? "");
  if (!Number.isFinite(boundaryTime)) {
    return undefined;
  }
  const step = intervalMilliseconds(scene.chart.interval);
  return new Date(boundaryTime + (roundedIndex - boundaryIndex) * step).toISOString();
}

function buildRangeResizedAnchors(drag: DrawingDrag, anchor: DrawingAnchor, scene: ChartScene): DrawingAnchor[] {
  const transform = createCoordinateTransform(scene);
  const source = drag.drawing.anchors.slice(0, 2);
  const points = source.map((item) => transform.anchorToPoint(item));
  if (source.length < 2 || !points[0] || !points[1]) {
    return drag.drawing.anchors;
  }
  const leftIndex = points[0].x <= points[1].x ? 0 : 1;
  const rightIndex = leftIndex === 0 ? 1 : 0;
  const topIndex = (source[0].price ?? 0) >= (source[1].price ?? 0) ? 0 : 1;
  const bottomIndex = topIndex === 0 ? 1 : 0;
  const handle = drag.rangeHandle;
  if (!handle) {
    return drag.drawing.anchors;
  }
  return source.map((item, index) => {
    const movesTime = (handle.includes("w") && index === leftIndex) || (handle.includes("e") && index === rightIndex);
    const movesPrice = (handle.includes("n") && index === topIndex) || (handle.includes("s") && index === bottomIndex);
    return {
      ...item,
      ...(movesTime ? drawingAnchorTime(anchor) : {}),
      price: movesPrice ? anchor.price ?? item.price : item.price
    };
  });
}

function drawingAnchorTime(anchor: DrawingAnchor): Pick<DrawingAnchor, "timestamp" | "logicalIndex" | "interval" | "symbol" | "paneId"> {
  return {
    timestamp: anchor.timestamp,
    logicalIndex: anchor.logicalIndex,
    interval: anchor.interval,
    symbol: anchor.symbol,
    paneId: anchor.paneId ?? "price"
  };
}

function anchorLogicalIndex(anchor: DrawingAnchor, timestampIndex: Map<string, number>): number {
  if (anchor.timestamp) {
    const index = timestampIndex.get(anchor.timestamp);
    if (typeof index === "number") {
      return index;
    }
  }
  return typeof anchor.logicalIndex === "number" ? anchor.logicalIndex : 0;
}

function isChartInterval(value: unknown): value is ChartInterval {
  return value === "1m" || value === "5m" || value === "10m" || value === "1h" || value === "4h" || value === "1D" || value === "1W" || value === "1M";
}

function intervalGranularityRank(interval: ChartInterval): number {
  switch (interval) {
    case "1m":
      return 1;
    case "5m":
      return 5;
    case "10m":
      return 10;
    case "1h":
      return 60;
    case "4h":
      return 240;
    case "1D":
      return 1_440;
    case "1W":
      return 10_080;
    case "1M":
      return 43_200;
  }
}

function intervalMilliseconds(interval: ChartInterval): number {
  return intervalGranularityRank(interval) * 60_000;
}

export type DrawingHit = {
  drawing: DrawingEntity;
  anchorIndex: number | null;
  rangeHandle?: RangeResizeHandle;
};

export type DrawingLabelLayout = {
  label: string;
  fontSize: number;
  left: number;
  top: number;
  width: number;
  height: number;
  textX: number;
  baseline: number;
  textAlign: "left" | "right";
  boxStyle: "plain" | "tag";
};

export function drawingLabelLayout(scene: ChartScene, drawing: DrawingEntity, labelOverride?: string): DrawingLabelLayout | null {
  if (drawing.style.labelPlacement === "axis" || drawing.style.labelPlacement === "none") {
    return null;
  }
  const transform = createCoordinateTransform(scene);
  const points = drawing.anchors
    .map((anchor) => transform.anchorToPoint(anchor))
    .filter((point): point is DrawingPoint => Boolean(point));
  if (!points.length) {
    return null;
  }
  const label = (labelOverride ?? drawing.label)?.trim() || defaultDrawingLabel(drawing.type) || "";
  if (!label) {
    return null;
  }
  const fontSize = TYPE_ROLE[
    nearestTypeRole(drawing.style.fontSize ?? TYPE_ROLE.bodyMd.size, "displayMd")
  ].size;
  const estimatedTextWidth = Array.from(label).reduce((width, character) => (
    width + (/^[\x00-\x7F]$/.test(character) ? fontSize * 0.58 : fontSize)
  ), 0);
  const boxStyle: DrawingLabelLayout["boxStyle"] = drawing.type === "flagMarker" || drawing.type === "verticalParallelLines" ? "tag" : "plain";
  const height = boxStyle === "tag" ? 22 : Math.max(18, fontSize + 6);
  const width = boxStyle === "tag"
    ? Math.max(44, Math.min(150, estimatedTextWidth + 18))
    : Math.max(34, Math.min(180, estimatedTextWidth + 8));
  const makeLayout = (
    preferredLeft: number,
    preferredTop: number,
    textAlign: DrawingLabelLayout["textAlign"] = "left"
  ): DrawingLabelLayout => {
    const left = Math.max(scene.plot.left + 3, Math.min(scene.plot.right - width - 3, preferredLeft));
    const top = Math.max(scene.plot.top + 3, Math.min(scene.plot.priceBottom - height - 3, preferredTop));
    return {
      label,
      fontSize,
      left,
      top,
      width,
      height,
      textX: textAlign === "right" ? left + width - 4 : left + (boxStyle === "tag" ? 9 : 4),
      baseline: top + height / 2 + 0.5,
      textAlign,
      boxStyle
    };
  };
  if (drawing.type === "horizontalLine") {
    const right = scene.plot.right - 18;
    return makeLayout(right - width, points[0].y - height - 2, "right");
  }
  if (drawing.type === "verticalMarker") {
    return makeLayout(points[0].x + 5, scene.plot.top + 3);
  }
  if (drawing.type === "horizontalParallelLines" && points.length >= 2) {
    const upper = Math.min(points[0].y, points[1].y);
    const lower = Math.max(points[0].y, points[1].y);
    const preferredTop = lower - upper >= height + 12 ? upper + 8 : (upper + lower - height) / 2;
    return makeLayout(scene.plot.left + 8, preferredTop);
  }
  if (drawing.type === "verticalParallelLines" && points.length >= 2) {
    const centerX = (points[0].x + points[1].x) / 2;
    return makeLayout(centerX - width / 2, scene.plot.priceBottom - height - 4);
  }
  if (drawing.type === "trendParallelLines" && points.length >= 3) {
    const projected = timeWarpedParallelItem(scene, drawing);
    if (projected) {
      const labelLine = projected.lines[trendParallelBaseLineIndex(drawing.parallelLineCount ?? 3)];
      const labelPoint = labelLine?.[Math.floor((labelLine.length - 1) / 2)];
      return labelPoint ? makeLayout(labelPoint.x + 5, labelPoint.y - height / 2) : null;
    }
    const labelLine = parallelLinesForDrawing(drawing, points, scene.plot)[trendParallelBaseLineIndex(drawing.parallelLineCount ?? 3)];
    if (labelLine) {
      return makeLayout(
        (labelLine[0].x + labelLine[1].x) / 2 + 5,
        (labelLine[0].y + labelLine[1].y) / 2 - height / 2
      );
    }
  }
  if (drawing.type === "rangeBox" && points.length >= 2) {
    return makeLayout(Math.min(points[0].x, points[1].x) + 5, Math.min(points[0].y, points[1].y) + 4);
  }
  if (drawing.type === "flagMarker") {
    return makeLayout(points[0].x + 8, scene.plot.top + 3);
  }
  if (drawing.type === "textLabel") {
    return makeLayout(points[0].x + 7, points[0].y - height / 2);
  }
  if (drawing.label && points.length >= 2) {
    return makeLayout((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2 - height / 2);
  }
  return null;
}

export function drawingLabelPosition(scene: ChartScene, drawing: DrawingEntity): DrawingPoint | null {
  const layout = drawingLabelLayout(scene, drawing);
  return layout ? { x: layout.textX, y: layout.baseline } : null;
}

export function hitTestDrawing(scene: ChartScene, x: number, y: number): DrawingHit | null {
  const transform = createCoordinateTransform(scene);
  for (const drawing of [...scene.chart.drawings].reverse()) {
    if (drawing.visible === false) {
      continue;
    }
    const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is { x: number; y: number } => Boolean(point));
    const projectedParallel = drawing.type === "trendParallelLines" ? timeWarpedParallelItem(scene, drawing) : null;
    if (drawing.type === "rangeBox" && scene.chart.selectedDrawingId === drawing.id) {
      const rangeHandle = rangeResizeHandles(points).find((item) => distance(item.point.x, item.point.y, x, y) <= 9);
      if (rangeHandle) {
        return { drawing, anchorIndex: null, rangeHandle: rangeHandle.handle };
      }
    }
    const anchorPoints = projectedParallel?.handles ?? points;
    const anchorIndex = drawing.type === "rangeBox" ? -1 : anchorPoints.findIndex((point) => distance(point.x, point.y, x, y) <= 8);
    if (anchorIndex >= 0) {
      return { drawing, anchorIndex };
    }
    if ((drawing.label || drawing.type === "flagMarker") && drawingLabelHit(scene, drawing, x, y)) {
      return { drawing, anchorIndex: null };
    }
    if (drawing.type === "horizontalLine" && points[0] && Math.abs(points[0].y - y) <= 6 && x >= scene.plot.left && x <= scene.plot.right) {
      return { drawing, anchorIndex: null };
    }
    if (drawing.type === "verticalMarker" && points[0] && Math.abs(points[0].x - x) <= 6 && y >= scene.plot.top && y <= scene.plot.priceBottom) {
      return { drawing, anchorIndex: null };
    }
    if (drawing.type === "trendLine" && points.length >= 2) {
      const [start, end] = projectTrendLine(points[0], points[1], scene.plot, normalizeLineExtension(drawing.style.extension));
      if (distanceToSegment(x, y, start, end) <= 7) {
        return { drawing, anchorIndex: null };
      }
    }
    if (
      (drawing.type === "horizontalParallelLines" || drawing.type === "verticalParallelLines" || drawing.type === "trendParallelLines") &&
      points.length >= 2
    ) {
      if (projectedParallel) {
        const lineHit = projectedParallel.lines.some((linePoints) => linePoints.some((point, index) => (
          index > 0 && distanceToSegment(x, y, linePoints[index - 1], point) <= 7
        )));
        if (lineHit) {
          return { drawing, anchorIndex: null };
        }
        continue;
      }
      const lines = parallelLinesForDrawing(drawing, points, scene.plot);
      if (lines.some(([start, end]) => distanceToSegment(x, y, start, end) <= 7)) {
        return { drawing, anchorIndex: null };
      }
    }
    if (drawing.type === "rangeBox" && points.length >= 2) {
      const left = Math.min(points[0].x, points[1].x);
      const right = Math.max(points[0].x, points[1].x);
      const top = Math.min(points[0].y, points[1].y);
      const bottom = Math.max(points[0].y, points[1].y);
      const edgeDistance = Math.min(
        distanceToSegment(x, y, { x: left, y: top }, { x: right, y: top }),
        distanceToSegment(x, y, { x: right, y: top }, { x: right, y: bottom }),
        distanceToSegment(x, y, { x: right, y: bottom }, { x: left, y: bottom }),
        distanceToSegment(x, y, { x: left, y: bottom }, { x: left, y: top })
      );
      if (edgeDistance <= 7) {
        return { drawing, anchorIndex: null };
      }
    }
    if (drawing.type === "riskRewardBox" && points.length >= 3) {
      const direction = riskRewardDirection(
        drawing.anchors[0].price ?? Number.NaN,
        drawing.anchors[1].price ?? Number.NaN,
        drawing.anchors[2].price ?? Number.NaN
      );
      if (direction) {
        const geometry = buildRiskRewardGeometry(points[0], points[1], points[2], direction);
        const zoneLeft = drawing.style.zoneSplit
          ? Math.max(geometry.left, transform.logicalToX(Math.max(0, scene.chart.candles.length - 1)) + scene.scales.slotWidth / 2)
          : geometry.left;
        const lines: DrawingLine[] = drawing.style.zoneSplit ? [
          [{ x: geometry.left, y: geometry.entryY }, { x: geometry.right, y: geometry.entryY }],
          [{ x: zoneLeft, y: geometry.stopY }, { x: geometry.right, y: geometry.stopY }],
          [{ x: zoneLeft, y: geometry.targetY }, { x: geometry.right, y: geometry.targetY }]
        ] : [
          [{ x: geometry.left, y: geometry.entryY }, { x: geometry.right, y: geometry.entryY }],
          [{ x: geometry.left, y: geometry.stopY }, { x: geometry.right, y: geometry.stopY }],
          [{ x: geometry.left, y: geometry.targetY }, { x: geometry.right, y: geometry.targetY }],
          [{ x: geometry.left, y: Math.min(geometry.stopY, geometry.targetY) }, { x: geometry.left, y: Math.max(geometry.stopY, geometry.targetY) }],
          [{ x: geometry.right, y: Math.min(geometry.stopY, geometry.targetY) }, { x: geometry.right, y: Math.max(geometry.stopY, geometry.targetY) }]
        ];
        if (lines.some(([start, end]) => distanceToSegment(x, y, start, end) <= 7)) {
          return { drawing, anchorIndex: null };
        }
      }
    }
    if (drawing.type === "fibonacciRetracement" && points.length >= 2) {
      const levels = buildFibonacciLevelGeometry(points[0], points[1]);
      if (
        levels.some(({ line: [start, end] }) => distanceToSegment(x, y, start, end) <= 7) ||
        distanceToSegment(x, y, points[0], points[1]) <= 7
      ) {
        return { drawing, anchorIndex: null };
      }
    }
    if (drawing.type === "textLabel" && points[0] && distance(points[0].x, points[0].y, x, y) <= 12) {
      return { drawing, anchorIndex: null };
    }
    if (
      drawing.type === "flagMarker" &&
      points[0] &&
      (distance(points[0].x, points[0].y, x, y) <= 12 || (
        Math.abs(points[0].x - x) <= 7 && y >= scene.plot.top && y <= points[0].y
      ))
    ) {
      return { drawing, anchorIndex: null };
    }
  }
  return null;
}

function timeWarpedParallelItem(scene: ChartScene, drawing: DrawingEntity) {
  return resolveDrawingRenderItems(scene, [drawing]).find((item) => item.kind === "timeWarpedParallelLines");
}

function drawingLabelHit(scene: ChartScene, drawing: DrawingEntity, x: number, y: number): boolean {
  const layout = drawingLabelLayout(scene, drawing);
  return Boolean(layout && x >= layout.left && x <= layout.left + layout.width && y >= layout.top && y <= layout.top + layout.height);
}

export function flagTagLayout(
  scene: Pick<ChartScene, "plot">,
  drawing: Pick<DrawingEntity, "label" | "style">,
  anchorX: number
): { label: string; left: number; top: number; width: number; height: number; centerY: number } {
  const label = drawing.label?.trim() || "이벤트";
  const fontSize = drawing.style.fontSize ?? 12;
  const estimatedTextWidth = Array.from(label).reduce((width, character) => (
    width + (/^[\x00-\x7F]$/.test(character) ? fontSize * 0.58 : fontSize)
  ), 0);
  const width = Math.max(44, Math.min(150, estimatedTextWidth + 18));
  const height = 22;
  const centerY = scene.plot.top + 14;
  return {
    label,
    left: Math.max(scene.plot.left + 3, Math.min(scene.plot.right - width - 3, anchorX + 8)),
    top: centerY - height / 2,
    width,
    height,
    centerY
  };
}

function linePlotIntersections(
  start: { x: number; y: number },
  dx: number,
  dy: number,
  plot: { left: number; right: number; top: number; priceBottom: number }
): Array<{ t: number; point: { x: number; y: number } }> {
  const candidates: Array<{ t: number; point: { x: number; y: number } }> = [];
  const addCandidate = (t: number, point: { x: number; y: number }) => {
    if (
      Number.isFinite(t) &&
      point.x >= plot.left - 0.5 &&
      point.x <= plot.right + 0.5 &&
      point.y >= plot.top - 0.5 &&
      point.y <= plot.priceBottom + 0.5 &&
      !candidates.some((candidate) => Math.abs(candidate.point.x - point.x) < 0.5 && Math.abs(candidate.point.y - point.y) < 0.5)
    ) {
      candidates.push({ t, point });
    }
  };
  if (dx !== 0) {
    const leftT = (plot.left - start.x) / dx;
    addCandidate(leftT, { x: plot.left, y: start.y + leftT * dy });
    const rightT = (plot.right - start.x) / dx;
    addCandidate(rightT, { x: plot.right, y: start.y + rightT * dy });
  }
  if (dy !== 0) {
    const topT = (plot.top - start.y) / dy;
    addCandidate(topT, { x: start.x + topT * dx, y: plot.top });
    const bottomT = (plot.priceBottom - start.y) / dy;
    addCandidate(bottomT, { x: start.x + bottomT * dx, y: plot.priceBottom });
  }
  return candidates;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function distanceToSegment(x: number, y: number, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(x, y, start.x, start.y);
  }
  const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
  return distance(x, y, start.x + t * dx, start.y + t * dy);
}
