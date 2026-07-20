import { useCallback, useEffect, useRef, useState } from "react";
import {
  latestSimulatorStatus,
  simulatorStatusEvent,
  type SimulatorStatus
} from "../simulator/simulatorApi";
import { fetchMarketIndices, type MarketIndicesPayload } from "./indicesApi";

const FALLBACK_REFRESH_MS = 30_000;
const TRANSITION_RETRY_MS = 1_500;

type MarketIndicesSimulatorStatus = Pick<SimulatorStatus, "mode" | "runId">;
type LoadIndicesResult = "success" | "aborted" | "error";

export function shouldReloadMarketIndicesForSimulatorStatus(
  previous: MarketIndicesSimulatorStatus | null,
  next: MarketIndicesSimulatorStatus
): boolean {
  if (previous === null) {
    return next.mode === "simulation";
  }
  return previous.mode !== next.mode
    || (next.mode === "simulation" && previous.runId !== next.runId);
}

export function useMarketIndices() {
  const [payload, setPayload] = useState<MarketIndicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const payloadRef = useRef<MarketIndicesPayload | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const transitionRetryRef = useRef<number | null>(null);
  const previousSimulatorStatusRef = useRef<MarketIndicesSimulatorStatus | null>(latestSimulatorStatus());

  const clearTransitionRetry = useCallback(() => {
    if (transitionRetryRef.current === null) {
      return;
    }
    window.clearTimeout(transitionRetryRef.current);
    transitionRetryRef.current = null;
  }, []);

  const loadIndices = useCallback(async (showRefreshing = false): Promise<LoadIndicesResult> => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestSequence = ++requestSequenceRef.current;
    if (showRefreshing && payloadRef.current !== null) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const nextPayload = await fetchMarketIndices(controller.signal);
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) {
        return "aborted";
      }
      clearTransitionRetry();
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      return "success";
    } catch (caught) {
      if (
        controller.signal.aborted
        || (caught instanceof DOMException && caught.name === "AbortError")
        || requestSequence !== requestSequenceRef.current
      ) {
        return "aborted";
      }
      setError(caught instanceof Error ? caught.message : "지수 데이터를 불러오지 못했습니다.");
      return "error";
    } finally {
      if (!controller.signal.aborted && requestSequence === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
        activeRequestRef.current = null;
      }
    }
  }, [clearTransitionRetry]);

  const reloadForSimulatorTransition = useCallback(() => {
    clearTransitionRetry();
    void loadIndices(true).then((result) => {
      if (result !== "error") {
        return;
      }
      transitionRetryRef.current = window.setTimeout(() => {
        transitionRetryRef.current = null;
        void loadIndices(true);
      }, TRANSITION_RETRY_MS);
    });
  }, [clearTransitionRetry, loadIndices]);

  useEffect(() => {
    void loadIndices();
    return () => {
      activeRequestRef.current?.abort();
      clearTransitionRetry();
    };
  }, [clearTransitionRetry, loadIndices]);

  useEffect(() => {
    const handleSimulatorStatus = (event: Event) => {
      const next = (event as CustomEvent<SimulatorStatus>).detail;
      if (!next) {
        return;
      }
      const previous = previousSimulatorStatusRef.current;
      previousSimulatorStatusRef.current = next;
      if (shouldReloadMarketIndicesForSimulatorStatus(previous, next)) {
        reloadForSimulatorTransition();
      }
    };
    window.addEventListener(simulatorStatusEvent, handleSimulatorStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleSimulatorStatus);
  }, [reloadForSimulatorTransition]);

  const refreshMs = Math.max(10_000, (payload?.refreshSeconds ?? FALLBACK_REFRESH_MS / 1000) * 1000);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadIndices(true);
    }, refreshMs);
    return () => window.clearInterval(intervalId);
  }, [loadIndices, refreshMs]);

  const reload = useCallback((showRefreshing = true) => loadIndices(showRefreshing), [loadIndices]);
  const visibleError = payload === null ? error : undefined;
  const warning = payload !== null && error ? error : visibleMarketIndicesWarning(payload?.warning);

  return { payload, loading, refreshing, error: visibleError, warning, reload };
}

function visibleMarketIndicesWarning(warning: string | undefined): string | undefined {
  if (!warning) {
    return undefined;
  }
  if (
    warning === "Refresh already in progress; serving the last successful snapshot." ||
    warning === "Refreshing in background; serving the last successful snapshot."
  ) {
    return undefined;
  }
  return warning;
}
