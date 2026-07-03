import { normalizeChartInterval } from "./intervals";
import { canonicalTimestamp } from "./time";
import type { BackfillStatus, CandleData, CandleEvent, CandleEventType, CandleSnapshot, ChartCoverage, ChartCoverageState, ChartGapRange, ChartSnapshotDataStatus, QuoteTickData, RealtimeLayerEvent, RepairStatus, TradeTickData } from "./types";

export type RealtimeControlType = "HEARTBEAT" | "MARKET_STATUS_UPDATE" | "VOLUME_PROFILE_BINS_UPDATE" | "ERROR";

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeCandle(value: unknown): CandleData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const timestamp = canonicalTimestamp(readString(source.timestamp) ?? "");
  const open = readNumber(source.open);
  const high = readNumber(source.high);
  const low = readNumber(source.low);
  const close = readNumber(source.close);
  const volume = readNumber(source.volume);
  const ma5 = readNumber(source.ma5);
  const ma20 = readNumber(source.ma20);
  const ma60 = readNumber(source.ma60);
  const sourceInterval = readString(source.sourceInterval);
  const feedProfile = readString(source.feedProfile);
  const marketSession = readString(source.marketSession);
  const updatedAt = readString(source.updatedAt);

  if (!timestamp || open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    isClosed: typeof source.isClosed === "boolean" ? source.isClosed : true,
    ...(sourceInterval ? { sourceInterval } : {}),
    ...(feedProfile ? { feedProfile } : {}),
    ...(marketSession ? { marketSession } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(ma5 !== null ? { ma5 } : {}),
    ...(ma20 !== null ? { ma20 } : {}),
    ...(ma60 !== null ? { ma60 } : {})
  };
}

function readCandleEventType(value: unknown): CandleEventType | null {
  return value === "LIVE_CANDLE_UPDATE" || value === "CANDLE_CLOSED" || value === "CANDLE_CORRECTED"
    ? value
    : null;
}

function readDataStatus(value: unknown): ChartSnapshotDataStatus | undefined {
  return value === "ready" || value === "partial" || value === "empty" || value === "error" ? value : undefined;
}

function readBackfillStatus(value: unknown): BackfillStatus | undefined {
  return value === "not_requested" ||
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "unavailable"
    ? value
    : undefined;
}

function readRepairStatus(value: unknown): RepairStatus | undefined {
  return value === "none" ||
    value === "gapfill_required" ||
    value === "gapfill_active" ||
    value === "gapfill_failed" ||
    value === "history_preload_required"
    ? value
    : undefined;
}

function readCoverageState(value: unknown): ChartCoverageState | undefined {
  return value === "complete" || value === "partial" || value === "empty" || value === "unavailable" ? value : undefined;
}

function normalizeCoverage(value: unknown): ChartCoverage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const state = readCoverageState(source.state);
  if (!state) {
    return undefined;
  }
  return {
    state,
    reasonCode: readString(source.reasonCode) ?? undefined,
    message: readString(source.message) ?? undefined,
    repairStatus: readRepairStatus(source.repairStatus),
    sourceInterval: readString(source.sourceInterval) ?? undefined,
    backfillStatus: readBackfillStatus(source.backfillStatus),
    requestedLimit: readNumber(source.requestedLimit) ?? undefined,
    returnedCount: readNumber(source.returnedCount) ?? undefined,
    storedCandleCount: readNumber(source.storedCandleCount) ?? undefined,
    targetStoredCount: readNumber(source.targetStoredCount) ?? undefined,
    targetRangeFrom: readString(source.targetRangeFrom) ?? undefined,
    availableFrom: readString(source.availableFrom) ?? undefined,
    availableTo: readString(source.availableTo) ?? undefined,
    invalidRowCount: readNumber(source.invalidRowCount) ?? undefined,
    renderable: readBoolean(source.renderable) ?? undefined,
    minimumReturnedCount: readNumber(source.minimumReturnedCount) ?? undefined,
    minimumRenderableSourceBars: readNumber(source.minimumRenderableSourceBars) ?? undefined,
    returnedSpanSeconds: readNumber(source.returnedSpanSeconds) ?? undefined,
    maxRenderableSpanSeconds: readNumber(source.maxRenderableSpanSeconds) ?? undefined,
    renderabilityReasonCode: readString(source.renderabilityReasonCode) ?? undefined,
    gapRanges: normalizeGapRanges(source.gapRanges)
  };
}

function normalizeGapRanges(value: unknown): ChartGapRange[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ranges = value
    .map((item): ChartGapRange | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const source = item as Record<string, unknown>;
      const start = readString(source.start);
      const end = readString(source.end);
      if (!start || !end) {
        return null;
      }
      return {
        start,
        end,
        missingCount: readNumber(source.missingCount) ?? undefined
      };
    })
    .filter((item): item is ChartGapRange => Boolean(item));
  return ranges.length ? ranges : undefined;
}

export function isRealtimeControlPayload(payload: unknown): payload is Record<string, unknown> & { type: RealtimeControlType } {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const type = (payload as Record<string, unknown>).type;
  return type === "HEARTBEAT" || type === "MARKET_STATUS_UPDATE" || type === "VOLUME_PROFILE_BINS_UPDATE" || type === "ERROR";
}

export function isRealtimeLayerPayload(payload: unknown): payload is Record<string, unknown> & { type: RealtimeLayerEvent["type"] } {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const type = (payload as Record<string, unknown>).type;
  return type === "LIVE_TRADE_UPDATE" || type === "LIVE_QUOTE_UPDATE";
}

function normalizeIndicators(value: unknown): CandleSnapshot["indicators"] {
  if (!value || typeof value !== "object") {
    return { ma: [5, 20, 60], volume: true };
  }

  const source = value as Record<string, unknown>;
  const ma = Array.isArray(source.ma)
    ? source.ma.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [5, 20, 60];

  return {
    ma: ma.length ? ma : [5, 20, 60],
    volume: typeof source.volume === "boolean" ? source.volume : true
  };
}

export function normalizeCandleSnapshot(payload: unknown): CandleSnapshot {
  if (!payload || typeof payload !== "object") {
    throw new Error("Candle snapshot payload is invalid.");
  }

  const source = payload as Record<string, unknown>;
  const symbol = readString(source.symbol);
  const interval = normalizeChartInterval(readString(source.interval) ?? "");
  const candles = Array.isArray(source.candles)
    ? source.candles.map(normalizeCandle).filter((item): item is CandleData => Boolean(item))
    : [];

  if (!symbol || !interval) {
    throw new Error("Candle snapshot is missing symbol or interval.");
  }

  return {
    symbol,
    interval,
    source: readString(source.source) ?? "unknown",
    feed: readString(source.feed) ?? "unknown",
    feedProfile: readString(source.feedProfile) ?? undefined,
    marketSession: readString(source.marketSession) ?? undefined,
    snapshotCursor: readString(source.snapshotCursor) ?? undefined,
    dataStatus: readDataStatus(source.dataStatus),
    backfillStatus: readBackfillStatus(source.backfillStatus),
    repairStatus: readRepairStatus(source.repairStatus),
    canBackfill: readBoolean(source.canBackfill) ?? undefined,
    sourceInterval: readString(source.sourceInterval) ?? undefined,
    message: readString(source.message) ?? undefined,
    requestedLimit: readNumber(source.requestedLimit) ?? undefined,
    returnedCount: readNumber(source.returnedCount) ?? undefined,
    targetStoredCount: readNumber(source.targetStoredCount) ?? undefined,
    targetRangeFrom: readString(source.targetRangeFrom) ?? undefined,
    storedCandleCount: readNumber(source.storedCandleCount) ?? undefined,
    availableFrom: readString(source.availableFrom) ?? undefined,
    availableTo: readString(source.availableTo) ?? undefined,
    oldestTimestamp: readString(source.oldestTimestamp) ?? undefined,
    newestTimestamp: readString(source.newestTimestamp) ?? undefined,
    hasMoreBefore: readBoolean(source.hasMoreBefore) ?? undefined,
    hasMoreAfter: readBoolean(source.hasMoreAfter) ?? undefined,
    coverage: normalizeCoverage(source.coverage),
    indicators: normalizeIndicators(source.indicators),
    candles
  };
}

export function normalizeCandleEvent(payload: unknown): CandleEvent {
  if (!payload || typeof payload !== "object") {
    throw new Error("Candle event payload is invalid.");
  }

  const source = payload as Record<string, unknown>;
  const type = readCandleEventType(source.type);
  const symbol = readString(source.symbol);
  const interval = normalizeChartInterval(readString(source.interval) ?? "");
  const candle = normalizeCandle(source.data);

  if (!type || !symbol || !interval || !candle) {
    throw new Error("Candle event is missing type, symbol, interval, or data.");
  }

  return {
    type,
    eventId: readString(source.eventId) ?? undefined,
    cursor: readString(source.cursor) ?? undefined,
    symbol,
    interval,
    sourceInterval: readString(source.sourceInterval) ?? undefined,
    source: readString(source.source) ?? undefined,
    feed: readString(source.feed) ?? undefined,
    feedProfile: readString(source.feedProfile) ?? undefined,
    marketSession: readString(source.marketSession) ?? undefined,
    data: candle
  };
}

export function normalizeRealtimeLayerEvent(payload: unknown): RealtimeLayerEvent {
  if (!payload || typeof payload !== "object") {
    throw new Error("Realtime layer payload is invalid.");
  }
  const source = payload as Record<string, unknown>;
  const type = source.type;
  const symbol = readString(source.symbol);
  if ((type !== "LIVE_TRADE_UPDATE" && type !== "LIVE_QUOTE_UPDATE") || !symbol) {
    throw new Error("Realtime layer event is missing type or symbol.");
  }
  const data = source.data && typeof source.data === "object" ? source.data as Record<string, unknown> : {};
  if (type === "LIVE_TRADE_UPDATE") {
    return { type, symbol, data: normalizeTradeTick(data) };
  }
  return { type, symbol, data: normalizeQuoteTick(data) };
}

function normalizeTradeTick(source: Record<string, unknown>): TradeTickData {
  return {
    tradeId: readString(source.tradeId) ?? readString(source.id) ?? undefined,
    price: readNumber(source.price) ?? undefined,
    size: readNumber(source.size) ?? undefined,
    exchange: readString(source.exchange) ?? undefined,
    conditions: readStringArray(source.conditions),
    tape: readString(source.tape) ?? undefined,
    timestamp: canonicalTimestamp(readString(source.timestamp) ?? "") || undefined,
    updatedAt: readString(source.updatedAt) ?? undefined
  };
}

function normalizeQuoteTick(source: Record<string, unknown>): QuoteTickData {
  return {
    bidPrice: readNumber(source.bidPrice) ?? undefined,
    bidSize: readNumber(source.bidSize) ?? undefined,
    askPrice: readNumber(source.askPrice) ?? undefined,
    askSize: readNumber(source.askSize) ?? undefined,
    bidExchange: readString(source.bidExchange) ?? undefined,
    askExchange: readString(source.askExchange) ?? undefined,
    conditions: readStringArray(source.conditions),
    timestamp: canonicalTimestamp(readString(source.timestamp) ?? "") || undefined,
    updatedAt: readString(source.updatedAt) ?? undefined
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return items.length ? items : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}
