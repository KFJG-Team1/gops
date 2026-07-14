import { normalizeUiProposals, type UiProposalLike } from "../layout/uiProposalLayout";
import type { AlertDirection, NotificationItem, PriceAlert } from "./alertApi";
import { isMarketOpenNotification } from "./marketOpenReminder";

export type AlertToastPresentation = {
  symbol: string;
  chartSymbol: string;
  title: string;
  message: string;
  detail: string;
};

const NON_CHART_SYMBOLS = new Set(["PORTFOLIO", "MARKET", "UNKNOWN", "ALERT"]);

const riskAlertTitles: Record<string, string> = {
  risk_daily_loss_limit: "일일 손실 한도",
  risk_concentration_drift: "비중 쏠림 경고",
  risk_correlation_cluster: "상관 클러스터 경고",
  risk_anomaly_surge: "이상 급등 신호"
};

export function notificationDecision(notification: NotificationItem): Record<string, unknown> {
  return asRecord(notification.payload.decision);
}

export function notificationUiProposals(notification: NotificationItem): UiProposalLike[] {
  const decision = notificationDecision(notification);
  const metrics = asRecord(decision.metrics ?? notification.payload.metrics);
  return normalizeUiProposals(metrics.uiProposals);
}

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
  if (alert.type === "spike") {
    return `${directionLabels[alert.direction ?? "above"]} ${formatNumber(alert.changePct)}% / ${alert.windowMin ?? "-"}m${suffix}`;
  }
  const condition = alert.condition;
  return `${condition?.interval ?? "1D"} ${condition?.kind ?? alert.type} ${formatNumber(condition?.threshold)}${suffix}`;
}

export function notificationSymbol(notification: NotificationItem): string {
  if (isMarketOpenNotification(notification)) {
    return "MARKET";
  }
  return notificationChartSymbol(notification) || "ALERT";
}

export function notificationChartSymbol(notification: NotificationItem): string {
  const symbol = asString(notification.payload.symbol)?.toUpperCase() ?? "";
  if (NON_CHART_SYMBOLS.has(symbol)) {
    return "";
  }
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

  const systemTitle = asString(payload.title);
  const systemSummary = asString(payload.summary);
  const systemDetail = asString(payload.detail);
  if (notification.type.startsWith("system.") && (systemTitle || systemSummary)) {
    return {
      symbol,
      chartSymbol,
      title: systemTitle || "리마인더",
      message: systemSummary || systemTitle || "알림이 도착했습니다.",
      detail: systemDetail ?? ""
    };
  }

  const decision = notificationDecision(notification);
  const decisionSummary = asString(decision.summary);
  if (decisionSummary) {
    const eventType = asString(decision.eventType) ?? "";
    return {
      symbol,
      chartSymbol,
      title: riskAlertTitles[eventType] ?? "리스크 알림",
      message: decisionSummary,
      detail: ""
    };
  }

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

  const metrics = asRecord(payload.metrics);
  const threshold = asNumber(payload.threshold);
  if (notification.type === "alert.volume_absolute") {
    return {
      symbol,
      chartSymbol,
      title: "거래량 조건 달성",
      message: `${symbol} ${asString(payload.interval) || ""} 거래량이 ${formatNumber(threshold)}주 ${directionLabel(payload.direction)} 조건을 달성했습니다.`,
      detail: asNumber(metrics.volume) !== undefined ? `현재 거래량은 ${formatNumber(asNumber(metrics.volume))}주입니다.` : ""
    };
  }
  if (notification.type === "alert.volume_relative") {
    return {
      symbol,
      chartSymbol,
      title: "거래량 조건 달성",
      message: `${symbol} 거래량이 평균의 ${formatNumber(threshold)}배 ${directionLabel(payload.direction)} 조건을 달성했습니다.`,
      detail: asNumber(metrics.volumeMultiple) !== undefined ? `현재 ${formatNumber(asNumber(metrics.volumeMultiple))}배입니다.` : ""
    };
  }
  if (notification.type === "alert.rsi_threshold") {
    return {
      symbol,
      chartSymbol,
      title: "RSI 조건 달성",
      message: `${symbol} RSI가 ${formatNumber(threshold)} ${directionLabel(payload.direction)} 조건을 달성했습니다.`,
      detail: asNumber(metrics.rsi) !== undefined ? `현재 RSI는 ${formatNumber(asNumber(metrics.rsi))}입니다.` : ""
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
