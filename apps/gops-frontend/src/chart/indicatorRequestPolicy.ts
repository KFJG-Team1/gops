import {
  defaultVisibleBarsForInterval,
  normalizeChartInterval
} from "@gops/chart-engine";

import type { ChartInterval } from "./types";

export const maxIndicatorRequestBars = 5000;

const indicatorRequestCaps: Record<ChartInterval, number> = {
  "footprint": 5000,
  "1m": 5000,
  "5m": 5000,
  "10m": 5000,
  "1h": 5000,
  "4h": 2457,
  "1D": 1512,
  "1W": 312,
  "1M": 72
};

export function indicatorRequestLimitForInterval(interval: ChartInterval, candleCount: number): number {
  const normalized = normalizeChartInterval(interval) ?? "1m";
  const requested = Math.max(
    defaultVisibleBarsForInterval(normalized),
    Number.isFinite(candleCount) ? Math.floor(candleCount) : 0
  );
  return Math.max(1, Math.min(requested, indicatorRequestCaps[normalized], maxIndicatorRequestBars));
}
