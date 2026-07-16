import type { DrawingEntity } from "./types";

export type AnalysisAssetInterval = "1m" | "5m" | "10m" | "1h" | "4h" | "1D" | "1W";
export type AnalysisAssetStatus = "ready";

export type GeometryLevel = {
  id: string;
  role: "support" | "resistance";
  price: number;
  zoneLow?: number;
  zoneHigh?: number;
  halfWidthAtr?: number;
  selectionTier?: "confirmed" | "contextual" | "reference";
  importanceTier?: "major" | "standard" | "minor";
  importanceRank?: number;
  score: number;
  touches: number;
  reactionCount?: number;
  lastTouchAgeBars?: number;
  currentDistanceAtr?: number;
  anchors: Array<{ timestamp: string; price: number }>;
};

export type GeometryAnchor = { timestamp: string; price: number; role?: string };

export type GeometryTrend = {
  id: string;
  kind: "uptrend" | "downtrend" | "channel";
  direction: "up" | "down";
  score: number;
  drawingId: string;
  anchors: GeometryAnchor[];
  anchorPivotIds: string[];
  touchPivotIds: string[];
  reactionPivotIds: string[];
  touchCount: number;
  reactionCount: number;
  slopeAtrPerBar: number;
  medianResidualAtr: number;
  currentDistanceAtr: number;
  lastTouchAgeBars: number;
  channelWidthAtr?: number;
  parallelSlopeError?: number;
  containment?: number;
  activeInvalidation?: boolean;
  violationCount?: number;
  invalidation?: string | null;
};

export type GeometryDrawingGroups = {
  levels: string[];
  trend: string[];
  pattern: string[];
};

export type GeometryTracePivot = {
  id: string;
  timestamp: string;
  price: number;
  kind?: string;
  role?: string;
  confirmedAt?: string;
  outcome?: string;
  barIndex?: number;
  grade?: "tactical" | "structural";
  strength?: number;
  reversalAtr?: number;
  prominenceAtr?: number;
};

export type GeometryTraceTouch = {
  id: string;
  timestamp: string;
  price: number;
  barIndex?: number;
  outcome?: string | null;
  mfeAtr?: number | null;
  maeAtr?: number | null;
  residualAtr?: number | null;
  boundary?: string;
};

export type GeometryTraceRender = {
  drawingType: "horizontalLine" | "trendLine" | "trendParallelLines" | "segments";
  extension: "plot" | "ray" | "segment";
  direction?: "up" | "down";
  parallelLineCount?: 2;
  segments?: Array<[number, number]>;
};

export type GeometryTraceCandidate = {
  id: string;
  category: "level" | "levels" | "trend" | "pattern";
  role?: "support" | "resistance" | string;
  kind?: string;
  score?: number;
  selected?: boolean;
  hardPass?: boolean;
  evidencePass?: boolean;
  activePass?: boolean;
  rejectReasons?: string[];
  selectionTier?: "confirmed" | "contextual" | "reference" | string | null;
  importanceTier?: "major" | "standard" | "minor" | string | null;
  importanceRank?: number | null;
  categoryRank?: number;
  disposition?: "selected" | "qualified_not_selected" | "rejected";
  selectionReasons?: string[];
  direction?: "up" | "down";
  render?: GeometryTraceRender;
  anchors?: GeometryAnchor[];
  pivotIds?: string[];
  anchorPivotIds?: string[];
  touchPivotIds?: string[];
  reactionPivotIds?: string[];
  evidenceRefs?: string[];
  touchRefs?: string[];
  reactionRefs?: string[];
  touches?: GeometryTraceTouch[];
  metrics?: Record<string, unknown>;
};

export type GeometryAnalysisTrace = {
  version: "geometry-analysis-trace-v1" | "geometry-analysis-trace-v2";
  pivots: GeometryTracePivot[];
  levelCandidates: GeometryTraceCandidate[];
  trendCandidates: GeometryTraceCandidate[];
  patternCandidates: GeometryTraceCandidate[];
  selections: {
    levelCandidateIds: string[];
    trendCandidateIds: string[];
    patternCandidateIds: string[];
  };
  omittedCounts: Record<string, number>;
  completeness?: {
    complete: true;
    detected: { levels: number; trends: number; patterns: number };
    stored: { levels: number; trends: number; patterns: number };
  };
};

export type GeometryPatternKind =
  | "ascending_triangle" | "descending_triangle" | "symmetrical_triangle"
  | "bullish_flag" | "bearish_flag"
  | "bullish_pennant" | "bearish_pennant"
  | "bullish_rectangle" | "bearish_rectangle"
  | "rising_wedge" | "falling_wedge"
  | "descending_channel_breakout" | "ascending_channel_breakdown";

export type GeometryPattern = {
  kind: GeometryPatternKind;
  state: "forming" | "confirmed" | "inactive" | "invalidated";
  bias?: "bullish" | "bearish" | "neutral";
  breakoutDirection?: "up" | "down" | null;
  score: number;
  touches: number;
  geometryHash: string;
  apexBarsFromAsOf?: number | null;
  metrics?: Record<string, unknown>;
  upper?: GeometryPatternBoundary;
  lower?: GeometryPatternBoundary;
  confirmation?: {
    breakoutAt: string;
    confirmedAt: string;
    mode: "both" | "next_close_hold" | "relative_volume";
    boundaryPrice: number;
    penetrationAtr: number;
    relativeVolume: number | null;
  } | null;
};

export type GeometryPatternBoundary = {
  start?: { timestamp?: string; price?: number };
  end?: { timestamp?: string; price?: number };
};

export type GeometryTriangle = GeometryPattern & {
  kind: "ascending_triangle" | "descending_triangle" | "symmetrical_triangle";
};

export type GeometryTradePlan = {
  version: "pattern-trade-timing-v1";
  symbol: string | null;
  interval: AnalysisAssetInterval | null;
  patternId: string;
  patternKind: GeometryPatternKind;
  patternState: GeometryPattern["state"];
  action: "watch" | "buy_candidate" | "sell_candidate" | "no_trade";
  direction: "long" | "exit_long" | null;
  signalAt: string | null;
  entryTrigger: number | null;
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
    trends?: GeometryTrend[];
    primaryTrend?: GeometryTrend | null;
    drawingGroups?: GeometryDrawingGroups;
    analysisTrace?: GeometryAnalysisTrace;
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
      previousTimestamp?: string | null;
      barsAgo?: number | null;
      fraction?: number | null;
      price?: number | null;
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

export class AnalysisAssetsRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AnalysisAssetsRequestError";
    this.status = status;
  }
}

export function analysisAssetsLoadErrorMessage(reason: unknown): string {
  if (reason instanceof AnalysisAssetsRequestError) {
    if (reason.status === 409 && reason.message === "simulation_data_unavailable") {
      return "시뮬레이션 중에는 작도 자산을 불러올 수 없습니다.";
    }
    if (reason.status === 503) {
      return "작도 자산 저장소에 접근할 수 없습니다.";
    }
    return reason.message || `작도 자산 요청이 실패했습니다. (HTTP ${reason.status})`;
  }
  return reason instanceof Error && reason.message
    ? reason.message
    : "작도 자산을 불러오지 못했습니다.";
}

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
    if (!response.ok) {
      throw new AnalysisAssetsRequestError(
        response.status,
        typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`
      );
    }
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
