import type { CandleEventDto } from "./types";
import {
  buildLadder,
  sessionDateFromTimestamp,
  type OrderFlowDailyResponseDto,
  type OrderFlowDayDto,
  type OrderFlowIntradayResponseDto,
  type OrderFlowLevelDto,
  type OrderFlowMinuteDto,
  type OrderFlowMinuteUpdate
} from "./orderFlow";

type OrderFlowSymbolsResponse = {
  symbols: string[];
  priceBinSize: number;
};

const demoSymbols = ["NVDA", "AMZN", "MU", "AAPL", "GOOGL"] as const;
const demoPriceBinSize = 0.01;
const symbolBasePrice: Record<string, number> = {
  NVDA: 152.4,
  AMZN: 224.8,
  MU: 132.6,
  AAPL: 211.6,
  GOOGL: 181.3
};

const dailyCache = new Map<string, OrderFlowDayDto[]>();
const intradayCache = new Map<string, OrderFlowIntradayResponseDto>();

export function isOrderFlowDemoEnabled(): boolean {
  return typeof import.meta.env !== "undefined" &&
    import.meta.env.DEV === true &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("orderFlowDemo");
}

export function fetchDemoOrderFlowSymbols(): OrderFlowSymbolsResponse {
  return {
    symbols: [...demoSymbols],
    priceBinSize: demoPriceBinSize
  };
}

export function fetchDemoOrderFlowDaily(q: { symbol: string; from: string; to: string; limitDays?: number }): OrderFlowDailyResponseDto {
  const symbol = normalizeSymbol(q.symbol);
  if (!isSupportedDemoSymbol(symbol)) {
    return demoDailyResponse(symbol, q.from, q.to, "unsupported", []);
  }
  const from = q.from || "0000-00-00";
  const to = q.to || "9999-99-99";
  const matchingDays = demoDailyDays(symbol)
    .filter((day) => day.sessionDate >= from && day.sessionDate <= to);
  const limited = typeof q.limitDays === "number" && q.limitDays > 0
    ? matchingDays.slice(-Math.floor(q.limitDays))
    : matchingDays;
  return demoDailyResponse(symbol, from, to, limited.length ? "ready" : "empty", limited);
}

export function fetchDemoOrderFlowIntraday(symbolInput: string): OrderFlowIntradayResponseDto {
  const symbol = normalizeSymbol(symbolInput);
  if (!isSupportedDemoSymbol(symbol)) {
    return {
      symbol,
      sessionDate: currentSessionDate(),
      priceBinSize: demoPriceBinSize,
      dataStatus: "unsupported",
      minutes: [],
      liveQuote: null,
      supportedSymbols: [...demoSymbols]
    };
  }
  const cached = intradayCache.get(symbol);
  if (cached) {
    return cloneIntraday(cached);
  }
  const sessionDate = currentSessionDate();
  const minutes = Array.from({ length: 390 }, (_, index) => demoMinute(symbol, sessionDate, index, 1));
  const lastPrice = symbolBasePrice[symbol] + Math.sin(389 / 24) * 0.72 + 0.38;
  const response: OrderFlowIntradayResponseDto = {
    symbol,
    sessionDate,
    priceBinSize: demoPriceBinSize,
    dataStatus: "ready",
    minutes,
    liveQuote: {
      bidPrice: roundPrice(lastPrice - 0.015),
      askPrice: roundPrice(lastPrice + 0.015),
      bidSize: 620,
      askSize: 580,
      timestamp: new Date().toISOString()
    },
    supportedSymbols: [...demoSymbols]
  };
  intradayCache.set(symbol, response);
  return cloneIntraday(response);
}

export function subscribeDemoOrderFlowTicks(
  symbolInput: string,
  onEvent: (event: CandleEventDto) => void,
  onState: (state: "connecting" | "live" | "idle" | "error") => void
): (() => void) | null {
  if (!isOrderFlowDemoEnabled()) {
    return null;
  }
  const symbol = normalizeSymbol(symbolInput);
  if (!isSupportedDemoSymbol(symbol)) {
    onState("idle");
    return () => undefined;
  }
  let tick = 0;
  const emit = () => {
    const sessionDate = currentSessionDate();
    const minuteIndex = tick % 390;
    const minute = demoMinute(symbol, sessionDate, minuteIndex, 1 + (tick % 8) * 0.025);
    const update: OrderFlowMinuteUpdate = {
      eventMinute: minute.eventMinute,
      sessionDate,
      priceBinSize: demoPriceBinSize,
      bins: minute.bins,
      updatedAt: new Date().toISOString()
    };
    const last = minute.bins[Math.floor(minute.bins.length / 2)]?.priceBin ?? symbolBasePrice[symbol];
    onEvent({
      type: "ORDER_FLOW_BINS_UPDATE",
      symbol,
      interval: "1m",
      data: update
    });
    onEvent({
      type: "LIVE_QUOTE_UPDATE",
      symbol,
      interval: "quotes",
      data: {
        bidPrice: roundPrice(last - 0.015),
        askPrice: roundPrice(last + 0.015),
        bidSize: 520 + (tick % 11) * 34,
        askSize: 480 + (tick % 7) * 39,
        timestamp: update.updatedAt
      }
    });
    tick += 1;
    onState("live");
  };
  onState("connecting");
  emit();
  const timer = window.setInterval(emit, 900);
  return () => window.clearInterval(timer);
}

function demoDailyResponse(
  symbol: string,
  from: string,
  to: string,
  dataStatus: OrderFlowDailyResponseDto["dataStatus"],
  days: OrderFlowDayDto[]
): OrderFlowDailyResponseDto {
  return {
    symbol,
    priceBinSize: demoPriceBinSize,
    sideClassification: "estimated",
    classificationVersion: "orderflow-estimated-v2",
    from,
    to,
    dataStatus,
    days: days.map(cloneDay),
    supportedSymbols: [...demoSymbols]
  };
}

function demoDailyDays(symbol: string): OrderFlowDayDto[] {
  const cached = dailyCache.get(symbol);
  if (cached) {
    return cached.map(cloneDay);
  }
  const dates = recentSessionDates(30);
  const days = dates.map((sessionDate, index) => demoDailyDay(symbol, sessionDate, index));
  dailyCache.set(symbol, days);
  return days.map(cloneDay);
}

function demoDailyDay(symbol: string, sessionDate: string, index: number): OrderFlowDayDto {
  const basePrice = symbolBasePrice[symbol] + (index - 15) * 0.22 + Math.sin(index / 2.4) * 1.35;
  const quietMultiplier = index === 7 ? 0.18 : 1;
  const heavyMultiplier = index === 21 ? 2.75 : 1;
  const directionBias = Math.sin(index / 3.2) * 0.36 + (index % 9 === 0 ? 0.42 : 0);
  const levels = Array.from({ length: 181 }, (_, offsetIndex) => {
    const offset = offsetIndex - 90;
    const priceBin = roundPrice(basePrice + offset * demoPriceBinSize);
    const curve = Math.exp(-Math.pow(offset / 32, 2));
    const ridge = 0.45 + 0.35 * Math.cos((offset + index) / 9);
    const rawVolume = (3800 + index * 95) * curve * ridge * quietMultiplier * heavyMultiplier;
    const bias = Math.max(-0.72, Math.min(0.72, directionBias + offset / 220));
    return levelAt(priceBin, rawVolume, bias, index + offsetIndex);
  });
  const ladder = buildLadder(levels, demoPriceBinSize, sessionDate);
  return {
    sessionDate,
    totals: ladder.totals,
    levels: levels.sort((left, right) => right.priceBin - left.priceBin)
  };
}

function demoMinute(symbol: string, sessionDate: string, minuteIndex: number, pulse: number): OrderFlowMinuteDto {
  const basePrice = symbolBasePrice[symbol] +
    Math.sin(minuteIndex / 31) * 0.74 +
    Math.sin(minuteIndex / 113) * 1.18 +
    minuteIndex * 0.0018;
  const rhythm = 0.75 + 0.5 * Math.sin(minuteIndex / 17) ** 2;
  const bias = Math.sin(minuteIndex / 29) * 0.48 + (minuteIndex > 260 ? 0.22 : -0.08);
  const bins = [-2, -1, 0, 1, 2, 3].map((offset, index) => (
    levelAt(
      roundPrice(basePrice + offset * demoPriceBinSize),
      (120 + rhythm * 360) * pulse * Math.exp(-Math.abs(offset) / 2.4),
      bias + offset * 0.11,
      minuteIndex + index
    )
  ));
  return {
    eventMinute: marketMinuteIso(sessionDate, minuteIndex),
    bins: bins.sort((left, right) => right.priceBin - left.priceBin)
  };
}

function levelAt(priceBin: number, rawVolume: number, bias: number, salt: number): OrderFlowLevelDto {
  const clampedBias = Math.max(-0.82, Math.min(0.82, bias));
  const total = Math.max(1, rawVolume);
  const unknownShare = 0.035 + (salt % 5) * 0.006;
  const directional = total * (1 - unknownShare);
  const askVolume = Math.max(0, directional * (0.5 + clampedBias / 2));
  const bidVolume = Math.max(0, directional - askVolume);
  const unknownVolume = total * unknownShare;
  return {
    priceBin,
    askVolume: Math.round(askVolume),
    bidVolume: Math.round(bidVolume),
    unknownVolume: Math.round(unknownVolume),
    askTradeCount: Math.max(1, Math.round(askVolume / 120)),
    bidTradeCount: Math.max(1, Math.round(bidVolume / 120)),
    unknownTradeCount: Math.max(0, Math.round(unknownVolume / 180))
  };
}

function recentSessionDates(count: number): string[] {
  const result: string[] = [];
  const [year, month, day] = currentSessionDate().split("-").map((part) => Number.parseInt(part, 10));
  const cursor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  while (result.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      result.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return result.reverse();
}

function currentSessionDate(): string {
  return sessionDateFromTimestamp(new Date().toISOString());
}

function marketMinuteIso(sessionDate: string, minuteIndex: number): string {
  const [year, month, day] = sessionDate.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day, 13, 30 + minuteIndex, 0, 0)).toISOString();
}

function cloneIntraday(response: OrderFlowIntradayResponseDto): OrderFlowIntradayResponseDto {
  return {
    ...response,
    liveQuote: response.liveQuote ? { ...response.liveQuote } : null,
    minutes: response.minutes.map((minute) => ({
      eventMinute: minute.eventMinute,
      bins: minute.bins.map((level) => ({ ...level }))
    })),
    supportedSymbols: response.supportedSymbols ? [...response.supportedSymbols] : undefined
  };
}

function cloneDay(day: OrderFlowDayDto): OrderFlowDayDto {
  return {
    sessionDate: day.sessionDate,
    totals: { ...day.totals },
    levels: day.levels.map((level) => ({ ...level }))
  };
}

function isSupportedDemoSymbol(symbol: string): symbol is typeof demoSymbols[number] {
  return (demoSymbols as readonly string[]).includes(symbol);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}
