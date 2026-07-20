import type { CandleData, CandleEvent, CandleSnapshot } from "./types";
import { canonicalTimestamp } from "./time";

export type CandleMergeResult = {
  candles: CandleData[];
  applied: boolean;
  message: string;
};

export function candleKey(symbol: string, interval: string): string {
  return `${symbol.toUpperCase()}::${interval}`;
}

export function applySnapshotToCandles(snapshot: CandleSnapshot, current: CandleData[] = []): CandleData[] {
  const byTimestamp = new Map<string, CandleData>();
  [...current, ...snapshot.candles].forEach((candle) => {
    const key = candleTimestampKey(candle);
    if (key) {
      byTimestamp.set(key, { ...candle, timestamp: key });
    }
  });
  return [...byTimestamp.values()].sort(compareCandles);
}

export function applyCandleEvent(current: CandleData[], event: CandleEvent): CandleMergeResult {
  const incomingKey = candleTimestampKey(event.data);
  const incomingTime = incomingKey ? Date.parse(incomingKey) : Number.NaN;
  if (!incomingKey || !Number.isFinite(incomingTime)) {
    return { candles: current, applied: false, message: "Incoming candle timestamp is invalid." };
  }

  const incomingCandle = { ...event.data, timestamp: incomingKey };
  if (!current.length) {
    return { candles: [incomingCandle], applied: true, message: "Candle appended." };
  }

  const last = current[current.length - 1];
  const lastKey = candleTimestampKey(last);
  const lastTime = lastKey ? Date.parse(lastKey) : Number.NEGATIVE_INFINITY;

  if (lastKey === incomingKey) {
    const candles = current.slice();
    candles[candles.length - 1] = incomingCandle;
    return {
      candles,
      applied: true,
      message: event.type === "CANDLE_CORRECTED" ? "Corrected candle replaced." : "Candle updated."
    };
  }

  if (incomingTime > lastTime) {
    return { candles: [...current, incomingCandle], applied: true, message: "Candle appended." };
  }

  const firstKey = candleTimestampKey(current[0]);
  const firstTime = firstKey ? Date.parse(firstKey) : Number.POSITIVE_INFINITY;
  if (incomingTime < firstTime) {
    return { candles: current, applied: false, message: "Stale candle event ignored." };
  }

  const index = findCandleIndexByTimestamp(current, incomingTime, incomingKey);
  if (index >= 0) {
    const candles = current.slice();
    candles[index] = incomingCandle;
    return {
      candles,
      applied: true,
      message: event.type === "CANDLE_CORRECTED" ? "Corrected candle replaced." : "Candle updated."
    };
  }

  return { candles: current, applied: false, message: "Stale candle event ignored." };
}

export function compareCandles(left: CandleData, right: CandleData): number {
  return Date.parse(left.timestamp) - Date.parse(right.timestamp);
}

function candleTimestampKey(candle: CandleData): string | null {
  return canonicalTimestamp(candle.timestamp);
}

function findCandleIndexByTimestamp(candles: CandleData[], incomingTime: number, incomingKey: string): number {
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midKey = candleTimestampKey(candles[mid]);
    const midTime = midKey ? Date.parse(midKey) : Number.NaN;
    if (!Number.isFinite(midTime)) {
      break;
    }
    if (midKey === incomingKey) {
      return mid;
    }
    if (midTime < incomingTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}
