import assert from "node:assert/strict";
import { buildChartCommentaryModel, buildChartCommentaryViewModel } from "../src/chart/commentaryModel";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import type { ChartTradeSetup } from "../src/chart/chartTradeSetup";

const asset = {
  assetVersion: "geometry", algorithmVersion: "v4", symbol: "AAPL", interval: "1D", sourceInterval: "1D",
  asOf: "2026-07-13T00:00:00.000Z", generatedAt: "2026-07-13T00:00:00.000Z", status: "ready", inputDigest: "sha256:commentary",
  coverage: { state: "full", targetBars: 380, actualBars: 380, contiguousBars: 380, missingBars: 0 },
  geometry: {
    drawings: [],
    supports: [{ id: "support", role: "support", price: 98, score: .9, touches: 3, anchors: [{ timestamp: "2026-07-10T00:00:00.000Z", price: 98 }] }],
    resistances: [], patterns: [], primaryPattern: null, primaryTriangle: null, historicalTriangle: null, tradePlan: null
  },
  indicators: { sma60: 100, sma120: 99, cross: { status: "none" } }
} satisfies ChartAnalysisAsset;

const plan: ChartTradeSetup = {
  version: "chart-trade-setup-v1", action: "buy_candidate", sourceKind: "confirmed", sourceInterval: "1D",
  entryPrice: 100, targetPrice: 110, stopPrice: 95, entryTrigger: 99.5, rewardRiskRatio: 2, signalAt: asset.asOf, signalIndex: 0,
  patternId: "pattern", patternKind: "bullish_flag", projectionBars: 10, reasons: ["reward_risk_passed"],
  drawingIds: { plan: "chart-plan:risk", signal: "chart-plan:signal" },
  priceSources: {
    entry: { label: "패턴 상단", drawingIds: ["pattern-upper"], derivation: "pattern_boundary" },
    target: { label: "패턴 폭", drawingIds: ["pattern-upper", "pattern-lower"], derivation: "pattern_measure" },
    stop: { label: "패턴 하단", drawingIds: ["pattern-lower"], derivation: "pattern_boundary" }
  }
};
const steps = buildChartCommentaryModel(asset, plan);
assert.deepEqual(steps.map((step) => step.id), ["levels", "trend", "pattern"]);
assert.match(steps[0].body, /지지선 1개와 저항선 0개/);
assert.equal(steps[0].metricCards?.[0]?.items.find((item) => item.label === "가격")?.value, "98");
assert.equal(steps[1].body, "적격 대각 추세 없음");
assert.equal(steps[2].body, "적격 패턴 없음");
const view = buildChartCommentaryViewModel(asset, plan, 101);
assert.deepEqual(view.keyPrices.map((item) => item.id), ["entry", "target", "invalidation"]);
assert.equal(view.keyPrices[0]?.distancePercent?.toFixed(2), "-0.99");
assert.equal(view.scenario?.status, "조건부 매수 검토");
assert.equal(view.scenario?.confirmation, "진입 100.00 · 패턴 상단");
assert.deepEqual(view.keyPrices.map((item) => item.label), ["진입", "목표", "손절"]);
assert.equal(view.scenario?.rewardRiskRatio, 2);
assert.equal(view.scenario?.projectionBars, 10);
assert.deepEqual(view.scenario?.drawingIds, [plan.drawingIds.signal, plan.drawingIds.plan, "pattern-upper", "pattern-lower"]);
assert.deepEqual(view.keyPrices.map((item) => item.sourceLabel), ["패턴 상단", "패턴 폭", "패턴 하단"]);
assert.match(view.summary.join(" "), /현재가 101\.00/);
assert.match(view.summary.join(" "), /98\.00/);
assert.match(view.summary.join(" "), /95\.00 패턴 하단을 손절 기준/);
assert.doesNotMatch(view.summary.join(" "), /평균 매입가|보유 수량|포트폴리오/);
assert.equal(view.summary.length, 3);
assert.deepEqual(buildChartCommentaryViewModel(asset, plan, 101), view, "same facts always produce the same commentary");

const withoutHolding = buildChartCommentaryViewModel(asset, null, null);
assert.equal(withoutHolding.scenario, null);
assert.deepEqual(withoutHolding.keyPrices, []);
assert.doesNotMatch(withoutHolding.summary.join(" "), /현재가|평균 매입가|진입 기준/);
assert.match(withoutHolding.summary.join(" "), /현재 적격 제안 없음/);
assert.equal(withoutHolding.summary.length, 2);

const sellView = buildChartCommentaryViewModel(asset, {
  ...plan,
  action: "sell_candidate",
  sourceKind: "conditional",
  sourceInterval: "4h",
  entryPrice: 118,
  targetPrice: 110,
  stopPrice: 122,
  rewardRiskRatio: 2
}, 118);
assert.equal(sellView.scenario?.status, "조건부 매도 검토");
assert.equal(sellView.scenario?.confirmation, "매도 118.00 · 패턴 상단");
assert.deepEqual(sellView.keyPrices.map((item) => item.label), ["매도", "예상 하단", "재검토"]);
assert.match(sellView.summary.join(" "), /118\.00 패턴 상단을 매도 기준으로 보고, 122\.00 패턴 하단에서 시나리오를 재검토/);
assert.deepEqual(buildChartCommentaryModel(asset, null).map((step) => step.id), ["levels", "trend", "pattern"]);

const trendWithInvalidation = {
  id: "trend-channel",
  kind: "channel" as const,
  direction: "up" as const,
  score: .91,
  drawingId: "chart-asset:AAPL:1D:trend-channel",
  anchors: [
    { timestamp: "2026-07-01T00:00:00.000Z", price: 95 },
    { timestamp: "2026-07-13T00:00:00.000Z", price: 101 },
    { timestamp: "2026-07-01T00:00:00.000Z", price: 100 }
  ],
  anchorPivotIds: ["pivot-a", "pivot-b"],
  touchPivotIds: ["pivot-a", "pivot-b", "pivot-c"],
  reactionPivotIds: ["pivot-b", "pivot-c"],
  touchCount: 3,
  reactionCount: 2,
  slopeAtrPerBar: .08,
  medianResidualAtr: .17,
  currentDistanceAtr: .42,
  lastTouchAgeBars: 3,
  channelWidthAtr: 2.4,
  parallelSlopeError: .03,
  containment: .88,
  activeInvalidation: false,
  violationCount: 1,
  invalidation: "adverse_close"
};
const trendSteps = buildChartCommentaryModel({
  ...asset,
  geometry: {
    ...asset.geometry,
    trends: [trendWithInvalidation],
    primaryTrend: trendWithInvalidation,
    drawingGroups: { levels: [], trend: [trendWithInvalidation.drawingId], pattern: [] }
  }
}, null);
const trendMetrics = new Map(trendSteps[1].metricCards?.[0]?.items.map((item) => [item.label, item.value]));
assert.equal(trendMetrics.get("활성 무효화"), "false");
assert.equal(trendMetrics.get("위반 횟수"), "1");
assert.equal(trendMetrics.get("무효화"), "adverse_close");

const selectedEvidenceSteps = buildChartCommentaryModel({
  ...asset,
  geometry: {
    ...asset.geometry,
    analysisTrace: {
      version: "geometry-analysis-trace-v1",
      pivots: [],
      levelCandidates: [
        { id: "selected-level", category: "level", selected: true, hardPass: true, evidenceRefs: ["pivot-selected"] },
        { id: "rejected-level", category: "level", selected: false, hardPass: false, evidenceRefs: ["pivot-rejected"] }
      ],
      trendCandidates: [], patternCandidates: [],
      selections: { levelCandidateIds: ["selected-level"], trendCandidateIds: [], patternCandidateIds: [] },
      omittedCounts: {}
    }
  }
}, null);
assert.deepEqual(selectedEvidenceSteps[0].candidateIds, ["selected-level"]);
assert.deepEqual(selectedEvidenceSteps[0].evidenceRefs, ["pivot-selected"]);

const legacyLevelId = "chart-asset:AAPL:1D:legacy-boundary";
const legacyPatternId = "chart-asset:AAPL:1D:legacy-evidence";
const legacyCommentarySteps = buildChartCommentaryModel({
  ...asset,
  geometry: {
    ...asset.geometry,
    drawings: [
      {
        id: legacyLevelId, type: "horizontalLine", anchors: [{ timestamp: asset.asOf, price: 98 }],
        symbol: "AAPL", interval: "1D", sourceInterval: "1D", style: { lineWidth: 2.5 }, label: "Legacy level",
        visible: true, createdBy: "system", sourceProposalId: legacyLevelId, createdAt: asset.asOf, updatedAt: asset.asOf
      },
      {
        id: legacyPatternId, type: "trendLine", anchors: [
          { timestamp: "2026-07-01T00:00:00.000Z", price: 95 },
          { timestamp: asset.asOf, price: 101 }
        ],
        symbol: "AAPL", interval: "1D", sourceInterval: "1D", style: { lineWidth: 2.5 }, label: "Legacy evidence",
        visible: true, createdBy: "system", sourceProposalId: legacyPatternId, createdAt: asset.asOf, updatedAt: asset.asOf
      }
    ]
  }
}, null);
assert.deepEqual(legacyCommentarySteps[0].drawingIds, [legacyLevelId]);
assert.deepEqual(legacyCommentarySteps[2].drawingIds, [legacyPatternId]);
