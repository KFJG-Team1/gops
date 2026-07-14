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
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/simulatorApi.ts", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(controlSource, /onSelectSymbol/);
assert.match(controlSource, /window\.open\(article\.url/);
assert.doesNotMatch(controlSource, /setInterval\(refresh,\s*250\)/);
assert.match(controlSource, /document\.visibilityState === "hidden"/);
assert.match(controlSource, /simulatorStatusPollIntervalMs\(latestStatusRef\.current\)/);
assert.match(controlSource, /다음 시연 단계/);
assert.match(controlSource, /setSimulatorPhase\(status\.nextPhase/);
assert.match(apiSource, /\/api\/simulator\/phase/);

const chartCommentarySource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartCommentaryPanel.tsx", import.meta.url)),
  "utf-8"
);
const saturdayDemoFixturesSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/saturdayDemoFixtures.ts", import.meta.url)),
  "utf-8"
);
assert.match(chartCommentarySource, /GlossaryText/);
assert.match(chartCommentarySource, /삼각 수렴 패턴/);
assert.match(saturdayDemoFixturesSource, /entryTrigger: 82\.6/);
assert.match(saturdayDemoFixturesSource, /entryPrice: 82\.7/);
assert.match(saturdayDemoFixturesSource, /stopPrice: 81\.1/);
assert.match(saturdayDemoFixturesSource, /targetPrice: 87\.5/);

const orderTicketSource = readFileSync(
  fileURLToPath(new URL("../src/components/OrderTicket.tsx", import.meta.url)),
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
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8"
);
assert.match(paperClientSource, /\/api\/paper\/symbols\/search/);
assert.match(quickOrderSource, /submitOrderRequest\([\s\S]*executionMode\)/);
assert.doesNotMatch(quickOrderSource, />가상 빠른 주문</);
assert.doesNotMatch(quickOrderSource, /프리셋 선택/);
assert.match(quickOrderSource, /executionMode === "paper" \? "회사명 검색" : "종목 검색"/);
assert.match(paperAccountSource, /cancelPaperOrder/);
assert.doesNotMatch(paperAccountSource, /RefreshCw|RotateCcw|paper-account-header-actions|resetPaperAccount/);
assert.doesNotMatch(paperAccountSource, /paper-account-summary/);
assert.doesNotMatch(paperAccountSource, /총 자산|주문 가능|보유 평가액|총 손익/);
assert.doesNotMatch(paperAccountSource, /WalletCards|account\.generation\}회차/);
assert.match(paperAccountSource, /paper-order-side/);
assert.match(paperAccountSource, /paper-order-status[^]*paperOrderStatusTone/);
assert.match(paperAccountSource, /paper-account-order-head[^]*>종목<[^]*>수량<[^]*>가격<[^]*>구분<[^]*>상태</);
assert.match(paperAccountSource, /paper-position-list[^]*OrderTableHead showSide=\{false\}/);
assert.match(paperAccountSource, /showSide \? <span>구분<\/span> : <span>평가금액<\/span>/);
assert.match(paperAccountSource, /formatUsd\(position\.market_value\)/);
assert.match(stylesSource, /\.paper-position-row > \.paper-order-status \{\s*grid-column: 5;/);
assert.match(stylesSource, /\.paper-account-body \{[^}]*scrollbar-gutter: stable;/);
assert.doesNotMatch(stylesSource, /\.paper-account-tabs \{[^}]*padding-right:/);
assert.doesNotMatch(paperAccountSource, />시간<|>관리</);
assert.match(paperAccountSource, />예약 매매<[^]*>거래내역<[^]*>미체결 \{snapshot\.open_orders\.length\}<[^]*>보유종목</);
assert.match(paperAccountSource, /tab === "conditions"[^]*<PriceConditionPanel[^]*view="account"/);
assert.match(orderTicketSource, />주문 유형</);
assert.match(orderTicketSource, />일반 주문</);
assert.match(orderTicketSource, /지정가/);
assert.match(orderTicketSource, /시장가/);
assert.match(orderTicketSource, />총 주문 금액</);
assert.match(orderTicketSource, />종목</);
assert.match(orderTicketSource, /displayCompanyName\(selectedSymbolMeta\)/);
assert.doesNotMatch(orderTicketSource, />가상 주문하기</);
assert.match(orderTicketSource, /order-paper-review-card/);
assert.match(orderTicketSource, />예상 주문액</);
assert.doesNotMatch(orderTicketSource, /주문 가능 금액/);
assert.doesNotMatch(orderTicketSource, /\/api\/orders\/balance/);
assert.match(orderTicketSource, /priceType === "market"/);
assert.match(orderTicketSource, /시장가 주문은 현재 해외주식 모의투자 v1에서 지원되지 않습니다/);

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
