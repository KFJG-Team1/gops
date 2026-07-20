import type { ChartInterval, IndicatorPointDto, IndicatorSeries } from "./types";

type IndicatorScopedUnit = {
  interval: ChartInterval;
  candle: {
    timestamp: string;
  };
};

export function scopedIndicatorSeriesKey(interval: ChartInterval, layerId: string): string {
  return `${interval}::${layerId}`;
}

export function scopeIndicatorSeries(interval: ChartInterval, series: IndicatorSeries): IndicatorSeries {
  return Object.fromEntries(
    Object.entries(series).map(([layerId, points]) => [
      scopedIndicatorSeriesKey(interval, layerId),
      points
    ])
  );
}

export function mergeIndicatorSeries(...groups: IndicatorSeries[]): IndicatorSeries {
  const merged = new Map<string, Map<string, IndicatorPointDto>>();
  groups.forEach((series) => {
    Object.entries(series).forEach(([key, points]) => {
      const byTimestamp = merged.get(key) ?? new Map<string, IndicatorPointDto>();
      points.forEach((point) => {
        const timestamp = canonicalIndicatorTimestamp(point.timestamp);
        byTimestamp.set(timestamp, { ...point, timestamp });
      });
      merged.set(key, byTimestamp);
    });
  });
  return Object.fromEntries(
    Array.from(merged.entries()).map(([key, points]) => [
      key,
      Array.from(points.values()).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    ])
  );
}

export function createIndicatorPointLookup(
  series: IndicatorSeries | undefined,
  layerId: string,
  baseInterval: ChartInterval
): (unit: IndicatorScopedUnit) => IndicatorPointDto | undefined {
  const maps = new Map<string, Map<string, IndicatorPointDto>>();
  const mapForKey = (key: string) => {
    const cached = maps.get(key);
    if (cached) {
      return cached;
    }
    const next = new Map((series?.[key] ?? []).map((point) => [
      canonicalIndicatorTimestamp(point.timestamp),
      { ...point, timestamp: canonicalIndicatorTimestamp(point.timestamp) }
    ]));
    maps.set(key, next);
    return next;
  };
  return (unit) => {
    const key = unit.interval === baseInterval
      ? layerId
      : scopedIndicatorSeriesKey(unit.interval, layerId);
    return mapForKey(key).get(canonicalIndicatorTimestamp(unit.candle.timestamp));
  };
}

export function createIndicatorValueLookup(
  series: IndicatorSeries | undefined,
  layerId: string,
  baseInterval: ChartInterval
): (unit: IndicatorScopedUnit) => number | null | undefined {
  const pointForUnit = createIndicatorPointLookup(series, layerId, baseInterval);
  return (unit) => pointForUnit(unit)?.value;
}

function canonicalIndicatorTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : timestamp;
}
