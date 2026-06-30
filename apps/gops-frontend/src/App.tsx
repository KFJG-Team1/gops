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
import { isRealtimeControlPayload, normalizeCandleEvent } from "@gops/chart-engine/marketDataAdapter";
import { DEFAULT_CHART_SYMBOL, defaultWatchlistSymbols, getSymbolMeta, normalizeHotRankingPayload, normalizeSupportedSymbol, normalizeWatchlistPayload, type HotRankingSymbol, type SupportedSymbol, type WatchlistSymbol } from "@gops/chart-engine/symbols";
import type { CandleEvent } from "@gops/chart-engine/types";
import {
  createInitialRuntimeState,
  executeCommand,
  makeCommand
} from "./layout/commands";
import { findTargetChartPanel } from "./layout/chartPanelSelection";
import type { LayoutCommand, LayoutRuntimeState } from "./layout/types";

type RuntimeAction =
  | { kind: "command"; command: LayoutCommand };

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

function applyRealtimeQuote(records: WatchlistSymbol[], event: CandleEvent, volumeDelta: number): WatchlistSymbol[] {
  return records.map((item) => item.symbol === event.symbol ? quoteFromLiveEvent(item, event, volumeDelta) : item);
}

function applyRealtimeHotQuote(records: HotRankingSymbol[], event: CandleEvent, volumeDelta: number): HotRankingSymbol[] {
  return records.map((item) => item.symbol === event.symbol ? quoteFromLiveEvent(item, event, volumeDelta) as HotRankingSymbol : item);
}

type LiveCandleVolume = {
  timestamp: string;
  volume: number;
};

function quoteFromLiveEvent<T extends WatchlistSymbol>(item: T, event: CandleEvent, volumeDelta: number): T {
  const close = event.data.close;
  const previousPrice = item.lastPrice;
  const previousChange = item.changePercent;
  let changePercent = previousChange;
  if (typeof previousPrice === "number" && typeof previousChange === "number" && previousPrice !== 0) {
    const baseline = previousPrice / (1 + previousChange / 100);
    if (baseline) {
      changePercent = ((close - baseline) / baseline) * 100;
    }
  } else if (event.data.open) {
    changePercent = ((close - event.data.open) / event.data.open) * 100;
  }

  const currentVolume = typeof item.volume === "number" ? item.volume : 0;
  const sessionDollarVolume = "sessionDollarVolume" in item && typeof item.sessionDollarVolume === "number"
    ? item.sessionDollarVolume + volumeDelta * close
    : undefined;

  return {
    ...item,
    lastPrice: close,
    changePercent,
    volume: currentVolume + volumeDelta,
    ...(typeof sessionDollarVolume === "number" ? { sessionDollarVolume } : {})
  };
}

function liveVolumeDelta(event: CandleEvent, volumeMemory: Map<string, LiveCandleVolume>): number {
  const key = `${event.symbol}:${event.interval}`;
  const previous = volumeMemory.get(key);
  volumeMemory.set(key, { timestamp: event.data.timestamp, volume: event.data.volume });
  if (!previous || previous.timestamp !== event.data.timestamp) {
    return Math.max(0, event.data.volume);
  }
  return Math.max(0, event.data.volume - previous.volume);
}

function resolveChartSocketUrl(symbol: string, interval = "1m"): string {
  const params = new URLSearchParams({ symbol, interval });
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const isViteDevServer = window.location.hostname === "127.0.0.1" &&
    (window.location.port === "5173" || window.location.port === "5174");
  const host = isViteDevServer ? "127.0.0.1:8000" : window.location.host;
  return `${protocol}//${host}/ws/charts?${params.toString()}`;
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
  const [watchlistSymbols, setWatchlistSymbols] = useState<WatchlistSymbol[]>(initialWatchlistSymbols);
  const [hotRankingSymbols, setHotRankingSymbols] = useState<HotRankingSymbol[]>([]);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolSearchRefreshKey, setSymbolSearchRefreshKey] = useState(0);
  const [symbolOptions, setSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [knownSymbols, setKnownSymbols] = useState<WatchlistSymbol[]>([]);
  const [agentChartReference, setAgentChartReference] = useState<AgentChartReference | undefined>();
  const watchlistSeedAppliedRef = useRef(false);
  const watchlistSymbolsRef = useRef<WatchlistSymbol[]>(watchlistSymbols);
  const liveCandleVolumeRef = useRef<Map<string, LiveCandleVolume>>(new Map());
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
          }
        })
        .catch(() => {
          if (!cancelled) {
            setWatchlistSymbols((current) => current);
            setSymbolOptions((current) => current);
          }
        });
    };

    fetch("/api/charts/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: watchlistSymbolsRef.current.map((item) => item.symbol) })
    })
      .then((response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((payload) => {
        if (!cancelled && payload) {
          const symbols = normalizeWatchlistPayload(payload);
          setWatchlistSymbols((current) => refreshWatchlistRecords(current, symbols));
          setKnownSymbols((current) => mergeSymbolRecords(current, symbols));
        }
      })
      .catch(() => undefined);

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
      fetch("/api/charts/hot-symbols?limit=20")
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

  const quoteStreamSymbolsKey = useMemo(() => {
    const symbols = new Set<string>();
    watchlistSymbols.forEach((item) => symbols.add(item.symbol));
    hotRankingSymbols.forEach((item) => symbols.add(item.symbol));
    return Array.from(symbols).slice(0, 40).join("|");
  }, [hotRankingSymbols, watchlistSymbols]);

  useEffect(() => {
    if (typeof window === "undefined" || !("WebSocket" in window) || !quoteStreamSymbolsKey) {
      return undefined;
    }

    const sockets: WebSocket[] = [];
    const reconnectTimers: number[] = [];
    let closed = false;
    const symbols = quoteStreamSymbolsKey.split("|").filter(Boolean);
    const connect = (symbol: string) => {
      if (closed) {
        return;
      }
      const socket = new WebSocket(resolveChartSocketUrl(symbol, "1m"));
      sockets.push(socket);
      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (isRealtimeControlPayload(payload)) {
            return;
          }
          const event = normalizeCandleEvent(payload);
          if (event.interval !== "1m") {
            return;
          }
          const volumeMemory = liveCandleVolumeRef.current;
          const volumeDelta = liveVolumeDelta(event, volumeMemory);
          setWatchlistSymbols((current) => applyRealtimeQuote(current, event, volumeDelta));
          setHotRankingSymbols((current) => applyRealtimeHotQuote(current, event, volumeDelta));
        } catch {
          // Ignore malformed auxiliary quote events; chart panels surface stream errors separately.
        }
      };
      socket.onclose = () => {
        if (!closed) {
          reconnectTimers.push(window.setTimeout(() => connect(symbol), 3000));
        }
      };
    };
    symbols.forEach(connect);

    return () => {
      closed = true;
      reconnectTimers.forEach((timer) => window.clearTimeout(timer));
      sockets.forEach((socket) => socket.close());
    };
  }, [quoteStreamSymbolsKey]);

  useEffect(() => {
    const query = symbolSearchQuery.trim();

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: query ? "20" : "100" });

    fetch(`/api/market/symbols/search?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Symbol search API returned ${response.status}`);
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

  useEffect(() => {
    const normalized = activeChartDocument ? normalizeSupportedSymbol(activeChartDocument.symbol) : null;
    if (normalized && normalized !== activeSymbol) {
      setActiveSymbol(normalized);
    }
  }, [activeChartDocument?.symbol, activeSymbol]);

  const selectSymbol = useCallback((value: string, options?: { source?: "system" | "user" }): boolean => {
    const symbol = normalizeSupportedSymbol(value);
    if (!symbol) {
      setSymbolSearchError("Enter a valid Alpaca stock symbol.");
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
        onSymbolOptionsRequest={refreshSymbolOptions}
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
          hotRankingSymbols={hotRankingSymbols}
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
    </main>
  );
}

export function command(type: Parameters<typeof makeCommand>[0], payload: Record<string, unknown> = {}) {
  return makeCommand(type, "user", payload);
}
