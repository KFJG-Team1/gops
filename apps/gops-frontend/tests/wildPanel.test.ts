import assert from "node:assert/strict";
import type { AgentAnalysisReport } from "../src/agents/agentAnalysis";
import {
  restoreTiledPanelStateSnapshot,
  serializeTiledPanelState,
  type TiledPanelState
} from "../src/layout/panelLayout";
import {
  addAgentReportToWildPanel,
  disableWildPanel,
  enableWildPanel,
  normalizeWildPanelState,
  resolveWildPanelSlotId,
  setWildPanelActivePage,
  wildPanelBasePageId,
  wildPanelPages,
  wildPanelReportLimit
} from "../src/layout/wildPanel";

const viewport = { width: 1280, height: 720 };
const original = panelState();
const enabled = enableWildPanel(original, "slot-chart");
assert.equal(enabled.slots[0]?.wildPanel?.activePageId, wildPanelBasePageId);
assert.equal(resolveWildPanelSlotId(enabled), "slot-chart", "the sole wild panel is the implicit report destination");
assert.equal(original.slots[0]?.wildPanel, undefined, "enable must not mutate the prior state");

const firstReport = report("analysis-1", 2);
const withReport = addAgentReportToWildPanel(enabled, "slot-chart", firstReport, "2026-07-13T00:00:00Z");
const firstWild = withReport.slots[0]?.wildPanel;
assert.ok(firstWild);
assert.deepEqual(wildPanelPages(firstWild).map((page) => page.kind), [
  "chartCommentary",
  "agentAnswer",
  "agentAnswer"
]);
assert.equal(firstWild.activePageId, "analysis-1:answer:0:agent-0", "new reports focus the first role answer");

const duplicate = addAgentReportToWildPanel(
  setWildPanelActivePage(withReport, "slot-chart", wildPanelBasePageId),
  "slot-chart",
  firstReport
);
assert.equal(duplicate.slots[0]?.wildPanel?.reportGroups.length, 1, "the same analysis is not duplicated");
assert.equal(duplicate.slots[0]?.wildPanel?.activePageId, "analysis-1:answer:0:agent-0");

const summaryOnly = addAgentReportToWildPanel(enabled, "slot-chart", report("summary-only", 0));
assert.equal(summaryOnly.slots[0]?.wildPanel?.activePageId, "summary-only:commentary");

let capped = enabled;
for (let index = 0; index < wildPanelReportLimit + 2; index += 1) {
  capped = addAgentReportToWildPanel(capped, "slot-chart", report(`analysis-${index}`, 1));
}
assert.equal(capped.slots[0]?.wildPanel?.reportGroups.length, wildPanelReportLimit);
assert.equal(capped.slots[0]?.wildPanel?.reportGroups[0]?.analysisId, "analysis-2");

const restored = restoreTiledPanelStateSnapshot(serializeTiledPanelState(capped), viewport);
assert.deepEqual(restored?.slots[0]?.wildPanel, capped.slots[0]?.wildPanel, "wild pages survive layout persistence");

const invalidActive = normalizeWildPanelState({
  activePageId: "missing",
  reportGroups: capped.slots[0]?.wildPanel?.reportGroups
});
assert.equal(invalidActive?.activePageId, wildPanelBasePageId);
assert.equal(normalizeWildPanelState({ reportGroups: "invalid" }), null);
const malformedSnapshot = serializeTiledPanelState(enabled);
(malformedSnapshot.slots[0] as unknown as Record<string, unknown>).wildPanel = { reportGroups: "invalid" };
const restoredMalformed = restoreTiledPanelStateSnapshot(malformedSnapshot, viewport);
assert.ok(restoredMalformed, "invalid optional wild state must not reject the base layout");
assert.equal(restoredMalformed.slots[0]?.wildPanel, undefined);

const cleared = disableWildPanel(withReport, "slot-chart");
assert.equal(cleared.slots[0]?.wildPanel, undefined, "fixed mode clears the complete wild stack");

const secondEnabled = enableWildPanel(withReport, "slot-news");
const secondAdded = addAgentReportToWildPanel(secondEnabled, "slot-news", report("other-panel", 1));
assert.equal(secondAdded.slots[0]?.wildPanel, undefined, "enabling a new wild panel fixes the previous one");
assert.equal(secondAdded.slots[1]?.wildPanel?.reportGroups[0]?.analysisId, "other-panel");
assert.equal(resolveWildPanelSlotId(secondAdded, "slot-chart"), "slot-news", "a stale selection falls back to the sole wild panel");

const multiWildSnapshot = serializeTiledPanelState(enabled);
(multiWildSnapshot.slots[1] as unknown as Record<string, unknown>).wildPanel = {
  activePageId: wildPanelBasePageId,
  reportGroups: []
};
const restoredSingleWild = restoreTiledPanelStateSnapshot(multiWildSnapshot, viewport);
assert.ok(restoredSingleWild);
assert.equal(
  restoredSingleWild.slots.filter((slot) => slot.wildPanel).length,
  1,
  "legacy snapshots with multiple wild panels restore only the first one"
);

console.log("wild panel tests passed");

function panelState(): TiledPanelState {
  return {
    nextInstance: 3,
    contents: {
      "content-chart": { id: "content-chart", kind: "chart", title: "차트", instanceIndex: 1 },
      "content-news": { id: "content-news", kind: "news", title: "뉴스", instanceIndex: 2 }
    },
    slots: [
      {
        id: "slot-chart",
        contentId: "content-chart",
        gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 3 },
        rect: { left: 0, top: 0, width: 640, height: 360 },
        minWidth: 1,
        minHeight: 1
      },
      {
        id: "slot-news",
        contentId: "content-news",
        gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 3 },
        rect: { left: 640, top: 0, width: 640, height: 360 },
        minWidth: 1,
        minHeight: 1
      }
    ]
  };
}

function report(analysisId: string, answerCount: number): AgentAnalysisReport {
  return {
    analysisId,
    summary: `${analysisId} summary`,
    symbol: "NVDA",
    finalAnswer: {
      title: `${analysisId} title`,
      summary: `${analysisId} final summary`,
      sections: [{ title: "판단", bullets: ["상승 가능성"] }],
      citations: [{ provider: "test", title: "source", url: "https://example.com" }],
      limitations: ["test limitation"]
    },
    finalResponse: {
      risk_warnings: ["risk"],
      data_freshness_warnings: [],
      confidence: 0.8
    },
    agentAnswers: Array.from({ length: answerCount }, (_, index) => ({
      agentId: `agent-${index}`,
      role: `role-${index}`,
      title: `Answer ${index}`,
      content: `Content ${index}`,
      confidence: 0.7,
      citations: []
    })),
    findings: [],
    providerEvidence: [],
    dailySummaries: []
  };
}
