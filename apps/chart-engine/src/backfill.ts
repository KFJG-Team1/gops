import type { BackfillStatus, ChartDataStatus } from "./types";

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
  return status.state === "empty" &&
    status.canBackfill === true &&
    !isActiveBackfillStatus(status.backfillStatus) &&
    status.backfillStatus !== "succeeded" &&
    status.backfillStatus !== "failed" &&
    status.backfillStatus !== "unavailable";
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
