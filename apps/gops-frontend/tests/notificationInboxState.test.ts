import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NotificationItem } from "../src/alerts/alertApi";
import { formatNotificationToastMessage } from "../src/alerts/alertPresentation";
import {
  advanceAlertToastState,
  createAlertToastQueueState,
  enqueueAlertToastState,
  isNotificationToastExpired,
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

const expiredMarketOpen: NotificationItem = {
  id: 20,
  eventId: "system.market_opened:2026-07-14:user-a",
  type: "system.market_opened",
  payload: {
    kind: "market_opened",
    effectiveAt: "2026-07-14T13:30:00Z",
    expiresAt: "2026-07-14T13:32:00Z"
  },
  createdAt: "2026-07-14T13:30:00Z",
  readAt: null
};
const afterExpiry = Date.parse("2026-07-14T13:33:00Z");
assert.equal(isNotificationToastExpired(expiredMarketOpen, afterExpiry), true);
assert.deepEqual(
  enqueueAlertToastState(
    createAlertToastQueueState(),
    expiredMarketOpen,
    normalizeNotificationPreferences({ persisted: true }),
    new Set(),
    {},
    afterExpiry
  ),
  createAlertToastQueueState()
);
const promoted = advanceAlertToastState({
  current: { notification: unread },
  queue: [
    { notification: expiredMarketOpen },
    { notification: notification(30, null) }
  ]
}, afterExpiry);
assert.equal(promoted.current?.notification.id, 30);

const marketMove: NotificationItem = {
  id: 40,
  eventId: "market-move:2026-07-14:user-a:NVDA:down:5",
  type: "system.market_move",
  payload: {
    kind: "market_move",
    symbol: "NVDA",
    title: "NVDA 정규장 급락",
    summary: "전일 정규장 종가 대비 -5.75% 하락했습니다.",
    previousClose: 100,
    lastPrice: 94.25,
    changePercent: -5.75
  },
  readAt: null
};
const marketMoveToast = formatNotificationToastMessage(marketMove);
assert.equal(marketMoveToast.message, "전일 정규장 종가 대비 -5.75% 하락했습니다.");
assert.equal(marketMoveToast.detail, "현재가 94.25 · 전일 정규장 종가 100");

const bottomCommandBarSource = readFileSync(
  fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)),
  "utf-8"
);
const snapshotStart = bottomCommandBarSource.indexOf('if (payload.type === "snapshot")');
const realtimeStart = bottomCommandBarSource.indexOf('if (payload.type === "notification")', snapshotStart);
assert.ok(snapshotStart >= 0 && realtimeStart > snapshotStart);
assert.doesNotMatch(bottomCommandBarSource.slice(snapshotStart, realtimeStart), /enqueueAlertToast/);
assert.match(bottomCommandBarSource, /setTimeout\(\(\) => \{[\s\S]*advanceAlertToast\(\);[\s\S]*alertToastAdvanceMs/);

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
