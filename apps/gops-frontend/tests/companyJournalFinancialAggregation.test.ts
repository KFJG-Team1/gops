import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateQuarterlySeriesToAnnual,
  companyJournalAnnualHistory,
  companyJournalHistoryYears
} from "../src/components/CompanyJournalSummaryPanel";

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

assert.equal(companyJournalHistoryYears(2026), 6);
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

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-body[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
assert.match(styles, /@container \(max-width: 960px\)[\s\S]*?\.company-journal-reading[\s\S]*?overflow: visible/);
assert.match(styles, /\.company-journal-evidence \{[\s\S]*?overflow-y: auto/);
assert.match(styles, /\.company-journal-evidence \.company-valuation-dashboard,[\s\S]*?overflow: visible/);
assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*?background-clip: padding-box/);
assert.match(styles, /\.workspace-panel-frame \.company-journal-panel :is\([\s\S]*?\.company-journal-evidence[\s\S]*?scrollbar-width: thin !important/);
assert.match(styles, /::-webkit-scrollbar[\s\S]*?display: block !important/);
assert.doesNotMatch(styles, /scrollbar-color:[^;]*var\(--coinbase-primary\)/);
assert.match(styles, /\.company-journal-quote \{[\s\S]*?font-size: clamp\(20px, 1\.3cqw, 25px\)/);

console.log("company journal financial aggregation tests passed");
