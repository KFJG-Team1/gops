import { ChartApiError } from "./cdcClient";
import type {
  OrderFlowDailyResponseDto,
  OrderFlowDayDto,
  OrderFlowIntradayResponseDto,
  OrderFlowLevelDto,
  OrderFlowMinuteDto
} from "./orderFlow";
import type { CandleEventDto } from "./types";

type OrderFlowSymbolsResponse = {
  symbols: string[];
  priceBinSize: number;
};

let symbolsCache: OrderFlowSymbolsResponse | null = null;
const orderFlowDemoBuildEnabled = typeof import.meta.env !== "undefined" && import.meta.env.DEV === true;

export async function fetchOrderFlowSymbols(signal?: AbortSignal): Promise<OrderFlowSymbolsResponse> {
  if (isOrderFlowDemoRuntimeEnabled()) {
    const demo = await import("./orderFlowDemoData");
    return demo.fetchDemoOrderFlowSymbols();
  }
  if (symbolsCache) {
    return symbolsCache;
  }
  const result = normalizeSymbolsResponse(await fetchJson(`/api/charts/order-flow/symbols`, signal));
  symbolsCache = result;
  return result;
}

export async function fetchOrderFlowDaily(
  q: { symbol: string; from: string; to: string; limitDays?: number },
  signal?: AbortSignal
): Promise<OrderFlowDailyResponseDto> {
  if (isOrderFlowDemoRuntimeEnabled()) {
    const demo = await import("./orderFlowDemoData");
    return demo.fetchDemoOrderFlowDaily(q);
  }
  const params = new URLSearchParams({
    symbol: q.symbol.trim().toUpperCase(),
    from: q.from,
    to: q.to
  });
  if (q.limitDays !== undefined) {
    params.set("limitDays", String(q.limitDays));
  }
  return normalizeDailyResponse(await fetchJson(`/api/charts/order-flow/daily?${params.toString()}`, signal));
}

export async function fetchOrderFlowIntraday(symbol: string, signal?: AbortSignal): Promise<OrderFlowIntradayResponseDto> {
  if (isOrderFlowDemoRuntimeEnabled()) {
    const demo = await import("./orderFlowDemoData");
    return demo.fetchDemoOrderFlowIntraday(symbol);
  }
  const params = new URLSearchParams({ symbol: symbol.trim().toUpperCase() });
  return normalizeIntradayResponse(await fetchJson(`/api/charts/order-flow/intraday?${params.toString()}`, signal));
}

export function subscribeOrderFlowDemoTicks(
  symbol: string,
  onEvent: (event: CandleEventDto) => void,
  onState: (state: "connecting" | "live" | "idle" | "error") => void
): (() => void) | null {
  if (!isOrderFlowDemoRuntimeEnabled()) {
    return null;
  }
  let disposed = false;
  let cleanup: (() => void) | null = null;
  void import("./orderFlowDemoData")
    .then((demo) => {
      if (disposed) {
        return;
      }
      cleanup = demo.subscribeDemoOrderFlowTicks(symbol, onEvent, onState);
    })
    .catch(() => {
      if (!disposed) {
        onState("error");
      }
    });
  return () => {
    disposed = true;
    cleanup?.();
  };
}

function isOrderFlowDemoRuntimeEnabled(): boolean {
  return orderFlowDemoBuildEnabled &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("orderFlowDemo");
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ChartApiError(`Order flow API failed: ${response.status}`, response.status);
  }
  return response.json();
}

function normalizeSymbolsResponse(payload: unknown): OrderFlowSymbolsResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid order flow symbols response");
  }
  const source = payload as Partial<OrderFlowSymbolsResponse>;
  return {
    symbols: Array.isArray(source.symbols)
      ? source.symbols.filter((symbol): symbol is string => typeof symbol === "string").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
      : [],
    priceBinSize: finiteNumber(source.priceBinSize, 0.01)
  };
}

function normalizeDailyResponse(payload: unknown): OrderFlowDailyResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid order flow daily response");
  }
  const source = payload as Partial<OrderFlowDailyResponseDto>;
  if (!source.symbol || !Array.isArray(source.days)) {
    throw new Error("Order flow daily response missing required fields");
  }
  return {
    symbol: source.symbol.trim().toUpperCase(),
    priceBinSize: finiteNumber(source.priceBinSize, 0.01),
    sideClassification: "estimated",
    classificationVersion: source.classificationVersion ?? "orderflow-estimated-v2",
    from: source.from ?? "",
    to: source.to ?? "",
    dataStatus: normalizeDataStatus(source.dataStatus),
    days: source.days.map(normalizeDay).filter((day): day is OrderFlowDayDto => Boolean(day)).sort((left, right) => left.sessionDate.localeCompare(right.sessionDate)),
    supportedSymbols: normalizeSymbolList(source.supportedSymbols)
  };
}

function normalizeIntradayResponse(payload: unknown): OrderFlowIntradayResponseDto {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid order flow intraday response");
  }
  const source = payload as Partial<OrderFlowIntradayResponseDto>;
  if (!source.symbol || !source.sessionDate || !Array.isArray(source.minutes)) {
    throw new Error("Order flow intraday response missing required fields");
  }
  const liveQuote = source.liveQuote && typeof source.liveQuote === "object"
    ? {
        bidPrice: finiteOptional(source.liveQuote.bidPrice),
        askPrice: finiteOptional(source.liveQuote.askPrice),
        bidSize: finiteOptional(source.liveQuote.bidSize),
        askSize: finiteOptional(source.liveQuote.askSize),
        timestamp: typeof source.liveQuote.timestamp === "string" ? source.liveQuote.timestamp : undefined
      }
    : null;
  return {
    symbol: source.symbol.trim().toUpperCase(),
    sessionDate: source.sessionDate,
    priceBinSize: finiteNumber(source.priceBinSize, 0.01),
    dataStatus: normalizeDataStatus(source.dataStatus),
    minutes: source.minutes.map(normalizeMinute).filter((minute): minute is OrderFlowMinuteDto => Boolean(minute)).sort((left, right) => left.eventMinute.localeCompare(right.eventMinute)),
    liveQuote,
    supportedSymbols: normalizeSymbolList(source.supportedSymbols)
  };
}

function normalizeDay(value: unknown): OrderFlowDayDto | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Partial<OrderFlowDayDto>;
  return {
    sessionDate: typeof source.sessionDate === "string" ? source.sessionDate : "",
    totals: {
      askVolume: finiteNumber(source.totals?.askVolume, 0),
      bidVolume: finiteNumber(source.totals?.bidVolume, 0),
      unknownVolume: finiteNumber(source.totals?.unknownVolume, 0),
      delta: finiteNumber(source.totals?.delta, 0),
      tradeCount: finiteNumber(source.totals?.tradeCount, 0),
      volume: finiteNumber(source.totals?.volume, 0)
    },
    levels: Array.isArray(source.levels) ? source.levels.map(normalizeLevel).filter((level): level is OrderFlowLevelDto => Boolean(level)) : []
  };
}

function normalizeMinute(value: unknown): OrderFlowMinuteDto | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Partial<OrderFlowMinuteDto>;
  return {
    eventMinute: typeof source.eventMinute === "string" ? source.eventMinute : "",
    bins: Array.isArray(source.bins) ? source.bins.map(normalizeLevel).filter((level): level is OrderFlowLevelDto => Boolean(level)) : []
  };
}

function normalizeLevel(value: unknown): OrderFlowLevelDto | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Partial<OrderFlowLevelDto>;
  return {
    priceBin: finiteNumber(source.priceBin, 0),
    askVolume: finiteNumber(source.askVolume, 0),
    bidVolume: finiteNumber(source.bidVolume, 0),
    unknownVolume: finiteNumber(source.unknownVolume, 0),
    askTradeCount: finiteOptional(source.askTradeCount),
    bidTradeCount: finiteOptional(source.bidTradeCount),
    unknownTradeCount: finiteOptional(source.unknownTradeCount)
  };
}

function normalizeDataStatus(value: unknown): OrderFlowDailyResponseDto["dataStatus"] {
  return value === "ready" || value === "empty" || value === "unsupported" ? value : "empty";
}

function normalizeSymbolList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const symbols = value.filter((symbol): symbol is string => typeof symbol === "string").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  return symbols.length ? symbols : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
