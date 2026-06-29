import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MarketTicker } from "./components/MarketTicker";
import { TopAppBar } from "./components/TopAppBar";
import { initialAgentOptions, type AgentOption, type AgentUpdatePatch, type SystemMenuTab, type SystemMode } from "./components/SystemArea";
import { WorkspaceGrid } from "./components/WorkspaceGrid";
import {
  DEFAULT_AGENT_DRAFT_SEED,
  isAgentChartReferenceAvailable,
  type AgentChartReference
} from "@gops/chart-engine/agentReference";
import { makeChartCommand } from "@gops/chart-engine/commands";
import {
  chartRuntimeReducer,
  createInitialChartRuntimeState,
  getChartDocumentForPanel,
  type ChartRuntimeAction
} from "@gops/chart-engine/runtime";
import { DEFAULT_CHART_SYMBOL, getSymbolMeta, normalizeSupportedSymbol, normalizeWatchlistPayload, type SupportedSymbol, type WatchlistSymbol } from "@gops/chart-engine/symbols";
import {
  createInitialRuntimeState,
  executeCommand,
  makeCommand
} from "./layout/commands";
import { findTargetChartPanel } from "./layout/chartPanelSelection";
import type { LayoutCommand, LayoutRuntimeState } from "./layout/types";

type RuntimeAction =
  | { kind: "command"; command: LayoutCommand };

function mergeSymbolRecords(current: WatchlistSymbol[], incoming: WatchlistSymbol[]): WatchlistSymbol[] {
  const bySymbol = new Map(current.map((item) => [item.symbol, item]));
  for (const item of incoming) {
    bySymbol.set(item.symbol, { ...bySymbol.get(item.symbol), ...item });
  }
  return Array.from(bySymbol.values());
}

function refreshWatchlistRecords(current: WatchlistSymbol[], incoming: WatchlistSymbol[]): WatchlistSymbol[] {
  const incomingBySymbol = new Map(incoming.map((item) => [item.symbol, item]));
  return current.map((item) => ({ ...item, ...incomingBySymbol.get(item.symbol) }));
}

function runtimeReducer(state: LayoutRuntimeState, action: RuntimeAction): LayoutRuntimeState {
  return executeCommand(state, action.command);
}

export default function App() {
  const [state, dispatch] = useReducer(runtimeReducer, undefined, createInitialRuntimeState);
  const [chartRuntime, chartDispatch] = useReducer(chartRuntimeReducer, undefined, createInitialChartRuntimeState);
  const [activeSystemMode, setActiveSystemMode] = useState<SystemMode>("watchlist");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [settingsTab, setSettingsTab] = useState<SystemMenuTab>("layouts");
  const [agents, setAgents] = useState<AgentOption[]>(initialAgentOptions);
  const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
  const [activeSymbol, setActiveSymbol] = useState<SupportedSymbol>(DEFAULT_CHART_SYMBOL);
  const [symbolSearchError, setSymbolSearchError] = useState<string | undefined>();
  const [watchlistSymbols, setWatchlistSymbols] = useState<WatchlistSymbol[]>([]);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolSearchRefreshKey, setSymbolSearchRefreshKey] = useState(0);
  const [symbolOptions, setSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [knownSymbols, setKnownSymbols] = useState<WatchlistSymbol[]>([]);
  const [agentChartReference, setAgentChartReference] = useState<AgentChartReference | undefined>();
  const watchlistSeedAppliedRef = useRef(false);
  const watchlistEditedRef = useRef(false);
  const userSelectedSymbolRef = useRef(false);

  const selectedPanel = useMemo(
    () => state.layout.panels.find((panel) => panel.id === state.layout.selectedPanelId),
    [state.layout.panels, state.layout.selectedPanelId]
  );

  const runCommand = useCallback((command: LayoutCommand) => dispatch({ kind: "command", command }), []);
  const runChartAction = useCallback((action: ChartRuntimeAction) => chartDispatch(action), []);

  useEffect(() => {
    chartDispatch({ kind: "chart.ensureDocuments", panels: state.layout.panels });
  }, [state.layout.panels]);

  useEffect(() => {
    if (agentChartReference && !isAgentChartReferenceAvailable(state.layout.panels, agentChartReference)) {
      setAgentChartReference(undefined);
    }
  }, [agentChartReference, state.layout.panels]);

  useEffect(() => {
    let cancelled = false;

    const loadWatchlist = () => {
      fetch("/api/charts/symbols")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`종목 API 응답 오류 ${response.status}`);
          }
          return response.json() as Promise<unknown>;
        })
        .then((payload) => {
          if (!cancelled) {
            const symbols = normalizeWatchlistPayload(payload);
            setWatchlistSymbols((current) => {
              if (!watchlistEditedRef.current) {
                return symbols;
              }
              return refreshWatchlistRecords(current, symbols);
            });
            setSymbolOptions((current) => current.length > 0 ? current : symbols);
            setKnownSymbols((current) => mergeSymbolRecords(current, symbols));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setWatchlistSymbols((current) => current);
            setSymbolOptions((current) => current);
          }
        });
    };

    loadWatchlist();
    const timer = window.setInterval(loadWatchlist, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const query = symbolSearchQuery.trim();

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: query ? "20" : "100" });

    fetch(`/api/market/symbols/search?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`종목 검색 API 응답 오류 ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) {
          const symbols = normalizeWatchlistPayload(payload);
          setSymbolOptions(symbols);
          setKnownSymbols((current) => mergeSymbolRecords(current, symbols));
        }
      })
      .catch(() => {
        if (!cancelled) {
          const normalizedQuery = query.toUpperCase();
          setSymbolOptions(watchlistSymbols.filter((item) =>
            item.symbol.includes(normalizedQuery) || item.name.toUpperCase().includes(normalizedQuery)
          ));
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbolSearchQuery, symbolSearchRefreshKey, watchlistSymbols]);

  const activeChartPanel = useMemo(
    () => findTargetChartPanel(state.layout.panels, state.layout.selectedPanelId),
    [state.layout.panels, state.layout.selectedPanelId]
  );

  const activeChartDocument = useMemo(
    () => activeChartPanel ? getChartDocumentForPanel(chartRuntime, activeChartPanel) : null,
    [activeChartPanel, chartRuntime]
  );

  const symbolUniverse = useMemo(
    () => Array.from(new Set(knownSymbols.map((item) => item.symbol))),
    [knownSymbols]
  );

  const toggleWatchlistSymbol = useCallback((symbolValue: string) => {
    const symbol = normalizeSupportedSymbol(symbolValue);
    if (!symbol) {
      return;
    }

    watchlistEditedRef.current = true;
    setWatchlistSymbols((current) => {
      if (current.some((item) => item.symbol === symbol)) {
        return current.filter((item) => item.symbol !== symbol);
      }

      const known = knownSymbols.find((item) => item.symbol === symbol);
      const fallback = getSymbolMeta(symbol);
      return [
        ...current,
        known ?? {
          symbol,
          name: fallback.name,
          market: fallback.market
        }
      ];
    });
  }, [knownSymbols]);

  const refreshSymbolOptions = useCallback((query: string) => {
    setSymbolSearchQuery(query);
    setSymbolSearchRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const normalized = activeChartDocument ? normalizeSupportedSymbol(activeChartDocument.symbol) : null;
    if (normalized && normalized !== activeSymbol) {
      setActiveSymbol(normalized);
    }
  }, [activeChartDocument?.symbol, activeSymbol]);

  const selectSymbol = useCallback((value: string, options?: { source?: "system" | "user" }): boolean => {
    const symbol = normalizeSupportedSymbol(value);
    if (!symbol) {
      setSymbolSearchError("유효한 종목 코드를 입력하세요.");
      return false;
    }

    if (options?.source !== "system") {
      userSelectedSymbolRef.current = true;
    }
    setActiveSymbol(symbol);
    setSymbolSearchError(undefined);

    const chartPanel = findTargetChartPanel(state.layout.panels, state.layout.selectedPanelId);
    if (!chartPanel) {
      return true;
    }

    const chartDocument = getChartDocumentForPanel(chartRuntime, chartPanel);
    chartDispatch({ kind: "chart.ensureDocuments", panels: state.layout.panels });
    chartDispatch({
      kind: "chart.command",
      command: makeChartCommand("chart.symbol.set", "user", {
        panelId: chartPanel.id,
        chartDocumentId: chartDocument.id
      }, { symbol }, undefined, "external")
    });
    return true;
  }, [chartRuntime, state.layout.panels, state.layout.selectedPanelId]);

  useEffect(() => {
    if (watchlistSeedAppliedRef.current || userSelectedSymbolRef.current || watchlistSymbols.length === 0) {
      return;
    }

    watchlistSeedAppliedRef.current = true;
    if (!watchlistSymbols.some((item) => item.symbol === activeSymbol)) {
      selectSymbol(watchlistSymbols[0].symbol, { source: "system" });
    }
  }, [activeSymbol, selectSymbol, watchlistSymbols]);

  const closeSystemPanel = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setActiveSystemMode("watchlist");
  };

  const toggleSettings = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setSettingsTab("layouts");
    setActiveSystemMode((current) => (current === "settings" ? "watchlist" : "settings"));
  };

  const toggleNotifications = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setActiveSystemMode((current) => (current === "notifications" ? "watchlist" : "notifications"));
  };

  const togglePrimaryAgent = () => {
    const primaryAgentId = "agent-01";
    const primaryAgentActive = activeSystemMode === "agents" && selectedAgentIds.includes(primaryAgentId);

    setEditingAgentId(undefined);
    if (primaryAgentActive) {
      setSelectedAgentIds([]);
      setAgentChartReference(undefined);
      setActiveSystemMode("watchlist");
      return;
    }

    setSelectedAgentIds([primaryAgentId]);
    setAgentChartReference(undefined);
    setActiveSystemMode("agents");
  };

  const updateAgent = (agentId: string, patch: AgentUpdatePatch) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)));
  };

  const askAgentFromChart = useCallback((panelId: string, chartDocumentId: string) => {
    setSelectedAgentIds(["agent-01"]);
    setAgentChartReference({ panelId, chartDocumentId, draftSeed: DEFAULT_AGENT_DRAFT_SEED });
    setEditingAgentId(undefined);
    setActiveSystemMode("agents");
  }, []);

  const addAgent = () => {
    setAgents((current) => {
      if (current.length >= 4) {
        return current;
      }

      const usedNumbers = new Set(
        current
          .map((agent) => Number(agent.id.replace("agent-", "")))
          .filter((value) => Number.isFinite(value))
      );
      const nextNumber = [1, 2, 3, 4].find((value) => !usedNumbers.has(value)) ?? current.length + 1;
      return [
        ...current,
        {
          id: `agent-${String(nextNumber).padStart(2, "0")}`,
          label: `AI ${String(nextNumber).padStart(2, "0")}`,
          description: "새 작업 보조 AI입니다.",
          iconUrl: `/assets/agent-icons/agent-${String(nextNumber).padStart(2, "0")}.svg`
        }
      ];
    });
  };

  const deleteAgent = (agentId: string) => {
    setAgents((current) => current.filter((agent) => agent.id !== agentId));
    setSelectedAgentIds((current) => {
      const next = current.filter((id) => id !== agentId);
      setActiveSystemMode((mode) => (mode === "agents" ? (next.length === 0 ? "watchlist" : "agents") : mode));
      return next;
    });
    setEditingAgentId(undefined);
  };

  return (
    <main className="app-shell">
      <TopAppBar
        aiActive={activeSystemMode === "agents" && selectedAgentIds.includes("agent-01")}
        settingsActive={activeSystemMode === "settings"}
        notificationsActive={activeSystemMode === "notifications"}
        activeSymbol={activeSymbol}
        symbolOptions={symbolOptions}
        symbolSearchError={symbolSearchError}
        onToggleNotifications={toggleNotifications}
        onTogglePrimaryAgent={togglePrimaryAgent}
        onToggleSettings={toggleSettings}
        onSymbolQueryChange={setSymbolSearchQuery}
        onSymbolOptionsRequest={refreshSymbolOptions}
        onSymbolSearch={selectSymbol}
        onCommand={runCommand}
      />

      <section className="workspace-area" aria-label="GOPS 작업 화면">
        <WorkspaceGrid
          layout={state.layout}
          selectedPanelId={selectedPanel?.id}
          systemMode={activeSystemMode}
          settingsTab={settingsTab}
          agents={agents}
          selectedAgentIds={selectedAgentIds}
          referencedChartTarget={agentChartReference}
          editingAgentId={editingAgentId}
          savedLayouts={state.savedLayouts}
          activeSymbol={activeSymbol}
          watchlistSymbols={watchlistSymbols}
          knownSymbols={knownSymbols}
          symbolUniverse={symbolUniverse}
          backfillEligibleSymbols={symbolUniverse}
          chartRuntime={chartRuntime}
          chartAutoApplyEnabled={state.layout.settings.llmLayoutAutoApply}
          onSettingsTabChange={setSettingsTab}
          onEditAgent={setEditingAgentId}
          onUpdateAgent={updateAgent}
          onAddAgent={addAgent}
          onDeleteAgent={deleteAgent}
          onCloseSystemPanel={closeSystemPanel}
          onSelectSymbol={selectSymbol}
          onCommand={runCommand}
          onChartAction={runChartAction}
          onAskAgentFromChart={askAgentFromChart}
          onToggleWatchlistSymbol={toggleWatchlistSymbol}
        />
      </section>

      <MarketTicker />
    </main>
  );
}

export function command(type: Parameters<typeof makeCommand>[0], payload: Record<string, unknown> = {}) {
  return makeCommand(type, "user", payload);
}
