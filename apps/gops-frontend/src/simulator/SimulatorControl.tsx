import { LoaderCircle, Pause, Play, Radio, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invalidateAnalysisAssets } from "../chart/analysisAssetsApi";
import { invalidateChartDerivedCaches } from "../chart/cdcClient";
import {
  fetchSimulatorStatus,
  formatSimulatorVirtualTime,
  publishSimulatorStatus,
  requestPortfolioRefresh,
  runSimulatorAction,
  setSimulatorMode,
  setSimulatorSpeed,
  simulatorPrimaryAction,
  simulatorSpeeds,
  simulatorStatusPollIntervalMs,
  type SimulatorSpeed,
  type SimulatorStatus
} from "./simulatorApi";


const initialStatus: SimulatorStatus = {
  available: false,
  canControl: false,
  mode: "live",
  state: "idle",
  datasetId: "sp500-full-20260715-kst-v3",
  runId: null,
  virtualTime: "2026-07-15T00:00:00+09:00",
  startTime: "2026-07-15T00:00:00+09:00",
  endTime: "2026-07-16T00:00:00+09:00",
  requestedSpeed: 1,
  effectiveSpeed: 0,
  processedEventCount: 0,
  totalEventCount: 0,
  progress: 0,
  lagMs: 0,
  symbols: []
};

export function SimulatorControl() {
  const [status, setStatus] = useState<SimulatorStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const previousModeRef = useRef<SimulatorStatus["mode"]>("live");
  const latestStatusRef = useRef<SimulatorStatus>(initialStatus);
  const reschedulePollRef = useRef<() => void>(() => undefined);

  const applyStatus = (next: SimulatorStatus) => {
    const modeChanged = previousModeRef.current !== next.mode;
    const runChanged = latestStatusRef.current.runId !== next.runId;
    latestStatusRef.current = next;
    setStatus(next);
    publishSimulatorStatus(next);
    if (modeChanged || runChanged) {
      invalidateAnalysisAssets();
      invalidateChartDerivedCaches();
      requestPortfolioRefresh();
    }
    previousModeRef.current = next.mode;
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (cancelled || document.visibilityState === "hidden") return;
      timer = window.setTimeout(refresh, simulatorStatusPollIntervalMs(latestStatusRef.current));
    };
    const refresh = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      try {
        applyStatus(await fetchSimulatorStatus(controller.signal));
        setError(undefined);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "시뮬레이터 연결 실패");
      } finally {
        schedule();
      }
    };
    const visibility = () => document.visibilityState === "hidden" ? (clearTimer(), controller?.abort()) : void refresh();
    reschedulePollRef.current = schedule;
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => {
      cancelled = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const execute = async (request: () => Promise<SimulatorStatus>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      applyStatus(await request());
      reschedulePollRef.current();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const simulation = status.mode === "simulation";
  const primaryAction = simulatorPrimaryAction(status);
  const primaryLabel = primaryAction === "start"
    ? "시뮬레이션 시작 및 재생"
    : primaryAction === "resume"
      ? "시뮬레이션 재생"
      : "시뮬레이션 일시정지";
  const progress = Math.max(0, Math.min(100, status.progress * 100));
  return (
    <div
      className={`simulator-mode-control ${simulation ? "is-simulation" : ""}`}
      title={error || status.detail || (!status.canControl ? "시뮬레이터 제어 권한이 없습니다." : undefined)}
    >
      <button
        type="button"
        className="simulator-mode-toggle"
        aria-label={simulation ? "LIVE 모드로 전환" : "LIVE 모드"}
        disabled={!status.available || !status.canControl || busy || !simulation}
        onClick={() => {
          if (simulation) void execute(() => setSimulatorMode("live"), "모드 전환 실패");
        }}
      >
        {busy ? <LoaderCircle size={12} className="spin" /> : <Radio size={12} />}
        <span>{simulation ? "SIM" : status.available ? "LIVE" : "SIM OFFLINE"}</span>
        <i aria-hidden="true" />
      </button>
      {status.available && status.canControl && (
        <div className="simulator-run-controls">
          {simulation && (
            <>
              <strong title={`${status.datasetId} · ${progress.toFixed(2)}%`}>
                {formatSimulatorVirtualTime(status.virtualTime)} · {progress.toFixed(1)}%
              </strong>
              <select
                aria-label="시뮬레이션 배속"
                value={status.requestedSpeed}
                disabled={busy || status.state === "completed"}
                onChange={(event) => void execute(
                  () => setSimulatorSpeed(Number(event.target.value) as SimulatorSpeed),
                  "배속 변경 실패"
                )}
              >
                {simulatorSpeeds.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
              </select>
            </>
          )}
          <button
            type="button"
            aria-label={primaryLabel}
            disabled={busy || (simulation && status.state === "completed")}
            onClick={() => void execute(
              () => runSimulatorAction(simulatorPrimaryAction(status)),
              "시뮬레이터 제어 실패"
            )}
          >
            {primaryAction === "pause" ? <Pause size={11} /> : <Play size={11} />}
          </button>
          {simulation && (
            <>
              <button
                type="button"
                aria-label="시뮬레이션 재시작"
                disabled={busy}
                onClick={() => void execute(() => runSimulatorAction("restart"), "시뮬레이터 재시작 실패")}
              >
                <RotateCcw size={11} />
              </button>
              <span className="simulator-effective-speed" title={`처리 지연 ${status.lagMs}ms`}>
                실효 {status.effectiveSpeed.toFixed(1)}×
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
