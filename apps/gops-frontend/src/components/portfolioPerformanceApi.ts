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

export function buildDevPortfolioPerformanceFixture(
  range: PortfolioPerformanceRange,
  now: Date = new Date()
): PortfolioPerformanceResponse {
  const durationDays: Record<PortfolioPerformanceRange, number> = {
    "1W": 7,
    "1M": 31,
    "3M": 93,
    "1Y": 366,
    "ALL": 366 * 5
  };
  const portfolioReturns = [0, 0.8, 0.2, 1.9, 1.4, 3.1, 2.6, 4.7, 4.2, 6.3];
  const benchmarkReturns = [0, 0.4, 0.7, 1.1, 1.8, 2.2, 2.8, 3.1, 3.7, 4.4];
  const portfolioValues = [12_000, 12_096, 12_024, 12_728, 12_665, 13_195, 13_131, 13_964, 13_897, 14_646];
  const holdingsCostBasis = [12_000, 12_000, 12_000, 12_490, 12_490, 12_800, 12_800, 13_340, 13_340, 13_760];
  const end = now.getTime();
  const start = end - durationDays[range] * 86_400_000;
  const pointsFor = (
    values: number[],
    assets?: { portfolioValues: number[]; holdingsCostBasis: number[] }
  ): PortfolioPerformancePoint[] => values.map((returnPercent, index) => ({
    time: new Date(start + ((end - start) * index) / Math.max(values.length - 1, 1)).toISOString(),
    returnPercent,
    ...(assets ? {
      portfolioValue: assets.portfolioValues[index],
      holdingsCostBasis: assets.holdingsCostBasis[index]
    } : {})
  }));
  return {
    status: "ready",
    range,
    asOf: now.toISOString(),
    isDevFixture: true,
    portfolio: {
      name: "내 포트폴리오",
      points: pointsFor(portfolioReturns, { portfolioValues, holdingsCostBasis })
    },
    benchmark: {
      symbol: "^GSPC",
      name: "S&P 500",
      method: "price_return",
      points: pointsFor(benchmarkReturns)
    },
    warnings: ["DEV DEMO · 실제 성과 이력이 쌓이기 전 화면 확인용 고정 시계열입니다."]
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
