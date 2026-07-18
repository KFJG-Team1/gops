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
  id?: string;
  kind: GeometryPatternKind;
  state: "forming" | "confirmed" | "inactive" | "invalidated";
  bias?: "bullish" | "bearish" | "neutral";
  breakoutDirection?: "up" | "down" | null;
  score: number;
  touches: number;
  geometryHash: string;
  apexBarsFromAsOf?: number | null;
  metrics?: Record<string, unknown>;
  pole?: GeometryPatternBoundary;
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

export type ChartAssetCommentaryBlockKind =
  | "overview"
  | "drawing_guide"
  | "indicator_context"
  | "event_context"
  | "watch_next";

export type ChartAssetCommentaryIndicatorLayer =
  | "volume-profile"
  | "volume"
  | "rsi:14"
  | "macd:12:26:9"
  | "bollinger:20:2"
  | "sma:20"
  | "sma:60"
  | "sma:120"
  | "ema:20";

export type ChartAssetCommentaryReference =
  | { id: string; type: "drawing"; drawingIds: string[] }
  | { id: string; type: "candle"; timestamp: string; candleKey?: string }
  | { id: string; type: "news"; eventId: string; marketDate: string }
  | { id: string; type: "earnings"; eventId: string; eventAt: string };

type ChartAssetCommentarySourceIdentity = {
  geometryInputDigest: string;
  candlesAsOf: string;
  indicatorsAsOf: string;
  newsAsOf?: string;
  earningsAsOf?: string;
  contextDigest: string;
};

type ChartAssetCommentaryIndicatorRecommendation = {
  layer: ChartAssetCommentaryIndicatorLayer;
  label: string;
  reason: string;
  referenceIds: string[];
};

export type ChartAssetCommentaryV1 = {
  version: "chart-commentary.v1";
  status: "ready";
  generatedAt: string;
  model: string;
  promptVersion: "chart-commentary.ko.v1";
  sourceIdentity: ChartAssetCommentarySourceIdentity;
  blocks: Array<{
    id: string;
    kind: ChartAssetCommentaryBlockKind;
    text: string;
    referenceIds: string[];
  }>;
  indicatorRecommendations: ChartAssetCommentaryIndicatorRecommendation[];
  references: ChartAssetCommentaryReference[];
  limitations: string[];
};

export type ChartAssetCommentaryLink =
  | { kind: "drawing"; referenceIds: string[] }
  | { kind: "indicator"; layer: ChartAssetCommentaryIndicatorLayer; referenceIds: string[] }
  | { kind: "candle" | "news" | "earnings"; referenceId: string };

export type ChartAssetCommentaryV2 = {
  version: "chart-commentary.v2";
  status: "ready";
  generatedAt: string;
  model: string;
  promptVersion: "chart-commentary.ko.v2" | "chart-commentary.ko.v3" | "chart-commentary.ko.v4" | "chart-commentary.ko.v5";
  sourceIdentity: ChartAssetCommentarySourceIdentity;
  paragraphs: Array<{
    id: string;
    segments: Array<{
      id: string;
      text: string;
      link?: ChartAssetCommentaryLink;
    }>;
  }>;
  indicatorRecommendations: ChartAssetCommentaryIndicatorRecommendation[];
  references: ChartAssetCommentaryReference[];
  limitations: string[];
};

export type ChartAssetCommentary = ChartAssetCommentaryV1 | ChartAssetCommentaryV2;

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
  commentary?: ChartAssetCommentary;
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

export function fetchAnalysisAssets(symbol: string, interval?: string): Promise<AnalysisAssetsResponse> {
  const normalized = symbol.trim().toUpperCase();
  const requestedInterval = isAnalysisAssetIntervalValue(interval) ? interval : undefined;
  const cacheKey = `${normalized}:${requestedInterval ?? "all"}`;
  const cached = responseCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const requestGlobalGeneration = globalGeneration;
  const requestSymbolGeneration = symbolGenerations.get(normalized) ?? 0;
  let request: Promise<AnalysisAssetsResponse>;
  const params = new URLSearchParams({ symbol: normalized });
  if (requestedInterval) params.set("interval", requestedInterval);
  request = fetch(`/api/charts/analysis-assets?${params.toString()}`, {
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
      responseCache.set(cacheKey, payload);
    }
    return payload;
  }).finally(() => {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, request);
  return request;
}

export function invalidateAnalysisAssets(symbol?: string): void {
  if (symbol) {
    const normalized = symbol.trim().toUpperCase();
    for (const key of responseCache.keys()) {
      if (key.startsWith(`${normalized}:`)) responseCache.delete(key);
    }
    for (const key of inFlight.keys()) {
      if (key.startsWith(`${normalized}:`)) inFlight.delete(key);
    }
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

function isAnalysisAssetIntervalValue(value: string | undefined): value is AnalysisAssetInterval {
  return value === "1m" || value === "5m" || value === "10m" || value === "1h"
    || value === "4h" || value === "1D" || value === "1W";
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
  const commentary = normalizeCommentary(source.commentary, {
    inputDigest: source.inputDigest,
    asOf: source.asOf,
    drawingIds: new Set(source.geometry.drawings.map((drawing) => drawing.id))
  });
  return commentary ? { ...source, commentary } : { ...source, commentary: undefined };
}

function normalizeCommentary(value: unknown, asset: {
  inputDigest: string;
  asOf: string;
  drawingIds: Set<string>;
}): ChartAssetCommentary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, any>;
  const identity = source.sourceIdentity as Record<string, any> | undefined;
  if (
    source.status !== "ready"
    || typeof source.generatedAt !== "string"
    || typeof source.model !== "string" || source.model.length === 0
    || !identity
    || identity.geometryInputDigest !== asset.inputDigest
    || identity.candlesAsOf !== asset.asOf
    || identity.indicatorsAsOf !== asset.asOf
    || typeof identity.contextDigest !== "string"
    || (identity.newsAsOf !== undefined && typeof identity.newsAsOf !== "string")
    || (identity.earningsAsOf !== undefined && typeof identity.earningsAsOf !== "string")
    || !Array.isArray(source.indicatorRecommendations)
    || !Array.isArray(source.references)
    || !Array.isArray(source.limitations)
  ) return undefined;
  if (source.indicatorRecommendations.length > 3) return undefined;
  if (source.references.some((reference) => !validCommentaryReference(reference))) return undefined;
  const references = source.references as ChartAssetCommentaryReference[];
  const referenceIds = new Set(references.map((reference) => reference.id));
  if (referenceIds.size !== source.references.length) return undefined;
  if (references.some((reference) => (
    reference.type === "drawing" && reference.drawingIds.some((id) => !asset.drawingIds.has(id))
  ))) return undefined;
  if (source.indicatorRecommendations.some((item) => (
    !item || typeof item.label !== "string" || typeof item.reason !== "string"
    || !commentaryIndicatorLayers.has(item.layer)
    || !Array.isArray(item.referenceIds) || item.referenceIds.some((id: unknown) => typeof id !== "string" || !referenceIds.has(id))
  ))) return undefined;
  if (source.limitations.some((item) => typeof item !== "string")) return undefined;

  if (source.version === "chart-commentary.v1") {
    if (source.promptVersion !== "chart-commentary.ko.v1" || !Array.isArray(source.blocks) || source.blocks.length !== 5) {
      return undefined;
    }
    const expectedKinds: ChartAssetCommentaryBlockKind[] = [
      "overview", "drawing_guide", "indicator_context", "event_context", "watch_next"
    ];
    if (source.blocks.some((block: any) => (
      !block || typeof block.id !== "string" || typeof block.text !== "string"
      || !["overview", "drawing_guide", "indicator_context", "event_context", "watch_next"].includes(block.kind)
      || !Array.isArray(block.referenceIds) || block.referenceIds.some((id: string) => !referenceIds.has(id))
    ))) return undefined;
    if (source.blocks.some((block: any, index: number) => block.kind !== expectedKinds[index])) return undefined;
    return source as ChartAssetCommentaryV1;
  }

  if (
    source.version !== "chart-commentary.v2"
    || ![
      "chart-commentary.ko.v2", "chart-commentary.ko.v3", "chart-commentary.ko.v4", "chart-commentary.ko.v5"
    ].includes(source.promptVersion)
    || !Array.isArray(source.paragraphs)
    || source.paragraphs.length !== 3
  ) return undefined;
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  const paragraphIds = new Set<string>();
  const segmentIds = new Set<string>();
  const directlyLinkedReferenceIds = new Set<string>();
  const linkedIndicatorLayers = new Set<ChartAssetCommentaryIndicatorLayer>();
  let linkCount = 0;
  for (const paragraph of source.paragraphs) {
    if (
      !paragraph || typeof paragraph.id !== "string" || !paragraph.id.trim()
      || paragraphIds.has(paragraph.id)
      || !Array.isArray(paragraph.segments)
      || paragraph.segments.length < 1 || paragraph.segments.length > 24
    ) return undefined;
    paragraphIds.add(paragraph.id);
    for (const segment of paragraph.segments) {
      if (
        !segment || typeof segment.id !== "string" || !segment.id.trim()
        || segmentIds.has(segment.id)
        || typeof segment.text !== "string" || !segment.text.trim()
      ) return undefined;
      segmentIds.add(segment.id);
      if (segment.link === undefined) continue;
      linkCount += 1;
      if (!validCommentaryLink(segment.link, referenceById, directlyLinkedReferenceIds, linkedIndicatorLayers)) return undefined;
    }
  }
  const conciseV4 = source.promptVersion === "chart-commentary.ko.v4";
  const progressiveV5 = source.promptVersion === "chart-commentary.ko.v5";
  if (linkCount > (progressiveV5 ? 6 : conciseV4 ? 5 : 8)) return undefined;
  if (conciseV4 && source.indicatorRecommendations.length > 2) return undefined;
  if (progressiveV5 && source.indicatorRecommendations.some((item: { layer: ChartAssetCommentaryIndicatorLayer }) => item.layer === "volume")) {
    return undefined;
  }
  if (progressiveV5 && linkedIndicatorLayers.has("volume")) return undefined;
  const recommendationLayers = new Set(
    source.indicatorRecommendations.map((item: { layer: ChartAssetCommentaryIndicatorLayer }) => item.layer)
  );
  if (
    recommendationLayers.size !== source.indicatorRecommendations.length
    || recommendationLayers.size !== linkedIndicatorLayers.size
    || [...recommendationLayers].some((layer) => !linkedIndicatorLayers.has(layer))
  ) return undefined;
  return source as ChartAssetCommentaryV2;
}

const commentaryIndicatorLayers = new Set<ChartAssetCommentaryIndicatorLayer>([
  "volume-profile", "volume", "rsi:14", "macd:12:26:9", "bollinger:20:2",
  "sma:20", "sma:60", "sma:120", "ema:20"
]);

function validCommentaryLink(
  value: unknown,
  references: Map<string, ChartAssetCommentaryReference>,
  directlyLinkedReferenceIds: Set<string>,
  linkedIndicatorLayers: Set<ChartAssetCommentaryIndicatorLayer>
): value is ChartAssetCommentaryLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const link = value as Partial<ChartAssetCommentaryLink> & Record<string, unknown>;
  if (link.kind === "drawing" || link.kind === "indicator") {
    if (!Array.isArray(link.referenceIds) || link.referenceIds.length < 1 || link.referenceIds.length > 3) return false;
    if (link.referenceIds.some((id, index) => (
      typeof id !== "string" || link.referenceIds?.indexOf(id) !== index || !references.has(id)
    ))) return false;
    if (link.kind === "drawing" && link.referenceIds.some((id) => references.get(id)?.type !== "drawing")) return false;
    if (link.kind === "indicator") {
      if (!commentaryIndicatorLayers.has(link.layer as ChartAssetCommentaryIndicatorLayer)) return false;
      if (linkedIndicatorLayers.has(link.layer as ChartAssetCommentaryIndicatorLayer)) return false;
      linkedIndicatorLayers.add(link.layer as ChartAssetCommentaryIndicatorLayer);
    } else {
      if (link.referenceIds.some((id) => directlyLinkedReferenceIds.has(id))) return false;
      link.referenceIds.forEach((id) => directlyLinkedReferenceIds.add(id));
    }
    return true;
  }
  if (link.kind !== "candle" && link.kind !== "news" && link.kind !== "earnings") return false;
  if (typeof link.referenceId !== "string" || directlyLinkedReferenceIds.has(link.referenceId)) return false;
  if (references.get(link.referenceId)?.type !== link.kind) return false;
  directlyLinkedReferenceIds.add(link.referenceId);
  return true;
}

function validCommentaryReference(value: unknown): value is ChartAssetCommentaryReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value as Partial<ChartAssetCommentaryReference> & Record<string, unknown>;
  if (typeof reference.id !== "string") return false;
  if (reference.type === "drawing") {
    return Array.isArray(reference.drawingIds)
      && reference.drawingIds.length > 0
      && reference.drawingIds.every((id) => typeof id === "string");
  }
  if (reference.type === "candle") {
    return typeof reference.timestamp === "string"
      && (reference.candleKey === undefined || typeof reference.candleKey === "string");
  }
  if (reference.type === "news") {
    return typeof reference.eventId === "string" && typeof reference.marketDate === "string";
  }
  if (reference.type === "earnings") {
    return typeof reference.eventId === "string" && typeof reference.eventAt === "string";
  }
  return false;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
