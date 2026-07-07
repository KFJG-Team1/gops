import { Bell, ExternalLink, X } from "lucide-react";
import type { NotificationItem } from "./alertApi";
import { formatNotificationToastMessage } from "./alertPresentation";

type AlertToastProps = {
  notification: NotificationItem;
  queuedCount: number;
  onClose: () => void;
  onOpenChart: (notification: NotificationItem) => void;
};

export function AlertToast({ notification, queuedCount, onClose, onOpenChart }: AlertToastProps) {
  const presentation = formatNotificationToastMessage(notification);
  const canOpenChart = Boolean(presentation.chartSymbol);

  return (
    <aside className="alert-toast surface-floating" role="status" aria-live="polite" aria-label="새 알림">
      <div className="alert-toast-icon" aria-hidden="true">
        <Bell size={15} />
      </div>
      <div className="alert-toast-copy">
        <strong>{presentation.title}</strong>
        <p>{presentation.message}</p>
        {presentation.detail && <span>{presentation.detail}</span>}
        {queuedCount > 0 && <small>다음 알림 {queuedCount}개</small>}
      </div>
      <button
        type="button"
        className="alert-toast-close"
        aria-label="알림 말풍선 닫기"
        title="닫기"
        onClick={onClose}
      >
        <X size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="alert-toast-chart-button"
        disabled={!canOpenChart}
        aria-label={canOpenChart ? `${presentation.chartSymbol} 차트 열기` : "차트를 열 수 없는 알림"}
        title={canOpenChart ? `${presentation.chartSymbol} 차트 열기` : "차트를 열 수 없는 알림"}
        onClick={() => onOpenChart(notification)}
      >
        <ExternalLink size={13} aria-hidden="true" />
        <span>차트 열기</span>
      </button>
    </aside>
  );
}
