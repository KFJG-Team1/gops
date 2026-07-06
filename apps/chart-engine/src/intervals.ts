export const chartIntervals = ["footprint", "1m", "5m", "10m", "1D", "1W", "1M"] as const;

export type ChartInterval = typeof chartIntervals[number];

const minutesPerTradingDay = 390;
const tradingDaysPerYear = 252;
const historicalTargetYears = 6;
const intradayLazyTargetBars = minutesPerTradingDay * tradingDaysPerYear * historicalTargetYears;

const defaultVisibleBars: Record<ChartInterval, number> = {
  "1m": 120,
  "footprint": 120,
  "5m": 120,
  "10m": 120,
  "1D": 120,
  "1W": 104,
  "1M": 36
};

const maxRequestBars: Record<ChartInterval, number> = {
  "1m": intradayLazyTargetBars,
  "footprint": intradayLazyTargetBars,
  "5m": Math.ceil(intradayLazyTargetBars / 5),
  "10m": Math.ceil(intradayLazyTargetBars / 10),
  "1D": tradingDaysPerYear * historicalTargetYears,
  "1W": 52 * historicalTargetYears,
  "1M": Math.max(defaultVisibleBars["1M"], 12 * historicalTargetYears)
};

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
  if (trimmed.toLowerCase() === "footprint") {
    return "footprint";
  }
  return chartIntervals.includes(trimmed as ChartInterval) ? trimmed as ChartInterval : null;
}

export function defaultVisibleBarsForInterval(interval: string): number {
  return defaultVisibleBars[normalizeChartInterval(interval) ?? "1m"];
}

export function maxRequestBarsForInterval(interval: string): number {
  return maxRequestBars[normalizeChartInterval(interval) ?? "1m"];
}
