import { applyCandleEvent, applySnapshotToCandles, candleKey } from "./candleStore";
import { createChartDocument, normalizeChartDocument } from "./chartDocuments";
import { normalizeChartInterval, type ChartInterval } from "./intervals";
import { DEFAULT_CHART_SYMBOL } from "./symbols";
import { canonicalTimestamp } from "./time";
import { latestCandleRightOffset } from "./viewport";
import {
  executeChartCommand,
  executeChartCommandGroup,
  normalizeComparisonFromCommand,
  normalizeComparisonSeries,
  normalizeDrawingFromCommand,
  normalizeDrawingEntity,
  validateChartProposal
} from "./commands";
import type {
  CandleData,
  CandleEvent,
  CandleSnapshot,
  ChartCommand,
  ChartCommandJournalEntry,
  ChartDataStatus,
  ChartDocument,
  ChartPendingPreview,
  ChartProposal,
  RealtimeLayerEvent,
  ChartRuntimeError,
  ChartRuntimeState,
  StreamStatus,
  TradeTickData
} from "./types";

export type { ChartRuntimeState } from "./types";

export const maxInactiveCandleCacheKeys = 8;

export type ChartRuntimePanel = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  chartDocumentId?: string;
};

export type ChartRuntimeAction =
  | { kind: "chart.ensureDocuments"; panels: ChartRuntimePanel[] }
  | { kind: "chart.marketData.reset" }
  | { kind: "chart.snapshot.loaded"; snapshot: CandleSnapshot }
  | { kind: "chart.snapshot.failed"; symbol: string; interval: string; message: string }
  | { kind: "chart.command"; command: ChartCommand }
  | { kind: "chart.command.group"; commands: ChartCommand[]; label: string; proposalId?: string }
  | { kind: "chart.proposal.received"; proposal: ChartProposal; autoApply: boolean }
  | { kind: "chart.proposal.accept"; proposalId: string }
  | { kind: "chart.proposal.reject"; proposalId: string }
  | { kind: "chart.live"; event: CandleEvent }
  | { kind: "chart.layer.live"; event: RealtimeLayerEvent }
  | { kind: "chart.data.status"; symbol: string; interval: string; status: Omit<ChartDataStatus, "updatedAt"> }
  | { kind: "chart.stream.status"; symbol: string; interval: string; status: StreamStatus; message?: string }
  | { kind: "chart.error"; message: string; chartDocumentId?: string };

export function createInitialChartRuntimeState(): ChartRuntimeState {
  return {
    documents: {},
    candlesByKey: {},
    candleKeyAccessOrder: [],
    liveTradesBySymbol: {},
    liveQuotesBySymbol: {},
    dataStatusByKey: {},
    streamStatusByKey: {},
    streamMessageByKey: {},
    pendingPreviewByDocumentId: {},
    pendingProposals: [],
    journal: [],
    errors: []
  };
}

export function chartRuntimeReducer(state: ChartRuntimeState, action: ChartRuntimeAction): ChartRuntimeState {
  switch (action.kind) {
    case "chart.ensureDocuments":
      return ensureChartDocuments(state, action.panels);
    case "chart.marketData.reset":
      return resetMarketData(state);
    case "chart.snapshot.loaded":
      return applySnapshot(state, action.snapshot);
    case "chart.snapshot.failed":
      return setDataStatus(state, action.symbol, action.interval, {
        state: "error",
        message: action.message,
        updatedAt: now()
      });
    case "chart.command":
      return applyCommand(state, action.command);
    case "chart.command.group":
      return applyCommandGroup(state, action.commands, action.label, action.proposalId);
    case "chart.proposal.received":
      return receiveProposal(state, action.proposal, action.autoApply);
    case "chart.proposal.accept":
      return acceptProposal(state, action.proposalId);
    case "chart.proposal.reject":
      return rejectProposal(state, action.proposalId);
    case "chart.live":
      return applyLiveEvent(state, action.event);
    case "chart.layer.live":
      return applyRealtimeLayerEvent(state, action.event);
    case "chart.data.status":
      return setDataStatus(state, action.symbol, action.interval, {
        ...action.status,
        updatedAt: now()
      });
    case "chart.stream.status":
      return setStreamStatus(state, action.symbol, action.interval, action.status, action.message);
    case "chart.error":
      return fail(state, action.message, action.chartDocumentId);
    default:
      return state;
  }
}

function resetMarketData(state: ChartRuntimeState): ChartRuntimeState {
  return {
    ...state,
    candlesByKey: {},
    candleKeyAccessOrder: [],
    liveTradesBySymbol: {},
    liveQuotesBySymbol: {},
    dataStatusByKey: {},
    streamStatusByKey: {},
    streamMessageByKey: {},
    journal: addJournal(
      state.journal,
      "chart.market-data.reset",
      "system",
      "applied",
      "Market data cleared before reconnecting to the live feed."
    )
  };
}

export function getChartDocumentForPanel(state: ChartRuntimeState, panel: ChartRuntimePanel): ChartDocument {
  const chartDocumentId = getChartDocumentId(panel);
  const document = state.documents[chartDocumentId];
  return document
    ? normalizeChartDocument(document)
    : createChartDocument(chartDocumentId, readPanelSymbol(panel), readPanelTimeframe(panel));
}

export function getChartDocumentId(panel: ChartRuntimePanel): string {
  return panel.chartDocumentId ?? `${panel.id}-chartDocument`;
}

export function getCandlesForDocument(state: ChartRuntimeState, document: ChartDocument) {
  return state.candlesByKey[candleKey(document.symbol, document.timeframe)] ?? [];
}

export function getDataStatusForDocument(state: ChartRuntimeState, document: ChartDocument): ChartDataStatus {
  return state.dataStatusByKey[candleKey(document.symbol, document.timeframe)] ?? {
    state: "loading",
    message: "Loading candles",
    updatedAt: now()
  };
}

export function getStreamStatusForDocument(state: ChartRuntimeState, document: ChartDocument): StreamStatus {
  return state.streamStatusByKey[candleKey(document.symbol, document.timeframe)] ?? "connecting";
}

export function getStreamMessageForDocument(state: ChartRuntimeState, document: ChartDocument): string | undefined {
  return state.streamMessageByKey?.[candleKey(document.symbol, document.timeframe)];
}

export function getLiveTradeForSymbol(state: ChartRuntimeState, symbol: string) {
  return state.liveTradesBySymbol?.[symbol.toUpperCase()] ?? state.liveTradesBySymbol?.[symbol];
}

export function getLiveQuoteForSymbol(state: ChartRuntimeState, symbol: string) {
  return state.liveQuotesBySymbol?.[symbol.toUpperCase()] ?? state.liveQuotesBySymbol?.[symbol];
}

function ensureChartDocuments(state: ChartRuntimeState, panels: ChartRuntimePanel[]): ChartRuntimeState {
  const chartPanels = panels.filter((panel) => panel.type === "chart");
  const activeDocumentIds = new Set(chartPanels.map(getChartDocumentId));
  const documents: ChartRuntimeState["documents"] = {};
  let changed = Object.keys(state.documents).length !== activeDocumentIds.size;

  for (const panel of chartPanels) {
    const id = getChartDocumentId(panel);
    const current = state.documents[id];
    const document = current
      ? normalizeChartDocument(current)
      : createChartDocument(id, readPanelSymbol(panel), readPanelTimeframe(panel));
    documents[id] = document;
    if (!current || document !== current) {
      changed = true;
    }
  }

  const pendingPreviewByDocumentId = Object.fromEntries(
    Object.entries(state.pendingPreviewByDocumentId)
      .filter(([documentId]) => activeDocumentIds.has(documentId))
      .map(([documentId, preview]): [string, ChartPendingPreview] => [documentId, sanitizeRemovedPointPreview(preview)])
      .filter(([, preview]) => preview.drawings.length > 0 || preview.comparisons.length > 0)
  );
  if (
    Object.keys(pendingPreviewByDocumentId).length !== Object.keys(state.pendingPreviewByDocumentId).length ||
    Object.entries(pendingPreviewByDocumentId).some(([documentId, preview]) => preview !== state.pendingPreviewByDocumentId[documentId])
  ) {
    changed = true;
  }

  const pendingProposals = state.pendingProposals
    .filter((proposal) => activeDocumentIds.has(proposal.target.chartDocumentId))
    .map(sanitizeRemovedPointProposal)
    .filter((proposal): proposal is ChartProposal => Boolean(proposal));
  if (
    pendingProposals.length !== state.pendingProposals.length ||
    pendingProposals.some((proposal, index) => proposal !== state.pendingProposals[index])
  ) {
    changed = true;
  }

  const errors = state.errors.filter((error) => !error.chartDocumentId || activeDocumentIds.has(error.chartDocumentId));
  if (errors.length !== state.errors.length) {
    changed = true;
  }

  return changed ? { ...state, documents, pendingPreviewByDocumentId, pendingProposals, errors } : state;
}

function applySnapshot(state: ChartRuntimeState, snapshot: CandleSnapshot): ChartRuntimeState {
  const key = candleKey(snapshot.symbol, snapshot.interval);
  const dataState = snapshot.dataStatus ?? (snapshot.candles.length ? "ready" : "empty");
  const current = state.candlesByKey[key] ?? [];
  const candleCache = boundedCandleCache(state, key, applySnapshotToCandles(snapshot, current));
  return {
    ...state,
    ...candleCache,
    dataStatusByKey: {
      ...state.dataStatusByKey,
      [key]: {
        state: dataState,
        message: snapshot.message ?? (dataState === "empty" ? "No candle data" : undefined),
        source: snapshot.source,
        feed: snapshot.feed,
        feedProfile: snapshot.feedProfile,
        marketSession: snapshot.marketSession,
        sourceInterval: snapshot.sourceInterval,
        requestedLimit: snapshot.requestedLimit,
        returnedCount: snapshot.returnedCount,
        targetStoredCount: snapshot.targetStoredCount,
        targetRangeFrom: snapshot.targetRangeFrom,
        storedCandleCount: snapshot.storedCandleCount,
        availableFrom: snapshot.availableFrom,
        availableTo: snapshot.availableTo,
        oldestTimestamp: snapshot.oldestTimestamp,
        newestTimestamp: snapshot.newestTimestamp,
        hasMoreBefore: snapshot.hasMoreBefore,
        hasMoreAfter: snapshot.hasMoreAfter,
        coverage: snapshot.coverage,
        updatedAt: now()
      }
    },
    journal: addJournal(state.journal, "chart.data.snapshot", "system", "applied", `${snapshot.symbol} ${snapshot.interval} snapshot loaded.`)
  };
}

function applyLiveEvent(state: ChartRuntimeState, event: CandleEvent): ChartRuntimeState {
  const key = candleKey(event.symbol, event.interval);
  const current = state.candlesByKey[key] ?? [];
  const result = applyCandleEvent(current, event);
  const previousStatus = state.dataStatusByKey[key];
  if (!result.applied) {
    return {
      ...state,
      journal: addJournal(state.journal, "chart.data.live", "system", "ignored", result.message),
      streamStatusByKey: { ...state.streamStatusByKey, [key]: "stale" }
    };
  }

  const appendedCount = Math.max(0, result.candles.length - current.length);
  const candleCache = boundedCandleCache(state, key, result.candles);

  return {
    ...state,
    ...candleCache,
    documents: appendedCount > 0
      ? reconcileViewportsAfterLiveAppend(
          state.documents,
          event.symbol,
          event.interval,
          current.length,
          result.candles.length
        )
      : state.documents,
    dataStatusByKey: {
      ...state.dataStatusByKey,
      [key]: {
        ...previousStatus,
        state: previousStatus?.state === "partial" && previousStatus.coverage?.renderable !== true ? "partial" : "ready",
        source: event.source ?? previousStatus?.source,
        feed: event.feed ?? previousStatus?.feed,
        feedProfile: event.feedProfile ?? event.data.feedProfile ?? previousStatus?.feedProfile,
        marketSession: event.marketSession ?? event.data.marketSession ?? previousStatus?.marketSession,
        sourceInterval: event.sourceInterval ?? event.data.sourceInterval ?? previousStatus?.sourceInterval,
        updatedAt: now()
      }
    },
    streamStatusByKey: { ...state.streamStatusByKey, [key]: "live" },
    journal: addJournal(state.journal, "chart.data.live", "system", "applied", result.message)
  };
}

function boundedCandleCache(
  state: ChartRuntimeState,
  touchedKey: string,
  touchedCandles: ChartRuntimeState["candlesByKey"][string]
): Pick<ChartRuntimeState, "candlesByKey" | "candleKeyAccessOrder"> {
  const nextCandles = { ...state.candlesByKey, [touchedKey]: touchedCandles };
  const accessOrder = [
    ...(state.candleKeyAccessOrder ?? Object.keys(state.candlesByKey)).filter((key) => key !== touchedKey),
    touchedKey
  ];
  const activeKeys = new Set(
    Object.values(state.documents).map((document) => candleKey(document.symbol, document.timeframe))
  );
  const retainedInactive = accessOrder
    .slice()
    .reverse()
    .filter((key) => !activeKeys.has(key) && Object.prototype.hasOwnProperty.call(nextCandles, key))
    .slice(0, maxInactiveCandleCacheKeys);
  const retainedKeys = new Set([...activeKeys, ...retainedInactive, touchedKey]);
  return {
    candlesByKey: Object.fromEntries(
      Object.entries(nextCandles).filter(([key]) => retainedKeys.has(key))
    ),
    candleKeyAccessOrder: accessOrder.filter((key) => retainedKeys.has(key))
  };
}

function applyRealtimeLayerEvent(state: ChartRuntimeState, event: RealtimeLayerEvent): ChartRuntimeState {
  const symbol = event.symbol.toUpperCase();
  if (event.type === "LIVE_TRADE_UPDATE") {
    const candlePatch = applyTradeTickToLiveCandles(state.candlesByKey, symbol, event.data);
    const documents = candlePatch.appendedIntervals.reduce(
      (current, interval) => {
        const previousCount = state.candlesByKey[candleKey(symbol, interval)]?.length ?? 0;
        return reconcileViewportsAfterLiveAppend(current, symbol, interval, previousCount, previousCount + 1);
      },
      state.documents
    );
    return {
      ...state,
      candlesByKey: candlePatch.changed ? candlePatch.candlesByKey : state.candlesByKey,
      documents,
      liveTradesBySymbol: { ...(state.liveTradesBySymbol ?? {}), [symbol]: event.data },
      journal: addJournal(state.journal, "chart.layer.trade", "system", "applied", `${symbol} live trade updated.`)
    };
  }
  return {
    ...state,
    liveQuotesBySymbol: { ...(state.liveQuotesBySymbol ?? {}), [symbol]: event.data },
    journal: addJournal(state.journal, "chart.layer.quote", "system", "applied", `${symbol} live quote updated.`)
  };
}

function applyTradeTickToLiveCandles(
  candlesByKey: ChartRuntimeState["candlesByKey"],
  symbol: string,
  trade: TradeTickData
): { candlesByKey: ChartRuntimeState["candlesByKey"]; appendedIntervals: string[]; changed: boolean } {
  const price = trade.price;
  const tradeTime = trade.timestamp ? Date.parse(trade.timestamp) : Number.NaN;
  if (typeof price !== "number" || !Number.isFinite(price) || !Number.isFinite(tradeTime)) {
    return { candlesByKey, appendedIntervals: [], changed: false };
  }

  const prefix = `${symbol}::`;
  let changed = false;
  const appendedIntervals: string[] = [];
  const nextByKey: ChartRuntimeState["candlesByKey"] = {};

  Object.entries(candlesByKey).forEach(([key, candles]) => {
    if (!key.startsWith(prefix)) {
      nextByKey[key] = candles;
      return;
    }
    const interval = normalizeChartInterval(key.slice(prefix.length));
    if (!interval) {
      nextByKey[key] = candles;
      return;
    }
    const result = applyTradeTickToCandleSeries(candles, interval, trade, tradeTime, price);
    nextByKey[key] = result.candles;
    if (result.changed) {
      changed = true;
    }
    if (result.appended) {
      appendedIntervals.push(interval);
    }
  });

  return {
    candlesByKey: changed ? nextByKey : candlesByKey,
    appendedIntervals,
    changed
  };
}

function applyTradeTickToCandleSeries(
  candles: CandleData[],
  interval: ChartInterval,
  trade: TradeTickData,
  tradeTime: number,
  price: number
): { candles: CandleData[]; appended: boolean; changed: boolean } {
  if (!candles.length) {
    return { candles, appended: false, changed: false };
  }

  const bucketTimestamp = tradeBucketTimestamp(tradeTime, interval);
  const bucketTime = Date.parse(bucketTimestamp);
  const last = candles[candles.length - 1];
  const lastTimestamp = canonicalTimestamp(last.timestamp);
  const lastTime = lastTimestamp ? Date.parse(lastTimestamp) : Number.NaN;
  if (!lastTimestamp || !Number.isFinite(lastTime)) {
    return { candles, appended: false, changed: false };
  }

  if (bucketTimestamp === lastTimestamp) {
    if (last.isClosed) {
      return { candles, appended: false, changed: false };
    }
    const next = patchLiveCandleWithTrade(last, price, trade);
    if (
      next.close === last.close &&
      next.high === last.high &&
      next.low === last.low &&
      next.updatedAt === last.updatedAt
    ) {
      return { candles, appended: false, changed: false };
    }
    const patched = candles.slice();
    patched[patched.length - 1] = next;
    return { candles: patched, appended: false, changed: true };
  }

  if (bucketTime > lastTime) {
    return {
      candles: [...candles, provisionalCandleFromTrade(bucketTimestamp, price, trade)],
      appended: true,
      changed: true
    };
  }

  return { candles, appended: false, changed: false };
}

function patchLiveCandleWithTrade(candle: CandleData, price: number, trade: TradeTickData): CandleData {
  const high = typeof candle.high === "number" && Number.isFinite(candle.high)
    ? Math.max(candle.high, price)
    : price;
  const low = typeof candle.low === "number" && Number.isFinite(candle.low)
    ? Math.min(candle.low, price)
    : price;
  return {
    ...candle,
    high,
    low,
    close: price,
    isClosed: false,
    updatedAt: trade.updatedAt ?? trade.timestamp ?? candle.updatedAt
  };
}

function provisionalCandleFromTrade(timestamp: string, price: number, trade: TradeTickData): CandleData {
  return {
    timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    isClosed: false,
    updatedAt: trade.updatedAt ?? trade.timestamp
  };
}

function tradeBucketTimestamp(tradeTime: number, interval: ChartInterval): string {
  const bucket = new Date(tradeTime);
  bucket.setUTCSeconds(0, 0);
  switch (interval) {
    case "1m":
      break;
    case "5m":
      bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5);
      break;
    case "10m":
      bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 10) * 10);
      break;
    case "1h":
      bucket.setUTCMinutes(0);
      break;
    case "4h":
      bucket.setUTCHours(Math.floor(bucket.getUTCHours() / 4) * 4, 0, 0, 0);
      break;
    case "1D":
      bucket.setUTCHours(0, 0, 0, 0);
      break;
    case "1W": {
      bucket.setUTCHours(0, 0, 0, 0);
      const day = bucket.getUTCDay();
      const mondayOffset = day === 0 ? 6 : day - 1;
      bucket.setUTCDate(bucket.getUTCDate() - mondayOffset);
      break;
    }
    case "1M":
      bucket.setUTCDate(1);
      bucket.setUTCHours(0, 0, 0, 0);
      break;
  }
  return bucket.toISOString();
}

function reconcileViewportsAfterLiveAppend(
  documents: ChartRuntimeState["documents"],
  symbol: string,
  interval: string,
  previousCandleCount: number,
  nextCandleCount: number
): ChartRuntimeState["documents"] {
  const appendedCount = Math.max(0, nextCandleCount - previousCandleCount);
  let changed = false;
  const next: ChartRuntimeState["documents"] = {};
  Object.entries(documents).forEach(([id, document]) => {
    if (
      document.symbol !== symbol ||
      document.timeframe !== interval
    ) {
      next[id] = document;
      return;
    }
    const followsLatest = document.viewport.rightOffset <= 0;
    const visibleCount = document.viewport.visibleCount;
    const rightOffset = followsLatest
      ? latestCandleRightOffset(visibleCount)
      : document.viewport.rightOffset + appendedCount;
    if (
      visibleCount === document.viewport.visibleCount &&
      rightOffset === document.viewport.rightOffset
    ) {
      next[id] = document;
      return;
    }
    changed = true;
    next[id] = {
      ...document,
      viewport: {
        visibleCount,
        rightOffset
      },
      updatedAt: now()
    };
  });
  return changed ? next : documents;
}

function applyCommand(state: ChartRuntimeState, command: ChartCommand): ChartRuntimeState {
  if (command.type.startsWith("chart.preview.")) {
    return applyPreviewCommand(state, command);
  }

  const document = state.documents[command.target.chartDocumentId];
  if (!document) {
    return fail(state, `Chart document not found: ${command.target.chartDocumentId}.`, command.target.chartDocumentId);
  }

  const result = executeChartCommand(document, command);
  if (!result.ok) {
    return fail(
      { ...state, journal: addJournal(state.journal, command.type, command.actor, "failed", result.message, document.id) },
      result.message,
      document.id
    );
  }

  if (result.noOp) {
    return state;
  }

  return {
    ...state,
    documents: { ...state.documents, [document.id]: result.document },
    journal: addJournal(state.journal, command.type, command.actor, "applied", result.message, document.id)
  };
}

function applyCommandGroup(
  state: ChartRuntimeState,
  commands: ChartCommand[],
  label: string,
  proposalId?: string
): ChartRuntimeState {
  if (commands.length === 0) {
    return state;
  }
  const documentId = commands[0]?.target.chartDocumentId;
  const document = documentId ? state.documents[documentId] : undefined;
  if (!document) {
    return fail(state, "Chart document not found.", documentId);
  }

  const result = executeChartCommandGroup(document, commands, label, proposalId);
  if (!result.ok) {
    return fail(
      { ...state, journal: addJournal(state.journal, commands[0].type, commands[0].actor, "failed", result.message, document.id) },
      result.message,
      document.id
    );
  }
  if (result.noOp) {
    return state;
  }
  return {
    ...state,
    documents: { ...state.documents, [document.id]: result.document },
    journal: addJournal(state.journal, commands[0].type, commands[0].actor, "applied", result.message, document.id)
  };
}

function receiveProposal(state: ChartRuntimeState, proposal: ChartProposal, autoApply: boolean): ChartRuntimeState {
  const sanitizedProposal = sanitizeRemovedPointProposal(proposal);
  if (!sanitizedProposal) {
    return fail(state, "Chart proposal did not include any supported commands.", proposal.target.chartDocumentId);
  }
  proposal = sanitizedProposal;
  const validation = validateChartProposal(proposal);
  if (validation) {
    return fail(state, validation, proposal.target.chartDocumentId);
  }

  if (proposal.commands.some(isPreviewFirstCommand)) {
    return setPendingPreviewFromProposal(state, proposal);
  }

  if (!autoApply) {
    return {
      ...state,
      pendingProposals: [{ ...proposal, status: "pending" as const }, ...state.pendingProposals].slice(0, 8),
      journal: addJournal(state.journal, "chart.proposal.accept", "llm", "proposed", proposal.title, proposal.target.chartDocumentId)
    };
  }

  return applyProposal(state, proposal, "applied");
}

function sanitizeRemovedPointPreview(preview: ChartPendingPreview): ChartPendingPreview {
  const drawings = preview.drawings.filter((drawing) => (drawing as { type?: unknown }).type !== "pointMarker");
  return drawings.length === preview.drawings.length ? preview : { ...preview, drawings };
}

function sanitizeRemovedPointProposal(proposal: ChartProposal): ChartProposal | null {
  const commands = proposal.commands
    .map(sanitizeRemovedPointCommand)
    .filter((command): command is ChartCommand => Boolean(command));
  if (!commands.length) {
    return null;
  }
  return commands.length === proposal.commands.length ? proposal : { ...proposal, commands };
}

function sanitizeRemovedPointCommand(command: ChartCommand): ChartCommand | null {
  const payload = command.payload;
  if (payload.drawingType === "pointMarker") {
    return null;
  }
  const drawing = payload.drawing;
  if (drawing && typeof drawing === "object" && !Array.isArray(drawing) && (drawing as { type?: unknown }).type === "pointMarker") {
    return null;
  }
  const preview = payload.preview;
  if (preview && typeof preview === "object" && !Array.isArray(preview)) {
    const previewRecord = preview as { drawings?: unknown; comparisons?: unknown };
    const previewDrawings = previewRecord.drawings;
    if (Array.isArray(previewDrawings)) {
      const drawings = previewDrawings.filter((item) => !item || typeof item !== "object" || (item as { type?: unknown }).type !== "pointMarker");
      if (drawings.length !== previewDrawings.length) {
        const comparisons = Array.isArray(previewRecord.comparisons) ? previewRecord.comparisons : [];
        if (!drawings.length && !comparisons.length) {
          return null;
        }
        return { ...command, payload: { ...payload, preview: { ...preview, drawings } } };
      }
    }
  }
  return command;
}

function acceptProposal(state: ChartRuntimeState, proposalId: string): ChartRuntimeState {
  const proposal = state.pendingProposals.find((item) => item.id === proposalId);
  if (!proposal) {
    return fail(state, "Chart proposal not found.");
  }
  return applyProposal(state, proposal, "applied");
}

function rejectProposal(state: ChartRuntimeState, proposalId: string): ChartRuntimeState {
  const proposal = state.pendingProposals.find((item) => item.id === proposalId);
  const nextPreviews = { ...state.pendingPreviewByDocumentId };
  if (proposal) {
    const preview = nextPreviews[proposal.target.chartDocumentId];
    if (preview?.sourceProposalId === proposalId) {
      delete nextPreviews[proposal.target.chartDocumentId];
    }
  }
  return {
    ...state,
    pendingPreviewByDocumentId: nextPreviews,
    pendingProposals: state.pendingProposals.filter((item) => item.id !== proposalId),
    journal: proposal
      ? addJournal(state.journal, "chart.proposal.reject", "user", "applied", `Rejected: ${proposal.title}`, proposal.target.chartDocumentId)
      : state.journal
  };
}

function applyProposal(state: ChartRuntimeState, proposal: ChartProposal, status: "applied"): ChartRuntimeState {
  const document = state.documents[proposal.target.chartDocumentId];
  if (!document) {
    return fail(state, "Chart document not found.", proposal.target.chartDocumentId);
  }

  const result = executeChartCommandGroup(document, proposal.commands, proposal.title, proposal.id);
  if (!result.ok) {
    return fail(
      {
        ...state,
        pendingProposals: state.pendingProposals.map((item) =>
          item.id === proposal.id ? { ...item, status: "failed" as const, error: result.message } : item
        )
      },
      result.message,
      document.id
    );
  }

  if (result.noOp) {
    return {
      ...state,
      pendingProposals: state.pendingProposals.filter((item) => item.id !== proposal.id)
    };
  }

  return {
    ...state,
    documents: { ...state.documents, [document.id]: result.document },
    pendingProposals: state.pendingProposals.filter((item) => item.id !== proposal.id),
    journal: addJournal(state.journal, "chart.proposal.accept", "llm", status, result.message, document.id)
  };
}

function applyPreviewCommand(state: ChartRuntimeState, command: ChartCommand): ChartRuntimeState {
  switch (command.type) {
    case "chart.preview.set": {
      const preview = normalizePreviewPayload(command.payload.preview, command.target.chartDocumentId, command.actor, command.proposalId);
      if (!preview) {
        return fail(state, "Invalid chart preview payload.", command.target.chartDocumentId);
      }
      return {
        ...state,
        pendingPreviewByDocumentId: {
          ...state.pendingPreviewByDocumentId,
          [command.target.chartDocumentId]: preview
        },
        journal: addJournal(state.journal, command.type, command.actor, "applied", "Chart preview set.", command.target.chartDocumentId)
      };
    }
    case "chart.preview.toggle": {
      const preview = state.pendingPreviewByDocumentId[command.target.chartDocumentId];
      if (!preview) {
        return state;
      }
      const visible = typeof command.payload.previewVisible === "boolean" ? command.payload.previewVisible : !preview.visible;
      return {
        ...state,
        pendingPreviewByDocumentId: {
          ...state.pendingPreviewByDocumentId,
          [command.target.chartDocumentId]: { ...preview, visible }
        },
        journal: addJournal(state.journal, command.type, command.actor, "applied", visible ? "Chart preview shown." : "Chart preview hidden.", command.target.chartDocumentId)
      };
    }
    case "chart.preview.clear": {
      if (!state.pendingPreviewByDocumentId[command.target.chartDocumentId]) {
        return state;
      }
      const nextPreviews = { ...state.pendingPreviewByDocumentId };
      delete nextPreviews[command.target.chartDocumentId];
      return {
        ...state,
        pendingPreviewByDocumentId: nextPreviews,
        journal: addJournal(state.journal, command.type, command.actor, "applied", "Chart preview cleared.", command.target.chartDocumentId)
      };
    }
    case "chart.preview.apply": {
      const preview = state.pendingPreviewByDocumentId[command.target.chartDocumentId];
      const document = state.documents[command.target.chartDocumentId];
      if (!preview || !document) {
        return fail(state, "No chart preview to apply.", command.target.chartDocumentId);
      }
      if (!preview.visible) {
        return fail(state, "Hidden chart preview cannot be applied.", command.target.chartDocumentId);
      }
      const commands = [
        ...preview.drawings.map((drawing) => ({
          ...command,
          id: `chart-command-${crypto.randomUUID()}`,
          type: "chart.drawing.add" as const,
          actor: command.actor,
          payload: { drawing: { ...drawing, createdBy: command.actor, sourceProposalId: preview.sourceProposalId } },
          proposalId: preview.sourceProposalId
        })),
        ...preview.comparisons.map((comparison) => ({
          ...command,
          id: `chart-command-${crypto.randomUUID()}`,
          type: "chart.comparison.add" as const,
          actor: command.actor,
          payload: { comparison },
          proposalId: preview.sourceProposalId
        }))
      ];
      const result = executeChartCommandGroup(document, commands, "Apply chart preview", preview.sourceProposalId);
      if (!result.ok) {
        return fail(state, result.message, document.id);
      }
      const nextPreviews = { ...state.pendingPreviewByDocumentId };
      delete nextPreviews[document.id];
      if (result.noOp) {
        return { ...state, pendingPreviewByDocumentId: nextPreviews };
      }
      return {
        ...state,
        documents: { ...state.documents, [document.id]: result.document },
        pendingPreviewByDocumentId: nextPreviews,
        pendingProposals: state.pendingProposals.filter((item) => item.id !== preview.sourceProposalId),
        journal: addJournal(state.journal, command.type, command.actor, "applied", result.message, document.id)
      };
    }
    default:
      return state;
  }
}

function setPendingPreviewFromProposal(state: ChartRuntimeState, proposal: ChartProposal): ChartRuntimeState {
  const preview = buildPreviewFromProposal(proposal);
  if (!preview) {
    return fail(state, "Preview proposal did not include drawable content.", proposal.target.chartDocumentId);
  }

  return {
    ...state,
    pendingPreviewByDocumentId: {
      ...state.pendingPreviewByDocumentId,
      [proposal.target.chartDocumentId]: preview
    },
    pendingProposals: [{ ...proposal, status: "pending" as const }, ...state.pendingProposals.filter((item) => item.target.chartDocumentId !== proposal.target.chartDocumentId)].slice(0, 8),
    journal: addJournal(state.journal, "chart.preview.set", "llm", "proposed", proposal.title, proposal.target.chartDocumentId)
  };
}

function buildPreviewFromProposal(proposal: ChartProposal): ChartPendingPreview | null {
  const drawings = proposal.commands.flatMap((command) => {
    const drawing = normalizeDrawingFromCommand(command);
    return drawing ? [drawing] : [];
  });
  const comparisons = proposal.commands.flatMap((command) => {
    const comparison = normalizeComparisonFromCommand(command);
    return comparison ? [comparison] : [];
  });
  const preview = normalizePreviewPayload({
    id: `preview-${proposal.id}`,
    sourceProposalId: proposal.id,
    drawings,
    comparisons,
    rationale: proposal.rationale,
    confidence: 0.72
  }, proposal.target.chartDocumentId, "llm", proposal.id);
  return preview && (preview.drawings.length > 0 || preview.comparisons.length > 0) ? preview : null;
}

function normalizePreviewPayload(
  value: unknown,
  chartDocumentId: string,
  actor: ChartCommand["actor"],
  proposalId?: string
): ChartPendingPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const nowTime = now();
  const drawings = Array.isArray(source.drawings)
    ? source.drawings
      .map((item) => normalizeDrawingEntity(item, actor, proposalId))
      .filter((item): item is ChartPendingPreview["drawings"][number] => Boolean(item))
    : [];
  const comparisons = Array.isArray(source.comparisons)
    ? source.comparisons
      .map(normalizeComparisonSeries)
      .filter((item): item is ChartPendingPreview["comparisons"][number] => Boolean(item))
    : [];
  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id : `chart-preview-${chartDocumentId}-${crypto.randomUUID()}`,
    sourceProposalId: typeof source.sourceProposalId === "string" ? source.sourceProposalId : proposalId,
    drawings,
    comparisons,
    rationale: typeof source.rationale === "string" ? source.rationale : undefined,
    confidence: typeof source.confidence === "number" ? source.confidence : undefined,
    visible: typeof source.visible === "boolean" ? source.visible : true,
    createdAt: nowTime
  };
}

function isPreviewFirstCommand(command: ChartCommand): boolean {
  return command.type.startsWith("chart.drawing.") ||
    command.type.startsWith("chart.comparison.");
}

function setDataStatus(
  state: ChartRuntimeState,
  symbol: string,
  interval: string,
  status: ChartDataStatus
): ChartRuntimeState {
  const key = candleKey(symbol, interval);
  return {
    ...state,
    dataStatusByKey: { ...state.dataStatusByKey, [key]: status }
  };
}

function setStreamStatus(
  state: ChartRuntimeState,
  symbol: string,
  interval: string,
  status: StreamStatus,
  message?: string
): ChartRuntimeState {
  const key = candleKey(symbol, interval);
  const streamMessageByKey = { ...(state.streamMessageByKey ?? {}) };
  if (message) {
    streamMessageByKey[key] = message;
  } else {
    delete streamMessageByKey[key];
  }
  return {
    ...state,
    streamStatusByKey: { ...state.streamStatusByKey, [key]: status },
    streamMessageByKey,
    journal: message ? addJournal(state.journal, "chart.data.live", "system", status === "error" ? "failed" : "applied", message) : state.journal
  };
}

function fail(state: ChartRuntimeState, message: string, chartDocumentId?: string): ChartRuntimeState {
  return {
    ...state,
    errors: addError(state.errors, message, chartDocumentId)
  };
}

function addJournal(
  journal: ChartCommandJournalEntry[],
  commandType: ChartCommandJournalEntry["commandType"],
  actor: ChartCommandJournalEntry["actor"],
  status: ChartCommandJournalEntry["status"],
  message: string,
  chartDocumentId?: string
): ChartCommandJournalEntry[] {
  return [
    {
      id: `chart-journal-${crypto.randomUUID()}`,
      commandType,
      actor,
      status,
      message,
      chartDocumentId,
      createdAt: now()
    },
    ...journal
  ].slice(0, 30);
}

function addError(errors: ChartRuntimeError[], message: string, chartDocumentId?: string): ChartRuntimeError[] {
  return [
    {
      id: `chart-error-${crypto.randomUUID()}`,
      message,
      chartDocumentId,
      createdAt: now()
    },
    ...errors
  ].slice(0, 10);
}

function readPanelSymbol(panel: ChartRuntimePanel): string {
  return typeof panel.props.symbol === "string" && panel.props.symbol.trim()
    ? panel.props.symbol.trim().toUpperCase()
    : DEFAULT_CHART_SYMBOL;
}

function readPanelTimeframe(panel: ChartRuntimePanel): string {
  return normalizeChartInterval(panel.props.timeframe) ?? "1m";
}

function now() {
  return new Date().toISOString();
}
