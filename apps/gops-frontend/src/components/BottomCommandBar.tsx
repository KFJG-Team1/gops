import { CandlestickChart, LogIn, MessagesSquare, Newspaper, SendHorizontal, Square, UserCircle, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { AgentReferenceChip } from "../agent/agentReferences";
import { AlertToast } from "../alerts/AlertToast";
import { markNotificationRead, normalizeNotificationPayload, notificationSocketUrl, type NotificationItem } from "../alerts/alertApi";
import {
  createMarketOpenNotification,
  isMarketOpenNotification,
  readMarketOpenReminderEnabled,
  shouldShowMarketOpenReminder
} from "../alerts/marketOpenReminder";
import { notificationChartSymbol } from "../alerts/alertPresentation";
import { formatAgentTimingSummary, type AgentAnalysisReport, type FinalAnswerSection } from "../agents/agentAnalysis";
import type { AuthUser } from "../auth/AuthProvider";
import { fetchNextMarketOpen } from "../market/marketOpenApi";
import { SimulatorControl } from "../simulator/SimulatorControl";

export type ChatLogEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
  confidence?: number;
  analysisReport?: AgentAnalysisReport | null;
};
export type AgentSubmitResult = "chat-log" | "chart-shortcut" | "ui-action" | "ignored";

type AlertToastQueueState = {
  current: AlertToastQueueItem | null;
  queue: AlertToastQueueItem[];
};
type AlertToastQueueItem = {
  notification: NotificationItem;
  autoDismissMs?: number;
};

type BottomCommandBarProps = {
  agentBusy: boolean;
  agentInput: string;
  agentComposerRequest: number;
  chatLog: ChatLogEntry[];
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  canUseAgent: boolean;
  agentReferenceChips: AgentReferenceChip[];
  isChartMode: boolean;
  layoutEditMode: boolean;
  topDock?: ReactNode;
  onAgentCancel: () => void;
  onAgentReferenceRemove: (key: string) => void;
  onAgentReferenceEmphasize: (keys: string[]) => void;
  onAgentInputChange: (value: string) => void;
  onAgentSubmit: (event: FormEvent<HTMLFormElement>) => AgentSubmitResult | Promise<AgentSubmitResult>;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onToggleLayoutEditMode: () => void;
};

const alertToastAdvanceMs = 6000;
const marketOpenRetryMs = 60_000;
const marketOpenScheduleRefreshMs = 60 * 60_000;

export function BottomCommandBar({
  agentBusy,
  agentInput,
  agentComposerRequest,
  chatLog,
  authEnabled,
  authLoading,
  authUser,
  canUseAgent,
  agentReferenceChips,
  isChartMode,
  layoutEditMode,
  topDock,
  onAgentCancel,
  onAgentReferenceRemove,
  onAgentReferenceEmphasize,
  onAgentInputChange,
  onAgentSubmit,
  onLogin,
  onLogout,
  onSelectSymbol,
  onToggleLayoutEditMode
}: BottomCommandBarProps) {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [alertToastState, setAlertToastState] = useState<AlertToastQueueState>({ current: null, queue: [] });
  const [marketOpenReminderEnabled] = useState(() => readMarketOpenReminderEnabled());
  const seenAlertToastKeysRef = useRef<Set<string>>(new Set());
  const agentInputRef = useRef<HTMLInputElement>(null);
  const hasFloatingPanel = chatPanelOpen;
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

  const openAlertToastChart = (notification: NotificationItem) => {
    const symbol = notificationChartSymbol(notification);
    if (symbol) {
      onSelectSymbol(symbol);
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
      if (event.target.closest(".bottom-chat-panel, .agent-dock, .symbol-search-menu, .workspace-top-nav")) {
        return;
      }
      if (chatPanelOpen) {
        setChatPanelOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [chatPanelOpen, hasFloatingPanel]);

  useEffect(() => {
    if (!canUseAlerts) {
      return undefined;
    }
    const socket = new WebSocket(notificationSocketUrl());
    socket.onmessage = (event) => {
      const payload = readSocketPayload(event.data);
      if (payload.type === "snapshot") {
        return;
      }
      if (payload.type === "notification") {
        const notification = normalizeNotificationPayload(payload.notification);
        if (notification && !notification.readAt) {
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
    setChatPanelOpen(false);
  };

  const toggleChatPanel = () => {
    setChatPanelOpen((current) => !current);
  };

  useEffect(() => {
    if (agentComposerRequest > 0 && !agentBusy) {
      agentInputRef.current?.focus();
    }
  }, [agentBusy, agentComposerRequest]);

  const submitAgentPrompt = async (event: FormEvent<HTMLFormElement>) => {
    const hasPrompt = Boolean(agentInput.trim());
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
        <div className="workspace-top-brand" aria-label="GOPS">
          <span className="workspace-top-brand-mark" aria-hidden="true">
            <CandlestickChart size={16} />
          </span>
          <span>GOPS</span>
        </div>
        <div className="workspace-top-center">
          {topDock}
        </div>
        <div className="workspace-top-actions">
          <SimulatorControl />
          <button
            type="button"
            className="workspace-top-login"
            disabled={authLoading}
            aria-label={topLoginLabel(authEnabled, authLoading, authUser)}
            title={topLoginLabel(authEnabled, authLoading, authUser)}
            onClick={authUser ? onLogout : onLogin}
          >
            {authUser ? <UserCircle size={15} aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
            <span>{topLoginLabel(authEnabled, authLoading, authUser)}</span>
          </button>
        </div>
      </nav>
      <nav className="workspace-bottom-nav" aria-label="Workspace command bar">
        <div className="bottom-command-slot is-agent">
          <div className={`agent-dock ${chatPanelOpen ? "is-chat-open" : ""}`}>
            <section className={`bottom-chat-panel surface-floating ${chatPanelOpen ? "is-open" : ""}`} aria-label="Agent log" aria-hidden={!chatPanelOpen}>
              <header className="bottom-chat-header">
                <div>
                  <MessagesSquare size={15} aria-hidden="true" />
                  <strong>AGENT LOG</strong>
                  <span>{chatLog.length}</span>
                </div>
                <button type="button" aria-label="Agent log 닫기" title="Agent log 닫기" onClick={() => setChatPanelOpen(false)}>
                  <X size={15} aria-hidden="true" />
                </button>
              </header>
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
                  <p className="bottom-chat-empty">선택한 뉴스나 캔들에 질문하면 이곳에 기록됩니다.</p>
                )}
              </div>
            </section>
            <form className="agent-box surface-raised" onSubmit={submitAgentPrompt}>
              <AgentReferenceStrip
                chips={agentReferenceChips}
                onRemove={onAgentReferenceRemove}
                onEmphasize={onAgentReferenceEmphasize}
              />
              <input
                ref={agentInputRef}
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
            <button
              type="button"
              className={`agent-log-button ${chatPanelOpen ? "is-active" : ""}`}
              aria-label={chatPanelOpen ? "Agent log 닫기" : "Agent log 열기"}
              title={chatPanelOpen ? "Agent log 닫기" : "Agent log 열기"}
              aria-expanded={chatPanelOpen}
              onClick={toggleChatPanel}
            >
              <MessagesSquare size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}

function AgentReferenceStrip({
  chips,
  onRemove,
  onEmphasize
}: {
  chips: AgentReferenceChip[];
  onRemove: (key: string) => void;
  onEmphasize: (keys: string[]) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (chips.length === 0) {
    return null;
  }

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
