import type { ChartAnalysisAsset, GeometryConfirmationCondition, GeometryPatternKind, GeometryTradePlan } from "./analysisAssetsApi";
import { candleKeyForTimestamp } from "./analysisTimestamp";
import type { CandleDto, DrawingAnchor, DrawingEntity } from "./types";

type AnalysisAssetDrawing = ChartAnalysisAsset["geometry"]["drawings"][number];

export const patternNames: Record<GeometryPatternKind, string> = {
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
  if (!plan || !["forming", "confirmed"].includes(plan.patternState)) {
    return [];
  }
  const closedCandles = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle }) => candle.isClosed !== false);
  const conditions = tradePlanConfirmationConditions(plan);
  const base = findClosedCandle(closedCandles, plan.signalAt ?? asset.asOf, asset.interval) ?? closedCandles.at(-1);
  if (!base) {
    return [];
  }

  const idBase = `chart-asset:${asset.symbol}:${asset.interval}:trade-timing:${plan.patternId}`;
  const sourceProposalId = `chart-asset:${asset.symbol}:${asset.interval}:trade-timing`;
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
  const projectionIndex = base.index + Math.max(1, Math.round(plan.projectionBars));
  const drawings: AnalysisAssetDrawing[] = [];

  conditions.forEach((condition, index) => {
    const identity = `${condition.direction}:${index}`;
    drawings.push({
      ...common,
      id: `${idBase}:condition-zone:${identity}`,
      type: "rangeBox",
      anchors: [
        scenarioAnchor(asset, base.candle.timestamp, base.index, condition.boundaryPrice),
        scenarioAnchor(asset, undefined, projectionIndex, condition.triggerPrice)
      ],
      style: {
        colorToken: "pointOrange",
        fillToken: "pointOrange",
        textToken: "pointOrange",
        fillOpacity: 0.055,
        lineWidth: 1,
        lineDash: [4, 4],
        opacity: 0.72
      },
      label: " "
    });
    drawings.push({
      ...common,
      id: `${idBase}:condition:${identity}`,
      type: "trendLine",
      anchors: [
        scenarioAnchor(asset, base.candle.timestamp, base.index, condition.triggerPrice),
        scenarioAnchor(asset, undefined, projectionIndex, condition.triggerPrice)
      ],
      style: {
        colorToken: "pointOrange",
        textToken: "pointOrange",
        lineWidth: 1.5,
        lineDash: [8, 5],
        opacity: 0.96,
        extension: "segment"
      },
      label: chartConfirmationConditionLabel(condition)
    });
  });

  if (plan.action === "watch") {
    if (plan.phase === "confirmation_pending" && plan.signalAt) {
      const pending = findClosedCandle(closedCandles, plan.signalAt, asset.interval) ?? base;
      drawings.push({
        ...common,
        id: `${idBase}:pending`,
        type: "flagMarker",
        anchors: [scenarioAnchor(asset, pending.candle.timestamp, pending.index, conditions[0]?.triggerPrice ?? pending.candle.close)],
        style: { colorToken: "pointOrange", textToken: "pointOrange", lineWidth: 1.5, lineDash: [4, 3], opacity: 0.92 },
        label: "확인 대기 · 거래량/다음 봉"
      });
    } else {
      drawings.push({
        ...common,
        id: `${idBase}:watch`,
        type: "textLabel",
        anchors: [scenarioAnchor(asset, base.candle.timestamp, base.index, base.candle.close)],
        style: { colorToken: "pointOrange", textToken: "pointOrange", lineWidth: 1.5, opacity: 0.98 },
        label: `관찰 중 · ${patternNames[plan.patternKind]}`
      });
    }
    return drawings;
  }

  if (!plan.signalAt || !isConfirmedAction(plan.action)) {
    return drawings;
  }
  const signal = findClosedCandle(closedCandles, plan.signalAt, asset.interval);
  if (!signal) {
    return drawings;
  }
  const markerPrice = conditions[0]?.triggerPrice ?? plan.entryPrice ?? signal.candle.close;
  const colorToken = actionColorToken(plan.action);
  drawings.push({
    ...common,
    id: `${idBase}:signal`,
    type: "flagMarker",
    anchors: [scenarioAnchor(asset, signal.candle.timestamp, signal.index, markerPrice)],
    style: { colorToken, textToken: colorToken, lineWidth: 2, opacity: 0.98 },
    label: confirmationMarkerLabel(plan)
  });

  const entry = plan.entryPlan?.at
    ? findClosedCandle(closedCandles, plan.entryPlan.at, asset.interval)
    : signal;
  if (plan.retest?.state === "confirmed" && plan.retest.at) {
    const retest = findClosedCandle(closedCandles, plan.retest.at, asset.interval);
    if (retest) {
      drawings.push({
        ...common,
        id: `${idBase}:retest`,
        type: "flagMarker",
        anchors: [scenarioAnchor(asset, retest.candle.timestamp, retest.index, plan.entryPlan?.price ?? retest.candle.close)],
        style: { colorToken: "signal", textToken: "signal", lineWidth: 1.5, opacity: 0.96 },
        label: "리테스트 확인"
      });
    }
  }

  if (!isRiskRewardAction(plan.action) || !entry || plan.entryPrice === null) {
    return drawings;
  }
  if (plan.version === "pattern-trade-timing-v3" && plan.stopPlan && plan.targets?.length === 2) {
    const targetOne = plan.targets.find((target) => target.id === "T1");
    const targetTwo = plan.targets.find((target) => target.id === "T2");
    if (!targetOne || !targetTwo) {
      return drawings;
    }
    const riskProjectionIndex = entry.index + Math.max(1, Math.round(plan.projectionBars));
    drawings.push({
      ...common,
      id: `${idBase}:plan`,
      type: "tradePlanBox",
      anchors: [
        scenarioAnchor(asset, entry.candle.timestamp, entry.index, plan.entryPrice),
        scenarioAnchor(asset, undefined, riskProjectionIndex, plan.stopPlan.initialPrice),
        scenarioAnchor(asset, undefined, riskProjectionIndex, targetOne.price),
        scenarioAnchor(asset, undefined, riskProjectionIndex, targetTwo.price)
      ],
      style: { colorToken: "signal", textToken: "signal", fillOpacity: 0.1, lineWidth: 1.4, opacity: endedScenarioOpacity(plan.phase) },
      label: `${entryModeLabel(plan)} · T1/T2 50%`
    });
    if (plan.phase === "t1_reached" && plan.stopPlan.activePrice !== plan.stopPlan.initialPrice) {
      drawings.push({
        ...common,
        id: `${idBase}:protect`,
        type: "horizontalLine",
        anchors: [
          scenarioAnchor(asset, entry.candle.timestamp, entry.index, plan.stopPlan.activePrice),
          scenarioAnchor(asset, undefined, riskProjectionIndex, plan.stopPlan.activePrice)
        ],
        style: { colorToken: "signal", textToken: "signal", lineWidth: 1.5, lineDash: [5, 4], opacity: 0.96 },
        label: `보호 E ${formatPrice(plan.stopPlan.activePrice)}`
      });
    }
    return drawings;
  }

  if (plan.stopPrice === null || plan.targetPrice === null) {
    return drawings;
  }
  const riskProjectionIndex = entry.index + Math.max(1, Math.round(plan.projectionBars));
  drawings.push({
    ...common,
    id: `${idBase}:risk`,
    type: "riskRewardBox",
    anchors: [
      scenarioAnchor(asset, entry.candle.timestamp, entry.index, plan.entryPrice),
      scenarioAnchor(asset, undefined, riskProjectionIndex, plan.stopPrice),
      scenarioAnchor(asset, undefined, riskProjectionIndex, plan.targetPrice)
    ],
    style: { colorToken, textToken: colorToken, fillOpacity: 0.12, lineWidth: 1.5, opacity: 0.92 },
    label: `진입 ${formatPrice(plan.entryPrice)} · 손절 ${formatPrice(plan.stopPrice)} · 목표 ${formatPrice(plan.targetPrice)}`
  });
  return drawings;
}

function scenarioAnchor(
  asset: ChartAnalysisAsset,
  timestamp: string | undefined,
  logicalIndex: number,
  price: number
): DrawingAnchor {
  return {
    timestamp,
    logicalIndex,
    price,
    paneId: "price",
    symbol: asset.symbol,
    interval: asset.interval
  };
}

function findClosedCandle(
  candles: Array<{ candle: CandleDto; index: number }>,
  timestamp: string,
  interval: ChartAnalysisAsset["interval"]
) {
  const key = candleKeyForTimestamp(timestamp, interval);
  return candles.find(({ candle }) => candleKeyForTimestamp(candle.timestamp, interval) === key);
}

function confirmationMarkerLabel(plan: GeometryTradePlan): string {
  if (plan.action === "no_trade") return "신규 진입 보류";
  if (plan.action === "sell_candidate") return "보유 시 축소·청산 후보";
  if (plan.confirmationEvidence?.method === "volume") {
    return `돌파 확정 · 거래량 ${plan.confirmationEvidence.volumeRatio.toFixed(2)}×`;
  }
  if (plan.confirmationEvidence?.method === "hold") return "돌파 확정 · 다음 봉 유지";
  return plan.action === "buy_candidate" ? "매수 후보 · 돌파 확정" : "공매도 후보 · 돌파 확정";
}

function entryModeLabel(plan: GeometryTradePlan): string {
  return plan.entryPlan?.mode === "retest_close" ? "리테스트 종가 진입" : "확정 종가 진입";
}

function endedScenarioOpacity(phase: GeometryTradePlan["phase"]): number {
  return phase === "invalidated" || phase === "t2_reached" || phase === "expired" ? 0.48 : 0.94;
}

function isConfirmedAction(action: GeometryTradePlan["action"]): boolean {
  return action !== "watch";
}

function isRiskRewardAction(action: GeometryTradePlan["action"]): boolean {
  return action === "buy_candidate" || action === "short_candidate";
}

function actionColorToken(action: GeometryTradePlan["action"]): "up" | "down" | "pointOrange" {
  if (action === "buy_candidate") return "up";
  if (action === "no_trade") return "pointOrange";
  return "down";
}

export function tradePlanConfirmationConditions(plan: GeometryTradePlan): GeometryConfirmationCondition[] {
  if (plan.confirmationConditions?.length) return plan.confirmationConditions;
  if (plan.entryTrigger === null) return [];
  const direction = plan.direction === "long" || plan.action === "buy_candidate" ? "up"
    : plan.direction === "short" || plan.direction === "exit_long" || plan.action === "short_candidate" || plan.action === "sell_candidate" ? "down"
      : null;
  if (!direction) return [];
  return [{
    direction,
    boundary: direction === "up" ? "upper" : "lower",
    boundaryPrice: plan.entryTrigger,
    triggerPrice: plan.entryTrigger,
    bufferAtr: 0,
    rule: direction === "up" ? "completed_close_above" : "completed_close_below"
  }];
}

export function confirmationConditionLabel(condition: GeometryConfirmationCondition): string {
  const operator = condition.rule === "completed_close_above" ? ">" : "<";
  const buffer = condition.bufferAtr > 0
    ? ` · ${condition.direction === "up" ? "+" : "-"}${condition.bufferAtr.toFixed(2)} ATR`
    : "";
  return `완료 봉 ${operator} ${formatPrice(condition.triggerPrice)}${buffer}`;
}

function chartConfirmationConditionLabel(condition: GeometryConfirmationCondition): string {
  return `C ${formatPrice(condition.triggerPrice)} · 완료봉`;
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}
