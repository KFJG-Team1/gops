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
  formatAgentAnalysisForChat,
  requestAgentAnalysisPayload,
  resolveAgentChartShortcut,
  resolveAgentLayoutCommand,
  type AgentLayoutResolveResponse
} from "./agent/agentAnalysisClient";
import { BottomCommandBar, type AgentSubmitResult, type BottomMenuKey, type ChatLogEntry } from "./components/BottomCommandBar";
import { type ChartHeaderSnapshot, type ChartPanelHandle } from "./components/ChartPanel";
import { PanelWorkspace } from "./components/PanelWorkspace";
import type { SemanticSelectionSnapshot } from "./chart/semanticTimeline";
import type { ChartSymbolDto } from "./chart/types";
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
import { applyTiledAgentLayoutProposal, buildTiledAgentLayoutContext } from "./layout/tiledAgentLayout";
import { fetchMarketHeatmap } from "./market/heatmapApi";
import { sp500UniverseSeed, type Sp500UniverseItem } from "./market/sp500Universe.seed";
import { TreeMapCanvas } from "./treemap/TreeMapCanvas";

type MainView =
  | { mode: "treemap" }
  | { mode: "chart"; symbol: string };

type LayoutDrag =
  { mode: "treemap"; type: "resize-bottom"; startY: number; startHeight: number };

const mainViewStorageKey = "gops:main-view";
const lastChartSymbolStorageKey = "gops:last-chart-symbol";

let chatLogEntrySequence = 0;

function initialPanelState(): TiledPanelState {
  if (typeof window === "undefined") {
    return createInitialTiledPanelState({ width: 1280, height: 720 });
  }
  return createInitialTiledPanelState(currentViewportSize());
}

function initialTreeMapHeight(): number {
  if (typeof window === "undefined") {
    return 620;
  }
  return treeMapMaxHeight(window.innerHeight);
}

export function App() {
  const [mainView, setMainView] = useState<MainView>(() => initialMainView());
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => currentViewportSize());
  const [panelState, setPanelState] = useState<TiledPanelState>(() => initialPanelState());
  const [treeMapHeight, setTreeMapHeight] = useState(() => initialTreeMapHeight());
  const [chartHeader, setChartHeader] = useState<ChartHeaderSnapshot | null>(null);
  const [, setSemanticSelection] = useState<SemanticSelectionSnapshot | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [chatLog, setChatLog] = useState<ChatLogEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chartCommandMode, setChartCommandMode] = useState(false);
  const [treeMapItems, setTreeMapItems] = useState<Sp500UniverseItem[]>(() => sp500UniverseSeed);
  const [treeMapLaneHover, setTreeMapLaneHover] = useState(false);
  const [activeBottomMenu, setActiveBottomMenu] = useState<BottomMenuKey | null>(null);
  const { authEnabled, user, loading: authLoading, login, logout } = useAuth();
  const chartPanelRef = useRef<ChartPanelHandle | null>(null);
  const dragRef = useRef<LayoutDrag | null>(null);
  const treeMapLayoutAsOfRef = useRef<string | null>(null);
  const viewportSizeRef = useRef<ViewportSize>(viewportSize);
  const isTreeMapMode = mainView.mode === "treemap";
  const laneCanResize = isTreeMapMode && canResizeTreeMapLayout(viewportSize.height);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

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
  const activeHeaderSymbol = mainView.mode === "chart" ? chartHeader?.symbol ?? mainView.symbol : "";
  const activeHeaderQuote = chartHeader?.liveQuote;
  const canUseAgent = !authLoading && (!authEnabled || Boolean(user));

  const showChart = useCallback((symbol: string) => {
    const nextView: MainView = { mode: "chart", symbol: normalizeStoredSymbol(symbol) || "NVDA" };
    setSemanticSelection(null);
    setTreeMapLaneHover(false);
    setChartHeader(null);
    persistMainView(nextView);
    replaceMainViewUrl(nextView);
    setMainView(nextView);
  }, []);

  useEffect(() => {
    if (!canUseAgent && chartCommandMode) {
      setChartCommandMode(false);
    }
  }, [canUseAgent, chartCommandMode]);

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
    const nextView: MainView = { mode: "treemap" };
    setSemanticSelection(null);
    setChartHeader(null);
    setActiveBottomMenu(null);
    persistMainView(nextView);
    replaceMainViewUrl(nextView);
    setMainView(nextView);
  };

  const toggleBottomMenu = (key: BottomMenuKey) => {
    if (key === "V" && authEnabled && !authLoading && !user) {
      login();
      return;
    }
    setActiveBottomMenu((current) => (current === key ? null : key));
  };

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
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, activeHeaderSymbol || mainView.symbol)
          });
          if (layoutResolution?.status === "ui_layout" && layoutResolution.layoutProposal) {
            setPanelState((current) => applyTiledAgentLayoutProposal(current, layoutResolution.layoutProposal!, viewportSizeRef.current));
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
      showChart(shortcut.symbol);
      return "chart-shortcut";
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
      if (!chartCommandMode && isLikelyLayoutCommand(prompt)) {
        setAgentBusy(true);
        try {
          const analysisPayload = {
            symbol: activeHeaderSymbol || mainView.symbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, activeHeaderSymbol || mainView.symbol)
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
        } catch {
          // Layout resolve is an optimization; analysis remains the fallback.
        } finally {
          setAgentBusy(false);
        }
      }

      const pendingEntry = createChatLogEntry(
        "assistant",
        chartCommandMode ? "차트 조작 에이전트가 차트를 읽고 있습니다." : "Agent가 분석을 시작했습니다.",
        true
      );
      setAgentBusy(true);
      setChatLog((current) => [...current, userEntry, pendingEntry]);
      try {
        if (chartCommandMode) {
          const chartPanel = chartPanelRef.current;
          if (!chartPanel) {
            throw new Error("차트가 준비되면 다시 시도해주세요.");
          }
          const result = await chartPanel.runAgentPrompt(prompt);
          replaceChatLogEntry(setChatLog, pendingEntry.id, result.message || "응답이 없습니다.");
        } else {
          const report = await requestAgentAnalysisPayload({
            symbol: activeHeaderSymbol || mainView.symbol,
            intent: prompt,
            routerMode: "hybrid",
            messages: [{ role: "user", content: prompt }],
            layoutContext: buildTiledAgentLayoutContext(panelState, viewportSize, activeHeaderSymbol || mainView.symbol)
          });
          if (report.layoutProposal) {
            setPanelState((current) => applyTiledAgentLayoutProposal(current, report.layoutProposal!, viewportSizeRef.current));
          }
          replaceChatLogEntry(setChatLog, pendingEntry.id, formatAgentAnalysisForChat(report));
        }
      } catch (error: unknown) {
        replaceChatLogEntry(
          setChatLog,
          pendingEntry.id,
          error instanceof Error ? error.message : "Agent 요청에 실패했습니다."
        );
      } finally {
        setAgentBusy(false);
      }
    };

    void runChartPrompt();
    return "chat-log";
  }, [activeHeaderSymbol, agentBusy, agentInput, authLoading, canUseAgent, chartCommandMode, mainView, panelState, showChart, viewportSize]);

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
          <h1 className="company-ticker">{activeHeaderSymbol}</h1>
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
            <TreeMapCanvas items={treeMapItems} onSelectSymbol={showChart} />
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
            chartHeader={chartHeader}
            chartPanelRef={chartPanelRef}
            setSemanticSelection={setSemanticSelection}
            setChartHeader={setChartHeader}
            onSelectSymbol={showChart}
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
        chartCommandMode={chartCommandMode}
        symbols={universeSymbols}
        activeSymbol={activeHeaderSymbol}
        isChartMode={mainView.mode === "chart"}
        onAgentInputChange={setAgentInput}
        onAgentSubmit={runAgentPrompt}
        onChartCommandModeChange={setChartCommandMode}
        onCloseMenu={() => setActiveBottomMenu(null)}
        onLogin={login}
        onLogout={() => void logout()}
        onSelectSymbol={showChart}
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
      marketCap: previous.marketCap,
      indexWeight: previous.indexWeight
    };
  });
}

function initialMainView(): MainView {
  if (typeof window === "undefined") {
    return { mode: "treemap" };
  }
  const urlSymbol = normalizeStoredSymbol(new URLSearchParams(window.location.search).get("symbol"));
  if (urlSymbol) {
    return { mode: "chart", symbol: urlSymbol };
  }
  try {
    const storedView = window.localStorage.getItem(mainViewStorageKey);
    const storedSymbol = normalizeStoredSymbol(window.localStorage.getItem(lastChartSymbolStorageKey));
    if (storedView === "chart" && storedSymbol) {
      return { mode: "chart", symbol: storedSymbol };
    }
  } catch {
    return { mode: "treemap" };
  }
  return { mode: "treemap" };
}

function persistMainView(view: MainView) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(mainViewStorageKey, view.mode);
    if (view.mode === "chart") {
      window.localStorage.setItem(lastChartSymbolStorageKey, view.symbol);
    }
  } catch {
    // Browsers can disable storage; URL state still carries direct links.
  }
}

function replaceMainViewUrl(view: MainView) {
  if (typeof window === "undefined" || !window.history?.replaceState) {
    return;
  }
  const url = new URL(window.location.href);
  if (view.mode === "chart") {
    url.searchParams.set("symbol", view.symbol);
  } else {
    url.searchParams.delete("symbol");
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function normalizeStoredSymbol(value: string | null | undefined): string {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : "";
}

function layoutResolutionMessage(resolution: AgentLayoutResolveResponse): string {
  const proposal = resolution.layoutProposal;
  const applied = Boolean(proposal && proposal.autoApply !== false && proposal.commands.length > 0);
  if (applied) {
    return resolution.summary || "변경했습니다.";
  }
  return resolution.rationale || resolution.summary || "변경할 수 없습니다.";
}

function isLikelyLayoutCommand(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const compacted = text.replace(/\s+/g, "");
  const explicitLayoutTerms = ["패널", "레이아웃", "화면", "ui", "panel", "layout"];
  const targetTerms = ["뉴스", "온톨로지", "포트폴리오", "주문", "news", "ontology", "portfolio", "order"];
  const actionTerms = ["키워", "크게", "줄여", "작게", "열어", "띄워", "보여", "닫", "옮겨", "배치", "정리", "바꿔", "변경", "크기", "resize", "open", "close", "move", "arrange"];
  if (explicitLayoutTerms.some((term) => compacted.includes(term))) {
    return true;
  }
  return targetTerms.some((term) => compacted.includes(term)) && actionTerms.some((term) => compacted.includes(term));
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
