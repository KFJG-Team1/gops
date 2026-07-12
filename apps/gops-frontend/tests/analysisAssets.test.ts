import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommandGroup } from "../../chart-engine/src/commands";
import {
  analysisAssetApplyCommands,
  analysisLayerToggleCommands,
  isChartAssetDrawing
} from "../src/chart/analysisLayerController";
import { normalizeAnalysisAssetsResponse, type ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
import {
  analysisAssetPresentationDiagnostics,
  candleKeyForTimestamp,
  detectedPatternSummary,
  formatAnalysisAssetAsOf,
  isAnalysisAssetStale,
  resolveAnalysisAssetForCandles
} from "../src/chart/analysisAssetPresentation";
import type { DrawingEntity } from "../src/chart/types";

const now = "2026-07-10T20:00:00.000Z";
const target = { panelId: "panel-analysis", chartDocumentId: "doc-analysis" };
const assetDrawing: DrawingEntity = {
  id: "ca-AAPL-1D-structure-1",
  type: "horizontalLine",
  anchors: [{ price: 180 }],
  sourceInterval: "1D",
  style: { colorToken: "asset-sr-strong" },
  label: "저항 180.00",
  locked: false,
  visible: true,
  createdBy: "system",
  sourceProposalId: "chart-asset:AAPL:1D:structure",
  createdAt: now,
  updatedAt: now
};
const userDrawing: DrawingEntity = {
  ...assetDrawing,
  id: "drawing-user",
  createdBy: "user",
  sourceProposalId: undefined
};
const asset = {
  assetVersion: "v1",
  symbol: "AAPL",
  interval: "1D",
  asOf: now,
  generatedAt: now,
  status: "degraded",
  layers: {
    structure: { drawings: [assetDrawing] },
    trend: { drawings: [] },
    agent: { drawings: [], degraded: true, rationale: "", model: null }
  },
  chartSetup: {
    alwaysOn: ["volume-profile", "volume"],
    recommended: [
      { layer: "sma:120", reason: "MA60/120 교차 확인", source: "rule" },
      { layer: "macd:12:26:9", reason: "교차", source: "rule" },
      { layer: "ema:20", reason: "방어적 초과 입력", source: "llm" }
    ]
  },
  commentary: { text: "", keyLevels: [], invalidation: "", confidence: 0.3, enrichment: null }
} satisfies ChartAnalysisAsset;

assert.equal(isChartAssetDrawing(assetDrawing), true);
assert.equal(isChartAssetDrawing(userDrawing), false);
assert.equal(formatAnalysisAssetAsOf("2026-07-10T20:00:00.000Z"), "07-10");
assert.equal(isAnalysisAssetStale(now, [
  { timestamp: "2026-07-11T20:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: "2026-07-12T20:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
]), true);
assert.equal(isAnalysisAssetStale(now, [
  { timestamp: "2026-07-11T20:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
], "v2"), true);
assert.equal(candleKeyForTimestamp("2026-01-05T05:00:00.000Z", "1W"), "2026-01-05");
assert.equal(candleKeyForTimestamp("2026-07-06T04:00:00.000Z", "1W"), "2026-07-06");
assert.equal(candleKeyForTimestamp("2026-07-06T00:00:00.000Z", "1W"), "2026-07-06");
assert.equal(candleKeyForTimestamp("2026-07-01T04:00:00.000Z", "1M"), "2026-07");
assert.equal(candleKeyForTimestamp("2026-07-01T00:00:00.000Z", "1M"), "2026-07");
assert.equal(candleKeyForTimestamp("2026-07-10T13:35:00.000Z", "5m"), "2026-07-10T13:35:00.000Z");

const v2TimedDrawing = {
  ...assetDrawing,
  id: "ca-AAPL-1D-agent-event",
  type: "flagMarker" as const,
  anchors: [{ timestamp: "2026-07-10T04:00:00.000Z", price: 180 }],
  createdBy: "llm" as const
};
const v2Asset = {
  ...asset,
  assetVersion: "v2" as const,
  layers: {
    structure: { drawings: [{ ...assetDrawing, label: "저항 180.00" }], selected: [], emptyReason: null },
    trend: { drawings: [], selected: [], emptyReason: "no_candidate" },
    agent: { drawings: [v2TimedDrawing], selected: [], emptyReason: null }
  }
};
const normalizedV2 = normalizeAnalysisAssetsResponse({ symbol: "AAPL", assets: { "1D": v2Asset } }, "AAPL").assets["1D"];
assert.equal(normalizedV2?.layers.structure.drawings[0].label, "저항");
const resolvedV2 = resolveAnalysisAssetForCandles(normalizedV2, [
  { timestamp: "2026-07-10T04:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
]);
assert.equal(resolvedV2?.layers.agent.drawings.length, 1);
const rejectedV2 = resolveAnalysisAssetForCandles(normalizedV2, []);
assert.equal(rejectedV2?.layers.agent.drawings.length, 0);
assert.deepEqual(rejectedV2?.layers.agent.meta?.anchorResolutionErrors, [
  { drawingId: v2TimedDrawing.id, reason: "anchor_not_in_canonical_candles" }
]);

const patternedAsset = {
  ...v2Asset,
  interval: "5m" as const,
  layers: {
    ...v2Asset.layers,
    trend: {
      drawings: [v2TimedDrawing, { ...v2TimedDrawing, id: "pattern-lower" }],
      selected: [{
        candidateId: "5m:pattern:ascending",
        drawingIds: [v2TimedDrawing.id, "pattern-lower"],
        patternKind: "ascending_triangle",
        patternState: "forming",
        quality: { score: .94 }
      }],
      emptyReason: null
    }
  }
} satisfies ChartAnalysisAsset;
assert.deepEqual(detectedPatternSummary(patternedAsset), {
  kind: "ascending_triangle",
  state: "forming",
  score: .94,
  drawingCount: 2
});

const aaplWeeklyDrawing = {
  ...v2TimedDrawing,
  id: "ca-AAPL-1W-agent-event",
  sourceInterval: "1W" as const,
  anchors: [{ timestamp: "2026-06-01T04:00:00.000Z", price: 180 }],
  sourceProposalId: "chart-asset:AAPL:1W:agent"
};
const aaplWeeklyAsset = {
  ...v2Asset,
  interval: "1W" as const,
  asOf: "2026-06-08T04:00:00.000Z",
  status: "ready" as const,
  coverage: { renderable: true },
  quality: { state: "eligible" as const, score: 1 },
  layers: {
    structure: { drawings: [], selected: [], emptyReason: null },
    trend: { drawings: [], selected: [], emptyReason: null },
    agent: { drawings: [aaplWeeklyDrawing], selected: [], emptyReason: null }
  }
} satisfies ChartAnalysisAsset;
const aaplWeeklyCandles = [
  { timestamp: "2026-06-01T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: "2026-06-01T04:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true },
  { timestamp: "2026-06-08T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }
];
const resolvedAaplWeekly = resolveAnalysisAssetForCandles(aaplWeeklyAsset, aaplWeeklyCandles);
assert.equal(resolvedAaplWeekly?.layers.agent.drawings[0].anchors[0].timestamp, "2026-06-01T00:00:00.000Z");
assert.equal(isAnalysisAssetStale(aaplWeeklyAsset.asOf, aaplWeeklyCandles, "v2", "1W"), false);
assert.equal(isAnalysisAssetStale("2026-06-15T04:00:00.000Z", [
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T00:00:00.000Z" },
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T04:00:00.000Z" }
], "v2", "1W"), false);
assert.equal(isAnalysisAssetStale("2026-06-08T04:00:00.000Z", [
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T00:00:00.000Z" },
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T04:00:00.000Z" }
], "v1", "1W"), false);
assert.equal(isAnalysisAssetStale("2026-06-08T04:00:00.000Z", [
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T00:00:00.000Z" },
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-22T00:00:00.000Z" }
], "v1", "1W"), true);

const readyDiagnostics = analysisAssetPresentationDiagnostics(
  aaplWeeklyAsset,
  aaplWeeklyCandles,
  [aaplWeeklyDrawing.id]
);
assert.deepEqual({
  state: readyDiagnostics.state,
  stored: readyDiagnostics.storedDrawingCount,
  applied: readyDiagnostics.appliedDrawingCount,
  rejected: readyDiagnostics.rejectedDrawingCount
}, { state: "ready", stored: 1, applied: 1, rejected: 0 });
const notAppliedDiagnostics = analysisAssetPresentationDiagnostics(aaplWeeklyAsset, aaplWeeklyCandles, []);
assert.equal(notAppliedDiagnostics.state, "presentation_rejected");
assert.equal(notAppliedDiagnostics.appliedDrawingCount, 0);
assert.deepEqual(notAppliedDiagnostics.appliedDrawingIds, []);
assert.deepEqual(notAppliedDiagnostics.rejectionReasons, { not_in_chart_document: 1 });
const rejectedDiagnostics = analysisAssetPresentationDiagnostics(aaplWeeklyAsset, []);
assert.equal(rejectedDiagnostics.state, "presentation_rejected");
assert.deepEqual(rejectedDiagnostics.rejectionReasons, { anchor_not_in_canonical_candles: 1 });
const staleDiagnostics = analysisAssetPresentationDiagnostics(aaplWeeklyAsset, [
  ...aaplWeeklyCandles,
  { ...aaplWeeklyCandles[0], timestamp: "2026-06-15T00:00:00.000Z" }
]);
assert.equal(staleDiagnostics.state, "stale_asset");
assert.deepEqual(staleDiagnostics.rejectionReasons, { stale_asset: 1 });
const emptyReadyAsset = {
  ...aaplWeeklyAsset,
  layers: {
    structure: { drawings: [] },
    trend: { drawings: [] },
    agent: { drawings: [] }
  }
} satisfies ChartAnalysisAsset;
assert.equal(analysisAssetPresentationDiagnostics(emptyReadyAsset, aaplWeeklyCandles).state, "quality_empty");
assert.equal(analysisAssetPresentationDiagnostics({
  ...emptyReadyAsset,
  status: "degraded",
  quality: { state: "insufficient_data", score: 0 }
}, aaplWeeklyCandles).state, "data_degraded");
assert.equal(analysisAssetPresentationDiagnostics({
  ...aaplWeeklyAsset,
  status: "degraded",
  quality: { state: "eligible", score: 1 }
}, aaplWeeklyCandles, [aaplWeeklyDrawing.id]).state, "ready");
const opsSource = readFileSync(fileURLToPath(new URL("../src/components/ChartAssetOpsPanel.tsx", import.meta.url)), "utf-8");
assert.match(opsSource, /갱신 스킵\(시간\)/);
assert.match(opsSource, /콤마로 구분/);
assert.doesNotMatch(opsSource, /신선 자산 스킵\(시간\)/);
assert.match(opsSource, /const estimatedCalls = symbolCount;/);
assert.match(opsSource, /deleteChartAssets/);
assert.match(opsSource, /작도 자산 삭제/);
assert.match(opsSource, /작도 없음/);
assert.match(opsSource, /addEventListener\("log"/);
assert.match(opsSource, /createdEntities/);
assert.match(opsSource, /현재 차트 적용/);
assert.match(opsSource, /\["1m", "5m", "10m", "1h", "4h", "1D", "1W", "1M"\]/);
assert.match(opsSource, /감지 패턴/);
assert.match(opsSource, /제외 사유/);
assert.match(opsSource, /reasonCodes/);
const chartPanelSource = readFileSync(fileURLToPath(new URL("../src/components/ChartPanel.tsx", import.meta.url)), "utf-8");
assert.match(chartPanelSource, /!activeAnalysisAsset \|\| activeAnalysisAssetStale/);
assert.match(chartPanelSource, /structure: activeAnalysisAssetStale \|\|/);
assert.match(chartPanelSource, /latestClosedAssetCandleTimestamp \?\? "no-closed-candle"/);
const commentarySource = readFileSync(fileURLToPath(new URL("../src/components/ChartCommentaryPanel.tsx", import.meta.url)), "utf-8");
assert.match(commentarySource, /const appliedDrawingIds = new Set\(presentation\.appliedDrawingIds\)/);
assert.match(commentarySource, /item\.drawingIds\.every/);
assert.match(commentarySource, /presentationBlocked/);
assert.match(commentarySource, /keyLevelsV2/);

const applyCommands = analysisAssetApplyCommands(target, [assetDrawing, userDrawing], asset, {
  structure: true,
  trend: false,
  agent: false
}, { mode: "pan" });
assert.equal(applyCommands.filter((command) => command.type === "chart.drawing.remove").length, 1);
assert.equal(applyCommands.every((command) => command.actor === "system" && command.historyScope === "external"), true);
assert.equal(applyCommands.filter((command) => command.type === "chart.layer.visibility.set").length, 4);
assert.ok(applyCommands.some((command) => (
  command.type === "chart.layer.visibility.set" && command.payload.layer === "sma:120" && command.payload.visible === true
)));

const recovered = analysisLayerToggleCommands(target, [], asset, "structure", true);
assert.equal(recovered[0]?.type, "chart.drawing.add");
assert.deepEqual(analysisLayerToggleCommands(target, [], asset, "structure", false), []);

const document = createChartDocument(target.chartDocumentId, "AAPL", "1D");
const result = executeChartCommandGroup(document, applyCommands.filter((command) => command.type !== "chart.drawing.remove"), "Apply analysis asset");
assert.equal(result.ok, true);
if (result.ok) {
  assert.equal(result.document.history.length, 0);
  assert.equal(result.document.drawings.length, 1);
  assert.equal(result.document.interactionState.mode, "pan");
  assert.equal(result.document.selectedDrawingId, undefined);
}
