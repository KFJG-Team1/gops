import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  formatSimulatorVirtualTime,
  requestPortfolioRefresh,
  simulatorPrimaryAction,
  simulationAwareNowMs,
  simulatorSpeeds,
  shouldOpenHeatmapForSimulatorTransition,
  shouldResetMarketDataForSimulatorTransition,
  simulatorStatusPollIntervalMs,
  subscribePortfolioRefresh,
  type SimulatorStatus
} from "../src/simulator/simulatorApi";
import { visiblePaperAccountError } from "../src/orders/paperAccountPresentation";
import { companyJournalRequestKey } from "../src/components/CompanyJournalPanel";


assert.deepEqual(simulatorSpeeds, [1, 5, 20, 60]);
assert.equal(formatSimulatorVirtualTime("2026-07-14T15:00:00Z"), "07/15 00:00:00");
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "simulation", state: "running" }), 1_000);
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "live", state: "idle" }), 30_000);
assert.equal(simulatorStatusPollIntervalMs({ available: false, mode: "live", state: "idle" }), 30_000);
assert.equal(simulatorStatusPollIntervalMs({ available: true, mode: "simulation", state: "paused" }), 30_000);
assert.equal(shouldResetMarketDataForSimulatorTransition("simulation", "live"), true);
assert.equal(shouldResetMarketDataForSimulatorTransition("simulation", "simulation"), false);
assert.equal(shouldResetMarketDataForSimulatorTransition("live", "live"), false);
assert.equal(shouldResetMarketDataForSimulatorTransition("simulation", "simulation", "run-1", "run-2"), true);
assert.equal(shouldOpenHeatmapForSimulatorTransition("live", "simulation"), true);
assert.equal(shouldOpenHeatmapForSimulatorTransition("simulation", "simulation"), false);
assert.equal(shouldOpenHeatmapForSimulatorTransition("simulation", "live"), false);
assert.equal(simulatorPrimaryAction({ mode: "live", state: "idle" }), "start");
assert.equal(simulatorPrimaryAction({ mode: "simulation", state: "ready" }), "resume");
assert.equal(simulatorPrimaryAction({ mode: "simulation", state: "paused" }), "resume");
assert.equal(simulatorPrimaryAction({ mode: "simulation", state: "running" }), "pause");

const replayStatus: SimulatorStatus = {
  available: true,
  mode: "simulation",
  state: "running",
  datasetId: "sp500-top20-plus-amd-mu-20260715-kst-v2",
  runId: "run-clock",
  virtualTime: "2026-07-14T15:06:40.000Z",
  startTime: "2026-07-14T15:00:00.000Z",
  endTime: "2026-07-15T15:00:00.000Z",
  requestedSpeed: 5,
  effectiveSpeed: 5,
  processedEventCount: 1,
  totalEventCount: 2,
  progress: 0.5,
  lagMs: 0,
  symbols: []
};
const observedAtMs = Date.parse("2026-07-16T14:00:00.000Z");
assert.equal(companyJournalRequestKey(replayStatus), "simulation:run-clock:2026-07-15");
assert.equal(
  companyJournalRequestKey({ ...replayStatus, virtualTime: "2026-07-15T08:59:59+09:00" }),
  "simulation:run-clock:2026-07-15"
);
assert.equal(
  companyJournalRequestKey({ ...replayStatus, runId: "run-next" }),
  "simulation:run-next:2026-07-15"
);
assert.equal(
  simulationAwareNowMs(observedAtMs + 2_000, replayStatus, observedAtMs),
  Date.parse("2026-07-14T15:06:50.000Z")
);
assert.equal(
  simulationAwareNowMs(observedAtMs + 2_000, { ...replayStatus, state: "paused" }, observedAtMs),
  Date.parse(replayStatus.virtualTime)
);
assert.equal(
  simulationAwareNowMs(observedAtMs + 2_000, { ...replayStatus, mode: "live" }, observedAtMs),
  observedAtMs + 2_000
);
assert.equal(
  simulationAwareNowMs(observedAtMs + 10_000, {
    ...replayStatus,
    virtualTime: "2026-07-15T14:59:58.000Z",
    effectiveSpeed: 60
  }, observedAtMs),
  Date.parse(replayStatus.endTime)
);
let refreshCalls = 0;
const unsubscribeRefresh = subscribePortfolioRefresh(() => { refreshCalls += 1; });
requestPortfolioRefresh();
unsubscribeRefresh();
requestPortfolioRefresh();
assert.equal(refreshCalls, 1);
assert.equal(visiblePaperAccountError("simulation_data_unavailable"), undefined);
assert.equal(visiblePaperAccountError(undefined, "가상계좌를 불러오지 못했습니다."), "가상계좌를 불러오지 못했습니다.");

const controlSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/SimulatorControl.tsx", import.meta.url)),
  "utf-8"
);
const appSource = readFileSync(
  fileURLToPath(new URL("../src/App.tsx", import.meta.url)),
  "utf-8"
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/simulator/simulatorApi.ts", import.meta.url)),
  "utf-8"
);
const bottomCommandBarSource = readFileSync(
  fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)),
  "utf-8"
);
const chartPanelSource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartPanel.tsx", import.meta.url)),
  "utf-8"
);
const newsPanelSource = readFileSync(
  fileURLToPath(new URL("../src/components/NewsPanel.tsx", import.meta.url)),
  "utf-8"
);
const companyJournalSource = readFileSync(
  fileURLToPath(new URL("../src/components/CompanyJournalPanel.tsx", import.meta.url)),
  "utf-8"
);
const companyJournalPerformanceSource = readFileSync(
  fileURLToPath(new URL("../src/components/CompanyJournalPerformanceChart.tsx", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(controlSource, /onSelectSymbol/);
assert.match(appSource, /shouldOpenHeatmapForSimulatorTransition\(previousMode, status\.mode\)/);
assert.match(appSource, /navigateMainView\(\{ mode: "treemap" \}, \{ replace: true \}\)/);
assert.doesNotMatch(controlSource, /onNotification/);
assert.doesNotMatch(controlSource, /simulator-breaking-toast|simulator-phase-toast/);
assert.doesNotMatch(controlSource, /setInterval\(refresh,\s*250\)/);
assert.match(controlSource, /document\.visibilityState === "hidden"/);
assert.match(controlSource, /simulatorStatusPollIntervalMs\(latestStatusRef\.current\)/);
assert.doesNotMatch(controlSource, /다음 시연 단계|setSimulatorPhase|breakingNews/);
assert.match(controlSource, /formatSimulatorVirtualTime\(status\.virtualTime\)/);
assert.match(controlSource, /setSimulatorSpeed/);
assert.match(controlSource, /시뮬레이션 재생/);
assert.match(controlSource, /시뮬레이션 시작 및 재생/);
assert.match(controlSource, /simulatorPrimaryAction\(status\)/);
assert.doesNotMatch(controlSource, /setSimulatorMode\(simulation \? "live" : "simulation"\)/);
assert.match(chartPanelSource, /simulationAwareNowMs\(Date\.now\(\)\)/);
assert.match(apiSource, /\/api\/simulator\/speed/);
assert.match(apiSource, /\/api\/simulator\/quote/);
assert.doesNotMatch(apiSource, /\/api\/simulator\/phase|\/api\/simulator\/orders\/basket/);
assert.match(bottomCommandBarSource, /<SimulatorControl \/>/);
assert.match(bottomCommandBarSource, /notification\.id < 0/);
assert.doesNotMatch(newsPanelSource, /시뮬레이션 뉴스 API 응답 오류/);
assert.doesNotMatch(newsPanelSource, /시뮬레이션 시각 기준 뉴스 데이터가 없어/);
assert.match(newsPanelSource, /simulatorMode === "simulation" \? "\/api\/market\/news\/latest"/);
assert.match(companyJournalSource, /latestSimulatorStatus/);
assert.match(companyJournalSource, /simulatorStatusEvent/);
assert.match(companyJournalSource, /simulatorMode === "simulation"/);
assert.doesNotMatch(companyJournalSource, /setJournalStatus\("simulation_unavailable"\)/);
assert.doesNotMatch(companyJournalSource, /simulatorMode === "simulation"\) \{[\s\S]*?setStoredEvidence\(null\);[\s\S]*?return/);
assert.match(companyJournalSource, /disableRemoteFetch=\{previewEnabled \|\| simulatorMode === "simulation"\}/);
assert.match(companyJournalSource, /companyJournalRequestKey/);
assert.match(companyJournalSource, /disableRemoteFetch=\{simulatorMode === "simulation"\}/);
assert.match(companyJournalPerformanceSource, /if \(disableRemoteFetch\) \{/);
assert.match(chartPanelSource, /fetchAnalysisAssets\(requestedSymbol, requestedInterval\)/);
assert.match(chartPanelSource, /fetchChartCommentaryAsset\(requestedSymbol, requestedInterval\)/);
assert.match(chartPanelSource, /scheduleChartAnalysisAssetRequest/);
assert.ok(
  chartPanelSource.indexOf("fetchChartCommentaryAsset(requestedSymbol, requestedInterval)")
    < chartPanelSource.indexOf("!analysisSceneReadyToken"),
  "lightweight commentary starts outside the first-scene gate"
);

const chartCommentarySource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartCommentaryPanel.tsx", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(chartCommentarySource, /fetchAnalysisAssets/);
assert.match(chartCommentarySource, /subscribeChartAnalysisAssetRuntime/);
assert.match(chartCommentarySource, /GlossaryText/);
assert.match(chartCommentarySource, /buildChartCommentaryViewModel/);
assert.match(chartCommentarySource, /GlossaryText text=\{step\.body\}/);

const orderTicketSource = readFileSync(
  fileURLToPath(new URL("../src/components/OrderTicket.tsx", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(orderTicketSource, /submitSimulatorBasket/);
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
const priceConditionSource = readFileSync(
  fileURLToPath(new URL("../src/components/PriceConditionPanel.tsx", import.meta.url)),
  "utf-8"
);
assert.match(paperAccountSource, /selectPortfolioHoldingSymbol\(symbol\)/);
assert.match(paperAccountSource, /onOpenCompany\(symbol\)/);
assert.match(paperAccountSource, /aria-label=\{`\$\{position\.symbol\} 차트 열기`\}/);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8"
);
const alertToastSource = readFileSync(
  fileURLToPath(new URL("../src/alerts/AlertToast.tsx", import.meta.url)),
  "utf-8"
);
const headerNotificationSource = readFileSync(
  fileURLToPath(new URL("../src/alerts/HeaderNotificationMenu.tsx", import.meta.url)),
  "utf-8"
);
assert.doesNotMatch(stylesSource, /\.simulator-breaking-toast|\.simulator-phase-toast/);
assert.match(stylesSource, /\.alert-toast \{/);
assert.match(alertToastSource, /alert-toast surface-floating/);
assert.match(alertToastSource, /is-geopolitical-risk/);
assert.match(headerNotificationSource, /is-geopolitical-risk/);
assert.match(stylesSource, /\.alert-toast\.is-geopolitical-risk/);
const geopoliticalToastStyle = stylesSource.slice(
  stylesSource.indexOf(".alert-toast.is-geopolitical-risk {"),
  stylesSource.indexOf(".alert-toast.is-geopolitical-risk .alert-toast-icon")
);
assert.equal((geopoliticalToastStyle.match(/border-color: transparent;/g) ?? []).length, 2);
assert.match(stylesSource, /\.workspace-notification-row\.is-geopolitical-risk/);
assert.match(paperClientSource, /\/api\/paper\/symbols\/search/);
assert.match(quickOrderSource, /submitOrderRequest\([\s\S]*effectiveExecutionMode\)/);
assert.match(quickOrderSource, /latestSimulatorStatus/);
assert.match(quickOrderSource, /fetchSimulatorQuote/);
assert.match(quickOrderSource, /effectiveExecutionMode/);
assert.match(quickOrderSource, /simulatorStatusEvent/);
assert.match(quickOrderSource, /order\.simulation[^]*requestPortfolioRefresh\(\)/);
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
assert.match(paperAccountSource, /latestSubmittedOrderId[^]*setTab\("conditions"\)/);
assert.match(paperAccountSource, /pendingOrders=\{snapshot\.open_orders\}/);
assert.match(priceConditionSource, /pendingOrders\.map\(\(order\) =>/);
assert.match(priceConditionSource, />접수됨<[^]*>직접 취소 전</);
assert.match(priceConditionSource, /onCancelPendingOrder\?\.\(order\.order_id\)/);
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
assert.doesNotMatch(orderTicketSource, /시장가 주문은 현재 해외주식 모의투자 v1에서 지원되지 않습니다/);
assert.match(orderTicketSource, /order_type: priceType/);
assert.match(
  orderTicketSource,
  /const paperAccountOrder = executionMode === "paper"[^]*submittedOrder\.simulation === true[^]*if \(paperAccountOrder\) \{[^]*recordSubmittedOrder\(submittedOrder\);[^]*requestPortfolioRefresh\(\);[^]*return;/
);

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
const paperAccountProviderSource = readFileSync(
  fileURLToPath(new URL("../src/orders/PaperAccountProvider.tsx", import.meta.url)),
  "utf-8"
);
assert.match(portfolioHoldingsSource, /portfolioStores/);
assert.match(portfolioHoldingsSource, /paperSnapshotToPortfolioPayload\(paperAccount\.snapshot\)/);
assert.match(paperAccountProviderSource, /subscribePortfolioRefresh\(\(\) =>/);
assert.match(paperAccountProviderSource, /recordSubmittedOrder[^]*open_orders:/);
assert.match(apiSource, /function requestPortfolioRefresh/);
assert.doesNotMatch(portfolioHoldingsSource, /buildDemoPortfolioPayload|DEMO_PORTFOLIO_ENABLED/);

console.log("simulator UI tests passed");
