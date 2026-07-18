import type { ChartAnalysisAsset } from "./analysisAssetsApi";
import { analysisLayerOfDrawing } from "./analysisLayerController";
import {
  axisPillBounds,
  rightAxisOuterInset,
  type AxisPillBounds
} from "./axisPillLayout";
import { createCoordinateTransform, type ChartScene } from "./scene";
import type { DrawingEntity } from "./types";

export type AnalysisLevelPriceTarget = {
  drawingId: string;
  label: string;
  tone: "support" | "resistance";
  price: number;
  formattedPrice: string;
  bounds: AxisPillBounds;
};

type CoordinateSpace = {
  width: number;
  height: number;
};

export function analysisLevelPriceTargetsForScene(
  scene: ChartScene,
  asset: ChartAnalysisAsset | null,
  spotlightDrawingIds: readonly string[],
  measureTextWidth: (text: string) => number,
  coordinateSpace: CoordinateSpace = scene
): AnalysisLevelPriceTarget[] {
  const spotlight = new Set(spotlightDrawingIds);
  const transform = createCoordinateTransform(scene);
  const scaleX = coordinateScale(coordinateSpace.width, scene.width);
  const scaleY = coordinateScale(coordinateSpace.height, scene.height);
  const pillX = scene.width - rightAxisOuterInset;

  return scene.chart.drawings.flatMap((drawing): AnalysisLevelPriceTarget[] => {
    if (!isVisibleAnalysisLevel(drawing, asset, spotlight)) return [];
    const anchor = drawing.anchors[0];
    const price = anchor?.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return [];
    const point = transform.anchorToPoint(anchor);
    if (!point || point.y < scene.plot.top || point.y > scene.plot.priceBottom) return [];

    const formattedPrice = price.toFixed(2);
    const sceneBounds = axisPillBounds(measureTextWidth(formattedPrice), pillX, point.y, "right");
    const bounds = {
      left: sceneBounds.left * scaleX,
      top: sceneBounds.top * scaleY,
      width: sceneBounds.width * scaleX,
      height: sceneBounds.height * scaleY
    };
    return [{
      drawingId: drawing.id,
      label: drawing.label?.trim() || levelRoleLabel(drawing, asset),
      tone: levelRole(drawing, asset),
      price,
      formattedPrice,
      bounds
    }];
  });
}

export function analysisLevelPriceTargetsEqual(
  left: readonly AnalysisLevelPriceTarget[],
  right: readonly AnalysisLevelPriceTarget[]
): boolean {
  return left.length === right.length && left.every((target, index) => {
    const candidate = right[index];
    return Boolean(candidate
      && target.drawingId === candidate.drawingId
      && target.label === candidate.label
      && target.tone === candidate.tone
      && target.price === candidate.price
      && target.formattedPrice === candidate.formattedPrice
      && rounded(target.bounds.left) === rounded(candidate.bounds.left)
      && rounded(target.bounds.top) === rounded(candidate.bounds.top)
      && rounded(target.bounds.width) === rounded(candidate.bounds.width)
      && rounded(target.bounds.height) === rounded(candidate.bounds.height));
  });
}

function isVisibleAnalysisLevel(
  drawing: DrawingEntity,
  asset: ChartAnalysisAsset | null,
  spotlight: ReadonlySet<string>
): boolean {
  const placement = drawing.style?.labelPlacement;
  return drawing.type === "horizontalLine"
    && analysisLayerOfDrawing(drawing, asset) === "levels"
    && drawing.createdAt !== "draft"
    && drawing.id !== "drawing-draft-preview"
    && !drawing.id.includes("draft")
    && placement !== "inline"
    && placement !== "none"
    && (drawing.visible !== false || spotlight.has(drawing.id));
}

function levelRole(drawing: DrawingEntity, asset: ChartAnalysisAsset | null): "support" | "resistance" {
  if (drawing.style?.colorToken === "evidenceResistance") return "resistance";
  if (drawing.style?.colorToken === "evidenceSupport") return "support";
  const matches = (id: string) => drawing.id === id || drawing.id.endsWith(`:${id}`);
  if ((asset?.geometry.resistances ?? []).some((level) => matches(level.id))) return "resistance";
  if ((asset?.geometry.supports ?? []).some((level) => matches(level.id))) return "support";
  return /resist|저항/i.test(drawing.label ?? "") ? "resistance" : "support";
}

function levelRoleLabel(drawing: DrawingEntity, asset: ChartAnalysisAsset | null): string {
  return levelRole(drawing, asset) === "support" ? "지지" : "저항";
}

function coordinateScale(localSize: number, sceneSize: number): number {
  return Number.isFinite(localSize) && localSize > 0 && Number.isFinite(sceneSize) && sceneSize > 0
    ? localSize / sceneSize
    : 1;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}
