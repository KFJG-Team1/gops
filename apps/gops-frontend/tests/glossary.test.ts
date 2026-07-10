import assert from "node:assert/strict";
import { annotateGlossaryTerms } from "../src/glossary/matchGlossaryTerms";
import { stockGlossary } from "../src/glossary/stockGlossary";

Object.values(stockGlossary).forEach((entry) => {
  assert.equal(entry.description.length <= 120, true, `${entry.id} description exceeds 120 characters`);
  assert.equal(entry.aliases.some((alias) => /[A-Za-z]/.test(alias)), true, `${entry.id} requires an English alias`);
});

assert.deepEqual(annotateGlossaryTerms(""), []);
assert.equal(annotateGlossaryTerms("PRSI는 별도 문자열입니다.").some((segment) => segment.glossaryId === "rsi"), false);

const divergence = annotateGlossaryTerms("다이버전스가 확인됐습니다.");
assert.equal(divergence.find((segment) => segment.glossaryId === "divergence")?.text, "다이버전스");

const movingAverage = annotateGlossaryTerms("이동평균선 위에 있습니다.");
assert.deepEqual(
  movingAverage.filter((segment) => segment.glossaryId).map((segment) => [segment.text, segment.glossaryId]),
  [["이동평균선", "moving_average"]]
);

const repeated = annotateGlossaryTerms("RSI가 오르고 RSI는 60입니다.");
assert.equal(repeated.filter((segment) => segment.glossaryId === "rsi").length, 2);

const overlapping = annotateGlossaryTerms("피보나치 되돌림 구간");
assert.deepEqual(
  overlapping.filter((segment) => segment.glossaryId).map((segment) => segment.glossaryId),
  ["fibonacci_retracement"]
);

assert.deepEqual(
  annotateGlossaryTerms("무효화: 종가 이탈").filter((segment) => segment.glossaryId).map((segment) => segment.text),
  ["무효화"]
);

assert.deepEqual(
  annotateGlossaryTerms("양봉 뒤 음봉 전환").filter((segment) => segment.glossaryId).map((segment) => segment.glossaryId),
  ["bullish_candle", "bearish_candle"]
);
assert.equal(annotateGlossaryTerms("가봉된 문서").some((segment) => segment.glossaryId === "candlestick"), false);
assert.equal(annotateGlossaryTerms("무효성 검사").some((segment) => segment.glossaryId === "invalidation"), false);
