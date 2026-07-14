import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAlert, setAlertStatus } from "../alerts/alertApi";
import { CoachActionCenterPage } from "./ai-coach/CoachActionCenterPage";
import { CurrentPositionCoachPage } from "./ai-coach/CurrentPositionCoachPage";
import { HabitCoachPage } from "./ai-coach/HabitCoachPage";
import { ImprovementCoachPage } from "./ai-coach/ImprovementCoachPage";
import type { CoachAlertCandidate, CoachReport, ImprovementPlan, PlaybookExperiment, TradingGuardrail, WatchCondition } from "./ai-coach/types";
import styles from "./ai-coach/AiCoachShell.module.css";

const PAGES = ["당일 거래 회고", "판단 습관과 다음 원칙", "효과·보완 조건", "실행·알람 관리"] as const;
const DEV_FIXTURE_ENABLED = import.meta.env.DEV && import.meta.env.VITE_AI_COACH_DEV_FIXTURE === "true";

export function AiInvestmentCoachPanel({ report }: { report?: CoachReport | null }) {
  const [page, setPage] = useState(0);
  const [fixture, setFixture] = useState<CoachReport | null>(null);
  const [planOverride, setPlanOverride] = useState<ImprovementPlan | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    if (!report && DEV_FIXTURE_ENABLED) {
      import("./ai-coach/devFixture").then(({ AI_COACH_DEV_FIXTURE }) => {
        if (active) setFixture(AI_COACH_DEV_FIXTURE);
      });
    } else {
      setFixture(null);
    }
    return () => { active = false; };
  }, [report]);

  const resolved = report ?? fixture;
  const plan = planOverride ?? resolved?.page3 ?? null;
  useEffect(() => setPlanOverride(null), [resolved?.analysisId]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.scrollLeft = 0;
  }, [page]);

  const move = (delta: number) => setPage((current) => (current + delta + PAGES.length) % PAGES.length);
  const updateExperiment = (experimentId: PlaybookExperiment["id"], status: "active" | "paused") => {
    if (!plan) return;
    setPlanOverride({ ...plan, experiments: plan.experiments.map((item) => item.id === experimentId ? { ...item, status } : item) });
  };
  const updateGuardrail = (guardrailId: TradingGuardrail["id"], enabled: boolean) => {
    if (!plan) return;
    setPlanOverride({ ...plan, guardrails: plan.guardrails.map((item) => item.id === guardrailId ? { ...item, enabled } : item) });
  };
  const submitAlert = async (request: WatchCondition["alertRequest"]) => {
    if (!request) return false;
    await createAlert(request);
    return true;
  };
  const submitCandidateAlert = (candidate: CoachAlertCandidate) => submitAlert(candidate.alertRequest);
  const updateServerAlert = async (candidate: CoachAlertCandidate, enabled: boolean) => {
    if (!candidate.serverAlertId) return false;
    await setAlertStatus(candidate.serverAlertId, enabled ? "active" : "disabled");
    return true;
  };

  const content = (() => {
    if (page === 0) return <CurrentPositionCoachPage key={resolved?.analysisId ?? "empty"} report={resolved} onAlertRequested={(condition) => submitAlert(condition.alertRequest)} />;
    if (page === 1) return resolved?.page2 ? <HabitCoachPage key={resolved.analysisId} viewModel={resolved.page2} /> : <Unavailable title={PAGES[1]} />;
    if (page === 2) return plan ? <><ImprovementCoachPage key={resolved?.analysisId ?? "empty"} plan={plan} onExperimentStatusChange={updateExperiment} onGuardrailEnabledChange={updateGuardrail} /><p className={styles.sessionNote}>실험·가드레일 변경은 현재 패널 세션에 반영됩니다. 영구 저장 API가 연결되기 전에는 새 분석에서 초기화됩니다.</p></> : <Unavailable title={PAGES[2]} />;
    const center = resolved?.page4;
    return center ? <CoachActionCenterPage key={resolved?.analysisId ?? "empty"} center={center} activeExperiments={plan?.experiments.filter((item) => item.status === "active")} enabledGuardrails={plan?.guardrails.filter((item) => item.enabled)} onCreateAlert={submitCandidateAlert} onWatchingAlertStatusChange={updateServerAlert} /> : <Unavailable title={PAGES[3]} />;
  })();

  return (
    <section className={styles.shell} aria-label="AI 투자 코치" data-page={page + 1}>
      <header>
        <div><span>POST MARKET</span><strong>AI 투자 코치</strong>{DEV_FIXTURE_ENABLED && !report && fixture && <em>DEV FIXTURE</em>}</div>
        <b>{page + 1} / {PAGES.length}</b>
      </header>
      <main ref={mainRef}><div className={styles.pageContent}>{content}</div></main>
      <footer>
        <button type="button" onClick={() => move(-1)} aria-label="이전 코칭"><ChevronLeft /></button>
        <div>{PAGES.map((label, index) => <button type="button" key={label} aria-label={`${label} 보기`} aria-current={index === page ? "page" : undefined} className={index === page ? styles.active : undefined} onClick={() => setPage(index)} />)}</div>
        <button type="button" onClick={() => move(1)} aria-label="다음 코칭"><ChevronRight /></button>
      </footer>
    </section>
  );
}

function Unavailable({ title }: { title: string }) {
  return <div className={styles.placeholder} role="status"><CircleAlert /><h2>{title}</h2><p>데이터 연결 대기</p><small>해당 분석 데이터가 준비되면 이 페이지에 표시됩니다.</small></div>;
}
