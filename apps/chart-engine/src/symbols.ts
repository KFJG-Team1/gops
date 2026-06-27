export type SupportedSymbol = string;

export type SymbolMeta = {
  symbol: SupportedSymbol;
  name: string;
  market: string;
};

export type WatchlistSymbol = SymbolMeta & {
  lastPrice?: number;
  changePercent?: number;
  volume?: number;
};

const symbolPattern = /^[A-Z][A-Z0-9]{0,9}(\.[A-Z])?$/;

export function normalizeSupportedSymbol(value: string): SupportedSymbol | null {
  const symbol = value.trim().toUpperCase();
  return symbolPattern.test(symbol) ? symbol : null;
}

export function emptyWatchlistSymbols(): WatchlistSymbol[] {
  return [];
}

export function getSymbolMeta(value: string): SymbolMeta {
  const symbol = normalizeSupportedSymbol(value);
  if (!symbol) {
    return { symbol: "AAPL", name: "AAPL", market: "US" };
  }

  return { symbol, name: symbol, market: "US" };
}

export function getSymbolName(value: string): string {
  const symbol = normalizeSupportedSymbol(value);
  return symbol ? getSymbolMeta(symbol).name : value.toUpperCase();
}

export function normalizeWatchlistPayload(payload: unknown): WatchlistSymbol[] {
  if (!payload || typeof payload !== "object") {
    return emptyWatchlistSymbols();
  }

  const source = payload as Record<string, unknown>;
  const records = Array.isArray(source.symbols) ? source.symbols : [];
  const normalized = records
    .map(normalizeWatchlistRecord)
    .filter((item): item is WatchlistSymbol => Boolean(item));

  if (normalized.length) {
    return normalized;
  }

  return emptyWatchlistSymbols();
}

function normalizeWatchlistRecord(record: unknown): WatchlistSymbol | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const source = record as Record<string, unknown>;
  const symbol = normalizeSupportedSymbol(typeof source.symbol === "string" ? source.symbol : "");
  if (!symbol) {
    return null;
  }

  const fallback = getSymbolMeta(symbol);
  return {
    symbol,
    name: typeof source.name === "string" && source.name.trim() ? source.name : fallback.name,
    market: typeof source.market === "string" && source.market.trim() ? source.market.trim().toUpperCase() : fallback.market,
    ...readOptionalNumber(source.lastPrice, "lastPrice"),
    ...readOptionalNumber(source.changePercent, "changePercent"),
    ...readOptionalNumber(source.volume, "volume")
  };
}

function readOptionalNumber(value: unknown, key: "lastPrice" | "changePercent" | "volume") {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
}
