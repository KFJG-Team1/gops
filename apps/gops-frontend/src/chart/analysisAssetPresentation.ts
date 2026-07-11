import type { AnalysisAssetInterval, ChartAnalysisAsset } from "./analysisAssetsApi";
import type { CandleDto, DrawingAnchor, DrawingEntity } from "./types";


export type AnalysisAssetPresentationState =
  | "ready"
  | "quality_empty"
  | "data_degraded"
  | "presentation_rejected"
  | "stale_asset";

export type AnalysisAssetPresentationDiagnostics = {
  state: AnalysisAssetPresentationState;
  storedDrawingCount: number;
  appliedDrawingCount: number;
  rejectedDrawingCount: number;
  appliedDrawingIds: string[];
  rejectionReasons: Record<string, number>;
  stale: boolean;
  resolvedAsset: ChartAnalysisAsset;
};

const marketDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function candleKeyForTimestamp(timestamp: string, interval: AnalysisAssetInterval): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  const utcMidnight = parsed.getUTCHours() === 0
    && parsed.getUTCMinutes() === 0
    && parsed.getUTCSeconds() === 0
    && parsed.getUTCMilliseconds() === 0;
  const parts = utcMidnight
    ? { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() }
    : marketDateParts(parsed);
  if (!parts) return null;
  const bucketDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (interval === "1W") {
    const daysSinceMonday = (bucketDate.getUTCDay() + 6) % 7;
    bucketDate.setUTCDate(bucketDate.getUTCDate() - daysSinceMonday);
  } else if (interval === "1M") {
    bucketDate.setUTCDate(1);
  }
  const dayKey = bucketDate.toISOString().slice(0, 10);
  return interval === "1M" ? dayKey.slice(0, 7) : dayKey;
}

export function isAnalysisAssetStale(
  asOf: string,
  candles: CandleDto[],
  assetVersion: "v1" | "v2" = "v1",
  interval?: AnalysisAssetInterval
): boolean {
  const threshold = assetVersion === "v2" ? 1 : 2;
  if (interval) {
    const asOfKey = candleKeyForTimestamp(asOf, interval);
    if (asOfKey) {
      const newerClosedKeys = new Set(candles.flatMap((candle) => {
        if (candle.isClosed === false) return [];
        const key = candleKeyForTimestamp(candle.timestamp, interval);
        return key && key > asOfKey ? [key] : [];
      }));
      return newerClosedKeys.size >= threshold;
    }
  }
  const asOfTime = Date.parse(asOf);
  if (!Number.isFinite(asOfTime)) return false;
  return candles.filter((candle) => (
    candle.isClosed !== false && Date.parse(candle.timestamp) > asOfTime
  )).length >= threshold;
}

export function resolveAnalysisAssetForCandles(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[]
): ChartAnalysisAsset | null {
  if (!asset || asset.assetVersion !== "v2") return asset;
  const timestampByKey = canonicalTimestampByKey(candles, asset.interval);
  const resolveLayer = <Key extends keyof ChartAnalysisAsset["layers"]>(key: Key): ChartAnalysisAsset["layers"][Key] => {
    const errors: Array<{ drawingId: string; reason: string }> = [];
    const drawings = asset.layers[key].drawings.flatMap((drawing) => {
      const resolved = resolveDrawingAnchors(drawing, asset.interval, timestampByKey);
      if (!resolved) {
        errors.push({ drawingId: drawing.id, reason: "anchor_not_in_canonical_candles" });
        return [];
      }
      return [resolved];
    });
    return { ...asset.layers[key], drawings, meta: { ...asset.layers[key].meta, anchorResolutionErrors: errors } };
  };
  const layers: ChartAnalysisAsset["layers"] = {
    structure: resolveLayer("structure"),
    trend: resolveLayer("trend"),
    agent: resolveLayer("agent")
  };
  return { ...asset, layers };
}

export function analysisAssetPresentationDiagnostics(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentDrawingIds?: string[]
): AnalysisAssetPresentationDiagnostics {
  const storedDrawingCount = drawingCount(asset);
  const resolvedAsset = resolveAnalysisAssetForCandles(asset, candles) ?? asset;
  const stale = isAnalysisAssetStale(asset.asOf, candles, asset.assetVersion, asset.interval);
  const resolvedDrawingIds = assetDrawingIds(resolvedAsset);
  const currentIds = currentDrawingIds === undefined ? null : new Set(currentDrawingIds);
  const appliedDrawingIds = stale
    ? []
    : currentIds === null
      ? resolvedDrawingIds
      : resolvedDrawingIds.filter((drawingId) => currentIds.has(drawingId));
  const appliedDrawingCount = appliedDrawingIds.length;
  const rejectedDrawingCount = Math.max(0, storedDrawingCount - appliedDrawingCount);
  const rejectionReasons = stale
    ? (storedDrawingCount ? { stale_asset: storedDrawingCount } : {})
    : anchorRejectionReasons(resolvedAsset);
  if (!stale && currentIds !== null) {
    const notApplied = resolvedDrawingIds.length - appliedDrawingIds.length;
    if (notApplied > 0) rejectionReasons.not_in_chart_document = notApplied;
  }
  // Asset status also reflects optional agent-layer failures.  A degraded LLM
  // outcome does not make otherwise canonical, renderable candles degraded.
  const degraded = asset.coverage?.renderable === false
    || (asset.quality?.state !== undefined && asset.quality.state !== "eligible");
  const state: AnalysisAssetPresentationState = stale
    ? "stale_asset"
    : rejectedDrawingCount > 0
      ? "presentation_rejected"
      : degraded
        ? "data_degraded"
        : storedDrawingCount === 0
          ? "quality_empty"
          : "ready";
  return {
    state,
    storedDrawingCount,
    appliedDrawingCount,
    rejectedDrawingCount,
    appliedDrawingIds,
    rejectionReasons,
    stale,
    resolvedAsset
  };
}

export function formatAnalysisAssetAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}

function marketDateParts(value: Date): { year: number; month: number; day: number } | null {
  const parts = Object.fromEntries(
    marketDateFormatter.formatToParts(value).map((part) => [part.type, part.value])
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return [year, month, day].every(Number.isFinite) ? { year, month, day } : null;
}

function canonicalTimestampByKey(
  candles: CandleDto[],
  interval: AnalysisAssetInterval
): Map<string, string> {
  const result = new Map<string, string>();
  candles.forEach((candle) => {
    const key = candleKeyForTimestamp(candle.timestamp, interval);
    if (!key) return;
    const current = result.get(key);
    if (!current || prefersTimestamp(candle.timestamp, current, interval)) {
      result.set(key, candle.timestamp);
    }
  });
  return result;
}

function prefersTimestamp(candidate: string, current: string, interval: AnalysisAssetInterval): boolean {
  if (interval === "1D") return false;
  const candidateDate = new Date(candidate);
  const currentDate = new Date(current);
  const candidateUtcMidnight = candidateDate.getUTCHours() === 0 && candidateDate.getUTCMinutes() === 0;
  const currentUtcMidnight = currentDate.getUTCHours() === 0 && currentDate.getUTCMinutes() === 0;
  return candidateUtcMidnight && !currentUtcMidnight;
}

function resolveDrawingAnchors(
  drawing: DrawingEntity,
  interval: AnalysisAssetInterval,
  timestampByKey: Map<string, string>
): DrawingEntity | null {
  let valid = true;
  let changed = false;
  const anchors = drawing.anchors.map((anchor): DrawingAnchor => {
    if (anchor.timestamp === undefined) return anchor;
    const key = candleKeyForTimestamp(String(anchor.timestamp), interval);
    const resolvedTimestamp = key ? timestampByKey.get(key) : undefined;
    if (!resolvedTimestamp) {
      valid = false;
      return anchor;
    }
    if (resolvedTimestamp === anchor.timestamp) return anchor;
    changed = true;
    return { ...anchor, timestamp: resolvedTimestamp };
  });
  if (!valid) return null;
  return changed ? { ...drawing, anchors } : drawing;
}

function drawingCount(asset: ChartAnalysisAsset): number {
  return asset.layers.structure.drawings.length
    + asset.layers.trend.drawings.length
    + asset.layers.agent.drawings.length;
}

function assetDrawingIds(asset: ChartAnalysisAsset): string[] {
  return [
    ...asset.layers.structure.drawings,
    ...asset.layers.trend.drawings,
    ...asset.layers.agent.drawings
  ].map((drawing) => drawing.id);
}

function anchorRejectionReasons(asset: ChartAnalysisAsset): Record<string, number> {
  const reasons: Record<string, number> = {};
  (["structure", "trend", "agent"] as const).forEach((layer) => {
    const errors = asset.layers[layer].meta?.anchorResolutionErrors;
    if (!Array.isArray(errors)) return;
    errors.forEach((error) => {
      if (!error || typeof error !== "object") return;
      const reason = (error as { reason?: unknown }).reason;
      if (typeof reason !== "string" || !reason) return;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    });
  });
  return reasons;
}
