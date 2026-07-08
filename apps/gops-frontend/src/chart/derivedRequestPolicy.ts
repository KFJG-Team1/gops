import type { ChartInterval } from "./types";

export const derivedClientCacheTtlMs = {
  indicators: 10_000,
  volumeProfile: 5_000
} as const;

export function stableVolumeProfileRangeKey(query: {
  symbol: string;
  interval: ChartInterval;
  from: string;
  to: string;
  targetBins?: number;
  priceBinSize?: string;
}): string {
  return [
    query.symbol.trim().toUpperCase(),
    query.interval,
    query.from,
    query.to,
    query.priceBinSize ?? "auto",
    Math.max(4, Math.min(48, Math.round(query.targetBins ?? 10)))
  ].join("|");
}
