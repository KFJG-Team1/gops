import type { CompanyEarningsSeriesPoint, CompanyFinancialSeriesPoint, Sp500UniverseItem } from "./sp500Universe.seed";

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

export async function fetchCompanyFinancialSeries(
  symbol: string,
  signal?: AbortSignal,
  options: { years?: number; period?: "quarterly" | "annual" } = {}
): Promise<CompanyFinancialSeriesPoint[]> {
  const params = new URLSearchParams({
    years: String(options.years ?? 3),
    period: options.period ?? "quarterly"
  });
  const response = await fetch(`/api/market/fundamentals/${encodeURIComponent(symbol)}/series?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Financial series API failed: ${response.status}`);
  }
  const payload = asRecord(await response.json());
  return normalizeFinancialSeries(payload.items);
}

export async function fetchCompanyEarningsSeries(
  symbol: string,
  signal?: AbortSignal,
  options: { years?: number } = {}
): Promise<CompanyEarningsSeriesPoint[]> {
  const params = new URLSearchParams({
    years: String(options.years ?? 3)
  });
  const response = await fetch(`/api/market/fundamentals/${encodeURIComponent(symbol)}/earnings?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`Earnings series API failed: ${response.status}`);
  }
  const payload = asRecord(await response.json());
  return normalizeEarningsSeries(payload.items) ?? [];
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
    exchange: asString(item.exchange),
    market: asString(item.market),
    country: asString(item.country),
    listingDate: asString(item.listingDate) || asString(item.listing_date),
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
    revenue: asNumber(item.revenue),
    operatingIncome: asNumber(item.operatingIncome),
    netIncome: asNumber(item.netIncome),
    eps: asNumber(item.eps),
    totalAssets: asNumber(item.totalAssets),
    totalLiabilities: asNumber(item.totalLiabilities),
    totalEquity: asNumber(item.totalEquity),
    operatingCashFlow: asNumber(item.operatingCashFlow),
    freeCashFlow: asNumber(item.freeCashFlow),
    ebitda: asNumber(item.ebitda),
    earningsSeries: normalizeEarningsSeries(item.earningsSeries),
    financialSeries: normalizeFinancialSeries(item.financialSeries),
    lastPrice: asNumber(item.lastPrice),
    priceSource: asString(item.priceSource),
    priceUpdatedAt: asString(item.priceUpdatedAt),
    volume: asNumber(item.volume),
    sessionDollarVolume: asNumber(item.sessionDollarVolume),
    currency: asString(item.currency),
    changePercent: asNumber(item.changePercent) ?? 0
  };
}

function normalizeFinancialSeries(value: unknown): CompanyFinancialSeriesPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const period = asString(row.period) || asString(row.fiscalPeriod);
      if (!period) {
        return null;
      }
      return {
        period,
        periodEndDate: asString(row.periodEndDate),
        revenue: asNumber(row.revenue),
        operatingIncome: asNumber(row.operatingIncome),
        netIncome: asNumber(row.netIncome),
        eps: asNumber(row.eps),
        totalAssets: asNumber(row.totalAssets),
        totalLiabilities: asNumber(row.totalLiabilities),
        totalEquity: asNumber(row.totalEquity),
        operatingCashFlow: asNumber(row.operatingCashFlow),
        freeCashFlow: asNumber(row.freeCashFlow),
        sharesOutstanding: asNumber(row.sharesOutstanding),
        source: asString(row.source),
        filedAt: asString(row.filedAt)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeEarningsSeries(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const period = asString(row.period) || asString(row.fiscalPeriod);
      if (!period) {
        return null;
      }
      return {
        period,
        periodEndDate: asString(row.periodEndDate),
        actualEps: asNumber(row.actualEps),
        estimatedEps: asNumber(row.estimatedEps),
        actualRevenue: asNumber(row.actualRevenue),
        estimatedRevenue: asNumber(row.estimatedRevenue),
        source: asString(row.source),
        estimateSource: asString(row.estimateSource),
        filedAt: asString(row.filedAt),
        collectedAt: asString(row.collectedAt)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
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
