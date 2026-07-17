import assert from "node:assert/strict";
import { fetchStockRecommendations } from "../src/recommendations/recommendationApi";

const item = {
  symbol: "JPM",
  action: "buy",
  rank: 1,
  score: 83,
  confidence: 0.78,
  reasons: [],
  riskWarnings: ["raw warning must not be rendered"],
  metricsSnapshot: { algorithmVersion: "deterministic-evidence-v3" },
  decision: {
    version: "recommendation-decision.v1",
    action: "buy",
    label: "매수 추천",
    riskLevel: "balanced",
    holdingHorizon: "intraday",
    entryRoutes: [],
    targetPriceByRoute: {},
    forceExitAt: "2026-07-15T15:50:00-04:00",
    failedConditions: []
  },
  keyEvidence: [{
    code: "market_strength",
    label: "시장 흐름",
    primaryValue: "SPY 대비 +2.10%p",
    secondaryValue: "",
    assessment: "strong",
    interpretation: "SPY 대비 당일 상대강도는 +2.10%p였습니다.",
    metrics: [
      { label: "당일 상대강도", value: "+2.10%p", comparison: "중립 0%p", valuePositionPct: 85, referencePositionPct: 50, tone: "positive" },
      { label: "잘못된 위치", value: "999", comparison: "제외", valuePositionPct: 120, referencePositionPct: 50, tone: "positive" }
    ]
  }],
  cautions: [
    { code: "decision_scope", label: "판단 유효 범위", severity: "notice", sentence: "당일까지만 유효합니다." },
    { code: "decision_scope", label: "중복", severity: "warning", sentence: "중복 문장" },
    { code: "bad_severity", label: "잘못된 값", severity: "critical", sentence: "제외해야 합니다." },
    { code: "missing_sentence", label: "문장 없음", severity: "notice" }
  ]
};

let responsePayload: unknown = { status: "ready", items: [item] };
globalThis.fetch = async () => new Response(JSON.stringify(responsePayload), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

const normalized = await fetchStockRecommendations();
assert.deepEqual(normalized.items[0].keyEvidence[0].metrics, [
  { label: "당일 상대강도", value: "+2.10%p", comparison: "중립 0%p", valuePositionPct: 85, referencePositionPct: 50, tone: "positive" }
]);
assert.deepEqual(normalized.items[0].cautions, [
  { code: "decision_scope", label: "판단 유효 범위", severity: "notice", sentence: "당일까지만 유효합니다." }
]);

responsePayload = { status: "ready", items: [{ ...item, cautions: undefined }] };
const compatible = await fetchStockRecommendations();
assert.deepEqual(compatible.items[0].cautions, []);

responsePayload = {
  status: "ready",
  items: [{ ...item, action: "watch", cautions: item.cautions }]
};
const mismatched = await fetchStockRecommendations();
assert.equal(mismatched.items[0].action, "watch");
assert.deepEqual(mismatched.items[0].cautions, []);

console.info("recommendation API normalization tests passed");
