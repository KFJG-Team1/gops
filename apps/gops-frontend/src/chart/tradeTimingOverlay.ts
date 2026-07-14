import type { ChartAnalysisAsset, GeometryPatternKind, GeometryTradePlan } from "./analysisAssetsApi";
import type { CandleDto, DrawingEntity } from "./types";
import { chartSemanticCatalog, chartSemanticLabel } from "./chartSemanticCatalog";

type AnalysisAssetDrawing = ChartAnalysisAsset["geometry"]["drawings"][number];

const patternNames = chartSemanticCatalog.patterns as Record<GeometryPatternKind, string>;

export function isTradeTimingDrawing(drawing: Pick<DrawingEntity, "id">): boolean {
  return drawing.id.includes(":trade-timing:");
}

export function buildTradeTimingDrawings(
  asset: ChartAnalysisAsset,
  candles: CandleDto[]
): AnalysisAssetDrawing[] {
  const plan = asset.geometry.tradePlan;
  if (!plan?.signalAt || !isActionableAction(plan.action)) {
    return [];
  }
  const signalIndex = candles.findIndex((candle) => candle.timestamp === plan.signalAt && candle.isClosed !== false);
  if (signalIndex < 0 || plan.entryPrice === null) {
    return [];
  }

  const idBase = `chart-asset:${asset.symbol}:${asset.interval}:trade-timing:${plan.patternId}`;
  const sourceProposalId = `chart-asset:${asset.symbol}:${asset.interval}:trade-timing`;
  const color = plan.action === "buy_candidate" ? "#22c55e" : "#ef4444";
  const label = `${actionLabel(plan.action)} · ${patternNames[plan.patternKind]}`;
  const common = {
    symbol: asset.symbol,
    interval: asset.interval,
    sourceInterval: asset.sourceInterval,
    locked: true,
    visible: true,
    createdBy: "system" as const,
    sourceProposalId,
    createdAt: asset.generatedAt,
    updatedAt: asset.generatedAt
  };
  const signalAnchor = {
    timestamp: plan.signalAt,
    logicalIndex: signalIndex,
    price: plan.entryPrice,
    paneId: "price" as const,
    symbol: asset.symbol,
    interval: asset.interval
  };
  const drawings: AnalysisAssetDrawing[] = [{
    ...common,
    id: `${idBase}:signal`,
    type: "flagMarker",
    anchors: [signalAnchor],
    style: { color, textColor: color, lineWidth: 2, opacity: 0.98 },
    label
  }];

  if (plan.action === "sell_candidate" || plan.stopPrice === null || plan.targetPrice === null) {
    return drawings;
  }
  const projectionIndex = signalIndex + Math.max(1, Math.round(plan.projectionBars));
  drawings.push({
    ...common,
    id: `${idBase}:risk`,
    type: "riskRewardBox",
    anchors: [
      signalAnchor,
      { logicalIndex: projectionIndex, price: plan.stopPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval },
      { logicalIndex: projectionIndex, price: plan.targetPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval }
    ],
    style: { color, fillColor: color, fillOpacity: 0.12, lineWidth: 1.5, opacity: 0.92 },
    label: `진입 ${formatPrice(plan.entryPrice)} · 손절 ${formatPrice(plan.stopPrice)} · 목표 ${formatPrice(plan.targetPrice)}`
  });
  return drawings;
}

function actionLabel(action: "buy_candidate" | "sell_candidate" | "short_candidate"): string {
  return chartSemanticLabel("actions", action);
}

function isActionableAction(
  action: GeometryTradePlan["action"]
): action is "buy_candidate" | "sell_candidate" | "short_candidate" {
  return action === "buy_candidate" || action === "sell_candidate" || action === "short_candidate";
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}
