import { sectorLabelKo } from "../market/sectors";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import type { StockRecommendationItem, StockRecommendationPayload } from "./recommendationApi";

const FALLBACK_SYMBOLS = ["NVDA", "AMD", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "JPM"] as const;
const FALLBACK_SCORES = [90, 86, 82, 78, 74, 70, 66, 62, 58, 54] as const;
const FALLBACK_CONFIDENCES = [0.84, 0.81, 0.78, 0.75, 0.72, 0.69, 0.66, 0.63, 0.60, 0.57] as const;
const FALLBACK_REASON = "추천 데이터 준비 중 표시되는 시뮬레이션 종목입니다.";
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
    changePercent: seed?.changePercent,
    sector: seed?.sector,
    sectorLabelKo: seed?.sectorLabelKo || sectorLabelKo(seed?.sector),
    reasons: [{ type: "simulation", text: FALLBACK_REASON }],
    riskWarnings: [],
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
