import { LoaderCircle, Pause, Play, Radio, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "../alerts/alertApi";
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
  type SimulatorStatus
} from "./simulatorApi";
import { simulatorBreakingNotification, simulatorPhaseNotification } from "./simulatorNotifications";


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

export function SimulatorControl({ onNotification }: { onNotification?: (notification: NotificationItem) => void }) {
  const [status, setStatus] = useState<SimulatorStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const announcedRunRef = useRef<string | null>(null);
  const announcedPhaseRef = useRef<string | null>(null);
  const previousModeRef = useRef<SimulatorStatus["mode"]>("live");
  const latestStatusRef = useRef<SimulatorStatus>(initialStatus);
  const reschedulePollRef = useRef<() => void>(() => undefined);
  const notificationHandlerRef = useRef(onNotification);
  notificationHandlerRef.current = onNotification;

  const applyStatus = (next: SimulatorStatus) => {
    latestStatusRef.current = next;
    setStatus(next);
    publishSimulatorStatus(next);
    const phaseKey = next.mode === "simulation" && next.runId ? `${next.runId}:${next.phase}` : null;
    if (phaseKey && phaseKey !== announcedPhaseRef.current) {
      announcedPhaseRef.current = phaseKey;
      if (["breaking-event", "market-close"].includes(next.phase ?? "")) {
        invalidateAnalysisAssets();
      }
      const phaseNotification = simulatorPhaseNotification(next);
      if (phaseNotification) notificationHandlerRef.current?.(phaseNotification);
    }
    if (next.mode !== "simulation") {
      announcedPhaseRef.current = null;
      announcedRunRef.current = null;
      if (previousModeRef.current === "simulation") invalidateAnalysisAssets();
    }
    previousModeRef.current = next.mode;
  };

  const announceBreakingNews = async (next: SimulatorStatus) => {
    if (!next.breakingNewsReleased || !next.runId || announcedRunRef.current === next.runId) return;
    announcedRunRef.current = next.runId;
    const article = await fetchSimulatorNews();
    if (article) notificationHandlerRef.current?.(simulatorBreakingNotification(article, next));
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
        await announceBreakingNews(next);
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
      await announceBreakingNews(next);
      reschedulePollRef.current();
      requestPortfolioRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "시연 단계 전환 실패");
    } finally {
      setBusy(false);
    }
  };

  const simulation = status.mode === "simulation";
  return (
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
            <strong title={status.phaseLabel}>{status.phaseIndex != null && status.phaseIndex >= 0 ? `${status.phaseIndex + 1}/${status.phases?.length ?? 3}` : ""} T+{formatSimulatorClock(status.elapsedSeconds)}</strong>
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
  );
}
