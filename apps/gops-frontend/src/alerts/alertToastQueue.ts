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
  options: AlertToastQueueOptions = {}
): AlertToastQueueState {
  if (notification.readAt || !shouldShowNotificationToast(notification, preferences)) {
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
  preferences: NotificationPreferences
): AlertToastQueueState {
  const visible = [current.current, ...current.queue]
    .filter((item): item is AlertToastQueueItem => Boolean(item))
    .filter((item) => shouldShowNotificationToast(item.notification, preferences));
  return { current: visible[0] ?? null, queue: visible.slice(1) };
}

export function advanceAlertToastState(current: AlertToastQueueState): AlertToastQueueState {
  const [next, ...queue] = current.queue;
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

function filterAlertToastState(
  current: AlertToastQueueState,
  keep: (item: AlertToastQueueItem) => boolean
): AlertToastQueueState {
  const visible = [current.current, ...current.queue]
    .filter((item): item is AlertToastQueueItem => Boolean(item))
    .filter(keep);
  return { current: visible[0] ?? null, queue: visible.slice(1) };
}
