import type { ChartLayerKey, ChartLayerMetadata } from "./types";

export const chartLayerAliases: Record<string, ChartLayerKey> = {
  ma5: "sma:5",
  ma20: "sma:20",
  ma60: "sma:60"
};

export const chartLayerMetadata: Record<ChartLayerKey, ChartLayerMetadata> = {
  candles: {
    id: "candles",
    kind: "base-price",
    label: "Price",
    paneId: "price",
    source: "candle",
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  volume: {
    id: "volume",
    kind: "volume-pane",
    label: "Volume",
    paneId: "volume",
    source: "candle",
    placement: "below",
    supportedPlacements: ["below"]
  },
  ma5: {
    id: "ma5",
    kind: "price-overlay",
    label: "MA5",
    paneId: "price",
    source: "legacy",
    params: { period: 5 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  ma20: {
    id: "ma20",
    kind: "price-overlay",
    label: "MA20",
    paneId: "price",
    source: "legacy",
    params: { period: 20 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  ma60: {
    id: "ma60",
    kind: "price-overlay",
    label: "MA60",
    paneId: "price",
    source: "legacy",
    params: { period: 60 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "sma:5": {
    id: "sma:5",
    kind: "price-overlay",
    label: "SMA 5",
    paneId: "price",
    source: "derived",
    params: { period: 5 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "sma:20": {
    id: "sma:20",
    kind: "price-overlay",
    label: "SMA 20",
    paneId: "price",
    source: "derived",
    params: { period: 20 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "sma:60": {
    id: "sma:60",
    kind: "price-overlay",
    label: "SMA 60",
    paneId: "price",
    source: "derived",
    params: { period: 60 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "ema:20": {
    id: "ema:20",
    kind: "price-overlay",
    label: "EMA 20",
    paneId: "price",
    source: "derived",
    params: { period: 20 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "wma:20": {
    id: "wma:20",
    kind: "price-overlay",
    label: "WMA 20",
    paneId: "price",
    source: "derived",
    params: { period: 20 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "bollinger:20:2": {
    id: "bollinger:20:2",
    kind: "price-overlay",
    label: "Bollinger 20,2",
    paneId: "price",
    source: "derived",
    params: { period: 20, multiplier: 2 },
    placement: "overlay",
    supportedPlacements: ["overlay"]
  },
  "rsi:14": {
    id: "rsi:14",
    kind: "indicator-pane",
    label: "RSI 14",
    paneId: "rsi:14",
    source: "derived",
    params: { period: 14 },
    placement: "below",
    supportedPlacements: ["below"]
  },
  "stochastic:14:3:3": {
    id: "stochastic:14:3:3",
    kind: "indicator-pane",
    label: "Stochastic 14,3,3",
    paneId: "stochastic:14:3:3",
    source: "derived",
    params: { kPeriod: 14, smoothK: 3, dPeriod: 3 },
    placement: "below",
    supportedPlacements: ["below"]
  },
  "macd:12:26:9": {
    id: "macd:12:26:9",
    kind: "indicator-pane",
    label: "MACD 12,26,9",
    paneId: "macd:12:26:9",
    source: "derived",
    params: { fast: 12, slow: 26, signal: 9 },
    placement: "below",
    supportedPlacements: ["below"]
  },
  "volume-profile": {
    id: "volume-profile",
    kind: "volume-profile",
    label: "Volume Profile",
    paneId: "price",
    source: "derived",
    placement: "overlay",
    supportedPlacements: ["overlay"]
  }
};

export function normalizeChartLayerKey(value: unknown): ChartLayerKey | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const alias = chartLayerAliases[trimmed];
  if (alias) {
    return alias;
  }
  return trimmed in chartLayerMetadata ? trimmed as ChartLayerKey : null;
}

export function legacyLayerKeysFor(layer: ChartLayerKey): ChartLayerKey[] {
  if (layer === "sma:5") {
    return ["ma5"];
  }
  if (layer === "sma:20") {
    return ["ma20"];
  }
  if (layer === "sma:60") {
    return ["ma60"];
  }
  return [];
}

export function layerVisibilityAliases(layer: ChartLayerKey): ChartLayerKey[] {
  return [layer, ...legacyLayerKeysFor(layer)];
}
