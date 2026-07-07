import { Bell, ChevronDown, ChevronUp, GripVertical, LayoutPanelTop, SendHorizontal, Settings, Square, Star, UserCircle, WalletCards, X } from "lucide-react";
import { type DragEvent, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { AlertMenu } from "../alerts/AlertMenu";
import { fetchNotifications, normalizeNotificationPayload, notificationSocketUrl } from "../alerts/alertApi";
import { formatAgentTimingSummary, type AgentAnalysisReport, type FinalAnswerSection } from "../agents/agentAnalysis";
import type { AuthUser } from "../auth/AuthProvider";
import type { ChartSymbolDto } from "../chart/types";
import { InvestmentProfileForm } from "../recommendations/InvestmentProfileForm";
import { PortfolioHoldingsPanel } from "./PortfolioHoldingsPanel";
import { SymbolSearch } from "./SymbolSearch";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

export type BottomMenuKey = "I" | "II" | "III" | "IV" | "V" | "VI";
export type ChatLogEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
  confidence?: number;
  analysisReport?: AgentAnalysisReport | null;
};
export type AgentSubmitResult = "chat-log" | "chart-shortcut" | "ignored";

type BottomMenuSide = "left" | "right";
type WatchlistDropPlacement = "before" | "after";
type WatchlistDragTarget = {
  symbol: string;
  placement: WatchlistDropPlacement;
};

type BottomCommandBarProps = {
  activeMenu: BottomMenuKey | null;
  agentBusy: boolean;
  agentInput: string;
  chatLog: ChatLogEntry[];
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  canUseAgent: boolean;
  selectedAgentReferenceCount: number;
  symbols: ChartSymbolDto[];
  watchlistSymbols: ChartSymbolDto[];
  watchlistPersisted: boolean;
  watchlistLoading: boolean;
  watchlistSaving: boolean;
  canEditWatchlist: boolean;
  activeSymbol: string;
  isChartMode: boolean;
  layoutEditMode: boolean;
  onAgentCancel: () => void;
  onAgentReferencesClear: () => void;
  onAgentInputChange: (value: string) => void;
  onAgentSubmit: (event: FormEvent<HTMLFormElement>) => AgentSubmitResult | Promise<AgentSubmitResult>;
  onAddWatchlistSymbol: (symbol: string) => void;
  onCloseMenu: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onReorderWatchlistSymbol: (draggedSymbol: string, targetSymbol: string, placement: WatchlistDropPlacement) => void;
  onRemoveWatchlistSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onToggleLayoutEditMode: () => void;
  onToggleMenu: (key: BottomMenuKey) => void;
};

const leftMenuKeys: BottomMenuKey[] = ["I", "II", "III"];
const rightMenuKeys: BottomMenuKey[] = ["IV", "VI"];

export function BottomCommandBar({
  activeMenu,
  agentBusy,
  agentInput,
  chatLog,
  authEnabled,
  authLoading,
  authUser,
  canUseAgent,
  selectedAgentReferenceCount,
  symbols,
  watchlistSymbols,
  watchlistPersisted,
  watchlistLoading,
  watchlistSaving,
  canEditWatchlist,
  activeSymbol,
  isChartMode,
  layoutEditMode,
  onAgentCancel,
  onAgentReferencesClear,
  onAgentInputChange,
  onAgentSubmit,
  onAddWatchlistSymbol,
  onCloseMenu,
  onLogin,
  onLogout,
  onReorderWatchlistSymbol,
  onRemoveWatchlistSymbol,
  onSelectSymbol,
  onShowTreeMap,
  onToggleLayoutEditMode,
  onToggleMenu
}: BottomCommandBarProps) {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [watchlistDragSource, setWatchlistDragSource] = useState<string | null>(null);
  const [watchlistDragTarget, setWatchlistDragTarget] = useState<WatchlistDragTarget | null>(null);
  const [watchlistPreviewSymbols, setWatchlistPreviewSymbols] = useState<ChartSymbolDto[] | null>(null);
  const [alertUnreadCount, setAlertUnreadCount] = useState(0);
  const hasFloatingPanel = activeMenu !== null || chatPanelOpen;
  const canUseAlerts = !authLoading && (!authEnabled || Boolean(authUser));

  useEffect(() => {
    if (!hasFloatingPanel) {
      return undefined;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".bottom-menu-panel, .bottom-nav-actions, .bottom-chat-panel, .agent-dock")) {
        return;
      }
      if (activeMenu) {
        onCloseMenu();
      }
      if (chatPanelOpen) {
        setChatPanelOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [activeMenu, chatPanelOpen, hasFloatingPanel, onCloseMenu]);

  useEffect(() => {
    if (!canUseAlerts) {
      setAlertUnreadCount(0);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    void fetchNotifications(controller.signal)
      .then((payload) => {
        if (!cancelled) {
          setAlertUnreadCount(payload.unreadCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlertUnreadCount(0);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canUseAlerts]);

  useEffect(() => {
    if (!canUseAlerts) {
      return undefined;
    }
    const socket = new WebSocket(notificationSocketUrl());
    socket.onmessage = (event) => {
      const payload = readSocketPayload(event.data);
      if (payload.type === "snapshot") {
        const notifications = Array.isArray(payload.notifications)
          ? payload.notifications.map(normalizeNotificationPayload).filter(Boolean)
          : [];
        setAlertUnreadCount(asNumber(payload.unreadCount) ?? notifications.filter((item) => !item?.readAt).length);
        return;
      }
      if (payload.type === "notification") {
        const notification = normalizeNotificationPayload(payload.notification);
        if (!notification?.readAt) {
          setAlertUnreadCount((current) => current + 1);
        }
      }
    };
    return () => socket.close();
  }, [canUseAlerts]);

  const closeFloatingPanels = () => {
    if (activeMenu) {
      onCloseMenu();
    }
    setChatPanelOpen(false);
  };

  const resetWatchlistDrag = () => {
    setWatchlistDragSource(null);
    setWatchlistDragTarget(null);
    setWatchlistPreviewSymbols(null);
  };

  const beginWatchlistDrag = (event: DragEvent<HTMLElement>, symbol: string) => {
    if (!canEditWatchlist || watchlistSaving) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", symbol);
    event.dataTransfer.setDragImage(event.currentTarget, event.currentTarget.clientWidth / 2, event.currentTarget.clientHeight / 2);
    setWatchlistDragSource(symbol);
    setWatchlistDragTarget(null);
    setWatchlistPreviewSymbols(watchlistSymbols);
  };

  const updateWatchlistDropTarget = (event: DragEvent<HTMLElement>, targetSymbol: string) => {
    const draggedSymbol = watchlistDragSource ?? event.dataTransfer.getData("text/plain");
    if (!draggedSymbol || draggedSymbol === targetSymbol || !canEditWatchlist || watchlistSaving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const targetRect = event.currentTarget.getBoundingClientRect();
    const placement: WatchlistDropPlacement = event.clientY > targetRect.top + targetRect.height / 2 ? "after" : "before";
    setWatchlistDragTarget({ symbol: targetSymbol, placement });
    setWatchlistPreviewSymbols((current) => previewWatchlistReorder(current ?? watchlistSymbols, draggedSymbol, targetSymbol, placement));
  };

  const clearWatchlistDropTarget = (targetSymbol: string) => {
    setWatchlistDragTarget((current) => current?.symbol === targetSymbol ? null : current);
  };

  const dropWatchlistSymbol = (event: DragEvent<HTMLElement>, targetSymbol: string) => {
    if (!canEditWatchlist || watchlistSaving) {
      resetWatchlistDrag();
      return;
    }
    event.preventDefault();
    const draggedSymbol = watchlistDragSource ?? event.dataTransfer.getData("text/plain");
    const targetRect = event.currentTarget.getBoundingClientRect();
    const fallbackPlacement: WatchlistDropPlacement = event.clientY > targetRect.top + targetRect.height / 2 ? "after" : "before";
    const placement = watchlistDragTarget?.symbol === targetSymbol ? watchlistDragTarget.placement : fallbackPlacement;
    resetWatchlistDrag();
    if (!draggedSymbol || draggedSymbol === targetSymbol) {
      return;
    }
    onReorderWatchlistSymbol(draggedSymbol, targetSymbol, placement);
  };

  const toggleChatPanel = () => {
    setChatPanelOpen((current) => {
      const next = !current;
      if (next && activeMenu) {
        onCloseMenu();
      }
      return next;
    });
  };

  const toggleBottomMenu = (key: BottomMenuKey) => {
    setChatPanelOpen(false);
    onToggleMenu(key);
  };

  const submitAgentPrompt = async (event: FormEvent<HTMLFormElement>) => {
    const hasPrompt = Boolean(agentInput.trim());
    if (hasPrompt && activeMenu) {
      onCloseMenu();
    }
    const result = await onAgentSubmit(event);
    if (hasPrompt && result === "chart-shortcut") {
      setChatPanelOpen(false);
      return;
    }
    if (hasPrompt && result === "chat-log") {
      setChatPanelOpen(true);
    }
  };

  return (
    <>
      {hasFloatingPanel && (
        <button
          type="button"
          className="bottom-menu-dismiss-layer"
          aria-label="Close bottom floating panel"
          onClick={closeFloatingPanels}
        />
      )}
      <nav className="workspace-bottom-nav" aria-label="Workspace command bar">
        <MenuActionGroup
          side="left"
          keys={leftMenuKeys}
          activeMenu={activeMenu}
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          symbols={symbols}
          watchlistSymbols={watchlistPreviewSymbols ?? watchlistSymbols}
          watchlistPersisted={watchlistPersisted}
          watchlistLoading={watchlistLoading}
          watchlistSaving={watchlistSaving}
          watchlistDragSource={watchlistDragSource}
          watchlistDragTarget={watchlistDragTarget}
          canEditWatchlist={canEditWatchlist}
          activeSymbol={activeSymbol}
          onAddWatchlistSymbol={onAddWatchlistSymbol}
          onBeginWatchlistDrag={beginWatchlistDrag}
          onClearWatchlistDropTarget={clearWatchlistDropTarget}
          onDropWatchlistSymbol={dropWatchlistSymbol}
          onEndWatchlistDrag={resetWatchlistDrag}
          onUpdateWatchlistDropTarget={updateWatchlistDropTarget}
          onLogin={onLogin}
          onLogout={onLogout}
          onRemoveWatchlistSymbol={onRemoveWatchlistSymbol}
          onSelectSymbol={onSelectSymbol}
          onShowTreeMap={onShowTreeMap}
          onCloseMenu={onCloseMenu}
          onToggleMenu={toggleBottomMenu}
          alertUnreadCount={alertUnreadCount}
          onAlertUnreadCountChange={setAlertUnreadCount}
          layoutEditMode={layoutEditMode}
          layoutEditDisabled={!isChartMode}
          onToggleLayoutEditMode={onToggleLayoutEditMode}
        />
        <div className={`agent-dock ${chatPanelOpen ? "is-chat-open" : ""}`}>
          <button
            type="button"
            className="agent-dock-toggle"
            aria-label={chatPanelOpen ? "채팅 로그 닫기" : "채팅 로그 열기"}
            aria-expanded={chatPanelOpen}
            onClick={toggleChatPanel}
          >
            {chatPanelOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <section className={`bottom-chat-panel surface-floating ${chatPanelOpen ? "is-open" : ""}`} aria-label="Chart agent conversation" aria-hidden={!chatPanelOpen}>
            <div className="bottom-chat-log" role="log" aria-live="polite">
              {chatLog.length ? chatLog.map((entry) => (
                <article key={entry.id} className={`bottom-chat-message ${entry.role} ${entry.pending ? "is-pending" : ""}`}>
                  <span className="bottom-chat-message-role">
                    {entry.role === "user" ? "You" : entry.role === "assistant" ? "Agent" : "System"}
                    {entry.role === "assistant" && typeof entry.confidence === "number" && !entry.pending && (
                      <span
                        className={`bottom-chat-confidence-dot ${confidenceTone(entry.confidence)}`}
                        title={confidenceTitle(entry.confidence)}
                        aria-label={confidenceTitle(entry.confidence)}
                      />
                    )}
                  </span>
                  <ChatMessageBody entry={entry} />
                </article>
              )) : (
                <p className="bottom-chat-empty">질문을 입력하면 이곳에 대화가 남습니다.</p>
              )}
            </div>
          </section>
          <form className="agent-box surface-raised" onSubmit={submitAgentPrompt}>
            {selectedAgentReferenceCount > 0 && (
              <div className="agent-selected-sources" aria-label="선택한 자료">
                <span>{selectedAgentReferenceCount} 선택한 자료</span>
                <button
                  type="button"
                  className="agent-selected-sources-clear"
                  aria-label="선택한 자료 해제"
                  title="선택한 자료 해제"
                  onClick={onAgentReferencesClear}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            <input
              value={agentInput}
              onChange={(event) => onAgentInputChange(event.target.value)}
              placeholder={agentPlaceholder(isChartMode, canUseAgent)}
              aria-label="Agent command"
              disabled={agentBusy || !canUseAgent}
            />
            <button
              type={agentBusy ? "button" : "submit"}
              className={agentBusy ? "agent-stop-button" : undefined}
              aria-label={agentBusy ? "Agent 분석 중단" : "Agent에게 전송"}
              title={agentBusy ? "Agent 분석 중단" : "Agent에게 전송"}
              disabled={!agentBusy && !canUseAgent}
              onClick={agentBusy ? onAgentCancel : undefined}
            >
              {agentBusy ? <Square size={13} aria-hidden="true" /> : <SendHorizontal size={15} aria-hidden="true" />}
            </button>
          </form>
        </div>
        <MenuActionGroup
          side="right"
          keys={rightMenuKeys}
          activeMenu={activeMenu}
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          symbols={symbols}
          watchlistSymbols={watchlistPreviewSymbols ?? watchlistSymbols}
          watchlistPersisted={watchlistPersisted}
          watchlistLoading={watchlistLoading}
          watchlistSaving={watchlistSaving}
          watchlistDragSource={watchlistDragSource}
          watchlistDragTarget={watchlistDragTarget}
          canEditWatchlist={canEditWatchlist}
          activeSymbol={activeSymbol}
          onAddWatchlistSymbol={onAddWatchlistSymbol}
          onBeginWatchlistDrag={beginWatchlistDrag}
          onClearWatchlistDropTarget={clearWatchlistDropTarget}
          onDropWatchlistSymbol={dropWatchlistSymbol}
          onEndWatchlistDrag={resetWatchlistDrag}
          onUpdateWatchlistDropTarget={updateWatchlistDropTarget}
          onLogin={onLogin}
          onLogout={onLogout}
          onRemoveWatchlistSymbol={onRemoveWatchlistSymbol}
          onSelectSymbol={onSelectSymbol}
          onShowTreeMap={onShowTreeMap}
          onCloseMenu={onCloseMenu}
          onToggleMenu={toggleBottomMenu}
          alertUnreadCount={alertUnreadCount}
          onAlertUnreadCountChange={setAlertUnreadCount}
        />
      </nav>
    </>
  );
}

function ChatMessageBody({ entry }: { entry: ChatLogEntry }) {
  if (entry.role === "assistant" && !entry.pending && entry.analysisReport?.finalAnswer) {
    return <AgentAnalysisChatMessage report={entry.analysisReport} fallbackText={entry.text} />;
  }
  return (
    <p>
      <span className="bottom-chat-message-text">{entry.text}</span>
      {entry.pending && <span className="bottom-chat-loading-mark" aria-hidden="true">/</span>}
    </p>
  );
}

function AgentAnalysisChatMessage({ report, fallbackText }: { report: AgentAnalysisReport; fallbackText: string }) {
  const finalAnswer = report.finalAnswer;
  if (!finalAnswer) {
    return <p><span className="bottom-chat-message-text">{fallbackText}</span></p>;
  }
  const sections = finalAnswer.sections.filter((section) => section.title && section.bullets.length);
  const visibleSections = sections.filter((section) => !isCollapsibleAnalysisSection(section.title)).slice(0, 2);
  const collapsedSections = sections.filter((section) => isCollapsibleAnalysisSection(section.title));
  const linkedCitations = finalAnswer.citations.filter((citation) => Boolean(citation.url)).slice(0, 5);
  const timingSummary = formatAgentTimingSummary(report.timing);

  return (
    <div className="agent-analysis-message">
      <p className="agent-analysis-title">{finalAnswer.title}</p>
      <p className="agent-analysis-summary">{finalAnswer.summary}</p>
      {visibleSections.map((section) => <AgentAnalysisSection key={section.title} section={section} />)}
      {collapsedSections.map((section) => <AgentAnalysisDetails key={section.title} section={section} />)}
      {linkedCitations.length > 0 && (
        <details className="agent-analysis-details">
          <summary>근거 링크</summary>
          <ul>
            {linkedCitations.map((citation) => (
              <li key={`${citation.title}-${citation.url}`}>
                {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a> : citation.title}
              </li>
            ))}
          </ul>
        </details>
      )}
      {timingSummary && <p className="agent-analysis-timing">{timingSummary}</p>}
    </div>
  );
}

function AgentAnalysisSection({ section }: { section: FinalAnswerSection }) {
  return (
    <section className="agent-analysis-section">
      <h4>{section.title}</h4>
      <ul>
        {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
      </ul>
    </section>
  );
}

function AgentAnalysisDetails({ section }: { section: FinalAnswerSection }) {
  return (
    <details className="agent-analysis-details">
      <summary>{section.title}</summary>
      <ul>
        {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
      </ul>
    </details>
  );
}

function isCollapsibleAnalysisSection(title: string): boolean {
  return ["판단 근거", "분석한 지표", "반대로 볼 점"].includes(title.trim());
}

function MenuActionGroup({
  side,
  keys,
  activeMenu,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  watchlistSymbols,
  watchlistPersisted,
  watchlistLoading,
  watchlistSaving,
  watchlistDragSource,
  watchlistDragTarget,
  canEditWatchlist,
  activeSymbol,
  onAddWatchlistSymbol,
  onBeginWatchlistDrag,
  onClearWatchlistDropTarget,
  onDropWatchlistSymbol,
  onEndWatchlistDrag,
  onUpdateWatchlistDropTarget,
  onLogin,
  onLogout,
  onRemoveWatchlistSymbol,
  onSelectSymbol,
  onShowTreeMap,
  onCloseMenu,
  onToggleMenu,
  alertUnreadCount,
  onAlertUnreadCountChange,
  layoutEditMode = false,
  layoutEditDisabled = true,
  onToggleLayoutEditMode
}: {
  side: BottomMenuSide;
  keys: BottomMenuKey[];
  activeMenu: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  watchlistSymbols: ChartSymbolDto[];
  watchlistPersisted: boolean;
  watchlistLoading: boolean;
  watchlistSaving: boolean;
  watchlistDragSource: string | null;
  watchlistDragTarget: WatchlistDragTarget | null;
  canEditWatchlist: boolean;
  activeSymbol: string;
  onAddWatchlistSymbol: (symbol: string) => void;
  onBeginWatchlistDrag: (event: DragEvent<HTMLElement>, symbol: string) => void;
  onClearWatchlistDropTarget: (targetSymbol: string) => void;
  onDropWatchlistSymbol: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onEndWatchlistDrag: () => void;
  onUpdateWatchlistDropTarget: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onRemoveWatchlistSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onCloseMenu: () => void;
  onToggleMenu: (key: BottomMenuKey) => void;
  alertUnreadCount: number;
  onAlertUnreadCountChange: (count: number) => void;
  layoutEditMode?: boolean;
  layoutEditDisabled?: boolean;
  onToggleLayoutEditMode?: () => void;
}) {
  const isMenuOpen = activeMenu !== null && keys.includes(activeMenu);

  return (
    <div
      className={`bottom-nav-actions ${side} ${isMenuOpen ? "is-menu-open" : ""}`}
      aria-label={`Menu actions ${side}`}
    >
      <BottomMenuPanel
        side={side}
        activeKey={activeMenu}
        authEnabled={authEnabled}
        authLoading={authLoading}
        authUser={authUser}
        symbols={symbols}
        watchlistSymbols={watchlistSymbols}
        watchlistPersisted={watchlistPersisted}
        watchlistLoading={watchlistLoading}
        watchlistSaving={watchlistSaving}
        watchlistDragSource={watchlistDragSource}
        watchlistDragTarget={watchlistDragTarget}
        canEditWatchlist={canEditWatchlist}
        activeSymbol={activeSymbol}
        onAddWatchlistSymbol={onAddWatchlistSymbol}
        onBeginWatchlistDrag={onBeginWatchlistDrag}
        onClearWatchlistDropTarget={onClearWatchlistDropTarget}
        onDropWatchlistSymbol={onDropWatchlistSymbol}
        onEndWatchlistDrag={onEndWatchlistDrag}
        onUpdateWatchlistDropTarget={onUpdateWatchlistDropTarget}
        onLogin={onLogin}
        onLogout={onLogout}
        onRemoveWatchlistSymbol={onRemoveWatchlistSymbol}
        onSelectSymbol={onSelectSymbol}
        onShowTreeMap={onShowTreeMap}
        onClose={onCloseMenu}
        onAlertUnreadCountChange={onAlertUnreadCountChange}
      />
      {keys.map((label) => (
        <button
          key={label}
          type="button"
          className={`workspace-nav-button surface-raised ${activeMenu === label ? "is-active" : ""}`}
          aria-label={bottomMenuLabel(label, label === "IV" ? alertUnreadCount : 0)}
          title={bottomMenuLabel(label, label === "IV" ? alertUnreadCount : 0)}
          aria-expanded={activeMenu === label}
          onClick={() => onToggleMenu(label)}
        >
          {bottomMenuIcon(label, label === "IV" ? alertUnreadCount : 0)}
        </button>
      ))}
      {side === "left" && (
        <button
          type="button"
          className={`workspace-nav-button layout-edit-toggle surface-raised ${layoutEditMode ? "is-active" : ""}`}
          aria-label={layoutEditMode ? "레이아웃 수정모드 종료" : "레이아웃 수정모드 시작"}
          title={layoutEditMode ? "레이아웃 수정모드 종료" : "레이아웃 수정모드 시작"}
          aria-pressed={layoutEditMode}
          disabled={layoutEditDisabled}
          onClick={onToggleLayoutEditMode}
        >
          <LayoutPanelTop size={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function BottomMenuPanel({
  side,
  activeKey,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  watchlistSymbols,
  watchlistPersisted,
  watchlistLoading,
  watchlistSaving,
  watchlistDragSource,
  watchlistDragTarget,
  canEditWatchlist,
  activeSymbol,
  onAddWatchlistSymbol,
  onBeginWatchlistDrag,
  onClearWatchlistDropTarget,
  onDropWatchlistSymbol,
  onEndWatchlistDrag,
  onUpdateWatchlistDropTarget,
  onLogin,
  onLogout,
  onRemoveWatchlistSymbol,
  onSelectSymbol,
  onShowTreeMap,
  onClose,
  onAlertUnreadCountChange
}: {
  side: BottomMenuSide;
  activeKey: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  watchlistSymbols: ChartSymbolDto[];
  watchlistPersisted: boolean;
  watchlistLoading: boolean;
  watchlistSaving: boolean;
  watchlistDragSource: string | null;
  watchlistDragTarget: WatchlistDragTarget | null;
  canEditWatchlist: boolean;
  activeSymbol: string;
  onAddWatchlistSymbol: (symbol: string) => void;
  onBeginWatchlistDrag: (event: DragEvent<HTMLElement>, symbol: string) => void;
  onClearWatchlistDropTarget: (targetSymbol: string) => void;
  onDropWatchlistSymbol: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onEndWatchlistDrag: () => void;
  onUpdateWatchlistDropTarget: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onRemoveWatchlistSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onClose: () => void;
  onAlertUnreadCountChange: (count: number) => void;
}) {
  const sideKeys = side === "left" ? leftMenuKeys : rightMenuKeys;
  const isOpen = activeKey !== null && sideKeys.includes(activeKey);
  const menuContent = isOpen
    ? bottomMenuContent({
      activeKey,
      authEnabled,
      authLoading,
      authUser,
      symbols,
      watchlistSymbols,
      watchlistPersisted,
      watchlistLoading,
      watchlistSaving,
      watchlistDragSource,
      watchlistDragTarget,
      canEditWatchlist,
      activeSymbol,
      onAddWatchlistSymbol,
      onBeginWatchlistDrag,
      onClearWatchlistDropTarget,
      onDropWatchlistSymbol,
      onEndWatchlistDrag,
      onUpdateWatchlistDropTarget,
      onLogin,
      onLogout,
      onRemoveWatchlistSymbol,
      onSelectSymbol,
      onShowTreeMap,
      onClose,
      onAlertUnreadCountChange
    })
    : <p className="bottom-menu-empty">Menu</p>;

  return (
    <section
      className={`bottom-menu-panel surface-floating ${side} ${isOpen ? "is-open" : ""}`}
      aria-label={`${side === "left" ? "Left" : "Right"} menu panel`}
      aria-hidden={!isOpen}
    >
      <div className="bottom-menu-list">{menuContent}</div>
    </section>
  );
}

function agentPlaceholder(isChartMode: boolean, canUseAgent: boolean): string {
  if (!canUseAgent) {
    return "로그인 후 Agent를 사용할 수 있습니다";
  }
  return isChartMode ? "Agent에게 물어보기" : "기업명/티커로 차트 열기";
}

function readSocketPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function bottomMenuIcon(key: BottomMenuKey, alertUnreadCount = 0): ReactNode {
  const size = 17;
  if (key === "IV") {
    return (
      <span className="workspace-nav-icon-wrap">
        <Bell size={size} aria-hidden="true" />
        {alertUnreadCount > 0 && (
          <span className="workspace-nav-badge" aria-hidden="true">
            {formatBadgeCount(alertUnreadCount)}
          </span>
        )}
      </span>
    );
  }
  return {
    I: <LayoutPanelTop size={size} aria-hidden="true" />,
    II: <WalletCards size={size} aria-hidden="true" />,
    III: <Star size={size} aria-hidden="true" />,
    V: <UserCircle size={size} aria-hidden="true" />,
    VI: <Settings size={size} aria-hidden="true" />
  }[key];
}

function bottomMenuLabel(key: BottomMenuKey, alertUnreadCount = 0): string {
  const label = {
    I: "레이아웃/페이지",
    II: "포트폴리오",
    III: "관심종목",
    IV: "알림설정",
    V: "계정",
    VI: "설정"
  }[key];
  if (key === "IV" && alertUnreadCount > 0) {
    return `${label}, 읽지 않은 알림 ${alertUnreadCount}개`;
  }
  return label;
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function previewWatchlistReorder(
  symbols: readonly ChartSymbolDto[],
  draggedSymbol: string,
  targetSymbol: string,
  placement: WatchlistDropPlacement
): ChartSymbolDto[] {
  if (draggedSymbol === targetSymbol) {
    return [...symbols];
  }
  const draggedItem = symbols.find((item) => item.symbol === draggedSymbol);
  if (!draggedItem || !symbols.some((item) => item.symbol === targetSymbol)) {
    return [...symbols];
  }
  const withoutDragged = symbols.filter((item) => item.symbol !== draggedSymbol);
  const targetIndex = withoutDragged.findIndex((item) => item.symbol === targetSymbol);
  if (targetIndex < 0) {
    return [...symbols];
  }
  const nextSymbols = [...withoutDragged];
  nextSymbols.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedItem);
  return nextSymbols.every((item, index) => item.symbol === symbols[index]?.symbol) ? [...symbols] : nextSymbols;
}

function bottomMenuContent({
  activeKey,
  authEnabled,
  authLoading,
  authUser,
  symbols,
  watchlistSymbols,
  watchlistPersisted,
  watchlistLoading,
  watchlistSaving,
  watchlistDragSource,
  watchlistDragTarget,
  canEditWatchlist,
  activeSymbol,
  onAddWatchlistSymbol,
  onBeginWatchlistDrag,
  onClearWatchlistDropTarget,
  onDropWatchlistSymbol,
  onEndWatchlistDrag,
  onUpdateWatchlistDropTarget,
  onLogin,
  onLogout,
  onRemoveWatchlistSymbol,
  onSelectSymbol,
  onShowTreeMap,
  onClose,
  onAlertUnreadCountChange
}: {
  activeKey: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  symbols: ChartSymbolDto[];
  watchlistSymbols: ChartSymbolDto[];
  watchlistPersisted: boolean;
  watchlistLoading: boolean;
  watchlistSaving: boolean;
  watchlistDragSource: string | null;
  watchlistDragTarget: WatchlistDragTarget | null;
  canEditWatchlist: boolean;
  activeSymbol: string;
  onAddWatchlistSymbol: (symbol: string) => void;
  onBeginWatchlistDrag: (event: DragEvent<HTMLElement>, symbol: string) => void;
  onClearWatchlistDropTarget: (targetSymbol: string) => void;
  onDropWatchlistSymbol: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onEndWatchlistDrag: () => void;
  onUpdateWatchlistDropTarget: (event: DragEvent<HTMLElement>, targetSymbol: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onRemoveWatchlistSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onShowTreeMap: () => void;
  onClose: () => void;
  onAlertUnreadCountChange: (count: number) => void;
}) {
  switch (activeKey) {
    case "I":
      return (
        <div className="bottom-menu-section">
          <MenuTitle icon={<LayoutPanelTop size={15} />} title="레이아웃" detail="페이지와 배치" />
          <button
            type="button"
            className="bottom-menu-item surface-raised"
            onClick={() => {
              onShowTreeMap();
              onClose();
            }}
          >
            홈화면
          </button>
        </div>
      );
    case "II":
      return (
        <div className="bottom-menu-section bottom-menu-scroll">
          <MenuTitle title="포트폴리오" detail="보유종목" />
          <PortfolioHoldingsPanel
            onSelectSymbol={(symbol) => {
              onSelectSymbol(symbol);
              onClose();
              return true;
            }}
          />
        </div>
      );
    case "III":
      const watchlistTitle = canEditWatchlist && watchlistPersisted ? "내 관심종목" : "관심종목";
      const watchlistDetail = authLoading
        ? "계정 확인 중"
        : canEditWatchlist
          ? watchlistPersisted ? "저장된 목록" : "기본 목록"
          : "읽기 전용";
      return (
        <div className="bottom-menu-section bottom-menu-scroll">
          <MenuTitle icon={<Star size={15} />} title={watchlistTitle} detail={watchlistDetail} />
          {canEditWatchlist ? (
            <div className="bottom-watchlist-toolbar">
              <SymbolSearch
                symbols={symbols}
                compact
                className="bottom-watchlist-search"
                selectedLabel=""
                placeholder="종목 검색 후 추가"
                onSelectSymbol={onAddWatchlistSymbol}
                formatSelectedLabel={(symbolOption) => symbolOption.symbol}
              />
            </div>
          ) : (
            <button
              type="button"
              className="bottom-menu-item surface-raised"
              disabled={authLoading}
              onClick={onLogin}
            >
              로그인 후 수정
            </button>
          )}
          <div className="bottom-watchlist">
            {watchlistSymbols.map((item) => (
              <div
                key={item.symbol}
                className={[
                  "bottom-watchlist-row",
                  item.symbol === activeSymbol ? "active" : "",
                  canEditWatchlist ? "can-reorder" : "",
                  watchlistDragSource === item.symbol ? "is-dragging" : "",
                  watchlistDragTarget?.symbol === item.symbol ? "is-drag-over" : "",
                  watchlistDragTarget?.symbol === item.symbol ? `drop-${watchlistDragTarget.placement}` : ""
                ].filter(Boolean).join(" ")}
                draggable={canEditWatchlist && !watchlistSaving}
                aria-grabbed={watchlistDragSource === item.symbol}
                onDragStart={(event) => onBeginWatchlistDrag(event, item.symbol)}
                onDragOver={(event) => onUpdateWatchlistDropTarget(event, item.symbol)}
                onDragLeave={() => onClearWatchlistDropTarget(item.symbol)}
                onDrop={(event) => onDropWatchlistSymbol(event, item.symbol)}
                onDragEnd={onEndWatchlistDrag}
              >
                {canEditWatchlist && (
                  <span
                    className="bottom-watchlist-drag-handle"
                    aria-hidden="true"
                    title={`${item.symbol} 드래그해서 순서 변경`}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </span>
                )}
                <button
                  type="button"
                  className="bottom-watchlist-select"
                  onClick={() => {
                    onSelectSymbol(item.symbol);
                    onClose();
                  }}
                >
                  <StockLogo symbol={item.symbol} companyName={item.name} size="xs" />
                  <span className="bottom-watchlist-copy">
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="bottom-watchlist-row-action"
                  aria-label={canEditWatchlist ? `${item.symbol} 관심종목 삭제` : "로그인 후 관심종목 삭제"}
                  title={canEditWatchlist ? `${item.symbol} 관심종목 삭제` : "로그인 후 관심종목 삭제"}
                  disabled={authLoading || watchlistSaving}
                  onClick={() => {
                    if (canEditWatchlist) {
                      onRemoveWatchlistSymbol(item.symbol);
                      return;
                    }
                    onLogin();
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
            {!watchlistLoading && watchlistSymbols.length === 0 && (
              <p className="bottom-menu-empty">관심종목이 없습니다.</p>
            )}
            <LogoDevAttribution className="bottom-watchlist-attribution" />
          </div>
        </div>
      );
    case "IV":
      return (
        <AlertMenu
          activeSymbol={activeSymbol}
          symbols={symbols}
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          onLogin={onLogin}
          onUnreadCountChange={onAlertUnreadCountChange}
        />
      );
    case "V":
      return (
        <SettingsMenu
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          onLogin={onLogin}
          onLogout={onLogout}
          initialTab="account"
        />
      );
    case "VI":
      return (
        <SettingsMenu
          authEnabled={authEnabled}
          authLoading={authLoading}
          authUser={authUser}
          onLogin={onLogin}
          onLogout={onLogout}
          initialTab="account"
        />
      );
    default:
      return <p className="bottom-menu-empty">Menu</p>;
  }
}

function SettingsMenu({
  authEnabled,
  authLoading,
  authUser,
  onLogin,
  onLogout,
  initialTab
}: {
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  onLogin: () => void;
  onLogout: () => void;
  initialTab: "account" | "recommendations";
}) {
  const [activeTab, setActiveTab] = useState<"account" | "recommendations">(initialTab);
  const recommendationDisabled = authLoading || (authEnabled && !authUser);

  return (
    <div className="bottom-menu-section bottom-menu-scroll settings-menu-section">
      <MenuTitle icon={<Settings size={15} />} title="설정" detail="계정과 추천" />
      <div className="settings-tab-list" role="tablist" aria-label="설정 탭">
        <button
          type="button"
          role="tab"
          className={`settings-tab ${activeTab === "account" ? "active" : ""}`}
          aria-selected={activeTab === "account"}
          onClick={() => setActiveTab("account")}
        >
          계정
        </button>
        <button
          type="button"
          role="tab"
          className={`settings-tab ${activeTab === "recommendations" ? "active" : ""}`}
          aria-selected={activeTab === "recommendations"}
          onClick={() => setActiveTab("recommendations")}
        >
          추천 설정
        </button>
      </div>
      {activeTab === "account" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <MenuTitle icon={<UserCircle size={15} />} title="계정" detail={authEnabled ? "Google OAuth" : "Local dev"} />
          {authLoading && <p className="bottom-menu-empty">계정 상태를 확인하고 있습니다.</p>}
          {!authLoading && authUser && (
            <div className="account-menu-card">
              {authUser.picture && <img src={authUser.picture} alt="" />}
              <strong>{authUser.name || authUser.email}</strong>
              <span>{authUser.email}</span>
            </div>
          )}
          {!authLoading && !authUser && !authEnabled && (
            <p className="bottom-menu-empty">로컬 개발 모드에서는 로그인 없이 Agent를 사용할 수 있습니다.</p>
          )}
          {!authLoading && !authUser && authEnabled && (
            <button className="bottom-menu-item surface-raised" type="button" onClick={onLogin}>
              Google login
            </button>
          )}
          {authUser && (
            <button className="bottom-menu-item surface-raised danger" type="button" onClick={onLogout}>
              로그아웃
            </button>
          )}
        </div>
      ) : (
        <div className="settings-tab-panel" role="tabpanel">
          {recommendationDisabled ? (
            <button className="bottom-menu-item surface-raised" type="button" disabled={authLoading} onClick={onLogin}>
              로그인 후 추천 설정
            </button>
          ) : (
            <InvestmentProfileForm disabled={recommendationDisabled} />
          )}
        </div>
      )}
    </div>
  );
}

function confidenceTone(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.75) {
    return "high";
  }
  if (confidence >= 0.5) {
    return "medium";
  }
  return "low";
}

function confidenceTitle(confidence: number): string {
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `신뢰도 ${percent}%`;
}

function MenuTitle({ icon, title, detail }: { icon?: ReactNode; title: string; detail: string }) {
  return (
    <header className="bottom-menu-title">
      {icon}
      <span>{title}</span>
      <small>{detail}</small>
    </header>
  );
}
