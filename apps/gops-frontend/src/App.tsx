import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAuth } from "./auth/AuthProvider";
import {
  chartRuntimeReducer,
  createInitialChartRuntimeState,
  makeChartCommand,
  type ChartCommand,
  type ChartRuntimeAction,
  type ChartRuntimeState
} from "@gops/chart-engine";
import {
  chartDocumentIdForContent,
  ensureFrontendChartDocuments
} from "./chart/chartDocumentAdapter";
import {
  cancelAgentAnalysis,
  createAgentAnalysisRequestId,
  formatAgentAnalysisForChat,
  isAgentRequestAbortError,
  requestAgentAnalysisPayload,
  resolveAgentChartShortcut,
  resolveAgentLayoutCommand,
  type AgentEntityResolveResponse,
  type AgentLayoutResolveResponse
} from "./agent/agentAnalysisClient";
import { publishOntologyReport } from "./ontology/ontologyEvents";
import { BottomCommandBar, type AgentSubmitResult, type BottomMenuKey, type ChatLogEntry } from "./components/BottomCommandBar";
import { type ChartPanelHandle, type LiveQuote } from "./components/ChartPanel";
import { PanelWorkspace } from "./components/PanelWorkspace";
import type { SemanticSelectionSnapshot } from "./chart/semanticTimeline";
import type { ChartSymbolDto } from "./chart/types";
import { fetchWatchlist, replaceWatchlistSymbols, WatchlistApiError } from "./chart/watchlistApi";
import { gridGutter } from "./layout/grid";
import {
  createInitialTiledPanelState,
  scaleTiledPanelState,
  type TiledPanelState,
  type ViewportSize
} from "./layout/panelLayout";
import {
  bottomNavigationHeight,
  navigationGap,
  treeMapHoverMetaReserve
} from "./layout/workspaceMetrics";
import {
  createMainViewUrl,
  mainViewsEqual,
  mainViewUrlPath,
  normalizeStoredSymbol,
  resolveMainViewFromUrl,
  type MainView
} from "./navigation/mainViewUrl";
import { applyTiledAgentLayoutProposal, buildTiledAgentLayoutContext } from "./layout/tiledAgentLayout";
import type { AgentLayoutProposal } from "./layout/agentLayoutTypes";
import { fetchMarketHeatmap } from "./market/heatmapApi";
import { sp500UniverseSeed, type Sp500UniverseItem } from "./market/sp500Universe.seed";
import { TreeMapCanvas } from "./treemap/TreeMapCanvas";

type LayoutDrag =
  { mode: "treemap"; type: "resize-bottom"; startY: number; startHeight: number };

type ActiveAgentRun = {
  requestId: string;
  controller: AbortController;
  pendingEntryId: string;
  cancelRequested: boolean;
};

const lastChartSymbolStorageKey = "gops:last-chart-symbol";
const maxWatchlistSymbols = 10;

let chatLogEntrySequence = 0;

const unavailableHeaderQuote: LiveQuote = {
  priceText: "-",
  changeText: "-",
  percentText: "-",
  tone: "unavailable"
};

const headerQuoteFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function initialPanelState(): TiledPanelState {
  if (typeof window === "undefined") {
    return createInitialTiledPanelState({ width: 1280, height: 720 });
  }
  const initialView = resolveMainViewFromUrl(window.location.href).view;
  return createInitialTiledPanelState(currentViewportSize(), {
    symbol: initialView.mode === "chart" ? initialView.symbol : undefined
  });
}

function initialTreeMapHeight(): number {
  if (typeof window === "undefined") {
    return 620;
  }
  return treeMapMaxHeight(window.innerHeight);
}

function initialChartCommandTargetContentId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return resolveMainViewFromUrl(window.location.href).view.mode === "chart" ? "content-chart-1" : null;
}

export function App() {
  const [mainView, setMainView] = useState<MainView>(() => initialMainView());
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => currentViewportSize());
  const [panelState, setPanelState] = useState<TiledPanelState>(() => initialPanelState());
  const [treeMapHeight, setTreeMapHeight] = useState(() => initialTreeMapHeight());
  const [, setSemanticSelection] = useState<SemanticSelectionSnapshot | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [chatLog, setChatLog] = useState<ChatLogEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chartCommandTargetContentId, setChartCommandTargetContentId] = useState<string | null>(() => initialChartCommandTargetContentId());
  const [chartRuntime, setChartRuntime] = useState<ChartRuntimeState>(() => createInitialChartRuntimeState());
  const [treeMapItems, setTreeMapItems] = useState<Sp500UniverseItem[]>(() => sp500UniverseSeed);
  const [treeMapLaneHover, setTreeMapLaneHover] = useState(false);
  const [activeBottomMenu, setActiveBottomMenu] = useState<BottomMenuKey | null>(null);
  const [watchlistSymbols, setWatchlistSymbols] = useState<ChartSymbolDto[]>([]);
  const [watchlistPersisted, setWatchlistPersisted] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [, setWatchlistError] = useState<string | null>(null);
  const [, setWatchlistMessage] = useState<string | null>(null);
  const { authEnabled, user, loading: authLoading, login, logout } = useAuth();
  const chartPanelHandlesRef = useRef<Map<string, ChartPanelHandle>>(new Map());
  const dragRef = useRef<LayoutDrag | null>(null);
  const activeAgentRunRef = useRef<ActiveAgentRun | null>(null);
  const watchlistSavingRef = useRef(false);
  const treeMapLayoutAsOfRef = useRef<string | null>(null);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const isTreeMapMode = mainView.mode === "treemap";
  const laneCanResize = isTreeMapMode && canResizeTreeMapLayout(viewportSize.height);
  const hasChartCommandTarget = Boolean(chartCommandTargetContentId);

  const applyMainViewState = useCallback((nextView: MainView, options: { closeBottomMenu?: boolean } = {}) => {
    setSemanticSelection(null);
    setTreeMapLaneHover(false);
    if (options.closeBottomMenu || nextView.mode === "treemap") {
      setActiveBottomMenu(null);
    }
    if (nextView.mode === "treemap") {
      setChartCommandTargetContentId(null);
      chartPanelHandlesRef.current.clear();
    }
    persistMainView(nextView);
    setMainView(nextView);
  }, []);

  const navigateMainView = useCallback((nextView: MainView, options: { replace?: boolean; closeBottomMenu?: boolean } = {}) => {
    if (typeof window !== "undefined" && window.history) {
      const currentView = resolveMainViewFromUrl(window.location.href).view;
      const nextUrl = createMainViewUrl(window.location.href, nextView);
      const currentUrl = mainViewUrlPath(window.location.href);
      if (nextUrl !== currentUrl) {
        if (options.replace || mainViewsEqual(currentView, nextView)) {
          window.history.replaceState(window.history.state, "", nextUrl);
        } else {
          window.history.pushState(window.history.state, "", nextUrl);
        }
      }
    }
    applyMainViewState(nextView, { closeBottomMenu: options.closeBottomMenu });
  }, [applyMainViewState]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.history?.replaceState) {
      return;
    }
    const resolved = resolveMainViewFromUrl(window.location.href);
    const currentUrl = mainViewUrlPath(window.location.href);
    if (resolved.url !== currentUrl) {
      window.history.replaceState(window.history.state, "", resolved.url);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const handlePopState = () => {
      const resolved = resolveMainViewFromUrl(window.location.href);
      const currentUrl = mainViewUrlPath(window.location.href);
      if (window.history?.replaceState && resolved.url !== currentUrl) {
        window.history.replaceState(window.history.state, "", resolved.url);
      }
      applyMainViewState(resolved.view, { closeBottomMenu: true });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyMainViewState]);

  const finishLayoutDrag = useCallback((event?: PointerEvent) => {
    void event;
    dragRef.current = null;
  }, []);

  const applyLayoutDrag = useCallback((_clientX: number, clientY: number, viewport: ViewportSize) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setTreeMapHeight(clampTreeMapHeight(drag.startHeight + clientY - drag.startY, viewport.height));
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }
      event.preventDefault();
      applyLayoutDrag(event.clientX, event.clientY, viewportSizeRef.current);
    };

    const handleResize = () => {
      const previous = viewportSizeRef.current;
      const next = currentViewportSize();
      viewportSizeRef.current = next;
      setViewportSize(next);
      setPanelState((current) => scaleTiledPanelState(current, previous, next));
      setTreeMapHeight((height) => clampTreeMapHeight(height, next.height));
    };

    const handlePointerUp = (event: PointerEvent) => finishLayoutDrag(event);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, [applyLayoutDrag, finishLayoutDrag]);

  const layoutGutter = gridGutter(viewportSize.width);
  const workspaceStyle = {
    "--layout-gutter": `${layoutGutter}px`
  } as CSSProperties;
  const treeMapLaneStyle: CSSProperties = {
    top: 0,
    height: treeMapHeight,
    left: 0,
    width: viewportSize.width
  };

  const universeSymbols = useMemo((): ChartSymbolDto[] => treeMapItems.map((item) => ({
    symbol: item.symbol,
    name: item.companyName,
    sector: item.sector,
    isMock: item.symbol === "TSLA" || item.symbol === "AAPL" || item.symbol === "GOOGL"
  })), [treeMapItems]);
  const activePageSymbol = mainView.mode === "chart" ? mainView.symbol : "";
  const activeHeaderQuote = useMemo(() => (
    mainView.mode === "chart" ? headerQuoteForSymbol(treeMapItems, mainView.symbol) : unavailableHeaderQuote
  ), [mainView, treeMapItems]);
  const chartCommandTargetSlotId = useMemo(() => (
    chartCommandTargetContentId
      ? panelState.slots.find((slot) => slot.contentId === chartCommandTargetContentId)?.id
      : undefined
  ), [chartCommandTargetContentId, panelState]);
  const chartDocumentSymbolsByPanelId = useMemo(() => (
    chartDocumentSymbolsForLayout(panelState, chartRuntime)
  ), [chartRuntime, panelState]);
  const canUseAgent = !authLoading && (!authEnabled || Boolean(user));
  const canEditWatchlist = !authLoading && (!authEnabled || Boolean(user));
  const visibleWatchlistSymbols = canEditWatchlist ? watchlistSymbols : universeSymbols.slice(0, 24);

  useEffect(() => {
    if (authLoading) {
      return undefined;
    }
    if (authEnabled && !user) {
      setWatchlistSymbols([]);
      setWatchlistPersisted(false);
      setWatchlistLoading(false);
      setWatchlistError(null);
      setWatchlistMessage(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setWatchlistLoading(true);
    setWatchlistError(null);
    setWatchlistMessage(null);
    void fetchWatchlist(controller.signal)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setWatchlistSymbols(payload.symbols);
        setWatchlistPersisted(payload.persisted);
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setWatchlistError(watchlistErrorMessage(error, "관심종목을 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!cancelled) {
          setWatchlistLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authEnabled, authLoading, user]);

  const dispatchChartRuntimeAction = useCallback((action: ChartRuntimeAction) => {
    setChartRuntime((current) => chartRuntimeReducer(current, action));
  }, []);

  const requestWatchlistLogin = useCallback(() => {
    setWatchlistError(null);
    setWatchlistMessage(null);
    if (!authLoading && authEnabled) {
      login();
    }
  }, [authEnabled, authLoading, login]);

  const saveWatchlistSymbols = useCallback(async (symbols: string[]) => {
    if (watchlistSavingRef.current) {
      return;
    }
    watchlistSavingRef.current = true;
    setWatchlistSaving(true);
    setWatchlistError(null);
    setWatchlistMessage(null);
    try {
      const payload = await replaceWatchlistSymbols(symbols);
      setWatchlistSymbols(payload.symbols);
      setWatchlistPersisted(payload.persisted);
    } catch (error: unknown) {
      if (error instanceof WatchlistApiError && error.status === 401) {
        setWatchlistError("로그인 후 관심종목을 수정할 수 있습니다.");
        if (authEnabled) {
          login();
        }
      } else {
        setWatchlistError(watchlistErrorMessage(error, "관심종목을 저장하지 못했습니다."));
      }
    } finally {
      watchlistSavingRef.current = false;
      setWatchlistSaving(false);
    }
  }, [authEnabled, login]);

  const addWatchlistSymbol = useCallback((symbol: string) => {
    const normalizedSymbol = normalizeStoredSymbol(symbol);
    if (!normalizedSymbol) {
      return;
    }
    if (!canEditWatchlist) {
      requestWatchlistLogin();
      return;
    }
    if (watchlistSavingRef.current) {
      return;
    }
    const currentSymbols = currentWatchlistSymbolValues(watchlistSymbols);
    if (currentSymbols.includes(normalizedSymbol)) {
      setWatchlistError(null);
      setWatchlistMessage(null);
      return;
    }
    if (currentSymbols.length >= maxWatchlistSymbols) {
      setWatchlistError(null);
      setWatchlistMessage(null);
      return;
    }
    void saveWatchlistSymbols([...currentSymbols, normalizedSymbol]);
  }, [canEditWatchlist, requestWatchlistLogin, saveWatchlistSymbols, watchlistSymbols]);

  const removeWatchlistSymbol = useCallback((symbol: string) => {
    const normalizedSymbol = normalizeStoredSymbol(symbol);
    if (!normalizedSymbol) {
      return;
    }
    if (!canEditWatchlist) {
      requestWatchlistLogin();
      return;
    }
    if (watchlistSavingRef.current) {
      return;
    }
    const currentSymbols = currentWatchlistSymbolValues(watchlistSymbols);
    if (!currentSymbols.includes(normalizedSymbol)) {
      return;
    }
    void saveWatchlistSymbols(currentSymbols.filter((item) => item !== normalizedSymbol));
  }, [canEditWatchlist, requestWatchlistLogin, saveWatchlistSymbols, watchlistSymbols]);

  const reorderWatchlistSymbol = useCallback((draggedSymbol: string, targetSymbol: string, placement: "before" | "after") => {
    const normalizedDragged = normalizeStoredSymbol(draggedSymbol);
    const normalizedTarget = normalizeStoredSymbol(targetSymbol);
    if (!normalizedDragged || !normalizedTarget || normalizedDragged === normalizedTarget) {
      return;
    }
    if (!canEditWatchlist) {
      requestWatchlistLogin();
      return;
    }
    if (watchlistSavingRef.current) {
      return;
    }
    const currentSymbols = currentWatchlistSymbolValues(watchlistSymbols);
    if (!currentSymbols.includes(normalizedDragged) || !currentSymbols.includes(normalizedTarget)) {
      return;
    }
    const withoutDragged = currentSymbols.filter((item) => item !== normalizedDragged);
    const targetIndex = withoutDragged.indexOf(normalizedTarget);
    if (targetIndex < 0) {
      return;
    }
    const nextSymbols = [...withoutDragged];
    nextSymbols.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, normalizedDragged);
    if (nextSymbols.every((symbol, index) => symbol === currentSymbols[index])) {
      return;
    }
    const currentBySymbol = new Map(watchlistSymbols.map((item) => [normalizeStoredSymbol(item.symbol), item]));
    const reorderedItems = nextSymbols.map((symbol) => currentBySymbol.get(symbol)).filter((item): item is ChartSymbolDto => Boolean(item));
    if (reorderedItems.length === watchlistSymbols.length) {
      setWatchlistSymbols(reorderedItems);
    }
    void saveWatchlistSymbols(nextSymbols);
  }, [canEditWatchlist, requestWatchlistLogin, saveWatchlistSymbols, watchlistSymbols]);

  useEffect(() => {
    setChartRuntime((current) => ensureFrontendChartDocuments(
      current,
      panelState,
      mainView.mode === "chart" ? mainView.symbol : "NVDA"
    ));
  }, [mainView, panelState]);

  const openSymbolPage = useCallback((symbol: string, options: { replace?: boolean } = {}) => {
    const normalizedSymbol = normalizeStoredSymbol(symbol) || "NVDA";
    const nextView: MainView = { mode: "chart", symbol: normalizedSymbol };
    chartPanelHandlesRef.current.clear();
    setChartCommandTargetContentId("content-chart-1");
    setChartRuntime(createInitialChartRuntimeState());
    setPanelState(createInitialTiledPanelState(viewportSizeRef.current, { symbol: normalizedSymbol }));
    navigateMainView(nextView, { replace: options.replace });
  }, [navigateMainView]);

  const syncPageSymbolFromChart = useCallback((contentId: string) => {
    const content = panelState.contents[contentId];
    const document = content?.kind === "chart" ? chartRuntime.documents[chartDocumentIdForContent(content)] : null;
    const normalizedSymbol = normalizeStoredSymbol(document?.symbol);
    if (!content || content.kind !== "chart" || !document || !normalizedSymbol) {
      return;
    }
    navigateMainView({ mode: "chart", symbol: normalizedSymbol });
  }, [chartRuntime.documents, navigateMainView, panelState]);

  const handleChartHandleChange = useCallback((contentId: string, handle: ChartPanelHandle | null) => {
    if (handle) {
      chartPanelHandlesRef.current.set(contentId, handle);
    } else {
      chartPanelHandlesRef.current.delete(contentId);
    }
  }, []);

  const applyAgentLayoutProposal = useCallback((proposal: AgentLayoutProposal) => {
    setPanelState((current) => {
      const next = applyTiledAgentLayoutProposal(current, proposal, viewportSizeRef.current);
      const commands = chartDocumentCommandsForPanelPropChanges(current, next);
      if (commands.length) {
        setChartRuntime((runtime) => {
          const activeCommands = commands.filter((command) => runtime.documents[command.target.chartDocumentId]);
          return activeCommands.length
            ? chartRuntimeReducer(runtime, { kind: "chart.command.group", commands: activeCommands, label: "Apply layout chart props" })
            : runtime;
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!authLoading && authEnabled && !user && chartCommandTargetContentId) {
      setChartCommandTargetContentId(null);
    }
  }, [authEnabled, authLoading, chartCommandTargetContentId, user]);

  useEffect(() => {
    if (!chartCommandTargetContentId) {
      return;
    }
    const target = panelState.contents[chartCommandTargetContentId];
    if (!target || target.kind !== "chart") {
      setChartCommandTargetContentId(null);
      chartPanelHandlesRef.current.delete(chartCommandTargetContentId);
    }
  }, [chartCommandTargetContentId, panelState]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let controller: AbortController | null = null;

    const loadHeatmap = async () => {
      controller = new AbortController();
      let nextRefreshSeconds = 60;
      try {
        const payload = await fetchMarketHeatmap(controller.signal);
        nextRefreshSeconds = payload.quoteRefreshSeconds || nextRefreshSeconds;
        if (!cancelled && payload.items.length > 0) {
          const previousLayoutAsOf = treeMapLayoutAsOfRef.current;
          const shouldUpdateLayout = !previousLayoutAsOf || payload.layoutAsOf !== previousLayoutAsOf;
          setTreeMapItems((current) => mergeTreeMapItems(current, payload.items, shouldUpdateLayout));
          treeMapLayoutAsOfRef.current = payload.layoutAsOf || previousLayoutAsOf;
        }
      } catch {
        // Seed data stays visible when the projection API is warming up or unavailable.
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(loadHeatmap, nextRefreshSeconds * 1000);
        }
      }
    };

    void loadHeatmap();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const showTreeMap = () => {
    navigateMainView({ mode: "treemap" }, { closeBottomMenu: true });
  };

  const toggleBottomMenu = (key: BottomMenuKey) => {
    if (key === "V" && authEnabled && !authLoading && !user) {
      login();
      return;
    }
    setActiveBottomMenu((current) => (current === key ? null : key));
  };

  const cancelActiveAgentRun = useCallback(() => {
    const run = activeAgentRunRef.current;
    if (!run) {
      setAgentBusy(false);
      return;
    }
    run.cancelRequested = true;
    run.controller.abort();
    replaceChatLogEntry(setChatLog, run.pendingEntryId, "Agent 분석을 중단했습니다.");
    setAgentBusy(false);
    void cancelAgentAnalysis(run.requestId).catch(() => {
      // Local abort already restored the UI; polling will also observe a stored cancel if the API accepted it.
    });
  }, []);

  const runAgentPrompt = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<AgentSubmitResult> => {
    event.preventDefault();
    const prompt = agentInput.trim();
    if (!prompt || agentBusy) {
      return "ignored";
    }
    const userEntry = createChatLogEntry("user", prompt);
    setAgentInput("");
    if (!canUseAgent) {
      setChatLog((current) => [
        ...current,
        userEntry,
        createChatLogEntry("system", authLoading ? "계정 상태를 확인한 뒤 다시 시도해주세요." : "로그인 후 Agent를 사용할 수 있습니다.")
      ]);
      return "chat-log";
    }
    const shortcut = await resolveAgentChartShortcut(prompt);
    if (shortcut?.status === "confirmed" && shortcut.chartShortcut && shortcut.symbol) {
      const shortcutSymbols = normalizedShortcutSymbols(shortcut);
      if (shortcutSymbols.length > 1) {
        setAgentBusy(true);
        try {
          const primarySymbol = shortcutSymbols[0];
          if (!primarySymbol) {
            throw new Error("비교할 차트 종목을 확정하지 못했습니다.");
          }
          let nextPanelState = createInitialTiledPanelState(viewportSizeRef.current, { symbol: primarySymbol });
          for (const addSymbol of shortcutSymbols.slice(1)) {
            const layoutResolution = await resolveAgentLayoutCommand({
              symbol: addSymbol,
              intent: prompt,
              routerMode: "hybrid",
              messages: [{ role: "user", content: prompt }],
              chartAction: "add",
              chartTargetSymbol: addSymbol,
              chartPlacementIntent: shortcut.chartPlacementIntent,
              layoutContext: buildTiledAgentLayoutContext(nextPanelState, viewportSize, primarySymbol, "slot-chart")
            });
            if (layoutResolution?.status !== "ui_layout" || !layoutResolution.layoutProposal) {
              throw new Error(`${addSymbol} 차트 패널을 추가할 수 없습니다.`);
            }
            nextPanelState = applyTiledAgentLayoutProposal(nextPanelState, layoutResolution.layoutProposal, viewportSizeRef.current);
          }
          setSemanticSelection(null);
          setTreeMapLaneHover(false);
          chartPanelHandlesRef.current.clear();
          setChartCommandTargetContentId("content-chart-1");
          setChartRuntime(createInitialChartRuntimeState());
          setPanelState(nextPanelState);
          navigateMainView({ mode: "chart", symbol: primarySymbol });
          setChatLog((current) => [
            ...current,
            userEntry,
            createChatLogEntry("assistant", `${shortcutSymbols.join(", ")} 차트를 같이 표시했습니다.`)
          ]);
          return "chat-log";
        } catch (error: unknown) {
          setChatLog((current) => [
            ...current,
            userEntry,
            createChatLogEntry("system", error instanceof Error ? error.message : "차트 패널을 추가할 수 없습니다.")
          ]);
          return "chat-log";
        } finally {
          setAgentBusy(false);
        }
      }
      const chartAction = shortcut.chartAction ?? "replace";
      if (chartAction === "add" && mainView.mode === "chart") {
        setAgentBusy(true);
        try {
          const layoutResolution = await resolveAgentLayoutCommand({
            symbol: shortcut.symbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            chartAction: "add",
            chartTargetSymbol: shortcut.symbol,
            chartPlacementIntent: shortcut.chartPlacementIntent,
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, mainView.symbol, chartCommandTargetSlotId, chartDocumentSymbolsByPanelId)
          });
          if (layoutResolution?.status === "ui_layout" && layoutResolution.layoutProposal) {
            applyAgentLayoutProposal(layoutResolution.layoutProposal);
            setChatLog((current) => [
              ...current,
              userEntry,
              createChatLogEntry("assistant", layoutResolutionMessage(layoutResolution))
            ]);
            return "chat-log";
          }
          if (layoutResolution?.status === "ui_clarify") {
            setChatLog((current) => [
              ...current,
              userEntry,
              createChatLogEntry("assistant", layoutResolutionMessage(layoutResolution))
            ]);
            return "chat-log";
          }
          setChatLog((current) => [
            ...current,
            userEntry,
            createChatLogEntry("system", layoutResolution?.rationale || "차트 패널을 추가할 수 없습니다.")
          ]);
          return "chat-log";
        } catch (error: unknown) {
          setChatLog((current) => [
            ...current,
            userEntry,
            createChatLogEntry("system", error instanceof Error ? error.message : "차트 패널을 추가할 수 없습니다.")
          ]);
          return "chat-log";
        } finally {
          setAgentBusy(false);
        }
      }
      if (mainView.mode === "chart") {
        openSymbolPage(shortcut.symbol);
        setChatLog((current) => [
          ...current,
          userEntry,
          createChatLogEntry("assistant", `${shortcut.symbol} 차트를 표시했습니다.`)
        ]);
        return "chat-log";
      }
      openSymbolPage(shortcut.symbol);
      return "chart-shortcut";
    }
    if (isLikelyChartOpenCommand(prompt)) {
      setChatLog((current) => [
        ...current,
        userEntry,
        createChatLogEntry("system", "종목명을 찾지 못했습니다. 예: 애플, 엔비디아, AAPL, NVDA")
      ]);
      return "chat-log";
    }
    if (mainView.mode !== "chart") {
      setChatLog((current) => [
        ...current,
        userEntry,
        createChatLogEntry("system", "기업명/티커만 입력하면 차트를 열 수 있고, 분석은 차트 화면에서 가능합니다.")
      ]);
      return "chat-log";
    }

    const runChartPrompt = async () => {
      if (!hasChartCommandTarget) {
        setAgentBusy(true);
        try {
          const analysisPayload = {
            symbol: mainView.symbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, mainView.symbol, chartCommandTargetSlotId, chartDocumentSymbolsByPanelId)
          };
          const layoutResolution = await resolveAgentLayoutCommand(analysisPayload);
          if (layoutResolution?.status === "ui_layout") {
            if (layoutResolution.layoutProposal) {
              setPanelState((current) => applyTiledAgentLayoutProposal(current, layoutResolution.layoutProposal!, viewportSizeRef.current));
            }
            setChatLog((current) => [
              ...current,
              userEntry,
              createChatLogEntry("assistant", layoutResolutionMessage(layoutResolution))
            ]);
            return;
          }
          if (layoutResolution?.status === "ui_clarify") {
            setChatLog((current) => [
              ...current,
              userEntry,
              createChatLogEntry("assistant", layoutResolutionMessage(layoutResolution))
            ]);
            return;
          }
        } catch {
          // Layout resolve is an optimization; analysis remains the fallback.
        } finally {
          setAgentBusy(false);
        }
      }

      const pendingEntry = createChatLogEntry(
        "assistant",
        hasChartCommandTarget ? "차트 조작 에이전트가 차트를 읽고 있습니다." : "Agent가 분석을 시작했습니다.",
        true
      );
      setAgentBusy(true);
      setChatLog((current) => [...current, userEntry, pendingEntry]);
      try {
        if (hasChartCommandTarget) {
          const chartPanel = chartCommandTargetContentId ? chartPanelHandlesRef.current.get(chartCommandTargetContentId) : null;
          if (!chartPanel) {
            throw new Error("차트 조작 대상 차트를 선택해주세요.");
          }
          const result = await chartPanel.runAgentPrompt(prompt);
          replaceChatLogEntry(setChatLog, pendingEntry.id, result.message || "응답이 없습니다.");
        } else {
          const controller = new AbortController();
          const requestId = createAgentAnalysisRequestId();
          const activeRun: ActiveAgentRun = {
            requestId,
            controller,
            pendingEntryId: pendingEntry.id,
            cancelRequested: false
          };
          activeAgentRunRef.current = activeRun;
          const report = await requestAgentAnalysisPayload({
            symbol: mainView.symbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, mainView.symbol, chartCommandTargetSlotId, chartDocumentSymbolsByPanelId)
          }, {
            requestId,
            signal: controller.signal,
            onAccepted: (accepted) => {
              activeRun.requestId = accepted.analysisId;
            }
          });
          if (report.layoutProposal) {
            applyAgentLayoutProposal(report.layoutProposal);
          }
          replaceChatLogEntry(setChatLog, pendingEntry.id, formatAgentAnalysisForChat(report));
          publishOntologyReport({ symbol: report.symbol, providerEvidence: report.providerEvidence ?? [] });
        }
      } catch (error: unknown) {
        const activeRun = activeAgentRunRef.current;
        if (isAgentRequestAbortError(error) || activeRun?.cancelRequested) {
          replaceChatLogEntry(setChatLog, pendingEntry.id, "Agent 분석을 중단했습니다.");
          return;
        }
        replaceChatLogEntry(
          setChatLog,
          pendingEntry.id,
          error instanceof Error ? error.message : "Agent 요청에 실패했습니다."
        );
      } finally {
        const activeRun = activeAgentRunRef.current;
        if (!activeRun || activeRun.pendingEntryId === pendingEntry.id) {
          activeAgentRunRef.current = null;
          setAgentBusy(false);
        }
      }
    };

    void runChartPrompt();
    return "chat-log";
  }, [agentBusy, agentInput, applyAgentLayoutProposal, authLoading, canUseAgent, chartDocumentSymbolsByPanelId, hasChartCommandTarget, chartCommandTargetContentId, chartCommandTargetSlotId, mainView, navigateMainView, openSymbolPage, panelState, viewportSize]);

  const beginTreeMapResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    if (!laneCanResize) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTreeMapLaneHover(true);
    dragRef.current = {
      mode: "treemap",
      type: "resize-bottom",
      startY: event.clientY,
      startHeight: treeMapHeight
    };
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    applyLayoutDrag(event.clientX, event.clientY, viewportSize);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    finishLayoutDrag(event.nativeEvent);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can be released by the browser when a drag leaves the element.
    }
  };

  return (
    <main className="app-shell">
      {mainView.mode === "chart" && (
        <header className="workspace-top-nav chart" aria-label="Workspace header">
          <div className={`header-quote-stack ${activeHeaderQuote?.tone ?? "unavailable"}`} aria-label="Live quote">
            <span className="quote-percent">{activeHeaderQuote?.percentText ?? "-"}</span>
            <span className="quote-price-line">
              <span className="quote-price">{activeHeaderQuote?.priceText ?? "-"}</span>
              <span className="quote-change">{activeHeaderQuote?.changeText ?? "-"}</span>
            </span>
          </div>
          <h1 className="company-ticker">{activePageSymbol}</h1>
          <div className="workspace-top-nav-spacer" aria-hidden="true" />
        </header>
      )}
      <section className="canvas-workspace" style={workspaceStyle}>
        {mainView.mode === "treemap" ? (
          <div
            className={[
              "chart-lane-frame",
              "workspace-panel-surface",
              treeMapLaneHover ? "is-chart-hovered" : "",
              laneCanResize ? "" : "is-resize-disabled"
            ].filter(Boolean).join(" ")}
            style={treeMapLaneStyle}
            onPointerEnter={() => setTreeMapLaneHover(true)}
            onPointerLeave={() => {
              if (!dragRef.current) {
                setTreeMapLaneHover(false);
              }
            }}
          >
            <TreeMapCanvas items={treeMapItems} onSelectSymbol={openSymbolPage} />
            <div
              className="chart-resize-grip bottom"
              aria-hidden="true"
              onPointerDown={beginTreeMapResize}
              onPointerMove={updateDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>
        ) : (
          <PanelWorkspace
            panelState={panelState}
            setPanelState={setPanelState}
            viewportSize={viewportSize}
            activeSymbol={mainView.symbol}
            symbols={universeSymbols}
            companyItems={treeMapItems}
            marketItems={treeMapItems}
            chartRuntime={chartRuntime}
            chartCommandTargetContentId={chartCommandTargetContentId}
            canUseChartCommand={canUseAgent}
            setSemanticSelection={setSemanticSelection}
            onChartRuntimeAction={dispatchChartRuntimeAction}
            onChartCommandTargetChange={setChartCommandTargetContentId}
            onChartHandleChange={handleChartHandleChange}
            onSyncPageSymbolFromChart={syncPageSymbolFromChart}
            onSelectSymbol={openSymbolPage}
          />
        )}
      </section>
      <BottomCommandBar
        activeMenu={activeBottomMenu}
        agentBusy={agentBusy}
        agentInput={agentInput}
        chatLog={chatLog}
        authEnabled={authEnabled}
        authLoading={authLoading}
        authUser={user}
        canUseAgent={canUseAgent}
        hasChartCommandTarget={hasChartCommandTarget}
        symbols={universeSymbols}
        watchlistSymbols={visibleWatchlistSymbols}
        watchlistPersisted={watchlistPersisted}
        watchlistLoading={watchlistLoading}
        watchlistSaving={watchlistSaving}
        canEditWatchlist={canEditWatchlist}
        activeSymbol={activePageSymbol}
        isChartMode={mainView.mode === "chart"}
        onAgentInputChange={setAgentInput}
        onAgentCancel={cancelActiveAgentRun}
        onAgentSubmit={runAgentPrompt}
        onAddWatchlistSymbol={addWatchlistSymbol}
        onCloseMenu={() => setActiveBottomMenu(null)}
        onLogin={login}
        onLogout={() => void logout()}
        onReorderWatchlistSymbol={reorderWatchlistSymbol}
        onRemoveWatchlistSymbol={removeWatchlistSymbol}
        onSelectSymbol={openSymbolPage}
        onShowTreeMap={showTreeMap}
        onToggleMenu={toggleBottomMenu}
      />
    </main>
  );
}

function createChatLogEntry(role: ChatLogEntry["role"], text: string, pending = false): ChatLogEntry {
  chatLogEntrySequence += 1;
  return {
    id: `chat-${Date.now()}-${chatLogEntrySequence}`,
    role,
    text,
    pending
  };
}

function mergeTreeMapItems(
  current: readonly Sp500UniverseItem[],
  incoming: readonly Sp500UniverseItem[],
  updateLayout: boolean
): Sp500UniverseItem[] {
  if (incoming.length === 0) {
    return [...current];
  }
  const currentBySymbol = new Map(current.map((item) => [item.symbol, item]));
  return incoming.map((item) => {
    const previous = currentBySymbol.get(item.symbol);
    if (!previous || updateLayout) {
      return item;
    }
    return {
      ...previous,
      ...item,
      layoutPrice: previous.layoutPrice ?? item.layoutPrice,
      layoutMarketCap: previous.layoutMarketCap ?? item.layoutMarketCap,
      layoutMarketCapSource: previous.layoutMarketCapSource ?? item.layoutMarketCapSource,
      layoutPriceSource: previous.layoutPriceSource ?? item.layoutPriceSource,
      layoutPriceUpdatedAt: previous.layoutPriceUpdatedAt ?? item.layoutPriceUpdatedAt,
      indexWeight: previous.indexWeight
    };
  });
}

function headerQuoteForSymbol(items: readonly Sp500UniverseItem[], symbol: string): LiveQuote {
  const item = items.find((entry) => entry.symbol.toUpperCase() === symbol.toUpperCase());
  const price = item?.lastPrice;
  const changePercent = item?.changePercent;
  if (typeof price !== "number" || !Number.isFinite(price) || typeof changePercent !== "number" || !Number.isFinite(changePercent)) {
    return unavailableHeaderQuote;
  }
  const previous = price / (1 + changePercent / 100);
  const change = Number.isFinite(previous) ? price - previous : 0;
  const tone = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";
  return {
    priceText: headerQuoteFormatter.format(price),
    changeText: formatSignedHeaderNumber(change),
    percentText: `${formatSignedHeaderNumber(changePercent)}%`,
    tone
  };
}

function formatSignedHeaderNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${headerQuoteFormatter.format(Math.abs(value))}`;
}

function chartDocumentSymbolsForLayout(
  panelState: TiledPanelState,
  chartRuntime: ChartRuntimeState
): Record<string, string | undefined> {
  const symbols: Record<string, string | undefined> = {};
  for (const slot of panelState.slots) {
    const content = panelState.contents[slot.contentId];
    if (!content || content.kind !== "chart") {
      continue;
    }
    const document = chartRuntime.documents[chartDocumentIdForContent(content)];
    if (!document?.symbol) {
      continue;
    }
    symbols[slot.id] = document.symbol;
    symbols[content.id] = document.symbol;
  }
  return symbols;
}

function chartDocumentCommandsForPanelPropChanges(
  before: TiledPanelState,
  after: TiledPanelState
): ChartCommand[] {
  const commands: ChartCommand[] = [];
  for (const slot of after.slots) {
    const content = after.contents[slot.contentId];
    if (!content || content.kind !== "chart") {
      continue;
    }
    const beforeContent = before.contents[slot.contentId];
    const beforeSymbol = readString(beforeContent?.props?.symbol)?.toUpperCase();
    const nextSymbol = readString(content.props?.symbol)?.toUpperCase();
    if (!nextSymbol || nextSymbol === beforeSymbol) {
      continue;
    }
    commands.push(makeChartCommand(
      "chart.symbol.set",
      "llm",
      { panelId: slot.id, chartDocumentId: chartDocumentIdForContent(content) },
      { symbol: nextSymbol }
    ));
  }
  return commands;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function initialMainView(): MainView {
  if (typeof window === "undefined") {
    return { mode: "treemap" };
  }
  return resolveMainViewFromUrl(window.location.href).view;
}

function persistMainView(view: MainView) {
  if (typeof window === "undefined" || view.mode !== "chart") {
    return;
  }
  try {
    window.localStorage.setItem(lastChartSymbolStorageKey, view.symbol);
  } catch {
    // Browsers can disable storage; URL state still carries direct links.
  }
}

function normalizedShortcutSymbols(shortcut: AgentEntityResolveResponse): string[] {
  const values = [...(shortcut.symbols ?? []), shortcut.symbol];
  const symbols: string[] = [];
  for (const value of values) {
    const symbol = normalizeStoredSymbol(value);
    if (symbol && !symbols.includes(symbol)) {
      symbols.push(symbol);
    }
  }
  return symbols;
}

function layoutResolutionMessage(resolution: AgentLayoutResolveResponse): string {
  if (resolution.status === "ui_clarify") {
    return resolution.summary || "어떤 패널을 어떻게 바꿀지 조금 더 구체적으로 말해 주세요.";
  }
  const proposal = resolution.layoutProposal;
  const applied = Boolean(proposal && proposal.autoApply !== false && proposal.commands.length > 0);
  if (applied) {
    if (proposal?.rationale && !isInternalLayoutRationale(proposal.rationale)) {
      return proposal.rationale;
    }
    return resolution.summary || "변경했습니다.";
  }
  if (proposal?.rationale && !isInternalLayoutRationale(proposal.rationale)) {
    return proposal.rationale;
  }
  if (resolution.rationale && !isInternalLayoutRationale(resolution.rationale)) {
    return resolution.rationale;
  }
  return resolution.summary || "변경할 수 없습니다.";
}

function isInternalLayoutRationale(value: string): boolean {
  return /^(The conductor|Closing or removing|UIAgent|Prepared to|The UI agent|LLM actor)/.test(value.trim());
}

function isLikelyChartOpenCommand(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const compacted = text.replace(/\s+/g, "");
  const hasChartTerm = ["차트", "chart", "그래프", "graph"].some((term) => compacted.includes(term));
  const hasOpenTerm = ["보여", "열어", "띄워", "켜", "show", "open"].some((term) => compacted.includes(term)) || /\bchart\b/.test(text);
  const hasAnalysisTerm = ["분석", "뉴스", "원인", "왜", "관계", "비교", "analysis", "analyze", "news", "why", "compare"].some((term) => compacted.includes(term));
  const possibleEntityText = compacted.replace(/차트|그래프|보여줘|보여|열어줘|열어|띄워줘|띄워|켜줘|켜|주세요|좀|chart|graph|show|open|please/g, "");
  return hasChartTerm && hasOpenTerm && !hasAnalysisTerm && possibleEntityText.length > 0;
}

function replaceChatLogEntry(
  setChatLog: Dispatch<SetStateAction<ChatLogEntry[]>>,
  entryId: string,
  text: string
) {
  setChatLog((current) => current.map((entry) => (
    entry.id === entryId
      ? { ...entry, text, pending: false }
      : entry
  )));
}

function currentWatchlistSymbolValues(symbols: readonly ChartSymbolDto[]): string[] {
  const values: string[] = [];
  for (const item of symbols) {
    const symbol = normalizeStoredSymbol(item.symbol);
    if (symbol && !values.includes(symbol)) {
      values.push(symbol);
    }
  }
  return values;
}

function watchlistErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function currentViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1280, height: 720 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function clampTreeMapHeight(height: number, viewportHeight: number): number {
  return Math.round(Math.min(treeMapMaxHeight(viewportHeight), Math.max(treeMapMinHeight(viewportHeight), height)));
}

function chartBottomReservedSpace(): number {
  return bottomNavigationHeight;
}

function treeMapMinHeight(viewportHeight: number): number {
  return Math.min(360, Math.max(260, viewportHeight - chartBottomReservedSpace() - treeMapHoverMetaReserve - 220));
}

function treeMapMaxHeight(viewportHeight: number): number {
  return Math.max(treeMapMinHeight(viewportHeight), viewportHeight - chartBottomReservedSpace() - treeMapHoverMetaReserve - navigationGap);
}

function canResizeTreeMapLayout(viewportHeight = currentViewportSize().height): boolean {
  return treeMapMaxHeight(viewportHeight) > treeMapMinHeight(viewportHeight) + 0.5;
}
