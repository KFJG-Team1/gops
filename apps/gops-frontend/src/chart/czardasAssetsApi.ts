import type { CzardasFieldDto, CzardasPatternDto, DrawingEntity } from "./types";
import { subscribeAnalysisAssetsInvalidation, type AnalysisAssetInterval } from "./analysisAssetsApi";

export type CzardasFreshness = "current" | "stale" | "missing" | "incompatible";

export type CzardasPackContent = {
  algorithmVersion: string;
  configVersion: string;
  timeContractVersion: string;
  calendarVersion: string;
  symbol: string;
  interval: AnalysisAssetInterval;
  asOf: string;
  lastCandleKey: string;
  inputDigest: string;
  status: "ready";
  coverage: { state: "exact"; targetCompleted: 240; actualCompleted: 240; analysisBars: 240; qualityFlags: string[] };
  selection: {
    hline: { configuredCount: number; actualCount: number };
    trend: { configuredCount: number; actualCount: number };
  };
  boundaries: Array<Record<string, unknown>>;
  presentationPattern: CzardasPatternDto | null;
  drawings: DrawingEntity[];
  czardasField: CzardasFieldDto;
  rejectSummary?: Record<string, unknown>;
};

export type CzardasAssetEntry = {
  freshness: CzardasFreshness;
  generatedAt: string | null;
  pack: CzardasPackContent | null;
};

export type CzardasAssetsResponse = {
  assetKind: "czardas";
  symbol: string;
  assets: Record<AnalysisAssetInterval, CzardasAssetEntry>;
  meta?: { servedAt?: string };
};

const intervals: AnalysisAssetInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"];
const cache = new Map<string, CzardasAssetsResponse>();
const inFlight = new Map<string, Promise<CzardasAssetsResponse>>();

subscribeAnalysisAssetsInvalidation((symbol) => {
  if (symbol) {
    cache.delete(symbol);
    inFlight.delete(symbol);
  } else {
    cache.clear();
    inFlight.clear();
  }
});

export function fetchCzardasAssets(symbol: string): Promise<CzardasAssetsResponse> {
  const normalized = symbol.trim().toUpperCase();
  const cached = cache.get(normalized);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(normalized);
  if (pending) return pending;
  let request: Promise<CzardasAssetsResponse>;
  request = fetch(`/api/charts/analysis-assets?${new URLSearchParams({ symbol: normalized, assetKind: "czardas" })}`, {
    headers: { Accept: "application/json" }
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`);
    return normalizeCzardasAssetsResponse(payload, normalized);
  }).then((payload) => {
    cache.set(normalized, payload);
    return payload;
  }).finally(() => {
    if (inFlight.get(normalized) === request) inFlight.delete(normalized);
  });
  inFlight.set(normalized, request);
  return request;
}

export function normalizeCzardasAssetsResponse(value: unknown, fallbackSymbol: string): CzardasAssetsResponse {
  const source = asRecord(value);
  const rawAssets = asRecord(source.assets);
  const assets = Object.fromEntries(intervals.map((interval) => [
    interval,
    normalizeEntry(rawAssets[interval], fallbackSymbol, interval)
  ])) as Record<AnalysisAssetInterval, CzardasAssetEntry>;
  return {
    assetKind: "czardas",
    symbol: asString(source.symbol)?.toUpperCase() ?? fallbackSymbol,
    assets,
    meta: asRecord(source.meta)
  };
}

function normalizeEntry(value: unknown, symbol: string, interval: AnalysisAssetInterval): CzardasAssetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { freshness: "missing", generatedAt: null, pack: null };
  }
  const source = asRecord(value);
  const freshness = isFreshness(source.freshness) ? source.freshness : "incompatible";
  const generatedAt = asString(source.generatedAt) ?? null;
  if (freshness === "missing") return { freshness, generatedAt: null, pack: null };
  const pack = normalizePack(source.pack, symbol, interval);
  return { freshness: pack ? freshness : "incompatible", generatedAt, pack };
}

function normalizePack(value: unknown, fallbackSymbol: string, interval: AnalysisAssetInterval): CzardasPackContent | null {
  const pack = asRecord(value) as CzardasPackContent;
  const symbol = asString(pack.symbol)?.toUpperCase();
  const coverage = asRecord(pack.coverage);
  if (
    !symbol || symbol !== fallbackSymbol || pack.interval !== interval || pack.status !== "ready"
    || pack.algorithmVersion !== "czardas-v1" || pack.configVersion !== "czardas-config-v1"
    || coverage.actualCompleted !== 240 || coverage.targetCompleted !== 240
    || !Array.isArray(pack.drawings) || pack.drawings.length > 7
    || !pack.czardasField || pack.czardasField.sourceBars !== 240
  ) return null;
  const hlines = pack.drawings.filter((item) => item.czardasLayer === "hline");
  const trends = pack.drawings.filter((item) => item.czardasLayer === "trend");
  if (hlines.length > 4 || trends.length > 3 || pack.drawings.some((drawing) => (
    drawing.ownership !== "czardas-managed" || drawing.sourceInterval !== interval
  ))) return null;
  return pack;
}

function isFreshness(value: unknown): value is CzardasFreshness {
  return value === "current" || value === "stale" || value === "missing" || value === "incompatible";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
