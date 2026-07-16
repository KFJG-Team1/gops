import assert from "node:assert/strict";
import { buildChartCommentaryModel } from "../src/chart/commentaryModel";
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
  priceSources: { entry: "server", target: "server", stop: "server" }
};
const steps = buildChartCommentaryModel(asset, plan);
assert.deepEqual(steps.map((step) => step.id), ["levels", "trend", "pattern", "entry", "target", "stop", "summary"]);
assert.match(steps[0].body, /지지선 1개와 저항선 0개/);
assert.equal(steps[0].metricCards?.[0]?.items.find((item) => item.label === "가격")?.value, "98");
assert.equal(steps[1].body, "적격 대각 추세 없음");
assert.equal(steps[2].body, "적격 패턴 없음");
assert.match(steps[3].body, /100\.00/);
assert.match(steps[4].body, /\+10\.00%/);
assert.match(steps[5].body, /-5\.00%/);
assert.match(steps[5].body, /이 기준을 벗어나면 매수 관점을 다시 검토합니다/);
assert.doesNotMatch(steps[5].body, /시나리오 무효화 조건/);
assert.deepEqual(steps[6].drawingIds, [plan.drawingIds.signal, plan.drawingIds.plan]);

const sellSteps = buildChartCommentaryModel(asset, {
  ...plan,
  action: "sell_candidate",
  sourceKind: "conditional",
  sourceInterval: "4h",
  entryPrice: 118,
  targetPrice: 110,
  stopPrice: 122,
  rewardRiskRatio: 2
});
assert.equal(sellSteps[3].title, "매도 기준");
assert.match(sellSteps[3].body, /매도 기준가 118\.00/);
assert.match(sellSteps[3].body, /근거 주기는 4h/);
assert.match(sellSteps[4].body, /하락 목표가 110\.00/);
assert.match(sellSteps[5].body, /매도 무효화가 122\.00/);
assert.match(sellSteps[5].body, /이 기준을 벗어나면 매도 관점을 다시 검토합니다/);
assert.match(sellSteps[6].body, /조건부 매도 후보/);
assert.deepEqual(buildChartCommentaryModel(asset, null).map((step) => step.id), ["levels", "trend", "pattern", "observe"]);

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
