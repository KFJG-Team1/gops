import assert from "node:assert/strict";
import { buildChartCommentaryModel } from "../src/chart/commentaryModel";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import type { ActiveTradePlan } from "../src/chart/tradePlanStore";

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

const plan: ActiveTradePlan = {
  version: "active-trade-plan-v1", chartDocumentId: "doc", symbol: "AAPL", interval: "1D", direction: "long", action: "buy_candidate",
  entryPrice: 100, targetPrice: 110, stopPrice: 95, entryTrigger: 99.5, rewardRiskRatio: 2, signalAt: asset.asOf,
  patternId: "pattern", patternKind: "bullish_flag", projectionBars: 10, reasons: ["reward_risk_passed"],
  drawingIds: { plan: "chart-plan:risk", signal: "chart-plan:signal" },
  provenance: { assetVersion: "geometry", algorithmVersion: "v4", inputDigest: asset.inputDigest, asOf: asset.asOf, generatedAt: asset.generatedAt },
  status: "active"
};
const steps = buildChartCommentaryModel(asset, plan);
assert.deepEqual(steps.map((step) => step.id), ["evidence", "entry", "target", "stop", "summary"]);
assert.match(steps[1].body, /99\.50/);
assert.match(steps[2].body, /\+10\.00%/);
assert.match(steps[3].body, /-5\.00%/);
assert.deepEqual(steps[4].drawingIds, [plan.drawingIds.signal, plan.drawingIds.plan]);
assert.deepEqual(buildChartCommentaryModel(asset, null).map((step) => step.id), ["evidence", "observe"]);
