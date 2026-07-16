import assert from "node:assert/strict";
import {
  findPaperHoldingOverlay,
  formatPaperHoldingQuantity,
  paperHoldingOverlayLabel
} from "../src/chart/paperHoldingPrice";

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

