import assert from "node:assert/strict";
import { createChartDocument, normalizeChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommand, makeChartCommand, validateChartProposal } from "../../chart-engine/src/commands";
import type { ChartProposal, DrawingEntity } from "../../chart-engine/src/types";
import { normalizeCzardasAssetsResponse, type CzardasPackContent } from "../src/chart/czardasAssetsApi";
import { czardasDeltaCommands } from "../src/chart/czardasLayerController";

const timestamp = "2026-07-10T20:00:00.000Z";
const target = { panelId: "panel-czardas", chartDocumentId: "doc-czardas" };

function managed(id: string, candidate: string, role: "hline" | "trend", group?: string): DrawingEntity {
  return {
    id,
    type: role === "hline" ? "horizontalLine" : "trendLine",
    anchors: [
      { timestamp: "2026-01-01T00:00:00.000Z", price: role === "hline" ? 100 : 98 },
      { timestamp, price: role === "hline" ? 100 : 104 }
    ],
    sourceInterval: "1D",
    style: { colorToken: "drawing", lineWidth: group ? 3 : 2, extension: role === "hline" ? "line" : "ray" },
    visible: true,
    createdBy: "system",
    ownership: "czardas-managed",
    czardasLayer: role,
    sourceCandidateId: candidate,
    sourceFieldModeId: `mode-${candidate}`,
    sourceFieldRevision: 1,
    sourceGroupId: group,
    engineRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

const upper = managed("czardas:upper:line", "upper", "trend", "triangle-1");
const lower = managed("czardas:lower:line", "lower", "trend", "triangle-1");
let document = {
  ...createChartDocument(target.chartDocumentId, "NVDA", "1D"),
  drawings: [upper, lower]
};

const fork = executeChartCommand(document, makeChartCommand("chart.czardas.forkManaged", "user", target, {
  drawingId: upper.id,
  drawingPatch: { style: { lineWidth: 1 } }
}));
assert.equal(fork.ok, true);
if (!fork.ok) throw new Error(fork.message);
assert.equal(fork.document.drawings.length, 2);
assert.ok(fork.document.drawings.every((item) => item.ownership === "czardas-fork"));
assert.equal(fork.document.drawings.find((item) => item.forkedFromDrawingId === upper.id)?.style.lineWidth, 1);
assert.equal(fork.document.drawings.find((item) => item.forkedFromDrawingId === lower.id)?.style.lineWidth, 3);
assert.deepEqual(fork.document.czardasSuppressions.map((item) => item.sourceCandidateId), ["lower", "upper"]);

const undone = executeChartCommand(fork.document, makeChartCommand("chart.undo", "user", target));
assert.equal(undone.ok, true);
if (!undone.ok) throw new Error(undone.message);
assert.ok(undone.document.drawings.every((item) => item.ownership === "czardas-managed"));
assert.equal(undone.document.czardasSuppressions.length, 0);
const redone = executeChartCommand(undone.document, makeChartCommand("chart.redo", "user", target));
assert.equal(redone.ok, true);
if (!redone.ok) throw new Error(redone.message);
assert.equal(redone.document.czardasSuppressions.length, 2);

const deleted = executeChartCommand(document, makeChartCommand("chart.czardas.deleteManaged", "user", target, { drawingId: upper.id }));
assert.equal(deleted.ok, true);
if (!deleted.ok) throw new Error(deleted.message);
assert.equal(deleted.document.drawings.length, 0);
assert.equal(deleted.document.czardasSuppressions.length, 2);
const restored = executeChartCommand(deleted.document, makeChartCommand("chart.czardas.restoreManaged", "user", target, {
  sourceGroupId: "triangle-1",
  drawings: [upper, lower]
}));
assert.equal(restored.ok, true);
if (!restored.ok) throw new Error(restored.message);
assert.equal(restored.document.drawings.length, 2);
assert.equal(restored.document.czardasSuppressions.length, 0);

const normalizedLegacy = normalizeChartDocument({
  ...createChartDocument("legacy", "NVDA", "1M"),
  chartType: "czardas"
});
assert.equal(normalizedLegacy.chartType, "candle");
const unavailableType = executeChartCommand(
  createChartDocument("monthly", "NVDA", "1M"),
  makeChartCommand("chart.type.set", "user", { panelId: "p", chartDocumentId: "monthly" }, { chartType: "czardas" })
);
assert.equal(unavailableType.ok, false);

const proposal: ChartProposal = {
  id: "proposal-czardas-internal",
  title: "Internal",
  rationale: "Must remain internal",
  summary: "",
  target,
  commands: [makeChartCommand("chart.czardas.deleteManaged", "llm", target, { drawingId: upper.id })],
  insights: [],
  status: "pending",
  createdAt: timestamp,
  createdByAgentId: "agent"
};
assert.match(validateChartProposal(proposal) ?? "", /Unsupported proposal command/);

const field = {
  schemaVersion: 1,
  sourceBars: 240,
  basisGlyphs: [],
  hlineResponseSegments: [],
  hlineProfileBins: [],
  hlineModes: [],
  trendModes: [],
  selectedModeRefs: [],
  validationGlyphs: []
};
const pack = {
  algorithmVersion: "czardas-v1",
  configVersion: "czardas-config-v1",
  timeContractVersion: "market-time-v1",
  calendarVersion: "nyse-calendar-v1",
  symbol: "NVDA",
  interval: "1D",
  asOf: timestamp,
  lastCandleKey: "2026-07-10",
  inputDigest: "sha256:input",
  status: "ready",
  coverage: { state: "exact", targetCompleted: 240, actualCompleted: 240, analysisBars: 240, qualityFlags: [] },
  selection: { hline: { configuredCount: 2, actualCount: 0 }, trend: { configuredCount: 2, actualCount: 2 } },
  boundaries: [],
  presentationPattern: null,
  drawings: [upper, lower],
  czardasField: field
} as CzardasPackContent;
const response = normalizeCzardasAssetsResponse({
  assetKind: "czardas",
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack } }
}, "NVDA");
assert.equal(response.assets["1D"].freshness, "current");
assert.equal(response.assets["1D"].pack?.drawings.length, 2);
assert.equal(response.assets["1m"].freshness, "missing");

const delta = czardasDeltaCommands(target, [], [], pack, { hline: true, trend: true }, { mode: "pan" });
assert.equal(delta.filter((item) => item.type === "chart.drawing.add").length, 2);
const staleDelta = czardasDeltaCommands(target, [], [], pack, { hline: true, trend: true }, { mode: "pan" }, true);
const staleDrawing = (staleDelta.find((item) => item.type === "chart.drawing.add")?.payload as any)?.drawing;
assert.equal(staleDrawing?.style?.opacity, 0.42);
const suppressedDelta = czardasDeltaCommands(target, [], [
  { sourceCandidateId: "upper", sourceGroupId: "triangle-1", suppressedAt: timestamp },
  { sourceCandidateId: "lower", sourceGroupId: "triangle-1", suppressedAt: timestamp }
], pack, { hline: true, trend: true }, { mode: "pan" });
assert.equal(suppressedDelta.length, 0);
