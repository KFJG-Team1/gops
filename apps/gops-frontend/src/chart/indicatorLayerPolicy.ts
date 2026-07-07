import type { CandleDto, ChartLayerKey } from "./types";

export const candleMovingAverageWindows = [5, 20, 60];

const serverIndicatorLayerOrder: ChartLayerKey[] = [
  "ema:20",
  "wma:20",
  "bollinger:20:2",
  "rsi:14",
  "stochastic:14:3:3",
  "macd:12:26:9"
];

export function serverIndicatorLayersForLayers(layers: Partial<Record<ChartLayerKey, boolean>>): ChartLayerKey[] {
  return serverIndicatorLayerOrder.filter((layer) => Boolean(layers[layer]));
}

export function indicatorRequestRangeFromCandles(candles: CandleDto[]): {
  firstTimestamp: string;
  lastTimestamp: string;
  candleCount: number;
} | null {
  const closedCandles = candles.filter((candle) => candle.isClosed !== false);
  const first = closedCandles[0];
  const last = closedCandles[closedCandles.length - 1];
  if (!first || !last) {
    return null;
  }
  return {
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp,
    candleCount: closedCandles.length
  };
}
