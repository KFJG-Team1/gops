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
import { formatAgentAnalysisForChat, requestAgentAnalysis } from "./agent/agentAnalysisClient";
import { BottomCommandBar, type BottomMenuKey, type ChatLogEntry } from "./components/BottomCommandBar";
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
import { sp500UniverseSeed } from "./market/sp500Universe.seed";
import { TreeMapCanvas } from "./treemap/TreeMapCanvas";

type MainView =
  | { mode: "treemap" }
  | { mode: "chart"; symbol: string };

type LayoutDrag =
  { mode: "treemap"; type: "resize-bottom"; startY: number; startHeight: number };

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
  const [mainView, setMainView] = useState<MainView>({ mode: "treemap" });
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => currentViewportSize());
  const [panelState, setPanelState] = useState<TiledPanelState>(() => initialPanelState());
  const [treeMapHeight, setTreeMapHeight] = useState(() => initialTreeMapHeight());
  const [chartHeader, setChartHeader] = useState<ChartHeaderSnapshot | null>(null);
  const [, setSemanticSelection] = useState<SemanticSelectionSnapshot | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [chatLog, setChatLog] = useState<ChatLogEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chartCommandMode, setChartCommandMode] = useState(false);
  const [treeMapLaneHover, setTreeMapLaneHover] = useState(false);
  const [activeBottomMenu, setActiveBottomMenu] = useState<BottomMenuKey | null>(null);
  const { authEnabled, user, loading: authLoading, login, logout } = useAuth();
  const chartPanelRef = useRef<ChartPanelHandle | null>(null);
  const dragRef = useRef<LayoutDrag | null>(null);
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

  const universeSymbols = useMemo((): ChartSymbolDto[] => sp500UniverseSeed.map((item) => ({
    symbol: item.symbol,
    name: item.companyName,
    sector: item.sector,
    isMock: item.symbol === "TSLA" || item.symbol === "AAPL" || item.symbol === "GOOGL"
  })), []);
  const activeHeaderSymbol = mainView.mode === "chart" ? chartHeader?.symbol ?? mainView.symbol : "";
  const activeHeaderQuote = chartHeader?.liveQuote;
  const canUseAgent = !authLoading && (!authEnabled || Boolean(user));

  const showChart = (symbol: string) => {
    setSemanticSelection(null);
    setTreeMapLaneHover(false);
    setChartHeader(null);
    setMainView({ mode: "chart", symbol: symbol.toUpperCase() });
  };

  useEffect(() => {
    if (!canUseAgent && chartCommandMode) {
      setChartCommandMode(false);
    }
  }, [canUseAgent, chartCommandMode]);

  const showTreeMap = () => {
    setSemanticSelection(null);
    setChartHeader(null);
    setActiveBottomMenu(null);
    setMainView({ mode: "treemap" });
  };

  const toggleBottomMenu = (key: BottomMenuKey) => {
    if (key === "V" && authEnabled && !authLoading && !user) {
      login();
      return;
    }
    setActiveBottomMenu((current) => (current === key ? null : key));
  };

  const runAgentPrompt = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = agentInput.trim();
    if (!prompt || agentBusy) {
      return;
    }
    const userEntry = createChatLogEntry("user", prompt);
    setAgentInput("");
    if (!canUseAgent) {
      setChatLog((current) => [
        ...current,
        userEntry,
        createChatLogEntry("system", authLoading ? "계정 상태를 확인한 뒤 다시 시도해주세요." : "로그인 후 Agent를 사용할 수 있습니다.")
      ]);
      return;
    }
    if (mainView.mode !== "chart") {
      setChatLog((current) => [
        ...current,
        userEntry,
        createChatLogEntry("system", "차트를 선택하면 분석할 수 있습니다.")
      ]);
      return;
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
        const report = await requestAgentAnalysis({ symbol: activeHeaderSymbol || mainView.symbol, prompt });
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
  }, [activeHeaderSymbol, agentBusy, agentInput, authLoading, canUseAgent, chartCommandMode, mainView]);

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
            <TreeMapCanvas items={sp500UniverseSeed} onSelectSymbol={showChart} />
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
