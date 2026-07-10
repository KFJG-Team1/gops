import type { ChartLayerKey, DrawingEntity } from "./types";

export type AnalysisAssetInterval = "1D" | "1W" | "1M";
export type AnalysisAssetStatus = "ready" | "degraded";

export type AnalysisAssetCommentary = {
  text: string;
  keyLevels: string[];
  invalidation: string;
  confidence: number;
  enrichment: null;
};

export type AnalysisAssetLayer = {
  drawings: DrawingEntity[];
  meta?: Record<string, unknown>;
};

export type AnalysisAssetAgentLayer = AnalysisAssetLayer & {
  degraded: boolean;
  rationale: string;
  model: string | null;
};

export type ChartAnalysisAsset = {
  assetVersion: "v1";
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
};

export type AnalysisAssetsResponse = {
  symbol: string;
  assets: Record<AnalysisAssetInterval, ChartAnalysisAsset | null>;
  meta?: { servedAt?: string };
};

const responseCache = new Map<string, AnalysisAssetsResponse>();
const inFlight = new Map<string, Promise<AnalysisAssetsResponse>>();

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
  const request = fetch(`/api/charts/analysis-assets?${new URLSearchParams({ symbol: normalized }).toString()}`, {
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
      responseCache.set(normalized, payload);
      return payload;
    })
    .finally(() => inFlight.delete(normalized));
  inFlight.set(normalized, request);
  return request;
}

export function invalidateAnalysisAssets(symbol?: string): void {
  if (symbol) {
    responseCache.delete(symbol.trim().toUpperCase());
    return;
  }
  responseCache.clear();
}

function normalizeAnalysisAssetsResponse(value: unknown, fallbackSymbol: string): AnalysisAssetsResponse {
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
  if (source.interval !== interval || !source.layers || !source.chartSetup || !source.commentary) {
    return null;
  }
  return source;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
