import assert from "node:assert/strict";
import { buildTradeTimingDrawings } from "../src/chart/tradeTimingOverlay";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import { projectChartTradeSetup } from "../src/chart/chartTradeSetup";
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

function systemLine(id: string, startPrice: number, endPrice = startPrice) {
  return {
    id: `chart-asset:AAPL:5m:${id}`,
    type: "trendLine" as const,
    anchors: [
      { timestamp: candles[0].timestamp, price: startPrice },
      { timestamp: candles[2].timestamp, price: endPrice }
    ],
    symbol: "AAPL", interval: "5m" as const, sourceInterval: "5m" as const,
    style: {}, visible: true, createdBy: "system" as const,
    sourceProposalId: "chart-asset:AAPL:5m:geometry",
    createdAt: candles[2].timestamp, updatedAt: candles[2].timestamp
  };
}

function horizontalLine(symbol: string, interval: "1D", id: string, price: number) {
  return {
    id: `chart-asset:${symbol}:${interval}:${id}`,
    type: "horizontalLine" as const,
    anchors: [
      { timestamp: candles[0].timestamp, price },
      { timestamp: candles[2].timestamp, price }
    ],
    symbol, interval, sourceInterval: interval,
    style: {}, visible: true, createdBy: "system" as const,
    sourceProposalId: `chart-asset:${symbol}:${interval}:geometry`,
    createdAt: candles[2].timestamp, updatedAt: candles[2].timestamp
  };
}

const bullishPattern = {
  id: "pattern-bullish-flag",
  kind: "bullish_flag" as const,
  state: "confirmed" as const,
  bias: "bullish" as const,
  breakoutDirection: "up" as const,
  score: .9,
  touches: 6,
  geometryHash: "pattern-bullish-flag",
  pole: { start: { timestamp: candles[0].timestamp, price: 88 }, end: { timestamp: candles[1].timestamp, price: 98 } },
  upper: { start: { timestamp: candles[0].timestamp, price: 98 }, end: { timestamp: candles[2].timestamp, price: 98 } },
  lower: { start: { timestamp: candles[0].timestamp, price: 96.5 }, end: { timestamp: candles[2].timestamp, price: 96.5 } }
};
const bullishPatternDrawings = [
  systemLine("pattern-bullish-flag-pole", 88, 98),
  systemLine("pattern-bullish-flag-upper", 98),
  systemLine("pattern-bullish-flag-lower", 96.5)
];

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
    drawings: bullishPatternDrawings, supports: [], resistances: [], patterns: [bullishPattern], primaryPattern: bullishPattern,
    drawingGroups: { levels: [], trend: [], pattern: bullishPatternDrawings.map((drawing) => drawing.id) },
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
const projectedPattern = projectChartTradeSetup(asset, candles);
assert.ok(projectedPattern);
assert.deepEqual(
  [projectedPattern.entryPrice, projectedPattern.targetPrice, projectedPattern.stopPrice],
  [98, 108, 96.5],
  "displayed prices come from one final pattern geometry instead of server close/ATR prices"
);
assert.deepEqual(projectedPattern.priceSources.entry.drawingIds, ["chart-asset:AAPL:5m:pattern-bullish-flag-upper"]);
assert.deepEqual(projectedPattern.priceSources.stop.drawingIds, ["chart-asset:AAPL:5m:pattern-bullish-flag-lower"]);
assert.deepEqual(projectedPattern.priceSources.target.drawingIds, bullishPatternDrawings.map((drawing) => drawing.id).sort());
assert.equal(drawings.length, 2);
assert.equal(drawings[0].type, "flagMarker");
assert.equal(drawings[0].label, "조건부 매수 시나리오 · 상승 깃발형");
assert.equal(drawings[0].anchors[0].timestamp, candles[1].timestamp);
assert.match(drawings[0].id, /^chart-plan:/);
assert.equal(drawings[0].style.colorToken, "bullish");
assert.equal(drawings[1].type, "riskRewardBox");
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.price), [98, 96.5, 108]);
assert.deepEqual(drawings[1].anchors.map((anchor) => anchor.logicalIndex), [1, 12, 12]);
assert.equal(drawings[1].anchors[1].timestamp, undefined);
assert.equal(drawings[1].anchors[2].timestamp, undefined);
assert.equal(drawings[1].style.zoneSplit, true);
assert.equal(drawings[1].style.labelPlacement, "none");
assert.equal(drawings[1].style.fillOpacity, .08);
assert.doesNotMatch(drawings[1].label ?? "", /진입|손절|목표/);

const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.deepEqual(
  resolved?.geometry.drawings.map((drawing) => drawing.type),
  ["trendLine", "trendLine", "trendLine", "flagMarker", "riskRewardBox"]
);
const resolvedAgain = resolveAnalysisAssetForCandles(resolved, candles);
assert.equal(resolvedAgain?.geometry.drawings.filter((drawing) => drawing.type === "flagMarker").length, 1);

const exitAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    drawings: [
      systemLine("pattern-bearish-flag-pole", 110, 100),
      systemLine("pattern-bearish-flag-upper", 100),
      systemLine("pattern-bearish-flag-lower", 98)
    ],
    patterns: [{ ...bullishPattern, id: "pattern-bearish-flag", geometryHash: "pattern-bearish-flag", kind: "bearish_flag", bias: "bearish", breakoutDirection: "down" }],
    primaryPattern: { ...bullishPattern, id: "pattern-bearish-flag", geometryHash: "pattern-bearish-flag", kind: "bearish_flag", bias: "bearish", breakoutDirection: "down" },
    drawingGroups: {
      levels: [], trend: [],
      pattern: ["pole", "upper", "lower"].map((suffix) => `chart-asset:AAPL:5m:pattern-bearish-flag-${suffix}`)
    },
    tradePlan: {
      ...asset.geometry.tradePlan!, patternId: "pattern-bearish-flag", patternKind: "bearish_flag",
      action: "sell_candidate", direction: "exit_long"
    }
  }
};
assert.equal(buildTradeTimingDrawings(exitAsset, candles).length, 0);
const projectedExit = projectChartTradeSetup(exitAsset, candles);
assert.equal(projectedExit, null, "하락 구조는 신규 매수 포지션 박스로 투영하지 않는다");

assert.equal(projectChartTradeSetup(asset, candles.map((candle, index) => (
  index === candles.length - 1 ? { ...candle, close: 109 } : candle
))), null, "a proposal disappears after current price has passed its pattern target");

const watchAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    tradePlan: { ...asset.geometry.tradePlan!, action: "watch", direction: null, signalAt: null }
  }
};
assert.deepEqual(buildTradeTimingDrawings(watchAsset, candles), []);

const simulationDemoCandles = [
  { timestamp: "2026-07-11T04:00:00.000Z", open: 188, high: 191, low: 187, close: 190, volume: 1_000, isClosed: true },
  { timestamp: "2026-07-14T04:00:00.000Z", open: 191, high: 209, low: 190, close: 208, volume: 500, isClosed: false }
];
const simulationDemoPattern = {
  id: "1D:pattern:nvda-demo-wedge",
  kind: "falling_wedge" as const,
  state: "confirmed" as const,
  bias: "bullish" as const,
  breakoutDirection: "up" as const,
  score: .8,
  touches: 5,
  geometryHash: "nvda-demo-wedge",
  upper: {
    start: { timestamp: simulationDemoCandles[0].timestamp, price: 220 },
    end: { timestamp: simulationDemoCandles[1].timestamp, price: 190 }
  },
  lower: {
    start: { timestamp: simulationDemoCandles[0].timestamp, price: 200 },
    end: { timestamp: simulationDemoCandles[1].timestamp, price: 180 }
  }
};
const simulationDemoPatternDrawingIds = ["upper", "lower"].map(
  (boundary) => `chart-asset:NVDA:1D:nvda-demo-wedge-${boundary}`
);
const simulationDemoAsset: ChartAnalysisAsset = {
  ...asset,
  symbol: "NVDA",
  interval: "1D",
  sourceInterval: "1D",
  asOf: simulationDemoCandles[1].timestamp,
  generatedAt: simulationDemoCandles[1].timestamp,
  geometry: {
    ...asset.geometry,
    drawings: simulationDemoPatternDrawingIds.map((id, index) => ({
      id,
      type: "trendLine" as const,
      anchors: index === 0
        ? [simulationDemoPattern.upper.start, simulationDemoPattern.upper.end]
        : [simulationDemoPattern.lower.start, simulationDemoPattern.lower.end],
      symbol: "NVDA",
      interval: "1D" as const,
      sourceInterval: "1D" as const,
      style: {},
      visible: true,
      createdBy: "system" as const,
      sourceProposalId: "chart-asset:NVDA:1D:geometry",
      createdAt: simulationDemoCandles[1].timestamp,
      updatedAt: simulationDemoCandles[1].timestamp
    })),
    supports: [],
    resistances: [],
    patterns: [simulationDemoPattern],
    primaryPattern: simulationDemoPattern,
    drawingGroups: { levels: [], trend: [], pattern: simulationDemoPatternDrawingIds },
    tradePlan: {
      ...asset.geometry.tradePlan!,
      symbol: "NVDA",
      interval: "1D",
      patternId: simulationDemoPattern.id,
      patternKind: "falling_wedge",
      signalAt: simulationDemoCandles[1].timestamp,
      entryPrice: 208,
      entryTrigger: 190,
      stopPrice: 180,
      targetPrice: 210,
      rewardRiskRatio: .0714,
      minimumRewardRisk: .0714,
      reasons: ["confirmed_upward_breakout", "simulation_demo_reward_risk_override"]
    }
  }
};
assert.equal(
  buildTradeTimingDrawings(simulationDemoAsset, simulationDemoCandles).length,
  2,
  "the scoped NVDA simulator demo can project its proposal on the active replay candle"
);
assert.deepEqual(
  buildTradeTimingDrawings({
    ...simulationDemoAsset,
    geometry: {
      ...simulationDemoAsset.geometry,
      tradePlan: {
        ...simulationDemoAsset.geometry.tradePlan!,
        reasons: ["confirmed_upward_breakout"]
      }
    }
  }, simulationDemoCandles),
  [],
  "ordinary confirmed plans still require a completed signal candle"
);

const levelAsset: ChartAnalysisAsset = {
  ...watchAsset,
  interval: "1D",
  sourceInterval: "1D",
  geometry: {
    ...watchAsset.geometry,
    supports: [{ id: "support", role: "support", price: 90, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 90 }] }],
    resistances: [
      { id: "resistance", role: "resistance", price: 105, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 105 }] },
      { id: "resistance-next", role: "resistance", price: 110, score: .75, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 110 }] }
    ],
    drawings: [
      horizontalLine("AAPL", "1D", "support", 90),
      horizontalLine("AAPL", "1D", "resistance", 105),
      horizontalLine("AAPL", "1D", "resistance-next", 110)
    ],
    drawingGroups: {
      levels: ["support", "resistance", "resistance-next"].map((id) => `chart-asset:AAPL:1D:${id}`),
      trend: [], pattern: []
    },
    patterns: [], primaryPattern: null, primaryTriangle: null
  }
};
const conditional = buildTradeTimingDrawings(levelAsset, candles);
assert.equal(conditional.length, 1);
assert.equal(conditional[0].type, "riskRewardBox");
assert.equal(conditional[0].style.proposalKind, "conditional");
assert.equal(conditional[0].anchors[0].timestamp, candles.at(-1)?.timestamp);
assert.equal(conditional[0].anchors[1].timestamp, undefined);
assert.deepEqual(conditional[0].anchors.map((anchor) => anchor.price), [105, 90, 110]);
const levelSetup = projectChartTradeSetup(levelAsset, candles);
assert.deepEqual(levelSetup?.priceSources, {
  entry: { label: "저항선", drawingIds: ["chart-asset:AAPL:1D:resistance"], derivation: "level" },
  target: { label: "다음 저항선", drawingIds: ["chart-asset:AAPL:1D:resistance-next"], derivation: "level" },
  stop: { label: "지지선", drawingIds: ["chart-asset:AAPL:1D:support"], derivation: "level" }
});

const sellLevelAsset: ChartAnalysisAsset = {
  ...levelAsset,
  geometry: {
    ...levelAsset.geometry,
    supports: [
      { id: "support-sell", role: "support", price: 97, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 97 }] },
      { id: "support-target", role: "support", price: 92, score: .75, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 92 }] }
    ],
    resistances: [{ id: "resistance-risk", role: "resistance", price: 105, score: .8, touches: 3, anchors: [{ timestamp: candles[0].timestamp, price: 105 }] }],
    drawings: [
      horizontalLine("AAPL", "1D", "support-sell", 97),
      horizontalLine("AAPL", "1D", "support-target", 92),
      horizontalLine("AAPL", "1D", "resistance-risk", 105)
    ],
    drawingGroups: {
      levels: ["support-sell", "support-target", "resistance-risk"].map((id) => `chart-asset:AAPL:1D:${id}`),
      trend: [], pattern: []
    }
  }
};
const sellLevelSetup = projectChartTradeSetup(sellLevelAsset, candles);
assert.equal(sellLevelSetup, null, "H-line fallback도 신규 매수 시나리오만 만든다");

const incompleteLevelAsset: ChartAnalysisAsset = {
  ...levelAsset,
  geometry: {
    ...levelAsset.geometry,
    resistances: levelAsset.geometry.resistances.slice(0, 1),
    drawings: levelAsset.geometry.drawings.filter((drawing) => !drawing.id.endsWith("resistance-next")),
    drawingGroups: { ...levelAsset.geometry.drawingGroups!, levels: levelAsset.geometry.drawingGroups!.levels.slice(0, 2) }
  }
};
assert.deepEqual(buildTradeTimingDrawings(incompleteLevelAsset, candles), [], "missing target lines do not produce a close/2R fallback");

const referenceLevelAsset: ChartAnalysisAsset = {
  ...incompleteLevelAsset,
  geometry: {
    ...incompleteLevelAsset.geometry,
    analysisTrace: {
      version: "geometry-analysis-trace-v2",
      pivots: [],
      levelCandidates: [{
        id: "candidate-resistance-next", category: "level", role: "resistance",
        selected: false, hardPass: true, evidencePass: true, activePass: true,
        score: .72, rejectReasons: [], anchors: [{ timestamp: candles[1].timestamp, price: 110 }],
        metrics: { price: 110 }
      }],
      trendCandidates: [], patternCandidates: [],
      selections: { levelCandidateIds: [], trendCandidateIds: [], patternCandidateIds: [] },
      omittedCounts: {}
    }
  }
};
const referenceSetup = projectChartTradeSetup(referenceLevelAsset, candles);
assert.equal(referenceSetup?.evidenceKind, "reference");
assert.deepEqual([referenceSetup?.entryPrice, referenceSetup?.targetPrice, referenceSetup?.stopPrice], [105, 110, 90]);
assert.equal(referenceSetup?.referenceGuides.length, 1);
assert.equal(referenceSetup?.priceSources.target.label, "후보 저항선");
const referenceDrawings = buildTradeTimingDrawings(referenceLevelAsset, candles);
assert.deepEqual(referenceDrawings.map((drawing) => drawing.type), ["horizontalLine", "riskRewardBox"]);
assert.equal(referenceDrawings[0].id, referenceSetup?.referenceGuides[0].id);

const staleReferenceAsset: ChartAnalysisAsset = {
  ...referenceLevelAsset,
  geometry: {
    ...referenceLevelAsset.geometry,
    analysisTrace: {
      ...referenceLevelAsset.geometry.analysisTrace!,
      levelCandidates: [{
        ...referenceLevelAsset.geometry.analysisTrace!.levelCandidates[0],
        rejectReasons: ["stale_candidate"]
      }]
    }
  }
};
assert.equal(projectChartTradeSetup(staleReferenceAsset, candles), null);

const trendSupportDrawing = {
  ...systemLine("trend-support", 92, 92),
  id: "chart-asset:AAPL:1D:trend-support",
  symbol: "AAPL", interval: "1D" as const, sourceInterval: "1D" as const,
  anchors: [
    { logicalIndex: 0, price: 92 },
    { logicalIndex: 2, price: 92 }
  ]
};
const trendAndPivotAsset: ChartAnalysisAsset = {
  ...incompleteLevelAsset,
  geometry: {
    ...incompleteLevelAsset.geometry,
    supports: [],
    drawings: [
      ...incompleteLevelAsset.geometry.drawings.filter((drawing) => drawing.id.endsWith(":resistance")),
      trendSupportDrawing
    ],
    drawingGroups: {
      levels: ["chart-asset:AAPL:1D:resistance"],
      trend: [trendSupportDrawing.id],
      pattern: []
    },
    trends: [{
      id: "trend-support", kind: "uptrend", direction: "up", score: .8,
      drawingId: trendSupportDrawing.id, anchors: [], anchorPivotIds: [], touchPivotIds: [], reactionPivotIds: [],
      touchCount: 3, reactionCount: 2, slopeAtrPerBar: 0, medianResidualAtr: .1,
      currentDistanceAtr: .2, lastTouchAgeBars: 1
    }],
    primaryTrend: {
      id: "trend-support", kind: "uptrend", direction: "up", score: .8,
      drawingId: trendSupportDrawing.id, anchors: [], anchorPivotIds: [], touchPivotIds: [], reactionPivotIds: [],
      touchCount: 3, reactionCount: 2, slopeAtrPerBar: 0, medianResidualAtr: .1,
      currentDistanceAtr: .2, lastTouchAgeBars: 1
    },
    analysisTrace: {
      version: "geometry-analysis-trace-v2",
      pivots: [{
        id: "pivot-high", kind: "H", timestamp: candles[1].timestamp,
        confirmedAt: candles[2].timestamp, price: 110
      }],
      levelCandidates: [], trendCandidates: [], patternCandidates: [],
      selections: { levelCandidateIds: [], trendCandidateIds: [], patternCandidateIds: [] },
      omittedCounts: {}
    }
  }
};
const trendAndPivotSetup = projectChartTradeSetup(trendAndPivotAsset, candles);
assert.deepEqual(
  [trendAndPivotSetup?.entryPrice, trendAndPivotSetup?.targetPrice, trendAndPivotSetup?.stopPrice],
  [105, 110, 92]
);
assert.equal(trendAndPivotSetup?.evidenceKind, "reference");
assert.equal(trendAndPivotSetup?.priceSources.stop.derivation, "trend");
assert.equal(trendAndPivotSetup?.priceSources.target.label, "확인된 전고점");

const channelDrawing = {
  ...systemLine("channel", 95, 95),
  id: "chart-asset:AAPL:1D:channel",
  type: "trendParallelLines" as const,
  symbol: "AAPL", interval: "1D" as const, sourceInterval: "1D" as const,
  anchors: [
    { timestamp: candles[0].timestamp, price: 95 },
    { timestamp: candles[2].timestamp, price: 95 },
    { timestamp: candles[1].timestamp, price: 105 }
  ]
};
const channelAsset: ChartAnalysisAsset = {
  ...watchAsset,
  interval: "1D", sourceInterval: "1D",
  geometry: {
    ...watchAsset.geometry,
    drawings: [channelDrawing], supports: [], resistances: [], patterns: [], primaryPattern: null,
    trends: [{
      id: "channel", kind: "channel", direction: "up", score: .8,
      drawingId: channelDrawing.id, anchors: channelDrawing.anchors,
      anchorPivotIds: [], touchPivotIds: [], reactionPivotIds: [], touchCount: 4, reactionCount: 3,
      slopeAtrPerBar: 0, medianResidualAtr: .1, currentDistanceAtr: .2, lastTouchAgeBars: 1,
      channelWidthAtr: 2, parallelSlopeError: 0, containment: .9
    }],
    primaryTrend: {
      id: "channel", kind: "channel", direction: "up", score: .8,
      drawingId: channelDrawing.id, anchors: channelDrawing.anchors,
      anchorPivotIds: [], touchPivotIds: [], reactionPivotIds: [], touchCount: 4, reactionCount: 3,
      slopeAtrPerBar: 0, medianResidualAtr: .1, currentDistanceAtr: .2, lastTouchAgeBars: 1,
      channelWidthAtr: 2, parallelSlopeError: 0, containment: .9
    },
    drawingGroups: { levels: [], trend: [channelDrawing.id], pattern: [] }
  }
};
const channelSetup = projectChartTradeSetup(channelAsset, candles);
assert.deepEqual([channelSetup?.entryPrice, channelSetup?.targetPrice, channelSetup?.stopPrice], [100, 105, 95]);
assert.equal(channelSetup?.priceSources.entry.label, "채널 중단");
assert.equal(channelSetup?.evidenceKind, "final");

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
    supports: [], resistances: [],
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
    },
    drawings: [
      { ...systemLine("amd-wedge-hash-upper", 570, 582.298117), id: "chart-asset:AMD:1D:amd-wedge-hash-upper", symbol: "AMD", interval: "1D", sourceInterval: "1D" },
      { ...systemLine("amd-wedge-hash-lower", 510, 526.15809), id: "chart-asset:AMD:1D:amd-wedge-hash-lower", symbol: "AMD", interval: "1D", sourceInterval: "1D" }
    ],
    drawingGroups: { levels: [], trend: [], pattern: ["chart-asset:AMD:1D:amd-wedge-hash-upper", "chart-asset:AMD:1D:amd-wedge-hash-lower"] }
  }
};
const amdConditional = buildTradeTimingDrawings(amdAsset, amdCandles);
assert.deepEqual(amdConditional, [], "하락 패턴은 보유분 매도 해설로만 남고 신규 포지션 박스를 만들지 않는다");

const noEvidenceAsset: ChartAnalysisAsset = {
  ...watchAsset,
  geometry: { ...watchAsset.geometry, supports: [], resistances: [], primaryPattern: null, primaryTriangle: null }
};
assert.deepEqual(buildTradeTimingDrawings(noEvidenceAsset, candles), []);
assert.deepEqual(
  buildTradeTimingDrawings(noEvidenceAsset, candles, { "1D": levelAsset }),
  [],
  "another interval is never used as a silent proposal fallback"
);
