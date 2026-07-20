import type { AnalysisAssetInterval, ChartAnalysisAsset, GeometryPatternKind } from "./analysisAssetsApi";
import { projectChartTradeSetup } from "./chartTradeSetup";
import type { CandleDto } from "./types";

export type ActiveTradePlan = {
  version: "active-trade-plan-v1";
  chartDocumentId: string;
  symbol: string;
  interval: AnalysisAssetInterval;
  direction: "long";
  action: "buy_candidate";
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
  if (!asset) {
    return null;
  }
  const setup = projectChartTradeSetup(asset, candles);
  if (!setup
    || setup.sourceKind !== "confirmed"
    || setup.action !== "buy_candidate"
    || !setup.signalAt
    || !setup.patternKind) return null;
  return {
    version: "active-trade-plan-v1",
    chartDocumentId,
    symbol: asset.symbol,
    interval: asset.interval,
    direction: "long",
    action: setup.action,
    entryPrice: setup.entryPrice,
    targetPrice: setup.targetPrice,
    stopPrice: setup.stopPrice,
    entryTrigger: setup.entryTrigger,
    rewardRiskRatio: setup.rewardRiskRatio,
    signalAt: setup.signalAt,
    patternId: setup.patternId,
    patternKind: setup.patternKind,
    projectionBars: setup.projectionBars,
    reasons: [...setup.reasons],
    drawingIds: setup.drawingIds,
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

function samePlan(left: ActiveTradePlan | null, right: ActiveTradePlan | null): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
