import assert from "node:assert/strict";
import { companyJournalAnalystActionsForDisplay } from "../src/components/CompanyJournalPanel";
import {
  fetchCompanyJournalEvidence,
  normalizeCompanyJournalAnalystSummary,
  type CompanyJournalAnalystSummary
} from "../src/components/companyJournalApi";

const analystSummary: CompanyJournalAnalystSummary = {
  statement: "JP모건은 투자의견을 상향했고 시장 평균 목표주가는 200달러입니다.",
  tone: "positive",
  sourceAsOf: "2026-07-15T12:00:00Z",
  collectedAt: "2026-07-16T01:00:00Z",
  source: "yahoo-finance"
};

assert.deepEqual(
  companyJournalAnalystActionsForDisplay(analystSummary),
  [{
    firm: "",
    action: "summary",
    fromGrade: "",
    toGrade: "",
    priorPriceTarget: null,
    priceTarget: null,
    actionAt: analystSummary.sourceAsOf,
    source: "yahoo-finance",
    statement: analystSummary.statement,
    tone: "positive"
  }],
  "the current 24-hour summary must be displayable without stored report actions"
);
assert.deepEqual(
  companyJournalAnalystActionsForDisplay(null),
  [],
  "an expired summary must render the existing empty state"
);
assert.deepEqual(
  normalizeCompanyJournalAnalystSummary({
    statement: ` ${analystSummary.statement} `,
    tone: "positive",
    source_as_of: analystSummary.sourceAsOf,
    collected_at: analystSummary.collectedAt,
    source: "yahoo-finance"
  }),
  analystSummary,
  "the API boundary must normalize the single compact summary"
);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/api\/company-journal\/NVDA\/evidence\?benchmarks=SPY%2CXLK/);
    return new Response(JSON.stringify({
      contractVersion: "company-journal-evidence.v1",
      symbol: "NVDA",
      sourceAsOf: "2026-07-15T12:00:00Z",
      cutoff: "2026-07-15T23:59:59Z",
      financialSeries: [],
      earningsSeries: [],
      performanceSeries: [],
      analystSummary,
      missingData: []
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const response = await fetchCompanyJournalEvidence("NVDA", ["SPY", "XLK"]);
  assert.deepEqual(response.analystSummary, analystSummary);
  assert.equal(response.contractVersion, "company-journal-evidence.v1");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("company journal evidence API tests passed");
