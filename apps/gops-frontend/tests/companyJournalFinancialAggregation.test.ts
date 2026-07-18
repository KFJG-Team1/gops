import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateQuarterlySeriesToAnnual,
  companyJournalAnnualHistory,
  companyJournalHistoryYears,
  totalLiabilitiesFor
} from "../src/components/CompanyJournalSummaryPanel";
import { nearestFinancialYear } from "../src/components/CompanyJournalPanel";
import { buildCompanyJournalDiagnosis } from "../src/components/companyJournalDiagnosis";
import { allGlossaryEntries } from "../src/glossary/stockGlossary";

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
assert.equal(nearestFinancialYear({ text: "EPS 21년도 성장", matchedText: "EPS", startIndex: 0 }), 2021);
const stabilityCopy = "2025년 기준 부채비율과 유동비율, 이자보상배율이 개선됐습니다.";
assert.equal(nearestFinancialYear({ text: stabilityCopy, matchedText: "이자보상배율", startIndex: stabilityCopy.indexOf("이자보상배율") }), 2025);
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
for (const glossaryId of ["current_ratio", "interest_coverage", "net_debt", "bps", "sps", "cps", "operating_margin", "net_margin", "roe", "fcf_margin"]) {
  assert.ok(allGlossaryEntries.some((item) => item.id === glossaryId), `${glossaryId} glossary entry must exist`);
}

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const journalPanelSource = await readFile(new URL("../src/components/CompanyJournalPanel.tsx", import.meta.url), "utf8");
const journalSummarySource = await readFile(new URL("../src/components/CompanyJournalSummaryPanel.tsx", import.meta.url), "utf8");
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-body[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-reading[\s\S]*?overflow: visible/);
assert.match(styles, /\.company-journal-evidence \{[\s\S]*?overflow-y: auto/);
assert.match(styles, /\.company-journal-evidence \.company-valuation-dashboard,[\s\S]*?overflow: visible/);
assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*?background-clip: padding-box/);
assert.match(styles, /\.workspace-panel-frame \.company-journal-panel :is\([\s\S]*?\.company-journal-evidence[\s\S]*?scrollbar-width: thin !important/);
assert.match(styles, /::-webkit-scrollbar[\s\S]*?display: block !important/);
assert.doesNotMatch(styles, /scrollbar-color:[^;]*var\(--coinbase-primary\)/);
assert.match(styles, /\.company-journal-quote \{[\s\S]*?font-size: clamp\(20px, 1\.3cqw, 25px\)/);
assert.match(styles, /\.company-journal-tabs button\.is-positive[\s\S]*?var\(--color-up\)/);
assert.match(styles, /\.company-journal-tabs button\.is-negative[\s\S]*?var\(--color-down\)/);
assert.match(styles, /\.company-journal-tab-signal[\s\S]*?background: var\(--company-journal-tab-signal\)/);
assert.match(styles, /\.company-journal-insight-tags[\s\S]*?flex-wrap: wrap/);
assert.match(styles, /\.company-financial-table td\.is-evidence-focus/);
assert.match(styles, /\.company-financial-table td\.is-primary-evidence-focus/);
assert.doesNotMatch(styles, /\.company-journal-diagnosis-row/);
assert.match(journalPanelSource, /\["이자보상배율", "interest-coverage"\]/);
assert.match(journalPanelSource, /nearestFinancialYear/);
assert.match(journalPanelSource, /focusedFinancialYear/);
assert.doesNotMatch(journalPanelSource, /previewEnabled \|\| hasStoredCompanyEvidence/);
assert.match(journalSummarySource, /data-journal-stability-focus/);
assert.match(journalSummarySource, /data-journal-financial-metric/);
assert.match(journalSummarySource, /data-journal-financial-year/);
assert.match(journalSummarySource, /formatUsdCompactTable\(point\.revenue\)/);
assert.match(journalSummarySource, /formatUsdCompactTable\(point\.netIncome\)/);
assert.match(journalSummarySource, /"debt-ratio", "current-ratio", "interest-coverage", focusedMetric/);
assert.match(journalSummarySource, /const estimateX = x;\s*const actualX = x;/);
assert.doesNotMatch(journalSummarySource, /comparisonGap/);

console.log("company journal financial aggregation tests passed");
