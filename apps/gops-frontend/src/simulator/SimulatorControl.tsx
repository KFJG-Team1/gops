import { LoaderCircle, Pause, Play, Radio, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  fetchSimulatorNews,
  fetchSimulatorStatus,
  formatSimulatorClock,
  publishSimulatorStatus,
  requestChartRefreshAfterRollback,
  requestPortfolioRefresh,
  rollbackLatestSimulation,
  runSimulatorAction,
  setSimulatorMode,
  type SimulatorNewsArticle,
  type SimulatorStatus
} from "./simulatorApi";


const initialStatus: SimulatorStatus = {
  available: false,
  mode: "live",
  state: "idle",
  elapsedSeconds: 0,
  durationSeconds: 300,
  breakingNewsAtSeconds: 5,
  breakingNewsReleased: false,
  symbols: []
};

export function SimulatorControl() {
  const [status, setStatus] = useState<SimulatorStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [article, setArticle] = useState<SimulatorNewsArticle | null>(null);
  const announcedRunRef = useRef<string | null>(null);

  const applyStatus = (next: SimulatorStatus) => {
    setStatus(next);
    publishSimulatorStatus(next);
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const refresh = async () => {
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
        if (!cancelled) setError(caught instanceof Error ? caught.message : "시뮬레이터 연결 실패");
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 250);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const changeMode = async () => {
    if (!status.available || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await setSimulatorMode(status.mode === "simulation" ? "live" : "simulation");
      applyStatus(next);
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
        setArticle(null);
      }
      const next = await runSimulatorAction(action);
      applyStatus(next);
      requestPortfolioRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "시뮬레이터 제어 실패");
    } finally {
      setBusy(false);
    }
  };

  const rollbackRun = async () => {
    if (rollbackBusy || status.rollbackState === "completed") return;
    setRollbackBusy(true);
    setError(undefined);
    setStatus((current) => ({
      ...current,
      rollbackState: "running",
      rollbackDetail: "원복 중"
    }));
    try {
      const result = await rollbackLatestSimulation();
      setStatus((current) => {
        const next = { ...current, ...result };
        publishSimulatorStatus(next);
        return next;
      });
      requestPortfolioRefresh();
      requestChartRefreshAfterRollback();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "원복 실패";
      setStatus((current) => ({
        ...current,
        rollbackState: "failed",
        rollbackDetail: message
      }));
      setError(message);
    } finally {
      setRollbackBusy(false);
    }
  };

  const simulation = status.mode === "simulation";
  const rollbackVisible = Boolean(status.lastRunId)
    && (status.state === "completed" || !simulation || status.rollbackState !== "available");
  const rollbackRunning = rollbackBusy || status.rollbackState === "running";
  const rollbackCompleted = status.rollbackState === "completed";
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
            <strong>T+{formatSimulatorClock(status.elapsedSeconds)}</strong>
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
          </div>
        )}
        {rollbackVisible && (
          <button
            type="button"
            className={`simulator-rollback-button is-${status.rollbackState ?? "available"}`}
            disabled={rollbackRunning || rollbackCompleted || (simulation && status.state !== "completed")}
            onClick={() => void rollbackRun()}
            title={status.rollbackDetail ?? "시뮬레이션에서 생성한 틱과 봉을 원복합니다"}
          >
            {rollbackRunning ? <LoaderCircle size={11} className="spin" /> : <RotateCcw size={11} />}
            <span>{rollbackRunning ? "원복 중" : rollbackCompleted ? "원복 완료" : "봉 되돌리기"}</span>
          </button>
        )}
      </div>
      {article && (
        <aside className="simulator-breaking-toast" role="alert" aria-label="시뮬레이션 속보">
          <span className="simulator-breaking-kicker">BREAKING · SIMULATION T+00:05</span>
          <button
            type="button"
            className="simulator-breaking-copy"
            onClick={() => article.url && window.open(article.url, "_blank", "noopener,noreferrer")}
          >
            <strong>{article.headline}</strong>
            <span>{article.summary}</span>
            <small>{article.source ?? "GOPS Simulator"} · 기사 열기</small>
          </button>
          <button type="button" className="simulator-breaking-close" aria-label="속보 닫기" onClick={() => setArticle(null)}>
            <X size={14} />
          </button>
        </aside>
      )}
    </>
  );
}
