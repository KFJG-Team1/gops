import type { NotificationItem } from "./alertApi";

export const marketOpenReminderStorageKey = "gops.marketOpenReminder.enabled";
export const marketOpenReminderStaleMs = 10 * 60 * 1000;

export function readMarketOpenReminderEnabled(storage: Storage | undefined = safeLocalStorage()): boolean {
  try {
    const stored = storage?.getItem(marketOpenReminderStorageKey);
    return stored === null || stored === undefined ? true : stored !== "false";
  } catch {
    return true;
  }
}

export function writeMarketOpenReminderEnabled(enabled: boolean, storage: Storage | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(marketOpenReminderStorageKey, enabled ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or embedded browser contexts.
  }
}

export function createMarketOpenNotification(nextOpenAt: string): NotificationItem {
  const openMs = new Date(nextOpenAt).getTime();
  return {
    id: -(Number.isFinite(openMs) ? Math.max(1, Math.trunc(openMs)) : Date.now()),
    eventId: `market-open:${nextOpenAt}`,
    type: "system.market_open",
    payload: {
      kind: "market_open",
      nextOpenAt
    },
    createdAt: new Date().toISOString(),
    readAt: null
  };
}

export function isMarketOpenNotification(notification: NotificationItem): boolean {
  return ["system.market_open", "system.market_opened"].includes(notification.type)
    || ["market_open", "market_opened"].includes(String(notification.payload.kind || ""));
}

export function isMarketSessionNotification(notification: NotificationItem): boolean {
  return isMarketOpenNotification(notification)
    || ["system.market_close", "system.market_closed"].includes(notification.type)
    || ["market_close", "market_closed"].includes(String(notification.payload.kind || ""));
}

export function shouldShowMarketOpenReminder(nextOpenAt: string, nowMs = Date.now()): boolean {
  const openMs = new Date(nextOpenAt).getTime();
  return Number.isFinite(openMs) && nowMs >= openMs && nowMs - openMs <= marketOpenReminderStaleMs;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
