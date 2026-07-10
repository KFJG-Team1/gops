import assert from "node:assert/strict";
import { createChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommandGroup } from "../../chart-engine/src/commands";
import {
  analysisAssetApplyCommands,
  analysisLayerToggleCommands,
  isChartAssetDrawing
} from "../src/chart/analysisLayerController";
import type { ChartAnalysisAsset } from "../src/chart/analysisAssetsApi";
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
    recommended: [{ layer: "rsi:14", reason: "과매도", source: "rule" }]
  },
  commentary: { text: "", keyLevels: [], invalidation: "", confidence: 0.3, enrichment: null }
} satisfies ChartAnalysisAsset;

assert.equal(isChartAssetDrawing(assetDrawing), true);
assert.equal(isChartAssetDrawing(userDrawing), false);

const applyCommands = analysisAssetApplyCommands(target, [assetDrawing, userDrawing], asset, {
  structure: true,
  trend: false,
  agent: false
});
assert.equal(applyCommands.filter((command) => command.type === "chart.drawing.remove").length, 1);
assert.equal(applyCommands.every((command) => command.actor === "system" && command.historyScope === "external"), true);
assert.equal(applyCommands.filter((command) => command.type === "chart.layer.visibility.set").length, 3);

const recovered = analysisLayerToggleCommands(target, [], asset, "structure", true);
assert.equal(recovered[0]?.type, "chart.drawing.add");
assert.deepEqual(analysisLayerToggleCommands(target, [], asset, "structure", false), []);

const document = createChartDocument(target.chartDocumentId, "AAPL", "1D");
const result = executeChartCommandGroup(document, applyCommands.filter((command) => command.type !== "chart.drawing.remove"), "Apply analysis asset");
assert.equal(result.ok, true);
if (result.ok) {
  assert.equal(result.document.history.length, 0);
  assert.equal(result.document.drawings.length, 1);
}
