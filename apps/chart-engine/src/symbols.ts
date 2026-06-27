export const SEMICONDUCTOR_SYMBOLS = [
  "NVDA", "AMD", "AVGO", "INTC", "QCOM", "TXN", "MU", "ADI", "MRVL", "MCHP",
  "MPWR", "ON", "NXPI", "SWKS", "QRVO", "LSCC", "ALGM", "DIOD", "CRUS", "POWI",
  "SLAB", "SIMO", "HIMX", "AMBA", "CEVA", "RMBS", "MTSI", "AOSL", "MXL", "SYNA",
  "SMTC", "SGH", "SITM", "PI", "LASR", "IPGP", "COHR", "LITE", "WOLF", "NVTS",
  "CRDO", "ALAB", "MRAM", "GSIT", "ATOM", "QUIK", "PXLW", "INDI", "SKYT", "TSM",
  "UMC", "GFS", "ASX", "STM", "ARM", "ASML", "AMAT", "LRCX", "KLAC", "TER",
  "ONTO", "MKSI", "ENTG", "UCTT", "ICHR", "VECO", "ACMR", "NVMI", "CAMT", "COHU",
  "FORM", "KLIC", "AEHR", "ACLS", "AMKR", "PLAB", "TSEM", "IMOS", "SNPS", "CDNS",
  "ASYS", "INTT", "AXTI", "WDC", "STX", "KEYS", "OSIS", "NVEC", "OLED", "FN",
  "FLEX", "SANM", "JBL", "CLS", "VSH", "VICR", "BELFB", "CTS", "MEI", "ARW"
] as const;

export const SUPPORTED_SYMBOLS = SEMICONDUCTOR_SYMBOLS;

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

const defaultSymbols: SymbolMeta[] = SEMICONDUCTOR_SYMBOLS.map((symbol) => ({
  symbol,
  name: symbol,
  market: "US"
}));

export function normalizeSupportedSymbol(value: string): SupportedSymbol | null {
  const symbol = value.trim().toUpperCase();
  return symbolPattern.test(symbol) ? symbol : null;
}

export function defaultWatchlistSymbols(): WatchlistSymbol[] {
  return defaultSymbols.slice(0, 20).map((item) => ({ ...item }));
}

export function getSymbolMeta(value: string): SymbolMeta {
  const symbol = normalizeSupportedSymbol(value);
  if (!symbol) {
    return { symbol: "AAPL", name: "AAPL", market: "US" };
  }

  const fallback = defaultSymbols.find((item) => item.symbol === symbol);
  return fallback ? { ...fallback } : { symbol, name: symbol, market: "US" };
}

export function getSymbolName(value: string): string {
  const symbol = normalizeSupportedSymbol(value);
  return symbol ? getSymbolMeta(symbol).name : value.toUpperCase();
}

export function normalizeWatchlistPayload(payload: unknown): WatchlistSymbol[] {
  if (!payload || typeof payload !== "object") {
    return defaultWatchlistSymbols();
  }

  const source = payload as Record<string, unknown>;
  const records = Array.isArray(source.symbols) ? source.symbols : [];
  const normalized = records
    .map(normalizeWatchlistRecord)
    .filter((item): item is WatchlistSymbol => Boolean(item));

  if (normalized.length) {
    return normalized;
  }

  return defaultWatchlistSymbols();
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
