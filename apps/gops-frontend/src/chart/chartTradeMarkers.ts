import { priceToY, slotCenterToX, type ChartScene } from "./scene";
import type { ChartInterval } from "./types";

export type ChartTradeFill = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  filledAt: string;
  source: "paper" | "simulation";
  runId?: string;
};

export type ChartTradeMarker = {
  id: string;
  side: "buy" | "sell";
  label: "B" | "S";
  marketDate: string;
  x: number;
  top: number;
  fill: ChartTradeFill;
};

export type ChartTradeMarkerCoordinateSpace = {
  width: number;
  height: number;
};

type SceneCandleUnit = Extract<ChartScene["semantic"]["units"][number], { kind: "candle" }>;

const marketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const markerHeight = 24;
const markerGap = 4;

export function normalizeChartTradeFills(orders: unknown[]): ChartTradeFill[] {
  return orders
    .map(normalizeChartTradeFill)
    .filter((fill): fill is ChartTradeFill => fill !== null)
    .sort((left, right) => {
      const byTime = Date.parse(left.filledAt) - Date.parse(right.filledAt);
      return byTime || left.id.localeCompare(right.id);
    });
}

export function chartTradeMarkersForScene(
  scene: ChartScene,
  fills: ChartTradeFill[],
  coordinateSpace: ChartTradeMarkerCoordinateSpace = scene
): ChartTradeMarker[] {
  if (scene.chart.chartType === "bidask") return [];
  const symbol = scene.chart.symbol.trim().toUpperCase();
  const units = scene.semantic.units.filter(
    (unit): unit is SceneCandleUnit => unit.kind === "candle" && unit.depth === 0
  );
  const candidates = fills.flatMap((fill) => {
    if (fill.symbol !== symbol) return [];
    const unit = matchingTradeUnit(units, fill.filledAt, scene.chart.interval);
    if (!unit) return [];
    const baseX = slotCenterToX(scene, unit.slotCenter);
    if (baseX < scene.plot.left || baseX > scene.plot.right) return [];
    return [{
      fill,
      unit,
      baseX,
      marketDate: marketDateForTrade(fill.filledAt)
    }];
  });

  const groups = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => {
    const key = `${candidate.unit.id}:${candidate.fill.side}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  });

  return Array.from(groups.values())
    .sort((left, right) => {
      const byX = left[0].baseX - right[0].baseX;
      if (byX) return byX;
      return left[0].fill.side === right[0].fill.side ? 0 : left[0].fill.side === "buy" ? -1 : 1;
    })
    .flatMap((group) => group.map((candidate, index): ChartTradeMarker => {
      const candlePrice = candidate.fill.side === "buy"
        ? candidate.unit.candle.high
        : candidate.unit.candle.low;
      const candleY = priceToY(scene, candlePrice);
      const unboundedTop = candidate.fill.side === "buy"
        ? candleY - markerHeight - markerGap - index * (markerHeight + markerGap)
        : candleY + markerGap + index * (markerHeight + markerGap);
      const top = Math.max(scene.plot.top + 2, Math.min(scene.plot.priceBottom - markerHeight - 2, unboundedTop));
      return {
        id: candidate.fill.id,
        side: candidate.fill.side,
        label: candidate.fill.side === "buy" ? "B" : "S",
        marketDate: candidate.marketDate,
        x: scaleCoordinate(candidate.baseX, coordinateSpace.width, scene.width),
        top: scaleCoordinate(top, coordinateSpace.height, scene.height),
        fill: candidate.fill
      };
    }));
}

export function chartTradeMarkerLayoutKey(markers: ChartTradeMarker[]): string {
  return markers
    .map((marker) => `${marker.id}:${Math.round(marker.x)}:${Math.round(marker.top)}`)
    .join("|");
}

export function syncChartTradeMarkerPositions(
  container: ParentNode | null,
  markers: ChartTradeMarker[]
): void {
  if (!container) return;
  const positions = new Map(markers.map((marker) => [marker.id, marker]));
  container.querySelectorAll<HTMLElement>("[data-chart-trade-id]").forEach((element) => {
    const marker = positions.get(element.dataset.chartTradeId ?? "");
    if (!marker) {
      element.style.visibility = "hidden";
      return;
    }
    element.style.left = `${marker.x}px`;
    element.style.top = `${marker.top}px`;
    element.style.visibility = "";
  });
}

function normalizeChartTradeFill(value: unknown): ChartTradeFill | null {
  if (!value || typeof value !== "object") return null;
  const order = value as Record<string, unknown>;
  if (String(order.status || "").trim().toLowerCase() !== "filled") return null;
  const id = String(order.order_id || "").trim();
  const symbol = String(order.symbol || "").trim().toUpperCase();
  const side = String(order.side || "").trim().toLowerCase();
  const quantity = Number(order.qty);
  const price = Number(order.fill_price ?? order.filled_price);
  const filledAt = String(order.filled_at ?? order.virtualFilledAt ?? "").trim();
  if (
    !id
    || !symbol
    || (side !== "buy" && side !== "sell")
    || !Number.isFinite(quantity)
    || quantity <= 0
    || !Number.isFinite(price)
    || price <= 0
    || !Number.isFinite(Date.parse(filledAt))
  ) {
    return null;
  }
  const simulation = order.simulation === true;
  const runId = String(order.runId || "").trim() || undefined;
  return {
    id,
    symbol,
    side,
    quantity,
    price,
    filledAt,
    source: simulation ? "simulation" : "paper",
    runId
  };
}

function matchingTradeUnit(
  units: SceneCandleUnit[],
  filledAt: string,
  interval: ChartInterval
): SceneCandleUnit | undefined {
  if (!units.length) return undefined;
  const marketDate = marketDateForTrade(filledAt);
  if (interval === "1D") {
    return units.find((unit) => marketDateForTrade(unit.timestamp) === marketDate);
  }
  const fillTime = Date.parse(filledAt);
  if (!Number.isFinite(fillTime)) return undefined;
  return units.find((unit) => {
    const from = Date.parse(unit.from);
    const to = Date.parse(unit.to);
    return Number.isFinite(from) && Number.isFinite(to) && fillTime >= from && fillTime < to;
  });
}

function marketDateForTrade(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = Object.fromEntries(
    marketDateFormatter.formatToParts(parsed).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scaleCoordinate(value: number, target: number, source: number): number {
  return Number.isFinite(target) && target > 0 && Number.isFinite(source) && source > 0
    ? value / (source / target)
    : value;
}
