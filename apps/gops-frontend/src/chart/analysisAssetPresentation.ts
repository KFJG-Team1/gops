import type { AnalysisAssetInterval, ChartAnalysisAsset } from "./analysisAssetsApi";
import type { CandleDto, DrawingAnchor, DrawingEntity } from "./types";

export type AnalysisAssetPresentationState = "ready" | "quality_empty" | "data_degraded" | "presentation_rejected" | "stale_asset";
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
export type DetectedPatternSummary = { kind: string; state: "forming" | "confirmed"; score: number; drawingCount: number };

const marketDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
});

export function candleKeyForTimestamp(timestamp: string, interval: AnalysisAssetInterval): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (["1m", "5m", "10m", "1h", "4h"].includes(interval)) return parsed.toISOString();
  const utcMidnight = parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  const parts = utcMidnight
    ? { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() }
    : marketDateParts(parsed);
  if (!parts) return null;
  const bucketDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (interval === "1W") {
    bucketDate.setUTCDate(bucketDate.getUTCDate() - ((bucketDate.getUTCDay() + 6) % 7));
  }
  return bucketDate.toISOString().slice(0, 10);
}

export function detectedPatternSummary(asset: ChartAnalysisAsset | null): DetectedPatternSummary | null {
  const pattern = asset?.geometry.primaryPattern ?? asset?.geometry.primaryTriangle;
  if (!pattern || (pattern.state !== "forming" && pattern.state !== "confirmed")) return null;
  const drawingCount = asset.geometry.drawings.filter((drawing) => drawing.id.includes(pattern.geometryHash)).length;
  return { kind: pattern.kind, state: pattern.state, score: pattern.score, drawingCount };
}

export function isAnalysisAssetStale(asOf: string, candles: CandleDto[], _assetVersion?: string, interval?: AnalysisAssetInterval): boolean {
  if (interval) {
    const asOfKey = candleKeyForTimestamp(asOf, interval);
    if (asOfKey) return candles.some((candle) => candle.isClosed !== false && (candleKeyForTimestamp(candle.timestamp, interval) ?? "") > asOfKey);
  }
  const asOfTime = Date.parse(asOf);
  return Number.isFinite(asOfTime) && candles.some((candle) => candle.isClosed !== false && Date.parse(candle.timestamp) > asOfTime);
}

export function resolveAnalysisAssetForCandles(asset: ChartAnalysisAsset | null, candles: CandleDto[]): ChartAnalysisAsset | null {
  if (!asset) return null;
  const timestampByKey = canonicalTimestampByKey(candles, asset.interval);
  const errors: Array<{ drawingId: string; reason: string }> = [];
  const drawings = asset.geometry.drawings.flatMap((drawing) => {
    const resolved = resolveDrawingAnchors(drawing, asset.interval, timestampByKey);
    if (!resolved) {
      errors.push({ drawingId: drawing.id, reason: "anchor_not_in_canonical_candles" });
      return [];
    }
    return [resolved];
  });
  return { ...asset, geometry: { ...asset.geometry, drawings, anchorResolutionErrors: errors } };
}

export function staleAnalysisAsset(asset: ChartAnalysisAsset, stale: boolean): ChartAnalysisAsset {
  if (!stale) return asset;
  return {
    ...asset,
    geometry: {
      ...asset.geometry,
      drawings: asset.geometry.drawings.map((drawing) => ({
        ...drawing,
        style: { ...drawing.style, opacity: Math.min(0.45, drawing.style.opacity ?? 1) }
      }))
    }
  };
}

export function analysisAssetPresentationDiagnostics(asset: ChartAnalysisAsset, candles: CandleDto[], currentDrawingIds?: string[]): AnalysisAssetPresentationDiagnostics {
  const storedDrawingCount = asset.geometry.drawings.length;
  const resolved = resolveAnalysisAssetForCandles(asset, candles) ?? asset;
  const stale = isAnalysisAssetStale(asset.asOf, candles, asset.assetVersion, asset.interval);
  const resolvedAsset = staleAnalysisAsset(resolved, stale);
  const resolvedDrawingIds = resolvedAsset.geometry.drawings.map((drawing) => drawing.id);
  const currentIds = currentDrawingIds === undefined ? null : new Set(currentDrawingIds);
  const appliedDrawingIds = currentIds === null ? resolvedDrawingIds : resolvedDrawingIds.filter((id) => currentIds.has(id));
  const rejectedDrawingCount = Math.max(0, storedDrawingCount - appliedDrawingIds.length);
  const rejectionReasons: Record<string, number> = {};
  resolvedAsset.geometry.anchorResolutionErrors?.forEach(({ reason }) => { rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1; });
  if (currentIds !== null && resolvedDrawingIds.length > appliedDrawingIds.length) rejectionReasons.not_in_chart_document = resolvedDrawingIds.length - appliedDrawingIds.length;
  const state: AnalysisAssetPresentationState = stale ? "stale_asset"
    : rejectedDrawingCount ? "presentation_rejected"
      : asset.coverage.state === "partial" ? "data_degraded"
        : storedDrawingCount ? "ready" : "quality_empty";
  return { state, storedDrawingCount, appliedDrawingCount: appliedDrawingIds.length, rejectedDrawingCount, appliedDrawingIds, rejectionReasons, stale, resolvedAsset };
}

export function formatAnalysisAssetAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}

function marketDateParts(value: Date): { year: number; month: number; day: number } | null {
  const parts = Object.fromEntries(marketDateFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return [year, month, day].every(Number.isFinite) ? { year, month, day } : null;
}

function canonicalTimestampByKey(candles: CandleDto[], interval: AnalysisAssetInterval): Map<string, string> {
  const result = new Map<string, string>();
  candles.forEach((candle) => {
    const key = candleKeyForTimestamp(candle.timestamp, interval);
    if (key && !result.has(key)) result.set(key, candle.timestamp);
  });
  return result;
}

function resolveDrawingAnchors<T extends DrawingEntity>(drawing: T, interval: AnalysisAssetInterval, timestampByKey: Map<string, string>): T | null {
  const visibleTimestamps = [...timestampByKey.values()].sort((left, right) => Date.parse(left) - Date.parse(right));
  if (drawing.type === "horizontalLine" && visibleTimestamps.length) {
    const anchors = drawing.anchors.map((anchor, index): DrawingAnchor => {
      if (anchor.timestamp === undefined) return anchor;
      const key = candleKeyForTimestamp(String(anchor.timestamp), interval);
      const timestamp = key ? timestampByKey.get(key) : undefined;
      if (timestamp) return timestamp === anchor.timestamp ? anchor : { ...anchor, timestamp };
      const fallback = index === drawing.anchors.length - 1
        ? visibleTimestamps[visibleTimestamps.length - 1]
        : visibleTimestamps[0];
      return { ...anchor, timestamp: fallback };
    });
    return { ...drawing, anchors } as T;
  }
  let valid = true;
  const anchors = drawing.anchors.map((anchor): DrawingAnchor => {
    if (anchor.timestamp === undefined) return anchor;
    const key = candleKeyForTimestamp(String(anchor.timestamp), interval);
    const timestamp = key ? timestampByKey.get(key) : undefined;
    if (!timestamp) { valid = false; return anchor; }
    return timestamp === anchor.timestamp ? anchor : { ...anchor, timestamp };
  });
  return valid ? { ...drawing, anchors } as T : null;
}
