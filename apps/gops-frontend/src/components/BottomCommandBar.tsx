import { CandlestickChart, LogIn, Newspaper, SendHorizontal, Square, UserCircle, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { AgentReferenceChip } from "../agent/agentReferences";
import { AlertToast } from "../alerts/AlertToast";
import {
  agentAlertsSocketUrl,
  markNotificationRead,
  normalizeNotificationPayload,
  notificationSocketUrl,
  type NotificationItem
} from "../alerts/alertApi";
import {
  createMarketOpenNotification,
  isMarketOpenNotification,
  shouldShowMarketOpenReminder
} from "../alerts/marketOpenReminder";
import {
  shouldShowNotificationToast,
  useNotificationPreferences
} from "../alerts/notificationPreferences";
import { notificationChartSymbol, notificationUiProposals } from "../alerts/alertPresentation";
import type { AgentHeaderNotice } from "../agent/agentHeaderNotice";
import type { AgentLayoutProposal } from "../layout/agentLayoutTypes";
import { buildUiProposalLayoutProposal } from "../layout/uiProposalLayout";
import type { AuthUser } from "../auth/AuthProvider";
import { fetchNextMarketOpen } from "../market/marketOpenApi";
import { SimulatorControl } from "../simulator/SimulatorControl";

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
  agentNotice: AgentHeaderNotice | null;
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
  onAgentSubmit: (event: FormEvent<HTMLFormElement>) => unknown | Promise<unknown>;
  onAgentNoticeDismiss: (noticeId: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onSelectSymbol: (symbol: string) => void;
  onApplyLayoutProposal?: (proposal: AgentLayoutProposal) => void;
};

const alertToastAdvanceMs = 6000;
const marketOpenRetryMs = 60_000;
const marketOpenScheduleRefreshMs = 60 * 60_000;

export function BottomCommandBar({
  agentBusy,
  agentInput,
  agentComposerRequest,
  agentNotice,
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
  onAgentNoticeDismiss,
  onLogin,
  onLogout,
  onSelectSymbol,
  onApplyLayoutProposal
}: BottomCommandBarProps) {
  const { preferences: notificationPreferences, ready: notificationPreferencesReady } = useNotificationPreferences();
  const [alertToastState, setAlertToastState] = useState<AlertToastQueueState>({ current: null, queue: [] });
  const notificationPreferencesRef = useRef(notificationPreferences);
  const seenAlertToastKeysRef = useRef<Set<string>>(new Set());
  const agentInputRef = useRef<HTMLInputElement>(null);
  const canUseAlerts = !authLoading && (!authEnabled || Boolean(authUser));
  const canReceiveAlerts = canUseAlerts && notificationPreferencesReady;
  const marketOpenReminderEnabled = canReceiveAlerts
    && notificationPreferences.settings.master
    && notificationPreferences.settings.marketOpen;

  const enqueueAlertToast = (notification: NotificationItem, options: { autoDismissMs?: number } = {}) => {
    if (!shouldShowNotificationToast(notification, notificationPreferencesRef.current)) {
      return;
    }
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

  useEffect(() => {
    notificationPreferencesRef.current = notificationPreferences;
    setAlertToastState((current) => {
      const visible = [current.current, ...current.queue]
        .filter((item): item is AlertToastQueueItem => Boolean(item))
        .filter((item) => shouldShowNotificationToast(item.notification, notificationPreferences));
      return { current: visible[0] ?? null, queue: visible.slice(1) };
    });
  }, [notificationPreferences]);

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

  const openAlertToastEvidence = (notification: NotificationItem) => {
    const proposal = buildUiProposalLayoutProposal(notificationUiProposals(notification), {
      title: "리스크 알림 근거 패널",
      rationale: "리스크 알림이 참조한 패널을 엽니다."
    });
    if (proposal && onApplyLayoutProposal) {
      onApplyLayoutProposal(proposal);
    }
    void markAlertToastRead(notification);
    advanceAlertToast();
  };

  const markAlertToastRead = async (notification: NotificationItem) => {
    if (notification.readAt) {
      return;
    }
    if (notification.id < 0) {
      // Synthetic toast (agent-alerts stream) — not persisted, nothing to mark.
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
    if (!canReceiveAlerts) {
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
  }, [canReceiveAlerts]);

  useEffect(() => {
    if (!canReceiveAlerts) {
      return undefined;
    }
    // Risk monitor / agent alerts arrive on a separate broadcast socket and are
    // not persisted as notifications; surface toast-worthy ones with a
    // synthetic (negative-id) NotificationItem so the same queue renders them.
    const socket = new WebSocket(agentAlertsSocketUrl());
    socket.onmessage = (event) => {
      const payload = readSocketPayload(event.data);
      if (payload.type !== "AGENT_ALERT" || payload.showToast !== true) {
        return;
      }
      const notification = agentAlertNotification(payload);
      if (notification) {
        enqueueAlertToast(notification);
      }
    };
    return () => socket.close();
  }, [canReceiveAlerts]);

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

  useEffect(() => {
    if (agentComposerRequest > 0 && !agentBusy) {
      agentInputRef.current?.focus();
    }
  }, [agentBusy, agentComposerRequest]);

  useEffect(() => {
    if (!agentNotice) {
      return undefined;
    }
    const timer = window.setTimeout(() => onAgentNoticeDismiss(agentNotice.id), 3000);
    return () => window.clearTimeout(timer);
  }, [agentNotice, onAgentNoticeDismiss]);

  const submitAgentPrompt = async (event: FormEvent<HTMLFormElement>) => {
    await onAgentSubmit(event);
  };

  return (
    <>
      {alertToastState.current && (
        <AlertToast
          notification={alertToastState.current.notification}
          queuedCount={alertToastState.queue.length}
          onClose={advanceAlertToast}
          onOpenChart={openAlertToastChart}
          onOpenEvidence={onApplyLayoutProposal ? openAlertToastEvidence : undefined}
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
          <div className={`workspace-top-center-flip ${agentNotice ? "is-notice" : ""}`}>
            <div
              className="workspace-top-center-face workspace-top-center-default"
              aria-hidden={Boolean(agentNotice)}
              inert={agentNotice ? true : undefined}
            >
              {topDock}
            </div>
            {agentNotice && (
              <div
                className={`workspace-top-center-face workspace-agent-notice is-${agentNotice.tone}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {agentNotice.message}
              </div>
            )}
          </div>
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
      {/* The command bar is hidden while editing the layout; the palette dock owns
          the bottom band and provides its own 완료 (exit) button. */}
      {!layoutEditMode && <nav className="workspace-bottom-nav" aria-label="Workspace command bar">
        <div className="bottom-command-slot is-agent">
          <div className="agent-dock">
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
            </form>
          </div>
        </div>
      </nav>}
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

function agentAlertNotification(payload: Record<string, unknown>): NotificationItem | null {
  const decision = payload.decision && typeof payload.decision === "object"
    ? payload.decision as Record<string, unknown>
    : {};
  const eventId = typeof decision.eventId === "string" && decision.eventId
    ? decision.eventId
    : `agent-alert-${Date.now()}`;
  return {
    // Synthetic id: agent alerts are broadcast-only (not persisted), so the
    // toast key dedupes on the stable eventId instead.
    id: -1,
    alertId: null,
    eventId,
    type: "AGENT_ALERT",
    payload,
    createdAt: new Date().toISOString(),
    readAt: null
  };
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
