import type { ChartSymbolDto } from "./types";

export type WatchlistPayload = {
  source: string;
  feed: string;
  persisted: boolean;
  symbols: ChartSymbolDto[];
};

export class WatchlistApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WatchlistApiError";
    this.status = status;
  }
}

export async function fetchWatchlist(signal?: AbortSignal): Promise<WatchlistPayload> {
  const response = await fetch("/api/charts/watchlist", {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WatchlistApiError(response.status, readApiErrorMessage(response, payload, "관심종목 API 오류"));
  }
  return normalizeWatchlistPayload(payload);
}

export async function replaceWatchlistSymbols(symbols: string[]): Promise<WatchlistPayload> {
  const response = await fetch("/api/charts/watchlist", {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ symbols })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WatchlistApiError(response.status, readApiErrorMessage(response, payload, "관심종목 저장 오류"));
  }
  return normalizeWatchlistPayload(payload);
}

export async function addWatchlistSymbol(symbol: string): Promise<WatchlistPayload> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new WatchlistApiError(422, "관심종목에 추가할 기업을 확인할 수 없습니다.");
  }
  const current = await fetchWatchlist();
  const symbols = current.symbols.map((item) => item.symbol.toUpperCase());
  return symbols.includes(normalized)
    ? current
    : replaceWatchlistSymbols([...symbols, normalized]);
}

function normalizeWatchlistPayload(payload: unknown): WatchlistPayload {
  const source = asRecord(payload);
  return {
    source: asString(source.source) || "alpaca",
    feed: asString(source.feed) || "configured-market-feed",
    persisted: source.persisted === true,
    symbols: Array.isArray(source.symbols)
      ? source.symbols.map(normalizeWatchlistSymbol).filter((item): item is ChartSymbolDto => Boolean(item))
      : []
  };
}

function normalizeWatchlistSymbol(value: unknown): ChartSymbolDto | null {
  const source = asRecord(value);
  const symbol = asString(source.symbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }
  return {
    symbol,
    name: asString(source.name) || asString(source.companyName) || symbol,
    sector: asString(source.sector),
    isMock: source.isMock === true
  };
}

function readApiErrorMessage(response: Response, payload: unknown, fallback: string): string {
  const source = asRecord(payload);
  const detail = source.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  return `${fallback}: ${response.status}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
