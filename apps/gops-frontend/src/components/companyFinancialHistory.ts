export type FinancialPeriodMode = "quarterly" | "annual";

export type ValuationPricePoint = {
  timestamp: string;
  close: number;
};

export type FinancialChartPoint = {
  period: string;
  periodEndDate?: string | null;
  revenue?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  totalEquity?: number | null;
  currentAssets?: number | null;
  currentLiabilities?: number | null;
  cashAndCashEquivalents?: number | null;
  interestExpense?: number | null;
  operatingCashFlow?: number | null;
  freeCashFlow?: number | null;
  sharesOutstanding?: number | null;
  debtRatio?: number | null;
  currentLiabilityRatio?: number | null;
  noncurrentLiabilityRatio?: number | null;
  currentRatio?: number | null;
  totalDebt?: number | null;
  interestCoverage?: number | null;
  financialCostBurdenRatio?: number | null;
  netDebt?: number | null;
};

export type PerShareMetrics = {
  eps: number | null;
  bps: number | null;
  sps: number | null;
  cps: number | null;
};

export type HistoricalValuationPoint = {
  financial: FinancialChartPoint;
  close: number | null;
  per: number | null;
  pbr: number | null;
  psr: number | null;
  fcfYield: number | null;
};

export function mergeValuationPriceSeries(
  stored: readonly ValuationPricePoint[],
  fetched: readonly ValuationPricePoint[]
): ValuationPricePoint[] {
  const byTradingDay = new Map<string, ValuationPricePoint>();
  for (const point of [...stored, ...fetched]) {
    const timestamp = Date.parse(point.timestamp);
    if (!Number.isFinite(timestamp) || !Number.isFinite(point.close)) continue;
    byTradingDay.set(new Date(timestamp).toISOString().slice(0, 10), point);
  }
  return [...byTradingDay.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function perShareMetricsForPoint(point: FinancialChartPoint): PerShareMetrics {
  const shares = Number.isFinite(point.sharesOutstanding ?? NaN) && (point.sharesOutstanding as number) > 0
    ? point.sharesOutstanding
    : null;
  return {
    eps: Number.isFinite(point.eps ?? NaN) ? point.eps as number : safeDivide(point.netIncome, shares),
    bps: safeDivide(point.totalEquity, shares),
    sps: safeDivide(point.revenue, shares),
    cps: safeDivide(point.operatingCashFlow, shares)
  };
}

export function buildHistoricalValuationSeries(
  points: FinancialChartPoint[],
  prices: ValuationPricePoint[]
): HistoricalValuationPoint[] {
  const sortedPrices = prices
    .filter((point) => Number.isFinite(point.close) && Number.isFinite(Date.parse(point.timestamp)))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return points.map((financial) => {
    const close = periodEndClose(financial.periodEndDate, sortedPrices);
    const perShare = perShareMetricsForPoint(financial);
    const marketCap = close != null && financial.sharesOutstanding != null
      && Number.isFinite(financial.sharesOutstanding) && financial.sharesOutstanding > 0
      ? close * financial.sharesOutstanding
      : null;
    return {
      financial,
      close,
      per: positiveMultiple(close, perShare.eps),
      pbr: positiveMultiple(close, perShare.bps),
      psr: positiveMultiple(close, perShare.sps),
      fcfYield: safeDivide(financial.freeCashFlow, marketCap)
    };
  });
}

export function financialPriceRequestRange(
  points: FinancialChartPoint[]
): { from: string; to: string } | null {
  const timestamps = points
    .map((point) => point.periodEndDate ? Date.parse(point.periodEndDate) : NaN)
    .filter(Number.isFinite);
  if (!timestamps.length) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    from: new Date(Math.min(...timestamps) - 10 * dayMs).toISOString(),
    to: new Date(Math.max(...timestamps) + 2 * dayMs).toISOString()
  };
}

function periodEndClose(
  periodEndDate: string | null | undefined,
  prices: ValuationPricePoint[]
): number | null {
  if (!periodEndDate) return null;
  const targetDay = periodEndDate.slice(0, 10);
  const target = Date.parse(`${targetDay}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const maximumGapMs = 10 * 24 * 60 * 60 * 1000;
  for (let index = prices.length - 1; index >= 0; index -= 1) {
    const price = prices[index]!;
    const priceDay = price.timestamp.slice(0, 10);
    const timestamp = Date.parse(`${priceDay}T00:00:00Z`);
    if (priceDay <= targetDay && target - timestamp <= maximumGapMs) return price.close;
  }
  return null;
}

function positiveMultiple(numerator: number | null, denominator: number | null): number | null {
  return numerator != null && denominator != null && numerator > 0 && denominator > 0
    ? numerator / denominator
    : null;
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  return numerator != null && denominator != null && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}
