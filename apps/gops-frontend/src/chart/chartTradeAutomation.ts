import type { ChartTradeSetup } from "./chartTradeSetup";
import type { ChartInterval } from "./types";
import type { CreatePriceConditionInput } from "../priceCondition/priceConditionApi";

export const DEFAULT_PAPER_TRADE_QUANTITY = 20;

export type TradeAutomationAction = "buy_candidate" | "sell_candidate";

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
  action: TradeAutomationAction;
  sourceAction: TradeAutomationAction;
  reservationPrice: number;
  quantity: number;
  targetPrice: number;
  stopPrice: number;
  assetIdentity: ChartTradeSetupAssetIdentity;
  requestedAt: string;
  status: "pending" | "confirmed" | "stale";
};

export type TradeAutomationCommandIntent =
  | { status: "not_matched" }
  | { status: "missing_price"; action: TradeAutomationAction | null }
  | { status: "ready"; reservationPrice: number | null; action: TradeAutomationAction | null };

export type TradeAutomationDraftOptions = {
  action?: TradeAutomationAction | null;
  requestedAt?: string;
  reservationPrice?: number | null;
};

export function isTradeAutomationConfirmationIntent(value: string): boolean {
  return resolveTradeAutomationCommandIntent(value).status === "ready";
}

export function resolveTradeAutomationCommandIntent(value: string): TradeAutomationCommandIntent {
  const normalized = value.normalize("NFKC").toLowerCase();
  const compact = normalized
    .replace(/[\s.,!?~'"“”‘’()\[\]{}:_-]+/g, "");
  const reservationPrice = extractExplicitReservationPrice(normalized);
  const referencesCurrentChartPrice = /(이가격|해당가격|선택가격|진입가|이때|이시점)/.test(compact);
  const mentionsReservation = /예약(?:매매|주문|매수|매도)?/.test(compact);
  const requestsReservationDirectly = /예약(?:매매|주문|매수|매도)?(?:해주세요|해달라|해줘요|해줘|해줄래|하자|할래|부탁해|부탁합니다)/.test(compact);
  const requestsReservationWithExecutionVerb = /예약(?:매매|주문|매수|매도)?.*(?:걸어(?:주세요|줘요|줘|줄래)|설정해(?:주세요|줘요|줘|줄래)|등록해(?:주세요|줘요|줘|줄래)|추가해(?:주세요|줘요|줘|줄래)|넣어(?:주세요|줘요|줘|줄래)|주문해(?:주세요|줘요|줘|줄래)|진행해(?:주세요|줘요|줘|줄래))/.test(compact);
  const requestsReservationWithQuantity = /예약(?:매매|주문|매수|매도)?\d+(?:\.\d+)?(?:주|개)(?:만|를|로|씩)?(?:해주세요|해달라|해줘요|해줘|해줄래|하자|할래|부탁해|부탁합니다)/.test(compact);
  const requestsReservation = requestsReservationDirectly
    || requestsReservationWithExecutionVerb
    || requestsReservationWithQuantity;
  const requestsDirectTrade = /(?:사자|살래|팔자|매수(?:해주세요|해달라|해줘요|해줘|하자)|매도(?:해주세요|해달라|해줘요|해줘|하자))/.test(compact);
  const requestsAlert = /알림.*(?:걸어주세요|걸어줘|설정해주세요|설정해줘|등록해주세요|등록해줘)/.test(compact);
  const requestsAutomation = requestsReservation || requestsDirectTrade || requestsAlert;
  const requestsBuy = /(?:예약매수|매수|사자|살래)/.test(compact);
  const requestsSell = /(?:예약매도|매도|팔자|팔래)/.test(compact);
  const action: TradeAutomationAction | null = requestsBuy === requestsSell
    ? null
    : requestsBuy
      ? "buy_candidate"
      : "sell_candidate";
  if ((referencesCurrentChartPrice || reservationPrice !== null) && requestsAutomation) {
    return { status: "ready", reservationPrice, action };
  }
  if (mentionsReservation && requestsAutomation) {
    return { status: "missing_price", action };
  }
  return { status: "not_matched" };
}

export function chartPriceSelectionMatchesTradeSetup(
  snapshot: ChartTradeSetupSnapshot,
  selection: ChartPriceSelection | null
): selection is ChartPriceSelection {
  return Boolean(selection
    && selection.chartDocumentId === snapshot.chartDocumentId
    && selection.sourcePanelId === snapshot.sourcePanelId
    && selection.symbol === snapshot.symbol
    && selection.interval === snapshot.interval
    && isPositiveFinite(selection.price));
}

export function createTradeAutomationConfirmationDraft(
  snapshot: ChartTradeSetupSnapshot,
  selection: ChartPriceSelection | null,
  options: TradeAutomationDraftOptions | string = {}
): TradeAutomationConfirmationDraft | null {
  const setup = snapshot.setup;
  if (![setup.entryPrice, setup.targetPrice, setup.stopPrice].every(isPositiveFinite)) {
    return null;
  }
  const resolvedOptions = typeof options === "string" ? { requestedAt: options } : options;
  const explicitReservationPrice = resolvedOptions.reservationPrice ?? null;
  if (explicitReservationPrice !== null && !isPositiveFinite(explicitReservationPrice)) {
    return null;
  }
  const sourceAction = setup.action;
  const action = resolvedOptions.action ?? sourceAction;
  const reversesSetupDirection = action !== sourceAction;
  const matchingSelection = chartPriceSelectionMatchesTradeSetup(snapshot, selection) ? selection : null;
  const reservationPrice = explicitReservationPrice
    ?? matchingSelection?.price
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
    action,
    sourceAction,
    reservationPrice,
    quantity: DEFAULT_PAPER_TRADE_QUANTITY,
    targetPrice: reversesSetupDirection ? setup.stopPrice : setup.targetPrice,
    stopPrice: reversesSetupDirection ? setup.targetPrice : setup.stopPrice,
    assetIdentity: { ...snapshot.assetIdentity },
    requestedAt: resolvedOptions.requestedAt ?? new Date().toISOString(),
    status: "pending"
  };
}

function extractExplicitReservationPrice(value: string): number | null {
  const pricePatterns = [
    /\$\s*(\d[\d,]*(?:\.\d+)?)/,
    /usd\s*(\d[\d,]*(?:\.\d+)?)/,
    /(\d[\d,]*(?:\.\d+)?)\s*(?:usd|달러|불)/,
    /(?:가격|지정가|예약가|매수가)\s*(?:은|는|을|를|:)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/,
    /(\d[\d,]*(?:\.\d+)?)\s*(?:에|로)\s*(?:예약|매수|매도|주문)/
  ];
  for (const pattern of pricePatterns) {
    const rawPrice = pattern.exec(value)?.[1];
    if (!rawPrice) continue;
    const price = Number(rawPrice.replace(/,/g, ""));
    if (isPositiveFinite(price)) {
      return price;
    }
  }
  return null;
}

export function priceConditionInputFromTradeAutomationDraft(
  draft: TradeAutomationConfirmationDraft,
  quantity = draft.quantity
): CreatePriceConditionInput {
  return {
    symbol: draft.symbol,
    side: draft.action === "buy_candidate" ? "buy" : "sell",
    direction: draft.action === "buy_candidate" ? "atOrBelow" : "atOrAbove",
    triggerPrice: draft.reservationPrice,
    limitPrice: draft.reservationPrice,
    quantity,
    exchange: "NASD",
    executionEnabled: true,
    alertsEnabled: true,
    validity: "GTC"
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
    && snapshot.setup.action === draft.sourceAction
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
