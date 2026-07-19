export type PortfolioPerformanceRange = "1W" | "1M" | "3M" | "1Y" | "ALL";

export type PortfolioPerformancePoint = {
  time: string;
  returnPercent: number;
  portfolioValue?: number;
  holdingsCostBasis?: number;
  netInvestedPrincipal?: number;
};

export type PortfolioPerformanceBandPoint = {
  time: string;
  value: number;
};

export type PortfolioPrincipalBandTone = "principal-above" | "portfolio-above";

export type PortfolioPrincipalBandSegment = {
  tone: PortfolioPrincipalBandTone;
  start: {
    time: string;
    portfolioValue: number;
    principalValue: number;
  };
  end: {
    time: string;
    portfolioValue: number;
    principalValue: number;
  };
};

export type PortfolioPerformanceResponse = {
  status: "ready" | "insufficient_history";
  range: PortfolioPerformanceRange;
  asOf: string | null;
  isDevFixture: boolean;
  dataOrigin: "seeded-demo" | "account-history";
  portfolio: {
    name: string;
    points: PortfolioPerformancePoint[];
  };
  benchmark: {
    symbol: string;
    name: string;
    method: "price_return";
    points: PortfolioPerformancePoint[];
  };
  warnings: string[];
};

export async function fetchPortfolioPerformance(
  range: PortfolioPerformanceRange,
  signal?: AbortSignal
): Promise<PortfolioPerformanceResponse> {
  const params = new URLSearchParams({ range });
  const response = await fetch(`/api/account/performance?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`성과 API 오류 ${response.status}`);
  }
  return normalizePortfolioPerformanceResponse(await response.json(), range);
}

export function buildPortfolioPrincipalBands(
  portfolioPoints: readonly PortfolioPerformanceBandPoint[],
  principalPoints: readonly PortfolioPerformanceBandPoint[]
): PortfolioPrincipalBandSegment[] {
  const portfolio = normalizeBandPoints(portfolioPoints);
  const principal = normalizeBandPoints(principalPoints);
  if (portfolio.length < 2 || principal.length === 0) return [];

  let principalIndex = 0;
  let currentPrincipal: PortfolioPerformanceBandPoint | null = null;
  const aligned = portfolio.flatMap((point) => {
    const timestamp = Date.parse(point.time);
    while (principalIndex < principal.length && Date.parse(principal[principalIndex].time) <= timestamp) {
      currentPrincipal = principal[principalIndex];
      principalIndex += 1;
    }
    return currentPrincipal == null ? [] : [{
      time: point.time,
      portfolioValue: point.value,
      principalValue: currentPrincipal.value
    }];
  });
  const result: PortfolioPrincipalBandSegment[] = [];
  for (let index = 1; index < aligned.length; index += 1) {
    const start = aligned[index - 1];
    const end = aligned[index];
    const startDifference = start.principalValue - start.portfolioValue;
    const endDifference = end.principalValue - end.portfolioValue;
    if (startDifference === 0 && endDifference === 0) continue;
    const startTone = bandTone(startDifference || endDifference);
    const endTone = bandTone(endDifference || startDifference);
    if (startTone === endTone) {
      result.push({ tone: startTone, start, end });
      continue;
    }
    const crossingRatio = Math.abs(startDifference) / (Math.abs(startDifference) + Math.abs(endDifference));
    const startTime = Date.parse(start.time);
    const endTime = Date.parse(end.time);
    const crossingTime = new Date(startTime + (endTime - startTime) * crossingRatio).toISOString();
    const crossingPortfolio = start.portfolioValue
      + (end.portfolioValue - start.portfolioValue) * crossingRatio;
    const crossingPrincipal = start.principalValue
      + (end.principalValue - start.principalValue) * crossingRatio;
    const crossing = {
      time: crossingTime,
      portfolioValue: crossingPortfolio,
      principalValue: crossingPrincipal
    };
    result.push({ tone: startTone, start, end: crossing });
    result.push({ tone: endTone, start: crossing, end });
  }
  return result;
}

export function normalizePortfolioPerformanceResponse(
  value: unknown,
  fallbackRange: PortfolioPerformanceRange = "1M"
): PortfolioPerformanceResponse {
  const source = isRecord(value) ? value : {};
  const range = isPerformanceRange(source.range) ? source.range : fallbackRange;
  const portfolio = isRecord(source.portfolio) ? source.portfolio : {};
  const benchmark = isRecord(source.benchmark) ? source.benchmark : {};
  const portfolioPoints = normalizePoints(portfolio.points);
  const benchmarkPoints = normalizePoints(benchmark.points);
  return {
    status: source.status === "ready" && portfolioPoints.length >= 2 ? "ready" : "insufficient_history",
    range,
    asOf: typeof source.asOf === "string" ? source.asOf : null,
    isDevFixture: source.isDevFixture === true,
    dataOrigin: source.dataOrigin === "seeded-demo" ? "seeded-demo" : "account-history",
    portfolio: {
      name: typeof portfolio.name === "string" && portfolio.name.trim() ? portfolio.name : "내 포트폴리오",
      points: portfolioPoints
    },
    benchmark: {
      symbol: typeof benchmark.symbol === "string" ? benchmark.symbol : "^GSPC",
      name: typeof benchmark.name === "string" && benchmark.name.trim() ? benchmark.name : "S&P 500",
      method: "price_return",
      points: benchmarkPoints
    },
    warnings: Array.isArray(source.warnings)
      ? source.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
}

function normalizePoints(value: unknown): PortfolioPerformancePoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.time !== "string") return null;
      const timestamp = Date.parse(item.time);
      const returnPercent = Number(item.returnPercent);
      if (!Number.isFinite(timestamp) || !Number.isFinite(returnPercent)) return null;
      const portfolioValue = finiteOptionalNumber(item.portfolioValue);
      const holdingsCostBasis = finiteOptionalNumber(item.holdingsCostBasis);
      const netInvestedPrincipal = finiteOptionalNumber(item.netInvestedPrincipal);
      return {
        time: new Date(timestamp).toISOString(),
        returnPercent,
        ...(portfolioValue != null ? { portfolioValue } : {}),
        ...(holdingsCostBasis != null ? { holdingsCostBasis } : {}),
        ...(netInvestedPrincipal != null ? { netInvestedPrincipal } : {})
      };
    })
    .filter((item): item is PortfolioPerformancePoint => item != null)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function normalizeBandPoints(
  points: readonly PortfolioPerformanceBandPoint[]
): PortfolioPerformanceBandPoint[] {
  return points
    .filter((point) => Number.isFinite(Date.parse(point.time)) && Number.isFinite(point.value))
    .map((point) => ({ time: new Date(Date.parse(point.time)).toISOString(), value: point.value }))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function bandTone(difference: number): PortfolioPrincipalBandTone {
  return difference > 0 ? "principal-above" : "portfolio-above";
}

function isPerformanceRange(value: unknown): value is PortfolioPerformanceRange {
  return value === "1W" || value === "1M" || value === "3M" || value === "1Y" || value === "ALL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return value != null && Number.isFinite(parsed) ? parsed : null;
}
