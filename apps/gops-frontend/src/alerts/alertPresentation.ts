import type { AlertDirection, NotificationItem, PriceAlert } from "./alertApi";
import { isMarketOpenNotification } from "./marketOpenReminder";

export type AlertToastPresentation = {
  symbol: string;
  chartSymbol: string;
  title: string;
  message: string;
  detail: string;
};

const directionLabels: Record<AlertDirection, string> = {
  above: "상승",
  below: "하락"
};

export function alertSummary(alert: PriceAlert): string {
  const repeatStatus = repeatStatusLabel(alert);
  const suffix = repeatStatus ? ` · ${repeatStatus}` : "";
  if (alert.type === "price_cross") {
    return `${directionLabel(alert.direction)} ${formatNumber(alert.targetPrice)}${suffix}`;
  }
  return `${directionLabels[alert.direction ?? "above"]} ${formatNumber(alert.changePct)}% / ${alert.windowMin ?? "-"}m${suffix}`;
}

export function notificationSymbol(notification: NotificationItem): string {
  if (isMarketOpenNotification(notification)) {
    return "MARKET";
  }
  return notificationChartSymbol(notification) || "ALERT";
}

export function notificationChartSymbol(notification: NotificationItem): string {
  const symbol = asString(notification.payload.symbol)?.toUpperCase() ?? "";
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : "";
}

export function notificationSummary(notification: NotificationItem): string {
  if (isMarketOpenNotification(notification)) {
    return " 미국 본장 시작";
  }
  const payload = notification.payload;
  const targetPrice = asNumber(payload.targetPrice);
  if (targetPrice !== undefined) {
    return ` 목표가 ${formatNumber(targetPrice)} ${directionLabel(payload.direction)} 돌파 조건 달성`;
  }
  const thresholdPct = notificationSpikeThresholdPct(notification);
  const windowMin = notificationWindowMin(notification);
  if (thresholdPct !== undefined) {
    const windowText = windowMin !== undefined ? `${windowMin}분 내 ` : "";
    return ` ${windowText}${spikeDirectionLabel(payload.direction)} ${formatNumber(thresholdPct)}% 이상 조건 달성`;
  }
  return " 알림 조건 달성";
}

export function formatNotificationToastMessage(notification: NotificationItem): AlertToastPresentation {
  if (isMarketOpenNotification(notification)) {
    return {
      symbol: "MARKET",
      chartSymbol: "",
      title: "본장 시작",
      message: "미국 본장이 시작되었습니다.",
      detail: ""
    };
  }
  const symbol = notificationSymbol(notification);
  const chartSymbol = notificationChartSymbol(notification);
  const payload = notification.payload;
  const targetPrice = asNumber(payload.targetPrice);
  if (targetPrice !== undefined) {
    const currentPrice = asNumber(payload.price);
    return {
      symbol,
      chartSymbol,
      title: "알림 조건 달성",
      message: `${symbol} 목표가 ${formatNumber(targetPrice)} ${directionLabel(payload.direction)} 돌파 조건을 달성했습니다.`,
      detail: currentPrice !== undefined ? `현재가는 ${formatNumber(currentPrice)}입니다.` : ""
    };
  }

  const thresholdPct = notificationSpikeThresholdPct(notification);
  if (thresholdPct !== undefined) {
    const actualChangePct = asNumber(payload.changePct);
    const windowMin = notificationWindowMin(notification);
    const windowText = windowMin !== undefined ? `${windowMin}분 내 ` : "";
    return {
      symbol,
      chartSymbol,
      title: "알림 조건 달성",
      message: `${symbol} ${windowText}${spikeDirectionLabel(payload.direction)} ${formatNumber(thresholdPct)}% 이상 조건을 달성했습니다.`,
      detail: actualChangePct !== undefined ? `실제 변동률은 ${formatSignedNumber(actualChangePct)}%입니다.` : ""
    };
  }

  return {
    symbol,
    chartSymbol,
    title: "알림 조건 달성",
    message: `${symbol} 알림 조건을 달성했습니다.`,
    detail: ""
  };
}

function notificationSpikeThresholdPct(notification: NotificationItem): number | undefined {
  const payload = notification.payload;
  const alert = asRecord(payload.alert);
  return asNumber(payload.thresholdPct ?? alert.change_pct ?? alert.changePct ?? payload.changePct);
}

function notificationWindowMin(notification: NotificationItem): number | undefined {
  const payload = notification.payload;
  const alert = asRecord(payload.alert);
  return asNumber(payload.windowMin ?? alert.window_min ?? alert.windowMin);
}

function directionLabel(direction: unknown): string {
  return direction === "below" ? "하향" : "상향";
}

function spikeDirectionLabel(direction: unknown): string {
  if (direction === "below") {
    return "급락";
  }
  if (direction === "above") {
    return "급등";
  }
  return "변동";
}

function repeatStatusLabel(alert: PriceAlert): string {
  if (alert.repeatLimit === null) {
    return "매번";
  }
  if (typeof alert.repeatLimit === "number" && alert.repeatLimit > 1) {
    return `${alert.triggeredCount}/${alert.repeatLimit}회`;
  }
  return "";
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
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
