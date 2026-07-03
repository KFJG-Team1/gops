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
  getCandlesForDocument,
  getChartDocumentForPanel,
  type ChartRuntimeAction
} from "@gops/chart-engine/runtime";
import { DEFAULT_CHART_SYMBOL, defaultWatchlistSymbols, getSymbolMeta, normalizeHotRankingPayload, normalizeSupportedSymbol, normalizeWatchlistPayload, type HotRankingSymbol, type SupportedSymbol, type WatchlistSymbol } from "@gops/chart-engine/symbols";
import {
  applyLayoutProposal,
  createInitialRuntimeState,
  executeCommand,
  makeCommand
} from "./layout/commands";
import { findTargetChartPanel } from "./layout/chartPanelSelection";
import type { LayoutCommand, LayoutProposal, LayoutRuntimeState } from "./layout/types";

type RuntimeAction =
  | { kind: "command"; command: LayoutCommand }
  | { kind: "agentLayoutProposal"; proposal: LayoutProposal };

const WATCHLIST_STORAGE_KEY = "gops.watchlistSymbols.v1";

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

function initialWatchlistSymbols(): WatchlistSymbol[] {
  const stored = readStoredWatchlistSymbols();
  return stored ?? defaultWatchlistSymbols();
}

function readStoredWatchlistSymbols(): WatchlistSymbol[] | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const records = Array.isArray(parsed)
      ? parsed.map((item) => typeof item === "string" ? getSymbolMeta(item) : item)
      : [];
    return normalizeWatchlistPayload({ symbols: records });
  } catch {
    return null;
  }
}

function writeStoredWatchlistSymbols(symbols: WatchlistSymbol[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(symbols.map((item) => item.symbol)));
}

function watchlistRequestUrl(symbols: readonly WatchlistSymbol[]): string {
  const params = new URLSearchParams();
  if (symbols.length) {
    params.set("symbols", symbols.map((item) => item.symbol).join(","));
  }
  const query = params.toString();
  return `/api/charts/watchlist${query ? `?${query}` : ""}`;
}

function runtimeReducer(state: LayoutRuntimeState, action: RuntimeAction): LayoutRuntimeState {
  if (action.kind === "agentLayoutProposal") {
    return applyLayoutProposal(state, action.proposal);
  }
  return executeCommand(state, action.command);
}

export default function App() {
  const [state, dispatch] = useReducer(runtimeReducer, undefined, createInitialRuntimeState);
  const [chartRuntime, chartDispatch] = useReducer(chartRuntimeReducer, undefined, createInitialChartRuntimeState);
  const [activeSystemMode, setActiveSystemMode] = useState<SystemMode | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [settingsTab, setSettingsTab] = useState<SystemMenuTab>("layouts");
  const [agents, setAgents] = useState<AgentOption[]>(initialAgentOptions);
  const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
  const [activeSymbol, setActiveSymbol] = useState<SupportedSymbol>(DEFAULT_CHART_SYMBOL);
  const [symbolSearchError, setSymbolSearchError] = useState<string | undefined>();
  const [watchlistSymbols, setWatchlistSymbols] = useState<WatchlistSymbol[]>(initialWatchlistSymbols);
  const [hotRankingSymbols, setHotRankingSymbols] = useState<HotRankingSymbol[]>([]);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolSearchRefreshKey, setSymbolSearchRefreshKey] = useState(0);
  const [symbolOptions, setSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [knownSymbols, setKnownSymbols] = useState<WatchlistSymbol[]>([]);
  const [agentChartReference, setAgentChartReference] = useState<AgentChartReference | undefined>();
  const watchlistSeedAppliedRef = useRef(false);
  const watchlistSymbolsRef = useRef<WatchlistSymbol[]>(watchlistSymbols);
  const watchlistBackendSeededRef = useRef(false);
  const userSelectedSymbolRef = useRef(false);

  const selectedPanel = useMemo(
    () => state.layout.panels.find((panel) => panel.id === state.layout.selectedPanelId),
    [state.layout.panels, state.layout.selectedPanelId]
  );

  const runCommand = useCallback((command: LayoutCommand) => dispatch({ kind: "command", command }), []);
  const runLayoutProposal = useCallback((proposal: LayoutProposal) => dispatch({ kind: "agentLayoutProposal", proposal }), []);
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
    watchlistSymbolsRef.current = watchlistSymbols;
    setKnownSymbols((current) => mergeSymbolRecords(current, watchlistSymbols));
  }, [watchlistSymbols]);

  useEffect(() => {
    let cancelled = false;

    const loadWatchlist = () => {
      fetch(watchlistRequestUrl(watchlistSymbolsRef.current))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Watch List API returned ${response.status}`);
          }
          return response.json() as Promise<unknown>;
        })
        .then((payload) => {
          if (!cancelled) {
            const symbols = normalizeWatchlistPayload(payload);
            setWatchlistSymbols((current) => {
              return refreshWatchlistRecords(current, symbols);
            });
            setSymbolOptions((current) => current.length > 0 ? current : symbols);
            setKnownSymbols((current) => mergeSymbolRecords(current, symbols));
            if (!watchlistBackendSeededRef.current && symbols.length > 0) {
              watchlistBackendSeededRef.current = true;
              fetch("/api/charts/watchlist", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbols: symbols.map((item) => item.symbol) })
              }).catch(() => undefined);
            }
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
    let cancelled = false;

    const loadHotRanking = () => {
      fetch("/api/charts/hot-symbols?limit=10")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Hot ranking API returned ${response.status}`);
          }
          return response.json() as Promise<unknown>;
        })
        .then((payload) => {
          if (!cancelled) {
            const symbols = normalizeHotRankingPayload(payload);
            setHotRankingSymbols(symbols);
            setKnownSymbols((current) => mergeSymbolRecords(current, symbols));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHotRankingSymbols((current) => current);
          }
        });
    };

    loadHotRanking();
    const timer = window.setInterval(loadHotRanking, 60000);

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

  const orderChartSymbols = useMemo(() => {
    const bySymbol = new Map<SupportedSymbol, WatchlistSymbol>();
    for (const panel of state.layout.panels) {
      if (panel.type !== "chart") {
        continue;
      }
      const chartDocument = getChartDocumentForPanel(chartRuntime, panel);
      const symbol = normalizeSupportedSymbol(chartDocument.symbol);
      if (!symbol || bySymbol.has(symbol)) {
        continue;
      }
      const candles = getCandlesForDocument(chartRuntime, chartDocument);
      const latestCandle = candles[candles.length - 1];
      const latestClose = latestCandle && Number.isFinite(latestCandle.close) ? latestCandle.close : undefined;
      const known = knownSymbols.find((item) => item.symbol === symbol);
      const fallback = getSymbolMeta(symbol);
      bySymbol.set(symbol, {
        symbol,
        name: known?.name ?? fallback.name,
        market: known?.market ?? fallback.market,
        lastPrice: typeof known?.lastPrice === "number" ? known.lastPrice : latestClose,
        changePercent: known?.changePercent,
        volume: known?.volume
      });
    }
    return Array.from(bySymbol.values());
  }, [chartRuntime, knownSymbols, state.layout.panels]);

  const syncWatchlistSymbols = useCallback((symbols: WatchlistSymbol[]) => {
    writeStoredWatchlistSymbols(symbols);
    fetch("/api/charts/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symbols.map((item) => item.symbol) })
    })
      .then((response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((payload) => {
        if (!payload) {
          return;
        }
        const summaries = normalizeWatchlistPayload(payload);
        setWatchlistSymbols((current) => refreshWatchlistRecords(current, summaries));
        setKnownSymbols((current) => mergeSymbolRecords(current, summaries));
      })
      .catch(() => undefined);
  }, []);

  const toggleWatchlistSymbol = useCallback((symbolValue: string) => {
    const symbol = normalizeSupportedSymbol(symbolValue);
    if (!symbol) {
      return;
    }

    setWatchlistSymbols((current) => {
      let next: WatchlistSymbol[];
      if (current.some((item) => item.symbol === symbol)) {
        next = current.filter((item) => item.symbol !== symbol);
      } else {
        const known = knownSymbols.find((item) => item.symbol === symbol);
        const fallback = getSymbolMeta(symbol);
        next = [
          ...current,
          known ?? {
            symbol,
            name: fallback.name,
            market: fallback.market
          }
        ];
      }

      syncWatchlistSymbols(next);
      return next;
    });
  }, [knownSymbols, syncWatchlistSymbols]);

  const refreshSymbolOptions = useCallback((query: string) => {
    setSymbolSearchQuery(query);
    setSymbolSearchRefreshKey((current) => current + 1);
  }, []);

  const syncPortfolioSubscriptionSymbols = useCallback((symbols: readonly string[]) => {
    const normalized = Array.from(new Set(symbols.map((symbol) => normalizeSupportedSymbol(symbol)).filter((symbol): symbol is SupportedSymbol => Boolean(symbol))));
    fetch("/api/charts/subscription-cohorts/portfolio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: normalized })
    }).catch(() => undefined);
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
    setActiveSystemMode(null);
  };

  const toggleWatchlist = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setActiveSystemMode((current) => (current === "watchlist" ? null : "watchlist"));
  };

  const toggleSettings = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setSettingsTab("layouts");
    setActiveSystemMode((current) => (current === "settings" ? null : "settings"));
  };

  const toggleNotifications = () => {
    setSelectedAgentIds([]);
    setAgentChartReference(undefined);
    setEditingAgentId(undefined);
    setActiveSystemMode((current) => (current === "notifications" ? null : "notifications"));
  };

  const togglePrimaryAgent = () => {
    const primaryAgentId = "agent-01";
    const primaryAgentActive = activeSystemMode === "agents" && selectedAgentIds.includes(primaryAgentId);

    setEditingAgentId(undefined);
    if (primaryAgentActive) {
      setSelectedAgentIds([]);
      setAgentChartReference(undefined);
      setActiveSystemMode(null);
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
      setActiveSystemMode((mode) => (mode === "agents" ? (next.length === 0 ? null : "agents") : mode));
      return next;
    });
    setEditingAgentId(undefined);
  };

  return (
    <main className="app-shell">
      <TopAppBar
        aiActive={activeSystemMode === "agents" && selectedAgentIds.includes("agent-01")}
        watchlistActive={activeSystemMode === "watchlist"}
        settingsActive={activeSystemMode === "settings"}
        notificationsActive={activeSystemMode === "notifications"}
        activeSymbol={activeSymbol}
        symbolOptions={symbolOptions}
        symbolSearchError={symbolSearchError}
        onToggleNotifications={toggleNotifications}
        onTogglePrimaryAgent={togglePrimaryAgent}
        onToggleWatchlist={toggleWatchlist}
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
          hotRankingSymbols={hotRankingSymbols}
          knownSymbols={knownSymbols}
          orderChartSymbols={orderChartSymbols}
          symbolOptions={symbolOptions}
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
          onSymbolOptionsRequest={refreshSymbolOptions}
          onPortfolioSymbolsChange={syncPortfolioSubscriptionSymbols}
          onCommand={runCommand}
          onLayoutProposal={runLayoutProposal}
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
