import type { ChartInterval } from "./types";

export const derivedClientCacheTtlMs = {
  indicators: 10_000,
  volumeProfile: 5_000
} as const;

export const derivedClientCacheMaxEntries = 64;

export function stableVolumeProfileRangeKey(query: {
  symbol: string;
  interval: ChartInterval;
  from: string;
  to: string;
  targetBins?: number;
  priceBinSize?: string;
  priceMin?: number;
  priceMax?: number;
}): string {
  return [
    query.symbol.trim().toUpperCase(),
    query.interval,
    query.from,
    query.to,
    query.priceBinSize ?? "auto",
    Math.max(4, Math.min(48, Math.round(query.targetBins ?? 10))),
    stableOptionalNumber(query.priceMin),
    stableOptionalNumber(query.priceMax)
  ].join("|");
}

function stableOptionalNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
