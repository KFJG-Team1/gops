import type { CandleDto } from "./types";


export function isAnalysisAssetStale(asOf: string, candles: CandleDto[]): boolean {
  const asOfTime = Date.parse(asOf);
  if (!Number.isFinite(asOfTime)) {
    return false;
  }
  return candles.filter((candle) => (
    candle.isClosed !== false && Date.parse(candle.timestamp) > asOfTime
  )).length >= 2;
}

export function formatAnalysisAssetAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}
