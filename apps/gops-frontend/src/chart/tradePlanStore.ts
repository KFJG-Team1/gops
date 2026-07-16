import type { AnalysisAssetInterval, ChartAnalysisAsset, GeometryPatternKind } from "./analysisAssetsApi";
import type { CandleDto } from "./types";

export type ActiveTradePlan = {
  version: "active-trade-plan-v1";
  chartDocumentId: string;
  symbol: string;
  interval: AnalysisAssetInterval;
  direction: "long" | "short";
  action: "buy_candidate" | "short_candidate";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  entryTrigger: number;
  rewardRiskRatio: number;
  signalAt: string;
  patternId: string;
  patternKind: GeometryPatternKind;
  projectionBars: number;
  reasons: string[];
  drawingIds: { plan: string; signal: string };
  provenance: {
    assetVersion: "geometry";
    algorithmVersion: string;
    inputDigest: string;
    asOf: string;
    generatedAt: string;
  };
  status: "active" | "stale";
};

export type TradePlanUpdatedDetail = {
  chartDocumentId: string;
  plan: ActiveTradePlan | null;
};

const registry = new Map<string, ActiveTradePlan>();
const listeners = new Set<() => void>();
let snapshot: readonly ActiveTradePlan[] = [];

export function tradePlanDrawingIds(asset: Pick<ChartAnalysisAsset, "symbol" | "interval"> & {
  geometry: { tradePlan?: { patternId: string } | null };
}): { plan: string; signal: string } | null {
  const patternId = asset.geometry.tradePlan?.patternId;
  if (!patternId) return null;
  const base = `chart-plan:${asset.symbol}:${asset.interval}:trade-timing:${patternId}`;
  return { plan: `${base}:risk`, signal: `${base}:signal` };
}

export function projectActiveTradePlan(
  asset: ChartAnalysisAsset | null,
  candles: CandleDto[],
  chartDocumentId: string,
  status: ActiveTradePlan["status"]
): ActiveTradePlan | null {
  const plan = asset?.geometry.tradePlan;
  if (!asset || !plan || !isNewPositionPlan(plan) || !hasSignalCandle(candles, plan.signalAt)) {
    return null;
  }
  const drawingIds = tradePlanDrawingIds(asset);
  if (!drawingIds) return null;
  return {
    version: "active-trade-plan-v1",
    chartDocumentId,
    symbol: asset.symbol,
    interval: asset.interval,
    direction: plan.direction,
    action: plan.action,
    entryPrice: plan.entryPrice,
    targetPrice: plan.targetPrice,
    stopPrice: plan.stopPrice,
    entryTrigger: plan.entryTrigger,
    rewardRiskRatio: plan.rewardRiskRatio,
    signalAt: plan.signalAt,
    patternId: plan.patternId,
    patternKind: plan.patternKind,
    projectionBars: plan.projectionBars,
    reasons: [...plan.reasons],
    drawingIds,
    provenance: {
      assetVersion: asset.assetVersion,
      algorithmVersion: asset.algorithmVersion,
      inputDigest: asset.inputDigest,
      asOf: asset.asOf,
      generatedAt: asset.generatedAt
    },
    status
  };
}

export function getActiveTradePlan(chartDocumentId: string): ActiveTradePlan | null {
  return registry.get(chartDocumentId) ?? null;
}

export function getActiveTradePlans(): readonly ActiveTradePlan[] {
  return snapshot;
}

export function subscribeActiveTradePlans(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveTradePlan(chartDocumentId: string, plan: ActiveTradePlan | null): void {
  const current = registry.get(chartDocumentId) ?? null;
  if (samePlan(current, plan)) return;
  if (plan) registry.set(chartDocumentId, plan);
  else registry.delete(chartDocumentId);
  snapshot = [...registry.values()].sort((left, right) => left.chartDocumentId.localeCompare(right.chartDocumentId));
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TradePlanUpdatedDetail>("gops:trade-plan-updated", {
      detail: { chartDocumentId, plan }
    }));
  }
}

export function clearActiveTradePlan(chartDocumentId: string): void {
  setActiveTradePlan(chartDocumentId, null);
}

function isNewPositionPlan(plan: NonNullable<ChartAnalysisAsset["geometry"]["tradePlan"]>): plan is typeof plan & {
  direction: "long";
  action: "buy_candidate";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  entryTrigger: number;
  rewardRiskRatio: number;
  signalAt: string;
} {
  return plan.action === "buy_candidate" && plan.direction === "long"
    && [plan.entryPrice, plan.targetPrice, plan.stopPrice, plan.entryTrigger, plan.rewardRiskRatio]
      .every((value) => typeof value === "number" && Number.isFinite(value))
    && typeof plan.signalAt === "string";
}

function hasSignalCandle(candles: CandleDto[], signalAt: string): boolean {
  return candles.some((candle) => candle.isClosed !== false && candle.timestamp === signalAt);
}

function samePlan(left: ActiveTradePlan | null, right: ActiveTradePlan | null): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
