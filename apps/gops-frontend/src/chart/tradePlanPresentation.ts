export type TradePlanPresentationAction = "buy_candidate" | "sell_candidate";

export type TradePlanPresentation = {
  basis: "매수 검토" | "매도";
  target: "수익 실현 검토" | "예상 하단";
  risk: "손실 제한 검토" | "재검토";
  scenario: "조건부 매수 시나리오" | "조건부 매도 검토";
};

const presentations: Record<TradePlanPresentationAction, TradePlanPresentation> = {
  buy_candidate: {
    basis: "매수 검토",
    target: "수익 실현 검토",
    risk: "손실 제한 검토",
    scenario: "조건부 매수 시나리오"
  },
  sell_candidate: {
    basis: "매도",
    target: "예상 하단",
    risk: "재검토",
    scenario: "조건부 매도 검토"
  }
};

export function tradePlanPresentation(action: TradePlanPresentationAction): TradePlanPresentation {
  return presentations[action];
}

export function signedTradePlanPercent(price: number, basisPrice: number): string {
  const ratio = (price - basisPrice) / Math.max(0.0000001, Math.abs(basisPrice));
  const percent = ratio * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}
