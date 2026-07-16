import type { NotificationItem } from "./alertApi";

export type NotificationInboxState = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export function createNotificationInboxState(): NotificationInboxState {
  return { notifications: [], unreadCount: 0 };
}

export function replaceNotificationInboxState(
  notifications: NotificationItem[],
  unreadCount: number
): NotificationInboxState {
  return {
    notifications: notifications.slice(0, 50),
    unreadCount: Math.max(0, unreadCount)
  };
}

export function mergeNotificationInboxState(
  current: NotificationInboxState,
  notification: NotificationItem
): NotificationInboxState {
  const existing = current.notifications.find((item) => item.id === notification.id);
  const previousUnread = Boolean(existing && !existing.readAt);
  const nextUnread = !notification.readAt;
  const unreadDelta = Number(nextUnread) - Number(previousUnread);
  return {
    notifications: [
      notification,
      ...current.notifications.filter((item) => item.id !== notification.id)
    ].slice(0, 50),
    unreadCount: Math.max(0, current.unreadCount + unreadDelta)
  };
}

export function markNotificationInboxItemRead(
  current: NotificationInboxState,
  notification: NotificationItem
): NotificationInboxState {
  const existing = current.notifications.find((item) => item.id === notification.id);
  if (!existing) {
    return current;
  }
  return {
    notifications: current.notifications.map((item) => item.id === notification.id ? notification : item),
    unreadCount: existing.readAt ? current.unreadCount : Math.max(0, current.unreadCount - 1)
  };
}

export function markNotificationInboxReadAll(
  current: NotificationInboxState,
  readAt = new Date().toISOString()
): NotificationInboxState {
  return {
    notifications: current.notifications.map((item) => item.readAt ? item : { ...item, readAt }),
    unreadCount: 0
  };
}
