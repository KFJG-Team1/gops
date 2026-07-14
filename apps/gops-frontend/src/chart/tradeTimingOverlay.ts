import type { ChartAnalysisAsset, GeometryPatternKind, GeometryTradePlan } from "./analysisAssetsApi";
import type { CandleDto, DrawingEntity } from "./types";
import { chartSemanticCatalog, chartSemanticLabel } from "./chartSemanticCatalog";
import { tradePlanDrawingIds } from "./tradePlanStore";

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

  const ids = tradePlanDrawingIds(asset);
  if (!ids) return [];
  const sourceProposalId = `chart-plan:${asset.symbol}:${asset.interval}:trade-timing`;
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
    id: ids.signal,
    type: "flagMarker",
    anchors: [signalAnchor],
    style: { colorToken: "proposal", textToken: "proposal", lineWidth: 1.5, opacity: 0.98 },
    label
  }];

  if (plan.action === "sell_candidate" || plan.stopPrice === null || plan.targetPrice === null || plan.rewardRiskRatio === null || plan.entryTrigger === null) {
    return drawings;
  }
  const projectionIndex = Math.max(0, candles.length - 1) + Math.max(1, Math.round(plan.projectionBars));
  drawings.push({
    ...common,
    id: ids.plan,
    type: "riskRewardBox",
    anchors: [
      signalAnchor,
      { logicalIndex: projectionIndex, price: plan.stopPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval },
      { logicalIndex: projectionIndex, price: plan.targetPrice, paneId: "price", symbol: asset.symbol, interval: asset.interval }
    ],
    style: {
      colorToken: "proposal",
      fillToken: "proposal",
      textToken: "proposal",
      fillOpacity: 0.08,
      lineWidth: 1.5,
      lineDash: [6, 4],
      opacity: 0.92,
      labelPlacement: "axis",
      zoneSplit: true
    },
    label
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
