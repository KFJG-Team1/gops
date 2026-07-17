import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildChartTradeFillInsights,
  buildChartTradeMarkerInsights,
  chartTradeMarkersForScene,
  normalizeChartTradeFills,
  syncChartTradeMarkerPositions
} from "../src/chart/chartTradeMarkers";
import { buildChartScene, priceToY, slotCenterToX } from "../src/chart/scene";
import type { CandleDto, ChartState } from "../src/chart/types";

function candle(timestamp: string, close = 100): CandleDto {
  return {
    timestamp,
    open: close - 0.2,
    high: close + 0.4,
    low: close - 0.5,
    close,
    volume: 100,
    isClosed: true
  };
}

function chartState(overrides: Partial<ChartState>): ChartState {
  return {
    symbol: "AAPL",
    chartType: "candle",
    interval: "1D",
    candles: [],
    status: "ready",
    layers: { candles: true, volume: false, ma5: false, ma20: false, ma60: false },
    volumeRatio: 0.2,
    visibleCount: 20,
    rightOffset: 0,
    toolMode: "select",
    trendLineExtension: "segment",
    drawings: [],
    streamState: "idle",
    ...overrides
  };
}

const normalizedFills = normalizeChartTradeFills([
  {
    order_id: "paper-buy",
    status: "filled",
    symbol: "aapl",
    side: "buy",
    qty: "2",
    fill_price: "100.25",
    filled_at: "2026-07-15T14:35:00.000Z"
  },
  {
    order_id: "sim-sell",
    status: "filled",
    simulation: true,
    runId: "run-1",
    symbol: "AAPL",
    side: "sell",
    qty: 1,
    filled_price: 101.5,
    virtualFilledAt: "2026-07-15T15:05:00+00:00"
  },
  {
    order_id: "pending",
    status: "accepted",
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    price: 99,
    virtualSubmittedAt: "2026-07-15T15:05:00+00:00"
  },
  {
    order_id: "invalid-price",
    status: "filled",
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    fill_price: null,
    filled_at: "2026-07-15T14:35:00.000Z"
  }
]);

assert.deepEqual(normalizedFills, [
  {
    id: "paper-buy",
    symbol: "AAPL",
    side: "buy",
    quantity: 2,
    price: 100.25,
    filledAt: "2026-07-15T14:35:00.000Z",
    source: "paper",
    runId: undefined
  },
  {
    id: "sim-sell",
    symbol: "AAPL",
    side: "sell",
    quantity: 1,
    price: 101.5,
    filledAt: "2026-07-15T15:05:00+00:00",
    source: "simulation",
    runId: "run-1"
  }
]);

const dailyScene = buildChartScene(chartState({
  candles: [
    candle("2026-07-14T04:00:00.000Z", 99),
    candle("2026-07-15T04:00:00.000Z", 100),
    candle("2026-07-16T04:00:00.000Z", 102)
  ],
  visibleCount: 3
}), 800, 360);

const dailyFills = normalizeChartTradeFills([
  {
    order_id: "daily-buy-1",
    status: "filled",
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    fill_price: 100.1,
    filled_at: "2026-07-15T14:35:00.000Z"
  },
  {
    order_id: "daily-buy-2",
    status: "filled",
    symbol: "AAPL",
    side: "buy",
    qty: 3,
    fill_price: 100.2,
    filled_at: "2026-07-15T15:05:00.000Z"
  },
  {
    order_id: "daily-sell",
    status: "filled",
    symbol: "AAPL",
    side: "sell",
    qty: 2,
    fill_price: 100.3,
    filled_at: "2026-07-15T17:05:00.000Z"
  },
  {
    order_id: "other-symbol",
    status: "filled",
    symbol: "MSFT",
    side: "buy",
    qty: 1,
    fill_price: 500,
    filled_at: "2026-07-15T14:35:00.000Z"
  }
]);
const dailyMarkers = chartTradeMarkersForScene(dailyScene, dailyFills);
assert.equal(dailyMarkers.length, 2);
assert.deepEqual(dailyMarkers.map((marker) => marker.label), ["B", "S"]);
assert.deepEqual(dailyMarkers[0].fills.map((fill) => fill.id), ["daily-buy-1", "daily-buy-2"]);
assert.equal(dailyMarkers[0].fill.quantity, 4);
assert.equal(dailyMarkers[0].fill.price, 100.175);

const targetDailyUnit = dailyScene.semantic.units.find((unit) => (
  unit.kind === "candle" && unit.depth === 0 && unit.timestamp === "2026-07-15T04:00:00.000Z"
));
assert.ok(targetDailyUnit && targetDailyUnit.kind === "candle");
const targetDailyX = slotCenterToX(dailyScene, targetDailyUnit.slotCenter);
const expectedMarkerGap = 10;
assert.ok(dailyMarkers.every((marker) => marker.x === targetDailyX));
assert.equal(dailyMarkers[0].top, priceToY(dailyScene, targetDailyUnit.candle.low) + expectedMarkerGap);
assert.equal(dailyMarkers[1].top + 24, priceToY(dailyScene, targetDailyUnit.candle.high) - expectedMarkerGap);

const scaledMarkers = chartTradeMarkersForScene(
  dailyScene,
  dailyFills,
  { width: dailyScene.width / 0.8, height: dailyScene.height / 0.8 }
);
assert.equal(scaledMarkers[0].x, dailyMarkers[0].x / 0.8);
assert.equal(scaledMarkers[0].top, dailyMarkers[0].top / 0.8);

const intradayScene = buildChartScene(chartState({
  interval: "1h",
  candles: [
    candle("2026-07-15T13:30:00.000Z", 99),
    candle("2026-07-15T14:30:00.000Z", 100),
    candle("2026-07-15T15:30:00.000Z", 101)
  ],
  visibleCount: 3
}), 800, 360);
const intradayMarkers = chartTradeMarkersForScene(intradayScene, dailyFills);
assert.equal(intradayMarkers.length, 1);
assert.equal(intradayMarkers[0].fill.quantity, 4);
assert.equal(intradayMarkers[0].fill.price, 100.175);
const intradayTarget = intradayScene.semantic.units.find((unit) => (
  unit.kind === "candle" && unit.timestamp === "2026-07-15T14:30:00.000Z"
));
assert.ok(intradayTarget);
assert.ok(intradayMarkers.every((marker) => marker.x === slotCenterToX(intradayScene, intradayTarget.slotCenter)));

const movingTradeElement = {
  dataset: { chartTradeId: dailyMarkers[0].id },
  style: { left: "0px", top: "0px", visibility: "" }
};
const staleTradeElement = {
  dataset: { chartTradeId: "stale-trade" },
  style: { left: "10px", top: "10px", visibility: "" }
};
syncChartTradeMarkerPositions({
  querySelectorAll: () => [movingTradeElement, staleTradeElement]
} as unknown as ParentNode, [{ ...dailyMarkers[0], x: 222.5, top: 145.25 }]);
assert.deepEqual(movingTradeElement.style, { left: "222.5px", top: "145.25px", visibility: "" });
assert.equal(staleTradeElement.style.visibility, "hidden");

const insightFills = normalizeChartTradeFills([
  {
    order_id: "buy-at-100",
    status: "filled",
    symbol: "AAPL",
    side: "buy",
    qty: 2,
    fill_price: 100,
    filled_at: "2026-07-15T14:30:00.000Z"
  },
  {
    order_id: "buy-at-110",
    status: "filled",
    symbol: "AAPL",
    side: "buy",
    qty: 2,
    fill_price: 110,
    filled_at: "2026-07-15T14:31:00.000Z"
  },
  {
    order_id: "sell-at-120",
    status: "filled",
    symbol: "AAPL",
    side: "sell",
    qty: 3,
    fill_price: 120,
    filled_at: "2026-07-15T14:32:00.000Z"
  },
  {
    order_id: "sell-without-cost-basis",
    status: "filled",
    symbol: "MSFT",
    side: "sell",
    qty: 1,
    fill_price: 510,
    filled_at: "2026-07-15T14:33:00.000Z"
  }
]);
const fillInsights = buildChartTradeFillInsights(insightFills, 120);
assert.deepEqual(fillInsights.get("buy-at-100"), {
  kind: "mark_to_market",
  tone: "gain",
  amount: 40,
  percent: 20,
  basisPrice: 120
});
assert.deepEqual(fillInsights.get("buy-at-110"), {
  kind: "mark_to_market",
  tone: "gain",
  amount: 20,
  percent: 100 / 11,
  basisPrice: 120
});
assert.deepEqual(fillInsights.get("sell-at-120"), {
  kind: "realized",
  tone: "gain",
  amount: 45,
  percent: (15 / 105) * 100,
  basisPrice: 105
});
assert.deepEqual(fillInsights.get("sell-without-cost-basis"), {
  kind: "unavailable",
  tone: "unavailable",
  amount: null,
  percent: null,
  basisPrice: null
});
assert.equal(buildChartTradeFillInsights(insightFills, null).get("buy-at-100")?.kind, "unavailable");
assert.deepEqual(buildChartTradeFillInsights(insightFills, 90).get("buy-at-100"), {
  kind: "mark_to_market",
  tone: "loss",
  amount: -20,
  percent: -10,
  basisPrice: 90
});

const groupedInsightMarkers = chartTradeMarkersForScene(intradayScene, insightFills);
assert.equal(groupedInsightMarkers.length, 2);
const groupedMarkerInsights = buildChartTradeMarkerInsights(groupedInsightMarkers, insightFills, 120);
const groupedBuyMarker = groupedInsightMarkers.find((marker) => marker.side === "buy");
const groupedSellMarker = groupedInsightMarkers.find((marker) => marker.side === "sell");
assert.ok(groupedBuyMarker);
assert.ok(groupedSellMarker);
assert.deepEqual(groupedMarkerInsights.get(groupedBuyMarker.id), {
  kind: "mark_to_market",
  tone: "gain",
  amount: 60,
  percent: (15 / 105) * 100,
  basisPrice: 120
});
assert.deepEqual(groupedMarkerInsights.get(groupedSellMarker.id), {
  kind: "realized",
  tone: "gain",
  amount: 45,
  percent: (15 / 105) * 100,
  basisPrice: 105
});

const tradeOverlaySource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartTradeOverlay.tsx", import.meta.url)),
  "utf-8"
);
assert.match(tradeOverlaySource, /role="tooltip"/);
assert.match(tradeOverlaySource, /chart-trade-tooltip-pnl/);
assert.match(tradeOverlaySource, /평균 체결가/);
assert.match(tradeOverlaySource, /총 수량/);
assert.doesNotMatch(tradeOverlaySource, /title=\{description\}/);

const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8"
);
assert.match(stylesSource, /\.chart-trade-tooltip\s*\{/);
assert.match(stylesSource, /\.chart-trade-marker\s*\{[\s\S]*?cursor: default;/);
