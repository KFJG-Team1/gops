import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommandGroup } from "../../chart-engine/src/commands";
import { analysisAssetApplyCommands, analysisLayerToggleCommands, isChartAssetDrawing } from "../src/chart/analysisLayerController";
import { normalizeAnalysisAssetsResponse, type ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import { analysisAssetPresentationDiagnostics, candleKeyForTimestamp, detectedPatternSummary, isAnalysisAssetStale, resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";
import type { DrawingEntity } from "../src/chart/types";

const now = "2026-07-10T20:00:00.000Z";
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
  indicators: { sma60: 170, sma120: 165, cross: { status: "crossed", direction: "golden", timestamp: now, barsAgo: 1 } }
};
const candles = [
  { timestamp: now, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: "2026-07-11T20:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
];

assert.equal(isChartAssetDrawing(upper), true);
assert.equal(candleKeyForTimestamp("2026-07-06T00:00:00.000Z", "1W"), "2026-07-06");
assert.equal(candleKeyForTimestamp("2026-07-10T13:35:00.000Z", "5m"), "2026-07-10T13:35:00.000Z");
assert.deepEqual(detectedPatternSummary(asset), { kind: "ascending_triangle", state: "forming", score: .92, drawingCount: 2 });
assert.equal(isAnalysisAssetStale(asset.asOf, candles, "geometry", "1D"), false);

const normalized = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": asset, "1M": asset } }, "AAPL");
assert.equal(normalized.assets["1D"]?.assetVersion, "geometry");
assert.equal("1M" in normalized.assets, false);
const mixedInterval = { ...asset, geometry: { ...asset.geometry, drawings: [{ ...upper, interval: "1W" }] } };
assert.equal(normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": mixedInterval } }, "AAPL").assets["1D"], null);
const resolved = resolveAnalysisAssetForCandles(asset, candles);
assert.equal(resolved?.geometry.drawings.length, 2);
assert.equal(resolveAnalysisAssetForCandles(asset, [])?.geometry.drawings.length, 0);
assert.equal(analysisAssetPresentationDiagnostics(asset, candles, [upper.id, lower.id]).state, "ready");
const stale = analysisAssetPresentationDiagnostics(asset, [...candles, { ...candles[0], timestamp: "2026-07-14T20:00:00.000Z" }]);
assert.equal(stale.state, "stale_asset");
assert.equal(stale.resolvedAsset.geometry.drawings[0].style.opacity, .45);

const userDrawing: DrawingEntity = { ...upper, id: "user", sourceProposalId: undefined, createdBy: "user" };
const commands = analysisAssetApplyCommands(target, [userDrawing], asset, { geometry: true }, { mode: "pan" });
assert.equal(commands.filter((command) => command.type === "chart.drawing.add").length, 2);
assert.equal(commands.filter((command) => command.type === "chart.layer.visibility.set").length, 2);
assert.ok(commands.some((command) => command.type === "chart.layer.visibility.set" && command.payload.layer === "sma:120"));
assert.equal(analysisLayerToggleCommands(target, [], asset, "geometry", true).length, 2);

const document = createChartDocument(target.chartDocumentId, "AAPL", "1D");
const result = executeChartCommandGroup(document, commands, "Apply Geometry asset");
assert.equal(result.ok, true);

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
  geometry: { ...asset.geometry, drawings: [support], primaryTriangle: null }
};
const projectedLevelAsset = resolveAnalysisAssetForCandles(levelAsset, candles);
assert.equal(projectedLevelAsset?.geometry.drawings.length, 1);
assert.deepEqual(
  projectedLevelAsset?.geometry.drawings[0]?.anchors.map((anchor) => anchor.timestamp),
  candles.map((candle) => candle.timestamp)
);
assert.equal(analysisAssetPresentationDiagnostics(levelAsset, candles, [support.id]).state, "ready");
const levelCommands = analysisAssetApplyCommands(target, [], levelAsset, { geometry: true }, { mode: "pan" });
const levelResult = executeChartCommandGroup(document, levelCommands, "Apply Geometry level asset");
assert.equal(levelResult.ok, true);
assert.equal(levelResult.document.drawings[0]?.anchors.length, 2);

const opsSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAssetOpsPanel.tsx", import.meta.url)), "utf-8");
assert.match(opsSource, /\["1m", "5m", "10m", "1h", "4h", "1D", "1W"\]/);
assert.doesNotMatch(opsSource, /LLM 포함|EventSource|1M/);
assert.match(opsSource, /SMA120/);
const toggleSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAnalysisLayerToggles.tsx", import.meta.url)), "utf-8");
assert.match(toggleSource, /Geometry 분석 레이어/);
assert.doesNotMatch(toggleSource, /인사이트|추세 분석 레이어/);
