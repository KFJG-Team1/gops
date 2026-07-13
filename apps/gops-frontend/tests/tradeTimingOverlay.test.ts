import assert from "node:assert/strict";
import { buildTradeTimingDrawings } from "../src/chart/tradeTimingOverlay";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import { resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";

const candles = [0, 1, 2].map((index) => ({
  timestamp: `2026-07-13T13:${30 + index * 5}:00.000Z`,
  open: 97 + index * 0.5,
  high: 98 + index * 0.5,
  low: 96 + index * 0.5,
  close: 97.5 + index * 0.5,
  volume: 1_000,
  isClosed: true
}));

const asset = {
  assetVersion: "geometry",
  algorithmVersion: "ohlcv-consensus-pattern-families-v2",
  symbol: "AAPL",
  interval: "5m",
  sourceInterval: "5m",
  asOf: candles[2].timestamp,
  generatedAt: candles[2].timestamp,
  status: "ready",
  inputDigest: "sha256:test",
  coverage: { state: "full", targetBars: 380, actualBars: 380, contiguousBars: 380, missingBars: 0 },
  geometry: {
    drawings: [], supports: [], resistances: [], patterns: [], primaryPattern: null,
    primaryTriangle: null, historicalTriangle: null,
    tradePlan: {
      version: "pattern-trade-timing-v1",
      symbol: "AAPL",
      interval: "5m",
      patternId: "pattern-bullish-flag",
      patternKind: "bullish_flag",
      patternState: "confirmed",
      action: "buy_candidate",
      direction: "long",
      signalAt: candles[2].timestamp,
      entryTrigger: 98.25,
      entryPrice: 98.5,
      stopPrice: 97,
      targetPrice: 108,
      riskPerShare: 1.5,
      rewardPerShare: 9.5,
      rewardRiskRatio: 6.3333,
      minimumRewardRisk: 2,
      projectionBars: 10,
      reasons: ["confirmed_upward_breakout", "reward_risk_passed"]
    }
  },
  indicators: { sma60: 97, sma120: 96, cross: { status: "none" } }
} satisfies ChartAnalysisAsset;

const drawings = buildTradeTimingDrawings(asset, candles);
assert.equal(drawings.length, 2);
assert.equal(drawings[0].type, "flagMarker");
assert.equal(drawings[0].label, "매수 후보 · 상승 깃발형");
assert.equal(drawings[0].anchors[0].timestamp, candles[2].timestamp);
assert.equal(drawings[1].type, "riskRewardBox");
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.price), [98.5, 97, 108]);
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.logicalIndex), [2, 12, 12]);
assert.equal(drawings[1].anchors[1].timestamp, undefined);
assert.equal(drawings[1].anchors[2].timestamp, undefined);

const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.deepEqual(resolved?.geometry.drawings.map((drawing) => drawing.type), ["flagMarker", "riskRewardBox"]);
const resolvedAgain = resolveAnalysisAssetForCandles(resolved, candles);
assert.equal(resolvedAgain?.geometry.drawings.filter((drawing) => drawing.type === "flagMarker").length, 1);

const exitAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, action: "sell_candidate", direction: "exit_long" }
  }
};
assert.equal(buildTradeTimingDrawings(exitAsset, candles).length, 1);
assert.equal(buildTradeTimingDrawings(exitAsset, candles)[0].label, "매도·청산 후보 · 상승 깃발형");

const watchAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, action: "watch", direction: null, signalAt: null }
  }
};
assert.deepEqual(buildTradeTimingDrawings(watchAsset, candles), []);
