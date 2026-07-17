import assert from "node:assert/strict";
import { buildPatternBadgeLayout } from "../src/chart/patternBadge";
import { buildChartScene } from "../src/chart/scene";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import type { ChartState, DrawingEntity } from "../src/chart/types";

const candles = Array.from({ length: 60 }, (_, index) => ({
  timestamp: `2026-05-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
  open: 100, high: 106, low: 96, close: 101, volume: 1_000, isClosed: true
}));
const patternDrawing: DrawingEntity = {
  id: "chart-asset:TEST:1D:triangle-upper",
  type: "trendLine",
  anchors: [
    { logicalIndex: 42, price: 104, paneId: "price", symbol: "TEST", interval: "1D" },
    { logicalIndex: 56, price: 102, paneId: "price", symbol: "TEST", interval: "1D" }
  ],
  symbol: "TEST",
  interval: "1D",
  sourceInterval: "1D",
  style: { labelPlacement: "none", extension: "segment" },
  label: "대칭 삼각형 · 형성 중",
  visible: true,
  locked: true,
  createdBy: "system",
  createdAt: candles.at(-1)!.timestamp,
  updatedAt: candles.at(-1)!.timestamp
};
const asset: ChartAnalysisAsset = {
  assetVersion: "geometry",
  algorithmVersion: "ohlcv-consensus-pattern-families-v6",
  symbol: "TEST",
  interval: "1D",
  sourceInterval: "1D",
  asOf: candles.at(-1)!.timestamp,
  generatedAt: candles.at(-1)!.timestamp,
  status: "ready",
  inputDigest: "sha256:pattern-badge",
  coverage: { state: "full", targetBars: 60, actualBars: 60, contiguousBars: 60, missingBars: 0 },
  geometry: {
    drawings: [patternDrawing as ChartAnalysisAsset["geometry"]["drawings"][number]],
    supports: [], resistances: [],
    patterns: [{ kind: "symmetrical_triangle", state: "forming", score: .9, touches: 5, geometryHash: "triangle" }],
    primaryPattern: { kind: "symmetrical_triangle", state: "forming", score: .9, touches: 5, geometryHash: "triangle" },
    drawingGroups: { levels: [], trend: [], pattern: [patternDrawing.id] },
    primaryTriangle: { kind: "symmetrical_triangle", state: "forming", score: .9, touches: 5, geometryHash: "triangle" },
    historicalTriangle: null
  },
  indicators: { sma60: null, sma120: null, cross: { status: "none" } }
};
const chart: ChartState = {
  symbol: "TEST",
  chartType: "candle",
  interval: "1D",
  candles,
  status: "ready",
  layers: { candles: true, volume: false, ma5: false, ma20: false, ma60: false },
  panes: [{ id: "price", heightRatio: 1 }],
  volumeRatio: .2,
  visibleCount: 24,
  rightOffset: 0,
  toolMode: "pan",
  trendLineExtension: "segment",
  parallelLineCount: 3,
  drawings: [patternDrawing],
  comparisons: [],
  streamState: "idle"
};

const visibleBadge = buildPatternBadgeLayout(buildChartScene(chart, 800, 420), asset);
assert.equal(visibleBadge?.text, "대칭 삼각형 · 형성 중");
assert.deepEqual(visibleBadge?.drawingIds, [patternDrawing.id]);

const hiddenDrawing = { ...patternDrawing, visible: false };
const hiddenScene = buildChartScene({ ...chart, drawings: [hiddenDrawing] }, 800, 420);
assert.equal(buildPatternBadgeLayout(hiddenScene, asset), null, "pattern layer OFF hides the badge");
assert.equal(buildPatternBadgeLayout(hiddenScene, asset, [patternDrawing.id])?.text, "대칭 삼각형 · 형성 중", "spotlight effective visibility restores the badge");

const offscreenDrawing: DrawingEntity = {
  ...patternDrawing,
  anchors: patternDrawing.anchors.map((anchor, index) => ({ ...anchor, logicalIndex: index * 4 }))
};
const offscreenScene = buildChartScene({ ...chart, drawings: [offscreenDrawing] }, 800, 420);
assert.equal(buildPatternBadgeLayout(offscreenScene, asset), null, "pan/zoom that removes the pattern geometry also removes its badge");
