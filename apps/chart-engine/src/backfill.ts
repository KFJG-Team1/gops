import type { BackfillStatus, CandleSnapshot, ChartDataStatus } from "./types";

export type BackfillStatusPayload = {
  symbol?: string;
  interval?: string;
  sourceInterval?: string;
  requestId?: string;
  status: BackfillStatus;
  error?: string;
};


const activeBackfillStatuses = new Set<BackfillStatus>(["queued", "running"]);
export function isActiveBackfillStatus(status?: BackfillStatus): boolean {
  return Boolean(status && activeBackfillStatuses.has(status));
}

export function shouldRequestBackfill(status: ChartDataStatus): boolean {
  return hasExplicitGapRange(status) &&
    status.canBackfill === true &&
    !isActiveBackfillStatus(status.backfillStatus);
}

export function shouldRequestRangeBackfill(snapshot: CandleSnapshot): boolean {
  const dataState = snapshot.dataStatus ?? (snapshot.candles.length ? "ready" : "empty");
  const needsSourceData =
    dataState === "empty" ||
    dataState === "error" ||
    (dataState === "partial" && snapshot.coverage?.renderable !== true) ||
    snapshot.repairStatus === "gapfill_required";
  return needsSourceData &&
    snapshot.canBackfill === true &&
    !isActiveBackfillStatus(snapshot.backfillStatus);
}

export function rangeBackfillWindow(interval: string, beforeTimestamp: string, pageLimit: number): { start: string; end: string } | null {
  const before = Date.parse(beforeTimestamp);
  if (!Number.isFinite(before)) {
    return null;
  }
  const units = Math.max(1, Math.floor(pageLimit || 1));
  const spanMs = intervalBackfillSpanMs(interval, units);
  return {
    start: new Date(before - spanMs).toISOString(),
    end: new Date(before).toISOString()
  };
}

export function firstSnapshotGapBackfillWindow(snapshot: CandleSnapshot): { start: string; end: string } | null {
  return firstValidGapRange(snapshot.coverage?.gapRanges);
}

export function rangeBackfillWindowForSnapshot(
  snapshot: CandleSnapshot,
  interval: string,
  beforeTimestamp: string,
  pageLimit: number
): { start: string; end: string } | null {
  return firstSnapshotGapBackfillWindow(snapshot) ?? rangeBackfillWindow(interval, beforeTimestamp, pageLimit);
}

export function initialBackfillWindow(interval: string, endTimestamp: string): { start: string; end: string } | null {
  const end = Date.parse(endTimestamp);
  if (!Number.isFinite(end)) {
    return null;
  }
  const lookbackMs = initialBackfillLookbackMs(interval);
  if (!lookbackMs) {
    return null;
  }
  return {
    start: new Date(end - lookbackMs).toISOString(),
    end: new Date(end).toISOString()
  };
}

export function shouldForceBackfill(status: ChartDataStatus): boolean {
  void status;
  return false;
}

export function isPreparingCandleData(
  status: ChartDataStatus,
  backfillEligible: boolean,
  requestInFlight = false
): boolean {
  return status.state === "empty" &&
    backfillEligible &&
    (
      shouldRequestBackfill(status) ||
      requestInFlight ||
      isActiveBackfillStatus(status.backfillStatus)
    );
}

export function isChartDataRenderable(status: ChartDataStatus): boolean {
  if (status.state === "ready") {
    return true;
  }
  if (status.state !== "partial") {
    return false;
  }
  const coverage = status.coverage;
  if (
    (coverage?.renderabilityReasonCode ?? coverage?.reasonCode) === "returned_window_sparse" &&
    (status.returnedCount ?? coverage?.returnedCount ?? 0) > 0
  ) {
    return true;
  }
  return coverage ? coverage.renderable === true : true;
}

export function firstGapBackfillWindow(status: ChartDataStatus): { start: string; end: string } | null {
  return firstValidGapRange(status.coverage?.gapRanges);
}

function hasExplicitGapRange(status: ChartDataStatus): boolean {
  return Boolean(firstGapBackfillWindow(status));
}

export function normalizeBackfillStatusPayload(payload: unknown): BackfillStatusPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Backfill status payload is invalid.");
  }

  const source = payload as Record<string, unknown>;
  const status = readBackfillStatus(source.status);
  if (!status) {
    throw new Error("Backfill status payload is missing status.");
  }

  return {
    symbol: readString(source.symbol) ?? undefined,
    interval: readString(source.interval) ?? undefined,
    sourceInterval: readString(source.sourceInterval) ?? undefined,
    requestId: readString(source.requestId) ?? undefined,
    status,
    error: readString(source.error) ?? undefined
  };
}

function readBackfillStatus(value: unknown): BackfillStatus | null {
  return value === "not_requested" ||
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "unavailable"
    ? value
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstValidGapRange(ranges?: Array<{ start?: string; end?: string }>): { start: string; end: string } | null {
  const range = ranges?.find((item) => Boolean(item.start && item.end));
  if (!range?.start || !range.end) {
    return null;
  }
  return { start: range.start, end: range.end };
}

function intervalBackfillSpanMs(interval: string, units: number): number {
  const minute = 60_000;
  const day = 24 * 60 * minute;
  switch (interval) {
    case "1m":
      return units * minute * 4;
    case "5m":
      return units * 5 * minute * 4;
    case "10m":
      return units * 10 * minute * 4;
    case "1D":
      return units * day * 2;
    case "1W":
      return units * day * 8;
    case "1M":
      return units * day * 32;
    default:
      return units * minute * 4;
  }
}

function initialBackfillLookbackMs(interval: string): number {
  const day = 24 * 60 * 60_000;
  switch (interval) {
    case "1m":
    case "5m":
    case "10m":
      return 14 * day;
    case "1D":
      return 370 * day;
    case "1W":
      return 4 * 365 * day;
    case "1M":
      return 6 * 365 * day;
    default:
      return 13 * day;
  }
}
