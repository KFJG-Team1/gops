import { Clock3, LayoutPanelLeft, LoaderCircle, MoonStar, Pause, Play, Radio, RotateCcw, SkipForward, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentLayoutProposal } from "../layout/agentLayoutTypes";
import { buildUiProposalLayoutProposal } from "../layout/uiProposalLayout";
import { invalidateAnalysisAssets } from "../chart/analysisAssetsApi";
import {
  fetchSimulatorNews,
  fetchSimulatorStatus,
  formatSimulatorClock,
  publishSimulatorStatus,
  requestPortfolioRefresh,
  runSimulatorAction,
  setSimulatorMode,
  setSimulatorPhase,
  simulatorStatusPollIntervalMs,
  type SimulatorNewsArticle,
  type SimulatorStatus
} from "./simulatorApi";


const initialStatus: SimulatorStatus = {
  available: false,
  mode: "live",
  state: "idle",
  elapsedSeconds: 0,
  durationSeconds: 300,
  breakingNewsAtSeconds: 210,
  breakingNewsReleased: false,
  symbols: []
};

type SimulatorPhaseNotice = {
  phase: "market-open" | "market-close";
  title: string;
  message: string;
};

export function SimulatorControl({ onApplyLayoutProposal }: { onApplyLayoutProposal?: (proposal: AgentLayoutProposal) => void }) {
  const [status, setStatus] = useState<SimulatorStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [article, setArticle] = useState<SimulatorNewsArticle | null>(null);
  const [phaseNotice, setPhaseNotice] = useState<SimulatorPhaseNotice | null>(null);
  const announcedRunRef = useRef<string | null>(null);
  const announcedPhaseRef = useRef<string | null>(null);
  const previousModeRef = useRef<SimulatorStatus["mode"]>("live");
  const latestStatusRef = useRef<SimulatorStatus>(initialStatus);
  const reschedulePollRef = useRef<() => void>(() => undefined);

  const applyStatus = (next: SimulatorStatus) => {
    latestStatusRef.current = next;
    setStatus(next);
    publishSimulatorStatus(next);
    const phaseKey = next.mode === "simulation" && next.runId ? `${next.runId}:${next.phase}` : null;
    if (phaseKey && phaseKey !== announcedPhaseRef.current) {
      announcedPhaseRef.current = phaseKey;
      if (["chart-analysis", "order-ready", "market-open", "breaking-event"].includes(next.phase ?? "")) {
        invalidateAnalysisAssets("IFF");
      }
      if (next.phase === "market-open") {
        setPhaseNotice({ phase: "market-open", title: "본장 시작", message: "시뮬레이션 본장이 시작되었습니다. 체결·호가·풋프린트를 확인하세요." });
      } else if (next.phase === "market-close") {
        setPhaseNotice({ phase: "market-close", title: "본장 종료", message: "오늘의 가상 주문과 알림을 확인하고 투자 리포트로 복기하세요." });
      }
    }
    if (next.mode !== "simulation") {
      announcedPhaseRef.current = null;
      if (previousModeRef.current === "simulation") invalidateAnalysisAssets("IFF");
      setPhaseNotice(null);
    }
    previousModeRef.current = next.mode;
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let activeController: AbortController | null = null;
    let inFlight = false;
    let refreshWhenIdle = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = () => {
      clearTimer();
      if (cancelled || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, simulatorStatusPollIntervalMs(latestStatusRef.current));
    };

    const refresh = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (inFlight) {
        refreshWhenIdle = true;
        return;
      }
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      try {
        const next = await fetchSimulatorStatus(controller.signal);
        if (cancelled) return;
        applyStatus(next);
        setError(undefined);
        if (next.breakingNewsReleased && next.runId && announcedRunRef.current !== next.runId) {
          announcedRunRef.current = next.runId;
          const breaking = await fetchSimulatorNews();
          if (!cancelled) setArticle(breaking);
        }
        if (next.mode !== "simulation") {
          announcedRunRef.current = null;
          setArticle(null);
        }
      } catch (caught) {
        if (!cancelled && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "시뮬레이터 연결 실패");
        }
      } finally {
        if (activeController === controller) activeController = null;
        inFlight = false;
        if (refreshWhenIdle) {
          refreshWhenIdle = false;
          void refresh();
        } else {
          schedule();
        }
      }
    };

    const refreshNow = () => {
      clearTimer();
      if (inFlight) {
        refreshWhenIdle = true;
        return;
      }
      void refresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        activeController?.abort();
        return;
      }
      refreshNow();
    };

    reschedulePollRef.current = schedule;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    refreshNow();
    return () => {
      cancelled = true;
      reschedulePollRef.current = () => undefined;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimer();
      activeController?.abort();
    };
  }, []);

  const changeMode = async () => {
    if (!status.available || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await setSimulatorMode(status.mode === "simulation" ? "live" : "simulation");
      applyStatus(next);
      reschedulePollRef.current();
      requestPortfolioRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "모드 전환 실패");
    } finally {
      setBusy(false);
    }
  };

  const controlRun = async (action: "pause" | "resume" | "restart") => {
    setBusy(true);
    try {
      if (action === "restart") {
        announcedRunRef.current = null;
        announcedPhaseRef.current = null;
        setArticle(null);
        setPhaseNotice(null);
      }
      const next = await runSimulatorAction(action);
      applyStatus(next);
      reschedulePollRef.current();
      requestPortfolioRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "시뮬레이터 제어 실패");
    } finally {
      setBusy(false);
    }
  };

  const moveToNextPhase = async () => {
    if (!status.nextPhase || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await setSimulatorPhase(status.nextPhase);
      applyStatus(next);
      reschedulePollRef.current();
      requestPortfolioRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "시연 단계 전환 실패");
    } finally {
      setBusy(false);
    }
  };

  const applyResponseLayout = () => {
    const proposal = buildUiProposalLayoutProposal([
      { panelType: "portfolioHoldings", action: "open" },
      { panelType: "chart", action: "open", symbol: "AMD" },
      { panelType: "paperAccount", action: "open" },
      { panelType: "priceCondition", action: "open", symbol: "AMD" },
      { panelType: "orderFlowProfile", action: "open", symbol: "OKE" }
    ], {
      title: "이벤트 대응 레이아웃",
      rationale: "AMD 위험 관리와 OKE 수혜 시나리오를 한 화면에서 확인합니다."
    });
    if (proposal) onApplyLayoutProposal?.(proposal);
  };

  const simulation = status.mode === "simulation";
  return (
    <>
      <div className={`simulator-mode-control ${simulation ? "is-simulation" : ""}`} title={error || status.detail}>
        <button
          type="button"
          className="simulator-mode-toggle"
          aria-label={simulation ? "LIVE 모드로 전환" : "SIMULATION 시작"}
          disabled={!status.available || busy}
          onClick={changeMode}
        >
          {busy ? <LoaderCircle size={12} className="spin" /> : <Radio size={12} />}
          <span>{simulation ? "SIM" : status.available ? "LIVE" : "SIM OFFLINE"}</span>
          <i aria-hidden="true" />
        </button>
        {simulation && (
          <div className="simulator-run-controls">
            <strong title={status.phaseLabel}>{status.phaseIndex != null && status.phaseIndex >= 0 ? `${status.phaseIndex + 1}/${status.phases?.length ?? 8}` : ""} T+{formatSimulatorClock(status.elapsedSeconds)}</strong>
            <button
              type="button"
              aria-label={status.state === "paused" ? "시뮬레이션 계속" : "시뮬레이션 일시정지"}
              onClick={() => void controlRun(status.state === "paused" ? "resume" : "pause")}
            >
              {status.state === "paused" ? <Play size={11} /> : <Pause size={11} />}
            </button>
            <button type="button" aria-label="시뮬레이션 재시작" onClick={() => void controlRun("restart")}>
              <RotateCcw size={11} />
            </button>
            <button
              type="button"
              aria-label="다음 시연 단계"
              title={status.nextPhase ? `다음: ${status.phases?.find((phase) => phase.id === status.nextPhase)?.label ?? status.nextPhase}` : "마지막 단계"}
              disabled={!status.nextPhase || busy}
              onClick={() => void moveToNextPhase()}
            >
              <SkipForward size={11} />
            </button>
          </div>
        )}
      </div>
      {article && (
        <aside className="simulator-breaking-toast" role="alert" aria-label="시뮬레이션 속보">
          <span className="simulator-breaking-kicker"><TriangleAlert size={13} /> BREAKING · SIMULATION</span>
          <button
            type="button"
            className="simulator-breaking-copy"
            onClick={() => article.url && window.open(article.url, "_blank", "noopener,noreferrer")}
          >
            <strong>{article.headline}</strong>
            <span>{article.summary}</span>
            <small>{article.source ?? "GOPS Simulator"} · {article.url ? "기사 열기" : "실제 뉴스 아님"}</small>
          </button>
          {onApplyLayoutProposal && (
            <button type="button" className="simulator-layout-button" onClick={applyResponseLayout}>
              <LayoutPanelLeft size={13} />
              대응 레이아웃 적용
            </button>
          )}
          <button type="button" className="simulator-breaking-close" aria-label="속보 닫기" onClick={() => setArticle(null)}>
            <X size={14} />
          </button>
        </aside>
      )}
      {phaseNotice && (
        <aside className={`simulator-phase-toast is-${phaseNotice.phase}`} role="status" aria-live="polite">
          <span aria-hidden="true">{phaseNotice.phase === "market-open" ? <Clock3 size={16} /> : <MoonStar size={16} />}</span>
          <div><strong>{phaseNotice.title}</strong><p>{phaseNotice.message}</p></div>
          <button type="button" aria-label={`${phaseNotice.title} 알림 닫기`} onClick={() => setPhaseNotice(null)}><X size={13} /></button>
        </aside>
      )}
    </>
  );
}
