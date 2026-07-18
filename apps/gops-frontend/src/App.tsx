import {
  type CSSProperties,
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAuth } from "./auth/AuthProvider";
import { submitAlertCommand } from "./alerts/alertApi";
import { PresetDock } from "./components/PresetDock";
import { applyLayoutLoadProposalToPresets, buildAgentLayoutPresetSummaries, buildPresetLayout, ensurePortfolioInvestedPanelState, isLikelyPresetLoadPrompt, migrateCompanyComparePanelSnapshot, migratePortfolioInvestmentSnapshot, resetChartAnalysisDefaultSymbol, type LayoutLoadPresetResult, type LayoutPreset } from "./layout/layoutPresets";
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
  isAgentRequestAbortError,
  requestAgentAnalysisPayload,
  resolveAgentChartShortcut,
  resolveAgentLayoutCommand,
  type AgentEntityResolveResponse,
  type AgentLayoutResolveResponse
} from "./agent/agentAnalysisClient";
import { agentReferenceChipKind, agentReferenceKey, agentReferenceTicker, buildChartAnalysisContext, chartReferenceForSelection, SEMANTIC_SELECTION_REFERENCE_KEY, type AgentReference, type AgentReferenceChip } from "./agent/agentReferences";
import { agentReportCompletionMessage, type AgentHeaderNotice, type AgentHeaderNoticeTone } from "./agent/agentHeaderNotice";
import { resolveWatchlistAgentCommand } from "./agent/watchlistAgentCommand";
import {
  attachChartCommentaryReport,
  beginChartCommentaryRequest,
  clearChartCommentaryPending,
  updateChartCommentaryRequestId,
  type ChartCommentaryRequestSnapshot
} from "./agent/chartCommentaryHistory";
import { publishOntologyReport } from "./ontology/ontologyEvents";
import { BottomCommandBar } from "./components/BottomCommandBar";
import { type ChartPanelHandle } from "./components/ChartPanel";
import { PanelWorkspace } from "./components/PanelWorkspace";
import { PlacementPickerOverlay } from "./components/PlacementPickerOverlay";
import {
  loadCompanyCompareSelections,
  migratePanelCompareSelections,
  normalizeCompanyCompareSymbols,
  normalizeCompanySymbol,
  persistCompanyCompareSelections,
  type CompanyCompareSelectionState
} from "./companyCompare/companyCompareSelection";
import type { SemanticSelectionSnapshot } from "./chart/semanticTimeline";
import type { AnalysisAssetInterval } from "./chart/analysisAssetsApi";
import {
  chartPriceSelectionMatchesTradeSetup,
  createTradeAutomationConfirmationDraft,
  priceConditionInputFromTradeAutomationDraft,
  resolveTradeAutomationCommandIntent,
  tradeAutomationDraftMatchesSnapshot,
  type ChartPriceSelection,
  type ChartTradeSetupSnapshot,
  type TradeAutomationConfirmationDraft
} from "./chart/chartTradeAutomation";
import { addWatchlistSymbol } from "./chart/watchlistApi";
import {
  getChartTradeSetupSnapshot,
  subscribeChartTradeSetup
} from "./chart/chartTradeSetupStore";
import type { ChartState, ChartSymbolDto } from "./chart/types";
import { gridGutter } from "./layout/grid";
import {
  createInitialTiledPanelState,
  createTiledPanelStateFromSpec,
  ensurePrimaryChartSelection,
  ensurePrimaryChartSymbol,
  normalizeFreeformRectsToGridLayout,
  panelLayoutStorageKey,
  restoreTiledPanelStateSnapshot,
  scaleTiledPanelState,
  serializeTiledPanelState,
  setCompanyInformationSymbol,
  setPanelContentProps,
  setPrimaryChartView,
  syncPrimaryChartSymbol,
  workspaceBounds,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./layout/panelLayout";
import { panelKindForAgentType, panelRegistryEntry } from "./layout/panelRegistry";
import {
  incidentResponseAnalysisIntent,
  incidentResponseLayoutPreset,
  incidentResponseTransitionDelayMs,
  isIncidentResponsePrompt,
  prepareIncidentResponseLayout
} from "./layout/incidentResponsePreset";
import { resolveResponsivePanelLayout } from "./layout/responsivePanelLayout";
import { workspaceTopInset } from "./layout/workspaceMetrics";
import {
  createMainViewUrl,
  mainViewsEqual,
  mainViewUrlPath,
  normalizeStoredSymbol,
  resolveMainViewFromUrl,
  type MainView,
  type MainViewUrlResolution
} from "./navigation/mainViewUrl";
import {
  agentLayoutApplySucceeded,
  applyPlacementPickCandidate,
  applyTiledAgentLayoutProposalWithResult,
  buildTiledAgentLayoutContext,
  type ApplyTiledAgentLayoutResult,
  type PlacementPickCandidate,
  type PendingPlacementPick
} from "./layout/tiledAgentLayout";
import type { AgentLayoutProposal } from "./layout/agentLayoutTypes";
import { fetchMarketHeatmap } from "./market/heatmapApi";
import {
  shouldResetMarketDataForSimulatorTransition,
  simulatorStatusEvent,
  type SimulatorStatus
} from "./simulator/simulatorApi";
import { normalizeSector, sectorLabelKo } from "./market/sectors";
import { sp500UniverseSeed, type Sp500UniverseItem } from "./market/sp500Universe.seed";
import { TreeMapCanvas } from "./treemap/TreeMapCanvas";
import { GlossaryTooltip } from "./glossary/GlossaryTooltip";
import { RelatedIndexTooltip } from "./components/RelatedIndexTooltip";
import type { AgentAnalysisReport } from "./agents/agentAnalysis";
import { addAgentReportToWildPanel, resolveWildPanelSlotId } from "./layout/wildPanel";
import { resolveRecommendationCompanyNavigation } from "./recommendations/recommendationNavigation";
import type { StockRecommendationSelection } from "./recommendations/StockRecommendationsPanel";

const TradeAutomationConfirmationDialog = lazy(() => import("./components/TradeAutomationConfirmationDialog")
  .then((module) => ({ default: module.TradeAutomationConfirmationDialog })));

type ActiveAgentRun = {
  requestId: string;
  controller: AbortController;
  cancelRequested: boolean;
  chartDocumentId?: string;
};

type PendingIncidentResponseTransition = {
  cancelRequested: boolean;
};

type AgentSubmitResult = "notice" | "chart-shortcut" | "ui-action" | "ignored";

type InteractiveAgentContext = {
  chartContext: Record<string, unknown>;
  references: AgentReference[];
  uiContext: Record<string, unknown>;
};

const lastChartSymbolStorageKey = "gops:last-chart-symbol";

function isLikelyAlertCommand(value: string): boolean {
  const text = value.toLowerCase();
  return ["알림", "알람", "alert"].some((keyword) => text.includes(keyword));
}

function hasExplicitLayoutSyntax(value: string): boolean {
  const text = value.toLowerCase();
  return ["패널", "레이아웃", "화면", "배치", "크게", "작게", "열어", "닫아", "layout", "panel"].some((keyword) => text.includes(keyword));
}
const agentDebugStorageKey = "gops:agent-debug";
const appUiScale = 0.8;
const chartWorkspaceLayoutMetrics: WorkspaceLayoutMetrics = {
  topInset: workspaceTopInset,
  uiScale: appUiScale
};
const orderFlowDemoDefaultSymbol = "NVDA";
const companyJournalPreviewDefaultSymbol = "NVDA";

function initialPanelState(): TiledPanelState {
  if (typeof window === "undefined") {
    return createInitialTiledPanelState({ width: 1280, height: 720 }, {
      layoutMetrics: chartWorkspaceLayoutMetrics
    });
  }
  const viewport = currentViewportSize();
  const responsiveLayout = resolveResponsivePanelLayout(viewport, chartWorkspaceLayoutMetrics);
  const initialView = resolveAppMainViewFromUrl(window.location.href).view;
  if (isCompanyJournalPreviewRoute(window.location.href)) {
    return createCompanyJournalPreviewPanelState(
      viewport,
      initialView.mode === "chart" ? initialView.symbol : companyJournalPreviewDefaultSymbol
    );
  }
  if (isOrderFlowDemoRoute(window.location.href)) {
    return createOrderFlowDemoPanelState(
      viewport,
      initialView.mode === "chart" ? initialView.symbol : orderFlowDemoDefaultSymbol
    );
  }
  try {
    const stored = window.localStorage.getItem(panelLayoutStorageKey);
    if (stored) {
      const restored = restoreTiledPanelStateSnapshot(
        migrateCompanyComparePanelSnapshot(
          migratePortfolioInvestmentSnapshot(JSON.parse(stored))
        ),
        viewport,
        responsiveLayout.metrics
      );
      if (restored) {
        const migrated = ensurePortfolioInvestedPanelState(restored, viewport, {
          layoutMetrics: responsiveLayout.metrics
        });
        return initialView.mode === "chart"
          ? syncPrimaryChartSymbol(migrated, initialView.symbol)
          : migrated;
      }
    }
  } catch {
    // Invalid local layout state falls back to the default 8x6 workspace.
  }
  return createInitialTiledPanelState(viewport, {
    layoutMetrics: responsiveLayout.metrics,
    symbol: initialView.mode === "chart" ? initialView.symbol : undefined
  });
}

function createCompanyJournalPreviewPanelState(viewport: ViewportSize, symbol: string): TiledPanelState {
  const normalizedSymbol = normalizeStoredSymbol(symbol) || companyJournalPreviewDefaultSymbol;
  return createTiledPanelStateFromSpec([
    {
      kind: "companyJournal",
      gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 6 },
      props: { symbol: normalizedSymbol },
      layoutWeight: 100
    }
  ], viewport, {
    symbol: normalizedSymbol,
    layoutMetrics: resolveResponsivePanelLayout(viewport, chartWorkspaceLayoutMetrics).metrics
  });
}

function createOrderFlowDemoPanelState(viewport: ViewportSize, symbol: string): TiledPanelState {
  const normalizedSymbol = normalizeStoredSymbol(symbol) || orderFlowDemoDefaultSymbol;
  return createTiledPanelStateFromSpec([
    {
      kind: "chart",
      gridRect: { col: 1, row: 1, colSpan: 5, rowSpan: 6 },
      symbol: normalizedSymbol,
      props: { symbol: normalizedSymbol, timeframe: "1D" },
      layoutWeight: 100
    },
    {
      kind: "orderFlow",
      gridRect: { col: 6, row: 1, colSpan: 3, rowSpan: 2 },
      props: { symbol: normalizedSymbol, window: "10m", resolution: "auto" },
      layoutWeight: 45
    },
    {
      kind: "orderFlow",
      gridRect: { col: 6, row: 3, colSpan: 3, rowSpan: 2 },
      props: { symbol: "AMZN", window: "10m", resolution: "auto" },
      layoutWeight: 45
    },
    {
      kind: "orderFlow",
      gridRect: { col: 6, row: 5, colSpan: 3, rowSpan: 2 },
      props: { symbol: normalizedSymbol, window: "10m", resolution: "auto" },
      layoutWeight: 45
    }
  ], viewport, {
    symbol: normalizedSymbol,
    layoutMetrics: resolveResponsivePanelLayout(viewport, chartWorkspaceLayoutMetrics).metrics
  });
}

function buildInteractiveAgentContext(
  handles: Map<string, ChartPanelHandle>,
  preferredContentId: string | null,
  selection: SemanticSelectionSnapshot | null,
  explicitReferences: AgentReference[]
): InteractiveAgentContext {
  const selectionEntry = selection ? chartPanelHandleForSelection(handles, selection) : null;
  const activeEntry = selectionEntry ?? (preferredContentId && handles.has(preferredContentId)
    ? [preferredContentId, handles.get(preferredContentId)!] as const
    : firstChartPanelHandle(handles));
  const chart = activeEntry?.[1].getSnapshot();
  const reference = chart && selection ? chartReferenceForSelection(chart, selection, activeEntry?.[0]) : null;
  const references = [
    ...(reference ? [reference] : []),
    ...explicitReferences
  ];
  return {
    chartContext: chart ? buildChartAnalysisContext(
      chart,
      selection,
      activeEntry?.[1].getAnalysisAssetIdentity(),
      activeEntry?.[0],
      activeEntry?.[1].getChartDocumentId()
    ) : {},
    references,
    uiContext: {
      activePanelId: activeEntry?.[0] ?? preferredContentId ?? null,
      activePanelType: chart ? "chart" : null,
      selectedReference: references[0] ?? null,
      visibleRange: chart ? chartVisibleRange(chart) : null
    }
  };
}

function chartPanelHandleForSelection(
  handles: Map<string, ChartPanelHandle>,
  selection: SemanticSelectionSnapshot
): readonly [string, ChartPanelHandle] | null {
  if (selection.chartDocumentId) {
    for (const entry of handles.entries()) {
      if (entry[1].getChartDocumentId() === selection.chartDocumentId) return entry;
    }
  }
  for (const entry of handles.entries()) {
    const chart = entry[1].getSnapshot();
    if (chart.symbol.toUpperCase() === selection.symbol.toUpperCase() && chart.interval === selection.interval) {
      return entry;
    }
  }
  return null;
}

function firstChartPanelHandle(handles: Map<string, ChartPanelHandle>): readonly [string, ChartPanelHandle] | null {
  for (const entry of handles.entries()) {
    return entry;
  }
  return null;
}

type TradeAutomationChartResolution =
  | { status: "resolved"; snapshot: ChartTradeSetupSnapshot | null }
  | { status: "ambiguous" }
  | { status: "missing" };

function resolveTradeAutomationChart(
  handles: Map<string, ChartPanelHandle>,
  preferredContentId: string | null,
  selection: SemanticSelectionSnapshot | null,
  panelState: TiledPanelState
): TradeAutomationChartResolution {
  const selectionEntry = selection ? chartPanelHandleForSelection(handles, selection) : null;
  const preferredEntry = preferredContentId && handles.has(preferredContentId)
    ? [preferredContentId, handles.get(preferredContentId)!] as const
    : null;
  let activeEntry = selectionEntry ?? preferredEntry;
  if (!activeEntry) {
    const linkedDocumentIds = [...new Set(Object.values(panelState.contents)
      .filter((content) => content.kind === "chartCommentary")
      .map((content) => readString(content.props?.chartDocumentId))
      .filter((value): value is string => Boolean(value)))];
    if (linkedDocumentIds.length === 1) {
      activeEntry = [...handles.entries()].find((entry) => entry[1].getChartDocumentId() === linkedDocumentIds[0]) ?? null;
    }
  }
  if (!activeEntry) {
    if (handles.size === 0) return { status: "missing" };
    if (handles.size > 1) return { status: "ambiguous" };
    activeEntry = firstChartPanelHandle(handles);
  }
  if (!activeEntry) {
    return { status: "missing" };
  }
  const chartDocumentId = activeEntry[1].getChartDocumentId();
  return {
    status: "resolved",
    snapshot: getChartTradeSetupSnapshot(chartDocumentId)
  };
}

function chartContextSymbol(context: Record<string, unknown>): string | null {
  const document = context.chartDocument;
  if (!document || typeof document !== "object") return null;
  const symbol = (document as { symbol?: unknown }).symbol;
  return typeof symbol === "string" && symbol.trim() ? symbol.trim().toUpperCase() : null;
}

function chartCommentaryRequestSnapshot(context: Record<string, unknown>): ChartCommentaryRequestSnapshot | null {
  const document = context.chartDocument;
  if (!document || typeof document !== "object") return null;
  const chartDocument = document as Record<string, unknown>;
  const chartDocumentId = readString(chartDocument.chartDocumentId);
  const symbol = readString(chartDocument.symbol)?.toUpperCase();
  const interval = readString(chartDocument.timeframe);
  if (!chartDocumentId || !symbol || !interval) return null;
  const identity = context.assetIdentity && typeof context.assetIdentity === "object"
    ? context.assetIdentity as Record<string, unknown>
    : {};
  const analysisWindow = context.analysisWindow && typeof context.analysisWindow === "object"
    ? context.analysisWindow as Record<string, unknown>
    : {};
  const asOf = readString(identity.asOf) ?? readString(analysisWindow.viewportTo);
  return {
    chartDocumentId,
    ...(readString(chartDocument.sourcePanelId) ? { sourcePanelId: readString(chartDocument.sourcePanelId)! } : {}),
    symbol,
    interval,
    ...(asOf ? { asOf } : {}),
    assetVersion: readString(identity.assetVersion) ?? undefined,
    algorithmVersion: readString(identity.algorithmVersion) ?? undefined,
    inputDigest: readString(identity.inputDigest) ?? undefined
  };
}

function isExplicitChartContextPrompt(prompt: string, references: AgentReference[]): boolean {
  const compact = prompt.toLowerCase().replace(/\s+/g, "");
  if (references.some((reference) => reference.type.startsWith("chart."))) return true;
  return [
    "차트분석", "이봉분석", "선택봉", "패턴", "지지", "저항", "진입가", "목표가", "손절", "손익비",
    "골든크로스", "데드크로스", "sma"
  ].some((keyword) => compact.includes(keyword));
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
    return window.localStorage.getItem(agentDebugStorageKey) !== "0";
  } catch {
    return true;
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

export function App() {
  const [mainView, setMainView] = useState<MainView>(() => initialMainView());
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => currentViewportSize());
  const responsivePanelLayout = useMemo(
    () => resolveResponsivePanelLayout(viewportSize, chartWorkspaceLayoutMetrics),
    [viewportSize.height, viewportSize.width]
  );
  const panelLayoutMetrics = responsivePanelLayout.metrics;
  const [panelState, setPanelState] = useState<TiledPanelState>(() => initialPanelState());
  const [semanticSelection, setSemanticSelection] = useState<SemanticSelectionSnapshot | null>(null);
  const [pendingPlacementPick, setPendingPlacementPick] = useState<PendingPlacementPick | null>(null);
  const [agentReferences, setAgentReferences] = useState<AgentReference[]>([]);
  const [companyCompareSelections, setCompanyCompareSelections] = useState<CompanyCompareSelectionState>(
    loadCompanyCompareSelections
  );
  const [selectedRecommendation, setSelectedRecommendation] = useState<StockRecommendationSelection | null>(null);
  const selectedRecommendationRef = useRef<StockRecommendationSelection | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [agentComposerRequest, setAgentComposerRequest] = useState(0);
  const [agentNotice, setAgentNotice] = useState<AgentHeaderNotice | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chartRuntime, setChartRuntime] = useState<ChartRuntimeState>(() => createInitialChartRuntimeState());
  const [chartDataResetRevision, setChartDataResetRevision] = useState(0);
  const [treeMapItems, setTreeMapItems] = useState<Sp500UniverseItem[]>(() => (
    normalizeMarketItems(sp500UniverseSeed).map((item) => ({ ...item, changePercent: null }))
  ));
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [selectedWildPanelSlotId, setSelectedWildPanelSlotId] = useState<string | null>(null);
  const [chartPriceSelection, setChartPriceSelection] = useState<ChartPriceSelection | null>(null);
  const [tradeAutomationDraft, setTradeAutomationDraft] = useState<TradeAutomationConfirmationDraft | null>(null);
  const { authEnabled, user, loading: authLoading, login, logout } = useAuth();
  const chartPanelHandlesRef = useRef<Map<string, ChartPanelHandle>>(new Map());
  const lastInteractedChartContentIdRef = useRef<string | null>(null);
  const activeAgentRunRef = useRef<ActiveAgentRun | null>(null);
  const pendingIncidentResponseTransitionRef = useRef<PendingIncidentResponseTransition | null>(null);
  const agentNoticeSequenceRef = useRef(0);
  const agentLayoutHistoryRef = useRef<TiledPanelState[]>([]);
  const lastSavedAgentProposalRef = useRef<string | null>(null);
  const activeTradeConditionProposalRef = useRef<{ analysisId: string; proposalId: string } | null>(null);
  const alertCommandDraftRef = useRef<{ clarificationId: string; requestId: string } | null>(null);
  const tradeAutomationRequestedSnapshotRef = useRef<ChartTradeSetupSnapshot | null>(null);
  const treeMapLayoutAsOfRef = useRef<string | null>(null);
  const previousSimulatorModeRef = useRef<SimulatorStatus["mode"]>("live");
  const previousSimulatorRunIdRef = useRef<string | null>(null);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const panelLayoutMetricsRef = useRef<WorkspaceLayoutMetrics>(panelLayoutMetrics);

  const showAgentNotice = useCallback((message: string, tone: AgentHeaderNoticeTone = "success") => {
    agentNoticeSequenceRef.current += 1;
    setAgentNotice({
      id: `agent-notice-${Date.now()}-${agentNoticeSequenceRef.current}`,
      message,
      tone
    });
  }, []);

  const dismissAgentNotice = useCallback((noticeId: string) => {
    setAgentNotice((current) => current?.id === noticeId ? null : current);
  }, []);

  useEffect(() => {
    const fallbackBase = mainView.mode === "chart" ? mainView.symbol : "";
    setCompanyCompareSelections((current) => (
      migratePanelCompareSelections(current, panelState, fallbackBase)
    ));
  }, [mainView, panelState]);

  useEffect(() => {
    persistCompanyCompareSelections(companyCompareSelections);
  }, [companyCompareSelections]);

  const handleCompanyCompareSymbolsChange = useCallback((baseSymbol: string, values: string[]) => {
    const base = normalizeCompanySymbol(baseSymbol);
    if (!base) {
      return;
    }
    setCompanyCompareSelections((current) => {
      const nextValues = normalizeCompanyCompareSymbols(base, values);
      const currentValues = current[base] ?? [];
      if (
        Object.prototype.hasOwnProperty.call(current, base)
        && currentValues.length === nextValues.length
        && currentValues.every((value, index) => value === nextValues[index])
      ) {
        return current;
      }
      return { ...current, [base]: nextValues };
    });
  }, []);

  useEffect(() => {
    const activeWildPanelSlotId = resolveWildPanelSlotId(panelState, selectedWildPanelSlotId);
    if (selectedWildPanelSlotId !== activeWildPanelSlotId) {
      setSelectedWildPanelSlotId(activeWildPanelSlotId);
    }
  }, [panelState, selectedWildPanelSlotId]);

  const addReportToSelectedWildPanel = useCallback((report: AgentAnalysisReport, preferredSlotId?: string) => {
    if (report.status !== "completed" && report.status !== "deep_completed") {
      return;
    }
    setPanelState((current) => {
      const wildPanelSlotId = resolveWildPanelSlotId(current, preferredSlotId ?? selectedWildPanelSlotId);
      return wildPanelSlotId
        ? addAgentReportToWildPanel(current, wildPanelSlotId, report)
        : current;
    });
  }, [selectedWildPanelSlotId]);

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

  useEffect(() => {
    const applySimulationQuotes = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      if (!status) return;
      const previousMode = previousSimulatorModeRef.current;
      const previousRunId = previousSimulatorRunIdRef.current;
      previousSimulatorModeRef.current = status.mode;
      previousSimulatorRunIdRef.current = status.runId ?? null;
      if (shouldResetMarketDataForSimulatorTransition(previousMode, status.mode, previousRunId, status.runId)) {
        chartPanelHandlesRef.current.clear();
        setSemanticSelection(null);
        setChartRuntime((current) => chartRuntimeReducer(current, { kind: "chart.marketData.reset" }));
        setChartDataResetRevision((current) => current + 1);
      }
      if (status.mode !== "simulation" || status.symbols.length === 0) return;
      const updates = new Map(status.symbols.map((item) => [item.symbol.toUpperCase(), item]));
      setTreeMapItems((current) => current.map((item) => {
        const update = updates.get(item.symbol.toUpperCase());
        if (!update || update.price == null) return item;
        return {
          ...item,
          lastPrice: update.price,
          changePercent: update.changePercent ?? item.changePercent,
          priceSource: "gops-simulator",
          priceUpdatedAt: status.virtualTime
        };
      }));
    };
    window.addEventListener(simulatorStatusEvent, applySimulationQuotes);
    return () => window.removeEventListener(simulatorStatusEvent, applySimulationQuotes);
  }, []);

  const applyMainViewState = useCallback((nextView: MainView, _options: { closeBottomMenu?: boolean } = {}) => {
    setSemanticSelection(null);
    if (nextView.mode === "treemap") {
      chartPanelHandlesRef.current.clear();
      setLayoutEditMode(false);
    }
    persistMainView(nextView);
    setMainView(nextView);
  }, []);

  const navigateMainView = useCallback((nextView: MainView, options: { replace?: boolean; closeBottomMenu?: boolean } = {}) => {
    if (typeof window !== "undefined" && window.history) {
      const currentView = resolveAppMainViewFromUrl(window.location.href).view;
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

  const applyPresetLayout = useCallback((state: TiledPanelState) => {
    setPanelState(state);
    // Applying a preset from the home (treemap) view jumps into the chart workspace,
    // using the last chart symbol (or MSFT when none is stored) without filling empty cells.
    if (mainView.mode !== "chart") {
      const symbol = resolvePresetSymbol();
      chartPanelHandlesRef.current.clear();
      setChartRuntime(createInitialChartRuntimeState());
      navigateMainView({ mode: "chart", symbol });
    }
  }, [mainView, navigateMainView, resolvePresetSymbol]);
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
  useEffect(() => {
    if (presetControls.activePresetId !== "compare") {
      return;
    }
    setPanelState((current) => resetChartAnalysisDefaultSymbol(current));
  }, [presetControls.activePresetId]);
  const applyAgentLayoutWithHistory = useCallback((
    state: TiledPanelState,
    proposal: AgentLayoutProposal,
    commit = false
  ) => {
    const isUndo = proposal.commands.some((command) => command.type === "layout.undo");
    const undoState = agentLayoutHistoryRef.current.at(-1);
    const activeChartSymbol = state.slots
      .map((slot) => state.contents[slot.contentId])
      .find((content) => content?.kind === "chart")?.props?.symbol;
    const defaultState = createInitialTiledPanelState(viewportSizeRef.current, {
      layoutMetrics: panelLayoutMetricsRef.current,
      symbol: typeof activeChartSymbol === "string" ? activeChartSymbol : undefined
    });
    const result = applyTiledAgentLayoutProposalWithResult(
      state,
      proposal,
      viewportSizeRef.current,
      panelLayoutMetricsRef.current,
      { undoState, defaultState }
    );
    if (commit && result.requestedSaveName && lastSavedAgentProposalRef.current !== proposal.id) {
      lastSavedAgentProposalRef.current = proposal.id;
      const presetId = presetControls.createCustomPreset();
      if (presetId) {
        presetControls.renamePreset(presetId, result.requestedSaveName);
      }
    }
    if (commit && result.stateChanged) {
      if (isUndo) {
        agentLayoutHistoryRef.current.pop();
      } else {
        agentLayoutHistoryRef.current = [...agentLayoutHistoryRef.current.slice(-19), state];
      }
    }
    return result;
  }, [presetControls]);
  const agentPresetSummaries = useMemo(() => buildAgentLayoutPresetSummaries(presetControls.presets), [presetControls.presets]);
  const buildAgentLayoutContext = useCallback((
    state: TiledPanelState,
    viewport: ViewportSize,
    activeSymbol = "",
    selectedPanelId?: string,
    chartDocumentSymbols: Record<string, string | undefined> = {},
    layoutMetrics: WorkspaceLayoutMetrics = {}
  ) => ({
    ...buildTiledAgentLayoutContext(state, viewport, activeSymbol, selectedPanelId, chartDocumentSymbols, layoutMetrics),
    presets: agentPresetSummaries,
    activePresetId: agentPresetSummaries.some((preset) => preset.id === presetControls.activePresetId)
      ? presetControls.activePresetId
      : null,
    canUndo: agentLayoutHistoryRef.current.length > 0
  }), [agentPresetSummaries, presetControls.activePresetId]);
  const [emphasizedReferenceKeys, setEmphasizedReferenceKeys] = useState<string[]>([]);
  const selectedAgentReferenceKeys = useMemo(() => (
    agentReferences.map((reference) => agentReferenceKey(reference))
  ), [agentReferences]);
  const selectedRecommendationSymbol = selectedRecommendation?.item.symbol ?? null;
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

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.history?.replaceState) {
      return;
    }
    const resolved = resolveAppMainViewFromUrl(window.location.href);
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
      const resolved = resolveAppMainViewFromUrl(window.location.href);
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
      const next = currentViewportSize(document.getElementById("root"));
      if (next.width === previous.width && next.height === previous.height) {
        return;
      }
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
    const resizeTarget = document.getElementById("root");
    if (resizeTarget && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(handleResize);
      observer.observe(resizeTarget);
      return () => observer.disconnect();
    }
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
  const treeMapBounds = workspaceBounds(viewportSize, chartWorkspaceLayoutMetrics);
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
  const effectivePanelState = useMemo(() => (
    ensurePortfolioInvestedPanelState(panelState, viewportSize, { layoutMetrics: panelLayoutMetrics })
  ), [panelLayoutMetrics, panelState, viewportSize]);
  const chartDocumentSymbolsByPanelId = useMemo(() => (
    chartDocumentSymbolsForLayout(effectivePanelState, chartRuntime)
  ), [chartRuntime, effectivePanelState]);
  const canUseAgent = !authLoading && (!authEnabled || Boolean(user));
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
    if (isOrderFlowDemoRoute(window.location.href) || isCompanyJournalPreviewRoute(window.location.href)) {
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

  const dispatchChartRuntimeAction = useCallback((action: ChartRuntimeAction) => {
    setChartRuntime((current) => chartRuntimeReducer(current, action));
  }, []);

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
    setPanelState((current) => setPrimaryChartView(ensurePrimaryChartSymbol(
      current,
      normalizedSymbol,
      viewportSizeRef.current,
      panelLayoutMetricsRef.current
    ), "chart"));
    navigateMainView(nextView, { replace: options.replace });
  }, [navigateMainView]);

  const openPatternAsset = useCallback((symbol: string, interval: AnalysisAssetInterval) => {
    const normalizedSymbol = normalizeStoredSymbol(symbol) || "NVDA";
    const nextView: MainView = { mode: "chart", symbol: normalizedSymbol };
    chartPanelHandlesRef.current.clear();
    setChartRuntime(createInitialChartRuntimeState());
    setPanelState((current) => setPrimaryChartView(ensurePrimaryChartSelection(
      current,
      normalizedSymbol,
      interval,
      viewportSizeRef.current,
      panelLayoutMetricsRef.current
    ), "chart"));
    navigateMainView(nextView);
  }, [navigateMainView]);

  const openCompanyPage = useCallback((symbol: string) => {
    const normalizedSymbol = normalizeStoredSymbol(symbol) || "NVDA";
    const nextView: MainView = { mode: "chart", symbol: normalizedSymbol };
    chartPanelHandlesRef.current.clear();
    setChartRuntime(createInitialChartRuntimeState());
    setPanelState((current) => {
      const companyState = setCompanyInformationSymbol(
        current,
        normalizedSymbol,
        viewportSizeRef.current,
        panelLayoutMetricsRef.current
      );
      const next = ensurePrimaryChartSymbol(
        companyState,
        normalizedSymbol,
        viewportSizeRef.current,
        panelLayoutMetricsRef.current
      );
      if (next !== current) {
        return next;
      }
      const stockPreset = presetControls.presets.find((preset) => preset.id === "stock");
      return stockPreset
        ? buildPresetLayout(stockPreset, viewportSizeRef.current, {
          symbol: normalizedSymbol,
          layoutMetrics: panelLayoutMetricsRef.current
        }) ?? current
        : current;
    });
    navigateMainView(nextView);
  }, [navigateMainView, presetControls.presets]);

  const handleChartHandleChange = useCallback((contentId: string, handle: ChartPanelHandle | null) => {
    if (handle) {
      chartPanelHandlesRef.current.set(contentId, handle);
    } else {
      chartPanelHandlesRef.current.delete(contentId);
    }
  }, []);

  const handleActiveChartChange = useCallback((contentId: string) => {
    if (chartPanelHandlesRef.current.has(contentId)) {
      lastInteractedChartContentIdRef.current = contentId;
    }
  }, []);

  const handleChartPriceSelection = useCallback((selection: ChartPriceSelection) => {
    setChartPriceSelection(selection);
    for (const [contentId, handle] of chartPanelHandlesRef.current.entries()) {
      if (handle.getChartDocumentId() === selection.chartDocumentId) {
        lastInteractedChartContentIdRef.current = contentId;
        break;
      }
    }
  }, []);

  useEffect(() => {
    const sourcePanelExists = chartPriceSelection
      ? panelState.slots.some((slot) => slot.id === chartPriceSelection.sourcePanelId
        && panelState.contents[slot.contentId]?.kind === "chart"
        && chartDocumentIdForContent(panelState.contents[slot.contentId]!) === chartPriceSelection.chartDocumentId)
      : false;
    if (chartPriceSelection && (!chartRuntime.documents[chartPriceSelection.chartDocumentId] || !sourcePanelExists)) {
      setChartPriceSelection(null);
    }
  }, [chartPriceSelection, chartRuntime.documents, panelState]);

  useEffect(() => {
    if (!tradeAutomationDraft || tradeAutomationDraft.status !== "pending") {
      return undefined;
    }
    const chartDocumentId = tradeAutomationDraft.chartDocumentId;
    const markStaleIfNeeded = () => {
      const snapshot = getChartTradeSetupSnapshot(chartDocumentId);
      if (!chartRuntime.documents[chartDocumentId]
        || !tradeAutomationDraftMatchesSnapshot(
          tradeAutomationDraft,
          snapshot,
          tradeAutomationRequestedSnapshotRef.current
        )) {
        setTradeAutomationDraft((current) => current?.status === "pending"
          ? { ...current, status: "stale" }
          : current);
      }
    };
    markStaleIfNeeded();
    return subscribeChartTradeSetup(chartDocumentId, markStaleIfNeeded);
  }, [chartRuntime.documents, tradeAutomationDraft]);

  const handleSemanticSelectionChange = useCallback((selection: SemanticSelectionSnapshot | null) => {
    setSemanticSelection(selection);
    if (!selection) return;
    const entry = chartPanelHandleForSelection(chartPanelHandlesRef.current, selection);
    if (entry) lastInteractedChartContentIdRef.current = entry[0];
  }, []);

  const applyPresetLoadProposal = useCallback((proposal: AgentLayoutProposal): LayoutLoadPresetResult => {
    return applyLayoutLoadProposalToPresets(proposal, presetControls.presets, presetControls.applyPreset);
  }, [presetControls]);

  const handlePresetLoadResult = useCallback((result: LayoutLoadPresetResult): LayoutLoadPresetResult["status"] => {
    if (result.status === "applied") {
      return "applied";
    }
    if (result.status === "missing") {
      showAgentNotice("프리셋을 찾지 못했습니다.", "error");
      return "missing";
    }
    return "none";
  }, [showAgentNotice]);

  const applyAgentLayoutProposal = useCallback((proposal: AgentLayoutProposal) => {
    const presetLoadResult = applyPresetLoadProposal(proposal);
    if (handlePresetLoadResult(presetLoadResult) !== "none") {
      return;
    }
    const preview = applyAgentLayoutWithHistory(panelState, proposal);
    if (preview.pendingPlacementPick) {
      setPendingPlacementPick(preview.pendingPlacementPick);
      showAgentNotice(placementPickMessage(preview.pendingPlacementPick), "info");
      return;
    }
    setPanelState((current) => {
      const result = applyAgentLayoutWithHistory(current, proposal, true);
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
  }, [applyAgentLayoutWithHistory, applyPresetLoadProposal, handlePresetLoadResult, panelState, showAgentNotice]);

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
    showAgentNotice(`${mainView.mode === "chart" ? `${mainView.symbol} ` : ""}패널 배치를 완료했습니다.`);
  }, [mainView, pendingPlacementPick, showAgentNotice]);

  const handlePlacementPickCancel = useCallback(() => {
    setPendingPlacementPick(null);
    showAgentNotice("배치를 취소했습니다.", "info");
  }, [showAgentNotice]);

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
  }, [chartDataResetRevision]);

  const showTreeMap = () => {
    navigateMainView({ mode: "treemap" }, { closeBottomMenu: true });
  };

  const enterLayoutEditMode = () => {
    if (mainView.mode !== "chart") {
      return;
    }
    setPanelState((current) => normalizeFreeformRectsToGridLayout(
      current,
      viewportSizeRef.current,
      panelLayoutMetricsRef.current
    ));
    setLayoutEditMode(true);
  };

  const exitLayoutEditMode = () => {
    const responsePreset = incidentResponseLayoutPreset(presetControls.presets);
    if (responsePreset && presetControls.activePresetId === responsePreset.id) {
      const result = presetControls.savePresetLayout(responsePreset.id);
      if (result.status === "missing") {
        showAgentNotice("대응 프리셋을 찾지 못해 저장하지 못했습니다.", "error");
      } else if (result.status === "invalid") {
        showAgentNotice(result.message, "error");
      }
    }
    setLayoutEditMode(false);
  };

  const cancelActiveAgentRun = useCallback(() => {
    const pendingTransition = pendingIncidentResponseTransitionRef.current;
    if (pendingTransition) {
      pendingTransition.cancelRequested = true;
      pendingIncidentResponseTransitionRef.current = null;
      showAgentNotice("Agent 분석을 중단했습니다.", "info");
      setAgentBusy(false);
      return;
    }
    const run = activeAgentRunRef.current;
    if (!run) {
      setAgentBusy(false);
      return;
    }
    run.cancelRequested = true;
    run.controller.abort();
    if (run.chartDocumentId) {
      setPanelState((current) => clearChartCommentaryPending(current, run.chartDocumentId!));
    }
    showAgentNotice("Agent 분석을 중단했습니다.", "info");
    setAgentBusy(false);
    void cancelAgentAnalysis(run.requestId).catch(() => {
      // Local abort already restored the UI; polling will also observe a stored cancel if the API accepted it.
    });
  }, [showAgentNotice]);

  const handleAgentReferenceSelect = useCallback((reference: AgentReference) => {
    const key = agentReferenceKey(reference);
    setAgentReferences((current) => {
      if (current.some((item) => agentReferenceKey(item) === key)) {
        return current.filter((item) => agentReferenceKey(item) !== key);
      }
      return [reference, ...current].slice(0, 5);
    });
  }, []);

  const handleRecommendationReferenceSelect = useCallback((
    reference: AgentReference | null,
    selection: StockRecommendationSelection | null = null,
    replaceExisting = false
  ) => {
    const currentSelection = selectedRecommendationRef.current;
    const wasSelected = !replaceExisting
      && Boolean(reference && currentSelection
        && agentReferenceKey(currentSelection.reference) === agentReferenceKey(reference));
    const nextSelection = !reference || wasSelected ? null : selection;
    selectedRecommendationRef.current = nextSelection;
    setSelectedRecommendation(nextSelection);
    setAgentReferences((current) => {
      const withoutRecommendation = current.filter((item) => item.type !== "recommendation.stock");
      return nextSelection
        ? [nextSelection.reference, ...withoutRecommendation].slice(0, 5)
        : withoutRecommendation;
    });
    setEmphasizedReferenceKeys([]);
  }, []);

  const handleAgentAsk = useCallback(() => {
    setLayoutEditMode(false);
    if (semanticSelection) {
      setAgentInput((current) => current.trim() ? current : "이 봉 분석해줘");
    } else if (agentReferences.some((reference) => reference.type.startsWith("news."))) {
      setAgentInput((current) => current.trim() ? current : "이 뉴스 설명해줘");
    } else if (agentReferences.some((reference) => reference.type.startsWith("compare.") || reference.type === "financial.metric")) {
      setAgentInput((current) => current.trim() ? current : "이 비교 차이를 설명해줘");
    } else if (agentReferences.some((reference) => reference.type === "chart.pattern" || reference.type === "chart.drawing")) {
      setAgentInput((current) => current.trim() ? current : "이 패턴 설명해줘");
    }
    setAgentComposerRequest((current) => current + 1);
  }, [agentReferences, semanticSelection]);

  // The chart owns its candle-highlight state internally, so clearing the App-level
  // selection is not enough — tell every chart panel to drop its selected candle too.
  const clearChartSemanticSelections = useCallback(() => {
    chartPanelHandlesRef.current.forEach((handle) => handle.clearSemanticSelection());
  }, []);

  const removeAgentReference = useCallback((key: string) => {
    if (key === SEMANTIC_SELECTION_REFERENCE_KEY) {
      setSemanticSelection(null);
      clearChartSemanticSelections();
    } else {
      setAgentReferences((current) => current.filter((item) => agentReferenceKey(item) !== key));
      if (selectedRecommendationRef.current
        && agentReferenceKey(selectedRecommendationRef.current.reference) === key) {
        selectedRecommendationRef.current = null;
        setSelectedRecommendation(null);
      }
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
    setAgentInput("");
    if (!canUseAgent) {
      showAgentNotice(authLoading ? "계정 상태를 확인한 뒤 다시 시도해주세요." : "로그인 후 Agent를 사용할 수 있습니다.", "error");
      return "notice";
    }
    const tradeAutomationIntent = resolveTradeAutomationCommandIntent(prompt);
    if (tradeAutomationIntent.status === "missing_price" && !chartPriceSelection) {
      showAgentNotice("어느 가격에 예약할까요? 차트 가격축을 선택한 뒤 다시 요청해 주세요.", "info");
      return "notice";
    }
    if (tradeAutomationIntent.status !== "not_matched") {
      const resolution = resolveTradeAutomationChart(
        chartPanelHandlesRef.current,
        lastInteractedChartContentIdRef.current,
        semanticSelection,
        panelState
      );
      if (resolution.status === "ambiguous") {
        showAgentNotice("대상 차트가 여러 개입니다. 사용할 차트를 먼저 클릭하거나 해설 패널에서 연결해 주세요.", "info");
        return "notice";
      }
      if (resolution.status === "missing") {
        showAgentNotice("연결할 원본 차트가 없습니다. 차트 패널을 먼저 열어 주세요.", "info");
        return "notice";
      }
      if (!resolution.snapshot) {
        showAgentNotice("현재 차트에 유효한 진입가·목표가·손절가 트레이드 플랜이 없습니다.", "info");
        return "notice";
      }
      if (tradeAutomationIntent.status === "missing_price"
        && !chartPriceSelectionMatchesTradeSetup(resolution.snapshot, chartPriceSelection)) {
        showAgentNotice("어느 가격에 예약할까요? 대상 차트의 가격축을 선택한 뒤 다시 요청해 주세요.", "info");
        return "notice";
      }
      const draft = createTradeAutomationConfirmationDraft(
        resolution.snapshot,
        chartPriceSelection,
        {
          action: tradeAutomationIntent.action,
          reservationPrice: tradeAutomationIntent.status === "ready"
            ? tradeAutomationIntent.reservationPrice
            : null
        }
      );
      if (!draft) {
        showAgentNotice("현재 트레이드 플랜의 진입가·목표가·손절가를 모두 확인할 수 없습니다.", "info");
        return "notice";
      }
      tradeAutomationRequestedSnapshotRef.current = resolution.snapshot;
      setTradeAutomationDraft(draft);
      return "ui-action";
    }
    const recommendationNavigation = resolveRecommendationCompanyNavigation(
      prompt,
      presetControls.activePresetId,
      selectedRecommendationSymbol
    );
    if (recommendationNavigation.status === "missing_selection") {
      showAgentNotice("추천 목록에서 종목을 먼저 선택해 주세요.", "info");
      return "notice";
    }
    if (recommendationNavigation.status === "ready") {
      presetControls.applyPreset(recommendationNavigation.presetId);
      openCompanyPage(recommendationNavigation.symbol);
      return "ui-action";
    }
    const agentContextSymbol = selectedRecommendationSymbol
      || (mainView.mode === "chart" ? mainView.symbol : resolvePresetSymbol());
    const incidentResponsePrompt = isIncidentResponsePrompt(prompt);
    const analysisIntent = incidentResponsePrompt
      ? incidentResponseAnalysisIntent(prompt, agentContextSymbol)
      : prompt;
    const watchlistContextSymbol = mainView.mode === "chart" ? mainView.symbol : agentContextSymbol;
    const watchlistCommand = resolveWatchlistAgentCommand(prompt, watchlistContextSymbol);
    if (watchlistCommand.status === "clarify") {
      showAgentNotice("관심종목에 추가할 기업을 먼저 선택해 주세요.", "info");
      return "notice";
    }
    if (watchlistCommand.status === "add") {
      setAgentBusy(true);
      try {
        await addWatchlistSymbol(watchlistCommand.symbol);
        showAgentNotice(`관심종목에 ${watchlistCommand.symbol}를 추가했습니다.`);
        return "ui-action";
      } catch (error) {
        showAgentNotice(error instanceof Error ? error.message : "관심종목을 추가하지 못했습니다.", "error");
        return "notice";
      } finally {
        setAgentBusy(false);
      }
    }
    const activeTradeProposal = activeTradeConditionProposalRef.current;
    if (activeTradeProposal) {
      setAgentBusy(true);
      try {
        const { publishTradeConditionsChanged, resolveTradeConditionCommand } = await import("./priceCondition/priceConditionApi");
        const command = await resolveTradeConditionCommand({
          text: prompt,
          analysisId: activeTradeProposal.analysisId,
          proposalId: activeTradeProposal.proposalId
        });
        if (command.status === "created") {
          activeTradeConditionProposalRef.current = null;
          publishTradeConditionsChanged();
          const condition = command.condition;
          showAgentNotice(condition
            ? `${condition.symbol} ${condition.quantity}주 가격 조건과 알림을 등록했습니다.`
            : "가격 조건과 알림을 등록했습니다.");
          return "ui-action";
        }
        if (command.status === "clarify" || command.status === "rejected") {
          showAgentNotice(command.clarification ?? "가격 조건을 등록하려면 조건을 더 알려주세요.", command.status === "rejected" ? "error" : "info");
          return "notice";
        }
      } catch (error) {
        showAgentNotice(error instanceof Error ? error.message : "가격 조건 명령을 처리하지 못했습니다.", "error");
        return "notice";
      } finally {
        setAgentBusy(false);
      }
    }
    const alertDraft = alertCommandDraftRef.current;
    if (alertDraft || isLikelyAlertCommand(prompt)) {
      setAgentBusy(true);
      try {
        const chartDocument = mainView.mode === "chart"
          ? Object.values(chartRuntime.documents).find((document) => document.symbol === agentContextSymbol)
          : undefined;
        const requestId = alertDraft?.requestId ?? createAgentAnalysisRequestId();
        const command = await submitAlertCommand({
          text: prompt,
          contextSymbol: agentContextSymbol,
          contextInterval: chartDocument?.timeframe,
          clarificationId: alertDraft?.clarificationId,
          requestId
        });
        if (command.status === "created") {
          alertCommandDraftRef.current = null;
          showAgentNotice(`${command.alert.symbol} 알림을 설정했습니다.`);
          return "ui-action";
        }
        if (command.status === "clarify") {
          alertCommandDraftRef.current = {
            clarificationId: command.clarificationId,
            requestId
          };
          showAgentNotice(command.clarification, "info");
          return "notice";
        }
        if (command.status === "rejected") {
          alertCommandDraftRef.current = null;
          showAgentNotice(command.clarification, "error");
          return "notice";
        }
        alertCommandDraftRef.current = null;
      } catch (error) {
        showAgentNotice(error instanceof Error ? error.message : "알림 명령을 처리하지 못했습니다.", "error");
        return "notice";
      } finally {
        setAgentBusy(false);
      }
    }
    if (isLikelyPresetLoadPrompt(prompt, agentPresetSummaries)) {
      setAgentBusy(true);
      try {
        const layoutSymbol = agentContextSymbol;
        const layoutResolution = await resolveAgentLayoutCommand({
          symbol: layoutSymbol,
          intent: prompt,
          routerMode: "hybrid",
          messages: [{ role: "user", content: prompt }],
          layoutContext: buildAgentLayoutContext(
            panelState,
            viewportSize,
            layoutSymbol,
            undefined,
            chartDocumentSymbolsByPanelId,
            panelLayoutMetricsRef.current
          )
        });
        if (layoutResolution?.status === "ui_layout" && layoutResolution.layoutProposal) {
          const presetLoadResult = applyPresetLoadProposal(layoutResolution.layoutProposal);
          const presetLoadStatus = handlePresetLoadResult(presetLoadResult);
          if (presetLoadStatus !== "none") {
            return presetLoadStatus === "applied" ? "ui-action" : "notice";
          }
        }
        if (layoutResolution?.status === "ui_clarify") {
          showAgentNotice(layoutResolutionProblemMessage(layoutResolution) ?? "프리셋을 적용할 수 없습니다.", "error");
          return "notice";
        }
      } catch {
        // Fall back to the existing chart/entity flow when the fast preset resolve fails.
      } finally {
        setAgentBusy(false);
      }
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
          const layoutProblems: string[] = [];
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
              layoutContext: buildAgentLayoutContext(
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
            const presetLoadResult = applyPresetLoadProposal(layoutResolution.layoutProposal);
            const presetLoadStatus = handlePresetLoadResult(presetLoadResult);
            if (presetLoadStatus !== "none") {
              return presetLoadStatus === "applied" ? "ui-action" : "notice";
            }
            const applyResult = applyAgentLayoutWithHistory(nextPanelState, layoutResolution.layoutProposal, true);
            if (applyResult.pendingPlacementPick) {
              const pick = applyResult.pendingPlacementPick;
              setPendingPlacementPick(pick);
              showAgentNotice(placementPickMessage(pick), "info");
              return "notice";
            }
            const problemMessage = layoutResolutionProblemMessage(layoutResolution, applyResult);
            if (problemMessage) {
              layoutProblems.push(problemMessage);
            }
            nextPanelState = applyResult.state;
            if (applyResult.stateChanged) {
              addedSymbols.push(addSymbol);
            }
          }
          setSemanticSelection(null);
          if (addedSymbols.length) {
            setPanelState(nextPanelState);
          }
          navigateMainView({ mode: "chart", symbol: primarySymbol });
          if (layoutProblems.length) {
            showAgentNotice([...new Set(layoutProblems)].join(" "), "error");
            return "notice";
          }
          showAgentNotice(`${shortcutSymbols.join(" / ")} 비교 차트를 표시했습니다.`);
          return "ui-action";
        } catch (error: unknown) {
          showAgentNotice(error instanceof Error ? error.message : "차트 패널을 추가할 수 없습니다.", "error");
          return "notice";
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
            layoutContext: buildAgentLayoutContext(
              panelState,
              viewportSize,
              mainView.symbol,
              undefined,
              chartDocumentSymbolsByPanelId,
              panelLayoutMetricsRef.current
            )
          });
          if (layoutResolution?.status === "ui_layout" && layoutResolution.layoutProposal) {
            const presetLoadResult = applyPresetLoadProposal(layoutResolution.layoutProposal);
            const presetLoadStatus = handlePresetLoadResult(presetLoadResult);
            if (presetLoadStatus !== "none") {
              return presetLoadStatus === "applied" ? "ui-action" : "notice";
            }
            const preview = applyAgentLayoutWithHistory(panelState, layoutResolution.layoutProposal);
            if (preview.pendingPlacementPick) {
              setPendingPlacementPick(preview.pendingPlacementPick);
              showAgentNotice(placementPickMessage(preview.pendingPlacementPick), "info");
              return "notice";
            }
            setPanelState((current) => {
              const result = applyAgentLayoutWithHistory(current, layoutResolution.layoutProposal!, true);
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
            const problemMessage = layoutResolutionProblemMessage(layoutResolution, preview);
            if (problemMessage) {
              showAgentNotice(problemMessage, "error");
              return "notice";
            }
            showAgentNotice(`${shortcut.symbol} 차트를 추가했습니다.`);
            return "ui-action";
          }
          if (layoutResolution?.status === "ui_clarify") {
            showAgentNotice(layoutResolutionProblemMessage(layoutResolution) ?? "차트 패널을 추가할 수 없습니다.", "error");
            return "notice";
          }
          showAgentNotice(layoutResolution?.rationale || "차트 패널을 추가할 수 없습니다.", "error");
          return "notice";
        } catch (error: unknown) {
          showAgentNotice(error instanceof Error ? error.message : "차트 패널을 추가할 수 없습니다.", "error");
          return "notice";
        } finally {
          setAgentBusy(false);
        }
      }
      if (mainView.mode === "chart") {
        openSymbolPage(shortcut.symbol);
        showAgentNotice(`${shortcut.symbol} 차트를 표시했습니다.`);
        return "notice";
      }
      openSymbolPage(shortcut.symbol);
      showAgentNotice(`${shortcut.symbol} 차트를 표시했습니다.`);
      return "chart-shortcut";
    }
    if (isLikelyChartOpenCommand(prompt)) {
      showAgentNotice("종목명을 찾지 못했습니다. 예: 애플, 엔비디아, AAPL, NVDA", "error");
      return "notice";
    }
    if (mainView.mode !== "chart") {
      if (!incidentResponsePrompt) {
        showAgentNotice("기업명/티커만 입력하면 차트를 열 수 있고, 분석은 차트 화면에서 가능합니다.", "error");
        return "notice";
      }
    }

    let analysisPanelState = panelState;
    let incidentWildPanelSlotId: string | undefined;
    let responsePreset: LayoutPreset | null = null;
    let responseLayout: TiledPanelState | null = null;
    if (incidentResponsePrompt) {
      responsePreset = incidentResponseLayoutPreset(presetControls.presets);
      if (!responsePreset) {
        showAgentNotice("대응 프리셋 지정하기에서 프리셋을 먼저 만들어 주세요.", "error");
        return "notice";
      }
      responseLayout = buildPresetLayoutForCurrent(responsePreset);
      if (!responseLayout) {
        showAgentNotice("저장된 대응 프리셋을 불러오지 못했습니다.", "error");
        return "notice";
      }
    }

    const runChartPrompt = async () => {
      if (incidentResponsePrompt && responsePreset && responseLayout) {
        setAgentBusy(true);
        const pendingTransition: PendingIncidentResponseTransition = { cancelRequested: false };
        pendingIncidentResponseTransitionRef.current = pendingTransition;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, incidentResponseTransitionDelayMs);
        });
        if (pendingTransition.cancelRequested || pendingIncidentResponseTransitionRef.current !== pendingTransition) {
          return;
        }
        pendingIncidentResponseTransitionRef.current = null;
        const prepared = prepareIncidentResponseLayout(responseLayout, agentContextSymbol);
        if (prepared.status === "invalid") {
          showAgentNotice(prepared.message, "error");
          setAgentBusy(false);
          return;
        }
        analysisPanelState = prepared.state;
        incidentWildPanelSlotId = prepared.wildPanelSlotId;
        presetControls.applyPreparedPreset(responsePreset.id, prepared.state);
        setSelectedWildPanelSlotId(prepared.wildPanelSlotId ?? null);
        setLayoutEditMode(false);
        setPendingPlacementPick(null);
        setSemanticSelection(null);
        clearChartSemanticSelections();
      }
      if (!incidentResponsePrompt && hasExplicitLayoutSyntax(prompt)) {
        setAgentBusy(true);
        try {
          const interactiveContext = buildInteractiveAgentContext(
            chartPanelHandlesRef.current,
            lastInteractedChartContentIdRef.current,
            semanticSelection,
            agentReferences
          );
          const interactivePanelId = typeof interactiveContext.uiContext.activePanelId === "string"
            ? interactiveContext.uiContext.activePanelId
            : undefined;
          const selectedLayoutPanelId = panelState.slots.find((slot) => (
            slot.id === interactivePanelId || slot.contentId === interactivePanelId
          ))?.id;
          const analysisPayload = {
            symbol: agentContextSymbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            chartContext: interactiveContext.chartContext,
            references: interactiveContext.references,
            uiContext: interactiveContext.uiContext,
            layoutContext: buildAgentLayoutContext(
              panelState,
              viewportSize,
              agentContextSymbol,
              selectedLayoutPanelId,
              chartDocumentSymbolsByPanelId,
              panelLayoutMetricsRef.current
            )
          };
          const layoutResolution = await resolveAgentLayoutCommand(analysisPayload);
          if (layoutResolution?.status === "ui_layout") {
            let layoutApplyResult: ApplyTiledAgentLayoutResult | undefined;
            if (layoutResolution.layoutProposal) {
              const presetLoadResult = applyPresetLoadProposal(layoutResolution.layoutProposal);
              if (handlePresetLoadResult(presetLoadResult) !== "none") {
                return;
              }
              const preview = applyAgentLayoutWithHistory(panelState, layoutResolution.layoutProposal);
              layoutApplyResult = preview;
              if (preview.pendingPlacementPick) {
                setPendingPlacementPick(preview.pendingPlacementPick);
                showAgentNotice(placementPickMessage(preview.pendingPlacementPick), "info");
                return;
              }
              setPanelState((current) => {
                const result = applyAgentLayoutWithHistory(current, layoutResolution.layoutProposal!, true);
                return result.state;
              });
            }
            const problemMessage = layoutResolutionProblemMessage(layoutResolution, layoutApplyResult);
            if (problemMessage) {
              showAgentNotice(problemMessage, "error");
            } else {
              showAgentNotice(`${agentContextSymbol} 레이아웃을 변경했습니다.`);
            }
            return;
          }
          if (layoutResolution?.status === "ui_clarify") {
            showAgentNotice(layoutResolutionProblemMessage(layoutResolution) ?? "화면 변경 요청을 확인하지 못했습니다.", "error");
            return;
          }
        } catch {
          // Layout resolve is an optimization; analysis remains the fallback.
        } finally {
          setAgentBusy(false);
        }
      }

      setAgentBusy(true);
      let commentarySource: ChartCommentaryRequestSnapshot | null = null;
      try {
        const interactiveContext = buildInteractiveAgentContext(
          chartPanelHandlesRef.current,
          lastInteractedChartContentIdRef.current,
          semanticSelection,
          agentReferences
        );
        const controller = new AbortController();
        const requestId = createAgentAnalysisRequestId();
        commentarySource = chartCommentaryRequestSnapshot(interactiveContext.chartContext);
        const opensChartCommentary = Boolean(commentarySource && isExplicitChartContextPrompt(prompt, interactiveContext.references));
        if (commentarySource && opensChartCommentary) {
          setPanelState((current) => beginChartCommentaryRequest(
            current,
            commentarySource!,
            requestId,
            prompt,
            viewportSizeRef.current,
            panelLayoutMetricsRef.current
          ).state);
        }
        const activeRun: ActiveAgentRun = {
          requestId,
          controller,
          cancelRequested: false,
          ...(commentarySource && opensChartCommentary ? { chartDocumentId: commentarySource.chartDocumentId } : {})
        };
        activeAgentRunRef.current = activeRun;
        const analysisRequestPayload = {
          symbol: opensChartCommentary
            ? chartContextSymbol(interactiveContext.chartContext) ?? agentContextSymbol
            : agentContextSymbol,
          intent: analysisIntent,
          routerMode: "hybrid",
          messages: [{ role: "user", content: analysisIntent }],
          chartContext: interactiveContext.chartContext,
          references: interactiveContext.references,
          uiContext: interactiveContext.uiContext,
          layoutContext: buildAgentLayoutContext(
            analysisPanelState,
            viewportSize,
            agentContextSymbol,
            undefined,
            incidentResponsePrompt
              ? chartDocumentSymbolsForLayout(analysisPanelState, chartRuntime)
              : chartDocumentSymbolsByPanelId,
            panelLayoutMetricsRef.current
          ),
          ...(Object.values(analysisPanelState.contents).some((content) => content.kind === "aiCoach")
            ? { coachRequest: { enabled: true as const } }
            : {})
        };
        publishLocalAgentDebugSnapshot(analysisRequestPayload, interactiveContext);
        const report = await requestAgentAnalysisPayload(analysisRequestPayload, {
          requestId,
          signal: controller.signal,
          onAccepted: (accepted) => {
            activeRun.requestId = accepted.analysisId;
            if (commentarySource && opensChartCommentary) {
              setPanelState((current) => updateChartCommentaryRequestId(
                current,
                commentarySource!.chartDocumentId,
                requestId,
                accepted.analysisId
              ));
            }
          }
        });
        if (!incidentResponsePrompt && report.layoutProposal) {
          applyAgentLayoutProposal(report.layoutProposal);
        }
        const tradeProposal = report.tradeConditionProposals[0];
        activeTradeConditionProposalRef.current = tradeProposal
          ? {
            analysisId: report.analysisId,
            proposalId: tradeProposal.proposalId
          }
          : null;
        setPanelState((current) => Object.values(current.contents).reduce(
          (next, content) => content.kind === "aiCoach"
            ? setPanelContentProps(next, content.id, { ...content.props, coachReport: report.coachReport ?? null })
            : next,
          current
        ));
        const reportStatus = report.status?.trim().toLowerCase();
        const isCompletedReport = reportStatus === "completed" || reportStatus === "deep_completed";
        const isChartReport = Boolean(isCompletedReport && opensChartCommentary && commentarySource && report.chartExplanation && report.finalAnswer);
        if (isChartReport && commentarySource) {
          const preview = attachChartCommentaryReport(
            panelState,
            commentarySource,
            report,
            prompt,
            viewportSizeRef.current,
            panelLayoutMetricsRef.current
          );
          if (preview.contentId) {
            setPanelState((current) => attachChartCommentaryReport(
              current,
              commentarySource!,
              report,
              prompt,
              viewportSizeRef.current,
              panelLayoutMetricsRef.current
            ).state);
          } else {
            addReportToSelectedWildPanel(report, incidentWildPanelSlotId);
            showAgentNotice("차트 해설 패널을 배치할 공간이 없어 선택한 Wild 패널에 답변을 보냈습니다.", "info");
          }
        } else {
          if (commentarySource) {
            setPanelState((current) => clearChartCommentaryPending(current, commentarySource!.chartDocumentId));
          }
          addReportToSelectedWildPanel(report, incidentWildPanelSlotId);
        }
        if (reportStatus === "failed") {
          showAgentNotice(report.summary || "Agent 요청에 실패했습니다.", "error");
        } else if (reportStatus === "canceled") {
          showAgentNotice("Agent 분석을 중단했습니다.", "info");
        } else if (!incidentResponsePrompt) {
          showAgentNotice(agentReportCompletionMessage(report, agentContextSymbol));
        }
        publishOntologyReport({ symbol: report.symbol, providerEvidence: report.providerEvidence ?? [] });
      } catch (error: unknown) {
        const activeRun = activeAgentRunRef.current;
        if (commentarySource) {
          setPanelState((current) => clearChartCommentaryPending(current, commentarySource!.chartDocumentId));
        }
        if (isAgentRequestAbortError(error) || activeRun?.cancelRequested) {
          if (!activeRun?.cancelRequested) {
            showAgentNotice("Agent 분석을 중단했습니다.", "info");
          }
          return;
        }
        showAgentNotice(error instanceof Error ? error.message : "Agent 요청에 실패했습니다.", "error");
      } finally {
        activeAgentRunRef.current = null;
        setAgentBusy(false);
      }
    };

    void runChartPrompt();
    return "notice";
  }, [addReportToSelectedWildPanel, agentBusy, agentInput, agentPresetSummaries, agentReferences, applyAgentLayoutProposal, applyPresetLoadProposal, authLoading, buildAgentLayoutContext, buildPresetLayoutForCurrent, canUseAgent, chartDocumentSymbolsByPanelId, chartPriceSelection, chartRuntime, clearChartSemanticSelections, handlePresetLoadResult, mainView, navigateMainView, openCompanyPage, openSymbolPage, panelState, presetControls, resolvePresetSymbol, selectedRecommendationSymbol, semanticSelection, showAgentNotice, viewportSize]);

  const closeTradeAutomationDialog = useCallback(() => {
    tradeAutomationRequestedSnapshotRef.current = null;
    setTradeAutomationDraft(null);
    setAgentComposerRequest((current) => current + 1);
  }, []);

  const confirmTradeAutomation = useCallback(async (quantity: number): Promise<boolean> => {
    if (!tradeAutomationDraft || tradeAutomationDraft.status !== "pending") {
      return false;
    }
    const snapshot = getChartTradeSetupSnapshot(tradeAutomationDraft.chartDocumentId);
    if (!chartRuntime.documents[tradeAutomationDraft.chartDocumentId]
      || !tradeAutomationDraftMatchesSnapshot(
        tradeAutomationDraft,
        snapshot,
        tradeAutomationRequestedSnapshotRef.current
      )) {
      setTradeAutomationDraft({ ...tradeAutomationDraft, status: "stale" });
      return false;
    }
    setAgentBusy(true);
    try {
      const { createPriceCondition } = await import("./priceCondition/priceConditionApi");
      const confirmedDraft: TradeAutomationConfirmationDraft = {
        ...tradeAutomationDraft,
        quantity,
        status: "confirmed"
      };
      const condition = await createPriceCondition(
        priceConditionInputFromTradeAutomationDraft(confirmedDraft)
      );
      tradeAutomationRequestedSnapshotRef.current = null;
      setTradeAutomationDraft(null);
      setAgentComposerRequest((current) => current + 1);
      showAgentNotice(`${condition.symbol} ${condition.quantity}주 예약매매와 가격 알림을 등록했습니다.`);
      return true;
    } catch (error) {
      showAgentNotice(error instanceof Error ? error.message : "예약매매와 가격 알림을 등록하지 못했습니다.", "error");
      return false;
    } finally {
      setAgentBusy(false);
    }
  }, [chartRuntime.documents, showAgentNotice, tradeAutomationDraft]);
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
      <section
        className={`canvas-workspace view-${mainView.mode} layout-mode-${responsivePanelLayout.mode}`}
        style={workspaceStyle}
        data-layout-mode={responsivePanelLayout.mode}
      >
        {mainView.mode === "treemap" ? (
          <>
            <TreeMapCanvas
              items={treeMapItems}
              onSelectSymbol={openSymbolPage}
              style={treeMapLaneStyle}
            />
          </>
        ) : (
          <PanelWorkspace
            panelState={effectivePanelState}
            setPanelState={setPanelState}
            viewportSize={viewportSize}
            layoutMetrics={panelLayoutMetrics}
            layoutMode={responsivePanelLayout.mode}
            layoutEditMode={layoutEditMode}
            onExitLayoutEdit={exitLayoutEditMode}
            activeSymbol={mainView.symbol}
            symbols={universeSymbols}
            companyItems={treeMapItems}
            marketItems={treeMapItems}
            chartRuntime={chartRuntime}
            chartDataResetRevision={chartDataResetRevision}
            companyCompareSelections={companyCompareSelections}
            onCompanyCompareSymbolsChange={handleCompanyCompareSymbolsChange}
            selectedAgentReferenceKeys={selectedAgentReferenceKeys}
            emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
            emphasizeChartSelection={emphasizeChartSelection}
            setSemanticSelection={handleSemanticSelectionChange}
            onAgentReferenceSelect={handleAgentReferenceSelect}
            onAgentAsk={handleAgentAsk}
            onChartRuntimeAction={dispatchChartRuntimeAction}
            onChartHandleChange={handleChartHandleChange}
            onSelectSymbol={openSymbolPage}
            selectedRecommendationSymbol={selectedRecommendationSymbol}
            selectedRecommendation={selectedRecommendation}
            onSelectRecommendationReference={handleRecommendationReferenceSelect}
            onOpenCompany={openCompanyPage}
            onSelectPatternAsset={openPatternAsset}
            selectedWildPanelSlotId={selectedWildPanelSlotId}
            onSelectWildPanel={setSelectedWildPanelSlotId}
            chartPriceSelection={chartPriceSelection}
            onChartPriceSelection={handleChartPriceSelection}
            onActiveChartChange={handleActiveChartChange}
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
        agentBusy={agentBusy}
        agentInput={agentInput}
        agentComposerRequest={agentComposerRequest}
        agentNotice={agentNotice}
        authEnabled={authEnabled}
        authLoading={authLoading}
        authUser={user}
        canUseAgent={canUseAgent}
        agentReferenceChips={agentReferenceChips}
        isChartMode={mainView.mode === "chart"}
        layoutEditMode={layoutEditMode}
        topDock={mainView.mode === "chart" ? (
          <PresetDock
            controls={presetControls}
            onShowHome={showTreeMap}
            layoutEditMode={layoutEditMode}
            onEnterLayoutEdit={enterLayoutEditMode}
            onExitLayoutEdit={exitLayoutEditMode}
          />
        ) : null}
        onAgentInputChange={setAgentInput}
        onAgentCancel={cancelActiveAgentRun}
        onAgentReferenceRemove={removeAgentReference}
        onAgentReferenceEmphasize={emphasizeAgentReferences}
        onAgentSubmit={runAgentPrompt}
        onAgentNoticeDismiss={dismissAgentNotice}
        onLogin={login}
        onLogout={() => void logout()}
        onSelectSymbol={openSymbolPage}
        onApplyLayoutProposal={applyAgentLayoutProposal}
      />
      {tradeAutomationDraft && (
        <Suspense fallback={null}>
          <TradeAutomationConfirmationDialog
            draft={tradeAutomationDraft}
            onCancel={closeTradeAutomationDialog}
            onConfirm={confirmTradeAutomation}
          />
        </Suspense>
      )}
      <GlossaryTooltip />
      <RelatedIndexTooltip />
    </main>
  );
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
  return left.topInset === right.topInset
    && left.bottomInset === right.bottomInset
    && left.uiScale === right.uiScale
    && left.minCellWidthPx === right.minCellWidthPx
    && left.minCellHeightPx === right.minCellHeightPx;
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
  return resolveAppMainViewFromUrl(window.location.href).view;
}

function resolveAppMainViewFromUrl(value: string | URL): MainViewUrlResolution {
  const resolved = resolveMainViewFromUrl(value);
  if (resolved.view.mode === "chart" || !isOrderFlowDemoRoute(value)) {
    return resolved;
  }
  const nextView: MainView = { mode: "chart", symbol: orderFlowDemoDefaultSymbol };
  return {
    view: nextView,
    url: createMainViewUrl(value, nextView)
  };
}

function isOrderFlowDemoRoute(value: string | URL): boolean {
  if (import.meta.env.DEV !== true) {
    return false;
  }
  const url = value instanceof URL ? value : new URL(value, "http://gops.local");
  return url.searchParams.has("orderFlowDemo");
}

function isCompanyJournalPreviewRoute(value: string | URL): boolean {
  if (import.meta.env.DEV !== true) {
    return false;
  }
  const url = value instanceof URL ? value : new URL(value, "http://gops.local");
  return url.searchParams.get("companyJournalPreview") === "1";
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

function layoutResolutionProblemMessage(
  resolution: AgentLayoutResolveResponse,
  applyResult?: ApplyTiledAgentLayoutResult
): string | null {
  if (applyResult?.reason) {
    return `일부 배치는 적용되지 않았습니다. ${applyResult.reason}`;
  }
  if (resolution.status === "ui_clarify") {
    return resolution.summary || "어떤 패널을 어떻게 바꿀지 조금 더 구체적으로 말해 주세요.";
  }
  const proposal = resolution.layoutProposal;
  if (proposal && applyResult && agentLayoutApplySucceeded(proposal, applyResult)) {
    return null;
  }
  if (proposal?.rationale && !isInternalLayoutRationale(proposal.rationale)) {
    return proposal.rationale;
  }
  if (resolution.rationale && !isInternalLayoutRationale(resolution.rationale)) {
    return resolution.rationale;
  }
  return resolution.summary || "화면 변경이 적용되지 않았습니다.";
}

function placementPickMessage(pick: PendingPlacementPick): string {
  const kind = panelKindForAgentType(pick.panelType);
  const panelTitle = kind ? panelRegistryEntry(kind).title : "패널";
  const subject = pick.symbol ? `${pick.symbol} ${panelTitle}` : panelTitle;
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

function currentViewportSize(container?: HTMLElement | null): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1280, height: 720 };
  }
  const width = container?.clientWidth || window.innerWidth;
  const height = container?.clientHeight || window.innerHeight;
  return {
    width: Math.max(1, Math.round(width / appUiScale)),
    height: Math.max(1, Math.round(height / appUiScale))
  };
}
