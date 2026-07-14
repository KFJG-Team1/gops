import assert from "node:assert/strict";
import { buildTradeTimingDrawings } from "../src/chart/tradeTimingOverlay";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import { resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";
import { buildTradeScenarioPresentation } from "../src/chart/tradeScenarioPresentation";

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
  algorithmVersion: "ohlcv-consensus-pattern-families-v4",
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
      version: "pattern-trade-timing-v2",
      symbol: "AAPL",
      interval: "5m",
      patternId: "pattern-bullish-flag",
      patternKind: "bullish_flag",
      patternState: "confirmed",
      action: "buy_candidate",
      direction: "long",
      signalAt: candles[2].timestamp,
      entryTrigger: 98.25,
      confirmationConditions: [{
        direction: "up",
        boundary: "upper",
        boundaryPrice: 98,
        triggerPrice: 98.25,
        bufferAtr: 0.25,
        rule: "completed_close_above"
      }],
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
assert.equal(drawings.length, 4);
assert.equal(drawings[0].type, "rangeBox");
assert.deepEqual(drawings[0].anchors.map((anchor) => anchor.price), [98, 98.25]);
assert.equal(drawings[1].type, "trendLine");
assert.equal(drawings[1].label, "C 98.25 · 완료봉");
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.price), [98.25, 98.25]);
assert.equal(drawings[2].type, "flagMarker");
assert.equal(drawings[2].label, "매수 후보 · 돌파 확정");
assert.equal(drawings[2].anchors[0].timestamp, candles[2].timestamp);
assert.equal(drawings[3].type, "riskRewardBox");
assert.deepEqual(drawings[3].anchors.map((anchor) => anchor.price), [98.5, 97, 108]);
assert.deepEqual(drawings[3].anchors.map((anchor) => anchor.logicalIndex), [2, 12, 12]);
assert.equal(drawings[3].anchors[1].timestamp, undefined);
assert.equal(drawings[3].anchors[2].timestamp, undefined);

const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.deepEqual(resolved?.geometry.drawings.map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker", "riskRewardBox"]);
const resolvedAgain = resolveAnalysisAssetForCandles(resolved, candles);
assert.equal(resolvedAgain?.geometry.drawings.filter((drawing) => drawing.type === "flagMarker").length, 1);

const exitAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, action: "sell_candidate", direction: "exit_long" }
  }
};
assert.equal(buildTradeTimingDrawings(exitAsset, candles).length, 3);
assert.equal(buildTradeTimingDrawings(exitAsset, candles)[2].label, "보유 시 축소·청산 후보");

const watchAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: {
      ...asset.geometry.tradePlan!,
      patternState: "forming",
      action: "watch",
      direction: null,
      signalAt: null,
      entryPrice: null,
      stopPrice: null,
      targetPrice: null,
      riskPerShare: null,
      rewardPerShare: null,
      rewardRiskRatio: null
    },
    primaryPattern: { kind: "bullish_flag", state: "forming", score: .78, touches: 4, geometryHash: "flag" }
  }
};
const watchDrawings = buildTradeTimingDrawings(watchAsset, candles);
assert.deepEqual(watchDrawings.map((drawing) => drawing.type), ["rangeBox", "trendLine", "textLabel"]);
assert.equal(watchDrawings[1].label, "C 98.25 · 완료봉");
assert.equal(watchDrawings[2].label, "관찰 중 · 상승 깃발형");
assert.equal(watchDrawings.some((drawing) => drawing.type === "riskRewardBox"), false);
const watchScenario = buildTradeScenarioPresentation(watchAsset);
assert.equal(watchScenario?.available, true);
assert.equal(watchScenario?.phase, "forming");
assert.equal(watchScenario?.responseTitle, "관찰 조건");

const noTradeAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    primaryPattern: { kind: "bullish_flag", state: "confirmed", score: .81, touches: 4, geometryHash: "flag" },
    tradePlan: { ...asset.geometry.tradePlan!, action: "no_trade", direction: null, reasons: ["reward_risk_below_minimum"] }
  }
};
assert.deepEqual(buildTradeTimingDrawings(noTradeAsset, candles).map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker"]);
assert.equal(buildTradeScenarioPresentation(noTradeAsset)?.responseTitle, "신규 진입 보류");
assert.deepEqual(buildTradeScenarioPresentation(noTradeAsset)?.responseItems, []);

const v3Asset: ChartAnalysisAsset = {
  ...asset,
  algorithmVersion: "ohlcv-consensus-pattern-families-v5",
  geometry: {
    ...asset.geometry,
    primaryPattern: { kind: "bullish_flag", state: "confirmed", score: .84, touches: 4, geometryHash: "flag" },
    tradePlan: {
      ...asset.geometry.tradePlan!,
      version: "pattern-trade-timing-v3",
      phase: "confirmed",
      confirmationEvidence: {
        direction: "up", boundaryPrice: 98, triggerPrice: 98.25,
        breakoutAt: candles[2].timestamp, confirmedAt: candles[2].timestamp,
        method: "volume", volumeRatio: 1.8, requiredVolumeRatio: 1.5, holdBars: 1
      },
      entryPlan: { mode: "confirmation_close", at: candles[2].timestamp, price: 98.5 },
      stopPlan: { initialPrice: 97, activePrice: 97, basis: "breakout_boundary_atr", bufferAtr: 1 },
      targets: [
        { id: "T1", price: 100, basis: "one_r", allocationPercent: 50, rMultiple: 1 },
        { id: "T2", price: 108, basis: "measured_move", allocationPercent: 50, rMultiple: 6.3333 }
      ],
      retest: { state: "pending", at: null, zoneLow: null, zoneHigh: null, observedBars: 0, maxBars: 5 }
    }
  }
};
const v3Drawings = buildTradeTimingDrawings(v3Asset, candles);
assert.deepEqual(v3Drawings.map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker", "tradePlanBox"]);
assert.deepEqual(v3Drawings.at(-1)?.anchors.map((anchor) => anchor.price), [98.5, 97, 100, 108]);
assert.equal(v3Drawings.at(-1)?.locked, true);
assert.equal(buildTradeScenarioPresentation(v3Asset)?.confirmationSummary, "거래량 1.80×로 확정 · 기준 1.50×");

const pendingAsset: ChartAnalysisAsset = {
  ...v3Asset,
  geometry: {
    ...v3Asset.geometry,
    primaryPattern: { ...v3Asset.geometry.primaryPattern!, state: "forming" },
    tradePlan: {
      ...v3Asset.geometry.tradePlan!,
      patternState: "forming",
      action: "watch",
      direction: null,
      phase: "confirmation_pending",
      signalAt: candles[2].timestamp,
      confirmationEvidence: {
        ...v3Asset.geometry.tradePlan!.confirmationEvidence!,
        confirmedAt: null,
        method: null,
        volumeRatio: 1.2
      },
      entryPlan: null,
      stopPlan: null,
      targets: [],
      retest: null,
      entryPrice: null,
      stopPrice: null,
      targetPrice: null,
      riskPerShare: null,
      rewardPerShare: null,
      rewardRiskRatio: null
    }
  }
};
assert.deepEqual(buildTradeTimingDrawings(pendingAsset, candles).map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker"]);
assert.match(buildTradeTimingDrawings(pendingAsset, candles).at(-1)?.label ?? "", /확인 대기/);
assert.equal(buildTradeScenarioPresentation(pendingAsset)?.phaseIndex, 1);
assert.match(buildTradeScenarioPresentation(pendingAsset)?.confirmationSummary ?? "", /가격 돌파 감지/);

const retestAsset: ChartAnalysisAsset = {
  ...v3Asset,
  geometry: {
    ...v3Asset.geometry,
    tradePlan: {
      ...v3Asset.geometry.tradePlan!,
      phase: "retest_confirmed",
      entryPlan: { mode: "retest_close", at: candles[1].timestamp, price: 98 },
      retest: { state: "confirmed", at: candles[1].timestamp, zoneLow: 97.75, zoneHigh: 98.25, observedBars: 1, maxBars: 5 },
      entryPrice: 98
    }
  }
};
assert.deepEqual(buildTradeTimingDrawings(retestAsset, candles).map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker", "flagMarker", "tradePlanBox"]);
assert.equal(buildTradeTimingDrawings(retestAsset, candles)[3].label, "리테스트 확인");
assert.equal(buildTradeScenarioPresentation(retestAsset)?.phaseIndex, 2);
assert.match(buildTradeScenarioPresentation(retestAsset)?.responseDetail ?? "", /리테스트 종가 E 98.00/);

const t1Asset: ChartAnalysisAsset = {
  ...v3Asset,
  geometry: {
    ...v3Asset.geometry,
    tradePlan: {
      ...v3Asset.geometry.tradePlan!,
      phase: "t1_reached",
      stopPlan: { ...v3Asset.geometry.tradePlan!.stopPlan!, activePrice: 98.5 },
      stopPrice: 98.5
    }
  }
};
assert.deepEqual(buildTradeTimingDrawings(t1Asset, candles).map((drawing) => drawing.type), ["rangeBox", "trendLine", "flagMarker", "tradePlanBox", "horizontalLine"]);
assert.equal(buildTradeScenarioPresentation(t1Asset)?.phaseIndex, 3);
assert.match(buildTradeScenarioPresentation(t1Asset)?.invalidation ?? "", /현재 보호 98.50/);

const dailyCandles = [{ ...candles[2], timestamp: "2026-07-13T04:00:00.000Z" }];
const dailyAsset: ChartAnalysisAsset = {
  ...asset,
  interval: "1D",
  sourceInterval: "1D",
  asOf: "2026-07-13T00:00:00.000Z",
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, interval: "1D", signalAt: "2026-07-13T00:00:00.000Z" }
  }
};
assert.equal(buildTradeTimingDrawings(dailyAsset, dailyCandles).some((drawing) => drawing.type === "flagMarker"), true);
