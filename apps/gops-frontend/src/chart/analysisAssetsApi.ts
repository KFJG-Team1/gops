import type { ChartLayerKey, DrawingEntity } from "./types";

export type AnalysisAssetInterval = "1D" | "1W" | "1M";
export type AnalysisAssetStatus = "ready" | "degraded";

export type AnalysisAssetCommentary = {
  headline?: string;
  regimeSummary?: string;
  focusItems?: AnalysisAssetFocusItem[];
  keyLevelsV2?: Array<{ drawingId?: string; role: string; price: number; reason: string }>;
  higherTimeframeContext?: string;
  counterEvidence?: string[];
  dataCaveats?: string[];
  confidenceV2?: { selection?: { score: number; reasons: string[]; penalties: string[] } };
  text: string;
  keyLevels: string[];
  invalidation: string;
  confidence: number;
  enrichment: null;
};

export type AnalysisAssetFocusItem = {
  drawingIds: string[];
  candidateId?: string | null;
  featureIds?: string[];
  whatItShows: string;
  whyItMatters: string;
  whatToWatch: string;
  confirmation?: string | null;
  invalidation?: string | null;
  horizon?: string;
};

export type AnalysisAssetLayer = {
  drawings: DrawingEntity[];
  selected?: Array<Record<string, unknown>>;
  emptyReason?: string | null;
  meta?: Record<string, unknown>;
};

export type AnalysisAssetAgentLayer = AnalysisAssetLayer & Partial<{ degraded: boolean; rationale: string; model: string | null }>;

export type ChartAnalysisAsset = {
  assetVersion: "v1" | "v2";
  symbol: string;
  interval: AnalysisAssetInterval;
  asOf: string;
  generatedAt: string;
  status: AnalysisAssetStatus;
  layers: {
    structure: AnalysisAssetLayer;
    trend: AnalysisAssetLayer;
    agent: AnalysisAssetAgentLayer;
  };
  chartSetup: {
    alwaysOn: ChartLayerKey[];
    recommended: Array<{
      layer: ChartLayerKey;
      reason: string;
      source: "rule" | "llm";
    }>;
  };
  commentary: AnalysisAssetCommentary;
  coverage?: { lastActualClosedAt?: string | null; qualityFlags?: string[]; renderable?: boolean };
  quality?: { state?: "eligible" | "insufficient_data" | "stale_input" | "contract_error"; score?: number };
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
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlight.get(normalized);
  if (pending) {
    return pending;
  }
  const requestGlobalGeneration = globalGeneration;
  const requestSymbolGeneration = symbolGenerations.get(normalized) ?? 0;
  let request: Promise<AnalysisAssetsResponse>;
  request = fetch(`/api/charts/analysis-assets?${new URLSearchParams({ symbol: normalized }).toString()}`, {
    headers: { Accept: "application/json" }
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return normalizeAnalysisAssetsResponse(payload, normalized);
    })
    .then((payload) => {
      if (
        globalGeneration === requestGlobalGeneration
        && (symbolGenerations.get(normalized) ?? 0) === requestSymbolGeneration
      ) {
        responseCache.set(normalized, payload);
      }
      return payload;
    })
    .finally(() => {
      if (inFlight.get(normalized) === request) {
        inFlight.delete(normalized);
      }
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
      "1D": normalizeAsset(rawAssets["1D"], "1D"),
      "1W": normalizeAsset(rawAssets["1W"], "1W"),
      "1M": normalizeAsset(rawAssets["1M"], "1M")
    },
    meta: asRecord(source.meta)
  };
}

function normalizeAsset(value: unknown, interval: AnalysisAssetInterval): ChartAnalysisAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as ChartAnalysisAsset;
  if ((source.assetVersion !== "v1" && source.assetVersion !== "v2") || source.interval !== interval || !source.layers || !source.chartSetup || !source.commentary) {
    return null;
  }
  if (source.assetVersion === "v2") {
    (["structure", "trend", "agent"] as const).forEach((layer) => {
      source.layers[layer].drawings = source.layers[layer].drawings.map(normalizeV2AutomaticLabel);
    });
  }
  return source;
}

function normalizeV2AutomaticLabel(drawing: DrawingEntity): DrawingEntity {
  if (drawing.type !== "horizontalLine" || !drawing.label || drawing.anchors[0]?.price === undefined) {
    return drawing;
  }
  const price = Number(drawing.anchors[0].price);
  const tokens = new Set([String(price), price.toFixed(2), price.toLocaleString("en-US", { maximumFractionDigits: 8 })]);
  const label = [...tokens].sort((left, right) => right.length - left.length).reduce((text, token) => text.replaceAll(token, ""), drawing.label)
    .replace(/\s*[·,:()-]\s*$/g, "").replace(/\s{2,}/g, " ").trim();
  return { ...drawing, label };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
