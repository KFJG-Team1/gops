const recommendationDeicticTerms = ["이 종목", "이종목", "이 기업", "이기업", "해당 종목", "해당종목", "선택한 종목", "선택한종목"];
const companyDetailTerms = ["기업", "회사", "기업분석", "기업 분석", "자세히", "상세"];
const navigationActionTerms = ["알려", "보여", "열어", "분석", "설명", "이동", "넘어"];

export function isSelectedRecommendationCompanyPrompt(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text.includes("차트")) {
    return false;
  }
  return recommendationDeicticTerms.some((term) => text.includes(term))
    && companyDetailTerms.some((term) => text.includes(term))
    && navigationActionTerms.some((term) => text.includes(term));
}

export type RecommendationCompanyNavigation =
  | { status: "not_applicable" }
  | { status: "missing_selection" }
  | { status: "ready"; presetId: "stock"; symbol: string };

export function resolveRecommendationCompanyNavigation(
  prompt: string,
  activePresetId: string | null,
  selectedSymbol: string | null
): RecommendationCompanyNavigation {
  if (activePresetId !== "market" || !isSelectedRecommendationCompanyPrompt(prompt)) {
    return { status: "not_applicable" };
  }
  const symbol = selectedSymbol?.trim().toUpperCase() ?? "";
  if (!symbol) {
    return { status: "missing_selection" };
  }
  return { status: "ready", presetId: "stock", symbol };
}
