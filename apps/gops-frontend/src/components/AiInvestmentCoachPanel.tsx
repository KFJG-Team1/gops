import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAlert, setAlertStatus } from "../alerts/alertApi";
import { CoachActionCenterPage } from "./ai-coach/CoachActionCenterPage";
import { CurrentPositionCoachPage } from "./ai-coach/CurrentPositionCoachPage";
import { HabitCoachPage } from "./ai-coach/HabitCoachPage";
import { ImprovementCoachPage } from "./ai-coach/ImprovementCoachPage";
import type { CoachAlertCandidate, ImprovementPlan, PlaybookExperiment, TradingGuardrail, WatchCondition } from "./ai-coach/types";
import styles from "./ai-coach/AiCoachShell.module.css";
import { useAiCoachRuntime } from "./ai-coach/AiCoachRuntimeProvider";

const PAGES = ["당일 거래 회고", "효과·보완 조건", "장기 습관", "실행·알람 관리"] as const;
export function AiInvestmentCoachPanel({ runtimeId }: { runtimeId: string }) {
  const {
    report: resolved,
    archiveState,
    activatePanel,
    pageForPanel,
    setPageForPanel
  } = useAiCoachRuntime();
  const page = pageForPanel(runtimeId);
  const [planOverride, setPlanOverride] = useState<ImprovementPlan | null>(null);
  const [focusedAlertCandidateId, setFocusedAlertCandidateId] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    return activatePanel();
  }, [activatePanel]);

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
    setPageForPanel(runtimeId, nextPage);
  };
  const move = (delta: number) => {
    setFocusedAlertCandidateId(null);
    setPageForPanel(runtimeId, (page + delta + PAGES.length) % PAGES.length);
  };
  const openAlertCenter = (condition: WatchCondition) => {
    setFocusedAlertCandidateId(condition.id);
    setPageForPanel(runtimeId, 3);
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
    if (!resolved && archiveState === "loading") return <Unavailable title="AI 투자 코치" message="최근 거래와 투자 습관을 정리하고 있습니다." />;
    if (!resolved && archiveState === "unavailable") return <Unavailable title="AI 투자 코치" message="아직 정리할 거래가 없습니다. 거래가 체결되면 회고를 시작합니다." />;
    if (page === 0) return <CurrentPositionCoachPage key={resolved?.analysisId ?? "empty"} report={resolved} onOpenAlertCenter={openAlertCenter} />;
    if (page === 1) return plan ? <ImprovementCoachPage key={resolved?.analysisId ?? "empty"} plan={plan} onExperimentStatusChange={updateExperiment} onGuardrailEnabledChange={updateGuardrail} /> : <Unavailable title={PAGES[1]} />;
    if (page === 2) return resolved?.page2 ? <HabitCoachPage key={resolved.analysisId} viewModel={resolved.page2} /> : <Unavailable title={PAGES[2]} />;
    const center = resolved?.page4;
    return center ? <CoachActionCenterPage key={resolved?.analysisId ?? "empty"} center={center} focusedCandidateId={focusedAlertCandidateId} activeExperiments={plan?.experiments.filter((item) => item.status === "active")} enabledGuardrails={plan?.guardrails.filter((item) => item.enabled)} onCreateAlert={submitCandidateAlert} onWatchingAlertStatusChange={updateServerAlert} /> : <Unavailable title={PAGES[3]} />;
  })();

  return (
    <section className={styles.shell} aria-label="AI 투자 코치" data-page={page + 1}>
      <header><strong>{page === 0 ? "최근 거래" : PAGES[page]}</strong></header>
      <main ref={mainRef}><div className={styles.pageContent}>{content}</div></main>
      <footer>
        <button type="button" onClick={() => move(-1)} aria-label="이전 코칭"><ChevronLeft /></button>
        <div>{PAGES.map((label, index) => <button type="button" key={label} aria-label={`${label} 보기`} aria-current={index === page ? "page" : undefined} className={index === page ? styles.active : undefined} onClick={() => showPage(index)} />)}</div>
        <button type="button" onClick={() => move(1)} aria-label="다음 코칭"><ChevronRight /></button>
      </footer>
    </section>
  );
}

function Unavailable({ title, message = "아직 충분한 거래 기록이 없습니다." }: { title: string; message?: string }) {
  return <div className={styles.placeholder} role="status"><CircleAlert /><h2>{title}</h2><p>{message}</p><small>거래 기록이 쌓이면 이 페이지에서 투자 습관과 다음 원칙을 정리해 드립니다.</small></div>;
}
