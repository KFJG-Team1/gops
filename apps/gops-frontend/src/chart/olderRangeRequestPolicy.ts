import type { ChartInterval } from "./types";

export const olderRangeQueuedRetryDelayMs = 15_000;
export const olderRangeTerminalRetryDelayMs = 5 * 60_000;

export function olderRangeRequestKey(
  symbol: string,
  interval: ChartInterval,
  before: string,
  limit: number
): string {
  return `${symbol.trim().toUpperCase()}:${interval}:before:${before}:${Math.max(1, Math.round(limit))}`;
}

export function shouldRequestOlderRange(retryAfterMs: number | undefined, nowMs = Date.now()): boolean {
  return typeof retryAfterMs !== "number" || retryAfterMs <= nowMs;
}

type OlderRangeResponseSummary = {
  candles: readonly unknown[];
  fill?: {
    backgroundFill?: {
      queued?: boolean;
      state?: string;
    };
  };
  hasMoreBefore?: boolean;
};

export function olderRangeRetryAfterMs(
  response: OlderRangeResponseSummary,
  addedCount: number,
  nowMs = Date.now()
): number | null {
  if (addedCount > 0) {
    return null;
  }
  const backgroundState = response.fill?.backgroundFill?.state;
  const backgroundQueued = Boolean(response.fill?.backgroundFill?.queued);
  if (backgroundQueued || backgroundState === "queued" || backgroundState === "already_queued") {
    return nowMs + olderRangeQueuedRetryDelayMs;
  }
  if (response.hasMoreBefore === false || response.candles.length === 0) {
    return nowMs + olderRangeTerminalRetryDelayMs;
  }
  return nowMs + olderRangeQueuedRetryDelayMs;
}
