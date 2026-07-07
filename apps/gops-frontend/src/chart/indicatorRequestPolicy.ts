import {
  defaultVisibleBarsForInterval,
  maxRequestBarsForInterval,
  normalizeChartInterval
} from "@gops/chart-engine";

import type { ChartInterval } from "./types";

export const maxIndicatorRequestBars = 5000;

export function indicatorRequestLimitForInterval(interval: ChartInterval, candleCount: number): number {
  const normalized = normalizeChartInterval(interval) ?? "1m";
  const requested = Math.max(
    defaultVisibleBarsForInterval(normalized),
    Number.isFinite(candleCount) ? Math.floor(candleCount) : 0
  );
  return Math.max(1, Math.min(requested, maxRequestBarsForInterval(normalized), maxIndicatorRequestBars));
}
