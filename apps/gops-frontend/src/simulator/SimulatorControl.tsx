import { LoaderCircle, Pause, Play, Radio, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  fetchSimulatorNews,
  fetchSimulatorStatus,
  formatSimulatorClock,
  publishSimulatorStatus,
  requestPortfolioRefresh,
  runSimulatorAction,
  setSimulatorMode,
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
  breakingNewsAtSeconds: 5,
  breakingNewsReleased: false,
  symbols: []
};

export function SimulatorControl() {
  const [status, setStatus] = useState<SimulatorStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [article, setArticle] = useState<SimulatorNewsArticle | null>(null);
  const announcedRunRef = useRef<string | null>(null);
  const latestStatusRef = useRef<SimulatorStatus>(initialStatus);
  const reschedulePollRef = useRef<() => void>(() => undefined);

  const applyStatus = (next: SimulatorStatus) => {
    latestStatusRef.current = next;
    setStatus(next);
    publishSimulatorStatus(next);
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
        setArticle(null);
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
