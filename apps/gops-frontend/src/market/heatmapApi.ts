import type { Sp500UniverseItem } from "./sp500Universe.seed";

export type MarketHeatmapPayload = {
  source: string;
  universe: string;
  layoutAsOf: string;
  quoteAsOf: string;
  quoteRefreshSeconds: number;
  layoutRefreshSeconds: number;
  fundamentalsSource?: unknown;
  items: Sp500UniverseItem[];
};

type RawHeatmapRecord = Record<string, unknown>;

export async function fetchMarketHeatmap(signal?: AbortSignal): Promise<MarketHeatmapPayload> {
  const response = await fetch("/api/market/heatmap?universe=sp500", {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Heatmap API failed: ${response.status}`);
  }
  return normalizeMarketHeatmapPayload(await response.json());
}

function normalizeMarketHeatmapPayload(payload: unknown): MarketHeatmapPayload {
  const source = asRecord(payload);
  const items = Array.isArray(source.items)
    ? source.items.map(normalizeHeatmapItem).filter((item): item is Sp500UniverseItem => Boolean(item))
    : [];
  return {
    source: asString(source.source) || "market-heatmap-projection",
    universe: asString(source.universe) || "sp500",
    layoutAsOf: asString(source.layoutAsOf) || "",
    quoteAsOf: asString(source.quoteAsOf) || "",
    quoteRefreshSeconds: clampSeconds(asNumber(source.quoteRefreshSeconds), 60),
    layoutRefreshSeconds: clampSeconds(asNumber(source.layoutRefreshSeconds), 300),
    fundamentalsSource: source.fundamentalsSource,
    items
  };
}

function normalizeHeatmapItem(value: unknown): Sp500UniverseItem | null {
  const item = asRecord(value);
  const symbol = asString(item.symbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }
  return {
    symbol,
    companyName: asString(item.companyName) || symbol,
    sector: asString(item.sector) || "Unclassified",
    industry: asString(item.industry) || "Unclassified",
    cik: asString(item.cik),
    marketCap: asNumber(item.marketCap) ?? 1,
    marketCapSource: asString(item.marketCapSource),
    layoutPrice: asNumber(item.layoutPrice),
    layoutMarketCap: asNumber(item.layoutMarketCap),
    layoutMarketCapSource: asString(item.layoutMarketCapSource),
    layoutPriceSource: asString(item.layoutPriceSource),
    layoutPriceUpdatedAt: asString(item.layoutPriceUpdatedAt),
    sharesOutstanding: asNumber(item.sharesOutstanding),
    fundamentalsSource: asString(item.fundamentalsSource),
    fundamentalsAsOf: asString(item.fundamentalsAsOf),
    fiscalPeriod: asString(item.fiscalPeriod),
    periodEndDate: asString(item.periodEndDate),
    filedAt: asString(item.filedAt),
    lastPrice: asNumber(item.lastPrice),
    priceSource: asString(item.priceSource),
    priceUpdatedAt: asString(item.priceUpdatedAt),
    changePercent: asNumber(item.changePercent) ?? 0
  };
}

function asRecord(value: unknown): RawHeatmapRecord {
  return value && typeof value === "object" ? value as RawHeatmapRecord : {};
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
  return Math.max(15, Math.min(3600, Math.round(value)));
}
