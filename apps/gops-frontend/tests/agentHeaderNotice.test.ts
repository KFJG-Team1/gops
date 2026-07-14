import assert from "node:assert/strict";
import test from "node:test";
import { agentReportCompletionMessage } from "../src/agent/agentHeaderNotice";
import type { AgentAnalysisReport } from "../src/agents/agentAnalysis";

function report(overrides: Partial<AgentAnalysisReport> = {}): AgentAnalysisReport {
  return {
    analysisId: "analysis-1",
    summary: "done",
    symbol: "msft",
    status: "completed",
    route: {
      source: "rules",
      intentType: "analysis",
      selectedRoles: ["market"]
    },
    agentAnswers: [],
    findings: [],
    providerEvidence: [],
    dailySummaries: [],
    ...overrides
  };
}

test("news reports use a symbol-aware fetched message", () => {
  assert.equal(agentReportCompletionMessage(report({
    route: { source: "rules", intentType: "news", selectedRoles: ["news"] }
  }), "NVDA"), "MSFT 뉴스를 가져왔습니다.");
});

test("non-news reports use a chart analysis completion message", () => {
  assert.equal(agentReportCompletionMessage(report(), "NVDA"), "MSFT 차트 분석을 완료했습니다.");
});

test("the active symbol is used when a report omits its symbol", () => {
  assert.equal(agentReportCompletionMessage(report({ symbol: undefined }), "nvda"), "NVDA 차트 분석을 완료했습니다.");
});
