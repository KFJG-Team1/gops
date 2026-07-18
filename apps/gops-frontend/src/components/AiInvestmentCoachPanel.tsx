import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAlert, setAlertStatus } from "../alerts/alertApi";
import { fetchLatestCoachReport } from "../agents/agentAnalysis";
import { CoachActionCenterPage } from "./ai-coach/CoachActionCenterPage";
import { CurrentPositionCoachPage } from "./ai-coach/CurrentPositionCoachPage";
import { HabitCoachPage } from "./ai-coach/HabitCoachPage";
import { ImprovementCoachPage } from "./ai-coach/ImprovementCoachPage";
import type { CoachAlertCandidate, CoachReport, ImprovementPlan, PlaybookExperiment, TradingGuardrail, WatchCondition } from "./ai-coach/types";
import styles from "./ai-coach/AiCoachShell.module.css";
import { latestSimulatorStatus, simulatorStatusEvent, type SimulatorStatus } from "../simulator/simulatorApi";
import { usePaperAccount } from "../orders/PaperAccountProvider";

const PAGES = ["당일 거래 회고", "장기 습관", "효과·보완 조건", "실행·알람 관리"] as const;
const DEV_FIXTURE_ENABLED = import.meta.env.DEV && import.meta.env.VITE_AI_COACH_DEV_FIXTURE === "true";

export function AiInvestmentCoachPanel({ report }: { report?: CoachReport | null }) {
  const { snapshot: paperSnapshot, orders: paperOrders } = usePaperAccount();
  const [page, setPage] = useState(0);
  const [fixture, setFixture] = useState<CoachReport | null>(null);
  const [archivedReport, setArchivedReport] = useState<CoachReport | null>(null);
  const [archiveState, setArchiveState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [planOverride, setPlanOverride] = useState<ImprovementPlan | null>(null);
  const [focusedAlertCandidateId, setFocusedAlertCandidateId] = useState<string | null>(null);
  const [simulatorMode, setSimulatorMode] = useState(() => latestSimulatorStatus()?.mode ?? "live");
  const mainRef = useRef<HTMLElement>(null);
  const seededPortfolioReport = Boolean(
    paperSnapshot?.account.seed_profile
    && paperOrders.length
    && paperOrders.every((order) => Boolean(order.seed_profile))
  );

  useEffect(() => {
    let active = true;
    if (seededPortfolioReport || (!report && DEV_FIXTURE_ENABLED)) {
      import("./ai-coach/devFixture").then(({ AI_COACH_DEV_FIXTURE }) => {
        if (active) setFixture(AI_COACH_DEV_FIXTURE);
      });
    } else {
      setFixture(null);
    }
    return () => { active = false; };
  }, [report, seededPortfolioReport]);

  useEffect(() => {
    if (simulatorMode === "simulation") {
      setArchivedReport(null);
      setArchiveState("unavailable");
      return;
    }
    if (report || DEV_FIXTURE_ENABLED || seededPortfolioReport) {
      setArchivedReport(null);
      setArchiveState("ready");
      return;
    }
    const controller = new AbortController();
    setArchiveState("loading");
    fetchLatestCoachReport(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setArchivedReport(next);
          setArchiveState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setArchiveState("unavailable");
      });
    return () => controller.abort();
  }, [report, seededPortfolioReport, simulatorMode]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      setSimulatorMode((event as CustomEvent<SimulatorStatus>).detail?.mode ?? "live");
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, []);

  const resolved = simulatorMode === "simulation"
    ? null
    : seededPortfolioReport
      ? fixture
      : report ?? fixture ?? archivedReport;
  const plan = planOverride ?? resolved?.page3 ?? null;
  useEffect(() => {
    setPlanOverride(null);
    setFocusedAlertCandidateId(null);
  }, [resolved?.analysisId]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.scrollLeft = 0;
  }, [page]);

  const showPage = (nextPage: number) => {
    setFocusedAlertCandidateId(null);
    setPage(nextPage);
  };
  const move = (delta: number) => {
    setFocusedAlertCandidateId(null);
    setPage((current) => (current + delta + PAGES.length) % PAGES.length);
  };
  const openAlertCenter = (condition: WatchCondition) => {
    setFocusedAlertCandidateId(condition.id);
    setPage(3);
  };
  const updateExperiment = (experimentId: PlaybookExperiment["id"], status: "active" | "paused") => {
    if (!plan) return;
    setPlanOverride({ ...plan, experiments: plan.experiments.map((item) => item.id === experimentId ? { ...item, status } : item) });
  };
  const updateGuardrail = (guardrailId: TradingGuardrail["id"], enabled: boolean) => {
    if (!plan) return;
    setPlanOverride({ ...plan, guardrails: plan.guardrails.map((item) => item.id === guardrailId ? { ...item, enabled } : item) });
  };
  const submitCandidateAlert = async (candidate: CoachAlertCandidate) => {
    if (!candidate.alertRequest) return false;
    await createAlert({ ...candidate.alertRequest, proposalSource: candidate.proposalSource ?? undefined });
    return true;
  };
  const updateServerAlert = async (candidate: CoachAlertCandidate, enabled: boolean) => {
    if (!candidate.serverAlertId) return false;
    await setAlertStatus(candidate.serverAlertId, enabled ? "active" : "disabled");
    return true;
  };

  const content = (() => {
    if (simulatorMode === "simulation") return <Unavailable title="AI 투자 코치" message="시뮬레이션 시각 기준 분석 데이터가 없어 표시하지 않습니다." />;
    if (!resolved && archiveState === "loading") return <Unavailable title="AI 투자 코치" message="저장된 회고를 불러오는 중입니다." />;
    if (!resolved && archiveState === "unavailable") return <Unavailable title="AI 투자 코치" message="저장된 회고를 불러올 수 없습니다. 다음 생성 후 다시 확인해 주세요." />;
    if (page === 0) return <CurrentPositionCoachPage key={resolved?.analysisId ?? "empty"} report={resolved} onOpenAlertCenter={openAlertCenter} />;
    if (page === 1) return resolved?.page2 ? <HabitCoachPage key={resolved.analysisId} viewModel={resolved.page2} /> : <Unavailable title={PAGES[1]} />;
    if (page === 2) return plan ? <ImprovementCoachPage key={resolved?.analysisId ?? "empty"} plan={plan} onExperimentStatusChange={updateExperiment} onGuardrailEnabledChange={updateGuardrail} /> : <Unavailable title={PAGES[2]} />;
    const center = resolved?.page4;
    return center ? <CoachActionCenterPage key={resolved?.analysisId ?? "empty"} center={center} focusedCandidateId={focusedAlertCandidateId} activeExperiments={plan?.experiments.filter((item) => item.status === "active")} enabledGuardrails={plan?.guardrails.filter((item) => item.enabled)} onCreateAlert={submitCandidateAlert} onWatchingAlertStatusChange={updateServerAlert} /> : <Unavailable title={PAGES[3]} />;
  })();

  return (
    <section className={styles.shell} aria-label="AI 투자 코치" data-page={page + 1}>
      <header><strong>{page === 0 ? "당일 거래" : PAGES[page]}</strong></header>
      <main ref={mainRef}><div className={styles.pageContent}>{content}</div></main>
      <footer>
        <button type="button" onClick={() => move(-1)} aria-label="이전 코칭"><ChevronLeft /></button>
        <div>{PAGES.map((label, index) => <button type="button" key={label} aria-label={`${label} 보기`} aria-current={index === page ? "page" : undefined} className={index === page ? styles.active : undefined} onClick={() => showPage(index)} />)}</div>
        <button type="button" onClick={() => move(1)} aria-label="다음 코칭"><ChevronRight /></button>
      </footer>
    </section>
  );
}

function Unavailable({ title, message = "데이터 연결 대기" }: { title: string; message?: string }) {
  return <div className={styles.placeholder} role="status"><CircleAlert /><h2>{title}</h2><p>{message}</p><small>해당 분석 데이터가 준비되면 이 페이지에 표시됩니다.</small></div>;
}
