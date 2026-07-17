import type {
  CompanyEarningsSeriesPoint,
  CompanyFinancialSeriesPoint,
  Sp500UniverseItem
} from "../../market/sp500Universe.seed";

type CompanyAnalysisDevFixture = {
  item: Sp500UniverseItem;
  insightContext: {
    date: string;
    summary: string;
    keywords: string[];
    priceChangePercent: number;
  };
};

const source = "DEV FIXTURE";

const financialSeries: CompanyFinancialSeriesPoint[] = [
  point("2023Q2", "2023-06-30", 13.51, 6.80, 6.19, 0.25, 44.46, 19.08, 25.38, 6.35, 5.82),
  point("2023Q3", "2023-09-30", 18.12, 10.42, 9.24, 0.37, 49.55, 20.39, 29.16, 8.73, 8.05),
  point("2023Q4", "2023-12-31", 22.10, 13.62, 12.29, 0.49, 54.72, 22.75, 31.97, 11.50, 10.84),
  point("2024Q1", "2024-03-31", 26.04, 16.91, 14.88, 0.60, 60.12, 24.32, 35.80, 15.35, 14.61),
  point("2024Q2", "2024-06-30", 30.04, 18.64, 16.60, 0.67, 64.83, 25.91, 38.92, 14.49, 13.72),
  point("2024Q3", "2024-09-30", 35.08, 21.87, 19.31, 0.78, 70.16, 27.84, 42.32, 19.83, 18.96),
  point("2024Q4", "2024-12-31", 39.33, 24.70, 21.77, 0.88, 76.48, 29.66, 46.82, 22.14, 21.28),
  point("2025Q1", "2025-03-31", 44.06, 27.34, 24.12, 0.98, 82.76, 31.42, 51.34, 24.06, 23.15),
  point("2025Q2", "2025-06-30", 46.74, 28.62, 25.18, 1.03, 87.55, 32.20, 55.35, 25.42, 24.37),
  point("2025Q3", "2025-09-30", 50.12, 30.75, 27.06, 1.10, 93.02, 33.51, 59.51, 27.18, 26.03),
  point("2025Q4", "2025-12-31", 54.50, 33.66, 29.44, 1.20, 99.31, 35.08, 64.23, 29.95, 28.71),
  point("2026Q1", "2026-03-31", 58.90, 36.52, 31.83, 1.30, 106.44, 37.11, 69.33, 32.48, 31.16)
];

const earningsSeries: CompanyEarningsSeriesPoint[] = financialSeries.map((entry, index) => ({
  period: entry.period,
  periodEndDate: entry.periodEndDate,
  actualEps: entry.eps,
  estimatedEps: Number(((entry.eps ?? 0) * (index % 4 === 1 ? 1.015 : 0.955)).toFixed(2)),
  actualRevenue: entry.revenue,
  estimatedRevenue: Math.round((entry.revenue ?? 0) * (index % 5 === 2 ? 1.012 : 0.972)),
  source,
  estimateSource: source,
  filedAt: "2026-07-15T20:00:00Z",
  collectedAt: "2026-07-16T05:00:00Z"
}));

export function companyAnalysisDevFixture(symbol: string): CompanyAnalysisDevFixture | null {
  if (symbol !== "NVDA") {
    return null;
  }
  const latest = financialSeries.at(-1)!;
  return {
    item: {
      symbol: "NVDA",
      companyName: "NVIDIA Corporation",
      sector: "Information Technology",
      sectorLabelKo: "정보기술",
      industry: "Semiconductors",
      cik: "0001045810",
      exchange: "NASDAQ",
      market: "US",
      country: "United States",
      listingDate: "1999-01-22",
      marketCap: 4_771_640_000_000,
      marketCapSource: source,
      layoutPrice: 194.72,
      layoutMarketCap: 4_771_640_000_000,
      layoutMarketCapSource: source,
      layoutPriceSource: source,
      layoutPriceUpdatedAt: "2026-07-16T05:00:00Z",
      sharesOutstanding: 24_505_000_000,
      fundamentalsSource: source,
      fundamentalsAsOf: "2026-07-15T20:00:00Z",
      fiscalPeriod: latest.period,
      periodEndDate: latest.periodEndDate,
      filedAt: "2026-05-28T20:00:00Z",
      revenue: latest.revenue,
      operatingIncome: latest.operatingIncome,
      netIncome: latest.netIncome,
      eps: latest.eps,
      totalAssets: latest.totalAssets,
      totalLiabilities: latest.totalLiabilities,
      totalEquity: latest.totalEquity,
      operatingCashFlow: latest.operatingCashFlow,
      freeCashFlow: latest.freeCashFlow,
      ebitda: 38_420_000_000,
      earningsSeries,
      financialSeries,
      lastPrice: 194.72,
      priceSource: source,
      priceUpdatedAt: "2026-07-16T05:00:00Z",
      volume: 176_420_000,
      sessionDollarVolume: 34_348_542_400,
      currency: "USD",
      changePercent: 2.05
    },
    insightContext: {
      date: "2026-07-16",
      summary: "NVIDIA는 AI 데이터센터 수요와 차세대 GPU 전환 기대가 이어지고 있습니다. 매출과 이익이 함께 성장하고 있지만, 높은 기대가 실제 현금흐름으로 이어지는지 다음 실적에서 확인해야 합니다.",
      keywords: ["AI 데이터센터 수요", "매출·이익 동반 성장", "현금흐름 확인"],
      priceChangePercent: 2.05
    }
  };
}

function point(
  period: string,
  periodEndDate: string,
  revenue: number,
  operatingIncome: number,
  netIncome: number,
  eps: number,
  totalAssets: number,
  totalLiabilities: number,
  totalEquity: number,
  operatingCashFlow: number,
  freeCashFlow: number
): CompanyFinancialSeriesPoint {
  const billion = 1_000_000_000;
  return {
    period,
    periodEndDate,
    revenue: revenue * billion,
    operatingIncome: operatingIncome * billion,
    netIncome: netIncome * billion,
    eps,
    totalAssets: totalAssets * billion,
    totalLiabilities: totalLiabilities * billion,
    totalEquity: totalEquity * billion,
    operatingCashFlow: operatingCashFlow * billion,
    freeCashFlow: freeCashFlow * billion,
    sharesOutstanding: 24_505_000_000,
    source,
    filedAt: "2026-07-15T20:00:00Z"
  };
}
