export const chartIntervals = ["1m", "5m", "10m", "1D", "1W", "1M"] as const;

export type ChartInterval = typeof chartIntervals[number];

const minutesPerTradingDay = 390;
const tradingDaysPerYear = 252;
const historicalTargetYears = 3;
const intradayPreloadTargetTradingDays = 315;
const intradayPreloadTargetBars = minutesPerTradingDay * intradayPreloadTargetTradingDays;

const defaultVisibleBars: Record<ChartInterval, number> = {
  "1m": 390,
  "5m": 390,
  "10m": 390,
  "1D": 250,
  "1W": 260,
  "1M": 120
};

const backfillTargetBars: Record<ChartInterval, number> = {
  "1m": intradayPreloadTargetBars,
  "5m": Math.ceil(intradayPreloadTargetBars / 5),
  "10m": Math.ceil(intradayPreloadTargetBars / 10),
  "1D": tradingDaysPerYear * historicalTargetYears,
  "1W": 52 * historicalTargetYears,
  "1M": 12 * historicalTargetYears
};

const maxRequestBars: Record<ChartInterval, number> = Object.fromEntries(
  chartIntervals.map((interval) => [
    interval,
    Math.max(defaultVisibleBars[interval], backfillTargetBars[interval])
  ])
) as Record<ChartInterval, number>;

export function normalizeChartInterval(value: unknown): ChartInterval | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "1d") {
    return "1D";
  }
  if (trimmed === "1w") {
    return "1W";
  }
  if (trimmed === "1mo" || trimmed === "1MO" || trimmed === "1month") {
    return "1M";
  }
  return chartIntervals.includes(trimmed as ChartInterval) ? trimmed as ChartInterval : null;
}

export function defaultVisibleBarsForInterval(interval: string): number {
  return defaultVisibleBars[normalizeChartInterval(interval) ?? "1m"];
}

export function backfillTargetBarsForInterval(interval: string): number {
  return backfillTargetBars[normalizeChartInterval(interval) ?? "1m"];
}

export function maxRequestBarsForInterval(interval: string): number {
  return maxRequestBars[normalizeChartInterval(interval) ?? "1m"];
}
