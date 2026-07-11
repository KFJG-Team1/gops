import type { CandleDto } from "./types";
import type { ChartAnalysisAsset } from "./analysisAssetsApi";


export function isAnalysisAssetStale(asOf: string, candles: CandleDto[], assetVersion: "v1" | "v2" = "v1"): boolean {
  const asOfTime = Date.parse(asOf);
  if (!Number.isFinite(asOfTime)) {
    return false;
  }
  return candles.filter((candle) => (
    candle.isClosed !== false && Date.parse(candle.timestamp) > asOfTime
  )).length >= (assetVersion === "v2" ? 1 : 2);
}

export function resolveAnalysisAssetForCandles(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[]
): ChartAnalysisAsset | null {
  if (!asset || asset.assetVersion !== "v2") return asset;
  const exactTimestamps = new Set(candles.map((candle) => candle.timestamp));
  const resolveLayer = <Key extends keyof ChartAnalysisAsset["layers"]>(key: Key): ChartAnalysisAsset["layers"][Key] => {
    const errors: Array<{ drawingId: string; reason: string }> = [];
    const drawings = asset.layers[key].drawings.filter((drawing) => {
      const timedAnchors = drawing.anchors.filter((anchor) => anchor.timestamp !== undefined);
      const valid = timedAnchors.every((anchor) => exactTimestamps.has(String(anchor.timestamp)));
      if (!valid) errors.push({ drawingId: drawing.id, reason: "anchor_not_in_canonical_candles" });
      return valid;
    });
    if (errors.length) console.warn("Chart analysis asset anchors rejected", { symbol: asset.symbol, interval: asset.interval, layer: key, errors });
    return { ...asset.layers[key], drawings, meta: { ...asset.layers[key].meta, anchorResolutionErrors: errors } };
  };
  const layers: ChartAnalysisAsset["layers"] = {
    structure: resolveLayer("structure"),
    trend: resolveLayer("trend"),
    agent: resolveLayer("agent")
  };
  return { ...asset, layers };
}

export function formatAnalysisAssetAsOf(value: string): string {
  const match = value.match(/-(\d{2})-(\d{2})T/);
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10);
}
