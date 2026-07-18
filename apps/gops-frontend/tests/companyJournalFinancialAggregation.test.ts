import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateQuarterlySeriesToAnnual,
  companyJournalAnnualHistory,
  companyJournalHistoryYears,
  formatCompanyJournalAnalystOpinion,
  mergeCompanyJournalValuationPrices,
  totalLiabilitiesFor
} from "../src/components/CompanyJournalSummaryPanel";
import {
  companyJournalEvidencePriceChange,
  financialYearsForContext,
  nearestFinancialYear
} from "../src/components/CompanyJournalPanel";
import { buildCompanyJournalDiagnosis } from "../src/components/companyJournalDiagnosis";
import { buildCompanyJournalReading } from "../src/components/companyJournalReading";
import {
  dateLabels,
  normalizePerformanceSeries,
  performanceVolumeBarGeometry
} from "../src/components/CompanyJournalPerformanceChart";
import { allGlossaryEntries } from "../src/glossary/stockGlossary";

assert.equal(companyJournalEvidencePriceChange(110, 100), 10);
assert.equal(companyJournalEvidencePriceChange(110, 0), null, "zero previous close must not create infinity");
assert.equal(companyJournalEvidencePriceChange(null, 100), null, "missing point-in-time price must remain missing");

const annual = aggregateQuarterlySeriesToAnnual([
  {
    period: "2025Q1",
    periodEndDate: "2024-04-30",
    revenue: 10,
    netIncome: 2,
    totalAssets: 100,
    totalLiabilities: 40,
    totalEquity: 60,
    currentAssets: 30,
    currentLiabilities: 10,
    sharesOutstanding: 5
  },
  {
    period: "2025Q2",
    periodEndDate: "2024-07-31",
    revenue: 20,
    netIncome: 3,
    totalAssets: 110,
    totalLiabilities: 42,
    totalEquity: 68,
    currentAssets: 32,
    currentLiabilities: 11,
    sharesOutstanding: 5
  },
  {
    period: "2025Q3",
    periodEndDate: "2024-10-31",
    revenue: 30,
    netIncome: 4,
    totalAssets: 120,
    totalLiabilities: 45,
    totalEquity: 75,
    currentAssets: 36,
    currentLiabilities: 12,
    cashAndCashEquivalents: 20,
    totalDebt: 25,
    sharesOutstanding: 5
  },
  {
    period: "2025Q4",
    periodEndDate: "2025-01-31",
    revenue: 40,
    netIncome: 5,
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    currentAssets: null,
    currentLiabilities: null,
    sharesOutstanding: null
  }
]);

assert.equal(annual.length, 1);
assert.equal(annual[0]?.revenue, 100, "flow metrics must still be summed across all four quarters");
assert.equal(annual[0]?.netIncome, 14);
assert.equal(annual[0]?.totalEquity, 75, "Q4 flow-only rows must retain the latest finite balance");
assert.equal(annual[0]?.sharesOutstanding, 5);
assert.equal(annual[0]?.debtRatio, 0.6);
assert.equal(annual[0]?.currentRatio, 3);
assert.equal(annual[0]?.netDebt, 5);
assert.equal(
  totalLiabilitiesFor({ period: "2025FY", totalAssets: 211_429, totalEquity: 114_281 }),
  97_148,
  "missing SEC liabilities must fall back to the accounting identity instead of hiding stability"
);

assert.equal(companyJournalHistoryYears(2026), 6);
assert.deepEqual(
  mergeCompanyJournalValuationPrices(
    [
      { timestamp: "2024-12-31T05:00:00.000Z", close: 120 },
      { timestamp: "2025-12-31T05:00:00.000Z", close: 150 }
    ],
    [
      { timestamp: "2021-12-31T05:00:00.000Z", close: 80 },
      { timestamp: "2024-12-31T20:00:00.000Z", close: 125 }
    ]
  ),
  [
    { timestamp: "2021-12-31T05:00:00.000Z", close: 80 },
    { timestamp: "2024-12-31T20:00:00.000Z", close: 125 },
    { timestamp: "2025-12-31T05:00:00.000Z", close: 150 }
  ],
  "stored evidence must supplement, not truncate, the full valuation price history"
);

const marketCandles = [
  { timestamp: "2024-07-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 10, isClosed: true },
  { timestamp: "2024-07-02T00:00:00.000Z", open: 100, high: 103, low: 99, close: 102, volume: 12, isClosed: true },
  { timestamp: "2024-07-03T00:00:00.000Z", open: 102, high: 104, low: 101, close: 103, volume: 14, isClosed: true },
  { timestamp: "2024-07-04T00:00:00.000Z", open: 103, high: 105, low: 102, close: 104, volume: 16, isClosed: true }
];
const normalizedWithSparseBenchmark = normalizePerformanceSeries([
  { symbol: "MSFT", label: "MSFT", tone: "company", candles: marketCandles },
  { symbol: "SPY", label: "S&P 500", tone: "benchmark", candles: marketCandles.slice(0, 1) },
  { symbol: "XLK", label: "XLK", tone: "sector", candles: marketCandles }
]);
assert.deepEqual(normalizedWithSparseBenchmark.map((series) => series.symbol), ["MSFT", "XLK"]);
assert.equal(normalizedWithSparseBenchmark[0]?.points.length, 4, "one sparse benchmark must not collapse the company history to one day");
assert.deepEqual(
  normalizePerformanceSeries([{ symbol: "MSFT", label: "MSFT", tone: "company", candles: marketCandles.slice(0, 1) }]),
  [],
  "a single market point must render the existing insufficient-data state"
);
assert.deepEqual(dateLabels(marketCandles.slice(0, 1)).map((label) => label.label), ["24.07"]);
assert.deepEqual(dateLabels(marketCandles.slice(0, 2)).map((label) => label.label), ["24.07.01", "24.07.02"]);
const singleBar = performanceVolumeBarGeometry(44, 44, 742, 1);
assert.ok(singleBar.width <= 14);
assert.ok(singleBar.x >= 44 && singleBar.x + singleBar.width <= 742, "volume bars must stay inside the plot bounds");
const analystActionBase = {
  firm: "JP모건",
  action: "maintain",
  fromGrade: "Overweight",
  toGrade: "Overweight",
  priorPriceTarget: 180,
  priceTarget: 200,
  actionAt: "2026-07-15 12:00:00.000",
  source: "yahoo-finance"
};
assert.deepEqual(
  formatCompanyJournalAnalystOpinion(analystActionBase, "마이크론"),
  {
    actionAt: "2026-07-15 12:00:00.000",
    dateLabel: "2026년 7월 15일",
    message: "JP모건은 Overweight 의견을 유지하면서 목표주가를 180달러에서 200달러로 높였습니다.",
    tone: "neutral"
  }
);
assert.deepEqual(
  formatCompanyJournalAnalystOpinion({
    ...analystActionBase,
    firm: "",
    action: "summary",
    fromGrade: "",
    toGrade: "",
    priorPriceTarget: null,
    priceTarget: null,
    statement: "최근 투자사 의견을 조합한 요약문입니다.",
    tone: "positive"
  }, "마이크론"),
  {
    actionAt: "2026-07-15 12:00:00.000",
    dateLabel: "2026년 7월 15일",
    message: "최근 투자사 의견을 조합한 요약문입니다.",
    tone: "positive"
  }
);
assert.equal(
  formatCompanyJournalAnalystOpinion(
    { ...analystActionBase, action: "upgrade", fromGrade: "Neutral", priorPriceTarget: 150, priceTarget: 180 },
    "마이크론"
  )?.message,
  "JP모건은 마이크론의 투자의견을 Neutral에서 Overweight로 상향하고, 목표주가를 150달러에서 180달러로 높였습니다."
);
assert.equal(
  formatCompanyJournalAnalystOpinion(
    { ...analystActionBase, action: "downgrade", fromGrade: "Overweight", toGrade: "Neutral", priorPriceTarget: 200, priceTarget: 170 },
    "마이크론"
  )?.message,
  "JP모건은 마이크론의 투자의견을 Overweight에서 Neutral로 하향하고, 목표주가를 200달러에서 170달러로 낮췄습니다."
);
assert.equal(
  formatCompanyJournalAnalystOpinion(
    { ...analystActionBase, priorPriceTarget: null, priceTarget: null },
    "마이크론"
  )?.message,
  "JP모건은 Overweight 의견을 유지했습니다."
);
assert.equal(
  formatCompanyJournalAnalystOpinion(
    { ...analystActionBase, firm: "모건스탠리" },
    "NVIDIA"
  )?.message,
  "모건스탠리는 Overweight 의견을 유지하면서 목표주가를 180달러에서 200달러로 높였습니다."
);
assert.equal(nearestFinancialYear({ text: "EPS 21년도 성장", matchedText: "EPS", startIndex: 0 }), 2021);
const stabilityCopy = "2025년 기준 부채비율과 유동비율, 이자보상배율이 개선됐습니다.";
assert.equal(nearestFinancialYear({ text: stabilityCopy, matchedText: "이자보상배율", startIndex: stabilityCopy.indexOf("이자보상배율") }), 2025);
assert.deepEqual(
  financialYearsForContext({ text: "2025년 EPS ↔ 2024년 EPS", matchedText: "EPS", startIndex: 6 }),
  [2025, 2024],
  "comparison copy must preserve both explicitly named years"
);
assert.deepEqual(
  companyJournalAnnualHistory([
    { period: "2020FY" },
    { period: "2021FY" },
    { period: "2022FY" },
    { period: "2023FY" },
    { period: "2024FY" },
    { period: "2025FY" },
    { period: "2026FY" }
  ]).map((point) => point.period),
  ["2021FY", "2022FY", "2023FY", "2024FY", "2025FY", "2026FY"]
);

const diagnosis = buildCompanyJournalDiagnosis(
  {
    symbol: "NVDA",
    companyName: "NVIDIA",
    sector: "Information Technology",
    industry: "Semiconductors",
    marketCap: 1_000,
    lastPrice: 100,
    eps: 2,
    totalEquity: 100,
    revenue: 100,
    freeCashFlow: 10,
    changePercent: 1
  },
  {
    financialPeriodMode: "annual",
    selectedFinancialPeriod: null,
    financialSeries: [
      { period: "2024FY", revenue: 80, operatingIncome: 16, netIncome: 12, totalAssets: 150, totalLiabilities: 60, totalEquity: 90, currentAssets: 60, currentLiabilities: 40, interestExpense: 4, totalDebt: 40, cashAndCashEquivalents: 20 },
      { period: "2025FY", revenue: 100, operatingIncome: 25, netIncome: 20, totalAssets: 180, totalLiabilities: 55, totalEquity: 125, currentAssets: 80, currentLiabilities: 35, interestExpense: 3, totalDebt: 35, cashAndCashEquivalents: 40 }
    ],
    earningsSeries: [
      { period: "2025Q4", actualEps: 2.2, estimatedEps: 2, actualRevenue: 105, estimatedRevenue: 100 }
    ]
  }
);
assert.equal(diagnosis.signals.find((signal) => signal.view === "earnings")?.tone, "positive");
assert.equal(diagnosis.signals.find((signal) => signal.view === "valuation")?.tone, "caution");
assert.equal(diagnosis.signals.find((signal) => signal.view === "profitability")?.tone, "positive");
assert.equal(diagnosis.signals.find((signal) => signal.view === "stability")?.tone, "positive");
assert.equal(diagnosis.statusLabel, "선별 확인");
assert.match(diagnosis.summary, /가치/);
const readingEvidence = {
  financialPeriodMode: "annual" as const,
  selectedFinancialPeriod: null,
  financialSeries: [
    { period: "2024FY", revenue: 80, operatingIncome: 16, netIncome: 12, totalAssets: 150, totalLiabilities: 60, totalEquity: 90, currentAssets: 60, currentLiabilities: 40, interestExpense: 4, totalDebt: 40, cashAndCashEquivalents: 20, sharesOutstanding: 10, eps: 1.2, freeCashFlow: 8 },
    { period: "2025FY", revenue: 100, operatingIncome: 25, netIncome: 20, totalAssets: 180, totalLiabilities: 55, totalEquity: 125, currentAssets: 80, currentLiabilities: 35, interestExpense: 3, totalDebt: 35, cashAndCashEquivalents: 40, sharesOutstanding: 10, eps: 2, freeCashFlow: 15 }
  ],
  earningsSeries: [
    { period: "2025Q4", actualEps: 2.2, estimatedEps: 2, actualRevenue: 105, estimatedRevenue: 100 }
  ]
};
const readingItem = {
  symbol: "NVDA",
  companyName: "NVIDIA",
  sector: "Information Technology",
  industry: "Semiconductors",
  marketCap: 1_000,
  lastPrice: 100,
  eps: 2,
  totalEquity: 125,
  revenue: 100,
  freeCashFlow: 15,
  changePercent: 1
};
const emptyReadingEvidence = {
  financialPeriodMode: "annual" as const,
  selectedFinancialPeriod: null,
  financialSeries: [],
  earningsSeries: []
};
const emptyReading = buildCompanyJournalReading({
  view: "earnings",
  item: readingItem,
  evidence: emptyReadingEvidence,
  diagnosis: buildCompanyJournalDiagnosis(readingItem, emptyReadingEvidence)
});
assert.equal(emptyReading.find((section) => section.id === "strengths")?.tone, "neutral");
assert.doesNotMatch(emptyReading.map((section) => section.summary).join(" "), /현재 큰 재무 경고는 없|긍정 신호는 .*나타납니다/);
assert.equal(emptyReading.find((section) => section.id === "comparisons")?.links.length, 0);
const earningsReading = buildCompanyJournalReading({ view: "earnings", item: readingItem, evidence: readingEvidence, diagnosis });
assert.deepEqual(earningsReading.map((section) => section.id), ["current-flow", "strengths", "risks", "comparisons", "judgment"]);
assert.equal(earningsReading.filter((section) => section.kind === "judgment").length, 1);
const earningsComparisons = earningsReading.find((section) => section.kind === "comparison")?.links ?? [];
assert.ok(earningsComparisons.length <= 3);
assert.ok(earningsComparisons.every((target) => target.years.length === 2));
assert.deepEqual(earningsComparisons[0]?.years, [2025, 2024]);
for (const view of ["valuation", "profitability", "stability"] as const) {
  const reading = buildCompanyJournalReading({ view, item: readingItem, evidence: readingEvidence, diagnosis });
  assert.deepEqual(reading.map((section) => section.id), ["current-state", "key-change", "comparisons", "impact", "judgment"]);
  assert.equal(reading.filter((section) => section.kind === "judgment").length, 1);
  assert.ok((reading.find((section) => section.kind === "comparison")?.links.length ?? 0) <= 3);
}
assert.doesNotMatch(
  earningsReading.map((section) => `${section.summary} ${section.detail}`).join(" "),
  /OpenAI|Bedrock|ClickHouse|저장소|소스 누락|데이터 복구/i
);
for (const glossaryId of ["current_ratio", "interest_coverage", "net_debt", "bps", "sps", "cps", "operating_margin", "net_margin", "roe", "fcf_margin", "valuation_multiple"]) {
  assert.ok(allGlossaryEntries.some((item) => item.id === glossaryId), `${glossaryId} glossary entry must exist`);
}

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const journalPanelSource = await readFile(new URL("../src/components/CompanyJournalPanel.tsx", import.meta.url), "utf8");
const journalSummarySource = await readFile(new URL("../src/components/CompanyJournalSummaryPanel.tsx", import.meta.url), "utf8");
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-body[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-reading[\s\S]*?overflow: visible/);
assert.match(styles, /\.company-journal-evidence \{[\s\S]*?overflow-y: auto/);
assert.match(styles, /\.company-journal-evidence \.company-valuation-dashboard,[\s\S]*?overflow: visible/);
assert.match(styles, /\.company-journal-performance \{[\s\S]*?padding: 15px 0 4px/);
assert.match(styles, /\.company-journal-performance svg text\.axis-value \{[\s\S]*?text-anchor: start/);
assert.match(
  styles,
  /\.company-journal-evidence \.company-journal-earnings-evidence \.company-single-fundamental-section,[\s\S]*?\.company-journal-evidence \.company-journal-earnings-evidence \.company-valuation-dashboard \{[\s\S]*?padding-inline: 0/,
  "company journal earnings sections must share the performance chart's left edge"
);
assert.match(
  styles,
  /\.company-journal-evidence \.company-stability-dashboard-grid \.company-financial-chart-card \{[\s\S]*?height: auto;[\s\S]*?min-height: 0/,
  "company journal stability tables must follow the rendered chart without reserved card space"
);
assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*?background-clip: padding-box/);
assert.match(styles, /\.workspace-panel-frame \.company-journal-panel :is\([\s\S]*?\.company-journal-evidence[\s\S]*?scrollbar-width: thin !important/);
assert.match(styles, /::-webkit-scrollbar[\s\S]*?display: block !important/);
assert.doesNotMatch(styles, /scrollbar-color:[^;]*var\(--coinbase-primary\)/);
assert.match(styles, /\.company-journal-quote \{[\s\S]*?font-size: clamp\(20px, 1\.3cqw, 25px\)/);
assert.match(styles, /\.company-journal-tabs button\.is-positive[\s\S]*?var\(--color-up\)/);
assert.match(styles, /\.company-journal-tabs button\.is-negative[\s\S]*?var\(--color-down\)/);
assert.match(styles, /\.company-journal-tab-signal[\s\S]*?background: var\(--company-journal-tab-signal\)/);
assert.match(styles, /\.company-journal-insight-tags[\s\S]*?flex-wrap: wrap/);
assert.match(styles, /\.company-journal-insight-tags > button/);
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-reading[\s\S]*?order: -1/);
assert.match(styles, /\.company-financial-table td\.is-evidence-focus/);
assert.match(styles, /\.company-financial-table td\.is-primary-evidence-focus/);
assert.doesNotMatch(styles, /\.company-journal-diagnosis-row/);
assert.match(journalPanelSource, /\["이자보상배율", "interest-coverage"\]/);
assert.match(journalPanelSource, /nearestFinancialYear/);
assert.match(journalPanelSource, /focusedFinancialYear/);
assert.match(journalPanelSource, /comparisonFinancialYear/);
assert.match(journalPanelSource, /selectReadingTarget/);
assert.match(journalPanelSource, /onFinancialSelectionChange=\{clearMetricFocus\}/);
assert.doesNotMatch(journalPanelSource, /previewEnabled \|\| hasStoredCompanyEvidence/);
assert.match(journalSummarySource, /data-journal-stability-focus/);
assert.match(journalSummarySource, /data-journal-financial-metric/);
assert.match(journalSummarySource, /data-journal-financial-year/);
assert.match(journalSummarySource, /focus\?\.periods\.includes/);
assert.match(journalSummarySource, /comparisonPeriod/);
assert.match(journalSummarySource, /onFinancialSelectionChange\?\.\(\)/);
assert.match(journalSummarySource, /focusedMetric === "fcf-yield"/);
assert.match(journalSummarySource, /title=\{<GlossaryText text="가치배수 추이" \/>\}/);
assert.match(journalSummarySource, /<h3><GlossaryText text="현재 가치배수" \/><\/h3>/);
assert.match(journalSummarySource, /<GlossaryText text="PER · PBR · PSR · FCF Yield" \/>/);
assert.match(journalSummarySource, /company-stability-money-dot/);
assert.match(journalSummarySource, /formatUsdCompactTable\(point\.revenue\)/);
assert.match(journalSummarySource, /formatUsdCompactTable\(point\.netIncome\)/);
assert.match(journalSummarySource, /rowMarkers: \[focusedMetric as FinancialTableRow\["marker"\]\]/);
assert.match(journalSummarySource, /focusedMetric === "current-ratio"[\s\S]*?focusedMetric === "interest-coverage"[\s\S]*?focusedMetric === "financial-cost-burden"/);
assert.match(journalSummarySource, /const estimateX = x;\s*const actualX = x;/);
assert.match(journalSummarySource, /company-journal-analyst-opinion/);
assert.match(journalSummarySource, /export function CompanyJournalAnalystOpinionPanel/);
assert.match(journalSummarySource, /showAnalystOpinion && <CompanyJournalAnalystOpinionPanel/);
assert.doesNotMatch(journalSummarySource, /<time dateTime=\{analystOpinion\.actionAt\}/);
assert.match(styles, /\.company-journal-analyst-opinion \{[^}]*padding: 15px 0 4px/);
assert.match(styles, /\.company-journal-analyst-opinion p \{[^}]*font-size: clamp\(18px, 1\.45cqw, 22px\)/);
assert.doesNotMatch(styles, /\.company-journal-analyst-opinion \{[^}]*background:/);
assert.doesNotMatch(journalSummarySource, /comparisonGap/);
assert.match(
  journalSummarySource,
  /fetchCompanyFinancialSeries\(normalizedSymbol,[\s\S]*?years: companyJournalHistoryYears\(\),[\s\S]*?period: "quarterly"/,
  "annual and quarterly journal views must share the same full quarterly source series"
);
assert.doesNotMatch(journalSummarySource, /period: financialPeriodMode/);

console.log("company journal financial aggregation tests passed");
