import { Bell, CandlestickChart, GripVertical, LogIn, MessagesSquare, Newspaper, SendHorizontal, Settings, Square, Star, Trash2, UserCircle, WalletCards, X } from "lucide-react";
import { type DragEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { AgentReferenceChip } from "../agent/agentReferences";
import { AlertMenu } from "../alerts/AlertMenu";
import { AlertToast } from "../alerts/AlertToast";
import { fetchNotifications, markNotificationRead, normalizeNotificationPayload, notificationSocketUrl, type NotificationItem } from "../alerts/alertApi";
import {
  createMarketOpenNotification,
  isMarketOpenNotification,
  readMarketOpenReminderEnabled,
  shouldShowMarketOpenReminder,
  writeMarketOpenReminderEnabled
} from "../alerts/marketOpenReminder";
import { notificationChartSymbol } from "../alerts/alertPresentation";
import { formatAgentTimingSummary, type AgentAnalysisReport, type FinalAnswerSection } from "../agents/agentAnalysis";
import type { AuthUser } from "../auth/AuthProvider";
import type { ChartSymbolDto } from "../chart/types";
import { fetchNextMarketOpen } from "../market/marketOpenApi";
import { InvestmentProfileForm } from "../recommendations/InvestmentProfileForm";
import { PortfolioHoldingsOnlyPanel, PortfolioInvestmentStatusPanel } from "./PortfolioHoldingsPanel";
import { SymbolSearch } from "./SymbolSearch";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

export type BottomMenuKey = "II" | "III" | "IV" | "V" | "VI";
export type SideRailCompany = {
  symbol: string;
  companyName?: string;
};

export type ChatLogEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
  confidence?: number;
  analysisReport?: AgentAnalysisReport | null;
};
export type AgentSubmitResult = "chat-log" | "chart-shortcut" | "ui-action" | "ignored";

type BottomMenuSide = "left" | "right";
type WatchlistDropPlacement = "before" | "after";
type WatchlistDragTarget = {
  symbol: string;
  placement: WatchlistDropPlacement;
};
type AlertToastQueueState = {
  current: AlertToastQueueItem | null;
  queue: AlertToastQueueItem[];
};
type AlertToastQueueItem = {
  notification: NotificationItem;
  autoDismissMs?: number;
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
  agentReferenceChips: AgentReferenceChip[];
  symbols: ChartSymbolDto[];
  watchlistSymbols: ChartSymbolDto[];
  watchlistPersisted: boolean;
  watchlistLoading: boolean;
  watchlistSaving: boolean;
  canEditWatchlist: boolean;
  activeSymbol: string;
  sideRailCompany: SideRailCompany | null;
  isChartMode: boolean;
  layoutEditMode: boolean;
  topDock?: ReactNode;
  onAgentCancel: () => void;
  onAgentReferencesClear: () => void;
  onAgentReferenceRemove: (key: string) => void;
  onAgentReferenceEmphasize: (keys: string[]) => void;
  onAgentInputChange: (value: string) => void;
  onAgentSubmit: (event: FormEvent<HTMLFormElement>) => AgentSubmitResult | Promise<AgentSubmitResult>;
  onAddWatchlistSymbol: (symbol: string) => void;
  onCloseMenu: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onReorderWatchlistSymbol: (draggedSymbol: string, targetSymbol: string, placement: WatchlistDropPlacement) => void;
  onRemoveWatchlistSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onToggleLayoutEditMode: () => void;
  onToggleMenu: (key: BottomMenuKey) => void;
};

const leftMenuKeys: BottomMenuKey[] = [];
const sideMenuKeys: BottomMenuKey[] = ["IV", "II", "III", "V", "VI"];
const sideRailMenuKeys: BottomMenuKey[] = sideMenuKeys.filter((key) => key !== "IV");
const rightMenuKeys: BottomMenuKey[] = [];
const alertToastAdvanceMs = 6000;
const marketOpenRetryMs = 60_000;
const marketOpenScheduleRefreshMs = 60 * 60_000;

export function BottomCommandBar({
  activeMenu,
  agentBusy,
  agentInput,
  chatLog,
  authEnabled,
  authLoading,
  authUser,
  canUseAgent,
  agentReferenceChips,
  symbols,
  watchlistSymbols,
  watchlistPersisted,
  watchlistLoading,
  watchlistSaving,
  canEditWatchlist,
  activeSymbol,
  sideRailCompany,
  isChartMode,
  layoutEditMode,
  topDock,
  onAgentCancel,
  onAgentReferencesClear,
  onAgentReferenceRemove,
  onAgentReferenceEmphasize,
  onAgentInputChange,
  onAgentSubmit,
  onAddWatchlistSymbol,
  onCloseMenu,
  onLogin,
  onLogout,
  onReorderWatchlistSymbol,
  onRemoveWatchlistSymbol,
  onSelectSymbol,
  onToggleLayoutEditMode,
  onToggleMenu
}: BottomCommandBarProps) {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [watchlistDragSource, setWatchlistDragSource] = useState<string | null>(null);
  const [watchlistDragTarget, setWatchlistDragTarget] = useState<WatchlistDragTarget | null>(null);
  const [watchlistPreviewSymbols, setWatchlistPreviewSymbols] = useState<ChartSymbolDto[] | null>(null);
  const [alertUnreadCount, setAlertUnreadCount] = useState(0);
  const [alertToastState, setAlertToastState] = useState<AlertToastQueueState>({ current: null, queue: [] });
  const [externallyReadNotification, setExternallyReadNotification] = useState<NotificationItem | null>(null);
  const [marketOpenReminderEnabled, setMarketOpenReminderEnabled] = useState(() => readMarketOpenReminderEnabled());
  const seenAlertToastKeysRef = useRef<Set<string>>(new Set());
  const hasFloatingPanel = activeMenu !== null || chatPanelOpen;
  const canUseAlerts = !authLoading && (!authEnabled || Boolean(authUser));

  const enqueueAlertToast = (notification: NotificationItem, options: { autoDismissMs?: number } = {}) => {
    const key = alertToastKey(notification);
    if (seenAlertToastKeysRef.current.has(key)) {
      return;
    }
    seenAlertToastKeysRef.current.add(key);
    const item = { notification, autoDismissMs: options.autoDismissMs };
    setAlertToastState((current) => (
      current.current
        ? { current: current.current, queue: [...current.queue, item] }
        : { current: item, queue: [] }
    ));
  };

  const advanceAlertToast = () => {
    setAlertToastState((current) => {
      const [next, ...queue] = current.queue;
      return { current: next ?? null, queue };
    });
  };

  const toggleMarketOpenReminder = (enabled: boolean) => {
    setMarketOpenReminderEnabled(enabled);
    writeMarketOpenReminderEnabled(enabled);
  };

  const openAlertToastChart = (notification: NotificationItem) => {
    const symbol = notificationChartSymbol(notification);
    if (symbol) {
      onSelectSymbol(symbol);
    }
    if (activeMenu) {
      onCloseMenu();
    }
    void markAlertToastRead(notification);
    advanceAlertToast();
  };

  const markAlertToastRead = async (notification: NotificationItem) => {
    if (notification.readAt) {
      return;
    }
    try {
      const updated = await markNotificationRead(notification.id);
      if (!updated?.readAt) {
        return;
      }
      setExternallyReadNotification(updated);
      setAlertUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      // Opening the chart should not be blocked by a transient read-state failure.
    }
  };

  useEffect(() => {
    if (!hasFloatingPanel) {
      return undefined;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".bottom-menu-panel, .bottom-nav-actions, .bottom-chat-panel, .agent-dock, .index-side-rail, .symbol-search-menu, .workspace-top-nav")) {
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
      setExternallyReadNotification(null);
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
        if (notification && !notification.readAt) {
          setAlertUnreadCount((current) => current + 1);
          enqueueAlertToast(notification);
        }
      }
    };
    return () => socket.close();
  }, [canUseAlerts]);

  useEffect(() => {
    if (!alertToastState.current) {
      return undefined;
    }
    if (isMarketOpenNotification(alertToastState.current.notification) && alertToastState.queue.length === 0) {
      return undefined;
    }
    const timeoutMs = alertToastState.queue.length > 0
      ? alertToastAdvanceMs
      : alertToastState.current.autoDismissMs;
    if (!timeoutMs) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      advanceAlertToast();
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [
    alertToastState.current?.notification.eventId,
    alertToastState.current?.notification.id,
    alertToastState.current?.autoDismissMs,
    alertToastState.queue.length
  ]);

  useEffect(() => {
    if (!marketOpenReminderEnabled) {
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = (delayMs: number, callback: () => void) => {
      clearTimer();
      timer = window.setTimeout(callback, clampReminderDelay(delayMs));
    };

    const scheduleNextOpenCheck = (nextOpenAt: string) => {
      const openMs = new Date(nextOpenAt).getTime();
      if (!Number.isFinite(openMs)) {
        schedule(marketOpenRetryMs, refreshSchedule);
        return;
      }

      const delayMs = openMs - Date.now();
      if (delayMs > marketOpenScheduleRefreshMs) {
        schedule(marketOpenScheduleRefreshMs, refreshSchedule);
        return;
      }

      schedule(delayMs, () => {
        if (cancelled) {
          return;
        }
        if (shouldShowMarketOpenReminder(nextOpenAt)) {
          enqueueAlertToast(createMarketOpenNotification(nextOpenAt));
        }
        schedule(marketOpenRetryMs, refreshSchedule);
      });
    };

    const refreshSchedule = () => {
      controller?.abort();
      controller = new AbortController();
      void fetchNextMarketOpen(controller.signal)
        .then((nextOpen) => {
          if (cancelled) {
            return;
          }
          scheduleNextOpenCheck(nextOpen.nextOpenAt);
        })
        .catch(() => {
          if (!cancelled) {
            schedule(marketOpenRetryMs, refreshSchedule);
          }
        });
    };

    refreshSchedule();
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimer();
    };
  }, [marketOpenReminderEnabled]);

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
      {alertToastState.current && (
        <AlertToast
          notification={alertToastState.current.notification}
          queuedCount={alertToastState.queue.length}
          onClose={advanceAlertToast}
          onOpenChart={openAlertToastChart}
        />
      )}
      <nav className="workspace-top-nav" aria-label="Global navigation">
        <div className="workspace-top-center">
          {topDock}
        </div>
        <div className="workspace-top-actions">
          <button
            type="button"
            className={`workspace-top-action workspace-top-alert ${activeMenu === "IV" ? "is-active" : ""}`}
            aria-label={bottomMenuLabel("IV", alertUnreadCount)}
            title={bottomMenuLabel("IV", alertUnreadCount)}
            aria-controls="workspace-side-menu-panel"
            aria-expanded={activeMenu === "IV"}
            onClick={() => toggleBottomMenu("IV")}
          >
            {bottomMenuIcon("IV", alertUnreadCount)}
          </button>
          <button
            type="button"
            className={`workspace-top-login ${activeMenu === "VI" ? "is-active" : ""}`}
            disabled={authLoading}
            aria-label={topLoginLabel(authEnabled, authLoading, authUser)}
            title={topLoginLabel(authEnabled, authLoading, authUser)}
            onClick={authUser ? () => toggleBottomMenu("VI") : onLogin}
          >
            {authUser ? <UserCircle size={15} aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
            <span>{topLoginLabel(authEnabled, authLoading, authUser)}</span>
          </button>
        </div>
      </nav>
      <BottomMenuPanel
        id="workspace-side-menu-panel"
        variant="side"
        side="right"
        menuKeys={sideMenuKeys}
        activeKey={activeMenu}
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
        onClose={onCloseMenu}
        externallyReadNotification={externallyReadNotification}
        marketOpenReminderEnabled={marketOpenReminderEnabled}
        onMarketOpenReminderChange={toggleMarketOpenReminder}
        onAlertUnreadCountChange={setAlertUnreadCount}
      />
      <SideRailMenu
        company={sideRailCompany}
        activeMenu={activeMenu}
        authEnabled={authEnabled}
        authLoading={authLoading}
        authUser={authUser}
        onLogin={onLogin}
        onSelectSymbol={onSelectSymbol}
        onToggleMenu={toggleBottomMenu}
      />
      <nav className="workspace-bottom-nav" aria-label="Workspace command bar">
        <div className="bottom-command-slot is-agent">
          <div className={`agent-dock ${chatPanelOpen ? "is-chat-open" : ""}`}>
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
              <AgentReferenceStrip
                chips={agentReferenceChips}
                onRemove={onAgentReferenceRemove}
                onClearAll={onAgentReferencesClear}
                onEmphasize={onAgentReferenceEmphasize}
              />
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
              <button
                type="button"
                className={`agent-chat-toggle ${chatPanelOpen ? "is-active" : ""}`}
                aria-label={chatPanelOpen ? "대화창 닫기" : "대화창 열기"}
                title={chatPanelOpen ? "대화창 닫기" : "대화창 열기"}
                aria-expanded={chatPanelOpen}
                onClick={toggleChatPanel}
              >
                <MessagesSquare size={15} aria-hidden="true" />
              </button>
              {layoutEditMode && (
                <button
                  type="button"
                  className="layout-exit-button agent-layout-exit-button"
                  aria-label="레이아웃 수정모드 종료"
                  title="레이아웃 수정모드 종료"
                  onClick={onToggleLayoutEditMode}
                >
                  Leave
                </button>
              )}
            </form>
          </div>
        </div>
      </nav>
    </>
  );
}

function AgentReferenceStrip({
  chips,
  onRemove,
  onClearAll,
  onEmphasize
}: {
  chips: AgentReferenceChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
  onEmphasize: (keys: string[]) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (chips.length === 0) {
    return null;
  }

  const allKeys = chips.map((chip) => chip.key);
  const trashHovered = hoveredKey === "__all__";

  const emphasizeAll = () => {
    setHoveredKey("__all__");
    onEmphasize(allKeys);
  };
  const emphasizeChip = (key: string) => {
    setHoveredKey(key);
    onEmphasize([key]);
  };
  const clearEmphasis = () => {
    setHoveredKey(null);
    onEmphasize([]);
  };

  return (
    <div className="agent-reference-strip" aria-label="선택한 자료">
      <button
        type="button"
        className={`agent-reference-clear ${trashHovered ? "is-armed" : ""}`}
        aria-label="선택한 자료 전체 해제"
        title="선택한 자료 전체 해제"
        onPointerEnter={emphasizeAll}
        onPointerLeave={clearEmphasis}
        onFocus={emphasizeAll}
        onBlur={clearEmphasis}
        onClick={() => {
          clearEmphasis();
          onClearAll();
        }}
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
      {chips.map((chip) => {
        const active = hoveredKey === chip.key;
        const Icon = chip.kind === "candle" ? CandlestickChart : Newspaper;
        const kindLabel = chip.kind === "candle" ? "캔들" : "뉴스";
        const label = chip.ticker ? `${chip.ticker} ${kindLabel}` : kindLabel;
        return (
          <button
            key={chip.key}
            type="button"
            className={`agent-reference-chip ${chip.kind} ${active ? "is-armed" : ""}`}
            aria-label={`${label} 참조 해제`}
            title={`${label} 참조 해제`}
            onPointerEnter={() => emphasizeChip(chip.key)}
            onPointerLeave={clearEmphasis}
            onFocus={() => emphasizeChip(chip.key)}
            onBlur={clearEmphasis}
            onClick={() => {
              clearEmphasis();
              onRemove(chip.key);
            }}
          >
            <span className="agent-reference-chip-icon" aria-hidden="true">
              {active ? <X size={13} /> : <Icon size={13} />}
            </span>
            {chip.ticker && <span className="agent-reference-chip-ticker">{chip.ticker}</span>}
          </button>
        );
      })}
    </div>
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

function SideRailMenu({
  company,
  activeMenu,
  authEnabled,
  authLoading,
  authUser,
  onLogin,
  onSelectSymbol,
  onToggleMenu
}: {
  company: SideRailCompany | null;
  activeMenu: BottomMenuKey | null;
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  onLogin: () => void;
  onSelectSymbol: (symbol: string) => void;
  onToggleMenu: (key: BottomMenuKey) => void;
}) {
  if (!company) {
    return null;
  }
  const railMenuOpen = activeMenu !== null && sideRailMenuKeys.includes(activeMenu);

  return (
    <nav className={`index-side-rail ${railMenuOpen ? "is-menu-open" : ""}`} aria-label="선택 회사 메뉴">
      <button
        className="index-side-rail-button index-side-rail-company is-active"
        type="button"
        title={`${company.companyName ?? company.symbol} (${company.symbol})`}
        aria-label={`${company.companyName ?? company.symbol} 선택됨`}
        aria-current="page"
        onClick={() => onSelectSymbol(company.symbol)}
      >
        <StockLogo
          symbol={company.symbol}
          companyName={company.companyName}
          size="md"
          className="index-side-rail-logo"
        />
      </button>
      <div className="index-side-rail-actions" aria-label="회사 메뉴">
        {sideRailMenuKeys.map((key) => {
          if (key === "III" && authEnabled && !authLoading && !authUser) {
            return (
              <button
                key="III-login"
                type="button"
                className="index-side-rail-button index-side-rail-action"
                aria-label="로그인"
                title="로그인"
                onClick={onLogin}
              >
                <LogIn size={17} aria-hidden="true" />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className={`index-side-rail-button index-side-rail-action ${activeMenu === key ? "is-active" : ""}`}
              aria-label={bottomMenuLabel(key)}
              title={bottomMenuLabel(key)}
              aria-controls="workspace-side-menu-panel"
              aria-expanded={activeMenu === key}
              onClick={() => onToggleMenu(key)}
            >
              {bottomMenuIcon(key)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function BottomMenuPanel({
  id,
  variant = "bottom",
  side,
  menuKeys,
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
  onClose,
  externallyReadNotification,
  marketOpenReminderEnabled,
  onMarketOpenReminderChange,
  onAlertUnreadCountChange
}: {
  id?: string;
  variant?: "bottom" | "side";
  side: BottomMenuSide;
  menuKeys?: BottomMenuKey[];
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
  onClose: () => void;
  externallyReadNotification: NotificationItem | null;
  marketOpenReminderEnabled: boolean;
  onMarketOpenReminderChange: (enabled: boolean) => void;
  onAlertUnreadCountChange: (count: number) => void;
}) {
  const sideKeys = menuKeys ?? (side === "left" ? leftMenuKeys : rightMenuKeys);
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
      onClose,
      externallyReadNotification,
      marketOpenReminderEnabled,
      onMarketOpenReminderChange,
      onAlertUnreadCountChange
    })
    : <p className="bottom-menu-empty">Menu</p>;

  return (
    <section
      id={id}
      className={`bottom-menu-panel surface-floating ${side} ${variant === "side" ? "side-overlay" : ""} ${activeKey ? `menu-${activeKey}` : ""} ${isOpen ? "is-open" : ""}`}
      aria-label={variant === "side" ? "Company side menu panel" : `${side === "left" ? "Left" : "Right"} menu panel`}
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

function topLoginLabel(authEnabled: boolean, authLoading: boolean, authUser: AuthUser | null): string {
  if (authLoading) {
    return "Checking";
  }
  if (authUser) {
    return authUser.name?.trim() || "Account";
  }
  return authEnabled ? "Login" : "Login";
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

function alertToastKey(notification: NotificationItem): string {
  return `${notification.id}:${notification.eventId}`;
}

function clampReminderDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return 60_000;
  }
  return Math.max(0, Math.min(delayMs, 60 * 60_000));
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
    II: <WalletCards size={size} aria-hidden="true" />,
    III: <Star size={size} aria-hidden="true" />,
    V: <UserCircle size={size} aria-hidden="true" />,
    VI: <Settings size={size} aria-hidden="true" />
  }[key];
}

function bottomMenuLabel(key: BottomMenuKey, alertUnreadCount = 0): string {
  const label = {
    II: "포트폴리오",
    III: "관심종목",
    IV: "알림설정",
    V: "로그인/프로필",
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
  onClose,
  externallyReadNotification,
  marketOpenReminderEnabled,
  onMarketOpenReminderChange,
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
  onClose: () => void;
  externallyReadNotification: NotificationItem | null;
  marketOpenReminderEnabled: boolean;
  onMarketOpenReminderChange: (enabled: boolean) => void;
  onAlertUnreadCountChange: (count: number) => void;
}) {
  switch (activeKey) {
    case "II":
      return (
        <div className="bottom-menu-section bottom-menu-scroll">
          <MenuTitle title="포트폴리오" detail="보유종목" />
          <div className="bottom-portfolio-split-grid">
            <PortfolioInvestmentStatusPanel />
            <PortfolioHoldingsOnlyPanel
              onSelectSymbol={(symbol) => {
                onSelectSymbol(symbol);
                onClose();
                return true;
              }}
            />
          </div>
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
          externallyReadNotification={externallyReadNotification}
          marketOpenReminderEnabled={marketOpenReminderEnabled}
          onMarketOpenReminderChange={onMarketOpenReminderChange}
          onLogin={onLogin}
          onOpenNotificationSymbol={(symbol) => {
            onSelectSymbol(symbol);
            onClose();
          }}
          onUnreadCountChange={onAlertUnreadCountChange}
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
          initialTab="recommendations"
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
          로그인/프로필
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
          <MenuTitle icon={<UserCircle size={15} />} title="로그인/프로필" detail={authEnabled ? "Google OAuth" : "Local dev"} />
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
