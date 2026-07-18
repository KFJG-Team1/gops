import assert from "node:assert/strict";
import type { CoachReport } from "../src/components/ai-coach/types";
import {
  aiCoachRuntimeReducer,
  createAiCoachRuntimeState,
  resolveSeededPortfolioStatus
} from "../src/components/ai-coach/aiCoachRuntimeState";

const report = (analysisId: string) => ({
  contractVersion: "coach-report.v2",
  analysisId,
  generatedAt: "2026-07-18T00:00:00Z",
  sourceAsOf: {},
  page1: null,
  page2: null,
  page3: null,
  page4: null
}) as CoachReport;

assert.equal(resolveSeededPortfolioStatus({
  accountLoading: false,
  ordersLoading: true,
  seedProfile: "diversified-us-v3",
  orders: []
}), "unknown");
assert.equal(resolveSeededPortfolioStatus({
  accountLoading: false,
  ordersLoading: false,
  seedProfile: "diversified-us-v3",
  orders: [{ seed_profile: "diversified-us-v3" }]
}), "eligible");
assert.equal(resolveSeededPortfolioStatus({
  accountLoading: false,
  ordersLoading: false,
  seedProfile: "diversified-us-v3",
  orders: [{ seed_profile: null }]
}), "ineligible");

let state = createAiCoachRuntimeState("user-a");
const fixture = report("seeded-report");
state = aiCoachRuntimeReducer(state, {
  type: "fixture.ready",
  accountKey: "user-a",
  report: fixture,
  seededStatus: "eligible",
  devFixtureEnabled: false
});
state = aiCoachRuntimeReducer(state, {
  type: "page.set",
  accountKey: "user-a",
  panelId: "content-aiCoach-1",
  page: 2
});

// SIM 전환 중 계좌와 주문이 다시 로딩되는 동안에는 현재 리포트와 페이지를 유지한다.
state = aiCoachRuntimeReducer(state, {
  type: "reconcile",
  accountKey: "user-a",
  seededStatus: "unknown",
  devFixtureEnabled: false
});
assert.equal(state.report?.analysisId, "seeded-report");
assert.equal(state.pages["content-aiCoach-1"], 2);

// 패널 재마운트는 런타임 상태 액션을 만들지 않으므로 같은 리포트가 그대로 보인다.
state = aiCoachRuntimeReducer(state, {
  type: "reconcile",
  accountKey: "user-a",
  seededStatus: "eligible",
  devFixtureEnabled: false
});
assert.strictEqual(state.report, fixture);

// 실제 비-seed 주문이 확정되면 저장 리포트 경로로 전환한다.
const archived = report("archive-after-user-order");
state = aiCoachRuntimeReducer(state, {
  type: "archive.ready",
  accountKey: "user-a",
  report: archived,
  seededStatus: "ineligible",
  devFixtureEnabled: false
});
assert.equal(state.report?.analysisId, "archive-after-user-order");

// 유효한 Agent 리포트가 우선하며 뒤늦은 archive 응답은 이를 덮어쓰지 않는다.
const analysis = report("analysis-new");
state = aiCoachRuntimeReducer(state, {
  type: "analysis.ready",
  accountKey: "user-a",
  report: analysis,
  seededStatus: "ineligible",
  devFixtureEnabled: false
});
state = aiCoachRuntimeReducer(state, {
  type: "archive.ready",
  accountKey: "user-a",
  report: report("archive-stale"),
  seededStatus: "ineligible",
  devFixtureEnabled: false
});
assert.equal(state.report?.analysisId, "analysis-new");

// 실제 사용자 주문 뒤 archive가 아직 없으면 seeded fixture를 계속 노출하지 않는다.
let pendingArchiveState = createAiCoachRuntimeState("user-pending");
pendingArchiveState = aiCoachRuntimeReducer(pendingArchiveState, {
  type: "fixture.ready",
  accountKey: "user-pending",
  report: fixture,
  seededStatus: "eligible",
  devFixtureEnabled: false
});
pendingArchiveState = aiCoachRuntimeReducer(pendingArchiveState, {
  type: "archive.ready",
  accountKey: "user-pending",
  report: null,
  seededStatus: "ineligible",
  devFixtureEnabled: false
});
assert.equal(pendingArchiveState.report, null);

// 인증 주체 변경은 리포트와 패널 페이지를 모두 제거한다.
state = aiCoachRuntimeReducer(state, { type: "reset", accountKey: "user-b" });
assert.equal(state.accountKey, "user-b");
assert.equal(state.report, null);
assert.deepEqual(state.pages, {});

console.log("AI coach runtime state tests passed");
