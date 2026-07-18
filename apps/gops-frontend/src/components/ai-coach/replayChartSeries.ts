import { replayCandlesBySymbol, type ReplayCandleTuple } from "virtual:gops-ai-coach-replay-candles";
import type { ChartPoint } from "./types";

export type ReplayChartSymbol = keyof typeof replayCandlesBySymbol;

export function replayChartSeries(
  symbol: ReplayChartSymbol,
  anchorTime: string,
  entryPrice: number,
  through = 20
): ChartPoint[] {
  const candles = replayCandlesBySymbol[symbol];
  const anchorTimestamp = Date.parse(anchorTime);
  const anchorIndex = nearestCandleIndex(candles, anchorTimestamp);
  if (anchorIndex < 0) return [];
  const closes = candles.map((row) => row[4]);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, index) => ema12[index] - ema26[index]);
  const signal = ema(macd, 9);
  const anchorClose = candles[anchorIndex][4];
  const priceScale = anchorClose > 0 ? entryPrice / anchorClose : 1;
  const start = Math.max(0, anchorIndex - 60);
  const end = Math.min(candles.length - 1, anchorIndex + through);
  return candles.slice(start, end + 1).map((row, localIndex) => {
    const index = start + localIndex;
    const relativeDay = index - anchorIndex;
    const averageVolume = mean(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item[5]));
    return {
      relativeDay,
      time: row[0],
      open: round(row[1] * priceScale),
      high: round(row[2] * priceScale),
      low: round(row[3] * priceScale),
      close: round(row[4] * priceScale),
      volume: row[5],
      relativeVolume: averageVolume > 0 ? round(row[5] / averageVolume, 4) : null,
      rsi: round(rsiAt(closes, index), 4),
      macd: round(macd[index] * priceScale, 4),
      signal: round(signal[index] * priceScale, 4),
      histogram: round((macd[index] - signal[index]) * priceScale, 4)
    };
  });
}

function nearestCandleIndex(candles: readonly ReplayCandleTuple[], timestamp: number): number {
  if (!Number.isFinite(timestamp) || !candles.length) return -1;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  candles.forEach((row, index) => {
    const nextDistance = Math.abs(Date.parse(row[0]) - timestamp);
    if (nextDistance < distance) {
      nearest = index;
      distance = nextDistance;
    }
  });
  return nearest;
}

function ema(values: readonly number[], period: number): number[] {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * multiplier + result[index - 1] * (1 - multiplier));
  }
  return result;
}

function rsiAt(closes: readonly number[], index: number, period = 14): number {
  if (index <= 0) return 50;
  const start = Math.max(1, index - period + 1);
  let gains = 0;
  let losses = 0;
  for (let cursor = start; cursor <= index; cursor += 1) {
    const change = closes[cursor] - closes[cursor - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const observations = index - start + 1;
  const averageGain = gains / observations;
  const averageLoss = losses / observations;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
