import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import { formatDetectedPattern } from "./analysisAssetPresentation";
import { createCoordinateTransform, type ChartScene } from "./scene";
import type { DrawingEntity } from "./types";

export type PatternBadgeLayout = {
  text: string;
  right: number;
  top: number;
  drawingIds: string[];
};

export function buildPatternBadgeLayout(
  scene: ChartScene,
  asset: ChartAnalysisAsset | null,
  spotlightDrawingIds: readonly string[] = []
): PatternBadgeLayout | null {
  const pattern = asset?.geometry.primaryPattern ?? asset?.geometry.primaryTriangle;
  if (!asset || !pattern) return null;
  const groupedIds = asset.geometry.drawingGroups?.pattern ?? [];
  const primaryGroupedIds = groupedIds.filter((id) => id.includes(pattern.geometryHash));
  const drawingIds = primaryGroupedIds.length
    ? primaryGroupedIds
    : groupedIds.length ? groupedIds
      : asset.geometry.drawings.filter((drawing) => drawing.id.includes(pattern.geometryHash)).map((drawing) => drawing.id);
  if (!drawingIds.length) return null;
  const idSet = new Set(drawingIds);
  const spotlight = new Set(spotlightDrawingIds);
  const visibleDrawings = scene.chart.drawings.filter((drawing) => (
    idSet.has(drawing.id)
    && (drawing.visible !== false || spotlight.has(drawing.id))
  ));
  if (!visibleDrawings.some((drawing) => drawingIntersectsPricePlot(scene, drawing))) return null;
  return {
    text: formatDetectedPattern(pattern),
    right: Math.max(10, scene.width - scene.plot.right + 12),
    top: 43,
    drawingIds: visibleDrawings.map((drawing) => drawing.id)
  };
}

function drawingIntersectsPricePlot(scene: ChartScene, drawing: DrawingEntity): boolean {
  const transform = createCoordinateTransform(scene);
  const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter(isPoint);
  if (!points.length) return false;
  if (drawing.type === "horizontalLine") {
    return points[0].y >= scene.plot.top && points[0].y <= scene.plot.priceBottom;
  }
  if (drawing.type === "trendParallelLines" && points.length >= 3) {
    if (lineIntersectsPricePlot(scene, points[0], points[1], drawing.style.extension)) return true;
    const spanX = points[1].x - points[0].x;
    const baseYAtOffset = Math.abs(spanX) < 0.0001
      ? points[0].y
      : points[0].y + ((points[2].x - points[0].x) / spanX) * (points[1].y - points[0].y);
    const offsetY = points[2].y - baseYAtOffset;
    return lineIntersectsPricePlot(
      scene,
      { x: points[0].x, y: points[0].y + offsetY },
      { x: points[1].x, y: points[1].y + offsetY },
      drawing.style.extension
    );
  }
  if (points.length === 1) return pointInsidePricePlot(scene, points[0]);
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (lineIntersectsPricePlot(scene, points[index], points[index + 1], drawing.style.extension)) return true;
  }
  return false;
}

function lineIntersectsPricePlot(
  scene: ChartScene,
  start: Point,
  end: Point,
  extension: DrawingEntity["style"]["extension"]
): boolean {
  const plot = scene.plot;
  const normalizedExtension = extension === "ray" || extension === "line" ? extension : "segment";
  const spanX = end.x - start.x;
  if (Math.abs(spanX) < 0.0001) {
    if (start.x < plot.left || start.x > plot.right) return false;
    return Math.max(start.y, end.y) >= plot.top && Math.min(start.y, end.y) <= plot.priceBottom;
  }
  const minimumX = normalizedExtension === "line" ? plot.left : Math.max(plot.left, Math.min(start.x, end.x));
  const maximumX = normalizedExtension === "segment"
    ? Math.min(plot.right, Math.max(start.x, end.x))
    : plot.right;
  if (maximumX < minimumX) return false;
  const yAt = (x: number) => start.y + ((x - start.x) / spanX) * (end.y - start.y);
  const firstY = yAt(minimumX), lastY = yAt(maximumX);
  return Math.max(firstY, lastY) >= plot.top && Math.min(firstY, lastY) <= plot.priceBottom;
}

function pointInsidePricePlot(scene: ChartScene, point: Point): boolean {
  return point.x >= scene.plot.left && point.x <= scene.plot.right
    && point.y >= scene.plot.top && point.y <= scene.plot.priceBottom;
}

type Point = { x: number; y: number };

function isPoint(value: Point | null): value is Point {
  return Boolean(value);
}
