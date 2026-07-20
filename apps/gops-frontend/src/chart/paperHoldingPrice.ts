import type { PaperPosition } from "../orders/paperTradingClient";
import { priceToY, type ChartScene } from "./scene";
import type { ChartHoldingOverlay } from "./types";

export type PaperHoldingPriceMarker = {
  priceText: string;
  y: number;
  axisLeft: number;
  axisWidth: number;
  tooltipPlacement: "above" | "below";
};

type ChartCoordinateSpace = {
  width: number;
  height: number;
};

const holdingPriceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const holdingQuantityFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 6
});

export function findPaperHoldingOverlay(
  positions: readonly PaperPosition[],
  symbol: string
): ChartHoldingOverlay | null {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return null;
  const position = positions.find((item) => item.symbol.trim().toUpperCase() === normalizedSymbol);
  if (!position) return null;
  const quantity = Number(position.qty);
  const averagePrice = Number(position.average_price);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(averagePrice) || averagePrice <= 0) {
    return null;
  }
  return {
    symbol: normalizedSymbol,
    quantity,
    averagePrice
  };
}

export function formatPaperHoldingQuantity(quantity: number): string {
  return `${holdingQuantityFormatter.format(quantity)}주`;
}

export function paperHoldingOverlayLabel(holding: ChartHoldingOverlay): string {
  return `평균 매입가 ${holdingPriceFormatter.format(holding.averagePrice)} · ${formatPaperHoldingQuantity(holding.quantity)}`;
}

export function paperHoldingOverlayPriceLabel(holding: ChartHoldingOverlay): string {
  return holdingPriceFormatter.format(holding.averagePrice);
}

export function paperHoldingPriceMarkerForScene(
  scene: ChartScene,
  coordinateSpace: ChartCoordinateSpace = scene
): PaperHoldingPriceMarker | null {
  const holding = scene.chart.holdingOverlay;
  if (!holding || holding.symbol !== scene.chart.symbol.trim().toUpperCase()) {
    return null;
  }
  const sceneY = priceToY(scene, holding.averagePrice);
  if (sceneY < scene.plot.top - 1 || sceneY > scene.plot.priceBottom + 1) {
    return null;
  }

  const scaleX = coordinateScale(coordinateSpace.width, scene.width);
  const scaleY = coordinateScale(coordinateSpace.height, scene.height);
  const y = sceneY * scaleY;
  const plotTop = scene.plot.top * scaleY;
  const priceBottom = scene.plot.priceBottom * scaleY;
  const spaceAbove = y - plotTop;
  const spaceBelow = priceBottom - y;

  return {
    priceText: paperHoldingOverlayPriceLabel(holding),
    y,
    axisLeft: scene.plot.right * scaleX,
    axisWidth: Math.max(0, (scene.width - scene.plot.right) * scaleX),
    tooltipPlacement: spaceBelow >= 142 || spaceBelow >= spaceAbove ? "below" : "above"
  };
}

export function syncPaperHoldingPriceMarkerPosition(
  element: HTMLElement | null,
  marker: PaperHoldingPriceMarker | null
): void {
  if (!element) return;
  if (!marker) {
    element.style.display = "none";
    return;
  }
  element.style.display = "";
  element.style.setProperty("--chart-holding-price-y", `${marker.y}px`);
  element.style.setProperty("--chart-holding-axis-left", `${marker.axisLeft}px`);
  element.style.setProperty("--chart-holding-axis-width", `${marker.axisWidth}px`);
}

function coordinateScale(localSize: number, sceneSize: number): number {
  return Number.isFinite(localSize) && localSize > 0 && Number.isFinite(sceneSize) && sceneSize > 0
    ? localSize / sceneSize
    : 1;
}
