import type { ChartAnalysisAsset, GeometryPatternKind, GeometryTradePlan } from "./analysisAssetsApi";
import type { CandleDto, DrawingEntity } from "./types";

type AnalysisAssetDrawing = ChartAnalysisAsset["geometry"]["drawings"][number];

const patternNames: Record<GeometryPatternKind, string> = {
  ascending_triangle: "상승 삼각형",
  descending_triangle: "하락 삼각형",
  symmetrical_triangle: "대칭 삼각형",
  bullish_flag: "상승 깃발형",
  bearish_flag: "하락 깃발형",
  bullish_pennant: "상승 페넌트",
  bearish_pennant: "하락 페넌트",
  bullish_rectangle: "상승 직사각형",
  bearish_rectangle: "하락 직사각형",
  rising_wedge: "상승 쐐기",
  falling_wedge: "하락 쐐기",
  descending_channel_breakout: "하락 채널 상단 돌파",
  ascending_channel_breakdown: "상승 채널 하단 이탈"
};

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
  if (action === "buy_candidate") return "매수 후보";
  if (action === "short_candidate") return "공매도 후보";
  return "매도·청산 후보";
}

function isActionableAction(
  action: GeometryTradePlan["action"]
): action is "buy_candidate" | "sell_candidate" | "short_candidate" {
  return action === "buy_candidate" || action === "sell_candidate" || action === "short_candidate";
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}
