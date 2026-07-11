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
import { formatAnalysisAssetAsOf, isAnalysisAssetStale, resolveAnalysisAssetForCandles } from "../src/chart/analysisAssetPresentation";
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
      { layer: "rsi:14", reason: "과매도", source: "rule" },
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

const applyCommands = analysisAssetApplyCommands(target, [assetDrawing, userDrawing], asset, {
  structure: true,
  trend: false,
  agent: false
}, { mode: "pan" });
assert.equal(applyCommands.filter((command) => command.type === "chart.drawing.remove").length, 1);
assert.equal(applyCommands.every((command) => command.actor === "system" && command.historyScope === "external"), true);
assert.equal(applyCommands.filter((command) => command.type === "chart.layer.visibility.set").length, 4);

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
