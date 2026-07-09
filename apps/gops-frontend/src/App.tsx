import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAuth } from "./auth/AuthProvider";
import { PresetDock } from "./components/PresetDock";
import { buildPresetLayout, ensurePortfolioInvestedPanelState, migratePortfolioInvestmentSnapshot, type LayoutPreset } from "./layout/layoutPresets";
import { useLayoutPresets } from "./layout/useLayoutPresets";
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
import { agentReferenceChipKind, agentReferenceKey, agentReferenceTicker, buildChartAnalysisContext, chartCandleReference, SEMANTIC_SELECTION_REFERENCE_KEY, type AgentReference, type AgentReferenceChip } from "./agent/agentReferences";
import { publishOntologyReport } from "./ontology/ontologyEvents";
import { BottomCommandBar, type AgentSubmitResult, type BottomMenuKey, type ChatLogEntry } from "./components/BottomCommandBar";
import { type ChartPanelHandle } from "./components/ChartPanel";
import { PanelWorkspace } from "./components/PanelWorkspace";
import { PlacementPickerOverlay } from "./components/PlacementPickerOverlay";
import type { SemanticSelectionSnapshot } from "./chart/semanticTimeline";
import type { ChartState, ChartSymbolDto } from "./chart/types";
import { fetchWatchlist, replaceWatchlistSymbols, WatchlistApiError } from "./chart/watchlistApi";
import { gridGutter } from "./layout/grid";
import {
  createInitialTiledPanelState,
  normalizeFreeformRectsToGridLayout,
  panelLayoutStorageKey,
  restoreTiledPanelStateSnapshot,
  scaleTiledPanelState,
  serializeTiledPanelState,
  setPrimaryChartSymbol,
  workspaceBounds,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./layout/panelLayout";
import { workspaceTopInset } from "./layout/workspaceMetrics";
import {
  createMainViewUrl,
  mainViewsEqual,
  mainViewUrlPath,
  normalizeStoredSymbol,
  resolveMainViewFromUrl,
  type MainView
} from "./navigation/mainViewUrl";
import {
  applyPlacementPickCandidate,
  applyTiledAgentLayoutProposalWithResult,
  buildTiledAgentLayoutContext,
  type PlacementPickCandidate,
  type PendingPlacementPick
} from "./layout/tiledAgentLayout";
import type { AgentLayoutProposal } from "./layout/agentLayoutTypes";
import { fetchMarketHeatmap } from "./market/heatmapApi";
import { normalizeSector, sectorLabelKo } from "./market/sectors";
import { sp500UniverseSeed, type Sp500UniverseItem } from "./market/sp500Universe.seed";
import { TreeMapCanvas } from "./treemap/TreeMapCanvas";


type ActiveAgentRun = {
  requestId: string;
  controller: AbortController;
  pendingEntryId: string;
  cancelRequested: boolean;
};

type InteractiveAgentContext = {
  chartContext: Record<string, unknown>;
  references: AgentReference[];
  uiContext: Record<string, unknown>;
};

type SideRailCompanyItem = {
  symbol: string;
  companyName?: string;
};

const lastChartSymbolStorageKey = "gops:last-chart-symbol";
const agentDebugStorageKey = "gops:agent-debug";
const maxWatchlistSymbols = 10;
const appUiScale = 1.6;
const chartWorkspaceLayoutMetrics: WorkspaceLayoutMetrics = { topInset: workspaceTopInset };

let chatLogEntrySequence = 0;

function initialPanelState(): TiledPanelState {
  if (typeof window === "undefined") {
    return createInitialTiledPanelState({ width: 1280, height: 720 }, {
      layoutMetrics: chartWorkspaceLayoutMetrics
    });
  }
  const viewport = currentViewportSize();
  const initialView = resolveMainViewFromUrl(window.location.href).view;
  try {
    const stored = window.localStorage.getItem(panelLayoutStorageKey);
    if (stored) {
      const restored = restoreTiledPanelStateSnapshot(
        migratePortfolioInvestmentSnapshot(JSON.parse(stored)),
        viewport,
        chartWorkspaceLayoutMetrics
      );
      if (restored) {
        const migrated = ensurePortfolioInvestedPanelState(restored, viewport, {
          layoutMetrics: chartWorkspaceLayoutMetrics
        });
        return initialView.mode === "chart"
          ? setPrimaryChartSymbol(migrated, initialView.symbol, viewport, chartWorkspaceLayoutMetrics)
          : migrated;
      }
    }
  } catch {
    // Invalid local layout state falls back to the default 8x5 workspace.
  }
  return createInitialTiledPanelState(viewport, {
    layoutMetrics: chartWorkspaceLayoutMetrics,
    symbol: initialView.mode === "chart" ? initialView.symbol : undefined
  });
}

function buildInteractiveAgentContext(
  handles: Map<string, ChartPanelHandle>,
  preferredContentId: string | null,
  selection: SemanticSelectionSnapshot | null,
  explicitReferences: AgentReference[]
): InteractiveAgentContext {
  const activeEntry = preferredContentId && handles.has(preferredContentId)
    ? [preferredContentId, handles.get(preferredContentId)!] as const
    : firstChartPanelHandle(handles);
  const chart = activeEntry?.[1].getSnapshot();
  const reference = selection ? chartCandleReference(selection, activeEntry?.[0]) : null;
  const references = [
    ...(reference ? [reference] : []),
    ...explicitReferences
  ];
  return {
    chartContext: chart ? buildChartAnalysisContext(chart, selection) : {},
    references,
    uiContext: {
      activePanelId: activeEntry?.[0] ?? preferredContentId ?? null,
      activePanelType: chart ? "chart" : null,
      selectedReference: references[0] ?? null,
      visibleRange: chart ? chartVisibleRange(chart) : null
    }
  };
}

function firstChartPanelHandle(handles: Map<string, ChartPanelHandle>): readonly [string, ChartPanelHandle] | null {
  for (const entry of handles.entries()) {
    return entry;
  }
  return null;
}

function chartVisibleRange(chart: ChartState): { from: string; to: string } | null {
  if (!chart.candles.length) {
    return null;
  }
  const endIndex = Math.max(0, chart.candles.length - 1 - Math.max(0, chart.rightOffset));
  const startIndex = Math.max(0, endIndex - Math.max(1, chart.visibleCount) + 1);
  const from = chart.candles[startIndex]?.timestamp;
  const to = chart.candles[endIndex]?.timestamp;
  return from && to ? { from, to } : null;
}

function isLocalAgentDebugEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }
  const paramValue = new URLSearchParams(window.location.search).get("agentDebug");
  if (paramValue !== null) {
    const normalized = paramValue.trim().toLowerCase();
    const enabled = normalized === "" || ["1", "true", "yes", "on"].includes(normalized);
    try {
      window.localStorage.setItem(agentDebugStorageKey, enabled ? "1" : "0");
    } catch {
      // Local debug still works for this request even if storage is disabled.
    }
    return enabled;
  }
  try {
    return window.localStorage.getItem(agentDebugStorageKey) === "1";
  } catch {
    return false;
  }
}

function publishLocalAgentDebugSnapshot(
  payload: Record<string, unknown>,
  context: InteractiveAgentContext
): void {
  if (!isLocalAgentDebugEnabled() || typeof window === "undefined") {
    return;
  }
  const snapshot = {
    createdAt: new Date().toISOString(),
    selectedReference: context.references[0] ?? null,
    references: context.references,
    chartContext: context.chartContext,
    uiContext: context.uiContext,
    payload
  };
  const debugWindow = window as Window & {
    __GOPS_AGENT_LAST_REQUEST__?: unknown;
    __GOPS_AGENT_LAST_DEBUG__?: unknown;
  };
  debugWindow.__GOPS_AGENT_LAST_REQUEST__ = payload;
  debugWindow.__GOPS_AGENT_LAST_DEBUG__ = snapshot;
  console.debug("[GOPS Agent Debug] /api/agents/analyze payload", payload);
  console.debug("[GOPS Agent Debug] snapshot", snapshot);
}

function formatAgentDebugSnapshot(
  payload: Record<string, unknown>,
  context: InteractiveAgentContext
): string {
  const chartContext = readObject(payload.chartContext);
  const candles = readArray(chartContext?.candles);
  const visibleRange = readObject(context.uiContext.visibleRange);
  const selectedReference = context.references[0] ?? null;
  const selectedLine = selectedReference ? formatAgentDebugReference(selectedReference) : "없음";
  const referenceTypes = context.references.map((reference) => reference.type).join(", ") || "없음";
  return [
    "Agent Debug (local only)",
    `selectedReference: ${selectedLine}`,
    `references: ${context.references.length} (${referenceTypes})`,
    `chartContext.candles: ${candles.length}${formatAgentDebugCandleRange(candles)}`,
    `visibleRange: ${readString(visibleRange?.from) ?? "-"} -> ${readString(visibleRange?.to) ?? "-"}`,
    `symbol: ${readString(payload.symbol) ?? "-"} / intent: ${readString(payload.intent) ?? "-"}`,
    "raw payload: browser console에서 window.__GOPS_AGENT_LAST_REQUEST__ 확인"
  ].join("\n");
}

function formatAgentDebugReference(reference: AgentReference): string {
  const data = readObject(reference.data);
  const timestamp = readString(data?.timestamp) ?? readString(data?.from) ?? "-";
  const ohlc = ["open", "high", "low", "close"]
    .map((key) => `${key[0]?.toUpperCase() ?? key}: ${formatAgentDebugNumber(readNumber(data?.[key]))}`)
    .join(", ");
  return `${reference.type} ${reference.displayLabel ?? ""} ${timestamp}${ohlc ? ` (${ohlc})` : ""}`.trim();
}

function formatAgentDebugCandleRange(candles: unknown[]): string {
  const first = readObject(candles[0]);
  const last = readObject(candles[candles.length - 1]);
  const from = readString(first?.timestamp);
  const to = readString(last?.timestamp);
  return from && to ? ` (${from} -> ${to})` : "";
}

function formatAgentDebugNumber(value: number | null): string {
  return value === null ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(4);
}

export function App() {
  const [mainView, setMainView] = useState<MainView>(() => initialMainView());
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => currentViewportSize());
  const [panelState, setPanelState] = useState<TiledPanelState>(() => initialPanelState());
  const [semanticSelection, setSemanticSelection] = useState<SemanticSelectionSnapshot | null>(null);
  const [pendingPlacementPick, setPendingPlacementPick] = useState<PendingPlacementPick | null>(null);
  const [agentReferences, setAgentReferences] = useState<AgentReference[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [chatLog, setChatLog] = useState<ChatLogEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chartRuntime, setChartRuntime] = useState<ChartRuntimeState>(() => createInitialChartRuntimeState());
  const [treeMapItems, setTreeMapItems] = useState<Sp500UniverseItem[]>(() => normalizeMarketItems(sp500UniverseSeed));
  const [activeBottomMenu, setActiveBottomMenu] = useState<BottomMenuKey | null>(null);
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState<ChartSymbolDto[]>([]);
  const [watchlistPersisted, setWatchlistPersisted] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [, setWatchlistError] = useState<string | null>(null);
  const [, setWatchlistMessage] = useState<string | null>(null);
  const { authEnabled, user, loading: authLoading, login, logout } = useAuth();
  const chartPanelHandlesRef = useRef<Map<string, ChartPanelHandle>>(new Map());
  const activeAgentRunRef = useRef<ActiveAgentRun | null>(null);
  const watchlistSavingRef = useRef(false);
  const treeMapLayoutAsOfRef = useRef<string | null>(null);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const panelLayoutMetricsRef = useRef<WorkspaceLayoutMetrics>(chartWorkspaceLayoutMetrics);

  const serializeCurrentLayout = useCallback(() => (
    serializeTiledPanelState(
      normalizeFreeformRectsToGridLayout(panelState, viewportSizeRef.current, panelLayoutMetricsRef.current)
    )
  ), [panelState]);
  const resolvePresetSymbol = useCallback((): string => {
    try {
      return normalizeStoredSymbol(window.localStorage.getItem(lastChartSymbolStorageKey) ?? "") || "MSFT";
    } catch {
      return "MSFT";
    }
  }, []);
  const applyPresetLayout = useCallback((state: TiledPanelState) => {
    setPanelState(state);
    // Applying a preset from the home (treemap) view jumps into the chart workspace,
    // using the last chart symbol (or MSFT when none is stored).
    if (mainView.mode !== "chart") {
      openSymbolPage(resolvePresetSymbol());
    }
  }, [mainView, resolvePresetSymbol]);
  const buildPresetLayoutForCurrent = useCallback((preset: LayoutPreset) => (
    buildPresetLayout(preset, viewportSizeRef.current, {
      symbol: mainView.mode === "chart" ? mainView.symbol : resolvePresetSymbol(),
      layoutMetrics: panelLayoutMetricsRef.current
    })
  ), [mainView, resolvePresetSymbol]);
  const presetControls = useLayoutPresets({
    authUser: user,
    authLoading,
    serializeCurrentLayout,
    applyLayout: applyPresetLayout,
    buildLayout: buildPresetLayoutForCurrent
  });
  const [emphasizedReferenceKeys, setEmphasizedReferenceKeys] = useState<string[]>([]);
  const selectedAgentReferenceKeys = useMemo(() => (
    agentReferences.map((reference) => agentReferenceKey(reference))
  ), [agentReferences]);
  const agentReferenceChips = useMemo<AgentReferenceChip[]>(() => {
    const chips: AgentReferenceChip[] = agentReferences.map((reference) => ({
      key: agentReferenceKey(reference),
      kind: agentReferenceChipKind(reference),
      ticker: agentReferenceTicker(reference)
    }));
    if (semanticSelection) {
      // The active chart candle sits closest to the input (rendered last in the strip).
      chips.push({
        key: SEMANTIC_SELECTION_REFERENCE_KEY,
        kind: "candle",
        ticker: semanticSelection.symbol
      });
    }
    return chips;
  }, [agentReferences, semanticSelection]);
  const emphasizedAgentReferenceKeys = useMemo(() => (
    emphasizedReferenceKeys.filter((key) => key !== SEMANTIC_SELECTION_REFERENCE_KEY)
  ), [emphasizedReferenceKeys]);
  const emphasizeChartSelection = emphasizedReferenceKeys.includes(SEMANTIC_SELECTION_REFERENCE_KEY);

  const applyMainViewState = useCallback((nextView: MainView, options: { closeBottomMenu?: boolean } = {}) => {
    setSemanticSelection(null);
    if (options.closeBottomMenu || nextView.mode === "treemap") {
      setActiveBottomMenu(null);
    }
    if (nextView.mode === "treemap") {
      chartPanelHandlesRef.current.clear();
      setLayoutEditMode(false);
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

  useEffect(() => {
    const handleResize = () => {
      const previous = viewportSizeRef.current;
      const next = currentViewportSize();
      viewportSizeRef.current = next;
      setViewportSize(next);
      setPanelState((current) => scaleTiledPanelState(
        current,
        previous,
        next,
        panelLayoutMetricsRef.current,
        panelLayoutMetricsRef.current
      ));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const layoutGutter = gridGutter(viewportSize.width);
  const workspaceStyle = {
    "--app-ui-scale": appUiScale,
    "--app-logical-width": `${viewportSize.width}px`,
    "--app-logical-height": `${viewportSize.height}px`,
    "--layout-gutter": `${layoutGutter}px`
  } as CSSProperties;
  // The tree map occupies the same bounds as the panel workspace (page-edge gutter margins,
  // bottom aligned with where panels end).
  // The tree map uses the same top/bottom workspace bounds as panels, so the compact header
  // owns the top strip instead of overlaying the canvas.
  const treeMapBounds = workspaceBounds(viewportSize, panelLayoutMetricsRef.current);
  const isCompactHeatmapBackground = viewportSize.width < 700;
  const heatMapBackgroundWidth = Math.max(
    isCompactHeatmapBackground ? 740 : 1220,
    viewportSize.width * (isCompactHeatmapBackground ? 1.9 : 1.48)
  );
  const heatMapBackgroundHeight = Math.max(
    isCompactHeatmapBackground ? 560 : 760,
    viewportSize.height * (isCompactHeatmapBackground ? 1.02 : 1.08)
  );
  const heatMapBackgroundStyle: CSSProperties = {
    top: Math.round(viewportSize.height * (isCompactHeatmapBackground ? -0.03 : -0.04)),
    left: Math.round((viewportSize.width - heatMapBackgroundWidth) / 2),
    width: Math.round(heatMapBackgroundWidth),
    height: Math.round(heatMapBackgroundHeight)
  };
  const treeMapLaneStyle: CSSProperties = {
    top: treeMapBounds.top,
    left: layoutGutter,
    width: Math.max(1, viewportSize.width - layoutGutter * 2),
    height: Math.max(1, treeMapBounds.height)
  };

  const universeSymbols = useMemo((): ChartSymbolDto[] => treeMapItems.map((item) => ({
    symbol: item.symbol,
    name: item.companyName,
    sector: item.sector,
    isMock: item.symbol === "TSLA" || item.symbol === "AAPL" || item.symbol === "GOOGL"
  })), [treeMapItems]);
  const activePageSymbol = mainView.mode === "chart" ? mainView.symbol : "";
  const sideRailCompanyItem = useMemo(() => (
    mainView.mode === "chart" ? buildSideRailCompanyItem(treeMapItems, activePageSymbol) : null
  ), [activePageSymbol, mainView.mode, treeMapItems]);
  const panelLayoutMetrics = chartWorkspaceLayoutMetrics;
  const effectivePanelState = useMemo(() => (
    ensurePortfolioInvestedPanelState(panelState, viewportSize, { layoutMetrics: panelLayoutMetrics })
  ), [panelLayoutMetrics, panelState, viewportSize]);
  const chartDocumentSymbolsByPanelId = useMemo(() => (
    chartDocumentSymbolsForLayout(effectivePanelState, chartRuntime)
  ), [chartRuntime, effectivePanelState]);
  const canUseAgent = !authLoading && (!authEnabled || Boolean(user));
  const canEditWatchlist = !authLoading && (!authEnabled || Boolean(user));
  const visibleWatchlistSymbols = canEditWatchlist ? watchlistSymbols : universeSymbols.slice(0, 24);

  useEffect(() => {
    if (effectivePanelState !== panelState) {
      setPanelState(effectivePanelState);
    }
  }, [effectivePanelState, panelState]);

  useEffect(() => {
    const previousMetrics = panelLayoutMetricsRef.current;
    if (workspaceLayoutMetricsEqual(previousMetrics, panelLayoutMetrics)) {
      return;
    }
    panelLayoutMetricsRef.current = panelLayoutMetrics;
    setPanelState((current) => scaleTiledPanelState(
      current,
      viewportSizeRef.current,
      viewportSizeRef.current,
      previousMetrics,
      panelLayoutMetrics
    ));
  }, [panelLayoutMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const normalized = normalizeFreeformRectsToGridLayout(
        panelState,
        viewportSizeRef.current,
        panelLayoutMetricsRef.current
      );
      window.localStorage.setItem(panelLayoutStorageKey, JSON.stringify(serializeTiledPanelState(normalized)));
    } catch {
      // Layout edits remain in memory if browser storage is unavailable.
    }
  }, [panelState]);

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
    setChartRuntime(createInitialChartRuntimeState());
    setPanelState((current) => setPrimaryChartSymbol(
      current,
      normalizedSymbol,
      viewportSizeRef.current,
      panelLayoutMetricsRef.current
    ));
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
    const preview = applyTiledAgentLayoutProposalWithResult(panelState, proposal, viewportSizeRef.current, panelLayoutMetricsRef.current);
    if (preview.pendingPlacementPick) {
      setPendingPlacementPick(preview.pendingPlacementPick);
      setChatLog((entries) => [
        ...entries,
        createChatLogEntry("assistant", placementPickMessage(preview.pendingPlacementPick!))
      ]);
      return;
    }
    setPanelState((current) => {
      const result = applyTiledAgentLayoutProposalWithResult(current, proposal, viewportSizeRef.current, panelLayoutMetricsRef.current);
      const next = result.state;
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
  }, [panelState]);

  const handlePlacementPickSelect = useCallback((candidate: PlacementPickCandidate) => {
    const pick = pendingPlacementPick;
    if (!pick) {
      return;
    }
    setPanelState((current) => {
      const next = applyPlacementPickCandidate(current, pick, candidate, viewportSizeRef.current, panelLayoutMetricsRef.current);
      const commands = chartDocumentCommandsForPanelPropChanges(current, next);
      if (commands.length) {
        setChartRuntime((runtime) => {
          const activeCommands = commands.filter((command) => runtime.documents[command.target.chartDocumentId]);
          return activeCommands.length
            ? chartRuntimeReducer(runtime, { kind: "chart.command.group", commands: activeCommands, label: "Apply picked layout chart props" })
            : runtime;
        });
      }
      return next;
    });
    setPendingPlacementPick(null);
    setChatLog((current) => [
      ...current,
      createChatLogEntry("assistant", `${candidate.label} 배치로 적용했습니다.`)
    ]);
  }, [pendingPlacementPick]);

  const handlePlacementPickCancel = useCallback(() => {
    setPendingPlacementPick(null);
    setChatLog((current) => [
      ...current,
      createChatLogEntry("assistant", "배치를 취소했습니다.")
    ]);
  }, []);

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
          setTreeMapItems((current) => mergeTreeMapItems(current, normalizeMarketItems(payload.items), shouldUpdateLayout));
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
    setActiveBottomMenu((current) => (current === key ? null : key));
  };

  const toggleLayoutEditMode = () => {
    if (mainView.mode !== "chart") {
      return;
    }
    setActiveBottomMenu(null);
    if (!layoutEditMode) {
      setPanelState((current) => normalizeFreeformRectsToGridLayout(
        current,
        viewportSizeRef.current,
        panelLayoutMetricsRef.current
      ));
    }
    setLayoutEditMode((current) => !current);
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

  const handleAgentReferenceSelect = useCallback((reference: AgentReference) => {
    const key = agentReferenceKey(reference);
    setAgentReferences((current) => {
      if (current.some((item) => agentReferenceKey(item) === key)) {
        return current.filter((item) => agentReferenceKey(item) !== key);
      }
      return [reference, ...current].slice(0, 5);
    });
  }, []);

  // The chart owns its candle-highlight state internally, so clearing the App-level
  // selection is not enough — tell every chart panel to drop its selected candle too.
  const clearChartSemanticSelections = useCallback(() => {
    chartPanelHandlesRef.current.forEach((handle) => handle.clearSemanticSelection());
  }, []);

  const clearAgentReferences = useCallback(() => {
    setAgentReferences([]);
    setSemanticSelection(null);
    setEmphasizedReferenceKeys([]);
    clearChartSemanticSelections();
  }, [clearChartSemanticSelections]);

  const removeAgentReference = useCallback((key: string) => {
    if (key === SEMANTIC_SELECTION_REFERENCE_KEY) {
      setSemanticSelection(null);
      clearChartSemanticSelections();
    } else {
      setAgentReferences((current) => current.filter((item) => agentReferenceKey(item) !== key));
    }
    setEmphasizedReferenceKeys((current) => current.filter((item) => item !== key));
  }, [clearChartSemanticSelections]);

  const emphasizeAgentReferences = useCallback((keys: string[]) => {
    setEmphasizedReferenceKeys(keys);
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
          let nextPanelState = panelState;
          const workingLayoutMetrics = panelLayoutMetricsRef.current;
          const addedSymbols: string[] = [];
          for (const addSymbol of shortcutSymbols) {
            if (chartSymbolsForPanelState(nextPanelState, chartDocumentSymbolsByPanelId, primarySymbol).includes(addSymbol)) {
              continue;
            }
            const layoutResolution = await resolveAgentLayoutCommand({
              symbol: addSymbol,
              intent: prompt,
              routerMode: "hybrid",
              messages: [{ role: "user", content: prompt }],
              chartAction: "add",
              chartTargetSymbol: addSymbol,
              chartPlacementIntent: shortcut.chartPlacementIntent,
              layoutContext: buildTiledAgentLayoutContext(
                nextPanelState,
                viewportSize,
                primarySymbol,
                firstChartSlotId(nextPanelState),
                chartDocumentSymbolsByPanelId,
                workingLayoutMetrics
              )
            });
            if (layoutResolution?.status !== "ui_layout" || !layoutResolution.layoutProposal) {
              throw new Error(`${addSymbol} 차트 패널을 추가할 수 없습니다.`);
            }
            const applyResult = applyTiledAgentLayoutProposalWithResult(
              nextPanelState,
              layoutResolution.layoutProposal,
              viewportSizeRef.current,
              workingLayoutMetrics
            );
            if (applyResult.pendingPlacementPick) {
              const pick = applyResult.pendingPlacementPick;
              setPendingPlacementPick(pick);
              setChatLog((current) => [
                ...current,
                userEntry,
                createChatLogEntry("assistant", placementPickMessage(pick))
              ]);
              return "chat-log";
            }
            nextPanelState = applyResult.state;
            addedSymbols.push(addSymbol);
          }
          setSemanticSelection(null);
          if (addedSymbols.length) {
            setPanelState(nextPanelState);
          }
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
            layoutContext: buildTiledAgentLayoutContext(
              panelState,
              viewportSize,
              mainView.symbol,
              undefined,
              chartDocumentSymbolsByPanelId,
              panelLayoutMetricsRef.current
            )
          });
          if (layoutResolution?.status === "ui_layout" && layoutResolution.layoutProposal) {
            const preview = applyTiledAgentLayoutProposalWithResult(
              panelState,
              layoutResolution.layoutProposal,
              viewportSizeRef.current,
              panelLayoutMetricsRef.current
            );
            if (preview.pendingPlacementPick) {
              setPendingPlacementPick(preview.pendingPlacementPick);
              setChatLog((current) => [
                ...current,
                userEntry,
                createChatLogEntry("assistant", placementPickMessage(preview.pendingPlacementPick!))
              ]);
              return "chat-log";
            }
            setPanelState((current) => {
              const result = applyTiledAgentLayoutProposalWithResult(
                current,
                layoutResolution.layoutProposal!,
                viewportSizeRef.current,
                panelLayoutMetricsRef.current
              );
              const commands = chartDocumentCommandsForPanelPropChanges(current, result.state);
              if (commands.length) {
                setChartRuntime((runtime) => {
                  const activeCommands = commands.filter((command) => runtime.documents[command.target.chartDocumentId]);
                  return activeCommands.length
                    ? chartRuntimeReducer(runtime, { kind: "chart.command.group", commands: activeCommands, label: "Apply layout chart props" })
                    : runtime;
                });
              }
              return result.state;
            });
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
      setAgentBusy(true);
      try {
        const interactiveContext = buildInteractiveAgentContext(
          chartPanelHandlesRef.current,
          null,
          semanticSelection,
          agentReferences
        );
        const analysisPayload = {
          symbol: mainView.symbol,
          intent: prompt,
          routerMode: "hybrid",
          messages: [{ role: "user", content: prompt }],
          chartContext: interactiveContext.chartContext,
          references: interactiveContext.references,
          uiContext: interactiveContext.uiContext,
          layoutContext: buildTiledAgentLayoutContext(
            panelState,
            viewportSize,
            mainView.symbol,
            undefined,
            chartDocumentSymbolsByPanelId,
            panelLayoutMetricsRef.current
          )
        };
        const layoutResolution = await resolveAgentLayoutCommand(analysisPayload);
        if (layoutResolution?.status === "ui_layout") {
          if (layoutResolution.layoutProposal) {
            const preview = applyTiledAgentLayoutProposalWithResult(
              panelState,
              layoutResolution.layoutProposal,
              viewportSizeRef.current,
              panelLayoutMetricsRef.current
            );
            if (preview.pendingPlacementPick) {
              setPendingPlacementPick(preview.pendingPlacementPick);
              setChatLog((current) => [
                ...current,
                userEntry,
                createChatLogEntry("assistant", placementPickMessage(preview.pendingPlacementPick!))
              ]);
              return;
            }
            setPanelState((current) => {
              const result = applyTiledAgentLayoutProposalWithResult(
                current,
                layoutResolution.layoutProposal!,
                viewportSizeRef.current,
                panelLayoutMetricsRef.current
              );
              return result.state;
            });
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

      const pendingEntry = createChatLogEntry("assistant", "Agent가 분석을 시작했습니다.", true);
      setAgentBusy(true);
      try {
        const interactiveContext = buildInteractiveAgentContext(
          chartPanelHandlesRef.current,
          null,
          semanticSelection,
          agentReferences
        );
        const controller = new AbortController();
        const requestId = createAgentAnalysisRequestId();
        const activeRun: ActiveAgentRun = {
          requestId,
          controller,
          pendingEntryId: pendingEntry.id,
          cancelRequested: false
        };
        activeAgentRunRef.current = activeRun;
        const analysisRequestPayload = {
          symbol: mainView.symbol,
          intent: prompt,
          routerMode: "hybrid",
          messages: [{ role: "user", content: prompt }],
          chartContext: interactiveContext.chartContext,
          references: interactiveContext.references,
          uiContext: interactiveContext.uiContext,
          layoutContext: buildTiledAgentLayoutContext(
            panelState,
            viewportSize,
            mainView.symbol,
            undefined,
            chartDocumentSymbolsByPanelId,
            panelLayoutMetricsRef.current
          )
        };
        publishLocalAgentDebugSnapshot(analysisRequestPayload, interactiveContext);
        const debugEntry = isLocalAgentDebugEnabled()
          ? createChatLogEntry("system", formatAgentDebugSnapshot(analysisRequestPayload, interactiveContext))
          : null;
        setChatLog((current) => [
          ...current,
          userEntry,
          ...(debugEntry ? [debugEntry] : []),
          pendingEntry
        ]);
        const report = await requestAgentAnalysisPayload(analysisRequestPayload, {
          requestId,
          signal: controller.signal,
          onAccepted: (accepted) => {
            activeRun.requestId = accepted.analysisId;
          }
        });
        if (report.layoutProposal) {
          applyAgentLayoutProposal(report.layoutProposal);
        }
        replaceChatLogEntry(setChatLog, pendingEntry.id, formatAgentAnalysisForChat(report), report.finalResponse?.confidence, report);
        publishOntologyReport({ symbol: report.symbol, providerEvidence: report.providerEvidence ?? [] });
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
  }, [agentBusy, agentInput, agentReferences, applyAgentLayoutProposal, authLoading, canUseAgent, chartDocumentSymbolsByPanelId, mainView, navigateMainView, openSymbolPage, panelState, semanticSelection, viewportSize]);


  return (
    <main className="app-shell" style={workspaceStyle}>
      <div className="heatmap-background-layer" aria-hidden="true">
        <TreeMapCanvas
          items={treeMapItems}
          style={heatMapBackgroundStyle}
          className="treemap-background-panel"
          interactive={false}
        />
      </div>
      <section className={`canvas-workspace view-${mainView.mode}`} style={workspaceStyle}>
        {mainView.mode === "treemap" ? (
          <>
            <TreeMapCanvas items={treeMapItems} onSelectSymbol={openSymbolPage} style={treeMapLaneStyle} />
          </>
        ) : (
          <PanelWorkspace
            panelState={effectivePanelState}
            setPanelState={setPanelState}
            viewportSize={viewportSize}
            layoutMetrics={panelLayoutMetrics}
            layoutEditMode={layoutEditMode}
            activeSymbol={mainView.symbol}
            symbols={universeSymbols}
            companyItems={treeMapItems}
            marketItems={treeMapItems}
            chartRuntime={chartRuntime}
            selectedAgentReferenceKeys={selectedAgentReferenceKeys}
            emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
            emphasizeChartSelection={emphasizeChartSelection}
            setSemanticSelection={setSemanticSelection}
            onAgentReferenceSelect={handleAgentReferenceSelect}
            onChartRuntimeAction={dispatchChartRuntimeAction}
            onChartHandleChange={handleChartHandleChange}
            onSyncPageSymbolFromChart={syncPageSymbolFromChart}
            onSelectSymbol={openSymbolPage}
            presetDock={(
              <PresetDock
                controls={presetControls}
                onShowHome={showTreeMap}
                onEnterLayoutEdit={toggleLayoutEditMode}
              />
            )}
            placementPickerOverlay={pendingPlacementPick ? (
              <PlacementPickerOverlay
                pick={pendingPlacementPick}
                viewportSize={viewportSize}
                layoutMetrics={panelLayoutMetrics}
                onSelect={handlePlacementPickSelect}
                onCancel={handlePlacementPickCancel}
              />
            ) : null}
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
        agentReferenceChips={agentReferenceChips}
        symbols={universeSymbols}
        watchlistSymbols={visibleWatchlistSymbols}
        watchlistPersisted={watchlistPersisted}
        watchlistLoading={watchlistLoading}
        watchlistSaving={watchlistSaving}
        canEditWatchlist={canEditWatchlist}
        activeSymbol={activePageSymbol}
        sideRailCompany={sideRailCompanyItem}
        isChartMode={mainView.mode === "chart"}
        layoutEditMode={layoutEditMode}
        onAgentInputChange={setAgentInput}
        onAgentCancel={cancelActiveAgentRun}
        onAgentReferencesClear={clearAgentReferences}
        onAgentReferenceRemove={removeAgentReference}
        onAgentReferenceEmphasize={emphasizeAgentReferences}
        onAgentSubmit={runAgentPrompt}
        onAddWatchlistSymbol={addWatchlistSymbol}
        onCloseMenu={() => setActiveBottomMenu(null)}
        onLogin={login}
        onLogout={() => void logout()}
        onReorderWatchlistSymbol={reorderWatchlistSymbol}
        onRemoveWatchlistSymbol={removeWatchlistSymbol}
        onSelectSymbol={openSymbolPage}
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

function normalizeMarketItems(items: readonly Sp500UniverseItem[]): Sp500UniverseItem[] {
  return items.map((item) => {
    const sector = normalizeSector(item.sector);
    return {
      ...item,
      sector,
      sectorLabelKo: item.sectorLabelKo || sectorLabelKo(sector)
    };
  });
}

function buildSideRailCompanyItem(
  items: readonly Sp500UniverseItem[],
  activeSymbol: string
): SideRailCompanyItem | null {
  const symbol = normalizeStoredSymbol(activeSymbol);
  if (!symbol) {
    return null;
  }
  for (const item of items) {
    if (normalizeStoredSymbol(item.symbol) !== symbol) {
      continue;
    }
    return {
      symbol,
      companyName: item.companyName
    };
  }
  return { symbol, companyName: symbol };
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

function chartSymbolsForPanelState(
  panelState: TiledPanelState,
  documentSymbols: Record<string, string | undefined>,
  fallbackSymbol: string
): string[] {
  const symbols: string[] = [];
  for (const slot of panelState.slots) {
    const content = panelState.contents[slot.contentId];
    if (!content || content.kind !== "chart") {
      continue;
    }
    const symbol = normalizeStoredSymbol(
      documentSymbols[slot.id] ??
      documentSymbols[content.id] ??
      readString(content.props?.symbol) ??
      fallbackSymbol
    );
    if (symbol && !symbols.includes(symbol)) {
      symbols.push(symbol);
    }
  }
  return symbols;
}

function firstChartSlotId(panelState: TiledPanelState): string | undefined {
  return panelState.slots.find((slot) => panelState.contents[slot.contentId]?.kind === "chart")?.id;
}

function workspaceLayoutMetricsEqual(left: WorkspaceLayoutMetrics, right: WorkspaceLayoutMetrics): boolean {
  return left.topInset === right.topInset && left.bottomInset === right.bottomInset;
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function placementPickMessage(pick: PendingPlacementPick): string {
  const subject = pick.symbol ? `${pick.symbol} 차트` : "차트";
  const labels = pick.candidates.map((candidate, index) => `${index + 1}. ${candidate.label}`).join(" / ");
  return `${subject}를 배치할 위치를 선택해 주세요. ${labels}`;
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
  text: string,
  confidence?: number,
  analysisReport?: ChatLogEntry["analysisReport"]
) {
  setChatLog((current) => current.map((entry) => (
    entry.id === entryId
      ? { ...entry, text, pending: false, confidence, analysisReport }
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
  return {
    width: Math.max(1, Math.round(window.innerWidth / appUiScale)),
    height: Math.max(1, Math.round(window.innerHeight / appUiScale))
  };
}
