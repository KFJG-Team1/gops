import { Bell, CheckCheck, LoaderCircle, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "./alertApi";
import { formatNotificationToastMessage, notificationChartSymbol, notificationVisualTone } from "./alertPresentation";

type HeaderNotificationMenuProps = {
  canUseAlerts: boolean;
  authLoading: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onLogin: () => void;
  onOpenNotification: (notification: NotificationItem) => void | Promise<void>;
  onReadAll: () => void | Promise<void>;
};

export function HeaderNotificationMenu({
  canUseAlerts,
  authLoading,
  notifications,
  unreadCount,
  loading,
  saving,
  error,
  onLogin,
  onOpenNotification,
  onReadAll
}: HeaderNotificationMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openNotification = (notification: NotificationItem) => {
    setOpen(false);
    void onOpenNotification(notification);
  };

  return (
    <div ref={rootRef} className="workspace-top-notifications">
      <button
        type="button"
        className={`workspace-top-notification-button ${open ? "is-active" : ""}`}
        disabled={authLoading}
        aria-label={unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}개` : "알림"}
        aria-expanded={open}
        aria-controls="workspace-header-notification-popover"
        title="알림"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 && <span className="workspace-top-notification-badge" aria-hidden="true">{badgeLabel}</span>}
      </button>

      {open && (
        <aside
          id="workspace-header-notification-popover"
          className="workspace-top-notification-popover surface-floating"
          role="dialog"
          aria-label="알림함"
        >
          <header className="workspace-notification-heading">
            <div>
              <strong>알림</strong>
              <span>{unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}개` : "모두 확인했어요"}</span>
            </div>
            {canUseAlerts && (
              <button
                type="button"
                className="workspace-notification-read-all"
                disabled={saving || unreadCount === 0}
                onClick={() => void onReadAll()}
              >
                {saving ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <CheckCheck size={13} aria-hidden="true" />}
                <span>모두 읽기</span>
              </button>
            )}
          </header>

          {!canUseAlerts ? (
            <div className="workspace-notification-login">
              <p>로그인하면 내 알림을 실시간으로 확인할 수 있습니다.</p>
              <button type="button" disabled={authLoading} onClick={onLogin}>로그인</button>
            </div>
          ) : (
            <div className="workspace-notification-list">
              {notifications.map((notification) => {
                const presentation = formatNotificationToastMessage(notification);
                const chartSymbol = notificationChartSymbol(notification);
                const visualToneClass = notificationVisualTone(notification) === "geopolitical-risk" ? "is-geopolitical-risk" : "";
                const actionLabel = chartSymbol
                  ? `${presentation.title}, ${chartSymbol} 차트 열기`
                  : `${presentation.title}, 알림 읽기`;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    className={`workspace-notification-row ${visualToneClass} ${notification.readAt ? "is-read" : "is-unread"}`}
                    disabled={saving}
                    aria-label={actionLabel}
                    onClick={() => openNotification(notification)}
                  >
                    <span className="workspace-notification-dot" aria-hidden="true" />
                    <span className="workspace-notification-copy">
                      <strong>{presentation.title}</strong>
                      <span>{presentation.message}</span>
                    </span>
                    <time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>
                  </button>
                );
              })}
              {!loading && notifications.length === 0 && (
                <p className="workspace-notification-empty">도착한 알림이 없습니다.</p>
              )}
              {loading && notifications.length === 0 && (
                <p className="workspace-notification-empty is-loading">
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  <span>알림을 불러오는 중입니다.</span>
                </p>
              )}
            </div>
          )}

          {canUseAlerts && error ? (
            <footer className="workspace-notification-status is-error">
              <WifiOff size={13} aria-hidden="true" />
              <span>{error}</span>
            </footer>
          ) : null}
        </aside>
      )}
    </div>
  );
}

function formatNotificationTime(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  if (diffMs >= 0 && diffMs < 60_000) {
    return "방금 전";
  }
  if (diffMs >= 0 && diffMs < 60 * 60_000) {
    return `${Math.floor(diffMs / 60_000)}분 전`;
  }
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  }
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}
