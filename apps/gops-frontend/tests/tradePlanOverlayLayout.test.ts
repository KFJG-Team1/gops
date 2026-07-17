import assert from "node:assert/strict";
import { buildChartScene } from "../src/chart/scene";
import { buildTradePlanOverlayLayout, scaleTradePlanOverlayLayout, tradePlanOverlayContentKey } from "../src/chart/tradePlanOverlayLayout";
import type { ChartTradeSetup } from "../src/chart/chartTradeSetup";
import type { ChartState, DrawingEntity } from "../src/chart/types";

const candles = Array.from({ length: 60 }, (_, index) => ({
  timestamp: `2026-07-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1_000,
  isClosed: true
}));
const drawing: DrawingEntity = {
  id: "chart-plan:AAPL:1D:conditional:buy_candidate:risk",
  type: "riskRewardBox",
  anchors: [
    { logicalIndex: 59, price: 100, paneId: "price", symbol: "AAPL", interval: "1D" },
    { logicalIndex: 69, price: 99.9, paneId: "price", symbol: "AAPL", interval: "1D" },
    { logicalIndex: 69, price: 100.1, paneId: "price", symbol: "AAPL", interval: "1D" }
  ],
  style: { zoneSplit: true, proposalAction: "buy_candidate", labelPlacement: "none" },
  visible: true,
  createdBy: "system",
  createdAt: candles.at(-1)!.timestamp,
  updatedAt: candles.at(-1)!.timestamp
};
const chart: ChartState = {
  symbol: "AAPL",
  chartType: "candle",
  interval: "1D",
  candles,
  status: "ready",
  layers: { candles: true, volume: false, ma5: false, ma20: false, ma60: false },
  panes: [{ id: "price", heightRatio: 1 }],
  volumeRatio: .2,
  visibleCount: 60,
  rightOffset: -36,
  toolMode: "pan",
  trendLineExtension: "segment",
  parallelLineCount: 3,
  drawings: [drawing],
  comparisons: [],
  streamState: "idle"
};
const setup: ChartTradeSetup = {
  version: "chart-trade-setup-v1", action: "buy_candidate", sourceKind: "conditional", sourceInterval: "1D",
  entryPrice: 100, entryTrigger: 100, targetPrice: 100.1, stopPrice: 99.9, rewardRiskRatio: 1,
  signalAt: null, signalIndex: 59, patternId: "levels", patternKind: null, projectionBars: 10,
  reasons: ["prices_from_selected_h_lines"], drawingIds: { plan: drawing.id, signal: `${drawing.id}:signal` },
  priceSources: {
    entry: { label: "저항선", drawingIds: ["level-entry"], derivation: "level" },
    target: { label: "다음 저항선", drawingIds: ["level-target"], derivation: "level" },
    stop: { label: "지지선", drawingIds: ["level-stop"], derivation: "level" }
  },
  assetIdentity: { algorithmVersion: "v6", inputDigest: "sha256:test", asOf: candles.at(-1)!.timestamp }
};
const layout = buildTradePlanOverlayLayout(buildChartScene(chart, 800, 420), drawing, setup);
assert.ok(layout);
assert.equal(layout.labels.length, 3);
assert.ok(layout.boxRight - layout.boxLeft >= 144);
assert.deepEqual(layout.labels.map((label) => label.role).sort(), ["basis", "risk", "target"]);
assert.ok(layout.labels.some((label) => label.text === "진입 $100.00"));
assert.ok(layout.labels.some((label) => label.text === "목표 $100.10"));
assert.ok(layout.labels.every((label) => !/지지선|저항선/.test(label.text)));
assert.ok(layout.labels.every((label) => !/지지선|저항선/.test(label.ariaLabel)));
assert.deepEqual(layout.labels.find((label) => label.role === "target")?.sourceDrawingIds, ["level-target"]);
assert.ok(layout.labels.every((label) => label.left > layout.boxRight), "labels stay in a lane to the right of the Canvas box");
assert.ok(layout.labels.every((label) => label.connector.startX === layout.boxRight));
const sortedCenters = layout.labels.map((label) => label.centerY).sort((left, right) => left - right);
assert.ok(sortedCenters.every((center, index) => index === 0 || center - sortedCenters[index - 1] >= 24));
assert.equal(layout.labels.find((label) => label.role === "target")?.price, 100.1);
const scaledLayout = scaleTradePlanOverlayLayout(layout, { width: 800, height: 420 }, { width: 640, height: 336 });
assert.equal(scaledLayout.labels[0].left, layout.labels[0].left * .8);
assert.equal(scaledLayout.labels[0].desiredY, layout.labels[0].desiredY * .8);
assert.equal(scaledLayout.labels[0].connector.startX, layout.labels[0].connector.startX * .8);
assert.equal(tradePlanOverlayContentKey(scaledLayout), tradePlanOverlayContentKey(layout), "pan/zoom coordinates do not trigger React content replacement");

const sellDrawing: DrawingEntity = {
  ...drawing,
  id: "chart-plan:AAPL:1D:conditional:sell_candidate:risk",
  anchors: [
    { ...drawing.anchors[0], price: 100 },
    { ...drawing.anchors[1], price: 100.1 },
    { ...drawing.anchors[2], price: 99.9 }
  ],
  style: { ...drawing.style, proposalAction: "sell_candidate" }
};
const sellLayout = buildTradePlanOverlayLayout(
  buildChartScene({ ...chart, drawings: [sellDrawing] }, 800, 420),
  sellDrawing,
  {
    ...setup,
    action: "sell_candidate",
    entryPrice: 100,
    targetPrice: 99.9,
    stopPrice: 100.1,
    drawingIds: { ...setup.drawingIds, plan: sellDrawing.id },
    priceSources: {
      entry: { label: "지지선", drawingIds: ["level-entry"], derivation: "level" },
      target: { label: "다음 지지선", drawingIds: ["level-target"], derivation: "level" },
      stop: { label: "저항선", drawingIds: ["level-stop"], derivation: "level" }
    }
  }
);
assert.ok(sellLayout);
assert.ok(sellLayout.labels.some((label) => label.text === "매도 $100.00"));
assert.ok(sellLayout.labels.some((label) => label.text === "예상 하단 $99.90"));
assert.ok(sellLayout.labels.some((label) => label.text === "재검토 $100.10"));
assert.ok(sellLayout.labels.every((label) => !/지지선|저항선/.test(label.text)));
