import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspaceStyles, reportStyles, reportSource, panelSource, apiSource] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockRecommendationExplainPanel.module.css", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockRecommendationExplainPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockRecommendationsPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/recommendationApi.ts", import.meta.url), "utf8")
]);

assert.match(
  workspaceStyles,
  /\.stock-recommendations-panel[\s\S]+?\.stock-rec-row\.is-selected[\s\S]+?background:\s*#fff;[\s\S]+?color:\s*#0a0a0a;/,
  "selected recommendation rows use white paper with black ink"
);
assert.match(
  reportStyles,
  /\.panel\s*\{[\s\S]+?background:\s*#272727;[\s\S]+?color:\s*var\(--report-ink\);/,
  "the recommendation explanation uses the standard dark panel surface"
);
assert.match(
  reportSource,
  /items\.find\(\(candidate\) => candidate\.symbol === preferred\)/,
  "the explanation follows recommendation-list selection changes"
);
assert.match(reportSource, /개인화 가중치/, "V2 exposes read-only effective factor weights");
assert.match(reportSource, /펀더멘털 데이터/, "V2 exposes fundamental provenance and fallback status");
assert.match(reportSource, /위험예산 비교/, "V2 compares observed risk with its effective budget");
assert.equal(panelSource.includes("7/14 마감 근거 · 7/15 고정 추천 · 역사 재구성"), false, "fixed replay banner stays hidden");
assert.equal(reportSource.includes("리스크 체크"), false, "raw risk warnings stay out of the explanation UI");
assert.equal(reportSource.includes("판단 맥락"), false, "internal timing context stays out of the explanation UI");
assert.equal(reportSource.includes("데이터 품질"), false, "raw data-quality diagnostics stay out of the explanation UI");
assert.equal(reportSource.includes("알고리즘 출처"), false, "provenance diagnostics stay out of the explanation UI");
assert.equal(reportSource.includes("결정론적 설명"), false, "provider implementation labels stay out of the explanation UI");
assert.equal(panelSource.includes("recommendationVisibleRiskWarnings"), false, "raw risk warnings stay out of recommendation rows");
assert.equal(apiSource.includes("simulatorStatus.recommendations"), false, "LIVE and SIM use the same recommendation API");
assert.equal(panelSource.includes("시뮬레이션 시각 기준 추천 데이터가 없어"), false, "SIM no longer suppresses verified recommendations");
assert.match(reportSource, /핵심 판단 근거/, "direct recommendations show sentence evidence beside the trade plan");
assert.match(reportSource, /눌림 진입/, "direct recommendations expose the fixed pullback entry route");
assert.match(reportSource, /판단 무효화/, "direct recommendations expose the invalidation price");
assert.match(reportSource, /15:50 ET/, "direct recommendations expose the forced intraday exit");
assert.match(panelSource, /actionLabel\(item\.action\)/, "recommendation rows label buy, conditional, watch, and unsuitable states");
assert.equal(reportSource.includes("missingOptionalFactors"), false, "missing optional evidence is not rendered as user-facing risk");
assert.equal(reportSource.includes("directHero"), false, "the card-style direct recommendation hero is removed");
assert.equal(reportSource.includes("keyEvidenceCard"), false, "numeric evidence cards are removed");
assert.equal(panelSource.includes("evidence.primaryValue"), false, "recommendation rows use backend sentences instead of numeric evidence values");
assert.match(panelSource, /직접 매수 판단 데이터가 준비되지 않았습니다/, "legacy payloads fail safe to observation copy");
assert.match(apiSource, /normalizedDecision\?\.action === declaredAction/, "direct actions require a matching decision contract");
assert.match(apiSource, /action: decision\?\.action \?\? "watch"/, "invalid or legacy actions normalize to watch");
assert.match(reportStyles, /grid-template-columns:\s*minmax\(0, 1\.45fr\) minmax\(230px, 0\.75fr\)/, "the previous two-column detail layout is restored");

for (const removedCopy of [
  "추천 종목 선택",
  "결정론적 점수화 결과",
  "시장 대비 ${formatPercent(relativeStrength)}의 상대강도",
  "추천 계산 스냅샷",
  "개 신호",
  "추천은 자동 주문이 아닙니다.",
  "장중 추천 해설 ·",
  "추천 {item.rank}위"
]) {
  assert.equal(reportSource.includes(removedCopy), false, `removed report copy stays absent: ${removedCopy}`);
}

console.info("recommendation panel style tests passed");
