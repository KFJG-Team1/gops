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
assert.deepEqual(steps.map((step) => step.id), ["evidence", "entry", "target", "stop", "summary"]);
assert.match(steps[1].body, /100\.00/);
assert.match(steps[2].body, /\+10\.00%/);
assert.match(steps[3].body, /-5\.00%/);
assert.match(steps[3].body, /이 기준을 벗어나면 매수 관점을 다시 검토합니다/);
assert.doesNotMatch(steps[3].body, /시나리오 무효화 조건/);
assert.deepEqual(steps[4].drawingIds, [plan.drawingIds.signal, plan.drawingIds.plan]);

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
assert.equal(sellSteps[1].title, "매도 기준");
assert.match(sellSteps[1].body, /매도 기준가 118\.00/);
assert.match(sellSteps[1].body, /근거 주기는 4h/);
assert.match(sellSteps[2].body, /하락 목표가 110\.00/);
assert.match(sellSteps[3].body, /매도 무효화가 122\.00/);
assert.match(sellSteps[3].body, /이 기준을 벗어나면 매도 관점을 다시 검토합니다/);
assert.match(sellSteps[4].body, /조건부 매도 후보/);
assert.deepEqual(buildChartCommentaryModel(asset, null).map((step) => step.id), ["evidence", "observe"]);
