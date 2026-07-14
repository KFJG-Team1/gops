import { buildLadder, type OrderFlowMinuteDto } from "../chart/orderFlow";
import type { OrderSide } from "./orderClient";

export const QUICK_ORDER_TICK = 0.01;
export const QUICK_ORDER_DELTA_THRESHOLD = 0.2;
export const QUICK_ORDER_MAX_IMBALANCE_TICKS = 20;

export type QuickOrderQuote = {
  bidPrice?: number;
  askPrice?: number;
  bidSize?: number;
  askSize?: number;
  timestamp?: string;
};

export type QuickOrderIntent = {
  side: OrderSide;
  price: number;
  source: "best-bid" | "best-ask" | "bid-offset" | "ask-offset" | "ask-imbalance" | "bid-imbalance" | "manual";
  label: string;
};

export type ImbalanceCandidates = {
  ask?: QuickOrderIntent;
  bid?: QuickOrderIntent;
};

export function normalizeQuickOrderPrice(value: number): number {
  const rounded = Math.round(value / QUICK_ORDER_TICK) * QUICK_ORDER_TICK;
  return Number(Math.max(QUICK_ORDER_TICK, rounded).toFixed(2));
}

export function quoteIsUsable(quote: QuickOrderQuote | null): boolean {
  if (!quote || !validPrice(quote.bidPrice) || !validPrice(quote.askPrice) || quote.bidPrice! > quote.askPrice!) {
    return false;
  }
  return true;
}

export function baseQuickOrderIntents(quote: QuickOrderQuote | null): QuickOrderIntent[] {
  if (!quote || !validPrice(quote.bidPrice) || !validPrice(quote.askPrice)) {
    return [];
  }
  const bid = normalizeQuickOrderPrice(quote.bidPrice!);
  const ask = normalizeQuickOrderPrice(quote.askPrice!);
  return [
    { side: "buy", price: bid, source: "best-bid", label: "최우선 매수호가" },
    { side: "sell", price: ask, source: "best-ask", label: "최우선 매도호가" },
    { side: "buy", price: normalizeQuickOrderPrice(bid - QUICK_ORDER_TICK), source: "bid-offset", label: "매수호가 - 1틱" },
    { side: "sell", price: normalizeQuickOrderPrice(ask + QUICK_ORDER_TICK), source: "ask-offset", label: "매도호가 + 1틱" }
  ];
}

export function currentMinuteLevels(minutes: Map<string, OrderFlowMinuteDto>): OrderFlowMinuteDto["bins"] {
  return Array.from(minutes.values()).sort((left, right) => left.eventMinute.localeCompare(right.eventMinute)).at(-1)?.bins ?? [];
}

export function normalizedDelta(minutes: Map<string, OrderFlowMinuteDto>): number {
  const levels = currentMinuteLevels(minutes);
  const ask = levels.reduce((sum, level) => sum + finite(level.askVolume), 0);
  const bid = levels.reduce((sum, level) => sum + finite(level.bidVolume), 0);
  return ask + bid > 0 ? (ask - bid) / (ask + bid) : 0;
}

export function deltaTone(delta: number): "buy" | "sell" | "neutral" {
  if (delta >= QUICK_ORDER_DELTA_THRESHOLD) return "buy";
  if (delta <= -QUICK_ORDER_DELTA_THRESHOLD) return "sell";
  return "neutral";
}

export function imbalanceCandidates(
  minutes: Map<string, OrderFlowMinuteDto>,
  quote: QuickOrderQuote | null,
  priceBinSize: number
): ImbalanceCandidates {
  if (!quote || !validPrice(quote.bidPrice) || !validPrice(quote.askPrice)) return {};
  const levels = currentMinuteLevels(minutes);
  if (!levels.length) return {};
  const step = validPrice(priceBinSize) ? priceBinSize : QUICK_ORDER_TICK;
  const ladder = buildLadder(levels, step);
  const mid = (quote.bidPrice! + quote.askPrice!) / 2;
  const maxDistance = QUICK_ORDER_MAX_IMBALANCE_TICKS * QUICK_ORDER_TICK;
  const nearest = (side: "ask" | "bid") => ladder.levels
    .filter((level) => side === "ask" ? level.askImbalance : level.bidImbalance)
    .filter((level) => Math.abs(level.priceBin - mid) <= maxDistance + Number.EPSILON)
    .sort((left, right) => Math.abs(left.priceBin - mid) - Math.abs(right.priceBin - mid))[0];
  const ask = nearest("ask");
  const bid = nearest("bid");
  return {
    ...(ask ? { ask: { side: "buy", price: normalizeQuickOrderPrice(ask.priceBin), source: "ask-imbalance", label: "매수 우위 후보가" } as const } : {}),
    ...(bid ? { bid: { side: "sell", price: normalizeQuickOrderPrice(bid.priceBin), source: "bid-imbalance", label: "매도 우위 후보가" } as const } : {})
  };
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
