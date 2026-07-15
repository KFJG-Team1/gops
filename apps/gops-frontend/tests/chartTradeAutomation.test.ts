import assert from "node:assert/strict";
import {
  createTradeAutomationConfirmationDraft,
  isTradeAutomationConfirmationIntent,
  priceConditionInputFromTradeAutomationDraft,
  tradeAutomationDraftMatchesSnapshot,
  type ChartPriceSelection,
  type ChartTradeSetupSnapshot
} from "../src/chart/chartTradeAutomation";
import type { ChartTradeSetup } from "../src/chart/chartTradeSetup";

[
  "이 가격에 예약매매랑 알림 걸어줘",
  "이 가격에 예약하자",
  "이 가격에 사자",
  "이 때 사자",
  "이  가격으로 매수해 주세요",
  "해당 가격 알림 설정하고 예약 주문해줘"
].forEach((prompt) => assert.equal(isTradeAutomationConfirmationIntent(prompt), true, prompt));
[
  "AMD 차트 분석해줘",
  "가격 알림을 설명해줘",
  "예약매매가 뭐야?",
  "이 가격은 왜 중요해?"
].forEach((prompt) => assert.equal(isTradeAutomationConfirmationIntent(prompt), false, prompt));

const setup: ChartTradeSetup = {
  version: "chart-trade-setup-v1",
  action: "buy_candidate",
  sourceKind: "conditional",
  sourceInterval: "1D",
  entryPrice: 456.2,
  entryTrigger: 456.2,
  targetPrice: 510.4,
  stopPrice: 429.1,
  rewardRiskRatio: 2,
  signalAt: null,
  signalIndex: 20,
  patternId: "pattern-1",
  patternKind: "ascending_triangle",
  projectionBars: 10,
  reasons: ["stored_evidence_conditional"],
  drawingIds: { plan: "chart-plan:risk", signal: "chart-plan:signal" },
  priceSources: { entry: "저항", target: "2R", stop: "지지" },
  assetIdentity: { algorithmVersion: "geometry-v5", inputDigest: "digest-1", asOf: "2026-07-14T20:00:00Z" }
};
const snapshot: ChartTradeSetupSnapshot = {
  version: "chart-trade-setup-snapshot-v1",
  chartDocumentId: "chart-document-1",
  sourcePanelId: "slot-chart-1",
  symbol: "AMD",
  interval: "1D",
  setup,
  assetIdentity: { ...setup.assetIdentity },
  spotlightPrice: 470.25
};
const matchingSelection: ChartPriceSelection = {
  version: "chart-price-selection-v1",
  chartDocumentId: "chart-document-1",
  sourcePanelId: "slot-chart-1",
  symbol: "AMD",
  interval: "1D",
  price: 462.35,
  formattedPrice: "462.35",
  selectedAt: "2026-07-15T10:00:00Z"
};

const selectedDraft = createTradeAutomationConfirmationDraft(snapshot, matchingSelection, "2026-07-15T10:01:00Z");
assert.equal(selectedDraft?.reservationPrice, 462.35);
assert.equal(selectedDraft?.quantity, 20);
assert.equal(selectedDraft?.targetPrice, setup.targetPrice);
assert.equal(selectedDraft?.stopPrice, setup.stopPrice);
assert.equal(selectedDraft?.status, "pending");
assert.equal(tradeAutomationDraftMatchesSnapshot(selectedDraft!, snapshot), true);
assert.deepEqual(priceConditionInputFromTradeAutomationDraft(selectedDraft!), {
  symbol: "AMD",
  side: "buy",
  direction: "atOrBelow",
  triggerPrice: 462.35,
  limitPrice: 462.35,
  quantity: 20,
  exchange: "NASD",
  executionEnabled: true,
  alertsEnabled: true,
  validity: "GTC"
});

const otherChartSelection = { ...matchingSelection, chartDocumentId: "chart-document-2", price: 999 };
assert.equal(createTradeAutomationConfirmationDraft(snapshot, otherChartSelection)?.reservationPrice, 470.25);
assert.equal(createTradeAutomationConfirmationDraft({ ...snapshot, spotlightPrice: null }, null)?.reservationPrice, setup.entryPrice);
assert.equal(tradeAutomationDraftMatchesSnapshot(selectedDraft!, {
  ...snapshot,
  assetIdentity: { ...snapshot.assetIdentity, inputDigest: "changed" }
}), false);
assert.equal(tradeAutomationDraftMatchesSnapshot(selectedDraft!, {
  ...snapshot,
  setup: { ...snapshot.setup, entryPrice: 457 }
}, snapshot), false);

const sellDraft = createTradeAutomationConfirmationDraft({
  ...snapshot,
  setup: { ...setup, action: "sell_candidate", targetPrice: 420, stopPrice: 480 },
  spotlightPrice: null
}, null);
assert.equal(sellDraft?.action, "sell_candidate");
assert.equal(sellDraft?.reservationPrice, setup.entryPrice);
assert.equal(sellDraft?.targetPrice, 420);
assert.equal(sellDraft?.stopPrice, 480);
