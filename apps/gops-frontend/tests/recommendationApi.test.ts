import assert from "node:assert/strict";
import { fetchScoreProfiles, fetchStockRecommendations, suggestScoreProfile } from "../src/recommendations/recommendationApi";
import {
  shouldAutoApplySimulationDemoSuggestion,
  suggestionRationaleSummary
} from "../src/recommendations/ScoreProfileManager";

const item = {
  symbol: "JPM",
  action: "buy",
  rank: 1,
  score: 83,
  confidence: 0.78,
  reasons: [],
  riskWarnings: ["raw warning must not be rendered"],
  metricsSnapshot: { algorithmVersion: "deterministic-evidence-v3" },
  explanation: {
    version: "recommendation-explanation.v1",
    locale: "ko-KR",
    decisionLabel: "매수 추천",
    primary: {
      source: "deterministic",
      status: "ready",
      listSummary: "JPM · 은행 사업 특성과 시장 흐름 확인 · 계획 진입 검토",
      headline: "JPM의 기업 특성과 시장 흐름이 함께 드러난 후보입니다.",
      body: "은행 사업의 금리 민감도를 확인합니다. 시장 흐름이 강했습니다. 계획 범위 안에서만 진입을 검토합니다. 신용 위험도 별도로 확인합니다."
    },
    deterministic: {
      summary: "",
      evidence: [],
      risks: [],
      dataQuality: { evidenceReliability: 78, confidenceMeaning: "evidence_reliability_not_success_probability", missingFactors: [], stale: false, sentence: "" }
    },
    provenance: {
      algorithmVersion: "deterministic-evidence-v3",
      ruleSetVersion: "deterministic-evidence-v3.1",
      evidenceSnapshotId: "7",
      inputDigest: "abc",
      companyContextStatus: "ready",
      companyContextDigest: "company-digest",
      companyProfileAccession: "jpm-10k",
      usedCompanyRefs: ["tenK.businessModel"],
      usedEvidenceRefs: ["market_strength"]
    }
  },
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
    { code: "chase_limit", label: "추격 진입 기준", severity: "warning", sentence: "돌파 기준과 상한을 비교했습니다." },
    { code: "chase_limit", label: "중복", severity: "warning", sentence: "중복 문장" },
    { code: "decision_scope", label: "판단 유효 범위", severity: "notice", sentence: "당일까지만 유효합니다." },
    { code: "confidence_scope", label: "신뢰도 해석", severity: "notice", sentence: "신뢰도 설명" },
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
  { code: "chase_limit", label: "추격 진입 기준", severity: "warning", sentence: "돌파 기준과 상한을 비교했습니다." }
]);
assert.equal(normalized.items[0].explanation?.primary.listSummary, item.explanation.primary.listSummary);
assert.deepEqual(normalized.items[0].explanation?.provenance.usedCompanyRefs, ["tenK.businessModel"]);

responsePayload = { status: "ready", items: [{ ...item, cautions: undefined }] };
const compatible = await fetchStockRecommendations();
assert.deepEqual(compatible.items[0].cautions, []);

responsePayload = {
  presets: [
    { type: "preset", name: "균형", presetStyle: "balanced" },
    { type: "preset", name: "안정", presetStyle: "stable" }
  ],
  customProfiles: []
};
const scoreProfiles = await fetchScoreProfiles();
assert.equal(scoreProfiles.active.presetStyle, "stable");

responsePayload = {
  status: "ready",
  items: [{ ...item, action: "watch", cautions: item.cautions }]
};
const mismatched = await fetchStockRecommendations();
assert.equal(mismatched.items[0].action, "watch");
assert.deepEqual(mismatched.items[0].cautions, []);

responsePayload = {
  status: "ready",
  suggestion: {
    schemaVersion: "recommendation-score-suggestion.v1",
    query: "뉴스와 거래량",
    name: "뉴스 거래량 로직",
    rationale: "최신 뉴스와 거래 참여를 함께 반영했습니다.",
    confidence: 0.82,
    intent: {
      matchedKeywords: ["뉴스", "거래량"],
      documents: [{ id: "news-catalyst", title: "뉴스 촉매", reason: "촉매를 반영합니다.", matchedKeywords: ["뉴스"] }]
    },
    profile: {
      type: "custom",
      id: null,
      name: "뉴스 거래량 로직",
      revision: 0,
      schemaVersion: "recommendation-score-profile.v1",
      blockWeights: { trendStrength: 20, participationConfirmation: 25, priceStructure: 15, catalystQuality: 20, executionQuality: 10, qualityStability: 10 },
      factorWeights: { trendStrength: { currentSessionRelativeStrength: 100 } },
      portfolioWeight: 25,
      portfolioFactorWeights: { sectorDiversification: 30, correlationBenefit: 30, marginalVariance: 25, liquidityCashCompatibility: 15 }
    },
    evidence: {
      summary: ["최신 snapshot 1을 사용했습니다."],
      news: [{ ref: "news:MSFT:1", symbol: "MSFT", headline: "Cloud guidance raised" }]
    },
    provenance: {
      source: "llm",
      model: "gpt-test",
      promptVersion: "recommendation-score-profile-rag.ko.v1",
      generatedAt: "2026-07-18T00:00:00Z",
      evidenceSnapshotId: 1,
      evidenceAsOf: "2026-07-18T00:00:00Z",
      retrievalDigest: "digest",
      evidenceRefs: ["evidence-snapshot:1"]
    }
  }
};
const suggested = await suggestScoreProfile("뉴스와 거래량");
assert.equal(suggested.provenance.source, "llm");
assert.equal(suggested.profile.type, "custom");
assert.deepEqual(suggested.intent.matchedKeywords, ["뉴스", "거래량"]);
assert.equal(suggested.evidence.news[0].symbol, "MSFT");
assert.equal(shouldAutoApplySimulationDemoSuggestion(suggested), false);
assert.equal(shouldAutoApplySimulationDemoSuggestion({
  ...suggested,
  query: "거래대금이 강하고 추세가 이어지는 종목",
  provenance: {
    ...suggested.provenance,
    source: "deterministic",
    promptVersion: "simulation-demo-score-profile.v1"
  }
}), true);
assert.equal(
  suggestionRationaleSummary({
    ...suggested,
    rationale: "participationConfirmation을 높이고 raw snapshot을 반영했습니다.",
    evidence: { ...suggested.evidence, summary: ["gate 통과 후보가 0개이고 신뢰도는 0점입니다."] }
  }),
  "뉴스 촉매에 비중을 둔 로직입니다. 체결 여건과 기업 품질까지 함께 반영해 신호의 안정성을 높였습니다."
);

console.info("recommendation API normalization tests passed");
