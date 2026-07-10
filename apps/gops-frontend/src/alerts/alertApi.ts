export type AlertKind = "price_cross" | "spike";
export type AlertDirection = "above" | "below";
export type AlertStatus = "active" | "disabled" | "fired" | "expired";
export type AlertRepeatLimit = 1 | 3 | 5 | 10 | null;

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

export type AlertCreatePayload =
  | { symbol: string; type: "price_cross"; targetPrice: string; repeatLimit: AlertRepeatLimit }
  | { symbol: string; type: "spike"; direction: AlertDirection; changePct: string; windowMin: number; repeatLimit: AlertRepeatLimit };

export class AlertApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AlertApiError";
    this.status = status;
  }
}

export async function fetchAlerts(signal?: AbortSignal): Promise<PriceAlert[]> {
  const payload = await apiJson("/api/alerts", { signal });
  const source = asRecord(payload);
  return Array.isArray(source.alerts)
    ? source.alerts.map(normalizeAlert).filter((item): item is PriceAlert => Boolean(item))
    : [];
}

export async function createAlert(alert: AlertCreatePayload): Promise<PriceAlert> {
  const repeat = alert.repeatLimit === null ? true : alert.repeatLimit > 1;
  const payload = await apiJson("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...alert, repeat })
  });
  const normalized = normalizeAlert(asRecord(payload).alert);
  if (!normalized) {
    throw new AlertApiError(500, "알림 등록 응답을 읽지 못했습니다.");
  }
  return normalized;
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
  return normalized;
}

export async function deleteAlert(alertId: number): Promise<void> {
  await apiJson(`/api/alerts/${alertId}`, { method: "DELETE" });
}

export async function deleteAllAlerts(): Promise<number> {
  const payload = await apiJson("/api/alerts", { method: "DELETE" });
  return asNumber(asRecord(payload).deleted) ?? 0;
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

function normalizeAlert(value: unknown): PriceAlert | null {
  const source = asRecord(value);
  const id = asNumber(source.id);
  const symbol = asString(source.symbol)?.toUpperCase();
  const type = asString(source.type) as AlertKind | undefined;
  if (!id || !symbol || (type !== "price_cross" && type !== "spike")) {
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
    type,
    direction: normalizeDirection(source.direction),
    targetPrice: asNumber(source.target_price ?? source.targetPrice),
    changePct: asNumber(source.change_pct ?? source.changePct),
    windowMin: asNumber(source.window_min ?? source.windowMin),
    repeat: source.repeat === true,
    repeatLimit,
    triggeredCount: asNumber(source.triggered_count ?? source.triggeredCount) ?? 0,
    status: normalizeStatus(source.status),
    createdAt: asString(source.created_at ?? source.createdAt),
    expiresAt: asString(source.expires_at ?? source.expiresAt) ?? null
  };
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
