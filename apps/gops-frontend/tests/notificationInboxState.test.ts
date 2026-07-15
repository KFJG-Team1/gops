import assert from "node:assert/strict";
import type { NotificationItem } from "../src/alerts/alertApi";
import {
  createAlertToastQueueState,
  enqueueAlertToastState,
  removeNotificationAlertToastState,
  removePersistedAlertToastState,
  type AlertToastQueueState
} from "../src/alerts/alertToastQueue";
import { normalizeNotificationPreferences } from "../src/alerts/notificationPreferences";
import {
  markNotificationInboxItemRead,
  markNotificationInboxReadAll,
  mergeNotificationInboxState,
  replaceNotificationInboxState
} from "../src/alerts/notificationInboxState";

const unread = notification(1, null);
const read = notification(2, "2026-07-14T00:00:00Z");
const initial = replaceNotificationInboxState([unread, read], 1);

assert.equal(mergeNotificationInboxState(initial, unread).unreadCount, 1);

const withNewNotification = mergeNotificationInboxState(initial, notification(3, null));
assert.equal(withNewNotification.unreadCount, 2);
assert.deepEqual(withNewNotification.notifications.map((item) => item.id), [3, 1, 2]);

const readFirst = markNotificationInboxItemRead(withNewNotification, {
  ...unread,
  readAt: "2026-07-14T01:00:00Z"
});
assert.equal(readFirst.unreadCount, 1);
assert.equal(readFirst.notifications.find((item) => item.id === 1)?.readAt, "2026-07-14T01:00:00Z");

const readAll = markNotificationInboxReadAll(readFirst, "2026-07-14T02:00:00Z");
assert.equal(readAll.unreadCount, 0);
assert.ok(readAll.notifications.every((item) => Boolean(item.readAt)));

assert.deepEqual(createAlertToastQueueState(), { current: null, queue: [] });
const toastState: AlertToastQueueState = {
  current: { notification: unread },
  queue: [
    { notification: notification(3, null) },
    { notification: notification(-1, null) }
  ]
};
const withoutOne = removeNotificationAlertToastState(toastState, 1);
assert.equal(withoutOne.current?.notification.id, 3);
assert.deepEqual(withoutOne.queue.map((item) => item.notification.id), [-1]);

const syntheticOnly = removePersistedAlertToastState(toastState);
assert.equal(syntheticOnly.current?.notification.id, -1);
assert.deepEqual(syntheticOnly.queue, []);

const geopoliticalRisk: NotificationItem = {
  id: -10_001,
  eventId: "simulator:run-1:breaking-event",
  type: "system.simulator_breaking_event",
  payload: { symbol: "AMD", title: "지정학 리스크 경보" },
  readAt: null
};
const prioritized = enqueueAlertToastState(
  toastState,
  geopoliticalRisk,
  normalizeNotificationPreferences({ persisted: true }),
  new Set(),
  { priority: "immediate" }
);
assert.equal(prioritized.current?.notification.eventId, geopoliticalRisk.eventId);
assert.deepEqual(prioritized.queue.map((item) => item.notification.id), [1, 3, -1]);

function notification(id: number, readAt: string | null): NotificationItem {
  return {
    id,
    alertId: null,
    eventId: `event-${id}`,
    type: "alert.price_cross",
    payload: { symbol: "NVDA", targetPrice: 100 },
    createdAt: "2026-07-14T00:00:00Z",
    readAt
  };
}
