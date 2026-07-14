import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeChartExplanation, chartExplanationMatchesAsset, chartExplanationMatchesSource, type ChartExplanation } from "../src/agent/chartExplanation";
import {
  attachChartCommentaryReport,
  beginChartCommentaryRequest,
  chartCommentaryStateForDocument,
  chartCommentaryHistoryLimit,
  clearChartCommentaryPending,
  ensureChartCommentaryPanel,
  normalizeChartCommentaryState,
  rememberChartCommentaryState,
  type ChartCommentaryRequestSnapshot
} from "../src/agent/chartCommentaryHistory";
import type { AgentAnalysisReport } from "../src/agents/agentAnalysis";
import { restoreTiledPanelStateSnapshot, serializeTiledPanelState, type TiledPanelState } from "../src/layout/panelLayout";

const viewport = { width: 1280, height: 720 };
const source: ChartCommentaryRequestSnapshot = {
  chartDocumentId: "doc-a",
  sourcePanelId: "content-chart-a",
  symbol: "NVDA",
  interval: "1D",
  assetVersion: "geometry",
  algorithmVersion: "ohlcv-consensus-pattern-families-v4",
  inputDigest: "sha256:nvda",
  asOf: "2026-07-14T00:00:00Z"
};

const normalizedExplanation = normalizeChartExplanation(explanation());
const explanationSchema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../shared/chart-contract/chart-explanation.schema.json", import.meta.url)), "utf-8"));
assert.equal(explanationSchema.properties.version.const, "chart-explanation.v1");
assert.deepEqual(explanationSchema.properties.focusGroups.required, ["evidence", "pattern", "support", "resistance"]);
assert.ok(normalizedExplanation);
assert.equal(normalizedExplanation.source?.chartDocumentId, "doc-a");
assert.deepEqual(normalizedExplanation.focusGroups?.support, ["chart-asset:NVDA:1D:support-1"]);
assert.equal(chartExplanationMatchesAsset(normalizedExplanation, source), true);
assert.equal(chartExplanationMatchesAsset(normalizedExplanation, { ...source, inputDigest: "sha256:other" }), false);
assert.equal(chartExplanationMatchesSource(normalizedExplanation, "doc-a"), true);
assert.equal(chartExplanationMatchesSource(normalizedExplanation, "doc-b"), false);
assert.equal(chartExplanationMatchesSource({ ...normalizedExplanation, source: undefined }, "doc-a"), true, "old v1 answers without source remain compatible");
assert.ok(normalizeChartExplanation({ ...explanation(), focusGroups: undefined }), "v1 readers accept reports created before focusGroups was added");
assert.equal(normalizeChartExplanation({ ...explanation(), version: "chart-explanation.v2" }), null);

const initial = panelState();
const ensured = ensureChartCommentaryPanel(initial, source, viewport);
assert.equal(ensured.contentId, "content-chartCommentary-2");
assert.equal(ensured.state.slots.at(-1)?.gridRect.col, 5, "wide layouts place commentary to the chart's right");
assert.equal(Object.values(ensured.state.contents).filter((item) => item.kind === "chartCommentary").length, 1);

const begun = beginChartCommentaryRequest(initial, source, "client-1", "차트 분석해줘", viewport);
const begunContent = begun.contentId ? begun.state.contents[begun.contentId] : null;
const begunState = normalizeChartCommentaryState(begunContent?.props?.commentaryState, source.chartDocumentId);
assert.equal(begunState.activeView, "current", "pending work does not replace the current commentary");
assert.equal(begunState.pending?.requestId, "client-1");

let withAnswers = begun.state;
for (let index = 0; index < chartCommentaryHistoryLimit + 2; index += 1) {
  withAnswers = attachChartCommentaryReport(
    withAnswers,
    source,
    report(`analysis-${index}`),
    `질문 ${index}`,
    viewport,
    {},
    `2026-07-15T00:00:${String(index).padStart(2, "0")}Z`
  ).state;
}
const answerContent = Object.values(withAnswers.contents).find((item) => item.kind === "chartCommentary");
const answerState = normalizeChartCommentaryState(answerContent?.props?.commentaryState, source.chartDocumentId);
assert.equal(answerState.answers.length, chartCommentaryHistoryLimit);
assert.equal(answerState.answers[0]?.analysisId, "analysis-2");
assert.equal(answerState.activeView, `analysis-${chartCommentaryHistoryLimit + 1}`);
assert.equal(answerState.pending, null);

const perDocumentHistory = rememberChartCommentaryState(undefined, "doc-a", answerState);
const docBState = chartCommentaryStateForDocument(perDocumentHistory, "doc-b");
assert.equal(docBState.answers.length, 0, "another chart starts with isolated commentary history");
const withDocB = rememberChartCommentaryState(perDocumentHistory, "doc-b", {
  ...docBState,
  pending: { requestId: "doc-b-request", question: "이 봉 분석해줘", requestedAt: source.asOf, snapshot: { ...source, chartDocumentId: "doc-b" } }
});
assert.equal(chartCommentaryStateForDocument(withDocB, "doc-a").answers.length, chartCommentaryHistoryLimit);
assert.equal(chartCommentaryStateForDocument(withDocB, "doc-b").pending?.requestId, "doc-b-request");

const restored = restoreTiledPanelStateSnapshot(serializeTiledPanelState(withAnswers), viewport);
const restoredContent = Object.values(restored?.contents ?? {}).find((item) => item.kind === "chartCommentary");
const restoredState = normalizeChartCommentaryState(restoredContent?.props?.commentaryState, source.chartDocumentId);
assert.equal(restoredState.answers.length, chartCommentaryHistoryLimit, "answer history persists with the workspace layout");

const cleared = clearChartCommentaryPending(begun.state, "doc-a");
const clearedContent = Object.values(cleared.contents).find((item) => item.kind === "chartCommentary");
assert.equal(normalizeChartCommentaryState(clearedContent?.props?.commentaryState, "doc-a").pending, null);

const legacy = panelState(true);
const boundLegacy = ensureChartCommentaryPanel(legacy, source, viewport);
assert.equal(boundLegacy.contentId, "content-commentary-legacy");
assert.equal(boundLegacy.state.contents["content-commentary-legacy"]?.props?.chartDocumentId, "doc-a");
assert.equal(boundLegacy.state.slots.length, legacy.slots.length, "an unbound legacy commentary panel is reused");

console.log("chart commentary history tests passed");

function panelState(withLegacy = false): TiledPanelState {
  return {
    nextInstance: 2,
    contents: {
      "content-chart-a": {
        id: "content-chart-a",
        kind: "chart",
        title: "차트",
        instanceIndex: 1,
        chartDocumentId: "doc-a",
        props: { symbol: "NVDA", timeframe: "1D" }
      },
      ...(withLegacy ? {
        "content-commentary-legacy": {
          id: "content-commentary-legacy",
          kind: "chartCommentary" as const,
          title: "차트 해설",
          instanceIndex: 2
        }
      } : {})
    },
    slots: [
      {
        id: "slot-chart-a", contentId: "content-chart-a",
        gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 3 },
        rect: { left: 0, top: 0, width: 640, height: 360 }, minWidth: 1, minHeight: 1
      },
      ...(withLegacy ? [{
        id: "slot-commentary-legacy", contentId: "content-commentary-legacy",
        gridRect: { col: 5, row: 1, colSpan: 2, rowSpan: 2 },
        rect: { left: 640, top: 0, width: 320, height: 240 }, minWidth: 1, minHeight: 1
      }] : [])
    ]
  };
}

function report(analysisId: string): AgentAnalysisReport {
  return {
    analysisId,
    summary: `${analysisId} summary`,
    symbol: "NVDA",
    status: "completed",
    route: { source: "rules", intentType: "chart", selectedRoles: ["chart"] },
    finalAnswer: {
      title: "NVDA 차트 해설",
      summary: "기존 Geometry 자산을 기준으로 해설했습니다.",
      sections: [{ title: "주요 관찰", bullets: ["가까운 지지 가격은 118.00입니다."] }],
      citations: [],
      limitations: []
    },
    finalResponse: { risk_warnings: [], data_freshness_warnings: [] },
    agentAnswers: [], findings: [], providerEvidence: [], dailySummaries: [], tradeConditionProposals: [],
    chartExplanation: explanation()
  };
}

function explanation(): ChartExplanation {
  const supportId = "chart-asset:NVDA:1D:support-1";
  return {
    version: "chart-explanation.v1",
    symbol: "NVDA",
    interval: "1D",
    asOf: "2026-07-14T00:00:00Z",
    quality: { state: "full", stale: false, flags: [] },
    assetIdentity: {
      assetVersion: "geometry",
      algorithmVersion: "ohlcv-consensus-pattern-families-v4",
      inputDigest: "sha256:nvda",
      asOf: "2026-07-14T00:00:00Z"
    },
    source: { chartDocumentId: "doc-a", sourcePanelId: "content-chart-a" },
    facts: {
      pattern: null,
      support: { id: "support-1", price: 118 },
      resistance: null,
      tradeScenario: null,
      movingAverageCross: null,
      selectedCandle: null
    },
    usedIndicators: ["가격 구조"],
    focusIds: [supportId],
    focusGroups: { evidence: [supportId], pattern: [], support: [supportId], resistance: [] },
    anchor: null,
    news: []
  };
}
