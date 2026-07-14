import type { ChartTradeSetup } from "./chartTradeSetup";
import type { ChartInterval } from "./types";

export type ChartPriceSelection = {
  version: "chart-price-selection-v1";
  chartDocumentId: string;
  sourcePanelId: string;
  symbol: string;
  interval: ChartInterval;
  price: number;
  formattedPrice: string;
  selectedAt: string;
};

export type ChartTradeSetupAssetIdentity = {
  algorithmVersion: string;
  inputDigest: string;
  asOf: string;
};

export type ChartTradeSetupSnapshot = {
  version: "chart-trade-setup-snapshot-v1";
  chartDocumentId: string;
  sourcePanelId: string;
  symbol: string;
  interval: ChartInterval;
  setup: ChartTradeSetup;
  assetIdentity: ChartTradeSetupAssetIdentity;
  spotlightPrice: number | null;
};

export type TradeAutomationConfirmationDraft = {
  version: "trade-automation-confirmation-v1";
  chartDocumentId: string;
  sourcePanelId: string;
  symbol: string;
  interval: ChartInterval;
  action: "buy_candidate" | "sell_candidate";
  reservationPrice: number;
  targetPrice: number;
  stopPrice: number;
  assetIdentity: ChartTradeSetupAssetIdentity;
  requestedAt: string;
  status: "pending" | "confirmed" | "stale";
};

export function isTradeAutomationConfirmationIntent(value: string): boolean {
  const compact = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,!?~'"“”‘’()\[\]{}:_-]+/g, "");
  const referencesCurrentChartPrice = /(이가격|해당가격|선택가격|진입가|이때|이시점)/.test(compact);
  const requestsAutomation = /(예약(매매|주문)?|사자|살래|매수(하자|해|해줘|해주세요)|팔자|매도(하자|해|해줘|해주세요)|알림.*(걸|설정|등록))/.test(compact);
  return referencesCurrentChartPrice && requestsAutomation;
}

export function createTradeAutomationConfirmationDraft(
  snapshot: ChartTradeSetupSnapshot,
  selection: ChartPriceSelection | null,
  requestedAt = new Date().toISOString()
): TradeAutomationConfirmationDraft | null {
  const setup = snapshot.setup;
  if (![setup.entryPrice, setup.targetPrice, setup.stopPrice].every(isPositiveFinite)) {
    return null;
  }
  const matchingSelection = selection
    && selection.chartDocumentId === snapshot.chartDocumentId
    && selection.sourcePanelId === snapshot.sourcePanelId
    && selection.symbol === snapshot.symbol
    && selection.interval === snapshot.interval
    && isPositiveFinite(selection.price)
    ? selection
    : null;
  const reservationPrice = matchingSelection?.price
    ?? (isPositiveFinite(snapshot.spotlightPrice) ? snapshot.spotlightPrice : setup.entryPrice);
  if (!isPositiveFinite(reservationPrice)) {
    return null;
  }
  return {
    version: "trade-automation-confirmation-v1",
    chartDocumentId: snapshot.chartDocumentId,
    sourcePanelId: snapshot.sourcePanelId,
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    action: setup.action,
    reservationPrice,
    targetPrice: setup.targetPrice,
    stopPrice: setup.stopPrice,
    assetIdentity: { ...snapshot.assetIdentity },
    requestedAt,
    status: "pending"
  };
}

export function tradeAutomationDraftMatchesSnapshot(
  draft: TradeAutomationConfirmationDraft,
  snapshot: ChartTradeSetupSnapshot | null,
  requestedSnapshot?: ChartTradeSetupSnapshot | null
): boolean {
  const identityMatches = Boolean(snapshot
    && snapshot.chartDocumentId === draft.chartDocumentId
    && snapshot.sourcePanelId === draft.sourcePanelId
    && snapshot.symbol === draft.symbol
    && snapshot.interval === draft.interval
    && snapshot.setup.action === draft.action
    && snapshot.assetIdentity.algorithmVersion === draft.assetIdentity.algorithmVersion
    && snapshot.assetIdentity.inputDigest === draft.assetIdentity.inputDigest
    && snapshot.assetIdentity.asOf === draft.assetIdentity.asOf);
  if (!identityMatches || !snapshot || !requestedSnapshot) {
    return identityMatches;
  }
  return requestedSnapshot.chartDocumentId === snapshot.chartDocumentId
    && requestedSnapshot.sourcePanelId === snapshot.sourcePanelId
    && requestedSnapshot.symbol === snapshot.symbol
    && requestedSnapshot.interval === snapshot.interval
    && requestedSnapshot.setup.action === snapshot.setup.action
    && requestedSnapshot.setup.entryPrice === snapshot.setup.entryPrice
    && requestedSnapshot.setup.targetPrice === snapshot.setup.targetPrice
    && requestedSnapshot.setup.stopPrice === snapshot.setup.stopPrice
    && requestedSnapshot.setup.entryTrigger === snapshot.setup.entryTrigger
    && requestedSnapshot.setup.patternId === snapshot.setup.patternId;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
