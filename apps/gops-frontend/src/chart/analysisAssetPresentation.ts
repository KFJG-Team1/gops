import type { AnalysisAssetInterval, ChartAnalysisAsset } from "./analysisAssetsApi";
import type { CandleDto, DrawingAnchor, DrawingEntity } from "./types";
import { buildTradeTimingDrawings, isTradeTimingDrawing } from "./tradeTimingOverlay";
import { chartSemanticCatalog } from "./chartSemanticCatalog";

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
type AnalysisAssetDrawing = ChartAnalysisAsset["geometry"]["drawings"][number];

const patternKindLabels: Record<string, string> = chartSemanticCatalog.patterns;

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
  const geometry = asset?.geometry;
  if (!geometry) return null;
  const pattern = geometry.primaryPattern ?? geometry.primaryTriangle;
  if (!pattern || (pattern.state !== "forming" && pattern.state !== "confirmed")) return null;
  const drawingCount = geometry.drawings.filter((drawing) => drawing.id.includes(pattern.geometryHash)).length;
  return { kind: pattern.kind, state: pattern.state, score: pattern.score, drawingCount };
}

export function formatDetectedPattern(pattern: { kind: string; state: string } | null | undefined): string {
  if (!pattern) return "감지 없음";
  const state = {
    forming: "형성 중",
    confirmed: "돌파 확인",
    inactive: "비활성",
    invalidated: "무효화"
  }[pattern.state] ?? pattern.state;
  return `${patternKindLabels[pattern.kind] ?? pattern.kind} · ${state}`;
}

export function isAnalysisAssetStale(asOf: string, candles: CandleDto[], _assetVersion?: string, interval?: AnalysisAssetInterval): boolean {
  if (interval) {
    const asOfKey = candleKeyForTimestamp(asOf, interval);
    if (asOfKey) return candles.some((candle) => candle.isClosed !== false && (candleKeyForTimestamp(candle.timestamp, interval) ?? "") > asOfKey);
  }
  const asOfTime = Date.parse(asOf);
  return Number.isFinite(asOfTime) && candles.some((candle) => candle.isClosed !== false && Date.parse(candle.timestamp) > asOfTime);
}

export function resolveAnalysisAssetForCandles(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[],
  availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): ChartAnalysisAsset | null {
  if (!asset) return null;
  const timestampByKey = canonicalTimestampByKey(candles, asset.interval);
  const visibleTimestamps = [...timestampByKey.values()].sort((left, right) => Date.parse(left) - Date.parse(right));
  const levelDrawingIds = analysisLevelDrawingIds(asset);
  const errors: Array<{ drawingId: string; reason: string }> = [];
  const drawings = asset.geometry.drawings.filter((drawing) => (
    !isTradeTimingDrawing(drawing) && !isMovingAverageCrossDrawing(drawing)
  )).flatMap((drawing) => {
    const resolved = resolveDrawingAnchors(drawing, asset.interval, timestampByKey, visibleTimestamps);
    if (!resolved) {
      errors.push({ drawingId: drawing.id, reason: "anchor_not_in_canonical_candles" });
      return [];
    }
    return [presentAnalysisDrawing(resolved, asset, levelDrawingIds)];
  });
  const movingAverageCrossDrawings = buildMovingAverageCrossDrawings(asset, candles);
  const tradeTimingDrawings = buildTradeTimingDrawings(asset, candles, availableAssets);
  return {
    ...asset,
    geometry: {
      ...asset.geometry,
      drawings: [...drawings, ...movingAverageCrossDrawings, ...tradeTimingDrawings],
      anchorResolutionErrors: errors
    }
  };
}

export function staleAnalysisAsset(asset: ChartAnalysisAsset, stale: boolean): ChartAnalysisAsset {
  if (!stale) return asset;
  return {
    ...asset,
    geometry: {
      ...asset.geometry,
      drawings: asset.geometry.drawings.map((drawing) => ({
        ...drawing,
        style: { ...drawing.style, opacity: Math.min(0.60, drawing.style.opacity ?? 1) }
      }))
    }
  };
}

export function analysisAssetPresentationDiagnostics(
  asset: ChartAnalysisAsset,
  candles: CandleDto[],
  currentDrawingIds?: string[],
  availableAssets?: Partial<Record<AnalysisAssetInterval, ChartAnalysisAsset | null>>
): AnalysisAssetPresentationDiagnostics {
  const storedDrawingCount = asset.geometry.drawings.filter((drawing) => (
    !isTradeTimingDrawing(drawing) && !isMovingAverageCrossDrawing(drawing)
  )).length;
  const resolved = resolveAnalysisAssetForCandles(asset, candles, availableAssets) ?? asset;
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

function analysisLevelDrawingIds(asset: ChartAnalysisAsset): Set<string> {
  return new Set([
    ...(asset.geometry.supports ?? []),
    ...(asset.geometry.resistances ?? [])
  ].flatMap((level) => [
    level.id,
    `chart-asset:${asset.symbol}:${asset.interval}:${level.id}`
  ]));
}

function presentAnalysisDrawing<T extends DrawingEntity>(drawing: T, asset: ChartAnalysisAsset, levelDrawingIds: Set<string>): T {
  if (levelDrawingIds.has(drawing.id)) {
    const level = [...(asset.geometry.supports ?? []), ...(asset.geometry.resistances ?? [])]
      .find((candidate) => drawing.id === candidate.id || drawing.id.endsWith(`:${candidate.id}`));
    if (!level || drawing.type !== "horizontalLine") return drawing;
    const importance = level.importanceTier;
    const importanceStyle = importance === "major"
      ? { lineWidth: 3, opacity: 0.95, lineDash: undefined, labelPlacement: "axis" as const }
      : importance === "standard"
        ? { lineWidth: 2.25, opacity: 0.82, lineDash: [6, 4], labelPlacement: "axis" as const }
        : importance === "minor"
          ? { lineWidth: 1.5, opacity: 0.62, lineDash: [2, 4], labelPlacement: "axis" as const }
          : { lineWidth: 2.5, labelPlacement: "axis" as const };
    const roleLabel = level.role === "support" ? "지지" : "저항";
    const importanceLabel = importance === "standard" ? `보조 ${roleLabel}` : importance === "minor" ? `참고 ${roleLabel}` : roleLabel;
    return {
      ...drawing,
      style: evidenceStyle(
        drawing.style,
        level.role === "support" ? "evidenceSupport" : "evidenceResistance",
        importanceStyle
      ),
      ...(importance ? { label: importanceLabel } : {})
    } as T;
  }
  if (isPatternDrawing(drawing, asset)) {
    const primaryPattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
    const patternOpacity = primaryPattern?.state === "confirmed"
      ? 0.92
      : primaryPattern?.state === "forming" ? 0.72 : 0.60;
    return {
      ...drawing,
      style: evidenceStyle(drawing.style, "evidencePattern", {
        lineWidth: 3.5,
        opacity: patternOpacity,
        labelPlacement: drawing.id.endsWith("-upper") ? "inline" : drawing.id.endsWith("-lower") ? "axis" : "none"
      })
    };
  }
  if (isTrendDrawing(drawing, asset)) {
    const trend = (asset.geometry.trends ?? []).find((candidate) => (
      drawing.id === candidate.drawingId || drawing.id.endsWith(`:${candidate.id}`)
    )) ?? asset.geometry.primaryTrend;
    const direction = trend?.direction;
    const token = direction === "down" ? "down" : "up";
    return {
      ...drawing,
      style: {
        ...drawing.style,
        color: undefined,
        fillColor: undefined,
        textColor: undefined,
        colorToken: token,
        fillToken: token,
        textToken: token,
        lineWidth: 2.75,
        opacity: 0.90,
        lineDash: undefined,
        extension: "ray"
      }
    };
  }
  return drawing;
}

function evidenceStyle(
  style: DrawingEntity["style"],
  token: "evidenceSupport" | "evidenceResistance" | "evidencePattern",
  patch: DrawingEntity["style"]
): DrawingEntity["style"] {
  return {
    ...style,
    color: undefined,
    fillColor: undefined,
    textColor: undefined,
    colorToken: token,
    fillToken: token,
    textToken: token,
    ...patch
  };
}

function isPatternDrawing(drawing: Pick<DrawingEntity, "id">, asset: ChartAnalysisAsset): boolean {
  const patterns = [
    ...(asset.geometry.patterns ?? []),
    asset.geometry.primaryPattern,
    asset.geometry.primaryTriangle,
    asset.geometry.historicalTriangle
  ].filter(Boolean);
  return patterns.some((pattern) => drawing.id.includes(pattern!.geometryHash));
}

function isTrendDrawing(drawing: Pick<DrawingEntity, "id">, asset: ChartAnalysisAsset): boolean {
  if (asset.geometry.drawingGroups?.trend.includes(drawing.id)) return true;
  return (asset.geometry.trends ?? []).some((trend) => drawing.id === trend.drawingId || drawing.id.endsWith(`:${trend.id}`));
}

function isMovingAverageCrossDrawing(drawing: Pick<DrawingEntity, "id">): boolean {
  return drawing.id.includes(":sma-cross:");
}

function buildMovingAverageCrossDrawings(asset: ChartAnalysisAsset, candles: CandleDto[]): AnalysisAssetDrawing[] {
  const cross = asset.indicators.cross;
  if (cross.status !== "crossed" || !cross.direction || !cross.timestamp) return [];
  const crossKey = candleKeyForTimestamp(cross.timestamp, asset.interval);
  if (!crossKey) return [];
  const candleIndex = candles.findIndex((candle) => (
    candle.isClosed !== false && candleKeyForTimestamp(candle.timestamp, asset.interval) === crossKey
  ));
  if (candleIndex < 0) return [];
  const calculated = movingAverageCrossPoint(candles, candleIndex, cross.direction);
  const fraction = typeof cross.fraction === "number" && Number.isFinite(cross.fraction)
    ? Math.max(0, Math.min(1, cross.fraction))
    : calculated?.fraction;
  const price = typeof cross.price === "number" && Number.isFinite(cross.price)
    ? cross.price
    : calculated?.price;
  if (price === undefined || fraction === undefined || candleIndex < 1) return [];
  const golden = cross.direction === "golden";
  const identity = crossKey.replace(/[^0-9A-Za-z]/g, "");
  return [{
    id: `chart-asset:${asset.symbol}:${asset.interval}:sma-cross:${cross.direction}:${identity}`,
    type: "flagMarker",
    anchors: [{
      logicalIndex: candleIndex - 1 + fraction,
      price,
      paneId: "price",
      symbol: asset.symbol,
      interval: asset.interval
    }],
    symbol: asset.symbol,
    interval: asset.interval,
    sourceInterval: asset.sourceInterval,
    style: { colorToken: "evidencePattern", textToken: "evidencePattern", lineWidth: 1.5, opacity: 0.82 },
    label: `${golden ? "골든크로스" : "데드크로스"} · SMA60/120`,
    locked: true,
    visible: true,
    createdBy: "system",
    sourceProposalId: `chart-asset:${asset.symbol}:${asset.interval}:sma-cross`,
    createdAt: asset.generatedAt,
    updatedAt: asset.generatedAt
  }];
}

function movingAverageCrossPoint(
  candles: CandleDto[],
  candleIndex: number,
  expectedDirection: "golden" | "dead"
): { fraction: number; price: number } | null {
  const previousShort = averageClose(candles, candleIndex - 1, 60);
  const currentShort = averageClose(candles, candleIndex, 60);
  const previousLong = averageClose(candles, candleIndex - 1, 120);
  const currentLong = averageClose(candles, candleIndex, 120);
  if (previousShort === null || currentShort === null || previousLong === null || currentLong === null) return null;
  const previousDifference = previousShort - previousLong;
  const currentDifference = currentShort - currentLong;
  const direction = previousDifference <= 0 && currentDifference > 0
    ? "golden"
    : previousDifference >= 0 && currentDifference < 0 ? "dead" : null;
  const differenceChange = currentDifference - previousDifference;
  if (direction !== expectedDirection || differenceChange === 0) return null;
  const fraction = Math.max(0, Math.min(1, -previousDifference / differenceChange));
  const shortCross = previousShort + fraction * (currentShort - previousShort);
  const longCross = previousLong + fraction * (currentLong - previousLong);
  return { fraction, price: (shortCross + longCross) / 2 };
}

function averageClose(candles: CandleDto[], endIndex: number, period: number): number | null {
  if (endIndex + 1 < period) return null;
  let total = 0;
  for (let index = endIndex + 1 - period; index <= endIndex; index += 1) {
    total += candles[index].close;
  }
  return total / period;
}

function resolveDrawingAnchors<T extends DrawingEntity>(
  drawing: T,
  interval: AnalysisAssetInterval,
  timestampByKey: Map<string, string>,
  visibleTimestamps: readonly string[]
): T | null {
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
