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
      signalAt: candles[1].timestamp,
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
assert.equal(drawings[0].anchors[0].timestamp, candles[1].timestamp);
assert.match(drawings[0].id, /^chart-plan:/);
assert.equal(drawings[0].style.colorToken, "bullish");
assert.equal(drawings[1].type, "riskRewardBox");
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.price), [98.5, 97, 108]);
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.logicalIndex), [1, 12, 12]);
assert.equal(drawings[1].anchors[1].timestamp, undefined);
assert.equal(drawings[1].anchors[2].timestamp, undefined);
assert.equal(drawings[1].style.zoneSplit, true);
assert.equal(drawings[1].style.labelPlacement, "axis");
assert.equal(drawings[1].style.fillOpacity, .08);
assert.doesNotMatch(drawings[1].label ?? "", /진입|손절|목표/);

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
assert.equal(buildTradeTimingDrawings(exitAsset, candles).length, 2);
assert.equal(buildTradeTimingDrawings(exitAsset, candles)[0].label, "매도 후보 · 상승 깃발형");
assert.equal(buildTradeTimingDrawings(exitAsset, candles)[1].style.proposalAction, "sell_candidate");

const watchAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, action: "watch", direction: null, signalAt: null }
  }
};
assert.deepEqual(buildTradeTimingDrawings(watchAsset, candles), []);

const shortAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: {
      ...asset.geometry.tradePlan!,
      action: "short_candidate",
      direction: "short",
      stopPrice: 101,
      targetPrice: 90
    }
  }
};
assert.equal(buildTradeTimingDrawings(shortAsset, candles).length, 0);

const levelAsset: ChartAnalysisAsset = {
  ...watchAsset,
  interval: "1D",
  sourceInterval: "1D",
  geometry: {
    ...watchAsset.geometry,
    supports: [{ id: "support", role: "support", price: 90, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 90 }] }],
    resistances: [{ id: "resistance", role: "resistance", price: 105, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 105 }] }]
  }
};
const conditional = buildTradeTimingDrawings(levelAsset, candles);
assert.equal(conditional.length, 1);
assert.equal(conditional[0].type, "riskRewardBox");
assert.equal(conditional[0].style.proposalKind, "conditional");
assert.equal(conditional[0].anchors[0].timestamp, candles.at(-1)?.timestamp);
assert.equal(conditional[0].anchors[1].timestamp, undefined);

const amdCandles = [
  ...candles.map((candle) => ({ ...candle, close: 535.1 })),
  { ...candles[2], timestamp: "2026-07-14T00:00:00.000Z", close: 999, isClosed: false }
];
const amdAsset: ChartAnalysisAsset = {
  ...watchAsset,
  symbol: "AMD",
  interval: "1D",
  sourceInterval: "1D",
  geometry: {
    ...watchAsset.geometry,
    supports: [],
    resistances: [{ id: "resistance-546", role: "resistance", price: 546.44, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 546.44 }] }],
    patterns: [],
    primaryPattern: {
      id: "amd-wedge",
      kind: "rising_wedge",
      state: "forming",
      bias: "bearish",
      score: .8,
      touches: 6,
      geometryHash: "amd-wedge-hash",
      upper: { start: { timestamp: candles[0].timestamp, price: 570 }, end: { timestamp: candles[2].timestamp, price: 582.298117 } },
      lower: { start: { timestamp: candles[0].timestamp, price: 510 }, end: { timestamp: candles[2].timestamp, price: 526.15809 } }
    }
  }
};
const amdConditional = buildTradeTimingDrawings(amdAsset, amdCandles);
assert.equal(amdConditional.length, 1);
assert.equal(amdConditional[0].style.proposalAction, "sell_candidate");
assert.deepEqual(amdConditional[0].anchors.map((anchor) => anchor.price), [526.15809, 546.44, 485.59427]);
assert.equal(amdConditional[0].anchors[0].logicalIndex, 2, "the projection starts at the real last completed candle");
assert.equal(amdConditional[0].anchors[0].timestamp, candles[2].timestamp);
assert.equal(amdConditional[0].anchors[1].logicalIndex, 12, "the future edge ignores an unclosed candle slot");

const noEvidenceAsset: ChartAnalysisAsset = {
  ...watchAsset,
  geometry: { ...watchAsset.geometry, supports: [], resistances: [], primaryPattern: null, primaryTriangle: null }
};
assert.deepEqual(buildTradeTimingDrawings(noEvidenceAsset, candles), []);
