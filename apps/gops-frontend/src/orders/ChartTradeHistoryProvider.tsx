import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { normalizeChartTradeFills, type ChartTradeFill } from "../chart/chartTradeMarkers";
import {
  latestSimulatorStatus,
  simulatorStatusEvent,
  type SimulatorStatus
} from "../simulator/simulatorApi";
import { usePaperAccount } from "./PaperAccountProvider";

type ChartTradeHistoryContextValue = {
  fills: ChartTradeFill[];
};

const ChartTradeHistoryContext = createContext<ChartTradeHistoryContextValue | undefined>(undefined);

export function ChartTradeHistoryProvider({ children }: { children: ReactNode }) {
  const { orders: paperOrders } = usePaperAccount();
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus | null>(() => latestSimulatorStatus());

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      if (status) setSimulatorStatus(status);
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, []);

  const fills = useMemo(() => {
    if (simulatorStatus?.mode === "simulation") {
      const runId = simulatorStatus.runId ?? undefined;
      return normalizeChartTradeFills(paperOrders).filter((fill) => (
        fill.source === "simulation" && (!runId || fill.runId === runId)
      ));
    }
    return normalizeChartTradeFills(paperOrders).filter((fill) => fill.source === "paper");
  }, [paperOrders, simulatorStatus?.mode, simulatorStatus?.runId]);

  const value = useMemo<ChartTradeHistoryContextValue>(() => ({ fills }), [fills]);
  return <ChartTradeHistoryContext.Provider value={value}>{children}</ChartTradeHistoryContext.Provider>;
}

export function useChartTradeHistory(): ChartTradeHistoryContextValue {
  const context = useContext(ChartTradeHistoryContext);
  if (!context) throw new Error("useChartTradeHistory must be used inside ChartTradeHistoryProvider");
  return context;
}
