import type { ChartAnalysisAsset, GeometryTradePlan } from "./analysisAssetsApi";
import { confirmationConditionLabel, patternNames, tradePlanConfirmationConditions } from "./tradeTimingOverlay";

export type TradeScenarioPhase = NonNullable<GeometryTradePlan["phase"]> | "forming" | "confirmed";

export type TradeScenarioPresentation = {
  available: boolean;
  phase: TradeScenarioPhase | null;
  phaseIndex: number;
  patternName: string;
  stateLabel: string;
  qualityScore: number;
  conditionLabels: string[];
  confirmationSummary: string | null;
  responseTitle: string | null;
  responseDetail: string | null;
  responseItems: string[];
  invalidation: string | null;
};

export function buildTradeScenarioPresentation(asset: ChartAnalysisAsset): TradeScenarioPresentation | null {
  const pattern = asset.geometry.primaryPattern ?? asset.geometry.primaryTriangle;
  if (!pattern) return null;
  const plan = asset.geometry.tradePlan ?? null;
  const active = pattern.state === "forming" || pattern.state === "confirmed";
  const conditions = plan ? tradePlanConfirmationConditions(plan) : [];
  const response = plan ? responseText(plan) : { title: null, detail: null, items: [] };
  const phase = plan?.phase ?? (pattern.state === "forming" ? "forming" : pattern.state === "confirmed" ? "confirmed" : null);
  return {
    available: active && Boolean(plan) && (conditions.length > 0 || pattern.state === "confirmed"),
    phase,
    phaseIndex: phaseIndex(phase),
    patternName: patternNames[pattern.kind],
    stateLabel: phaseLabel(phase),
    qualityScore: pattern.score,
    conditionLabels: conditions.map(confirmationConditionLabel),
    confirmationSummary: plan ? confirmationSummary(plan) : null,
    responseTitle: response.title,
    responseDetail: response.detail,
    responseItems: response.items,
    invalidation: plan ? invalidationText(plan) : null
  };
}

function responseText(plan: GeometryTradePlan): { title: string | null; detail: string | null; items: string[] } {
  if (plan.action === "watch") {
    return {
      title: plan.phase === "confirmation_pending" ? "돌파 후보 · 추가 확인 대기" : "관찰 조건",
      detail: tradePlanConfirmationConditions(plan).map(confirmationConditionLabel).join(" 또는 ") || "정확한 확인 가격을 계산 중입니다.",
      items: plan.phase === "confirmation_pending" ? ["거래량 1.5× 또는 다음 완료 봉 유지가 필요합니다."] : []
    };
  }
  if (plan.action === "buy_candidate" || plan.action === "short_candidate") {
    return {
      title: phaseTitle(plan),
      detail: entryText(plan),
      items: targetItems(plan)
    };
  }
  if (plan.action === "sell_candidate") {
    return {
      title: "보유 시 매도·청산 후보",
      detail: "확인 완료 봉을 기준으로 보유 포지션 축소를 검토합니다.",
      items: []
    };
  }
  return {
    title: "신규 진입 보류",
    detail: plan.reasons.includes("reward_risk_below_minimum") && plan.rewardRiskRatio !== null
      ? `T2 손익비 ${plan.rewardRiskRatio.toFixed(2)}가 최소 기준 ${plan.minimumRewardRisk.toFixed(2)}보다 낮습니다.`
      : reasonLabel(plan.reasons.at(-1)),
    items: []
  };
}

function confirmationSummary(plan: GeometryTradePlan): string | null {
  const evidence = plan.confirmationEvidence;
  if (!evidence) return null;
  if (evidence.method === "volume") {
    return `거래량 ${evidence.volumeRatio.toFixed(2)}×로 확정 · 기준 ${evidence.requiredVolumeRatio.toFixed(2)}×`;
  }
  if (evidence.method === "hold") return `다음 완료 봉 ${evidence.holdBars}개가 경계 밖을 유지해 확정`;
  return `가격 돌파 감지 · 거래량 또는 다음 완료 봉 확인 대기`;
}

function entryText(plan: GeometryTradePlan): string {
  if (!plan.entryPlan) return tradePlanNumbers(plan);
  const mode = plan.entryPlan.mode === "retest_close" ? "리테스트 종가" : "확정 종가";
  return `${mode} E ${formatPrice(plan.entryPlan.price)}`;
}

function targetItems(plan: GeometryTradePlan): string[] {
  if (!plan.targets?.length) return [];
  return plan.targets.map((target) => {
    const basis = target.basis === "nearest_opposing_level" ? "인접 반대 레벨"
      : target.basis === "one_r" ? "1R"
        : "패턴 측정 목표";
    return `${target.id} ${formatPrice(target.price)} · ${target.allocationPercent}% · ${target.rMultiple.toFixed(2)}R · ${basis}`;
  });
}

function invalidationText(plan: GeometryTradePlan): string | null {
  if (plan.stopPlan) {
    const initial = `초기 S ${formatPrice(plan.stopPlan.initialPrice)}`;
    return plan.stopPlan.activePrice !== plan.stopPlan.initialPrice
      ? `${initial} · 현재 보호 ${formatPrice(plan.stopPlan.activePrice)} · T1 이후 진입가 보호`
      : `${initial} · 도달 시 현재 대응 시나리오 종료`;
  }
  return plan.stopPrice !== null ? `무효화 ${formatPrice(plan.stopPrice)} · 도달 시 현재 대응 시나리오 종료` : null;
}

function phaseTitle(plan: GeometryTradePlan): string {
  if (plan.phase === "retest_confirmed") return "리테스트 확인 · 진입 후보";
  if (plan.phase === "t1_reached") return "T1 도달 · 잔여 50% 보호";
  if (plan.phase === "t2_reached") return "T2 도달 · 시나리오 완료";
  if (plan.phase === "invalidated") return "무효화 도달 · 시나리오 종료";
  if (plan.phase === "expired") return "관찰 기한 종료";
  return plan.action === "buy_candidate" ? "돌파 확인 · 매수 후보" : "하단 이탈 확인 · 공매도 후보";
}

function tradePlanNumbers(plan: GeometryTradePlan): string {
  if (plan.entryPrice === null || plan.targetPrice === null || plan.rewardRiskRatio === null) {
    return "확인 봉의 대응 가격을 계산 중입니다.";
  }
  return `진입 ${formatPrice(plan.entryPrice)} → 목표 ${formatPrice(plan.targetPrice)} · R:R ${plan.rewardRiskRatio.toFixed(2)}`;
}

function phaseIndex(phase: TradeScenarioPhase | null): number {
  if (phase === "confirmation_pending" || phase === "confirmed") return 1;
  if (phase === "retest_confirmed") return 2;
  if (phase === "t1_reached" || phase === "t2_reached" || phase === "invalidated" || phase === "expired") return 3;
  return 0;
}

function phaseLabel(phase: TradeScenarioPhase | null): string {
  if (!phase) return "비활성";
  return ({
    forming: "형성 중",
    confirmation_pending: "확인 대기",
    confirmed: "돌파 확인",
    retest_confirmed: "리테스트 확인",
    t1_reached: "T1 도달",
    t2_reached: "T2 도달",
    invalidated: "무효화",
    expired: "기한 종료"
  } as Record<TradeScenarioPhase, string>)[phase] ?? "비활성";
}

function reasonLabel(reason: string | undefined): string {
  return {
    confirmed_state_without_current_breakout: "현재 완료 봉에서 유효한 돌파를 다시 확인할 수 없습니다.",
    breakout_direction_mismatch: "패턴 방향과 실제 돌파 방향이 일치하지 않습니다.",
    invalid_risk_geometry: "유효한 위험 구간을 계산할 수 없습니다.",
    invalid_atr: "변동성 기준을 계산할 수 없습니다.",
    pattern_not_active: "현재 활성 상태가 아닌 패턴입니다.",
    opposing_level_too_close: "T1 후보 저항이 0.75R보다 가까워 신규 진입을 보류합니다.",
    target_ladder_invalid: "T1과 T2의 가격 순서가 유효하지 않습니다.",
    scenario_expired: "투영 기간 안에 목표나 무효화 조건이 충족되지 않았습니다."
  }[reason ?? ""] ?? "현재 조건에서는 신규 진입 시나리오를 제시하지 않습니다.";
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}
