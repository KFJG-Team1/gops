import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommandGroup, makeChartCommand } from "../../chart-engine/src/commands";
import { analysisAssetApplyCommands, analysisLayerOfDrawing, analysisLayerToggleCommands, defaultAnalysisLayerVisibility, hasAnalysisLayerDrawings, interpretationFinalDrawings, isChartAssetDrawing } from "../src/chart/analysisLayerController";
import {
  normalizeAnalysisAssetsResponse,
  normalizeChartCommentaryAssetResponse,
  type ChartAnalysisAsset
} from "../src/chart/analysisAssetsApi";
import { analysisTraceDataMode, analysisTraceLevelPrice, buildAnalysisTraceOverlay, selectInterpretationCandidates, type AnalysisTraceOverlayCandidate } from "../src/chart/analysisTraceOverlay";
import { analysisAssetFreshness, analysisAssetPresentationDiagnostics, candleKeyForTimestamp, detectedPatternSummary, formatDetectedPattern, isAnalysisAssetStale, resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";
import { buildPatternSymbolGroups, filterPatternSymbolGroups } from "../src/chart/patternAssetList";
import type { ChartAssetCoverageItem } from "../src/chart/assetBuildApi";
import { defaultChartAssetBuildIntervals } from "../src/chart/chartAssetBuildPolicy";
import {
  clearChartCommentaryInteraction,
  getChartCommentaryInteractionSnapshot,
  subscribeChartCommentaryInteraction,
  updateChartCommentaryInteraction
} from "../src/chart/chartCommentaryInteractionStore";
import type { DrawingEntity } from "../src/chart/types";

const now = "2026-07-10T20:00:00.000Z";
const previous = "2026-07-09T20:00:00.000Z";
const target = { panelId: "panel-analysis", chartDocumentId: "doc-analysis" };
const upper: DrawingEntity = {
  id: "chart-asset:AAPL:1D:triangle-upper", type: "trendLine",
  anchors: [{ timestamp: now, price: 180 }, { timestamp: "2026-07-11T20:00:00.000Z", price: 180 }],
  symbol: "AAPL", interval: "1D", sourceInterval: "1D", style: { color: "#22c55e", opacity: .58 }, label: "상승 삼각형 · 형성 중",
  locked: false, visible: true, createdBy: "system", sourceProposalId: "chart-asset:AAPL:1D:geometry",
  createdAt: now, updatedAt: now
};
const lower: DrawingEntity = { ...upper, id: "chart-asset:AAPL:1D:triangle-lower", anchors: [{ timestamp: now, price: 160 }, { timestamp: "2026-07-11T20:00:00.000Z", price: 170 }] };
const asset: ChartAnalysisAsset = {
  assetVersion: "geometry", algorithmVersion: "ohlcv-consensus-1", symbol: "AAPL", interval: "1D", sourceInterval: "1D",
  asOf: "2026-07-11T20:00:00.000Z", generatedAt: now, status: "ready", inputDigest: "sha256:test",
  coverage: { state: "full", targetBars: 380, actualBars: 380, contiguousBars: 380, missingBars: 0 },
  geometry: {
    drawings: [upper, lower], supports: [], resistances: [],
    primaryTriangle: { kind: "ascending_triangle", state: "forming", score: .92, touches: 5, geometryHash: "triangle" },
    historicalTriangle: null
  },
  indicators: { sma60: 170, sma120: 165, cross: { status: "crossed", direction: "golden", timestamp: now, previousTimestamp: previous, barsAgo: 1, fraction: .25, price: 172.125 } }
};
const candles = [
  { timestamp: previous, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: now, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: "2026-07-11T20:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
];
const allEvidenceVisible = {
  ...defaultAnalysisLayerVisibility,
  levels: true,
  trend: true,
  pattern: true,
  proposal: true
};

assert.equal(isChartAssetDrawing(upper), true);
assert.equal(candleKeyForTimestamp("2026-07-06T00:00:00.000Z", "1W"), "2026-07-06");
assert.equal(candleKeyForTimestamp("2026-07-10T13:35:00.000Z", "5m"), "2026-07-10T13:35:00.000Z");
assert.deepEqual(detectedPatternSummary(asset), { kind: "ascending_triangle", state: "forming", score: .92, drawingCount: 2 });
const flagPattern = { kind: "bullish_flag" as const, state: "confirmed" as const, score: .88, touches: 4, geometryHash: "flag" };
const genericPatternAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    drawings: [{ ...upper, id: "chart-asset:AAPL:1D:flag-pole" }, { ...upper, id: "chart-asset:AAPL:1D:flag-upper" }, { ...lower, id: "chart-asset:AAPL:1D:flag-lower" }],
    patterns: [flagPattern],
    primaryPattern: flagPattern,
    primaryTriangle: null
  }
};
assert.deepEqual(detectedPatternSummary(genericPatternAsset), { kind: "bullish_flag", state: "confirmed", score: .88, drawingCount: 3 });
assert.equal(formatDetectedPattern(flagPattern), "상승 깃발형 · 돌파 확인");
assert.equal(formatDetectedPattern(null), "감지 없음");
assert.equal(formatDetectedPattern({ kind: "future_pattern", state: "forming" }), "future_pattern · 형성 중");
assert.equal(isAnalysisAssetStale(asset.asOf, candles, "geometry", "1D"), false);
assert.equal(isAnalysisAssetStale(asset.asOf, [{ ...candles[0], timestamp: "2026-07-14T20:00:00.000Z", isClosed: undefined } as unknown as typeof candles[number]], "geometry", "1D"), false);

const patternCoverage: ChartAssetCoverageItem[] = [
  { symbol: "MSFT", interval: "1D", generatedAt: "2026-07-10T20:00:00.000Z", status: "ready", primaryPattern: { kind: "bearish_flag", state: "forming", score: .95 } },
  { symbol: "aapl", interval: "1m", generatedAt: "2026-07-10T21:00:00.000Z", status: "ready", primaryPattern: { kind: "bullish_flag", state: "forming", score: .91 } },
  { symbol: "AAPL", interval: "1D", generatedAt: "2026-07-10T22:00:00.000Z", status: "ready", primaryPattern: { kind: "ascending_triangle", state: "confirmed", score: .80 } },
  { symbol: "NVDA", interval: "4h", generatedAt: "2026-07-10T19:00:00.000Z", status: "ready", primaryPattern: { kind: "falling_wedge", state: "confirmed", score: .70 } },
  { symbol: "META", interval: "1D", generatedAt: "2026-07-10T18:00:00.000Z", status: "ready", primaryPattern: { kind: "rising_wedge", state: "inactive", score: .99 } },
  { symbol: "AMZN", interval: "1D", generatedAt: "2026-07-10T18:00:00.000Z", status: "ready", primaryPattern: { kind: "bullish_rectangle", state: "invalidated", score: .99 } },
  { symbol: "GOOG", interval: "1D", generatedAt: "2026-07-10T18:00:00.000Z", status: "ready", primaryPattern: null }
];
const patternGroups = buildPatternSymbolGroups(patternCoverage);
assert.deepEqual(patternGroups.map((group) => group.symbol), ["AAPL", "NVDA", "MSFT"]);
assert.deepEqual(patternGroups[0]?.patterns.map((pattern) => pattern.interval), ["1D", "1m"]);
assert.deepEqual(buildPatternSymbolGroups([]), []);
const filteredPatternGroups = filterPatternSymbolGroups(patternGroups, {
  search: "aa",
  interval: "1m",
  state: "forming",
  kind: "bullish_flag"
});
assert.deepEqual(filteredPatternGroups.map((group) => ({
  symbol: group.symbol,
  patterns: group.patterns.map((pattern) => `${pattern.interval}:${pattern.primaryPattern.kind}`)
})), [{ symbol: "AAPL", patterns: ["1m:bullish_flag"] }]);

const normalized = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": asset, "1M": asset } }, "AAPL");
assert.equal(normalized.assets["1D"]?.assetVersion, "geometry");
assert.equal("1M" in normalized.assets, false);
const commentaryAsset = {
  ...asset,
  commentary: {
    version: "chart-commentary.v1", status: "ready", generatedAt: now, model: "fixture-model",
    promptVersion: "chart-commentary.ko.v1",
    sourceIdentity: {
      geometryInputDigest: asset.inputDigest, candlesAsOf: asset.asOf, indicatorsAsOf: asset.asOf,
      contextDigest: "sha256:context"
    },
    blocks: ["overview", "drawing_guide", "indicator_context", "event_context", "watch_next"].map((kind, index) => ({
      id: `block-${index}`, kind, text: "저장된 사실 기반 해설", referenceIds: ["drawing:pattern"]
    })),
    indicatorRecommendations: [{
      layer: "rsi:14", label: "상대강도지수", reason: "가격 강도 확인", referenceIds: ["drawing:pattern"]
    }],
    references: [{ id: "drawing:pattern", type: "drawing", drawingIds: [upper.id, lower.id] }],
    limitations: []
  }
};
const normalizedCommentary = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": commentaryAsset } }, "AAPL").assets["1D"];
assert.equal(normalizedCommentary?.commentary?.promptVersion, "chart-commentary.ko.v1");
const commentaryV2Asset = {
  ...asset,
  commentary: {
    version: "chart-commentary.v2", status: "ready", generatedAt: now, model: "fixture-model",
    promptVersion: "chart-commentary.ko.v2",
    sourceIdentity: commentaryAsset.commentary.sourceIdentity,
    paragraphs: [
      { id: "structure", segments: [
        { id: "structure-text", text: "현재 구조는 " },
        { id: "structure-link", text: "최종 패턴 작도", link: { kind: "drawing", referenceIds: ["drawing:pattern"] } },
        { id: "structure-close", text: "를 중심으로 읽습니다." }
      ] },
      { id: "confirmation", segments: [
        { id: "candle-link", text: "최근 완료 봉", link: { kind: "candle", referenceId: "candle:latest" } },
        { id: "confirmation-text", text: "과 " },
        { id: "indicator-link", text: "상대강도지수", link: { kind: "indicator", layer: "rsi:14", referenceIds: ["candle:previous"] } },
        { id: "confirmation-close", text: "를 함께 확인합니다." }
      ] },
      { id: "context", segments: [
        { id: "context-text", text: "다음 완료 봉이 경계 안팎에서 마감하는지를 이어서 관찰합니다." }
      ] }
    ],
    indicatorRecommendations: [{
      layer: "rsi:14", label: "상대강도지수", reason: "가격 강도 확인", referenceIds: ["candle:previous"]
    }],
    references: [
      { id: "drawing:pattern", type: "drawing", drawingIds: [upper.id, lower.id] },
      { id: "candle:latest", type: "candle", timestamp: asset.asOf, candleKey: asset.asOf.slice(0, 10) },
      { id: "candle:previous", type: "candle", timestamp: now, candleKey: now.slice(0, 10) }
    ],
    limitations: []
  }
};
const normalizedCommentaryV2 = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": commentaryV2Asset } }, "AAPL").assets["1D"];
assert.equal(normalizedCommentaryV2?.commentary?.promptVersion, "chart-commentary.ko.v2");
assert.equal(normalizedCommentaryV2?.commentary?.version, "chart-commentary.v2");
const lightweightCommentary = normalizeChartCommentaryAssetResponse({
  symbol: "AAPL",
  interval: "1D",
  asset: {
    assetVersion: commentaryV2Asset.assetVersion,
    algorithmVersion: commentaryV2Asset.algorithmVersion,
    asOf: commentaryV2Asset.asOf,
    generatedAt: commentaryV2Asset.generatedAt,
    inputDigest: commentaryV2Asset.inputDigest,
    drawingIds: commentaryV2Asset.geometry.drawings.map((drawing) => drawing.id),
    commentary: commentaryV2Asset.commentary
  }
}, "AAPL", "1D");
assert.equal(lightweightCommentary.asset?.commentary?.promptVersion, "chart-commentary.ko.v2");
assert.deepEqual(lightweightCommentary.asset?.drawingIds, [upper.id, lower.id]);
const commentaryV3Asset = structuredClone(commentaryV2Asset);
commentaryV3Asset.commentary.promptVersion = "chart-commentary.ko.v3";
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": commentaryV3Asset } }, "AAPL").assets["1D"]?.commentary?.promptVersion,
  "chart-commentary.ko.v3"
);
const commentaryV4Asset = structuredClone(commentaryV2Asset);
commentaryV4Asset.commentary.promptVersion = "chart-commentary.ko.v4";
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": commentaryV4Asset } }, "AAPL").assets["1D"]?.commentary?.promptVersion,
  "chart-commentary.ko.v4"
);
const legacyThreeIndicatorAsset: any = structuredClone(commentaryV2Asset);
legacyThreeIndicatorAsset.commentary.promptVersion = "chart-commentary.ko.v3";
legacyThreeIndicatorAsset.commentary.paragraphs[1].segments.splice(-1, 0,
  { id: "volume-link", text: "거래량", link: { kind: "indicator", layer: "volume", referenceIds: ["candle:previous"] } },
  { id: "macd-link", text: "MACD", link: { kind: "indicator", layer: "macd:12:26:9", referenceIds: ["candle:previous"] } }
);
legacyThreeIndicatorAsset.commentary.indicatorRecommendations.push(
  { layer: "volume", label: "거래량", reason: "수급 확인", referenceIds: ["candle:previous"] },
  { layer: "macd:12:26:9", label: "MACD", reason: "추세 강도 확인", referenceIds: ["candle:previous"] }
);
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": legacyThreeIndicatorAsset } }, "AAPL").assets["1D"]?.commentary?.promptVersion,
  "chart-commentary.ko.v3"
);
const invalidV4ThreeIndicatorAsset: any = structuredClone(legacyThreeIndicatorAsset);
invalidV4ThreeIndicatorAsset.commentary.promptVersion = "chart-commentary.ko.v4";
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": invalidV4ThreeIndicatorAsset } }, "AAPL").assets["1D"]?.commentary,
  undefined
);
const commentaryV5Asset: any = structuredClone(commentaryV2Asset);
commentaryV5Asset.commentary.promptVersion = "chart-commentary.ko.v5";
commentaryV5Asset.commentary.paragraphs[1].segments.splice(-1, 0,
  { id: "volume-profile-link", text: "Volume Profile", link: { kind: "indicator", layer: "volume-profile", referenceIds: ["candle:previous"] } },
  { id: "bollinger-link", text: "볼린저 밴드", link: { kind: "indicator", layer: "bollinger:20:2", referenceIds: ["candle:previous"] } }
);
commentaryV5Asset.commentary.indicatorRecommendations.push(
  { layer: "volume-profile", label: "거래량 프로파일", reason: "가격 분포 확인", referenceIds: ["candle:previous"] },
  { layer: "bollinger:20:2", label: "볼린저 밴드", reason: "변동성 확인", referenceIds: ["candle:previous"] }
);
commentaryV5Asset.commentary.references.push({
  id: "news:latest", type: "news", eventId: "news:AAPL:2026-07-10", marketDate: "2026-07-10"
});
commentaryV5Asset.commentary.paragraphs[2].segments.unshift({
  id: "news-link", text: "최근 뉴스", link: { kind: "news", referenceId: "news:latest" }
});
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": commentaryV5Asset } }, "AAPL").assets["1D"]?.commentary?.promptVersion,
  "chart-commentary.ko.v5"
);
const invalidV5VolumeAsset: any = structuredClone(commentaryV5Asset);
invalidV5VolumeAsset.commentary.paragraphs[1].segments.find((segment: any) => segment.id === "volume-profile-link").link.layer = "volume";
invalidV5VolumeAsset.commentary.indicatorRecommendations.find((item: any) => item.layer === "volume-profile").layer = "volume";
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": invalidV5VolumeAsset } }, "AAPL").assets["1D"]?.commentary,
  undefined
);
const invalidV5SevenLinks: any = structuredClone(commentaryV5Asset);
invalidV5SevenLinks.commentary.references.push({
  id: "candle:extra", type: "candle", timestamp: previous, candleKey: previous.slice(0, 10)
});
invalidV5SevenLinks.commentary.paragraphs[2].segments.push({
  id: "extra-candle-link", text: "이전 완료 봉", link: { kind: "candle", referenceId: "candle:extra" }
});
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": invalidV5SevenLinks } }, "AAPL").assets["1D"]?.commentary,
  undefined
);

let interactionNotifications = 0;
const stopInteractionSubscription = subscribeChartCommentaryInteraction("doc-commentary", () => {
  interactionNotifications += 1;
});
updateChartCommentaryInteraction("doc-commentary", {
  activeCandleKey: "2026-07-10",
  activeEventId: "news:AAPL:2026-07-10",
  candleSelectionAvailable: true,
  indicatorStatuses: { "volume-profile": "loading", "rsi:14": "ready" }
});
assert.deepEqual(getChartCommentaryInteractionSnapshot("doc-commentary"), {
  activeCandleKey: "2026-07-10",
  activeEventId: "news:AAPL:2026-07-10",
  candleSelectionAvailable: true,
  indicatorStatuses: { "volume-profile": "loading", "rsi:14": "ready" }
});
assert.equal(interactionNotifications, 1);
clearChartCommentaryInteraction("doc-commentary");
assert.equal(getChartCommentaryInteractionSnapshot("doc-commentary").activeEventId, null);
stopInteractionSubscription();
const sharedIndicatorEvidence = structuredClone(commentaryV2Asset);
sharedIndicatorEvidence.commentary.paragraphs[1]!.segments[2]!.link = {
  kind: "indicator", layer: "rsi:14", referenceIds: ["candle:latest"]
};
sharedIndicatorEvidence.commentary.indicatorRecommendations[0]!.referenceIds = ["candle:latest"];
assert.equal(
  normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": sharedIndicatorEvidence } }, "AAPL").assets["1D"]?.commentary?.version,
  "chart-commentary.v2"
);
const mismatchedIndicatorLink = {
  ...commentaryV2Asset,
  commentary: { ...commentaryV2Asset.commentary, indicatorRecommendations: [] }
};
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": mismatchedIndicatorLink } }, "AAPL").assets["1D"]?.commentary, undefined);
const malformedCommentary = { ...commentaryAsset, commentary: { ...commentaryAsset.commentary, references: [] } };
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": malformedCommentary } }, "AAPL").assets["1D"]?.commentary, undefined);
const mismatchedCommentaryDigest = {
  ...commentaryAsset,
  commentary: {
    ...commentaryAsset.commentary,
    sourceIdentity: { ...commentaryAsset.commentary.sourceIdentity, geometryInputDigest: "sha256:other" }
  }
};
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": mismatchedCommentaryDigest } }, "AAPL").assets["1D"]?.commentary, undefined);
const danglingCommentaryDrawing = {
  ...commentaryAsset,
  commentary: {
    ...commentaryAsset.commentary,
    references: [{ id: "drawing:pattern", type: "drawing", drawingIds: ["missing-drawing"] }]
  }
};
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": danglingCommentaryDrawing } }, "AAPL").assets["1D"]?.commentary, undefined);
const mixedInterval = { ...asset, geometry: { ...asset.geometry, drawings: [{ ...upper, interval: "1W" }] } };
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": mixedInterval } }, "AAPL").assets["1D"], null);
const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.equal(resolved?.geometry.drawings.length, 3);
const resolvedPatternUpper = resolved?.geometry.drawings.find((drawing) => drawing.id === upper.id);
assert.equal(resolvedPatternUpper?.style.lineWidth, 3);
assert.equal(resolvedPatternUpper?.style.opacity, .88);
assert.equal(resolvedPatternUpper?.style.fillOpacity, .04);
assert.equal(resolvedPatternUpper?.style.colorToken, "evidencePattern");
assert.equal(resolvedPatternUpper?.style.color, undefined);
assert.equal(resolvedPatternUpper?.style.labelPlacement, "none");
assert.equal(resolved?.geometry.drawings.find((drawing) => drawing.id === lower.id)?.style.labelPlacement, "none");
const resolvedFlag = resolveAnalysisAssetForCandles(genericPatternAsset, candles);
assert.deepEqual(
  resolvedFlag?.geometry.drawings.filter((drawing) => drawing.id.includes(":flag-")).map((drawing) => [drawing.id.split("-").at(-1), drawing.style.labelPlacement]),
  [["pole", "none"], ["upper", "none"], ["lower", "none"]]
);
assert.equal(resolveAnalysisAssetForCandles({
  ...asset,
  geometry: {
    ...asset.geometry,
    primaryTriangle: { ...asset.geometry.primaryTriangle!, state: "confirmed" }
  }
}, candles)?.geometry.drawings.find((drawing) => drawing.id === upper.id)?.style.opacity, .94);
const goldenCrossDrawing = resolved?.geometry.drawings.find((drawing) => drawing.id.includes(":sma-cross:"));
assert.equal(goldenCrossDrawing?.type, "flagMarker");
assert.equal(goldenCrossDrawing?.label, "골든크로스 · SMA60/120");
assert.equal(goldenCrossDrawing?.anchors[0]?.timestamp, undefined);
assert.equal(goldenCrossDrawing?.anchors[0]?.logicalIndex, .25);
assert.equal(goldenCrossDrawing?.anchors[0]?.price, 172.125);
assert.equal(resolveAnalysisAssetForCandles(resolved, candles)?.geometry.drawings.filter((drawing) => drawing.id.includes(":sma-cross:")).length, 1);
const legacyCrossAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: { ...asset.geometry, drawings: [] },
  indicators: { ...asset.indicators, cross: { status: "crossed", direction: "golden", timestamp: now, barsAgo: 1 } }
};
assert.equal(resolveAnalysisAssetForCandles(legacyCrossAsset, candles)?.geometry.drawings.length, 0);
const deadCrossAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: { ...asset.geometry, drawings: [] },
  indicators: { ...asset.indicators, cross: { status: "crossed", direction: "dead", timestamp: now, barsAgo: 1, fraction: .75, price: 168.75 } }
};
const deadCrossDrawing = resolveAnalysisAssetForCandles(deadCrossAsset, candles)?.geometry.drawings[0];
assert.equal(deadCrossDrawing?.label, "데드크로스 · SMA60/120");
assert.equal(deadCrossDrawing?.style.color, undefined);
assert.equal(deadCrossDrawing?.style.colorToken, "evidencePattern");
assert.equal(deadCrossDrawing?.anchors[0]?.logicalIndex, .75);
assert.equal(deadCrossDrawing?.anchors[0]?.price, 168.75);
assert.equal(resolveAnalysisAssetForCandles(asset, [])?.geometry.drawings.length, 0);
assert.equal(analysisAssetPresentationDiagnostics(asset, candles, [upper.id, lower.id]).state, "ready");
const stale = analysisAssetPresentationDiagnostics(asset, [...candles, { ...candles[0], timestamp: "2026-07-14T20:00:00.000Z" }]);
assert.equal(stale.state, "outdated_snapshot");
assert.equal(stale.outdated, true);
assert.equal(stale.freshness.lagBars, 1);
assert.equal(stale.resolvedAsset.geometry.drawings[0].style.opacity, .88);
const sourceInvalidAsset: ChartAnalysisAsset = {
  ...asset,
  coverage: { ...asset.coverage, lastActualClosedAt: previous }
};
const sourceInvalid = analysisAssetPresentationDiagnostics(sourceInvalidAsset, candles);
assert.equal(sourceInvalid.state, "source_invalid");
assert.equal(sourceInvalid.stale, true);
assert.equal(sourceInvalid.resolvedAsset.geometry.drawings[0].style.opacity, .60);
assert.equal(analysisAssetFreshness(sourceInvalidAsset, candles).reason, "coverage_watermark_mismatch");

const userDrawing: DrawingEntity = { ...upper, id: "user", sourceProposalId: undefined, createdBy: "user" };
const commands = analysisAssetApplyCommands(target, [userDrawing], resolved, allEvidenceVisible, { mode: "pan" });
assert.equal(commands.filter((command) => command.type === "chart.drawing.add").length, 3);
assert.ok(commands.some((command) => command.type === "chart.drawing.add" && command.payload.drawing?.label === "골든크로스 · SMA60/120"));
assert.equal(commands.filter((command) => command.type === "chart.layer.visibility.set").length, 0);
assert.equal(analysisLayerToggleCommands(target, [], resolved!, "pattern", true).length, 2);
assert.equal(analysisLayerToggleCommands(target, [], resolved!, "trend", true).length, 1, "trend only adds its analysis event drawing");

const document = createChartDocument(target.chartDocumentId, "AAPL", "1D");
const result = executeChartCommandGroup(document, commands, "Apply Geometry asset");
assert.equal(result.ok, true);
if (!result.ok) assert.fail(result.message);
const hiddenResult = executeChartCommandGroup(
  result.document,
  [
    ...analysisLayerToggleCommands(target, result.document.drawings, resolved!, "pattern", false),
    ...analysisLayerToggleCommands(target, result.document.drawings, resolved!, "trend", false)
  ],
  "Hide Geometry asset"
);
assert.equal(hiddenResult.ok, true);
if (!hiddenResult.ok) assert.fail(hiddenResult.message);
assert.equal(hiddenResult.document.drawings.filter(isChartAssetDrawing).every((drawing) => drawing.visible === false), true);
const lockedDrawing = hiddenResult.document.drawings.find((drawing) => drawing.locked);
assert.ok(lockedDrawing);
const userLockedUpdate = executeChartCommandGroup(hiddenResult.document, [
  makeChartCommand("chart.drawing.update", "user", target, {
    drawingId: lockedDrawing!.id,
    drawingPatch: { visible: true }
  })
], "User updates locked Geometry drawing");
assert.equal(userLockedUpdate.ok, false);

const support: DrawingEntity = {
  ...upper,
  id: "chart-asset:AAPL:1D:support",
  type: "horizontalLine",
  anchors: [
    { timestamp: "2026-01-23T05:00:00.000Z", price: 245.7 },
    { timestamp: "2026-04-07T04:00:00.000Z", price: 245.7 }
  ],
  label: "지지"
};
const levelAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    drawings: [support],
    supports: [{ id: "support", role: "support", price: 245.7, zoneLow: 244.9, zoneHigh: 246.5, halfWidthAtr: .4, score: .9, touches: 3, anchors: support.anchors as Array<{ timestamp: string; price: number }> }],
    primaryTriangle: null
  },
  indicators: { ...asset.indicators, cross: { status: "none", direction: null } }
};
const projectedLevelAsset = resolveAnalysisAssetForCandles(levelAsset, candles);
assert.equal(projectedLevelAsset?.geometry.drawings.length, 1);
assert.equal(projectedLevelAsset?.geometry.drawings[0]?.type, "horizontalLine");
assert.deepEqual(projectedLevelAsset?.geometry.drawings[0]?.style.lineDash, undefined);
assert.equal(projectedLevelAsset?.geometry.drawings[0]?.style.colorToken, "evidenceSupport");
assert.equal(projectedLevelAsset?.geometry.drawings[0]?.style.lineWidth, 2.5);
assert.equal(projectedLevelAsset?.geometry.drawings[0]?.style.labelPlacement, "axis");
assert.deepEqual(interpretationFinalDrawings(projectedLevelAsset!), [{
  drawingId: support.id,
  category: "levels",
  tone: "support"
}]);
assert.deepEqual(projectedLevelAsset?.geometry.drawings[0]?.anchors.map((anchor) => anchor.price), [245.7, 245.7]);
assert.deepEqual(
  projectedLevelAsset?.geometry.drawings[0]?.anchors.map((anchor) => anchor.timestamp),
  [candles[0]?.timestamp, candles[candles.length - 1]?.timestamp]
);
assert.equal(resolved?.geometry.drawings.find((drawing) => drawing.type === "trendLine")?.style.lineDash, undefined);
assert.equal(analysisAssetPresentationDiagnostics(levelAsset, candles, [support.id]).state, "ready");
const levelCommands = analysisAssetApplyCommands(target, [], projectedLevelAsset, allEvidenceVisible, { mode: "pan" });
const levelResult = executeChartCommandGroup(document, levelCommands, "Apply Geometry level asset");
assert.equal(levelResult.ok, true);
assert.equal(levelResult.document.drawings[0]?.anchors.length, 2);

assert.deepEqual(defaultChartAssetBuildIntervals("5m"), ["1m", "1D"]);
assert.deepEqual(defaultChartAssetBuildIntervals("1D"), ["1m", "1D"]);
assert.deepEqual(defaultChartAssetBuildIntervals("1M"), ["1m", "1D"]);

const opsSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAssetOpsPanel.tsx", import.meta.url)), "utf-8");
const presentationSource = readFileSync(fileURLToPath(new URL("../src/chart/analysisAssetPresentation.ts", import.meta.url)), "utf-8");
const globalStylesSource = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf-8");
const chartFeatureStylesSource = readFileSync(fileURLToPath(new URL("../src/chart-features.css", import.meta.url)), "utf-8");
const semanticCatalogSource = readFileSync(fileURLToPath(new URL("../../../shared/chart-contract/chart-semantics.ko.json", import.meta.url)), "utf-8");
assert.match(opsSource, /\["1m", "5m", "10m", "1h", "4h", "1D", "1W"\]/);
assert.match(opsSource, /\["1m", "1D"\]/);
assert.match(opsSource, /defaultChartAssetBuildIntervals\(currentInterval\)/);
assert.doesNotMatch(opsSource, /LLM 포함|EventSource|1M/);
assert.match(opsSource, /작도 자산 생성·갱신/);
assert.match(opsSource, /force: true/);
assert.match(opsSource, /저장 해설 없음 · Rule-based fallback/);
assert.match(opsSource, /기존 자산 유지됨/);
assert.match(opsSource, /생성 가능한 기존 자산 없음/);
assert.doesNotMatch(opsSource, /없는 자산 생성|기존 자산 강제 재생성|실패분 강제 재실행|useSp500|전체 S&amp;P500/);
assert.match(opsSource, /SMA120/);
assert.match(presentationSource, /chartSemanticCatalog\.patterns/);
const removedGeometryColorLiterals = ["#a78" + "bfa", "#d4" + "a65a", "trend" + "FallbackColor"];
removedGeometryColorLiterals.forEach((literal) => assert.equal(presentationSource.toLowerCase().includes(literal.toLowerCase()), false));
assert.match(globalStylesSource, /--color-evidence-pattern:\s*color-mix\(in srgb, var\(--color-drawing\) 70%, var\(--color-axis\)\)/);
assert.match(globalStylesSource, /--color-evidence-support:\s*color-mix\(in srgb, var\(--color-up\) 18%, var\(--color-axis\)\)/);
assert.match(globalStylesSource, /--color-evidence-resistance:\s*color-mix\(in srgb, var\(--color-down\) 18%, var\(--color-axis\)\)/);
assert.match(globalStylesSource, /--color-evidence-trend:\s*var\(--color-axis\)/);
assert.match(globalStylesSource, /--color-ma20:\s*var\(--color-point-purple\)/);
removedGeometryColorLiterals.forEach((literal) => assert.equal(globalStylesSource.toLowerCase().includes(literal.toLowerCase()), false));
assert.match(semanticCatalogSource, /상승 페넌트/);
assert.match(opsSource, /<th>감지 패턴<\/th>/);
assert.match(opsSource, /formatDetectedPattern\(item\.primaryPattern\)/);
const commentarySource = readFileSync(fileURLToPath(new URL("../src/components/ChartCommentaryPanel.tsx", import.meta.url)), "utf-8");
assert.match(commentarySource, /<StockLogo symbol=\{normalizedSymbol\}[^>]*className="chart-commentary-source-logo"/);
assert.match(commentarySource, /className="chart-commentary-source-identity"/);
assert.match(commentarySource, /buildChartCommentaryViewModel/);
assert.match(commentarySource, /aria-pressed=\{pinned\}/);
assert.match(commentarySource, /수치 근거 자세히/);
assert.match(commentarySource, /candidateIds/);
assert.match(commentarySource, /evidenceRefs/);
assert.match(commentarySource, /chart-commentary-metric-card/);
assert.match(commentarySource, /storedCommentary\?\.status === "ready"/);
assert.match(commentarySource, /interactionsReady/);
assert.match(commentarySource, /종합 해설 준비 중/);
assert.match(commentarySource, /title=\{!interactionsReady[\s\S]*?"차트 준비 중"/);
assert.doesNotMatch(commentarySource, /차트 로드 후 작도·해설을 불러옵니다/);
assert.match(commentarySource, /dispatchChartCommentaryIndicatorToggle/);
assert.match(commentarySource, /dispatchChartCommentaryReferenceOpen/);
assert.match(commentarySource, /chart-commentary-inline-reference/);
assert.match(commentarySource, /subscribeChartCommentaryInteraction/);
assert.match(commentarySource, /aria-busy=\{runtimeStatus === "loading"/);
assert.match(commentarySource, /aria-pressed=\{active\}/);
assert.match(commentarySource, /data-chart-commentary-event-trigger/);
assert.match(commentarySource, /collapsedLinkSegments/);
assert.match(commentarySource, /종합 해설 보기/);
assert.match(commentarySource, /종합 해설 접기/);
assert.match(commentarySource, /aria-expanded=\{expanded\}/);
assert.match(commentarySource, /commentary\.sourceIdentity\.contextDigest, chartDocumentId, symbol, interval/);
assert.doesNotMatch(commentarySource, /chart-commentary-reference-tags|chart-commentary-reference-tag/);
assert.match(chartFeatureStylesSource, /\.chart-commentary-inline-reference[\s\S]*color: var\(--color-signal\)/);
assert.match(chartFeatureStylesSource, /\.chart-commentary-inline-reference\[aria-pressed="true"\][\s\S]*text-decoration-thickness: 2px/);
assert.match(chartFeatureStylesSource, /\.chart-commentary-generated\.is-collapsed \.chart-commentary-inline-reference[\s\S]*color: var\(--color-text\)/);
assert.match(chartFeatureStylesSource, /\.chart-commentary-disclosure[\s\S]*font: var\(--type-caption\)/);
assert.match(commentarySource, /usePortfolioHoldingsData\(undefined, "kis"\)/);
assert.match(commentarySource, /latestSimulatorStatus\(\)/);
assert.match(commentarySource, /simulatorStatus\?\.mode === "simulation"/);
assert.match(commentarySource, /simulationActive \|\| holdings\.loading \|\| holdings\.error \? null : holding/);
assert.match(commentarySource, /holdingsLoading=\{simulationActive \? false : holdings\.loading\}/);
assert.match(commentarySource, /<HoldingSummary/);
assert.match(commentarySource, /aria-label="실계좌 보유 현황"/);
assert.match(commentarySource, /<th>보유 상태<\/th><th>평균 매입가<\/th><th>보유 수량<\/th>/);
assert.match(commentarySource, /buildChartCommentaryViewModel\(diagnostics\.resolvedAsset, setup, currentPrice\)/);
assert.match(commentarySource, /ConversationView/);
assert.match(semanticCatalogSource, /하락 채널 상단 돌파/);
const patternPanelSource = readFileSync(fileURLToPath(new URL("../src/components/ChartPatternListPanel.tsx", import.meta.url)), "utf-8");
assert.match(patternPanelSource, /fetchChartAssetCoverage/);
assert.match(patternPanelSource, /subscribeAnalysisAssetsInvalidation/);
assert.match(patternPanelSource, /formatDetectedPattern/);
assert.match(patternPanelSource, /onSelectPatternAsset\(pattern\.symbol, pattern\.interval\)/);
assert.match(patternPanelSource, /패턴 종목 검색/);
assert.match(patternPanelSource, /활성 패턴이 있는 종목이 없습니다/);
assert.match(patternPanelSource, /필터와 일치하는 종목이 없습니다/);
const toggleSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAnalysisLayerToggles.tsx", import.meta.url)), "utf-8");
assert.match(toggleSource, /label="근거"/);
assert.match(toggleSource, /label="저항"/);
assert.match(toggleSource, /accessibleLabel="지지·저항"/);
assert.match(toggleSource, /label="추세"/);
assert.match(toggleSource, /label="패턴"/);
assert.match(toggleSource, /label="제안"/);
assert.match(toggleSource, /data-state=\{state\}/);
assert.match(toggleSource, /unavailable \? undefined : visibility\[layer\]/);
assert.match(toggleSource, /분석 레이어.*사용 불가/);
assert.match(toggleSource, /차트 준비 후 작도를 불러옵니다/);
assert.doesNotMatch(toggleSource, /차트 로드 후 작도·해설을 불러옵니다/);
assert.doesNotMatch(toggleSource, /lucide-react|chart-analysis-layer-state|icon=/);
assert.deepEqual(defaultAnalysisLayerVisibility, { interpretation: false, levels: false, trend: false, pattern: false, proposal: false });
assert.equal(analysisLayerOfDrawing(upper), "pattern");
assert.equal(analysisLayerOfDrawing(support), "levels");
assert.equal(analysisLayerOfDrawing(goldenCrossDrawing!), "trend");
const legacyHorizontalDrawing: DrawingEntity = {
  ...upper,
  id: "chart-asset:AAPL:1D:legacy-price-boundary",
  type: "horizontalLine",
  label: "Legacy boundary"
};
assert.equal(
  analysisLayerOfDrawing(legacyHorizontalDrawing),
  "levels",
  "legacy chart-asset horizontal lines fall back to the levels layer"
);

const proposalDrawing: DrawingEntity = {
  ...upper,
  id: "chart-plan:AAPL:1D:trade-timing:test:signal",
  sourceProposalId: "chart-plan:AAPL:1D:trade-timing"
};
assert.equal(analysisLayerOfDrawing(proposalDrawing), "proposal");
assert.equal(hasAnalysisLayerDrawings(asset, "pattern"), true);
assert.equal(hasAnalysisLayerDrawings(asset, "trend"), false, "stored SMA values do not make the Geometry trend layer available");
assert.equal(hasAnalysisLayerDrawings(resolved, "trend"), true, "the resolved SMA cross event remains in the trend layer");
assert.equal(hasAnalysisLayerDrawings(asset, "interpretation"), true, "final Geometry drawings make interpretation useful without trace candidates");
assert.equal(hasAnalysisLayerDrawings(asset, "proposal"), false);
assert.deepEqual(
  interpretationFinalDrawings(resolved!).map(({ drawingId, category, tone }) => ({ drawingId, category, tone })),
  [
    { drawingId: upper.id, category: "pattern", tone: "pattern" },
    { drawingId: lower.id, category: "pattern", tone: "pattern" }
  ],
  "final interpretation underlays exclude the resolved SMA cross marker"
);
const finalOnlyOverlay = buildAnalysisTraceOverlay(asset, { visible: true });
assert.equal(finalOnlyOverlay?.showCandidateLines, true);
assert.deepEqual(finalOnlyOverlay?.finalDrawings.map((drawing) => drawing.drawingId), [upper.id, lower.id]);
assert.equal(analysisTraceDataMode(asset), "legacy");
const splitLayerAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: { ...asset.geometry, drawings: [upper, proposalDrawing] },
  indicators: { ...asset.indicators, cross: { status: "none" } }
};
assert.equal(hasAnalysisLayerDrawings(splitLayerAsset, "proposal"), true);
assert.deepEqual(interpretationFinalDrawings(splitLayerAsset).map((drawing) => drawing.drawingId), [upper.id]);
const splitCommands = analysisAssetApplyCommands(
  target,
  [],
  splitLayerAsset,
  { ...defaultAnalysisLayerVisibility, pattern: false, proposal: true },
  { mode: "pan" }
);
const splitAdds = splitCommands.filter((command) => command.type === "chart.drawing.add");
assert.equal((splitAdds[0]?.payload.drawing as DrawingEntity).visible, false);
assert.equal((splitAdds[1]?.payload.drawing as DrawingEntity).visible, true);
assert.equal(analysisLayerToggleCommands(target, [upper, proposalDrawing], splitLayerAsset, "proposal", false).length, 1);

const traceAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    drawingGroups: { levels: [], trend: [], pattern: [upper.id, lower.id] },
    analysisTrace: {
      version: "geometry-analysis-trace-v1",
      pivots: [{ id: "pivot-1", timestamp: now, price: 170, kind: "L", confirmedAt: now }],
      levelCandidates: [{
        id: "level-candidate-1", category: "level", role: "support", selected: true, hardPass: true,
        anchors: [{ timestamp: now, price: 170 }, { timestamp: candles[2].timestamp, price: 170 }],
        evidenceRefs: ["pivot-1"], touchRefs: ["touch-1", "touch-2"], reactionRefs: ["touch-2"],
        touches: [
          { id: "touch-1", timestamp: now, price: 170, outcome: "touch" },
          { id: "touch-2", timestamp: candles[2].timestamp, price: 170, outcome: "reaction" }
        ],
        metrics: { touchCount: 2, reactionCount: 1 }
      }],
      trendCandidates: [], patternCandidates: [],
      selections: { levelCandidateIds: ["level-candidate-1"], trendCandidateIds: [], patternCandidateIds: [] },
      omittedCounts: { levelCandidates: 0, trendCandidates: 0, patternCandidates: 0, touchEpisodes: 0 }
    }
  }
};
const normalizedTraceAsset = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": traceAsset } }, "AAPL").assets["1D"];
assert.equal(normalizedTraceAsset?.geometry.analysisTrace?.version, "geometry-analysis-trace-v1");
assert.equal(hasAnalysisLayerDrawings(traceAsset, "interpretation"), true);
assert.equal(buildAnalysisTraceOverlay(traceAsset, { visible: false }), null, "interpretation stays off by default");
const focusedTrace = buildAnalysisTraceOverlay(traceAsset, { visible: false, candidateIds: ["level-candidate-1"] });
assert.equal(focusedTrace?.focused, true);
assert.deepEqual(focusedTrace?.candidates[0]?.touchPivotIds, ["touch-1", "touch-2"]);
assert.deepEqual(focusedTrace?.candidates[0]?.reactionPivotIds, ["touch-2"]);
assert.deepEqual(focusedTrace?.pivots.map((pivot) => pivot.id).sort(), ["pivot-1", "touch-1", "touch-2"]);
assert.equal(buildAnalysisTraceOverlay(traceAsset, { visible: true })?.candidates.length, 0);
assert.deepEqual(buildAnalysisTraceOverlay(traceAsset, { visible: true })?.markerCandidates.map((candidate) => candidate.id), ["level-candidate-1"]);
assert.deepEqual(buildAnalysisTraceOverlay(traceAsset, { visible: true })?.finalDrawings.map((drawing) => drawing.drawingId), [upper.id, lower.id]);
const baseTrace = traceAsset.geometry.analysisTrace!;
const baseLevelCandidate = baseTrace.levelCandidates[0]!;
const candidatesOnlyAsset: ChartAnalysisAsset = {
  ...traceAsset,
  geometry: {
    ...traceAsset.geometry,
    drawings: [],
    drawingGroups: { levels: [], trend: [], pattern: [] },
    analysisTrace: {
      ...baseTrace,
      version: "geometry-analysis-trace-v2",
      levelCandidates: [
        {
          ...baseLevelCandidate,
          categoryRank: 1,
          disposition: "selected",
          selectionReasons: ["confirmed"],
          render: { drawingType: "horizontalLine", extension: "plot" },
          metrics: { ...baseLevelCandidate.metrics, price: 171 }
        },
        {
          ...baseLevelCandidate,
          id: "level-candidate-qualified",
          selected: false,
          hardPass: true,
          evidencePass: true,
          activePass: true,
          anchors: [],
          categoryRank: 2,
          disposition: "qualified_not_selected",
          selectionReasons: [],
          rejectReasons: [],
          render: { drawingType: "horizontalLine", extension: "plot" },
          metrics: { ...baseLevelCandidate.metrics, price: 169 }
        },
        {
          ...baseLevelCandidate,
          id: "level-candidate-rejected",
          selected: false,
          hardPass: false,
          activePass: false,
          anchors: [],
          categoryRank: 3,
          disposition: "rejected",
          selectionReasons: [],
          rejectReasons: ["stale"],
          render: { drawingType: "horizontalLine", extension: "plot" },
          metrics: { ...baseLevelCandidate.metrics, price: 168 }
        }
      ],
      selections: { ...baseTrace.selections, levelCandidateIds: ["level-candidate-1"] },
      completeness: {
        complete: true,
        detected: { levels: 3, trends: 0, patterns: 0 },
        stored: { levels: 3, trends: 0, patterns: 0 }
      }
    }
  }
};
const candidatesOnlyOverlay = buildAnalysisTraceOverlay(candidatesOnlyAsset, { visible: true });
assert.equal(hasAnalysisLayerDrawings(candidatesOnlyAsset, "interpretation"), true);
assert.equal(candidatesOnlyOverlay?.candidates.length, 1);
assert.deepEqual(candidatesOnlyOverlay?.markerCandidates.map((candidate) => candidate.id), ["level-candidate-1", "level-candidate-qualified"]);
assert.deepEqual(candidatesOnlyOverlay?.finalDrawings, []);
assert.equal(candidatesOnlyOverlay?.storedCandidateCount, 3);
assert.equal(candidatesOnlyOverlay?.showCandidateLines, true);
assert.equal(
  analysisTraceLevelPrice(candidatesOnlyOverlay!.candidates[0]!, candidatesOnlyOverlay!.pivots),
  169,
  "stored metrics price wins over timed anchors for a horizontal candidate"
);
const candidatesOnlyHover = buildAnalysisTraceOverlay(candidatesOnlyAsset, {
  visible: false,
  candidateIds: ["level-candidate-rejected"]
});
assert.equal(candidatesOnlyHover?.candidates.length, 1);
assert.equal(candidatesOnlyHover?.showCandidateLines, false, "commentary hover keeps marker-only evidence");
const v2TraceAsset: ChartAnalysisAsset = {
  ...traceAsset,
  geometry: {
    ...traceAsset.geometry,
    analysisTrace: {
      ...traceAsset.geometry.analysisTrace!,
      version: "geometry-analysis-trace-v2",
      levelCandidates: traceAsset.geometry.analysisTrace!.levelCandidates.map((candidate, index) => ({
        ...candidate,
        categoryRank: index + 1,
        disposition: "selected" as const,
        selectionReasons: ["confirmed"],
        render: { drawingType: "horizontalLine" as const, extension: "plot" as const }
      })),
      completeness: {
        complete: true,
        detected: { levels: 1, trends: 0, patterns: 0 },
        stored: { levels: 1, trends: 0, patterns: 0 }
      }
    }
  }
};
assert.equal(analysisTraceDataMode(v2TraceAsset), "complete");
assert.equal(buildAnalysisTraceOverlay(v2TraceAsset, { visible: true })?.showCandidateLines, true);
assert.equal(buildAnalysisTraceOverlay(v2TraceAsset, { visible: true })?.candidates.length, 0, "selected final candidates are not repeated as interpretation lines");
assert.equal(buildAnalysisTraceOverlay(v2TraceAsset, { visible: false, candidateIds: ["level-candidate-1"] })?.showCandidateLines, false);
const legacyTraceAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: { ...asset.geometry, evidence: [{ id: "legacy-pivot", timestamp: now, price: 171, kind: "H" }] }
};
assert.deepEqual(buildAnalysisTraceOverlay(legacyTraceAsset, { visible: true })?.pivots.map((pivot) => pivot.id), ["legacy-pivot"]);
assert.equal(analysisTraceDataMode(traceAsset), "bounded");
assert.equal(analysisTraceDataMode(legacyTraceAsset), "legacy");

const selectorBase: AnalysisTraceOverlayCandidate = {
  id: "selector-base",
  category: "levels",
  role: "support",
  kind: "level",
  score: .5,
  selected: false,
  hardPass: true,
  evidencePass: true,
  activePass: true,
  rejectReasons: [],
  categoryRank: 1,
  disposition: "qualified_not_selected",
  metrics: { touchCount: 3, reactionCount: 2, currentDistanceAtr: .5, lastTouchAgeBars: 2 },
  anchors: [],
  anchorPivotIds: [],
  touchPivotIds: [],
  reactionPivotIds: []
};
const crowdedCandidates: AnalysisTraceOverlayCandidate[] = Array.from({ length: 85 }, (_, index) => {
  const category = (["levels", "trend", "pattern"] as const)[index % 3];
  return {
    ...selectorBase,
    id: `crowded-${String(index).padStart(2, "0")}`,
    category,
    selected: index < 5,
    disposition: index < 5 ? "selected" : "qualified_not_selected",
    score: 1 - index / 100,
    categoryRank: index + 1,
    role: category === "levels" ? (index % 2 ? "resistance" : "support") : undefined,
    direction: category === "trend" ? (index % 2 ? "down" : "up") : undefined,
    kind: category === "trend" ? (["channel", "uptrend", "downtrend"] as const)[index % 3]
      : category === "pattern" ? `pattern-${index % 4}` : "level"
  };
});
const selectedCrowdedCandidates = selectInterpretationCandidates(crowdedCandidates);
assert.equal(selectedCrowdedCandidates.length, 9, "the interpretation layer has an absolute nine-candidate ceiling");
assert.equal(selectedCrowdedCandidates.some((candidate) => candidate.selected), false);
assert.equal(selectedCrowdedCandidates.filter((candidate) => candidate.category === "levels").length, 4);
assert.equal(selectedCrowdedCandidates.filter((candidate) => candidate.category === "trend").length, 3);
assert.equal(selectedCrowdedCandidates.filter((candidate) => candidate.category === "pattern").length, 2);
const nearMissCandidates = selectInterpretationCandidates([
  { ...selectorBase, id: "near-miss-stale", hardPass: false, disposition: "rejected", score: .99, rejectReasons: ["stale"] },
  { ...selectorBase, id: "near-miss-active", hardPass: false, disposition: "rejected", score: .75 },
  { ...selectorBase, id: "near-miss-inactive", hardPass: false, activePass: false, disposition: "rejected", score: .9 }
]);
assert.deepEqual(nearMissCandidates.map((candidate) => candidate.id), ["near-miss-active"]);

const importanceStyles = [
  { importanceTier: "major" as const, lineWidth: 2.5, opacity: .88, lineDash: undefined, label: "지지" },
  { importanceTier: "standard" as const, lineWidth: 1.75, opacity: .78, lineDash: [7, 4], label: "보조 지지" },
  { importanceTier: "minor" as const, lineWidth: 1.25, opacity: .68, lineDash: [2, 4], label: "참고 지지" }
];
importanceStyles.forEach((expected) => {
  const styled = resolveAnalysisAssetForCandles({
    ...levelAsset,
    geometry: {
      ...levelAsset.geometry,
      supports: [{ ...levelAsset.geometry.supports[0], importanceTier: expected.importanceTier }]
    }
  }, candles)?.geometry.drawings[0];
  assert.equal(styled?.style.lineWidth, expected.lineWidth);
  assert.equal(styled?.style.opacity, expected.opacity);
  assert.deepEqual(styled?.style.lineDash, expected.lineDash);
  assert.equal(styled?.label, expected.label);
});

const trendDrawing: DrawingEntity = {
  ...upper,
  id: "chart-asset:AAPL:1D:trend-up",
  label: "상승 추세선"
};
const trendAsset: ChartAnalysisAsset = {
  ...asset,
  geometry: {
    ...asset.geometry,
    drawings: [trendDrawing],
    primaryTriangle: null,
    drawingGroups: { levels: [], trend: [trendDrawing.id], pattern: [] },
    trends: [{
      id: "trend-up", kind: "uptrend", direction: "up", score: .91, drawingId: trendDrawing.id,
      anchors: trendDrawing.anchors as Array<{ timestamp: string; price: number }>,
      anchorPivotIds: ["pivot-a", "pivot-b"], touchPivotIds: [], reactionPivotIds: [],
      touchCount: 3, reactionCount: 2, slopeAtrPerBar: .1, medianResidualAtr: .2,
      currentDistanceAtr: .4, lastTouchAgeBars: 2
    }],
    primaryTrend: null
  },
  indicators: { ...asset.indicators, cross: { status: "none" } }
};
const resolvedTrend = resolveAnalysisAssetForCandles(trendAsset, candles)?.geometry.drawings[0];
assert.equal(analysisLayerOfDrawing(trendDrawing, trendAsset), "trend");
assert.equal(resolvedTrend?.style.lineWidth, 1.5);
assert.equal(resolvedTrend?.style.opacity, .76);
assert.equal(resolvedTrend?.style.fillOpacity, .02);
assert.equal(resolvedTrend?.style.extension, "ray");
assert.deepEqual(resolvedTrend?.style.lineDash, undefined);
assert.equal(resolvedTrend?.style.colorToken, "evidenceTrend");
assert.equal(resolvedTrend?.style.fillToken, "evidenceTrend");
assert.equal(resolvedTrend?.style.textToken, "evidenceTrend");
assert.equal(resolvedTrend?.style.color, undefined, "Geometry presentation stores semantic tokens instead of raw fallback colors");
assert.equal(resolvedTrend?.style.fillColor, undefined);
assert.equal(resolvedTrend?.style.textColor, undefined);
assert.equal(resolvedTrend?.style.labelPlacement, "none");
const resolvedDownTrend = resolveAnalysisAssetForCandles({
  ...trendAsset,
  geometry: {
    ...trendAsset.geometry,
    trends: trendAsset.geometry.trends?.map((trend) => ({ ...trend, kind: "downtrend", direction: "down" }))
  }
}, candles)?.geometry.drawings[0];
assert.equal(resolvedDownTrend?.style.colorToken, "evidenceTrend");
