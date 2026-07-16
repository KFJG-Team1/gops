import {
  buildProposalRiskRewardGeometry,
  proposalPriceLabelReserveWidth,
  riskRewardDirection
} from "@gops/chart-engine";
import { createCoordinateTransform, formatPriceAxisValue, type ChartScene } from "./scene";
import type { DrawingEntity } from "./types";
import { signedTradePlanPercent, tradePlanPresentation } from "./tradePlanPresentation";

export type TradePlanOverlayLabelRole = "basis" | "target" | "risk";

export type TradePlanOverlayLabelLayout = {
  role: TradePlanOverlayLabelRole;
  text: string;
  ariaLabel: string;
  price: number;
  formattedPrice: string;
  desiredY: number;
  centerY: number;
  left: number;
  top: number;
  width: number;
  tone: "up" | "down" | "basis";
  connector: { startX: number; startY: number; endX: number; endY: number };
};

export type TradePlanOverlayLayout = {
  drawingId: string;
  boxLeft: number;
  boxRight: number;
  labels: TradePlanOverlayLabelLayout[];
};

const labelGap = 8;
const labelHeight = 22;
const minimumLabelWidth = 96;
const minimumLabelCenterGap = 24;

export function buildTradePlanOverlayLayout(
  scene: ChartScene,
  drawing: DrawingEntity
): TradePlanOverlayLayout | null {
  if (drawing.type !== "riskRewardBox" || drawing.style.zoneSplit !== true || drawing.anchors.length < 3) {
    return null;
  }
  const [entryAnchor, stopAnchor, targetAnchor] = drawing.anchors;
  const prices = [entryAnchor.price, stopAnchor.price, targetAnchor.price];
  if (!prices.every(isPositiveFinite)) return null;
  const [entryPrice, stopPrice, targetPrice] = prices as [number, number, number];
  const direction = riskRewardDirection(entryPrice, stopPrice, targetPrice);
  if (!direction) return null;
  const transform = createCoordinateTransform(scene);
  const points = drawing.anchors.slice(0, 3).map((anchor) => transform.anchorToPoint(anchor));
  if (points.some((point) => !point)) return null;
  const [entryPoint, stopPoint, targetPoint] = points as Array<{ x: number; y: number }>;
  const geometry = buildProposalRiskRewardGeometry(
    entryPoint,
    stopPoint,
    targetPoint,
    direction,
    scene.plot
  );
  const left = geometry.right + labelGap;
  const width = Math.min(proposalPriceLabelReserveWidth, scene.plot.right - left);
  if (width < minimumLabelWidth || geometry.left > scene.plot.right || geometry.right < scene.plot.left) {
    return null;
  }
  const action = drawing.style.proposalAction === "sell_candidate" ? "sell_candidate" : "buy_candidate";
  const labels = tradePlanPresentation(action);
  const raw = [
    { role: "basis" as const, label: labels.basis, price: entryPrice, desiredY: entryPoint.y, tone: "basis" as const },
    { role: "target" as const, label: labels.target, price: targetPrice, desiredY: targetPoint.y, tone: action === "buy_candidate" ? "up" as const : "down" as const },
    { role: "risk" as const, label: labels.risk, price: stopPrice, desiredY: stopPoint.y, tone: action === "buy_candidate" ? "down" as const : "up" as const }
  ].sort((first, second) => first.desiredY - second.desiredY || first.role.localeCompare(second.role));
  const minCenter = scene.plot.top + labelHeight / 2;
  const maxCenter = scene.plot.priceBottom - labelHeight / 2;
  if (maxCenter - minCenter < minimumLabelCenterGap * (raw.length - 1)) return null;
  const centers: number[] = [];
  raw.forEach((item, index) => {
    centers[index] = Math.max(item.desiredY, index === 0 ? minCenter : centers[index - 1] + minimumLabelCenterGap);
  });
  const overflow = Math.max(0, centers[centers.length - 1] - maxCenter);
  if (overflow > 0) centers.forEach((center, index) => { centers[index] = center - overflow; });
  for (let index = centers.length - 2; index >= 0; index -= 1) {
    centers[index] = Math.min(centers[index], centers[index + 1] - minimumLabelCenterGap);
  }
  const underflow = Math.max(0, minCenter - centers[0]);
  if (underflow > 0) centers.forEach((center, index) => { centers[index] = center + underflow; });

  return {
    drawingId: drawing.id,
    boxLeft: geometry.left,
    boxRight: geometry.right,
    labels: raw.map((item, index) => {
      const formattedPrice = formatPriceAxisValue(item.price, 2);
      const centerY = centers[index];
      return {
        role: item.role,
        text: `${item.label} $${formattedPrice} · ${signedTradePlanPercent(item.price, entryPrice)}`,
        ariaLabel: `${item.label} 가격 ${formattedPrice} 주문창에 적용`,
        price: item.price,
        formattedPrice,
        desiredY: item.desiredY,
        centerY,
        left,
        top: centerY - labelHeight / 2,
        width,
        tone: item.tone,
        connector: {
          startX: geometry.right,
          startY: item.desiredY,
          endX: left,
          endY: centerY
        }
      };
    })
  };
}

export function tradePlanOverlayLayoutKey(layout: TradePlanOverlayLayout | null): string {
  if (!layout) return "none";
  return JSON.stringify([
    layout.drawingId,
    Math.round(layout.boxLeft),
    Math.round(layout.boxRight),
    ...layout.labels.flatMap((label) => [
      label.role,
      Math.round(label.left),
      Math.round(label.top),
      Math.round(label.width),
      Math.round(label.desiredY),
      Math.round(label.centerY),
      label.text
    ])
  ]);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
