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
const terminalBackfillStatuses = new Set<BackfillStatus>(["succeeded", "failed", "unavailable"]);

export function isActiveBackfillStatus(status?: BackfillStatus): boolean {
  return Boolean(status && activeBackfillStatuses.has(status));
}

export function shouldRequestBackfill(status: ChartDataStatus): boolean {
  const needsSourceData =
    status.state === "empty" ||
    status.state === "error" ||
    (status.state === "partial" && status.coverage?.renderable !== true);
  return needsSourceData &&
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

export function shouldForceBackfill(status: ChartDataStatus): boolean {
  return Boolean(status.backfillStatus && terminalBackfillStatuses.has(status.backfillStatus));
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
  return status.coverage ? status.coverage.renderable === true : true;
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
