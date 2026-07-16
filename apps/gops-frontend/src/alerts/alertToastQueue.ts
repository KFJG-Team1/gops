import type { NotificationItem } from "./alertApi";
import {
  shouldShowNotificationToast,
  type NotificationPreferences
} from "./notificationPreferences";

export type AlertToastQueueItem = {
  notification: NotificationItem;
  autoDismissMs?: number;
};

export type AlertToastQueueState = {
  current: AlertToastQueueItem | null;
  queue: AlertToastQueueItem[];
};

export type AlertToastQueueOptions = {
  autoDismissMs?: number;
  priority?: "normal" | "immediate";
};

export function createAlertToastQueueState(): AlertToastQueueState {
  return { current: null, queue: [] };
}

export function enqueueAlertToastState(
  current: AlertToastQueueState,
  notification: NotificationItem,
  preferences: NotificationPreferences,
  seenKeys: Set<string>,
  options: AlertToastQueueOptions = {},
  nowMs = Date.now()
): AlertToastQueueState {
  if (notification.readAt || isNotificationToastExpired(notification, nowMs) || !shouldShowNotificationToast(notification, preferences)) {
    return current;
  }
  const key = alertToastKey(notification);
  if (seenKeys.has(key)) {
    return current;
  }
  seenKeys.add(key);
  const item = { notification, autoDismissMs: options.autoDismissMs };
  if (options.priority === "immediate" && current.current) {
    return { current: item, queue: [current.current, ...current.queue] };
  }
  return current.current
    ? { current: current.current, queue: [...current.queue, item] }
    : { current: item, queue: [] };
}

export function reconcileAlertToastState(
  current: AlertToastQueueState,
  preferences: NotificationPreferences,
  nowMs = Date.now()
): AlertToastQueueState {
  const visible = [current.current, ...current.queue]
    .filter((item): item is AlertToastQueueItem => Boolean(item))
    .filter((item) => !isNotificationToastExpired(item.notification, nowMs))
    .filter((item) => shouldShowNotificationToast(item.notification, preferences));
  return { current: visible[0] ?? null, queue: visible.slice(1) };
}

export function advanceAlertToastState(current: AlertToastQueueState, nowMs = Date.now()): AlertToastQueueState {
  const visibleQueue = current.queue.filter((item) => !isNotificationToastExpired(item.notification, nowMs));
  const [next, ...queue] = visibleQueue;
  return { current: next ?? null, queue };
}

export function removeNotificationAlertToastState(
  current: AlertToastQueueState,
  notificationId: number
): AlertToastQueueState {
  return filterAlertToastState(current, (item) => item.notification.id !== notificationId);
}

export function removePersistedAlertToastState(current: AlertToastQueueState): AlertToastQueueState {
  return filterAlertToastState(current, (item) => item.notification.id < 0);
}

export function alertToastKey(notification: NotificationItem): string {
  return `${notification.id}:${notification.eventId}`;
}

export function isNotificationToastExpired(notification: NotificationItem, nowMs = Date.now()): boolean {
  const explicit = asTimestamp(notification.payload.expiresAt);
  if (explicit !== undefined) {
    return explicit <= nowMs;
  }
  const isMarketSession = [
    "system.market_open",
    "system.market_close",
    "system.market_opened",
    "system.market_closed"
  ].includes(notification.type) || [
    "market_open",
    "market_close",
    "market_opened",
    "market_closed"
  ].includes(String(notification.payload.kind || ""));
  if (!isMarketSession) {
    return false;
  }
  const effectiveAt = asTimestamp(notification.payload.effectiveAt ?? notification.createdAt);
  return effectiveAt !== undefined && effectiveAt + 2 * 60 * 1000 <= nowMs;
}

function asTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function filterAlertToastState(
  current: AlertToastQueueState,
  keep: (item: AlertToastQueueItem) => boolean
): AlertToastQueueState {
  const visible = [current.current, ...current.queue]
    .filter((item): item is AlertToastQueueItem => Boolean(item))
    .filter(keep);
  return { current: visible[0] ?? null, queue: visible.slice(1) };
}
