import { sectorLabelKo } from "../market/sectors";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import type { StockRecommendationItem, StockRecommendationPayload } from "./recommendationApi";

const FALLBACK_SYMBOLS = ["NVDA", "AMD", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "JPM"] as const;
const FALLBACK_SCORES = [90, 86, 82, 78, 74, 70, 66, 62, 58, 54] as const;
const FALLBACK_CONFIDENCES = [0.84, 0.81, 0.78, 0.75, 0.72, 0.69, 0.66, 0.63, 0.60, 0.57] as const;
const FALLBACK_REASONS = [
  { type: "relative_strength", text: "반도체 업종 내 상대강도와 거래량 증가가 함께 확인됐습니다." },
  { type: "volume_reversal", text: "최근 거래량이 늘며 단기 하락 구간에서 매수세 유입이 관찰됐습니다." },
  { type: "market_momentum", text: "대형 기술주 중 가격 모멘텀과 수급 안정성이 우수합니다." },
  { type: "breakout", text: "장중 고점 돌파 후 거래대금이 유지돼 추세 지속 가능성이 높습니다." },
  { type: "sector_momentum", text: "소비재 섹터 대비 상대강도가 개선되고 거래량이 확대됐습니다." },
  { type: "buying_pressure", text: "낙폭 축소와 함께 기관성 매수 흐름이 유입되는 모습입니다." },
  { type: "technical_rebound", text: "과매도 구간에서 거래량을 동반한 기술적 반등 신호가 나타났습니다." },
  { type: "higher_lows", text: "반도체 업종 강세와 장중 저점 상승 흐름이 동시에 확인됐습니다." },
  { type: "liquidity_momentum", text: "거래대금 상위권을 유지하며 단기 반등 모멘텀이 강화됐습니다." },
  { type: "defensive_strength", text: "금융 섹터 내 안정적인 상대강도와 완만한 상승 추세가 확인됐습니다." }
] as const;
const FALLBACK_RISK_WARNINGS = [
  "단기 변동성 확대에 유의하세요.",
  "추세 반전 확인 전 분할 접근이 필요합니다.",
  "시장 지수 약세 전환 시 동반 조정 가능성이 있습니다.",
  "급등 이후 추격 매수 위험에 유의하세요.",
  "단기 저항 구간 재진입 가능성이 있습니다.",
  "반등 실패 시 최근 저점 재확인 가능성이 있습니다.",
  "변동폭이 커 손절 기준 설정이 필요합니다.",
  "업종 변동성 확대 시 조정 폭이 커질 수 있습니다.",
  "가격 변동성이 높아 비중 관리가 필요합니다.",
  "금리 민감도에 따른 방향 전환 가능성이 있습니다."
] as const;
const FALLBACK_STATUSES = new Set<StockRecommendationPayload["status"]>(["empty", "ready", "stale"]);
const seedBySymbol = new Map(sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item]));

export const recommendationSimulationFallbackItems: StockRecommendationItem[] = FALLBACK_SYMBOLS.map((symbol, index) => {
  const seed = seedBySymbol.get(symbol);
  return {
    symbol,
    action: "buy",
    rank: index + 1,
    score: FALLBACK_SCORES[index],
    confidence: FALLBACK_CONFIDENCES[index],
    changePercent: seed?.changePercent ?? undefined,
    sector: seed?.sector,
    sectorLabelKo: seed?.sectorLabelKo || sectorLabelKo(seed?.sector),
    reasons: [FALLBACK_REASONS[index]],
    riskWarnings: [FALLBACK_RISK_WARNINGS[index]],
    metricsSnapshot: {
      source: "frontend-recommendation-fallback",
      synthetic: true,
      simulation: true
    }
  };
});

export function shouldUseRecommendationSimulationFallback(payload: StockRecommendationPayload | null): boolean {
  return Boolean(payload && payload.items.length === 0 && FALLBACK_STATUSES.has(payload.status));
}
