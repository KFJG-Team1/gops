import assert from "node:assert/strict";
import {
  analysisLevelPriceTargetsEqual,
  analysisLevelPriceTargetsForScene
} from "../src/chart/analysisLevelPriceTargets";
import { buildChartScene } from "../src/chart/scene";
import type { ChartState, DrawingEntity } from "../src/chart/types";

const timestamp = "2026-07-15T04:00:00.000Z";
const baseDrawing = {
  anchors: [{ timestamp, price: 100 }],
  symbol: "AMD",
  interval: "1D",
  sourceInterval: "1D",
  style: { colorToken: "evidenceSupport", lineWidth: 2, opacity: 0.88, labelPlacement: "axis" },
  label: "지지",
  locked: false,
  visible: true,
  createdBy: "system",
  sourceProposalId: "chart-asset:AMD:1D:geometry",
  createdAt: timestamp,
  updatedAt: timestamp
} satisfies Omit<DrawingEntity, "id" | "type">;

const drawings: DrawingEntity[] = [
  { ...baseDrawing, id: "chart-asset:AMD:1D:support", type: "horizontalLine" },
  {
    ...baseDrawing,
    id: "chart-asset:AMD:1D:resistance",
    type: "horizontalLine",
    anchors: [{ timestamp, price: 105.25 }],
    style: { ...baseDrawing.style, colorToken: "evidenceResistance" },
    label: "저항"
  },
  {
    ...baseDrawing,
    id: "chart-asset:AMD:1D:hidden-support",
    type: "horizontalLine",
    anchors: [{ timestamp, price: 98 }],
    visible: false
  },
  {
    ...baseDrawing,
    id: "chart-asset:AMD:1D:outside-support",
    type: "horizontalLine",
    anchors: [{ timestamp, price: 150 }]
  },
  {
    ...baseDrawing,
    id: "chart-asset:AMD:1D:trend",
    type: "trendLine",
    anchors: [{ timestamp, price: 99 }, { timestamp, logicalIndex: 1, price: 103 }]
  },
  {
    ...baseDrawing,
    id: "user-horizontal-line",
    type: "horizontalLine",
    anchors: [{ timestamp, price: 101 }],
    createdBy: "user",
    sourceProposalId: undefined,
    style: { colorToken: "drawing", lineWidth: 1, opacity: 1, labelPlacement: "axis" }
  }
];

const chart = {
  symbol: "AMD",
  chartType: "candle",
  interval: "1D",
  candles: [
    { timestamp, open: 100, high: 108, low: 94, close: 102, volume: 1_000, isClosed: true },
    { timestamp: "2026-07-16T04:00:00.000Z", open: 102, high: 109, low: 96, close: 104, volume: 1_200, isClosed: true }
  ],
  status: "ready",
  layers: { candles: true },
  volumeRatio: 0.2,
  visibleCount: 20,
  rightOffset: 0,
  toolMode: "select",
  trendLineExtension: "segment",
  parallelLineCount: 2,
  drawings,
  comparisons: [],
  streamState: "idle",
  holdingOverlay: null
} satisfies ChartState;

const scene = buildChartScene(chart, 640, 360);
const measure = (text: string) => text.length * 6;
const targets = analysisLevelPriceTargetsForScene(scene, null, [], measure);

assert.deepEqual(targets.map((target) => ({
  id: target.drawingId,
  label: target.label,
  tone: target.tone,
  price: target.price,
  formattedPrice: target.formattedPrice
})), [
  { id: "chart-asset:AMD:1D:support", label: "지지", tone: "support", price: 100, formattedPrice: "100.00" },
  { id: "chart-asset:AMD:1D:resistance", label: "저항", tone: "resistance", price: 105.25, formattedPrice: "105.25" }
]);
assert.ok(targets.every((target) => target.bounds.width < scene.width - scene.plot.right));
assert.ok(targets.every((target) => target.bounds.left >= scene.plot.right));
assert.ok(targets.every((target) => target.bounds.height === 17));

const spotlightTargets = analysisLevelPriceTargetsForScene(
  scene,
  null,
  ["chart-asset:AMD:1D:hidden-support"],
  measure
);
assert.deepEqual(
  spotlightTargets.map((target) => target.drawingId),
  [
    "chart-asset:AMD:1D:support",
    "chart-asset:AMD:1D:resistance",
    "chart-asset:AMD:1D:hidden-support"
  ]
);
assert.equal(analysisLevelPriceTargetsEqual(targets, targets.map((target) => ({ ...target, bounds: { ...target.bounds } }))), true);
assert.equal(analysisLevelPriceTargetsEqual(targets, targets.slice(0, 1)), false);
