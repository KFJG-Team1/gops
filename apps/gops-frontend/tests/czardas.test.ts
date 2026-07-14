import assert from "node:assert/strict";
import { createChartDocument, normalizeChartDocument } from "../../chart-engine/src/chartDocuments";
import { executeChartCommand, makeChartCommand, validateChartProposal } from "../../chart-engine/src/commands";
import type { ChartProposal, DrawingEntity } from "../../chart-engine/src/types";
import {
  czardasPanelSnapshotMatchesPack,
  normalizeCzardasAssetsResponse,
  type CzardasPackContent
} from "../src/chart/czardasAssetsApi";
import { czardasDeltaCommands, czardasRestoreCommands } from "../src/chart/czardasLayerController";
import { candleMeaningAtTimestamp, czardasMeaningFactorGroups } from "../src/chart/czardasMeaning";
import {
  czardasDetailedCandleStrength,
  czardasDenseCandleStrength,
  czardasHlineTraceHalfLength,
  czardasHlineTraceStrength,
  czardasRelationGeometry,
  czardasRenderableBasis,
  czardasSightMode,
  czardasTimestampPriceLine,
  czardasTimestampPricePoint,
  czardasValidationTone,
  czardasWindowX
} from "../src/chart/ChartCanvas";
import { buildChartScene, createCoordinateTransform, priceToY } from "../src/chart/scene";
import { czardasMeaningFactorKeys } from "../src/chart/types";

const timestamp = "2026-07-10T20:00:00.000Z";
const inferenceId = "sha256:inference-v3";
const target = { panelId: "panel-czardas", chartDocumentId: "doc-czardas" };

const groupedMeaningFactorKeys = czardasMeaningFactorGroups.flatMap((group) => group.keys);
assert.equal(groupedMeaningFactorKeys.length, 21);
assert.equal(new Set(groupedMeaningFactorKeys).size, groupedMeaningFactorKeys.length);
assert.deepEqual([...groupedMeaningFactorKeys].sort(), [...czardasMeaningFactorKeys].sort());
assert.deepEqual(czardasMeaningFactorGroups.map((group) => [group.channel, group.keys.length]), [
  ["shared", 11],
  ["hline", 7],
  ["trend", 3]
]);

const denseStrengths = { shared: 0.3, hline: 0.9, trend: 0.6, composite: 0.8 };
assert.equal(czardasSightMode(5.999), "dense");
assert.equal(czardasSightMode(6), "detail");
assert.equal(czardasSightMode(Number.NaN), "dense");
assert.ok(Math.abs(czardasDetailedCandleStrength(denseStrengths, { trend: true }) - 0.45) < 1e-12);
assert.equal(czardasDetailedCandleStrength(denseStrengths, { trend: false }), 0.3);
assert.equal(czardasHlineTraceStrength(0.3, 0), 0);
assert.ok(Math.abs(czardasHlineTraceStrength(0.3, 0.9) - 0.6) < 1e-12);
assert.equal(czardasHlineTraceHalfLength(0, 0), 3);
assert.equal(czardasHlineTraceHalfLength(1_000, 1), 18);
assert.ok(Math.abs(czardasHlineTraceHalfLength(6, 0.6) - 7.8) < 1e-12);
assert.equal(czardasDenseCandleStrength(denseStrengths, { hline: true, trend: true }), 0.8);
assert.equal(czardasDenseCandleStrength(denseStrengths, { hline: false, trend: false }), 0.3);
assert.equal(czardasDenseCandleStrength(denseStrengths, { hline: true, trend: false }), 0.6);
assert.ok(Math.abs(czardasDenseCandleStrength(denseStrengths, { hline: false, trend: true }) - 0.45) < 1e-12);
assert.equal(
  czardasDenseCandleStrength({ ...denseStrengths, hline: 0 }, { hline: false, trend: true }),
  czardasDenseCandleStrength({ ...denseStrengths, hline: 1 }, { hline: false, trend: true })
);
assert.equal(
  czardasDenseCandleStrength({ ...denseStrengths, trend: 0 }, { hline: true, trend: false }),
  czardasDenseCandleStrength({ ...denseStrengths, trend: 1 }, { hline: true, trend: false })
);
assert.equal(czardasValidationTone("confirmed_break"), "break");
assert.equal(czardasValidationTone("supported_response"), "evidence");
assert.equal(czardasValidationTone("break"), "evidence");

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
    sourceInferenceId: inferenceId,
    sourceCandidateId: candidate,
    sourceFieldModeId: `mode-${candidate}`,
    sourceFieldDerivationDigest: `sha256:mode-${candidate}`,
    sourceGroupId: group,
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

const fork = executeChartCommand(document, makeChartCommand("chart.czardas.forkManaged", "system", target, {
  drawingId: upper.id,
  drawingPatch: { style: { lineWidth: 1 } }
}));
assert.equal(fork.ok, true);
if (!fork.ok) throw new Error(fork.message);
assert.equal(fork.document.drawings.length, 2);
assert.ok(fork.document.drawings.every((item) => item.ownership === "czardas-fork"));
assert.equal(fork.document.drawings.find((item) => item.forkedFromDrawingId === upper.id)?.style.lineWidth, 1);
assert.equal(fork.document.drawings.find((item) => item.forkedFromDrawingId === lower.id)?.style.lineWidth, 3);
assert.equal(fork.document.czardasSuppressions.length, 3);
assert.deepEqual(
  fork.document.czardasSuppressions.filter((item) => item.sourceKind === "candidate").map((item) => item.sourceId),
  ["lower", "upper"]
);
assert.equal(new Set(fork.document.czardasSuppressions.map((item) => item.suppressionSetId)).size, 1);
assert.ok(fork.document.czardasSuppressions.every((item) => item.reason === "forked"));

const undone = executeChartCommand(fork.document, makeChartCommand("chart.undo", "user", target));
assert.equal(undone.ok, true);
if (!undone.ok) throw new Error(undone.message);
assert.ok(undone.document.drawings.every((item) => item.ownership === "czardas-managed"));
assert.equal(undone.document.czardasSuppressions.length, 0);
const redone = executeChartCommand(undone.document, makeChartCommand("chart.redo", "user", target));
assert.equal(redone.ok, true);
if (!redone.ok) throw new Error(redone.message);
assert.equal(redone.document.czardasSuppressions.length, 3);

const deleted = executeChartCommand(document, makeChartCommand("chart.czardas.deleteManaged", "system", target, { drawingId: upper.id }));
assert.equal(deleted.ok, true);
if (!deleted.ok) throw new Error(deleted.message);
assert.equal(deleted.document.drawings.length, 0);
assert.equal(deleted.document.czardasSuppressions.length, 3);
const rejectedUserRestore = executeChartCommand(deleted.document, makeChartCommand("chart.czardas.restoreManaged", "user", target, {
  sourceGroupId: "triangle-1",
  drawings: [upper, lower]
}));
assert.equal(rejectedUserRestore.ok, false);
assert.match(rejectedUserRestore.message, /system engine/);
const restored = executeChartCommand(deleted.document, makeChartCommand("chart.czardas.restoreManaged", "system", target, {
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
const directLlmInternal = executeChartCommand(document, makeChartCommand("chart.czardas.deleteManaged", "llm", target, { drawingId: upper.id }));
assert.equal(directLlmInternal.ok, false);
assert.match(directLlmInternal.message, /system engine/);
for (const type of ["chart.czardas.forkManaged", "chart.czardas.deleteManaged", "chart.czardas.restoreManaged"] as const) {
  for (const actor of ["user", "llm"] as const) {
    const denied = executeChartCommand(document, makeChartCommand(type, actor, target, {
      drawingId: upper.id,
      sourceCandidateId: upper.sourceCandidateId,
      drawings: [upper]
    }));
    assert.equal(denied.ok, false);
    assert.match(denied.message, /system engine/);
  }
}

const forgedManaged = { ...upper, id: "forged-managed", createdBy: "system" as const };
const forgedResult = executeChartCommand(createChartDocument("forged", "NVDA", "1D"), makeChartCommand(
  "chart.drawing.add",
  "user",
  { panelId: "panel-forged", chartDocumentId: "forged" },
  { drawing: forgedManaged }
));
assert.equal(forgedResult.ok, false);
assert.match(forgedResult.message, /Invalid drawing payload/);

const reservedIdForgery = executeChartCommand(createChartDocument("reserved", "NVDA", "1D"), makeChartCommand(
  "chart.drawing.add",
  "llm",
  { panelId: "panel-reserved", chartDocumentId: "reserved" },
  { drawing: {
    id: upper.id,
    type: upper.type,
    anchors: upper.anchors,
    style: upper.style,
    visible: true,
    createdBy: "llm",
    createdAt: timestamp,
    updatedAt: timestamp
  } }
));
assert.equal(reservedIdForgery.ok, false);
assert.match(reservedIdForgery.message, /reserved/);

const collision = executeChartCommand(document, makeChartCommand("chart.drawing.add", "system", target, { drawing: upper }));
assert.equal(collision.ok, false);
assert.match(collision.message, /collision/);
const incompleteManaged = executeChartCommand(createChartDocument("incomplete", "NVDA", "1D"), makeChartCommand(
  "chart.drawing.add",
  "system",
  { panelId: "panel-incomplete", chartDocumentId: "incomplete" },
  { drawing: { ...upper, sourceFieldModeId: undefined } }
));
assert.equal(incompleteManaged.ok, false);
assert.match(incompleteManaged.message, /Invalid drawing payload/);

const analysisTimestamps = Array.from({ length: 240 }, (_, index) => (
  new Date(Date.parse(timestamp) - (239 - index) * 86_400_000).toISOString()
));
const scaled = (value: number) => Array.from({ length: 240 }, () => value);
const packed = (value: number | null) => {
  const bytes = new Uint8Array(480);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 240; index += 1) view.setInt16(index * 2, value ?? -32768, false);
  return Buffer.from(bytes).toString("base64");
};
const rawFactorScales = {
  rangeAtr: 1000, absoluteReturnAtr: 1000, bodyFraction: 1000, lowerWickFraction: 1000,
  upperWickFraction: 1000, volumeRank: 1000, volumeZ: 1000, participation: 1000,
  localHighR2: 1000, localLowR2: 1000, localHighR5: 1000, localLowR5: 1000,
  localHighR13: 1000, localLowR13: 1000, supportProximity: 1000, resistanceProximity: 1000,
  lowerResidualAtr: 1000, upperResidualAtr: 1000, hlinePenetrationAtr: 1000, trendPenetrationAtr: 1000,
  reclaimStrength: 1000
};
const logFactorKeys = new Set(["rangeAtr", "absoluteReturnAtr", "lowerResidualAtr", "upperResidualAtr", "hlinePenetrationAtr", "trendPenetrationAtr"]);
const rawFactorTransforms = Object.fromEntries(Object.keys(rawFactorScales).map((key) => [key, logFactorKeys.has(key) ? "log1p" : "linear"]));
const rawFactorRanges = Object.fromEntries(Object.entries(rawFactorScales).map(([key, scale]) => {
  const limit = 32767 / scale;
  return [key, logFactorKeys.has(key) ? [0, Math.expm1(limit)] : [-limit, limit]];
}));
const line = (fromPrice: number, toPrice: number) => ({
  fromTimestamp: analysisTimestamps[0],
  fromPrice,
  toTimestamp: analysisTimestamps[239],
  toPrice
});
const trendMode = (candidate: "upper" | "lower", fromPrice: number, toPrice: number) => ({
  fieldModeId: `mode-${candidate}`,
  derivationDigest: `sha256:mode-${candidate}`,
  role: candidate,
  modeState: "coherent",
  windowFromTimestamp: analysisTimestamps[0],
  windowToTimestamp: analysisTimestamps[239],
  hypothesisMedoid: line(fromPrice, toPrice),
  boundaryEstimate: line(fromPrice, toPrice),
  ribbon: {
    fromTimestamp: analysisTimestamps[0],
    lowerFromPrice: fromPrice - 0.5,
    upperFromPrice: fromPrice + 0.5,
    toTimestamp: analysisTimestamps[239],
    lowerToPrice: toPrice - 0.5,
    upperToPrice: toPrice + 0.5
  },
  supportMass: 2,
  oppositionMass: 0.2,
  viewRole: "landscape_and_selected",
  contributorCount: 1,
  contributorBasisIndexes: [candidate === "upper" ? 0 : 1],
  representativeHypotheses: [{
    hypothesisId: `hyp-${candidate}`,
    sourceBasisIds: [],
    ...line(fromPrice, toPrice),
    seedMass: 1
  }]
});
const factorSeries = {
  rangeAtr: packed(Math.round(Math.log1p(.8) * 1000)), absoluteReturnAtr: packed(Math.round(Math.log1p(.3) * 1000)), bodyFraction: packed(500),
  lowerWickFraction: packed(250), upperWickFraction: packed(250), volumeRank: packed(600),
  volumeZ: packed(100), participation: packed(550), localHighR2: packed(200), localLowR2: packed(200),
  localHighR5: packed(240), localLowR5: packed(230), localHighR13: packed(280), localLowR13: packed(260),
  supportProximity: packed(400), resistanceProximity: packed(300), lowerResidualAtr: packed(Math.round(Math.log1p(.5) * 1000)),
  upperResidualAtr: packed(Math.round(Math.log1p(.6) * 1000)), hlinePenetrationAtr: packed(Math.round(Math.log1p(.2) * 1000)), trendPenetrationAtr: packed(Math.round(Math.log1p(.3) * 1000)),
  reclaimStrength: packed(450)
};
const normalizedFactorSeries = Object.fromEntries(Object.keys(factorSeries).map((key) => [key, packed(500)]));
const packedReasonMasks = (codes: number[]) => {
  const bytes = new Uint8Array(960);
  const view = new DataView(bytes.buffer);
  const mask = codes.reduce((value, code) => (value | (2 ** code)) >>> 0, 0);
  for (let index = 0; index < 240; index += 1) view.setUint32(index * 4, mask, false);
  return Buffer.from(bytes).toString("base64");
};
const selectedRefs = [
  { candidateId: "upper", sourceInferenceId: inferenceId, kind: "trend", sourceFieldModeId: "mode-upper", sourceFieldDerivationDigest: "sha256:mode-upper" },
  { candidateId: "lower", sourceInferenceId: inferenceId, kind: "trend", sourceFieldModeId: "mode-lower", sourceFieldDerivationDigest: "sha256:mode-lower" }
];
const boundary = (candidateId: "upper" | "lower", role: "upper" | "lower", price: number) => ({
  candidateId,
  sourceInferenceId: inferenceId,
  sourceFieldModeId: `mode-${candidateId}`,
  sourceFieldDerivationDigest: `sha256:mode-${candidateId}`,
  kind: "trend",
  role,
  evidenceState: "formed",
  isRelevantNow: true,
  formation: {
    initialFormationEpisodeIds: [`episode-${candidateId}-1`, `episode-${candidateId}-2`],
    fitEpisodeIds: [`episode-${candidateId}-1`, `episode-${candidateId}-2`],
    fitCount: 2,
    lastFitObservedAt: analysisTimestamps[120],
    fitEvidenceConfirmedAt: analysisTimestamps[122],
    seedQuality: .8
  },
  responses: { completedCount: 0, pendingCount: 0, lastInteractionAt: null, responseMass: 0 },
  rank: {
    rankScore: .8, responseCount: 0, responseMass: 0, responseBonus: 0, profileBonus: 0,
    integrityFactCount: 8, integrityEffectiveFactCount: 7.2, integrityCoverage: 1,
    bodyPenetrationCount: 1, closePenetrationCount: 0
  },
  line: { priceAtAsOf: price, slopePerBar: .01, zoneHalfWidth: .5 },
  explanation: { claim: "현재 추세 경계", because: ["구조적 endpoint"], against: [], state: "formed", invalidationCondition: "경계 이탈", dataQualifier: "OHLCV" }
});
const field = {
  schemaVersion: 3,
  inputContractVersion: "canonical-ohlcv-q8-v1",
  inferenceConfigDigest: "sha256:inference-config",
  projectionConfigDigest: "sha256:projection-config",
  sightProjectionVersion: "czardas-sight-v2",
  sightProjectionId: "sha256:sight-projection",
  sourceBars: 240,
  evaluationAsOf: timestamp,
  sourceInferenceId: inferenceId,
  windowFromTimestamp: analysisTimestamps[0],
  windowToTimestamp: analysisTimestamps[239],
  candleMeanings: {
    evaluationAsOf: timestamp,
    rawFactorScales,
    rawFactorTransforms,
    normalizedFactorScale: 1000,
    scoreScale: 1000,
    rawFactorEncoding: "int16-base64-be",
    normalizedFactorEncoding: "int16-base64-be",
    rawFactorNullSentinel: -32768,
    normalizedFactorNullSentinel: -32768,
    rawFactorRanges,
    rawFactorOverflowPolicy: "reject",
    candleKeys: analysisTimestamps.map((value) => value.slice(0, 10)),
    timestamps: analysisTimestamps,
    summaries: { shared: scaled(500), hline: scaled(450), trend: scaled(550), compositePercentile: scaled(500) },
    roles: { support: scaled(300), resistance: scaled(450), lower: scaled(400), upper: scaled(550) },
    factors: factorSeries,
    normalizedFactors: normalizedFactorSeries,
    availabilityMasks: scaled(7),
    phaseMasks: scaled(31),
    availabilityCodebook: { atr: 1, volumeBaseline: 2, rightContext: 4 },
    phaseCodebook: { geometryInput: 1, fit: 2, integrity: 4, response: 8, visualizationOnly: 16, confirmationPending: 32 },
    reasonCodebook: [{ code: 1, key: "range_expansion", label: "변동폭 확장", usage: "geometry_input", channel: "shared" }],
    reasonEncoding: "uint32-bitmask-base64-be",
    reasonMasks: packedReasonMasks([1])
  },
  basisFacts: {
    basisIds: ["basis-upper", "basis-lower"],
    roleCodes: [3, 2],
    observedIndexes: [120, 121],
    confirmedIndexes: [122, 123],
    endpointPrices: [104, 98],
    bodyEdgePrices: [103.5, 98.5],
    corridorLows: [103.5, 97.5],
    corridorHighs: [104.5, 98.5],
    roleMasses: [.8, .82],
    participations: [null, null],
    effectiveScales: [5, 5],
    roleCodebook: { support: 0, resistance: 1, lower: 2, upper: 3 }
  },
  basisGlyphs: [],
  hlineResponseSegments: [],
  hlineProfileBins: [],
  hlineModes: [],
  trendModes: [trendMode("upper", 104, 100), trendMode("lower", 98, 104)],
  selectedModeRefs: selectedRefs,
  derivationEpisodes: {
    candidateIndexes: [0, 0, 1, 1],
    candidateEpisodeOrdinals: [0, 1, 0, 1],
    contributionBasisIndexes: [0, 0, 1, 1],
    memberBasisIndexes: [[0], [0], [1], [1]],
    observedFromIndexes: [120, 124, 121, 125],
    observedToIndexes: [120, 124, 121, 125],
    confirmedIndexes: [122, 126, 123, 127],
    contributionIndexes: [120, 124, 121, 125],
    contributionPrices: [104, 104, 98, 98],
    corridorLows: [103.5, 103.5, 97.5, 97.5],
    corridorHighs: [104.5, 104.5, 98.5, 98.5],
    initialFormationMasks: [1, 1, 1, 1]
  },
  validationGlyphs: []
};
const pack = {
  algorithmVersion: "czardas-v3",
  configVersion: "czardas-config-v3",
  inputContractVersion: "canonical-ohlcv-q8-v1",
  timeContractVersion: "market-time-v1",
  calendarVersion: "nyse-calendar-v1",
  inferenceConfigDigest: "sha256:inference-config",
  projectionConfigDigest: "sha256:projection-config",
  sightProjectionVersion: "czardas-sight-v2",
  sightProjectionId: "sha256:sight-projection",
  symbol: "NVDA",
  interval: "1D",
  asOf: timestamp,
  lastCandleKey: "2026-07-10",
  inputDigest: "sha256:input",
  inferenceId,
  status: "ready",
  coverage: { state: "exact", targetCompleted: 240, actualCompleted: 240, analysisBars: 240, qualityFlags: [] },
  selection: { hline: { configuredCount: 2, actualCount: 0 }, trend: { configuredCount: 2, actualCount: 2 } },
  boundaries: [boundary("upper", "upper", 100), boundary("lower", "lower", 104)],
  presentationPattern: null,
  drawings: [upper, lower],
  czardasField: field
} as CzardasPackContent;
const response = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", freshnessReason: "identity_match", generatedAt: timestamp, pack } }
}, "NVDA");
assert.equal(response.assets["1D"].freshness, "current");
assert.equal(response.assets["1D"].pack?.drawings.length, 2);
assert.equal(response.assets["1m"].freshness, "missing");
const firstMeaning = candleMeaningAtTimestamp(response.assets["1D"].pack?.czardasField, analysisTimestamps[0]);
assert.equal(firstMeaning?.summaries.shared, 0.5);
assert.ok(Math.abs((firstMeaning?.factors.find((item) => item.key === "rangeAtr")?.raw ?? 0) - 0.8) < 0.002);
assert.equal(firstMeaning?.reasons[0]?.usage, "geometry_input");
analysisTimestamps.forEach((meaningTimestamp, index) => {
  const meaning = candleMeaningAtTimestamp(response.assets["1D"].pack?.czardasField, meaningTimestamp);
  assert.equal(meaning?.index, index, `missing hover meaning at candle ${index}`);
  assert.equal(meaning?.evaluationAsOf, timestamp);
});
assert.equal(candleMeaningAtTimestamp(response.assets["1D"].pack?.czardasField, "2099-01-01T00:00:00.000Z"), null);
assert.ok(!/fieldRevision|modelRevision|sourceFieldRevision|engineRevision/.test(JSON.stringify(pack)));
const mandatoryBasisOnly = czardasRenderableBasis({ ...response.assets["1D"].pack!.czardasField, basisGlyphs: [] });
assert.deepEqual(mandatoryBasisOnly.map((item) => item.basisId).sort(), ["basis-lower", "basis-upper"]);

const serializedResponse = JSON.stringify({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", freshnessReason: "identity_match", generatedAt: timestamp, pack } }
});
for (let index = 0; index < 20; index += 1) {
  const normalized = normalizeCzardasAssetsResponse(JSON.parse(serializedResponse), "NVDA");
  czardasDeltaCommands(target, [], [], normalized.assets["1D"].pack, { hline: true, trend: true }, { mode: "pan" });
}
const parseDeltaSamples = Array.from({ length: 100 }, () => {
  const started = performance.now();
  const normalized = normalizeCzardasAssetsResponse(JSON.parse(serializedResponse), "NVDA");
  czardasDeltaCommands(target, [], [], normalized.assets["1D"].pack, { hline: true, trend: true }, { mode: "pan" });
  return performance.now() - started;
}).sort((left, right) => left - right);
const parseDeltaP95 = parseDeltaSamples[Math.ceil(parseDeltaSamples.length * .95) - 1];
assert.ok(parseDeltaP95 <= 8, `Czardas parse+delta P95 ${parseDeltaP95.toFixed(3)}ms exceeded 8ms`);
console.log(`Czardas parse+delta P95 ${parseDeltaP95.toFixed(3)}ms`);

const coordinateCandles = analysisTimestamps.map((value, index) => ({
  timestamp: value,
  open: 100 + index * 0.02,
  high: 101 + index * 0.02,
  low: 99 + index * 0.02,
  close: 100.4 + index * 0.02,
  volume: 1000,
  isClosed: true
}));
const panelDigestPack = {
  ...pack,
  inputDigest: "sha256:410cfc68a4f86a1b8e175bae02242db0780fe6cc1788f6f5a29bada77c0b0326"
};
const canonicalSnapshot = {
  inputContractVersion: "canonical-ohlcv-q8-v1" as const,
  asOf: panelDigestPack.asOf,
  lastCandleKey: panelDigestPack.lastCandleKey,
  completedCount: 240 as const,
  inputDigest: panelDigestPack.inputDigest
};
assert.equal(await czardasPanelSnapshotMatchesPack(panelDigestPack, canonicalSnapshot, coordinateCandles), true);
assert.equal(await czardasPanelSnapshotMatchesPack(panelDigestPack, { ...canonicalSnapshot, inputDigest: "sha256:changed" }, coordinateCandles), false);
assert.equal(await czardasPanelSnapshotMatchesPack(panelDigestPack, canonicalSnapshot, coordinateCandles.slice(1)), false);
const coordinateState = {
  symbol: "NVDA",
  chartType: "czardas",
  interval: "1D",
  candles: coordinateCandles,
  status: "ready",
  layers: { candles: true, volume: false },
  volumeRatio: 0.2,
  visibleCount: 120,
  rightOffset: -12,
  toolMode: "pan",
  trendLineExtension: "segment",
  parallelLineCount: 3,
  drawings: [upper, lower],
  comparisons: [],
  streamState: "idle"
} as any;
const latestScene = buildChartScene(coordinateState, 800, 420);
const pannedScene = buildChartScene({ ...coordinateState, rightOffset: 36 }, 800, 420);
const testLine = line(98, 104);
const latestLine = czardasTimestampPriceLine(latestScene, testLine);
const pannedLine = czardasTimestampPriceLine(pannedScene, testLine);
assert.ok(latestLine && pannedLine);
assert.equal(latestLine?.fromX, createCoordinateTransform(latestScene).timestampToX(testLine.fromTimestamp));
assert.equal(pannedLine?.toX, createCoordinateTransform(pannedScene).timestampToX(testLine.toTimestamp));
assert.notEqual(latestLine?.toX, pannedLine?.toX);
const latestWindow = czardasWindowX(latestScene, field.windowFromTimestamp, field.windowToTimestamp);
const pannedWindow = czardasWindowX(pannedScene, field.windowFromTimestamp, field.windowToTimestamp);
assert.ok(latestWindow && pannedWindow);
assert.notEqual(latestWindow?.toX, pannedWindow?.toX);
const relation = { upperCandidateId: "upper", lowerCandidateId: "lower", relationFrom: analysisTimestamps[120] };
const latestRelation = czardasRelationGeometry(latestScene, relation);
const pannedRelation = czardasRelationGeometry(pannedScene, relation);
assert.ok(latestRelation && pannedRelation);
assert.equal(latestRelation?.x, createCoordinateTransform(latestScene).timestampToX(analysisTimestamps[120]));
assert.notEqual(latestRelation?.x, pannedRelation?.x);

const assertPixelAligned = (actual: number | null | undefined, expected: number | null | undefined) => {
  assert.ok(actual !== null && actual !== undefined && expected !== null && expected !== undefined);
  assert.ok(Math.abs(actual - expected) <= 0.5, `coordinate drift ${actual} vs ${expected}`);
};
for (const [width, height] of [[640, 360], [960, 520], [1280, 720]] as const) {
  for (const visibleCount of [60, 120, 240]) {
    for (const rightOffset of [-36, 0, 48]) {
      const scene = buildChartScene({ ...coordinateState, visibleCount, rightOffset }, width, height);
      const transform = createCoordinateTransform(scene);
      const projectedLine = czardasTimestampPriceLine(scene, testLine);
      assert.ok(projectedLine);
      assertPixelAligned(projectedLine?.fromX, transform.timestampToX(testLine.fromTimestamp));
      assertPixelAligned(projectedLine?.toX, transform.timestampToX(testLine.toTimestamp));
      assertPixelAligned(projectedLine?.fromY, priceToY(scene, testLine.fromPrice));
      assertPixelAligned(projectedLine?.toY, priceToY(scene, testLine.toPrice));

      const projectedWindow = czardasWindowX(scene, field.windowFromTimestamp, field.windowToTimestamp);
      const firstX = transform.timestampToX(field.windowFromTimestamp);
      const lastX = transform.timestampToX(field.windowToTimestamp);
      assert.ok(projectedWindow && firstX !== null && lastX !== null);
      assertPixelAligned(projectedWindow?.fromX, Math.min(firstX!, lastX!));
      assertPixelAligned(projectedWindow?.toX, Math.max(firstX!, lastX!));

      for (const basis of czardasRenderableBasis(field as any)) {
        const projected = czardasTimestampPricePoint(scene, basis.observedAt, basis.endpointPrice);
        assert.ok(projected);
        assertPixelAligned(projected?.x, transform.timestampToX(basis.observedAt));
        assertPixelAligned(projected?.y, priceToY(scene, basis.endpointPrice));
      }
    }
  }
}

const malformedField = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    czardasField: {
      ...field,
      trendModes: field.trendModes.map((mode, index) => index === 0
        ? { ...mode, boundaryEstimate: undefined }
        : mode)
    }
  } } }
}, "NVDA");
assert.equal(malformedField.assets["1D"].freshness, "incompatible");
assert.equal(malformedField.assets["1D"].pack, null);

const forbiddenRevisionContract = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    czardasField: {
      ...field,
      trendModes: [{ ...field.trendModes[0], fieldRevision: 1 }, field.trendModes[1]]
    }
  } } }
}, "NVDA");
assert.equal(forbiddenRevisionContract.assets["1D"].freshness, "incompatible");

const forbiddenHistoricalMeaning = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    czardasField: {
      ...field,
      trendModes: [{ ...field.trendModes[0], originFieldModeId: "legacy" }, field.trendModes[1]]
    }
  } } }
}, "NVDA");
assert.equal(forbiddenHistoricalMeaning.assets["1D"].freshness, "incompatible");

const freshnessForPack = (candidatePack: CzardasPackContent) => normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: candidatePack } }
}, "NVDA").assets["1D"].freshness;

assert.equal(freshnessForPack({
  ...pack,
  sightProjectionVersion: "czardas-sight-v1"
}), "incompatible");

assert.equal(freshnessForPack({
  ...pack,
  czardasField: {
    ...field,
    trendModes: [
      { ...field.trendModes[0], contributorCount: 2, contributorBasisIndexes: [0, 0] },
      field.trendModes[1]
    ]
  }
}), "incompatible");
assert.equal(freshnessForPack({
  ...pack,
  czardasField: {
    ...field,
    trendModes: [
      { ...field.trendModes[0], contributorBasisIndexes: [1] },
      field.trendModes[1]
    ]
  }
}), "incompatible");
assert.equal(freshnessForPack({
  ...pack,
  czardasField: {
    ...field,
    derivationEpisodes: {
      ...field.derivationEpisodes,
      memberBasisIndexes: [[0, 0], [0], [1], [1]]
    }
  }
}), "incompatible");
assert.equal(freshnessForPack({
  ...pack,
  czardasField: {
    ...field,
    derivationEpisodes: {
      ...field.derivationEpisodes,
      contributionBasisIndexes: [1, 0, 1, 1],
      memberBasisIndexes: [[1], [0], [1], [1]]
    }
  }
}), "incompatible");

const incompatibleRawScale = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    czardasField: {
      ...field,
      candleMeanings: {
        ...field.candleMeanings,
        rawFactorScales: { ...field.candleMeanings.rawFactorScales, bodyFraction: 2000 }
      }
    }
  } } }
}, "NVDA");
assert.equal(incompatibleRawScale.assets["1D"].freshness, "incompatible");

const oversizedPack = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    rejectSummary: { oversized: "x".repeat(97 * 1024) }
  } } }
}, "NVDA");
assert.equal(oversizedPack.assets["1D"].freshness, "incompatible");

const incompatibleTimeContract = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    timeContractVersion: "environment-time"
  } } }
}, "NVDA");
assert.equal(incompatibleTimeContract.assets["1D"].freshness, "incompatible");
assert.equal(incompatibleTimeContract.assets["1D"].pack, null);

const forgedPackProvenance = normalizeCzardasAssetsResponse({
  symbol: "NVDA",
  assets: { "1D": { freshness: "current", generatedAt: timestamp, pack: {
    ...pack,
    drawings: [{ ...upper, createdBy: "user" }, lower]
  } } }
}, "NVDA");
assert.equal(forgedPackProvenance.assets["1D"].freshness, "incompatible");
assert.equal(forgedPackProvenance.assets["1D"].pack, null);

const delta = czardasDeltaCommands(target, [], [], pack, { hline: true, trend: true }, { mode: "pan" });
assert.equal(delta.filter((item) => item.type === "chart.drawing.add").length, 2);
const restoreCommands = czardasRestoreCommands(target, deleted.document.czardasSuppressions, pack);
assert.equal(restoreCommands.length, 1);
assert.equal((restoreCommands[0]?.payload as Record<string, unknown>).sourceKind, "group");
const restoredByUiCommand = executeChartCommand(deleted.document, restoreCommands[0]!);
assert.equal(restoredByUiCommand.ok, true);
if (!restoredByUiCommand.ok) throw new Error(restoredByUiCommand.message);
assert.equal(restoredByUiCommand.document.czardasSuppressions.length, 0);
assert.equal(restoredByUiCommand.document.drawings.length, 0);
assert.equal(czardasDeltaCommands(
  target,
  restoredByUiCommand.document.drawings,
  restoredByUiCommand.document.czardasSuppressions,
  pack,
  { hline: true, trend: true },
  { mode: "pan" }
).filter((item) => item.type === "chart.drawing.add").length, 2);
const updatedAt = "2026-07-11T20:00:00.000Z";
const rederivedUpper = { ...upper, sourceFieldDerivationDigest: "sha256:mode-upper-next", sourceGroupId: undefined, updatedAt };
const derivationDelta = czardasDeltaCommands(
  target,
  [upper],
  [],
  { ...pack, drawings: [rederivedUpper] },
  { hline: true, trend: true },
  { mode: "pan" }
);
const derivationUpdate = derivationDelta.find((item) => item.type === "chart.drawing.update");
assert.ok(derivationUpdate);
if (!derivationUpdate) throw new Error("expected derivation update");
const derivationResult = executeChartCommand(document, derivationUpdate);
assert.equal(derivationResult.ok, true);
if (!derivationResult.ok) throw new Error(derivationResult.message);
const rederivedDrawing = derivationResult.document.drawings.find((item) => item.id === upper.id);
assert.equal(rederivedDrawing?.sourceFieldDerivationDigest, "sha256:mode-upper-next");
assert.equal(rederivedDrawing?.sourceGroupId, undefined);
assert.equal(rederivedDrawing?.updatedAt, updatedAt);
const staleDelta = czardasDeltaCommands(target, [], [], pack, { hline: true, trend: true }, { mode: "pan" }, true);
const staleDrawing = (staleDelta.find((item) => item.type === "chart.drawing.add")?.payload as any)?.drawing;
assert.equal(staleDrawing?.style?.opacity, 0.42);
const suppressedDelta = czardasDeltaCommands(target, [], [
  { suppressionSetId: "set-triangle", sourceKind: "group", sourceId: "triangle-1", sourceGroupId: "triangle-1", reason: "deleted", createdAt: timestamp },
  { suppressionSetId: "set-triangle", sourceKind: "candidate", sourceId: "upper", sourceCandidateId: "upper", sourceGroupId: "triangle-1", reason: "deleted", createdAt: timestamp },
  { suppressionSetId: "set-triangle", sourceKind: "candidate", sourceId: "lower", sourceCandidateId: "lower", sourceGroupId: "triangle-1", reason: "deleted", createdAt: timestamp }
], pack, { hline: true, trend: true }, { mode: "pan" });
assert.equal(suppressedDelta.length, 0);
