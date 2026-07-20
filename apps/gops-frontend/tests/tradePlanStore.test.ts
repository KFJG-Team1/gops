import assert from "node:assert/strict";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import {
  clearActiveTradePlan,
  getActiveTradePlan,
  getActiveTradePlans,
  projectActiveTradePlan,
  setActiveTradePlan,
  subscribeActiveTradePlans
} from "../src/chart/tradePlanStore";

const signalAt = "2026-07-13T13:35:00.000Z";
const candles = [{ timestamp: signalAt, open: 100, high: 102, low: 99, close: 101, volume: 1, isClosed: true }];
const pattern = {
  id: "flag-1", kind: "bullish_flag" as const, state: "confirmed" as const, bias: "bullish" as const,
  breakoutDirection: "up" as const, score: .9, touches: 5, geometryHash: "flag-1",
  pole: { start: { timestamp: signalAt, price: 90 }, end: { timestamp: signalAt, price: 100.5 } },
  upper: { start: { timestamp: signalAt, price: 100.5 }, end: { timestamp: signalAt, price: 100.5 } },
  lower: { start: { timestamp: signalAt, price: 98 }, end: { timestamp: signalAt, price: 98 } }
};
const patternDrawings = [
  ["pole", 90, 100.5], ["upper", 100.5, 100.5], ["lower", 98, 98]
].map(([suffix, start, end]) => ({
  id: `chart-asset:AAPL:5m:flag-1-${suffix}`,
  type: "trendLine" as const,
  anchors: [{ timestamp: signalAt, price: Number(start) }, { timestamp: signalAt, price: Number(end) }],
  symbol: "AAPL", interval: "5m" as const, sourceInterval: "5m" as const,
  style: {}, visible: true, createdBy: "system" as const,
  sourceProposalId: "chart-asset:AAPL:5m:geometry", createdAt: signalAt, updatedAt: signalAt
}));
const asset: ChartAnalysisAsset = {
  assetVersion: "geometry",
  algorithmVersion: "ohlcv-consensus-pattern-families-v4",
  symbol: "AAPL",
  interval: "5m",
  sourceInterval: "5m",
  asOf: signalAt,
  generatedAt: signalAt,
  status: "ready",
  inputDigest: "sha256:active-plan-test",
  coverage: { state: "full", targetBars: 380, actualBars: 380, contiguousBars: 380, missingBars: 0 },
  geometry: {
    drawings: patternDrawings, supports: [], resistances: [], patterns: [pattern], primaryPattern: pattern,
    drawingGroups: { levels: [], trend: [], pattern: patternDrawings.map((drawing) => drawing.id) },
    primaryTriangle: null, historicalTriangle: null,
    tradePlan: {
      version: "pattern-trade-timing-v1", symbol: "AAPL", interval: "5m", patternId: "flag-1", patternKind: "bullish_flag",
      patternState: "confirmed", action: "buy_candidate", direction: "long", signalAt, entryTrigger: 100.5, entryPrice: 101,
      stopPrice: 98, targetPrice: 110, riskPerShare: 3, rewardPerShare: 9, rewardRiskRatio: 3, minimumRewardRisk: 2,
      projectionBars: 10, reasons: ["confirmed_upward_breakout", "reward_risk_passed"]
    }
  },
  indicators: { sma60: 100, sma120: 99, cross: { status: "none" } }
};

const first = projectActiveTradePlan(asset, candles, "doc-a", "active");
const second = projectActiveTradePlan(asset, candles, "doc-b", "stale");
assert.ok(first);
assert.ok(second);
assert.equal(first.entryPrice, 100.5);
assert.equal(first.targetPrice, 111);
assert.equal(first.stopPrice, 98);
assert.equal(first.drawingIds.plan.startsWith("chart-plan:"), true);
assert.equal(second.status, "stale");

let notifications = 0;
const unsubscribe = subscribeActiveTradePlans(() => { notifications += 1; });
setActiveTradePlan("doc-a", first);
setActiveTradePlan("doc-b", second);
assert.equal(getActiveTradePlan("doc-a")?.symbol, "AAPL");
assert.deepEqual(getActiveTradePlans().map((plan) => plan.chartDocumentId), ["doc-a", "doc-b"]);
setActiveTradePlan("doc-a", first);
assert.equal(notifications, 2);
clearActiveTradePlan("doc-a");
assert.equal(getActiveTradePlan("doc-a"), null);
assert.equal(getActiveTradePlan("doc-b")?.status, "stale");
clearActiveTradePlan("doc-b");
unsubscribe();

const originalWindow = globalThis.window;
const fakeWindow = new EventTarget();
Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
let eventDetail: { chartDocumentId: string; plan: ActiveTradePlan | null } | null = null;
fakeWindow.addEventListener("gops:trade-plan-updated", (event) => {
  eventDetail = (event as CustomEvent<{ chartDocumentId: string; plan: ActiveTradePlan | null }>).detail;
});
setActiveTradePlan("doc-event", { ...first, chartDocumentId: "doc-event" });
assert.equal(eventDetail?.chartDocumentId, "doc-event");
assert.equal(eventDetail?.plan?.entryPrice, 100.5);
clearActiveTradePlan("doc-event");
assert.equal(eventDetail?.plan, null);
if (originalWindow) Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
else Reflect.deleteProperty(globalThis, "window");

const exitAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: { ...asset.geometry, tradePlan: { ...asset.geometry.tradePlan!, action: "sell_candidate", direction: "exit_long" } }
};
assert.equal(projectActiveTradePlan(exitAsset, candles, "doc-exit", "active"), null);
assert.equal(projectActiveTradePlan(asset, [], "doc-no-signal", "active"), null);
