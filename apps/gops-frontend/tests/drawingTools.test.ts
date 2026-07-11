import assert from "node:assert/strict";
import {
  createChartDocument,
  normalizeChartDocument,
  restoreChartDocumentSnapshot,
  snapshotChartDocument
} from "../../chart-engine/src/chartDocuments";
import { executeChartCommand, makeChartCommand } from "../../chart-engine/src/commands";
import {
  buildFibonacciLevelGeometry,
  fibonacciBandPolygons,
  parallelBandPolygons,
  riskRewardDirection,
  spatialTrendParallelOffsets,
  trendParallelOffsets
} from "../../chart-engine/src/drawingGeometry";
import {
  chartRuntimeReducer,
  createInitialChartRuntimeState,
  getChartDocumentForPanel
} from "../../chart-engine/src/runtime";
import {
  buildDraggedAnchors,
  drawingLabelLayout,
  drawingLabelPosition,
  hitTestDrawing,
  parallelBandsForDrawing,
  parallelLinesForDrawing,
  rangeResizeHandles,
  type DrawingDrag
} from "../src/chart/drawings";
import { buildChartScene, createCoordinateTransform, unitBoundsX, type ChartScene } from "../src/chart/scene";
import type { CandleDto, ChartState, DrawingAnchor, DrawingEntity } from "../src/chart/types";

const drawingCandles: CandleDto[] = Array.from({ length: 6 }, (_, index) => ({
  timestamp: `2026-07-10T13:${String(30 + index).padStart(2, "0")}:00.000Z`,
  open: 101 + index,
  high: 110,
  low: 96,
  close: 102 + index,
  volume: 1_000 + index * 100,
  isClosed: true
}));

const plot = { left: 0, right: 240, top: 0, priceBottom: 180 };
const baseStart = { x: 40, y: 60 };
const baseEnd = { x: 200, y: 100 };
const spacingPoint = { x: 40, y: 64 };
const baseDx = baseEnd.x - baseStart.x;
const baseDy = baseEnd.y - baseStart.y;
const baseLength = Math.hypot(baseDx, baseDy);
const normal = { x: -baseDy / baseLength, y: baseDx / baseLength };
const signedSpacing = (spacingPoint.x - baseStart.x) * normal.x + (spacingPoint.y - baseStart.y) * normal.y;

const legacyDocument = createChartDocument("legacy-parallel-count-document", "AAPL", "1m");
delete (legacyDocument.interactionState as { parallelLineCount?: number }).parallelLineCount;
const legacyPanel = {
  id: "legacy-parallel-count-panel",
  type: "chart",
  chartDocumentId: legacyDocument.id,
  props: { symbol: "AAPL", timeframe: "1m" }
};
const legacyRuntime = {
  ...createInitialChartRuntimeState(),
  documents: { [legacyDocument.id]: legacyDocument }
};
const loadedLegacyDocument = getChartDocumentForPanel(legacyRuntime, legacyPanel);
assert.equal(loadedLegacyDocument.interactionState.parallelLineCount, 3);
const normalizedLegacyRuntime = chartRuntimeReducer(legacyRuntime, {
  kind: "chart.ensureDocuments",
  panels: [legacyPanel]
});
assert.equal(normalizedLegacyRuntime.documents[legacyDocument.id]?.interactionState.parallelLineCount, 3);

const legacySnapshotSource = createChartDocument("legacy-snapshot-source", "AAPL", "1m");
legacySnapshotSource.interactionState.parallelLineCount = 7;
const legacySnapshot = snapshotChartDocument(legacySnapshotSource);
delete (legacySnapshot.interactionState as { parallelLineCount?: number }).parallelLineCount;
const restoredLegacyDocument = restoreChartDocumentSnapshot(legacySnapshotSource, legacySnapshot);
assert.equal(restoredLegacyDocument.interactionState.parallelLineCount, 3);

for (let lineCount = 2; lineCount <= 10; lineCount += 1) {
  const drawing = { type: "trendParallelLines" as const, parallelLineCount: lineCount };
  const lines = parallelLinesForDrawing(drawing, [baseStart, baseEnd, spacingPoint], plot);
  const bands = parallelBandsForDrawing(drawing, [baseStart, baseEnd, spacingPoint], plot);

  assert.equal(lines.length, lineCount, `${lineCount} trend-parallel lines should be rendered`);
  assert.equal(bands.length, lineCount - 1, `${lineCount} trend-parallel lines should create ${lineCount - 1} bands`);
  assert.ok(bands.every((band) => band.length === 4));

  lines.forEach(([start, end], index) => {
    const lineDx = end.x - start.x;
    const lineDy = end.y - start.y;
    assert.ok(Math.abs(lineDx * baseDy - lineDy * baseDx) < 0.000001, `line ${index} should remain parallel to the base trend`);
    assert.ok(lineDx * baseDx + lineDy * baseDy > 0, `line ${index} should retain the base direction`);
    const signedOffset = (start.x - baseStart.x) * normal.x + (start.y - baseStart.y) * normal.y;
    const offset = spatialTrendParallelOffsets(lineCount)[index];
    assert.ok(Math.abs(signedOffset - signedSpacing * offset) < 0.000001, `line ${index} should follow signed bidirectional spacing`);
  });
}

for (const lineCount of [2, 3, 6, 10]) {
  const offsets = trendParallelOffsets(lineCount);
  assert.equal(offsets.length, lineCount);
  assert.equal(offsets.filter((offset) => offset > 0).length, Math.ceil((lineCount - 1) / 2));
  assert.equal(offsets.filter((offset) => offset < 0).length, Math.floor((lineCount - 1) / 2));
  assert.ok(offsets.includes(0));
}
assert.deepEqual(trendParallelOffsets(6), [0, 1, -1, 2, -2, 3]);
assert.deepEqual(spatialTrendParallelOffsets(6), [-2, -1, 0, 1, 2, 3]);

const clippedBandPlot = { left: 0, right: 100, top: 0, priceBottom: 100 };
const [differentEdgeBand] = parallelBandPolygons([
  [{ x: 20, y: 0 }, { x: 100, y: 80 }],
  [{ x: 0, y: 20 }, { x: 80, y: 100 }]
], clippedBandPlot);
assert.ok(differentEdgeBand);
assert.equal(differentEdgeBand.length, 6, "lines that hit different plot edges should produce the full clipped hexagon");
assert.equal(Math.abs(polygonArea(differentEdgeBand)), 3_600);
[
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 100, y: 80 },
  { x: 100, y: 100 },
  { x: 80, y: 100 },
  { x: 0, y: 20 }
].forEach((point) => assert.ok(polygonHasPoint(differentEdgeBand, point), `clipped band should include (${point.x}, ${point.y})`));

const [outsideBoundaryBand] = parallelBandPolygons([
  [{ x: 0, y: 20 }, { x: 80, y: 100 }],
  [{ x: 0, y: 140 }, { x: 100, y: 240 }]
], clippedBandPlot);
assert.ok(outsideBoundaryBand);
assert.equal(outsideBoundaryBand.length, 3, "an outside boundary should clip the visible band to a plot-corner triangle");
assert.equal(Math.abs(polygonArea(outsideBoundaryBand)), 3_200);
outsideBoundaryBand.forEach((point) => {
  assert.ok(point.x >= clippedBandPlot.left && point.x <= clippedBandPlot.right);
  assert.ok(point.y >= clippedBandPlot.top && point.y <= clippedBandPlot.priceBottom);
});
[
  { x: 0, y: 20 },
  { x: 80, y: 100 },
  { x: 0, y: 100 }
].forEach((point) => assert.ok(polygonHasPoint(outsideBoundaryBand, point), `outside-boundary band should include (${point.x}, ${point.y})`));

const priceParallelLines = parallelLinesForDrawing(
  { type: "horizontalParallelLines" },
  [{ x: 35, y: 42 }, { x: 120, y: 118 }],
  plot
);
assert.deepEqual(priceParallelLines, [
  [{ x: plot.left, y: 42 }, { x: plot.right, y: 42 }],
  [{ x: plot.left, y: 118 }, { x: plot.right, y: 118 }]
]);
const priceParallelBands = parallelBandsForDrawing(
  { type: "horizontalParallelLines" },
  [{ x: 35, y: 42 }, { x: 120, y: 118 }],
  plot
);
assert.equal(priceParallelBands.length, 1);
assert.equal(Math.abs(polygonArea(priceParallelBands[0])), (plot.right - plot.left) * (118 - 42));

const timeParallelLines = parallelLinesForDrawing(
  { type: "verticalParallelLines" },
  [{ x: 52, y: 35 }, { x: 184, y: 120 }],
  plot
);
assert.deepEqual(timeParallelLines, [
  [{ x: 52, y: plot.top }, { x: 52, y: plot.priceBottom }],
  [{ x: 184, y: plot.top }, { x: 184, y: plot.priceBottom }]
]);
const timeParallelBands = parallelBandsForDrawing(
  { type: "verticalParallelLines" },
  [{ x: 52, y: 35 }, { x: 184, y: 120 }],
  plot
);
assert.equal(timeParallelBands.length, 1);
assert.equal(Math.abs(polygonArea(timeParallelBands[0])), (184 - 52) * (plot.priceBottom - plot.top));

const metadataDocument = createChartDocument("drawing-metadata-document", "AAPL", "5m");
metadataDocument.interactionState.mode = "draw-trendParallelLines";
const metadataAnchors = [
  drawingAnchor(0, 101, "1m"),
  drawingAnchor(2, 106, "5m"),
  drawingAnchor(1, 109, "10m")
];
const metadataResult = executeChartCommand(
  metadataDocument,
  makeChartCommand("chart.drawing.add", "user", chartTarget(metadataDocument.id), {
    drawing: {
      id: "trend-parallel-metadata",
      type: "trendParallelLines",
      anchors: metadataAnchors,
      sourceInterval: "1m",
      style: {
        colorToken: "drawing",
        fillToken: "drawing",
        fillOpacity: 0.037,
        lineWidth: 1.25
      },
      parallelLineCount: 7,
      visible: true,
      createdBy: "user",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    }
  })
);
assert.equal(metadataResult.ok, true);
if (!metadataResult.ok) {
  assert.fail(metadataResult.message);
}
const metadataDrawing = metadataResult.document.drawings[0];
assert.ok(metadataDrawing);
assert.equal(metadataResult.document.interactionState.mode, "select");
assert.equal(metadataResult.document.selectedDrawingId, "trend-parallel-metadata");
assert.deepEqual(metadataDrawing.anchors.map((anchor) => anchor.interval), ["1m", "5m", "10m"]);
assert.equal(metadataDrawing.sourceInterval, "1m");
assert.equal(metadataDrawing.style.fillOpacity, 0.037);
assert.equal(metadataDrawing.parallelLineCount, 7);

for (const extension of ["ray", "line"] as const) {
  const extensionDocument = createChartDocument(`drawing-${extension}-document`, "AAPL", "1m");
  const addResult = executeChartCommand(
    extensionDocument,
    makeChartCommand("chart.drawing.add", "user", chartTarget(extensionDocument.id), {
      drawing: {
        id: `trend-${extension}`,
        type: "trendLine",
        anchors: [drawingAnchor(0, 100), drawingAnchor(2, 104)],
        sourceInterval: "1m",
        style: {
          color: "#d4d4d8",
          lineWidth: 2.25,
          lineDash: [8, 3],
          fillColor: "#ffffff",
          fillOpacity: 0.021,
          textColor: "#fafafa",
          fontSize: 13,
          opacity: 0.82,
          extension
        },
        label: `${extension} trend`,
        visible: true,
        createdBy: "user",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z"
      }
    })
  );
  assert.equal(addResult.ok, true);
  if (!addResult.ok) {
    assert.fail(addResult.message);
  }
  const styleBeforeAnchorUpdate = structuredClone(addResult.document.drawings[0]?.style);
  const updateResult = executeChartCommand(
    addResult.document,
    makeChartCommand("chart.drawing.update", "user", chartTarget(extensionDocument.id), {
      drawingId: `trend-${extension}`,
      drawingPatch: {
        anchors: [drawingAnchor(1, 102, "5m"), drawingAnchor(4, 108, "5m")]
      }
    })
  );
  assert.equal(updateResult.ok, true);
  if (!updateResult.ok) {
    assert.fail(updateResult.message);
  }
  const updatedDrawing = updateResult.document.drawings[0];
  assert.deepEqual(updatedDrawing?.anchors.map((anchor) => anchor.interval), ["5m", "5m"]);
  assert.deepEqual(updatedDrawing?.style, styleBeforeAnchorUpdate);
  assert.equal(updatedDrawing?.style.extension, extension);
  assert.equal(updatedDrawing?.type, "trendLine");
  assert.equal(updatedDrawing?.sourceInterval, "1m");
}

const resizeHandles = rangeResizeHandles([{ x: 10, y: 20 }, { x: 110, y: 100 }]);
assert.equal(resizeHandles.length, 8);
assert.deepEqual(resizeHandles.map((item) => item.handle), ["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
assert.deepEqual(resizeHandles.find((item) => item.handle === "n")?.point, { x: 60, y: 20 });
assert.deepEqual(resizeHandles.find((item) => item.handle === "e")?.point, { x: 110, y: 60 });
assert.deepEqual(resizeHandles.find((item) => item.handle === "s")?.point, { x: 60, y: 100 });
assert.deepEqual(resizeHandles.find((item) => item.handle === "w")?.point, { x: 10, y: 60 });

const rangeDrawing: DrawingEntity = {
  id: "range-resize",
  type: "rangeBox",
  anchors: [drawingAnchor(1, 108), drawingAnchor(4, 98)],
  sourceInterval: "1m",
  style: { colorToken: "drawing", fillToken: "drawing", fillOpacity: 0.045, lineWidth: 1 },
  label: "Range",
  visible: true,
  createdBy: "user",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z"
};
const rangeScene = drawingScene([rangeDrawing], rangeDrawing.id);
const northResize = buildDraggedAnchors(
  rangeDrag(rangeDrawing, "n"),
  drawingAnchor(5, 110),
  rangeScene
);
assert.deepEqual(northResize.map(anchorTime), rangeDrawing.anchors.map(anchorTime));
assert.deepEqual(northResize.map((anchor) => anchor.price), [110, 98]);

const eastResize = buildDraggedAnchors(
  rangeDrag(rangeDrawing, "e"),
  drawingAnchor(5, 999),
  rangeScene
);
assert.deepEqual(eastResize.map((anchor) => anchor.price), rangeDrawing.anchors.map((anchor) => anchor.price));
assert.deepEqual(anchorTime(eastResize[0]), anchorTime(rangeDrawing.anchors[0]));
assert.deepEqual(anchorTime(eastResize[1]), anchorTime(drawingAnchor(5, 999)));

const reversedRangeDrawing: DrawingEntity = {
  ...rangeDrawing,
  id: "range-resize-reversed-diagonal",
  anchors: [drawingAnchor(1, 98), drawingAnchor(4, 108)]
};
const reversedRangeScene = drawingScene([reversedRangeDrawing], reversedRangeDrawing.id);
const reversedEastResize = buildDraggedAnchors(
  rangeDrag(reversedRangeDrawing, "e"),
  drawingAnchor(5, 999),
  reversedRangeScene
);
assert.deepEqual(
  reversedEastResize.map((anchor) => anchor.price),
  reversedRangeDrawing.anchors.map((anchor) => anchor.price),
  "east-only resize must not swap the diagonal anchors' prices"
);
assert.deepEqual(anchorTime(reversedEastResize[0]), anchorTime(reversedRangeDrawing.anchors[0]));
assert.deepEqual(anchorTime(reversedEastResize[1]), anchorTime(drawingAnchor(5, 999)));
const reversedNorthResize = buildDraggedAnchors(
  rangeDrag(reversedRangeDrawing, "n"),
  drawingAnchor(5, 111),
  reversedRangeScene
);
assert.deepEqual(reversedNorthResize.map(anchorTime), reversedRangeDrawing.anchors.map(anchorTime));
assert.deepEqual(reversedNorthResize.map((anchor) => anchor.price), [98, 111]);

const marketGapCandles = [
  "2026-07-10T13:30:00.000Z",
  "2026-07-13T13:30:00.000Z",
  "2026-07-14T13:30:00.000Z",
  "2026-07-15T13:30:00.000Z"
].map((timestamp, index): CandleDto => ({
  timestamp,
  open: 100 + index,
  high: 104 + index,
  low: 98 + index,
  close: 102 + index,
  volume: 1_000,
  isClosed: true
}));
const marketGapDrawing: DrawingEntity = {
  ...rangeDrawing,
  id: "market-gap-drag",
  type: "trendLine",
  anchors: [
    { ...drawingAnchor(0, 101), timestamp: marketGapCandles[0].timestamp },
    { ...drawingAnchor(1, 103), timestamp: marketGapCandles[1].timestamp }
  ]
};
const marketGapScene = drawingScene([marketGapDrawing], marketGapDrawing.id, marketGapCandles);
const marketGapDrag: DrawingDrag = {
  drawing: marketGapDrawing,
  anchor: marketGapDrawing.anchors[0],
  anchorIndex: null,
  startPoint: { x: 0, y: 0 },
  moved: true
};
const marketGapMoved = buildDraggedAnchors(
  marketGapDrag,
  { ...marketGapDrawing.anchors[1], price: marketGapDrawing.anchors[0].price },
  marketGapScene
);
assert.deepEqual(
  marketGapMoved.map((anchor) => anchor.timestamp),
  [marketGapCandles[1].timestamp, marketGapCandles[2].timestamp],
  "one snapped-bar drag across a weekend must remain one bar for every anchor"
);
assert.deepEqual(marketGapMoved.map((anchor) => anchor.logicalIndex), [1, 2]);

const sparseGapCandles = [
  marketGapCandles[0],
  { ...marketGapCandles[1], timestamp: "2026-07-10T13:34:00.000Z" }
];
const sparseGapScene = drawingScene([], undefined, sparseGapCandles);
const sparseGapUnit = sparseGapScene.semantic.units.find((unit) => unit.kind === "time-gap");
assert.ok(sparseGapUnit && sparseGapUnit.kind === "time-gap");
const sparseGapBounds = unitBoundsX(sparseGapScene, sparseGapUnit);
const sparseGapAnchor = createCoordinateTransform(sparseGapScene).pointToAnchor(
  sparseGapBounds.left + (sparseGapBounds.right - sparseGapBounds.left) * 0.5,
  sparseGapScene.plot.top + 20,
  "AAPL"
);
assert.equal(sparseGapUnit.missingSlots, 3);
assert.equal(sparseGapAnchor?.timestamp, "2026-07-10T13:32:00.000Z");
assert.equal(sparseGapAnchor?.logicalIndex, undefined);

const flagDrawing: DrawingEntity = {
  id: "flag-hit-test",
  type: "flagMarker",
  anchors: [drawingAnchor(2, 102)],
  sourceInterval: "1m",
  style: { colorToken: "drawing", fillToken: "drawing", lineDash: [3, 4], lineWidth: 1 },
  label: "실적 발표",
  visible: true,
  createdBy: "user",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z"
};
const flagScene = drawingScene([flagDrawing], flagDrawing.id);
const flagLabel = drawingLabelPosition(flagScene, flagDrawing);
assert.ok(flagLabel);
const labelHit = hitTestDrawing(flagScene, flagLabel.x + 2, flagLabel.y);
assert.equal(labelHit?.drawing.id, flagDrawing.id);
assert.equal(labelHit?.anchorIndex, null);

const flagPoint = createCoordinateTransform(flagScene).anchorToPoint(flagDrawing.anchors[0]);
assert.ok(flagPoint);
const parentPointHit = hitTestDrawing(flagScene, flagPoint.x, flagPoint.y);
assert.equal(parentPointHit?.drawing.id, flagDrawing.id);
assert.equal(parentPointHit?.anchorIndex, 0);

const flagStemHit = hitTestDrawing(flagScene, flagPoint.x, (flagScene.plot.top + flagPoint.y) / 2);
assert.equal(flagStemHit?.drawing.id, flagDrawing.id);
assert.equal(flagStemHit?.anchorIndex, null);

const emptyFlagDrawing = { ...flagDrawing, id: "flag-empty-label-hit-test", label: "" };
const emptyFlagScene = drawingScene([emptyFlagDrawing], emptyFlagDrawing.id);
const emptyFlagLabel = drawingLabelPosition(emptyFlagScene, emptyFlagDrawing);
assert.ok(emptyFlagLabel);
const emptyFlagHit = hitTestDrawing(emptyFlagScene, emptyFlagLabel.x + 8, emptyFlagLabel.y);
assert.equal(emptyFlagHit?.drawing.id, emptyFlagDrawing.id, "fallback flag tag must remain clickable after clearing its label");

assert.equal(riskRewardDirection(100, 95, 112), "long");
assert.equal(riskRewardDirection(100, 108, 90), "short");
assert.equal(riskRewardDirection(100, 95, 90), null);

for (const [id, prices] of [["long", [100, 95, 112]], ["short", [100, 108, 90]]] as const) {
  const document = createChartDocument(`risk-${id}`, "AAPL", "1m");
  const result = executeChartCommand(document, makeChartCommand("chart.drawing.add", "user", chartTarget(document.id), {
    drawing: {
      id: `risk-${id}`,
      type: "riskRewardBox",
      anchors: [drawingAnchor(0, prices[0]), drawingAnchor(4, prices[1]), drawingAnchor(2, prices[2])],
      style: {},
      visible: true
    }
  }));
  assert.equal(result.ok, true, `${id} risk/reward should be accepted`);
  if (!result.ok) assert.fail(result.message);
  assert.equal(result.document.drawings[0].anchors[2].timestamp, result.document.drawings[0].anchors[1].timestamp);
  assert.equal(result.document.drawings[0].anchors[2].logicalIndex, result.document.drawings[0].anchors[1].logicalIndex);
}

const invalidRiskDocument = createChartDocument("risk-invalid", "AAPL", "1m");
const invalidRiskResult = executeChartCommand(invalidRiskDocument, makeChartCommand("chart.drawing.add", "user", chartTarget(invalidRiskDocument.id), {
  drawing: {
    id: "risk-invalid",
    type: "riskRewardBox",
    anchors: [drawingAnchor(0, 100), drawingAnchor(4, 95), drawingAnchor(2, 90)],
    style: {},
    visible: true
  }
}));
assert.equal(invalidRiskResult.ok, false, "target on the stop side must be rejected");

const riskDrawing: DrawingEntity = {
  ...rangeDrawing,
  id: "risk-drag",
  type: "riskRewardBox",
  anchors: [drawingAnchor(0, 100), drawingAnchor(4, 95), drawingAnchor(4, 112)],
  label: undefined
};
const riskScene = drawingScene([riskDrawing], riskDrawing.id);
const movedStop = buildDraggedAnchors({
  drawing: riskDrawing,
  anchor: riskDrawing.anchors[1],
  anchorIndex: 1,
  startPoint: { x: 0, y: 0 },
  moved: true
}, drawingAnchor(3, 96), riskScene);
assert.equal(movedStop[1].price, 96);
assert.deepEqual(anchorTime(movedStop[2]), anchorTime(movedStop[1]), "Stop drag must synchronize Target time");
const rejectedStopCross = buildDraggedAnchors({
  drawing: riskDrawing,
  anchor: riskDrawing.anchors[1],
  anchorIndex: 1,
  startPoint: { x: 0, y: 0 },
  moved: true
}, drawingAnchor(3, 101), riskScene);
assert.deepEqual(rejectedStopCross, riskDrawing.anchors, "Stop cannot cross Entry after direction is fixed");
const movedTarget = buildDraggedAnchors({
  drawing: riskDrawing,
  anchor: riskDrawing.anchors[2],
  anchorIndex: 2,
  startPoint: { x: 0, y: 0 },
  moved: true
}, drawingAnchor(1, 115), riskScene);
assert.equal(movedTarget[2].price, 115);
assert.deepEqual(anchorTime(movedTarget[2]), anchorTime(riskDrawing.anchors[1]), "Target drag changes price only");

const fibUp = buildFibonacciLevelGeometry({ x: 10, y: 100 }, { x: 110, y: 0 });
const fibDown = buildFibonacciLevelGeometry({ x: 10, y: 0 }, { x: 110, y: 100 });
assert.equal(fibUp.length, 7);
assert.equal(fibDown.length, 7);
assert.equal(fibonacciBandPolygons(fibUp).length, 6);
assert.equal(fibUp.find((item) => item.level === 0.618)?.y, 38.2);
assert.equal(fibDown.find((item) => item.level === 0.618)?.y, 61.8);

const underLine: DrawingEntity = {
  ...rangeDrawing,
  id: "under-fill-horizontal",
  type: "horizontalLine",
  anchors: [drawingAnchor(2, 103)],
  label: undefined
};
const coveringRange: DrawingEntity = {
  ...rangeDrawing,
  id: "covering-range",
  anchors: [drawingAnchor(1, 108), drawingAnchor(4, 98)],
  label: undefined
};
const fillPassThroughScene = drawingScene([underLine, coveringRange]);
const transform = createCoordinateTransform(fillPassThroughScene);
const underLinePoint = transform.anchorToPoint(underLine.anchors[0]);
const coveringPoints = coveringRange.anchors.map((anchor) => transform.anchorToPoint(anchor));
assert.ok(underLinePoint && coveringPoints[0] && coveringPoints[1]);
const underLineLabel = drawingLabelLayout(fillPassThroughScene, underLine);
const longUnderLineLabel = drawingLabelLayout(fillPassThroughScene, underLine, "아주 긴 수평 기준선 설명");
assert.ok(underLineLabel && longUnderLineLabel);
assert.equal(underLineLabel.textAlign, "right");
assert.equal(underLineLabel.top + underLineLabel.height, underLinePoint.y - 2);
assert.equal(underLineLabel.left + underLineLabel.width, fillPassThroughScene.plot.right - 18);
assert.equal(longUnderLineLabel.left + longUnderLineLabel.width, underLineLabel.left + underLineLabel.width);
assert.ok(longUnderLineLabel.left < underLineLabel.left, "long H-Line text must grow leftward");
const fillHit = hitTestDrawing(fillPassThroughScene, (coveringPoints[0].x + coveringPoints[1].x) / 2, underLinePoint.y);
assert.equal(fillHit?.drawing.id, underLine.id, "range fill must pass hit-testing through to an underlying line");
const outlineHit = hitTestDrawing(fillPassThroughScene, coveringPoints[0].x, (coveringPoints[0].y + coveringPoints[1].y) / 2);
assert.equal(outlineHit?.drawing.id, coveringRange.id, "range outline must remain selectable");

const priceParallelDrawing: DrawingEntity = {
  ...rangeDrawing,
  id: "price-parallel-label",
  type: "horizontalParallelLines",
  anchors: [drawingAnchor(1, 108), drawingAnchor(4, 98)],
  label: "가격 구간"
};
const timeParallelDrawing: DrawingEntity = {
  ...rangeDrawing,
  id: "time-parallel-label",
  type: "verticalParallelLines",
  anchors: [drawingAnchor(1, 108), drawingAnchor(4, 98)],
  label: "시간 구간"
};
const labelScene = drawingScene([priceParallelDrawing, timeParallelDrawing]);
const priceLayout = drawingLabelLayout(labelScene, priceParallelDrawing);
const timeLayout = drawingLabelLayout(labelScene, timeParallelDrawing);
assert.ok(priceLayout && timeLayout);
assert.equal(priceLayout.boxStyle, "plain");
assert.equal(priceLayout.fontSize, 14);
assert.equal(priceLayout.left, labelScene.plot.left + 8);
assert.equal(timeLayout.boxStyle, "tag");
assert.ok(timeLayout.top + timeLayout.height <= labelScene.plot.priceBottom - 3);
for (const layout of [priceLayout, timeLayout]) {
  assert.ok(layout.left >= labelScene.plot.left);
  assert.ok(layout.left + layout.width <= labelScene.plot.right);
  assert.ok(layout.top >= labelScene.plot.top);
  assert.ok(layout.top + layout.height <= labelScene.plot.priceBottom);
}

const legacyPoint = {
  id: "legacy-point",
  type: "pointMarker",
  anchors: [drawingAnchor(1, 101)],
  style: {},
  visible: true,
  createdBy: "user",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z"
};
const pointDocument = createChartDocument("legacy-point-document", "AAPL", "1m") as unknown as Record<string, unknown>;
pointDocument.drawings = [legacyPoint];
pointDocument.selectedDrawingId = legacyPoint.id;
pointDocument.interactionState = { ...(pointDocument.interactionState as object), mode: "draw-pointMarker" };
const normalizedPointDocument = normalizeChartDocument(pointDocument as never);
assert.equal(normalizedPointDocument.drawings.length, 0);
assert.equal(normalizedPointDocument.selectedDrawingId, undefined);
assert.equal(normalizedPointDocument.interactionState.mode, "pan");
const pointSnapshot = { ...snapshotChartDocument(createChartDocument("point-history", "AAPL", "1m")), drawings: [legacyPoint], selectedDrawingId: legacyPoint.id };
const pointHistoryEntry = {
  id: "legacy-point-history",
  label: "legacy point",
  commandTypes: ["chart.drawing.add"],
  actor: "user",
  before: pointSnapshot,
  after: pointSnapshot,
  createdAt: "2026-07-10T00:00:00.000Z"
};
const pointHistoryDocument = createChartDocument("point-history", "AAPL", "1m") as unknown as Record<string, unknown>;
pointHistoryDocument.history = [pointHistoryEntry];
pointHistoryDocument.future = [pointHistoryEntry];
const normalizedPointHistory = normalizeChartDocument(pointHistoryDocument as never);
assert.equal(normalizedPointHistory.history[0].before.drawings.length, 0);
assert.equal(normalizedPointHistory.history[0].after.drawings.length, 0);
assert.equal(normalizedPointHistory.future[0].before.drawings.length, 0);
assert.equal(normalizedPointHistory.future[0].after.drawings.length, 0);

const pointRuntimeDocument = createChartDocument("point-runtime", "AAPL", "1m");
const retainedHorizontalLine = {
  ...legacyPoint,
  id: "retained-horizontal-line",
  type: "horizontalLine",
  label: "retained"
};
const pointRuntime = chartRuntimeReducer({
  ...createInitialChartRuntimeState(),
  documents: { [pointRuntimeDocument.id]: pointRuntimeDocument },
  pendingPreviewByDocumentId: {
    [pointRuntimeDocument.id]: { id: "legacy-point-preview", drawings: [legacyPoint, retainedHorizontalLine], comparisons: [], visible: true }
  },
  pendingProposals: [{
    id: "legacy-point-proposal",
    title: "legacy point",
    rationale: "cleanup",
    target: chartTarget(pointRuntimeDocument.id),
    commands: [
      makeChartCommand("chart.drawing.add", "llm", chartTarget(pointRuntimeDocument.id), { drawing: legacyPoint }),
      makeChartCommand("chart.drawing.add", "llm", chartTarget(pointRuntimeDocument.id), { drawing: retainedHorizontalLine })
    ],
    confidence: 1,
    status: "pending",
    createdAt: "2026-07-10T00:00:00.000Z"
  }]
} as never, {
  kind: "chart.ensureDocuments",
  panels: [{ id: "point-runtime-panel", type: "chart", chartDocumentId: pointRuntimeDocument.id, props: { symbol: "AAPL", timeframe: "1m" } }]
});
assert.deepEqual(pointRuntime.pendingPreviewByDocumentId[pointRuntimeDocument.id]?.drawings.map((drawing) => drawing.id), [retainedHorizontalLine.id]);
assert.equal(pointRuntime.pendingProposals.length, 1);
assert.equal(pointRuntime.pendingProposals[0].commands.length, 1);
assert.equal((pointRuntime.pendingProposals[0].commands[0].payload.drawing as { id?: string }).id, retainedHorizontalLine.id);
const rejectedPoint = executeChartCommand(
  createChartDocument("point-command-rejected", "AAPL", "1m"),
  makeChartCommand("chart.drawing.add", "user", chartTarget("point-command-rejected"), { drawing: legacyPoint })
);
assert.equal(rejectedPoint.ok, false, "new Point commands must be rejected");

function chartTarget(chartDocumentId: string) {
  return { panelId: "drawing-tools-panel", chartDocumentId };
}

function drawingAnchor(index: number, price: number, interval = "1m"): DrawingAnchor {
  return {
    timestamp: drawingCandles[index]?.timestamp,
    logicalIndex: index,
    price,
    paneId: "price",
    symbol: "AAPL",
    interval: interval as DrawingAnchor["interval"]
  };
}

function anchorTime(anchor: DrawingAnchor | undefined) {
  return {
    timestamp: anchor?.timestamp,
    logicalIndex: anchor?.logicalIndex,
    interval: anchor?.interval,
    symbol: anchor?.symbol,
    paneId: anchor?.paneId
  };
}

function rangeDrag(drawing: DrawingEntity, rangeHandle: DrawingDrag["rangeHandle"]): DrawingDrag {
  return {
    drawing,
    anchor: drawing.anchors[0],
    anchorIndex: null,
    startPoint: { x: 0, y: 0 },
    moved: false,
    rangeHandle
  };
}

function drawingScene(drawings: DrawingEntity[], selectedDrawingId?: string, candles = drawingCandles): ChartScene {
  const chart: ChartState = {
    symbol: "AAPL",
    chartType: "candle",
    interval: "1m",
    candles,
    status: "ready",
    layers: { candles: true, volume: false, ma5: false, ma20: false, ma60: false },
    panes: [{ id: "price", heightRatio: 1 }],
    volumeRatio: 0.2,
    visibleCount: candles.length,
    rightOffset: 0,
    toolMode: "select",
    trendLineExtension: "segment",
    parallelLineCount: 3,
    drawings,
    comparisons: [],
    selectedDrawingId,
    streamState: "idle"
  };
  return buildChartScene(chart, 640, 360);
}

function polygonArea(polygon: Array<{ x: number; y: number }>): number {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function polygonHasPoint(polygon: Array<{ x: number; y: number }>, expected: { x: number; y: number }): boolean {
  return polygon.some((point) => Math.abs(point.x - expected.x) < 0.000001 && Math.abs(point.y - expected.y) < 0.000001);
}
