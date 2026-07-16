import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspaceStyles, reportStyles, reportSource] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockRecommendationExplainPanel.module.css", import.meta.url), "utf8"),
  readFile(new URL("../src/recommendations/StockRecommendationExplainPanel.tsx", import.meta.url), "utf8")
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
