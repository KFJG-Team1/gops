import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from "react";
import { fetchLatestCoachReport } from "../../agents/agentAnalysis";
import { useAuth } from "../../auth/AuthProvider";
import { usePaperAccount } from "../../orders/PaperAccountProvider";
import type { CoachReport } from "./types";
import {
  aiCoachRuntimeReducer,
  createAiCoachRuntimeState,
  resolveSeededPortfolioStatus,
  type CoachArchiveState,
  type SeededPortfolioStatus
} from "./aiCoachRuntimeState";

type AiCoachRuntimeContextValue = {
  report: CoachReport | null;
  archiveState: CoachArchiveState;
  activatePanel: () => () => void;
  acceptAnalysisReport: (report: CoachReport | null | undefined) => void;
  pageForPanel: (panelId: string) => number;
  setPageForPanel: (panelId: string, page: number) => void;
};

const AiCoachRuntimeContext = createContext<AiCoachRuntimeContextValue | undefined>(undefined);
const DEV_FIXTURE_ENABLED = import.meta.env.DEV && import.meta.env.VITE_AI_COACH_DEV_FIXTURE === "true";

export function AiCoachRuntimeProvider({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading: authLoading } = useAuth();
  const {
    snapshot: paperSnapshot,
    loading: paperLoading,
    orders: paperOrders,
    ordersLoading
  } = usePaperAccount();
  const accountKey = authEnabled ? (user?.email.trim().toLowerCase() ?? "") : "auth-disabled";
  const [state, dispatch] = useReducer(aiCoachRuntimeReducer, accountKey, createAiCoachRuntimeState);
  const [activePanelCount, setActivePanelCount] = useState(0);
  const seededStatusRef = useRef<SeededPortfolioStatus>("unknown");
  const fixtureRequestKeyRef = useRef<string | null>(null);
  const archiveRequestKeyRef = useRef<string | null>(null);
  const generationRef = useRef<{ accountKey: string; generation: number | null }>({
    accountKey,
    generation: null
  });

  const seededStatus = resolveSeededPortfolioStatus({
    accountLoading: authLoading || paperLoading,
    ordersLoading,
    seedProfile: paperSnapshot?.account.seed_profile,
    orders: paperOrders
  });
  seededStatusRef.current = seededStatus;

  useEffect(() => {
    generationRef.current = { accountKey, generation: null };
    dispatch({ type: "reset", accountKey });
  }, [accountKey]);

  useEffect(() => {
    if (authLoading || paperLoading || !paperSnapshot) return;
    const generation = paperSnapshot.account.generation;
    const previous = generationRef.current;
    if (previous.accountKey !== accountKey || previous.generation === null) {
      generationRef.current = { accountKey, generation };
      return;
    }
    if (previous.generation !== generation) {
      generationRef.current = { accountKey, generation };
      dispatch({ type: "reset", accountKey });
    }
  }, [accountKey, authLoading, paperLoading, paperSnapshot]);

  useEffect(() => {
    dispatch({
      type: "reconcile",
      accountKey,
      seededStatus,
      devFixtureEnabled: DEV_FIXTURE_ENABLED
    });
  }, [accountKey, seededStatus]);

  useEffect(() => {
    if (activePanelCount === 0) return;
    const needsFixture = seededStatus === "eligible"
      || (DEV_FIXTURE_ENABLED && !state.analysisReport);
    if (!needsFixture || state.fixtureReport) return;
    const requestKey = `${accountKey}:${paperSnapshot?.account.generation ?? "pending"}`;
    if (fixtureRequestKeyRef.current === requestKey) return;
    fixtureRequestKeyRef.current = requestKey;
    void import("./devFixture").then(({ AI_COACH_DEV_FIXTURE }) => {
      dispatch({
        type: "fixture.ready",
        accountKey,
        report: AI_COACH_DEV_FIXTURE,
        seededStatus: seededStatusRef.current,
        devFixtureEnabled: DEV_FIXTURE_ENABLED
      });
    });
  }, [accountKey, activePanelCount, paperSnapshot?.account.generation, seededStatus, state.analysisReport, state.fixtureReport]);

  useEffect(() => {
    if (
      activePanelCount === 0
      || seededStatus !== "ineligible"
      || state.analysisReport
      || DEV_FIXTURE_ENABLED
    ) {
      return;
    }
    const requestKey = `${accountKey}:${paperSnapshot?.account.generation ?? "none"}`;
    if (archiveRequestKeyRef.current === requestKey) return;
    archiveRequestKeyRef.current = requestKey;
    dispatch({ type: "archive.loading", accountKey });
    void fetchLatestCoachReport()
      .then((report) => {
        dispatch({
          type: "archive.ready",
          accountKey,
          report,
          seededStatus: seededStatusRef.current,
          devFixtureEnabled: DEV_FIXTURE_ENABLED
        });
      })
      .catch(() => {
        dispatch({
          type: "archive.unavailable",
          accountKey,
          seededStatus: seededStatusRef.current,
          devFixtureEnabled: DEV_FIXTURE_ENABLED
        });
      });
  }, [accountKey, activePanelCount, paperSnapshot?.account.generation, seededStatus, state.analysisReport]);

  const activatePanel = useCallback(() => {
    setActivePanelCount((current) => current + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      setActivePanelCount((current) => Math.max(0, current - 1));
    };
  }, []);

  const acceptAnalysisReport = useCallback((report: CoachReport | null | undefined) => {
    if (!report) return;
    dispatch({
      type: "analysis.ready",
      accountKey,
      report,
      seededStatus: seededStatusRef.current,
      devFixtureEnabled: DEV_FIXTURE_ENABLED
    });
  }, [accountKey]);

  const setPageForPanel = useCallback((panelId: string, page: number) => {
    dispatch({ type: "page.set", accountKey, panelId, page });
  }, [accountKey]);
  const visibleState = state.accountKey === accountKey
    ? state
    : createAiCoachRuntimeState(accountKey);
  const pageForVisiblePanel = useCallback(
    (panelId: string) => visibleState.pages[panelId] ?? 0,
    [visibleState.pages]
  );

  const value = useMemo<AiCoachRuntimeContextValue>(() => ({
    report: visibleState.report,
    archiveState: visibleState.archiveState,
    activatePanel,
    acceptAnalysisReport,
    pageForPanel: pageForVisiblePanel,
    setPageForPanel
  }), [
    acceptAnalysisReport,
    activatePanel,
    pageForVisiblePanel,
    setPageForPanel,
    visibleState.archiveState,
    visibleState.report
  ]);

  return <AiCoachRuntimeContext.Provider value={value}>{children}</AiCoachRuntimeContext.Provider>;
}

export function useAiCoachRuntime(): AiCoachRuntimeContextValue {
  const context = useContext(AiCoachRuntimeContext);
  if (!context) {
    throw new Error("useAiCoachRuntime must be used inside AiCoachRuntimeProvider");
  }
  return context;
}
