import type { PaperPosition } from "../orders/paperTradingClient";
import type { ChartHoldingOverlay } from "./types";

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
