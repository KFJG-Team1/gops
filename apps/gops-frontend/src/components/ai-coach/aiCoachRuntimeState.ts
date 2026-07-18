import type { CoachReport } from "./types";

export type SeededPortfolioStatus = "unknown" | "eligible" | "ineligible";
export type CoachReportSource = "analysis" | "fixture" | "archive";
export type CoachArchiveState = "loading" | "ready" | "unavailable";

export type AiCoachRuntimeState = {
  accountKey: string;
  report: CoachReport | null;
  reportSource: CoachReportSource | null;
  analysisReport: CoachReport | null;
  fixtureReport: CoachReport | null;
  archiveReport: CoachReport | null;
  archiveState: CoachArchiveState;
  pages: Record<string, number>;
};

export type AiCoachRuntimeAction =
  | { type: "reset"; accountKey: string }
  | { type: "analysis.ready"; accountKey: string; report: CoachReport; seededStatus: SeededPortfolioStatus; devFixtureEnabled: boolean }
  | { type: "fixture.ready"; accountKey: string; report: CoachReport; seededStatus: SeededPortfolioStatus; devFixtureEnabled: boolean }
  | { type: "archive.loading"; accountKey: string }
  | { type: "archive.ready"; accountKey: string; report: CoachReport | null; seededStatus: SeededPortfolioStatus; devFixtureEnabled: boolean }
  | { type: "archive.unavailable"; accountKey: string; seededStatus: SeededPortfolioStatus; devFixtureEnabled: boolean }
  | { type: "reconcile"; accountKey: string; seededStatus: SeededPortfolioStatus; devFixtureEnabled: boolean }
  | { type: "page.set"; accountKey: string; panelId: string; page: number };

export function createAiCoachRuntimeState(accountKey: string): AiCoachRuntimeState {
  return {
    accountKey,
    report: null,
    reportSource: null,
    analysisReport: null,
    fixtureReport: null,
    archiveReport: null,
    archiveState: "loading",
    pages: {}
  };
}

export function aiCoachRuntimeReducer(
  state: AiCoachRuntimeState,
  action: AiCoachRuntimeAction
): AiCoachRuntimeState {
  if (action.type === "reset") {
    return createAiCoachRuntimeState(action.accountKey);
  }
  if (state.accountKey !== action.accountKey) {
    return state;
  }
  if (action.type === "analysis.ready") {
    return reconcileReport(
      { ...state, analysisReport: action.report },
      action.seededStatus,
      action.devFixtureEnabled
    );
  }
  if (action.type === "fixture.ready") {
    return reconcileReport(
      { ...state, fixtureReport: action.report },
      action.seededStatus,
      action.devFixtureEnabled
    );
  }
  if (action.type === "archive.loading") {
    return { ...state, archiveState: "loading" };
  }
  if (action.type === "archive.ready") {
    return reconcileReport(
      { ...state, archiveReport: action.report, archiveState: "ready" },
      action.seededStatus,
      action.devFixtureEnabled
    );
  }
  if (action.type === "archive.unavailable") {
    return reconcileReport(
      { ...state, archiveState: "unavailable" },
      action.seededStatus,
      action.devFixtureEnabled
    );
  }
  if (action.type === "reconcile") {
    return reconcileReport(state, action.seededStatus, action.devFixtureEnabled);
  }
  if (action.type === "page.set") {
    const page = Math.max(0, Math.min(3, Math.trunc(action.page)));
    if (state.pages[action.panelId] === page) return state;
    return { ...state, pages: { ...state.pages, [action.panelId]: page } };
  }
  return state;
}

export function resolveSeededPortfolioStatus(input: {
  accountLoading: boolean;
  ordersLoading: boolean;
  seedProfile?: string | null;
  orders: Array<{ seed_profile?: string | null }>;
}): SeededPortfolioStatus {
  if (input.accountLoading || input.ordersLoading) return "unknown";
  if (
    input.seedProfile
    && input.orders.length > 0
    && input.orders.every((order) => Boolean(order.seed_profile))
  ) {
    return "eligible";
  }
  return "ineligible";
}

function reconcileReport(
  state: AiCoachRuntimeState,
  seededStatus: SeededPortfolioStatus,
  devFixtureEnabled: boolean
): AiCoachRuntimeState {
  let report = state.report;
  let reportSource = state.reportSource;

  if (seededStatus === "eligible" && state.fixtureReport) {
    report = state.fixtureReport;
    reportSource = "fixture";
  } else if (seededStatus === "ineligible") {
    if (state.analysisReport) {
      report = state.analysisReport;
      reportSource = "analysis";
    } else if (devFixtureEnabled && state.fixtureReport) {
      report = state.fixtureReport;
      reportSource = "fixture";
    } else if (state.archiveReport) {
      report = state.archiveReport;
      reportSource = "archive";
    } else if (
      state.reportSource === "fixture"
      && state.archiveState !== "loading"
    ) {
      report = null;
      reportSource = null;
    }
  } else if (seededStatus === "unknown") {
    if (state.analysisReport) {
      report = state.analysisReport;
      reportSource = "analysis";
    } else if (devFixtureEnabled && state.fixtureReport) {
      report = state.fixtureReport;
      reportSource = "fixture";
    }
  }

  return report === state.report && reportSource === state.reportSource
    ? state
    : { ...state, report, reportSource };
}
