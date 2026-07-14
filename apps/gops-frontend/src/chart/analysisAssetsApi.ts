import type { DrawingEntity } from "./types";

export type AnalysisAssetInterval = "1m" | "5m" | "10m" | "1h" | "4h" | "1D" | "1W";
export type AnalysisAssetStatus = "ready";

export type GeometryLevel = {
  id: string;
  role: "support" | "resistance";
  price: number;
  score: number;
  touches: number;
  anchors: Array<{ timestamp: string; price: number }>;
  zoneLow?: number;
  zoneHigh?: number;
  reactionCount?: number;
  lastTouchAgeBars?: number;
  currentDistanceAtr?: number;
  state?: string;
  roleFlips?: number;
  vpConfluence?: number;
  roundNumber?: boolean;
  evidence?: Array<Record<string, unknown>>;
};

export type GeometryPatternKind =
  | "ascending_triangle" | "descending_triangle" | "symmetrical_triangle"
  | "bullish_flag" | "bearish_flag"
  | "bullish_pennant" | "bearish_pennant"
  | "bullish_rectangle" | "bearish_rectangle"
  | "rising_wedge" | "falling_wedge"
  | "descending_channel_breakout" | "ascending_channel_breakdown";

export type GeometryPattern = {
  id?: string;
  kind: GeometryPatternKind;
  state: "forming" | "confirmed" | "inactive" | "invalidated";
  bias?: "bullish" | "bearish" | "neutral";
  breakoutDirection?: "up" | "down" | null;
  breakoutAt?: string | null;
  confirmedAt?: string | null;
  confirmationMethod?: "volume" | "hold" | null;
  volumeRatio?: number;
  score: number;
  touches: number;
  geometryHash: string;
  apexBarsFromAsOf?: number | null;
  upperTouches?: number;
  lowerTouches?: number;
  containment?: number;
  convergenceRatio?: number;
  parallelSlopeErrorAtr?: number;
  maxResidualAtr?: number;
  poleAtr?: number;
  poleEfficiency?: number;
  retracementRatio?: number;
  channelWidthAtr?: number;
  upper?: GeometryPatternBoundary;
  lower?: GeometryPatternBoundary;
  pole?: GeometryPatternBoundary;
  evidence?: Array<Record<string, unknown>>;
};

export type GeometryPatternBoundary = {
  start: { timestamp: string; price: number };
  end: { timestamp: string; price: number };
};

export type GeometryConfirmationCondition = {
  direction: "up" | "down";
  boundary: "upper" | "lower";
  boundaryPrice: number;
  triggerPrice: number;
  bufferAtr: number;
  rule: "completed_close_above" | "completed_close_below";
};

export type GeometryTriangle = GeometryPattern & {
  kind: "ascending_triangle" | "descending_triangle" | "symmetrical_triangle";
};

export type GeometryTradePlan = {
  version: "pattern-trade-timing-v1" | "pattern-trade-timing-v2" | "pattern-trade-timing-v3";
  symbol: string | null;
  interval: AnalysisAssetInterval | null;
  patternId: string;
  patternKind: GeometryPatternKind;
  patternState: GeometryPattern["state"];
  action: "watch" | "buy_candidate" | "sell_candidate" | "short_candidate" | "no_trade";
  direction: "long" | "exit_long" | "short" | null;
  phase?: "forming" | "confirmation_pending" | "confirmed" | "retest_confirmed" | "t1_reached" | "t2_reached" | "invalidated" | "expired";
  signalAt: string | null;
  entryTrigger: number | null;
  confirmationConditions?: GeometryConfirmationCondition[];
  confirmationEvidence?: {
    direction: "up" | "down";
    boundaryPrice: number;
    triggerPrice: number;
    breakoutAt: string;
    confirmedAt: string | null;
    method: "volume" | "hold" | null;
    volumeRatio: number;
    requiredVolumeRatio: number;
    holdBars: number;
  } | null;
  entryPlan?: {
    mode: "confirmation_close" | "retest_close";
    at: string;
    price: number;
  } | null;
  stopPlan?: {
    initialPrice: number;
    activePrice: number;
    basis: "pattern_structure" | "breakout_boundary_atr" | "retest_swing_atr";
    bufferAtr: number;
  } | null;
  targets?: Array<{
    id: "T1" | "T2";
    price: number;
    basis: "one_r" | "nearest_opposing_level" | "measured_move";
    allocationPercent: number;
    rMultiple: number;
  }>;
  retest?: {
    state: "pending" | "confirmed" | "expired";
    at: string | null;
    zoneLow: number | null;
    zoneHigh: number | null;
    observedBars: number;
    maxBars: number;
  } | null;
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  riskPerShare: number | null;
  rewardPerShare: number | null;
  rewardRiskRatio: number | null;
  minimumRewardRisk: number;
  projectionBars: number;
  reasons: string[];
};

export type ChartAnalysisAsset = {
  assetVersion: "geometry";
  algorithmVersion: string;
  symbol: string;
  interval: AnalysisAssetInterval;
  sourceInterval: AnalysisAssetInterval;
  asOf: string;
  generatedAt: string;
  status: AnalysisAssetStatus;
  inputDigest: string;
  coverage: {
    state: "full" | "partial";
    targetBars: number;
    actualBars: number;
    contiguousBars: number;
    missingBars: number;
    lastExpectedClosedAt?: string | null;
    lastActualClosedAt?: string | null;
    qualityFlags?: string[];
  };
  geometry: {
    drawings: Array<DrawingEntity & {
      symbol: string;
      interval: AnalysisAssetInterval;
      sourceInterval: AnalysisAssetInterval;
    }>;
    supports: GeometryLevel[];
    resistances: GeometryLevel[];
    patterns?: GeometryPattern[];
    primaryPattern?: GeometryPattern | null;
    tradePlan?: GeometryTradePlan | null;
    primaryTriangle: GeometryTriangle | null;
    historicalTriangle: GeometryTriangle | null;
    evidence?: Array<Record<string, unknown>>;
    anchorResolutionErrors?: Array<{ drawingId: string; reason: string }>;
  };
  indicators: {
    sma60: number | null;
    sma120: number | null;
    cross: {
      status: "crossed" | "none" | "insufficient_previous_bar" | "data_insufficient";
      direction?: "golden" | "dead" | null;
      timestamp?: string | null;
      barsAgo?: number | null;
    };
  };
};

export type AnalysisAssetsResponse = {
  symbol: string;
  assets: Record<AnalysisAssetInterval, ChartAnalysisAsset | null>;
  meta?: { servedAt?: string };
};

const responseCache = new Map<string, AnalysisAssetsResponse>();
const inFlight = new Map<string, Promise<AnalysisAssetsResponse>>();
const symbolGenerations = new Map<string, number>();
const invalidationListeners = new Set<(symbol?: string) => void>();
let globalGeneration = 0;

export function fetchAnalysisAssets(symbol: string): Promise<AnalysisAssetsResponse> {
  const normalized = symbol.trim().toUpperCase();
  const cached = responseCache.get(normalized);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(normalized);
  if (pending) return pending;
  const requestGlobalGeneration = globalGeneration;
  const requestSymbolGeneration = symbolGenerations.get(normalized) ?? 0;
  let request: Promise<AnalysisAssetsResponse>;
  request = fetch(`/api/charts/analysis-assets?${new URLSearchParams({ symbol: normalized }).toString()}`, {
    headers: { Accept: "application/json" }
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`);
    return normalizeAnalysisAssetsResponse(payload, normalized);
  }).then((payload) => {
    if (globalGeneration === requestGlobalGeneration && (symbolGenerations.get(normalized) ?? 0) === requestSymbolGeneration) {
      responseCache.set(normalized, payload);
    }
    return payload;
  }).finally(() => {
    if (inFlight.get(normalized) === request) inFlight.delete(normalized);
  });
  inFlight.set(normalized, request);
  return request;
}

export function invalidateAnalysisAssets(symbol?: string): void {
  if (symbol) {
    const normalized = symbol.trim().toUpperCase();
    responseCache.delete(normalized);
    inFlight.delete(normalized);
    symbolGenerations.set(normalized, (symbolGenerations.get(normalized) ?? 0) + 1);
    invalidationListeners.forEach((listener) => listener(normalized));
    return;
  }
  responseCache.clear();
  inFlight.clear();
  symbolGenerations.clear();
  globalGeneration += 1;
  invalidationListeners.forEach((listener) => listener());
}

export function subscribeAnalysisAssetsInvalidation(listener: (symbol?: string) => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function normalizeAnalysisAssetsResponse(value: unknown, fallbackSymbol: string): AnalysisAssetsResponse {
  const source = asRecord(value);
  const rawAssets = asRecord(source.assets);
  return {
    symbol: asString(source.symbol)?.toUpperCase() ?? fallbackSymbol,
    assets: {
      "1m": normalizeAsset(rawAssets["1m"], "1m"),
      "5m": normalizeAsset(rawAssets["5m"], "5m"),
      "10m": normalizeAsset(rawAssets["10m"], "10m"),
      "1h": normalizeAsset(rawAssets["1h"], "1h"),
      "4h": normalizeAsset(rawAssets["4h"], "4h"),
      "1D": normalizeAsset(rawAssets["1D"], "1D"),
      "1W": normalizeAsset(rawAssets["1W"], "1W")
    },
    meta: asRecord(source.meta)
  };
}

function normalizeAsset(value: unknown, interval: AnalysisAssetInterval): ChartAnalysisAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as ChartAnalysisAsset;
  if (
    source.assetVersion !== "geometry" || source.interval !== interval || source.sourceInterval !== interval
    || source.symbol.trim().length === 0 || !source.geometry || !Array.isArray(source.geometry.drawings)
    || !source.coverage || !source.indicators
  ) return null;
  const symbol = source.symbol.trim().toUpperCase();
  if (source.geometry.drawings.some((drawing) => (
    drawing.symbol?.trim().toUpperCase() !== symbol
    || drawing.interval !== interval
    || drawing.sourceInterval !== interval
  ))) return null;
  return source;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
