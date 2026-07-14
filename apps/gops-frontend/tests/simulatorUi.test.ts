import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  basketForOrderSide,
  formatSimulatorClock,
  requestPortfolioRefresh,
  simulatorStatusPollIntervalMs,
  subscribePortfolioRefresh
} from "../src/simulator/simulatorApi";


assert.equal(basketForOrderSide("sell"), "semiconductor");
assert.equal(basketForOrderSide("buy"), "energy");
assert.equal(formatSimulatorClock(0), "00:00");
assert.equal(formatSimulatorClock(65.8), "01:05");
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "simulation", state: "running" }), 1_000);
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "live", state: "idle" }), 30_000);
assert.equal(simulatorStatusPollIntervalMs({ available: false, mode: "live", state: "idle" }), 30_000);
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "simulation", state: "paused" }), 30_000);
let refreshCalls = 0;
const unsubscribeRefresh = subscribePortfolioRefresh(() => { refreshCalls += 1; });
requestPortfolioRefresh();
unsubscribeRefresh();
requestPortfolioRefresh();
assert.equal(refreshCalls, 1);

const controlSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/SimulatorControl.tsx", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(controlSource, /onSelectSymbol/);
assert.match(controlSource, /window\.open\(article\.url/);
assert.doesNotMatch(controlSource, /setInterval\(refresh,\s*250\)/);
assert.match(controlSource, /document\.visibilityState === "hidden"/);
assert.match(controlSource, /simulatorStatusPollIntervalMs\(latestStatusRef\.current\)/);

const orderTicketSource = readFileSync(
  fileURLToPath(new URL("../src/components/OrderTicket.tsx", import.meta.url)),
  "utf-8"
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/simulatorApi.ts", import.meta.url)),
  "utf-8"
);
assert.match(apiSource, /\/api\/simulator\/orders\/basket/);
assert.match(orderTicketSource, /submitSimulatorBasket\(form\.side/);
assert.match(orderTicketSource, /onClick=\{submitOrder\}/);
assert.match(orderTicketSource, /executionMode === "paper" \? "\/api\/paper\/orders" : "\/api\/orders"/);

const paperClientSource = readFileSync(
  fileURLToPath(new URL("../src/orders/paperTradingClient.ts", import.meta.url)),
  "utf-8"
);
const quickOrderSource = readFileSync(
  fileURLToPath(new URL("../src/components/QuickOrderPanel.tsx", import.meta.url)),
  "utf-8"
);
const paperAccountSource = readFileSync(
  fileURLToPath(new URL("../src/components/PaperAccountPanel.tsx", import.meta.url)),
  "utf-8"
);
assert.match(paperClientSource, /\/api\/paper\/symbols\/search/);
assert.match(quickOrderSource, /submitOrderRequest\([\s\S]*executionMode\)/);
assert.match(paperAccountSource, /cancelPaperOrder/);
assert.match(paperAccountSource, /resetPaperAccount/);

const layoutPresetSource = readFileSync(
  fileURLToPath(new URL("../src/layout/layoutPresets.ts", import.meta.url)),
  "utf-8"
);
assert.match(
  layoutPresetSource,
  /asset:[\s\S]*kind: "portfolioHoldings"[\s\S]*kind: "portfolioHeatmap"[\s\S]*\n\s*}\n}/
);
assert.doesNotMatch(layoutPresetSource, /kind: "trade"/);

const portfolioHoldingsSource = readFileSync(
  fileURLToPath(new URL("../src/components/PortfolioHoldingsPanel.tsx", import.meta.url)),
  "utf-8"
);
assert.match(portfolioHoldingsSource, /portfolioStoreRefreshQueued/);
assert.match(
  portfolioHoldingsSource,
  /usePortfolioHoldingsData[\s\S]*subscribePortfolioRefresh\(refreshPortfolioHoldingsStore\)/
);
assert.match(apiSource, /function requestPortfolioRefresh/);
assert.match(portfolioHoldingsSource, /DEMO_PORTFOLIO_ENABLED \? 1_000 : REFRESH_INTERVAL_MS/);

console.log("simulator UI tests passed");
