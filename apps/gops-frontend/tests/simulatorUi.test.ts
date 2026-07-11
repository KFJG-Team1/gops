import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  basketForOrderSide,
  formatSimulatorClock,
  rollbackLatestSimulation,
  requestPortfolioRefresh,
  subscribePortfolioRefresh
} from "../src/simulator/simulatorApi";


assert.equal(basketForOrderSide("sell"), "semiconductor");
assert.equal(basketForOrderSide("buy"), "energy");
assert.equal(formatSimulatorClock(0), "00:00");
assert.equal(formatSimulatorClock(65.8), "01:05");
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

const orderTicketSource = readFileSync(
  fileURLToPath(new URL("../src/components/OrderTicket.tsx", import.meta.url)),
  "utf-8"
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/simulatorApi.ts", import.meta.url)),
  "utf-8"
);
assert.match(apiSource, /\/api\/simulator\/orders\/basket/);
assert.match(apiSource, /\/api\/simulator\/rollback/);
assert.equal(typeof rollbackLatestSimulation, "function");
assert.match(controlSource, /봉 되돌리기/);
assert.match(controlSource, /rollbackState/);
assert.match(controlSource, /원복 중/);
assert.match(controlSource, /원복 완료/);
assert.match(orderTicketSource, /submitSimulatorBasket\(form\.side/);
assert.match(orderTicketSource, /onClick=\{submitOrder\}/);

const layoutPresetSource = readFileSync(
  fileURLToPath(new URL("../src/layout/layoutPresets.ts", import.meta.url)),
  "utf-8"
);
assert.match(
  layoutPresetSource,
  /asset:[\s\S]*kind: "portfolioHoldings"[\s\S]*kind: "trade"[\s\S]*\n\s*}\n}/
);

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
