import type { PortfolioPosition } from "../components/portfolioHoldingsApi";

export type ChartCommentaryHoldingDisplay = {
  status: "확인 중" | "계좌 미연결" | "확인 불가" | "보유" | "미보유";
  averagePrice: number | null;
  quantity: number | null;
};

export function chartCommentaryHoldingDisplay(
  holding: PortfolioPosition | null,
  loading: boolean,
  error?: string,
  errorStatus?: number
): ChartCommentaryHoldingDisplay {
  const status = loading
    ? "확인 중"
    : errorStatus === 401 || errorStatus === 403
      ? "계좌 미연결"
      : error
        ? "확인 불가"
        : holding ? "보유" : "미보유";
  return {
    status,
    averagePrice: status === "보유" && holding?.averagePrice != null ? holding.averagePrice : null,
    quantity: status === "보유" && holding?.quantity != null ? holding.quantity : null
  };
}
