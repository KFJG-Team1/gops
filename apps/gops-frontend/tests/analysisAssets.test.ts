import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommandGroup, makeChartCommand } from "../../chart-engine/src/commands";
import { analysisAssetApplyCommands, analysisLayerToggleCommands, isChartAssetDrawing } from "../src/chart/analysisLayerController";
import { normalizeAnalysisAssetsResponse, type ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, candleKeyForTimestamp, detectedPatternSummary, formatDetectedPattern, isAnalysisAssetStale, resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";
import { buildPatternSymbolGroups, filterPatternSymbolGroups } from "../src/chart/patternAssetList";
import type { ChartAssetCoverageItem } from "../src/chart/assetBuildApi";
import { defaultChartAssetBuildIntervals } from "../src/chart/chartAssetBuildPolicy";
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
const mixedInterval = { ...asset, geometry: { ...asset.geometry, drawings: [{ ...upper, interval: "1W" }] } };
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": mixedInterval } }, "AAPL").assets["1D"], null);
const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.equal(resolved?.geometry.drawings.length, 3);
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
assert.equal(deadCrossDrawing?.style.color, "#ef4444");
assert.equal(deadCrossDrawing?.anchors[0]?.logicalIndex, .75);
assert.equal(deadCrossDrawing?.anchors[0]?.price, 168.75);
assert.equal(resolveAnalysisAssetForCandles(asset, [])?.geometry.drawings.length, 0);
assert.equal(analysisAssetPresentationDiagnostics(asset, candles, [upper.id, lower.id]).state, "ready");
const stale = analysisAssetPresentationDiagnostics(asset, [...candles, { ...candles[0], timestamp: "2026-07-14T20:00:00.000Z" }]);
assert.equal(stale.state, "stale_asset");
assert.equal(stale.resolvedAsset.geometry.drawings[0].style.opacity, .45);

const userDrawing: DrawingEntity = { ...upper, id: "user", sourceProposalId: undefined, createdBy: "user" };
const commands = analysisAssetApplyCommands(target, [userDrawing], resolved, { geometry: true }, { mode: "pan" });
assert.equal(commands.filter((command) => command.type === "chart.drawing.add").length, 3);
assert.ok(commands.some((command) => command.type === "chart.drawing.add" && command.payload.drawing?.label === "골든크로스 · SMA60/120"));
assert.equal(commands.filter((command) => command.type === "chart.layer.visibility.set").length, 2);
assert.ok(commands.some((command) => command.type === "chart.layer.visibility.set" && command.payload.layer === "sma:120"));
assert.equal(analysisLayerToggleCommands(target, [], resolved!, "geometry", true).length, 3);

const document = createChartDocument(target.chartDocumentId, "AAPL", "1D");
const result = executeChartCommandGroup(document, commands, "Apply Geometry asset");
assert.equal(result.ok, true);
if (!result.ok) assert.fail(result.message);
const hiddenResult = executeChartCommandGroup(
  result.document,
  analysisLayerToggleCommands(target, result.document.drawings, resolved!, "geometry", false),
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
    supports: [{ id: "support", role: "support", price: 245.7, score: .9, touches: 3, anchors: support.anchors as Array<{ timestamp: string; price: number }> }],
    primaryTriangle: null
  },
  indicators: { ...asset.indicators, cross: { status: "none", direction: null } }
};
const projectedLevelAsset = resolveAnalysisAssetForCandles(levelAsset, candles);
assert.equal(projectedLevelAsset?.geometry.drawings.length, 1);
assert.deepEqual(projectedLevelAsset?.geometry.drawings[0]?.style.lineDash, [6, 4]);
assert.deepEqual(
  projectedLevelAsset?.geometry.drawings[0]?.anchors.map((anchor) => anchor.timestamp),
  [candles[0]?.timestamp, candles[candles.length - 1]?.timestamp]
);
assert.equal(resolved?.geometry.drawings.find((drawing) => drawing.type === "trendLine")?.style.lineDash, undefined);
assert.equal(analysisAssetPresentationDiagnostics(levelAsset, candles, [support.id]).state, "ready");
const levelCommands = analysisAssetApplyCommands(target, [], levelAsset, { geometry: true }, { mode: "pan" });
const levelResult = executeChartCommandGroup(document, levelCommands, "Apply Geometry level asset");
assert.equal(levelResult.ok, true);
assert.equal(levelResult.document.drawings[0]?.anchors.length, 2);

assert.deepEqual(defaultChartAssetBuildIntervals("5m"), ["1m", "1D"]);
assert.deepEqual(defaultChartAssetBuildIntervals("1D"), ["1m", "1D"]);
assert.deepEqual(defaultChartAssetBuildIntervals("1M"), ["1m", "1D"]);

const opsSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAssetOpsPanel.tsx", import.meta.url)), "utf-8");
const presentationSource = readFileSync(fileURLToPath(new URL("../src/chart/analysisAssetPresentation.ts", import.meta.url)), "utf-8");
const semanticCatalogSource = readFileSync(fileURLToPath(new URL("../../../shared/chart-contract/chart-semantics.ko.json", import.meta.url)), "utf-8");
assert.match(opsSource, /\["1m", "5m", "10m", "1h", "4h", "1D", "1W"\]/);
assert.match(opsSource, /\["1m", "1D"\]/);
assert.match(opsSource, /defaultChartAssetBuildIntervals\(currentInterval\)/);
assert.doesNotMatch(opsSource, /LLM 포함|EventSource|1M/);
assert.match(opsSource, /SMA120/);
assert.match(presentationSource, /chartSemanticCatalog\.patterns/);
assert.match(semanticCatalogSource, /상승 페넌트/);
assert.match(opsSource, /<th>감지 패턴<\/th>/);
assert.match(opsSource, /formatDetectedPattern\(item\.primaryPattern\)/);
const commentarySource = readFileSync(fileURLToPath(new URL("../src/components/ChartCommentaryPanel.tsx", import.meta.url)), "utf-8");
assert.match(commentarySource, /chartSemanticLabel/);
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
assert.match(toggleSource, /Geometry 분석 레이어/);
assert.doesNotMatch(toggleSource, /인사이트|추세 분석 레이어/);
