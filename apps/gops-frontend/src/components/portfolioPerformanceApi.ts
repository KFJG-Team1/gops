export type PortfolioPerformanceRange = "1W" | "1M" | "3M" | "1Y" | "ALL";

export type PortfolioPerformancePoint = {
  time: string;
  returnPercent: number;
  portfolioValue?: number;
  holdingsCostBasis?: number;
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
      return {
        time: new Date(timestamp).toISOString(),
        returnPercent,
        ...(portfolioValue != null ? { portfolioValue } : {}),
        ...(holdingsCostBasis != null ? { holdingsCostBasis } : {})
      };
    })
    .filter((item): item is PortfolioPerformancePoint => item != null)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
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
