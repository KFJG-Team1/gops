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
  /\.panel\s*\{[\s\S]+?--report-surface:\s*var\(--color-surface\);[\s\S]+?background:\s*var\(--report-surface\);[\s\S]+?color:\s*var\(--report-ink\);/,
  "the recommendation explanation uses the shared design-system panel surface"
);
assert.deepEqual(reportStyles.match(/#[0-9a-fA-F]{3,8}/g), ["#1b1b1b"], "only the DESIGN.md-approved header overlay color is local");
assert.doesNotMatch(reportStyles, /rgba?\(/, "recommendation surfaces do not introduce translucent structural colors");
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
assert.match(reportSource, /판단 근거와 비교 기준/, "direct recommendations show observed values with their baselines");
assert.match(reportSource, /유의할 점/, "direct recommendations show structured cautions");
assert.match(reportSource, /verdictLabel/, "the compact action label is rendered above the narrative headline");
assert.match(reportSource, /<h3>\{v3\.primary\.headline\}<\/h3>/, "the backend headline is the primary hero copy");
assert.match(reportSource, /item\.cautions\.map/, "the UI renders only normalized backend cautions");
assert.match(reportSource, /EvidenceMetricBar/, "observed evidence metrics are rendered as comparison graphics");
assert.match(reportSource, /EvidenceHelp/, "evidence validity explanations are available from compact help controls");
assert.equal(reportSource.includes("<p>{evidence.interpretation}</p>"), false, "long validity explanations do not consume the default layout height");
assert.equal(reportSource.includes("<small>{metric.comparison}</small>"), false, "comparison copy does not consume space below metric graphs");
assert.match(reportSource, /evidenceComparisonList/, "metric comparison copy is rendered inside the evidence help tooltip");
assert.match(reportSource, /metric\.valuePositionPct/, "the UI uses backend-provided graph positions");
assert.match(reportSource, /metric\.referencePositionPct/, "each graph shows its explicit comparison baseline");
assert.match(reportStyles, /\.evidenceMetricTrack[\s\S]+?border-radius:\s*999px;/, "evidence values use compact benchmark tracks");
assert.match(reportStyles, /\.sentenceEvidenceList[\s\S]+?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/, "wide evidence layouts use two compact columns");
assert.match(reportStyles, /\.evidenceHelp:focus-within \.evidenceTooltip/, "keyboard focus reveals the evidence explanation tooltip");
assert.match(reportStyles, /\.verdictCopy h3[\s\S]+?word-break:\s*keep-all;/, "Korean headline words do not split between syllables");
assert.match(reportStyles, /\.verdictCopy h3[\s\S]+?max-width:\s*26em;/, "desktop headline has room for a two-line Korean summary");
assert.match(reportStyles, /\.verdictCopy p[\s\S]+?word-break:\s*keep-all;/, "Korean narrative words do not split between syllables");
assert.match(reportSource, /눌림 진입/, "direct recommendations expose the fixed pullback entry route");
assert.match(reportSource, /판단 무효화/, "direct recommendations expose the invalidation price");
assert.match(reportSource, /15:50 ET/, "direct recommendations expose the forced intraday exit");
assert.match(panelSource, /actionLabel\(item\.action\)/, "recommendation rows label buy, conditional, watch, and unsuitable states");
assert.equal(reportSource.includes("missingOptionalFactors"), false, "missing optional evidence is not rendered as user-facing risk");
assert.equal(reportSource.includes("directHero"), false, "the card-style direct recommendation hero is removed");
assert.equal(reportSource.includes("keyEvidenceCard"), false, "the retired score-only evidence card stays removed");
assert.equal(panelSource.includes("evidence.primaryValue"), false, "recommendation rows use backend sentences instead of numeric evidence values");
assert.match(panelSource, /직접 매수 판단 데이터가 준비되지 않았습니다/, "legacy payloads fail safe to observation copy");
assert.match(apiSource, /normalizedDecision\?\.action === declaredAction/, "direct actions require a matching decision contract");
assert.match(apiSource, /action: decision\?\.action \?\? "watch"/, "invalid or legacy actions normalize to watch");
assert.match(apiSource, /cautions: decision \? normalizeCautions\(source\.cautions\) : \[\]/, "cautions require a matching decision contract");
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
