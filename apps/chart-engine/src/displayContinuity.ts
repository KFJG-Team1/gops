import { canonicalTimestamp } from "./time";
import type { CandleData } from "./types";

const intradayIntervals = new Set(["1m", "5m", "10m"]);
const intervalMsByKey: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "10m": 10 * 60_000
};
const maxDisplayFillByKey: Record<string, number> = {
  "1m": 720,
  "5m": 144,
  "10m": 72
};

type MarketSession = "pre" | "regular" | "after" | "overnight" | "unknown";

export function applyDisplayContinuity(candles: CandleData[], interval: string): CandleData[] {
  if (!intradayIntervals.has(interval) || candles.length < 2) {
    return candles;
  }

  const bucketMs = intervalMsByKey[interval] ?? intervalMsByKey["1m"];
  const maxDisplayFill = maxDisplayFillByKey[interval] ?? maxDisplayFillByKey["1m"];
  const sorted = [...candles].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const result: CandleData[] = [];

  sorted.forEach((current, index) => {
    if (index === 0) {
      result.push(current);
      return;
    }

    const previous = result[result.length - 1] ?? sorted[index - 1];
    const previousTime = Date.parse(previous.timestamp);
    const currentTime = Date.parse(current.timestamp);
    const missingBuckets = Math.floor((currentTime - previousTime) / bucketMs) - 1;

    if (shouldFillDisplayGap(previous, current, missingBuckets, maxDisplayFill)) {
      for (let step = 1; step <= missingBuckets; step += 1) {
        result.push(displayCarryForwardCandle(previous, previousTime + bucketMs * step));
      }
    }

    result.push(current);
  });

  return result;
}

function shouldFillDisplayGap(previous: CandleData, current: CandleData, missingBuckets: number, maxDisplayFill: number): boolean {
  if (missingBuckets <= 0 || missingBuckets > maxDisplayFill) {
    return false;
  }
  const previousSession = normalizedSession(previous.marketSession) ?? sessionForTimestamp(previous.timestamp);
  const currentSession = normalizedSession(current.marketSession) ?? sessionForTimestamp(current.timestamp);
  if (previousSession === "regular" && currentSession === "regular") {
    return false;
  }
  if (previousSession === "unknown" || currentSession === "unknown") {
    return false;
  }
  return previousSession !== "regular" || currentSession !== "regular";
}

function displayCarryForwardCandle(previous: CandleData, timestampMs: number): CandleData {
  const timestamp = canonicalTimestamp(new Date(timestampMs).toISOString()) ?? new Date(timestampMs).toISOString();
  const price = previous.close;
  return {
    timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    isClosed: false,
    sourceInterval: "display",
    feedProfile: previous.feedProfile,
    marketSession: sessionForTimestamp(timestamp),
    updatedAt: previous.updatedAt,
    displayOnly: true,
    synthetic: true,
    ...(typeof previous.ma5 === "number" ? { ma5: previous.ma5 } : {}),
    ...(typeof previous.ma20 === "number" ? { ma20: previous.ma20 } : {}),
    ...(typeof previous.ma60 === "number" ? { ma60: previous.ma60 } : {})
  };
}

function normalizedSession(value?: string): MarketSession | null {
  if (value === "pre" || value === "regular" || value === "after" || value === "overnight") {
    return value;
  }
  return null;
}

function sessionForTimestamp(timestamp: string): MarketSession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp));
  const hour = numberPart(parts, "hour");
  const minute = numberPart(parts, "minute");
  if (hour === null || minute === null) {
    return "unknown";
  }
  const normalizedHour = hour === 24 ? 0 : hour;
  const minutes = normalizedHour * 60 + minute;
  if (minutes >= 20 * 60 || minutes < 4 * 60) {
    return "overnight";
  }
  if (minutes < 9 * 60 + 30) {
    return "pre";
  }
  if (minutes < 16 * 60) {
    return "regular";
  }
  return "after";
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number | null {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
