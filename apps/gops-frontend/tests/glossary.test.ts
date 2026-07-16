import assert from "node:assert/strict";
import { annotateGlossaryTerms } from "../src/glossary/matchGlossaryTerms";
import { allGlossaryEntries, stockGlossary } from "../src/glossary/stockGlossary";

allGlossaryEntries.forEach((entry) => {
  assert.equal(entry.description.length <= 90, true, `${entry.id} description exceeds 90 characters`);
  assert.doesNotMatch(entry.description, /살필 때 봅니다|시나리오 경계|현재 해석/);
  assert.equal((entry.description.match(/[.!?]$/g) ?? []).length, 1, `${entry.id} description must be one sentence`);
});
Object.values(stockGlossary).forEach((entry) => {
  assert.equal(entry.aliases.some((alias) => /[A-Za-z]/.test(alias)), true, `${entry.id} requires an English alias`);
});
assert.equal(allGlossaryEntries.length, 80);
assert.equal(new Set(allGlossaryEntries.map((entry) => entry.id)).size, 80);
const glossaryById = new Map(allGlossaryEntries.map((entry) => [entry.id, entry]));
assert.equal(
  glossaryById.get("invalidation")?.description,
  "가격이 이 기준을 벗어나면, 앞서 세운 매수·매도 예상이 틀렸다고 보고 계획을 다시 검토합니다."
);
assert.equal(
  glossaryById.get("entry_price")?.description,
  "매수나 매도를 시작할지 판단하는 기준 가격이며, 도달해도 주문이 자동 실행되지는 않습니다."
);
assert.equal(
  glossaryById.get("target_price")?.description,
  "가격이 예상한 방향으로 움직였을 때 이익 실현을 검토하는 기준 가격입니다."
);
assert.equal(
  glossaryById.get("stop_loss")?.description,
  "가격이 예상과 반대로 움직였을 때 손실을 제한하기 위해 매도를 검토하는 기준 가격입니다."
);
assert.equal(
  glossaryById.get("reward_risk_ratio")?.description,
  "예상 손실과 기대 이익의 비율로, 1:2는 손실 1에 이익 2를 기대한다는 뜻입니다."
);

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

assert.equal(annotateGlossaryTerms("양봉 뒤 음봉 전환").some((segment) => segment.glossaryId), false);
assert.equal(annotateGlossaryTerms("가봉된 문서").some((segment) => segment.glossaryId === "candlestick"), false);
assert.equal(annotateGlossaryTerms("무효성 검사").some((segment) => segment.glossaryId === "invalidation"), false);
assert.deepEqual(
  annotateGlossaryTerms("현재 관련성, 실패한 돌파, 확인 조건과 반대 근거를 봅니다.")
    .filter((segment) => segment.glossaryId)
    .map((segment) => segment.glossaryId),
  ["failed_breakout", "confirmation_condition", "counter_evidence"]
);
assert.equal(
  annotateGlossaryTerms("이 주장을 지지하지만 알림 채널과 가격 조정은 별개입니다.")
    .some((segment) => segment.glossaryId),
  false
);
assert.deepEqual(
  annotateGlossaryTerms("일봉과 주봉의 거래량, 상승 추세, 컨센서스를 확인합니다.")
    .filter((segment) => segment.glossaryId)
    .map((segment) => segment.glossaryId),
  ["consensus"]
);
