import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findPaperHoldingOverlay,
  formatPaperHoldingQuantity,
  paperHoldingOverlayLabel
} from "../src/chart/paperHoldingPrice";
import { buildChartScene } from "../src/chart/scene";
import type { ChartState } from "../src/chart/types";

const positions = [
  {
    symbol: "AMD",
    qty: 20,
    reserved_qty: 0,
    available_qty: 20,
    average_price: 552.75,
    current_price: 565,
    market_value: 11_300,
    cost_basis: 11_055,
    unrealized_pnl: 245,
    unrealized_pnl_rate: 2.22,
    realized_pnl: 0,
    price_source: "live_trade"
  },
  {
    symbol: "ZERO",
    qty: 0,
    reserved_qty: 0,
    available_qty: 0,
    average_price: 10,
    current_price: 10,
    market_value: 0,
    cost_basis: 0,
    unrealized_pnl: 0,
    unrealized_pnl_rate: 0,
    realized_pnl: 0,
    price_source: "average_price"
  }
];

assert.deepEqual(findPaperHoldingOverlay(positions, " amd "), {
  symbol: "AMD",
  quantity: 20,
  averagePrice: 552.75
});
assert.equal(findPaperHoldingOverlay(positions, "NVDA"), null);
assert.equal(findPaperHoldingOverlay(positions, "ZERO"), null);
assert.equal(findPaperHoldingOverlay([{ ...positions[0], average_price: Number.NaN }], "AMD"), null);
assert.equal(formatPaperHoldingQuantity(20), "20주");
assert.equal(formatPaperHoldingQuantity(0.125), "0.125주");
assert.equal(paperHoldingOverlayLabel({ symbol: "AMD", quantity: 20, averagePrice: 552.75 }), "평균 매입가 $552.75 · 20주");

const chartWithHolding = {
  symbol: "AMD",
  chartType: "candle",
  interval: "1D",
  candles: [{
    timestamp: "2026-07-15T04:00:00.000Z",
    open: 100,
    high: 102,
    low: 98,
    close: 101,
    volume: 1_000,
    isClosed: true
  }],
  status: "ready",
  layers: { candles: true },
  volumeRatio: 0.2,
  visibleCount: 20,
  rightOffset: 0,
  toolMode: "select",
  trendLineExtension: "segment",
  parallelLineCount: 2,
  drawings: [],
  comparisons: [],
  streamState: "idle",
  holdingOverlay: { symbol: "AMD", quantity: 20, averagePrice: 90 }
} satisfies ChartState;
const holdingScene = buildChartScene(chartWithHolding, 640, 360);
assert.ok(holdingScene.scales.minPrice <= 90);
assert.ok(holdingScene.scales.maxPrice >= 102);

const extremeHoldingScene = buildChartScene({
  ...chartWithHolding,
  holdingOverlay: { symbol: "AMD", quantity: 20, averagePrice: 1 }
}, 640, 360);
assert.ok(extremeHoldingScene.scales.minPrice > 10);

const chartCanvasSource = readFileSync(
  resolve(process.cwd(), "src/chart/ChartCanvas.tsx"),
  "utf-8"
);
const holdingMarkerSource = chartCanvasSource.slice(
  chartCanvasSource.indexOf("function drawHoldingAveragePriceMarker"),
  chartCanvasSource.indexOf("function currentPriceForScene")
);
assert.match(holdingMarkerSource, /drawDarkAxisPill\(context, paperHoldingOverlayLabel\(holding\), rightAxisPillX\(scene\), y, "right", colors\.pointYellow\)/);
assert.doesNotMatch(holdingMarkerSource, /scene\.plot\.left \+ 8/);
