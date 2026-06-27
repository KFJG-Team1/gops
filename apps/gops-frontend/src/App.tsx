import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
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
import { findTargetChartPanel } from "@gops/chart-engine/chartPanelSelection";
import {
  chartRuntimeReducer,
  createInitialChartRuntimeState,
  getChartDocumentForPanel,
  type ChartRuntimeAction
} from "@gops/chart-engine/runtime";
import {
  normalizeSupportedSymbol,
  normalizeWatchlistPayload,
  type SupportedSymbol,
  type WatchlistSymbol
} from "@gops/chart-engine/symbols";
import {
  createInitialRuntimeState,
  executeCommand,
  makeCommand
} from "./layout/commands";
import type { LayoutCommand, LayoutRuntimeState } from "./layout/types";

type RuntimeAction =
  | { kind: "command"; command: LayoutCommand };

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
  const [activeSymbol, setActiveSymbol] = useState<SupportedSymbol>("AAPL");
  const [symbolSearchError, setSymbolSearchError] = useState<string | undefined>();
  const [watchlistSymbols, setWatchlistSymbols] = useState<WatchlistSymbol[]>([]);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [agentChartReference, setAgentChartReference] = useState<AgentChartReference | undefined>();

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

    fetch("/api/charts/symbols")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Symbol API returned ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) {
          const symbols = normalizeWatchlistPayload(payload);
          setWatchlistSymbols(symbols);
          setSymbolOptions(symbols);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWatchlistSymbols([]);
          setSymbolOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = symbolSearchQuery.trim();
    if (!query) {
      setSymbolOptions(watchlistSymbols);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: "20" });

    fetch(`/api/market/symbols/search?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Symbol search API returned ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) {
          setSymbolOptions(normalizeWatchlistPayload(payload));
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
  }, [symbolSearchQuery, watchlistSymbols]);

  const activeChartPanel = useMemo(
    () => findTargetChartPanel(state.layout.panels, state.layout.selectedPanelId),
    [state.layout.panels, state.layout.selectedPanelId]
  );

  const activeChartDocument = useMemo(
    () => activeChartPanel ? getChartDocumentForPanel(chartRuntime, activeChartPanel) : null,
    [activeChartPanel, chartRuntime]
  );

  const symbolUniverse = useMemo(
    () => Array.from(new Set([...watchlistSymbols, ...symbolOptions].map((item) => item.symbol))),
    [symbolOptions, watchlistSymbols]
  );

  useEffect(() => {
    const normalized = activeChartDocument ? normalizeSupportedSymbol(activeChartDocument.symbol) : null;
    if (normalized && normalized !== activeSymbol) {
      setActiveSymbol(normalized);
    }
  }, [activeChartDocument?.symbol, activeSymbol]);

  const selectSymbol = useCallback((value: string): boolean => {
    const symbol = normalizeSupportedSymbol(value);
    if (!symbol) {
      setSymbolSearchError("Enter a valid Alpaca stock symbol.");
      return false;
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

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((current) => {
      const next = current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId];

      if (next.length === 0) {
        setAgentChartReference(undefined);
      }
      setActiveSystemMode(next.length === 0 ? "watchlist" : "agents");
      return next;
    });
  };

  const askAgentFromChart = useCallback((panelId: string, chartDocumentId: string) => {
    setSelectedAgentIds(["agent-01"]);
    setAgentChartReference({ panelId, chartDocumentId, draftSeed: DEFAULT_AGENT_DRAFT_SEED });
    setEditingAgentId(undefined);
    setActiveSystemMode("agents");
  }, []);

  const updateAgent = (agentId: string, patch: AgentUpdatePatch) => {
    setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)));
  };

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
          label: `Agent ${String(nextNumber).padStart(2, "0")}`,
          description: "New workspace assistant.",
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
        layout={state.layout}
        savedLayouts={state.savedLayouts}
        autoEnabled={state.layout.settings.llmLayoutAutoApply}
        agents={agents}
        selectedAgentIds={selectedAgentIds}
        settingsActive={activeSystemMode === "settings"}
        notificationsActive={activeSystemMode === "notifications"}
        activeSymbol={activeSymbol}
        symbolOptions={symbolOptions}
        symbolSearchError={symbolSearchError}
        onToggleAuto={() =>
          runCommand(
            makeCommand("layout.autoApply.set", "user", {
              value: !state.layout.settings.llmLayoutAutoApply
            })
          )
        }
        onToggleNotifications={toggleNotifications}
        onToggleAgent={toggleAgent}
        onToggleSettings={toggleSettings}
        onSymbolQueryChange={setSymbolSearchQuery}
        onSymbolSearch={selectSymbol}
        onCommand={runCommand}
      />

      <MarketTicker />

      <section className="workspace-area" aria-label="GOPS layout workspace">
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
          symbolUniverse={symbolUniverse}
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
        />
      </section>
    </main>
  );
}

export function command(type: Parameters<typeof makeCommand>[0], payload: Record<string, unknown> = {}) {
  return makeCommand(type, "user", payload);
}
