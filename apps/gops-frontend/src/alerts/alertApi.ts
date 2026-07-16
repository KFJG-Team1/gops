export type AlertKind = "price_cross" | "spike" | "volume_absolute" | "volume_relative" | "rsi_threshold";
export type AlertConditionKind = "price_cross" | "price_change" | "volume_absolute" | "volume_relative" | "rsi_threshold";
export type AlertDirection = "above" | "below";
export type AlertCondition = {
  kind: AlertConditionKind;
  operator: AlertDirection | "either";
  threshold: number;
  interval?: string | null;
  windowMin?: number | null;
  lookback?: number | null;
  period?: number | null;
};
export type AlertStatus = "active" | "disabled" | "fired" | "expired";
export type AlertRepeatLimit = 1 | 3 | 5 | 10 | null;
export type AlertProposalSource = "daily_trade" | "entry_habit" | "exit_habit" | "portfolio_risk";
export type AlertCreatedVia = "manual" | "chart" | "ai_coach" | "agent_chat" | "trade_condition";

export type PriceAlert = {
  id: number;
  symbol: string;
  type: AlertKind;
  direction?: AlertDirection | null;
  targetPrice?: number | null;
  changePct?: number | null;
  windowMin?: number | null;
  repeat: boolean;
  repeatLimit: number | null;
  triggeredCount: number;
  status: AlertStatus;
  proposalSource?: AlertProposalSource | null;
  condition?: AlertCondition | null;
  createdVia?: AlertCreatedVia;
  requestId?: string | null;
  lastTriggeredAt?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
};

export type NotificationItem = {
  id: number;
  alertId?: number | null;
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  readAt?: string | null;
};

export type AlertCreatePayload = (
  | { symbol: string; type: "price_cross"; targetPrice: string; repeatLimit: AlertRepeatLimit }
  | { symbol: string; type: "spike"; direction: AlertDirection; changePct: string; windowMin: number; repeatLimit: AlertRepeatLimit }
  | { symbol: string; condition: Omit<AlertCondition, "threshold"> & { threshold: number | string }; repeatLimit: AlertRepeatLimit }
) & { proposalSource?: AlertProposalSource; createdVia?: AlertCreatedVia; requestId?: string };

export type AlertCommandResponse =
  | { status: "created"; alert: PriceAlert; idempotentReplay: boolean }
  | { status: "clarify"; clarification: string; clarificationId: string }
  | { status: "rejected"; clarification: string }
  | { status: "not_matched" };

export const alertRulesChangedEvent = "gops:alert-rules-changed";

export class AlertApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AlertApiError";
    this.status = status;
  }
}

export async function fetchAlerts(signal?: AbortSignal): Promise<PriceAlert[]> {
  const payload = await apiJson("/api/alerts?includeTerminal=false", { signal });
  const source = asRecord(payload);
  return Array.isArray(source.alerts)
    ? source.alerts.map(normalizeAlert).filter((item): item is PriceAlert => Boolean(item))
    : [];
}

export async function createAlert(alert: AlertCreatePayload): Promise<PriceAlert> {
  const repeat = alert.repeatLimit === null ? true : alert.repeatLimit > 1;
  const payload = await apiJson("/api/alerts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(alert.requestId ? { "Idempotency-Key": alert.requestId } : {})
    },
    body: JSON.stringify({ ...alert, repeat })
  });
  const normalized = normalizeAlert(asRecord(payload).alert);
  if (!normalized) {
    throw new AlertApiError(500, "알림 등록 응답을 읽지 못했습니다.");
  }
  publishAlertRulesChanged();
  return normalized;
}

export async function submitAlertCommand(input: {
  text: string;
  contextSymbol?: string;
  contextInterval?: string;
  clarificationId?: string;
  requestId: string;
}): Promise<AlertCommandResponse> {
  const payload = asRecord(await apiJson("/api/alerts/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.requestId },
    body: JSON.stringify({
      text: input.text,
      contextSymbol: input.contextSymbol,
      contextInterval: input.contextInterval,
      clarificationId: input.clarificationId
    })
  }));
  const status = asString(payload.status);
  if (status === "created") {
    const alert = normalizeAlert(payload.alert);
    if (!alert) throw new AlertApiError(500, "생성된 알림을 읽지 못했습니다.");
    publishAlertRulesChanged();
    return { status, alert, idempotentReplay: payload.idempotentReplay === true };
  }
  if (status === "clarify") {
    return {
      status,
      clarification: asString(payload.clarification) || "알림 조건을 조금 더 알려주세요.",
      clarificationId: asString(payload.clarificationId) || ""
    };
  }
  if (status === "rejected") {
    return { status, clarification: asString(payload.clarification) || "이 알림 조건은 지원하지 않습니다." };
  }
  return { status: "not_matched" };
}

export async function setAlertStatus(alertId: number, status: "active" | "disabled"): Promise<PriceAlert> {
  const payload = await apiJson(`/api/alerts/${alertId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const normalized = normalizeAlert(asRecord(payload).alert);
  if (!normalized) {
    throw new AlertApiError(500, "알림 상태 응답을 읽지 못했습니다.");
  }
  publishAlertRulesChanged();
  return normalized;
}

export async function deleteAlert(alertId: number): Promise<void> {
  await apiJson(`/api/alerts/${alertId}`, { method: "DELETE" });
  publishAlertRulesChanged();
}

export async function deleteAllAlerts(): Promise<number> {
  const payload = await apiJson("/api/alerts", { method: "DELETE" });
  publishAlertRulesChanged();
  return asNumber(asRecord(payload).deleted) ?? 0;
}

export function publishAlertRulesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(alertRulesChangedEvent));
}

export async function fetchNotifications(signal?: AbortSignal): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const payload = await apiJson("/api/notifications", { signal });
  const source = asRecord(payload);
  return {
    notifications: Array.isArray(source.notifications)
      ? source.notifications.map(normalizeNotificationPayload).filter((item): item is NotificationItem => Boolean(item))
      : [],
    unreadCount: asNumber(source.unreadCount) ?? 0
  };
}

export async function markNotificationRead(notificationId: number): Promise<NotificationItem | null> {
  const payload = await apiJson(`/api/notifications/${notificationId}/read`, { method: "PATCH" });
  return normalizeNotificationPayload(asRecord(payload).notification);
}

export async function markAllNotificationsRead(): Promise<number> {
  const payload = await apiJson("/api/notifications/read-all", { method: "PATCH" });
  return asNumber(asRecord(payload).updated) ?? 0;
}

export async function deleteNotification(notificationId: number): Promise<void> {
  await apiJson(`/api/notifications/${notificationId}`, { method: "DELETE" });
}

export function notificationSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/notifications`;
}

export function agentAlertsSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/agent-alerts`;
}

function normalizeAlert(value: unknown): PriceAlert | null {
  const source = asRecord(value);
  const id = asNumber(source.id);
  const symbol = asString(source.symbol)?.toUpperCase();
  const type = asString(source.type) as AlertKind | undefined;
  if (!id || !symbol || !["price_cross", "spike", "volume_absolute", "volume_relative", "rsi_threshold"].includes(type || "")) {
    return null;
  }
  const rawRepeatLimit = Object.prototype.hasOwnProperty.call(source, "repeat_limit")
    ? source.repeat_limit
    : source.repeatLimit;
  const repeatLimit = rawRepeatLimit === null
    ? null
    : asNumber(rawRepeatLimit) ?? (source.repeat === true ? null : 1);
  return {
    id,
    symbol,
    type: type as AlertKind,
    direction: normalizeDirection(source.direction),
    targetPrice: asNumber(source.target_price ?? source.targetPrice),
    changePct: asNumber(source.change_pct ?? source.changePct),
    windowMin: asNumber(source.window_min ?? source.windowMin),
    repeat: source.repeat === true,
    repeatLimit,
    triggeredCount: asNumber(source.triggered_count ?? source.triggeredCount) ?? 0,
    status: normalizeStatus(source.status),
    proposalSource: normalizeProposalSource(source.proposal_source ?? source.proposalSource),
    condition: normalizeCondition(source.condition),
    createdVia: normalizeCreatedVia(source.created_via ?? source.createdVia),
    requestId: asString(source.request_id ?? source.requestId) ?? null,
    lastTriggeredAt: asString(source.last_triggered_at ?? source.lastTriggeredAt) ?? null,
    createdAt: asString(source.created_at ?? source.createdAt),
    expiresAt: asString(source.expires_at ?? source.expiresAt) ?? null
  };
}

function normalizeCondition(value: unknown): AlertCondition | null {
  const source = asRecord(value);
  const kind = asString(source.kind) as AlertConditionKind | undefined;
  const operator = asString(source.operator) as AlertCondition["operator"] | undefined;
  const threshold = asNumber(source.threshold);
  if (!kind || !["price_cross", "price_change", "volume_absolute", "volume_relative", "rsi_threshold"].includes(kind) || !operator || threshold === undefined) {
    return null;
  }
  return {
    kind,
    operator,
    threshold,
    interval: asString(source.interval) ?? null,
    windowMin: asNumber(source.windowMin) ?? null,
    lookback: asNumber(source.lookback) ?? null,
    period: asNumber(source.period) ?? null
  };
}

function normalizeCreatedVia(value: unknown): AlertCreatedVia {
  const source = asString(value);
  return source === "chart" || source === "ai_coach" || source === "agent_chat" || source === "trade_condition" ? source : "manual";
}

function normalizeProposalSource(value: unknown): AlertProposalSource | null {
  const source = asString(value);
  return source === "daily_trade" || source === "entry_habit" || source === "exit_habit" || source === "portfolio_risk"
    ? source
    : null;
}

export function normalizeNotificationPayload(value: unknown): NotificationItem | null {
  const source = asRecord(value);
  const id = asNumber(source.id);
  const eventId = asString(source.event_id ?? source.eventId);
  if (!id || !eventId) {
    return null;
  }
  return {
    id,
    alertId: asNumber(source.alert_id ?? source.alertId),
    eventId,
    type: asString(source.type) || "notification",
    payload: asRecord(source.payload),
    createdAt: asString(source.created_at ?? source.createdAt),
    readAt: asString(source.read_at ?? source.readAt) ?? null
  };
}

async function apiJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AlertApiError(response.status, readApiErrorMessage(response, payload));
  }
  return payload;
}

function readApiErrorMessage(response: Response, payload: unknown): string {
  const detail = asRecord(payload).detail;
  if (typeof detail === "string" && detail.trim()) {
    return localizeAlertApiDetail(detail.trim());
  }
  return `알림 API 오류: ${response.status}`;
}

function localizeAlertApiDetail(detail: string): string {
  const currentPriceMatch = detail.match(/^current price is unavailable for\s+(.+)$/i);
  if (currentPriceMatch?.[1]) {
    return `${currentPriceMatch[1].trim().toUpperCase()} 현재가를 확인할 수 없어 목표가 알림을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.`;
  }
  if (detail === "targetPrice must be different from the current price") {
    return "목표가가 현재가와 같으면 알림 조건을 만들 수 없습니다.";
  }
  return detail;
}

function normalizeDirection(value: unknown): AlertDirection | null {
  return value === "above" || value === "below" ? value : null;
}

function normalizeStatus(value: unknown): AlertStatus {
  return value === "disabled" || value === "fired" || value === "expired" ? value : "active";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
