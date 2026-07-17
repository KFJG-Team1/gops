import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { normalizeChartTradeFills, type ChartTradeFill } from "../chart/chartTradeMarkers";
import {
  latestSimulatorStatus,
  simulatorStatusEvent,
  subscribePortfolioRefresh,
  type SimulatorStatus
} from "../simulator/simulatorApi";
import type { OrderSnapshot } from "./orderClient";
import { usePaperAccount } from "./PaperAccountProvider";

type ChartTradeHistoryContextValue = {
  fills: ChartTradeFill[];
};

const ChartTradeHistoryContext = createContext<ChartTradeHistoryContextValue | undefined>(undefined);
const simulationRefreshIntervalMs = 900;

export function ChartTradeHistoryProvider({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading: authLoading } = useAuth();
  const { orders: paperOrders } = usePaperAccount();
  const canLoad = !authLoading && (!authEnabled || Boolean(user));
  const accountKey = authEnabled ? (user?.email.trim().toLowerCase() ?? "") : "auth-disabled";
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus | null>(() => latestSimulatorStatus());
  const [simulationOrders, setSimulationOrders] = useState<OrderSnapshot[]>([]);
  const statusRef = useRef<SimulatorStatus | null>(simulatorStatus);
  const requestRevisionRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const lastRequestAtRef = useRef(0);
  const statusIdentityRef = useRef("");

  useEffect(() => {
    statusRef.current = simulatorStatus;
  }, [simulatorStatus]);

  useEffect(() => {
    requestRevisionRef.current += 1;
    requestInFlightRef.current = false;
    lastRequestAtRef.current = 0;
    statusIdentityRef.current = "";
    setSimulationOrders([]);
    const loadSimulationOrders = async (force = false) => {
      const status = statusRef.current;
      if (!canLoad || status?.mode !== "simulation") return;
      const now = Date.now();
      if (requestInFlightRef.current || (!force && now - lastRequestAtRef.current < simulationRefreshIntervalMs)) {
        return;
      }
      requestInFlightRef.current = true;
      lastRequestAtRef.current = now;
      const requestRevision = ++requestRevisionRef.current;
      const requestedRunId = status.runId ?? null;
      try {
        const query = new URLSearchParams({ market: "overseas", currency: "USD", source: "active" });
        const response = await fetch(`/api/account/holdings?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `SIM 거래내역 API 오류 ${response.status}`);
        const currentStatus = statusRef.current;
        if (
          requestRevisionRef.current !== requestRevision
          || currentStatus?.mode !== "simulation"
          || (requestedRunId && currentStatus.runId !== requestedRunId)
        ) {
          return;
        }
        setSimulationOrders(Array.isArray(payload.orders) ? payload.orders : []);
      } catch {
        // Keep the last verified ledger while a transient account request is unavailable.
      } finally {
        if (requestRevisionRef.current === requestRevision) requestInFlightRef.current = false;
      }
    };

    const applyStatus = (status: SimulatorStatus) => {
      statusRef.current = status;
      setSimulatorStatus(status);
      const identity = `${status.mode}:${status.runId ?? ""}:${status.state}`;
      const identityChanged = identity !== statusIdentityRef.current;
      statusIdentityRef.current = identity;
      if (status.mode !== "simulation") {
        requestRevisionRef.current += 1;
        requestInFlightRef.current = false;
        setSimulationOrders([]);
        return;
      }
      void loadSimulationOrders(identityChanged);
    };
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      if (status) applyStatus(status);
    };
    const unsubscribeRefresh = subscribePortfolioRefresh(() => {
      void loadSimulationOrders(true);
    });
    window.addEventListener(simulatorStatusEvent, handleStatus);
    const initialStatus = latestSimulatorStatus();
    if (initialStatus) applyStatus(initialStatus);
    return () => {
      requestRevisionRef.current += 1;
      requestInFlightRef.current = false;
      unsubscribeRefresh();
      window.removeEventListener(simulatorStatusEvent, handleStatus);
    };
  }, [accountKey, canLoad]);

  const fills = useMemo(() => {
    if (simulatorStatus?.mode === "simulation") {
      const runId = simulatorStatus.runId ?? undefined;
      return normalizeChartTradeFills(simulationOrders).filter((fill) => (
        fill.source === "simulation" && (!runId || fill.runId === runId)
      ));
    }
    return normalizeChartTradeFills(paperOrders).filter((fill) => fill.source === "paper");
  }, [paperOrders, simulationOrders, simulatorStatus?.mode, simulatorStatus?.runId]);

  const value = useMemo<ChartTradeHistoryContextValue>(() => ({ fills }), [fills]);
  return <ChartTradeHistoryContext.Provider value={value}>{children}</ChartTradeHistoryContext.Provider>;
}

export function useChartTradeHistory(): ChartTradeHistoryContextValue {
  const context = useContext(ChartTradeHistoryContext);
  if (!context) throw new Error("useChartTradeHistory must be used inside ChartTradeHistoryProvider");
  return context;
}
