export type MarketIndexItem = {
  symbol: string;
  name: string;
  assetClass: string;
  group: string;
  currency: string;
  unit: string;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  sparkline: number[];
  updatedAt?: string;
  status: string;
};

export type MarketIndicesPayload = {
  source: string;
  cacheStatus: "fresh" | "stale" | "miss";
  warning?: string;
  updatedAt: string;
  refreshSeconds: number;
  staleRefreshSeconds: number;
  period: string;
  interval: string;
  coverage: {
    total: number;
    priced: number;
    missing: string[];
  };
  items: MarketIndexItem[];
};

type RawRecord = Record<string, unknown>;

export async function fetchMarketIndices(signal?: AbortSignal): Promise<MarketIndicesPayload> {
  const response = await fetch("/api/market/indices", {
    headers: { Accept: "application/json" },
    signal
  });
  const parsedPayload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`지수 API 응답 오류 ${response.status}`);
  }
  return normalizeMarketIndicesPayload(parsedPayload);
}

function normalizeMarketIndicesPayload(payload: unknown): MarketIndicesPayload {
  const source = asRecord(payload);
  const items = readArray(source.items)
    .map(normalizeMarketIndexItem)
    .filter((item): item is MarketIndexItem => Boolean(item));
  const coverage = asRecord(source.coverage);
  return {
    source: asString(source.source) ?? "yahoo-finance",
    cacheStatus: normalizeCacheStatus(source.cacheStatus),
    warning: asString(source.warning),
    updatedAt: asString(source.updatedAt) ?? "",
    refreshSeconds: clampSeconds(asNumber(source.refreshSeconds), 30),
    staleRefreshSeconds: clampSeconds(asNumber(source.staleRefreshSeconds), 300),
    period: asString(source.period) ?? "5d",
    interval: asString(source.interval) ?? "5m",
    coverage: {
      total: asNumber(coverage.total) ?? items.length,
      priced: asNumber(coverage.priced) ?? items.filter((item) => item.price !== undefined).length,
      missing: readArray(coverage.missing).map(asString).filter((item): item is string => Boolean(item))
    },
    items
  };
}

function normalizeMarketIndexItem(value: unknown): MarketIndexItem | null {
  const source = asRecord(value);
  const symbol = asString(source.symbol);
  if (!symbol) {
    return null;
  }
  return {
    symbol,
    name: asString(source.name) ?? symbol,
    assetClass: asString(source.assetClass) ?? "index",
    group: asString(source.group) ?? "Market",
    currency: asString(source.currency) ?? "",
    unit: asString(source.unit) ?? "",
    price: asNumber(source.price),
    open: asNumber(source.open),
    high: asNumber(source.high),
    low: asNumber(source.low),
    previousClose: asNumber(source.previousClose),
    change: asNumber(source.change),
    changePercent: asNumber(source.changePercent),
    sparkline: readArray(source.sparkline).map(asNumber).filter((item): item is number => item !== undefined),
    updatedAt: asString(source.updatedAt),
    status: asString(source.status) ?? "unknown"
  };
}

function normalizeCacheStatus(value: unknown): MarketIndicesPayload["cacheStatus"] {
  if (value === "fresh" || value === "stale" || value === "miss") {
    return value;
  }
  return "miss";
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function clampSeconds(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null) {
    return fallback;
  }
  return Math.max(10, Math.min(3600, Math.round(value)));
}
