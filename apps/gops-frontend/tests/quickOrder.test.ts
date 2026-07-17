import assert from "node:assert/strict";

import type { OrderFlowMinuteDto } from "../src/chart/orderFlow";
import {
  baseQuickOrderIntents,
  deltaTone,
  imbalanceCandidates,
  normalizeSimulatorQuickOrderQuote,
  normalizeQuickOrderPrice,
  normalizedDelta,
  quoteIsUsable
} from "../src/orders/quickOrderModel";
import {
  orderBalancePath,
  orderRiskPath,
  orderSubmitPath,
  resolveQuickOrderExecutionMode
} from "../src/orders/orderClient";

const quote = { bidPrice: 100, askPrice: 100.01, bidSize: 4, askSize: 6, timestamp: "2026-07-13T11:59:59.000Z" };

assert.equal(quoteIsUsable(quote), true);
assert.equal(quoteIsUsable({ ...quote, timestamp: "2026-07-13T11:00:00.000Z" }), true);
assert.equal(quoteIsUsable({ ...quote, bidPrice: 101 }), false);
assert.equal(quoteIsUsable({ ...quote, askPrice: undefined }), false);
assert.equal(normalizeQuickOrderPrice(100.009), 100.01);

const intents = baseQuickOrderIntents(quote);
assert.deepEqual(intents.map((item) => [item.side, item.price, item.source]), [
  ["buy", 100, "best-bid"],
  ["sell", 100.01, "best-ask"],
  ["buy", 99.99, "bid-offset"],
  ["sell", 100.02, "ask-offset"]
]);

const minute: OrderFlowMinuteDto = {
  eventMinute: "2026-07-13T11:59:00.000Z",
  bins: [
    { priceBin: 99.99, askVolume: 5, bidVolume: 10, unknownVolume: 0 },
    { priceBin: 100, askVolume: 40, bidVolume: 40, unknownVolume: 0 },
    { priceBin: 100.01, askVolume: 10, bidVolume: 5, unknownVolume: 0 }
  ]
};
const minutes = new Map([[minute.eventMinute, minute]]);
const candidates = imbalanceCandidates(minutes, quote, 0.01);
assert.equal(candidates.ask?.side, "buy");
assert.equal(candidates.ask?.price, 100);
assert.equal(candidates.bid?.side, "sell");
assert.equal(candidates.bid?.price, 100);
assert.equal(deltaTone(normalizedDelta(minutes)), "neutral");

const positive = new Map([[minute.eventMinute, {
  ...minute,
  bins: [{ priceBin: 100, askVolume: 80, bidVolume: 20, unknownVolume: 0 }]
}]]);
assert.equal(normalizedDelta(positive), 0.6);
assert.equal(deltaTone(normalizedDelta(positive)), "buy");

assert.deepEqual(normalizeSimulatorQuickOrderQuote({
  symbol: "NVDA",
  bid: 207.45,
  ask: 207.47,
  runId: "run-1"
}), {
  bidPrice: 207.45,
  askPrice: 207.47
});
assert.equal(resolveQuickOrderExecutionMode("paper", "simulation"), "simulation");
assert.equal(resolveQuickOrderExecutionMode("kis", "simulation"), "simulation");
assert.equal(resolveQuickOrderExecutionMode("paper", "live"), "paper");
assert.equal(orderSubmitPath("simulation"), "/api/orders");
assert.equal(orderRiskPath("simulation"), "/api/risk/pretrade");
assert.equal(orderBalancePath("simulation"), "/api/orders/balance");

console.log("quick order tests passed");
