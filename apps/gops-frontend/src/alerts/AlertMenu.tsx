import { Bell, BellOff, Check, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../auth/AuthProvider";
import type { ChartSymbolDto } from "../chart/types";
import { SymbolSearch } from "../components/SymbolSearch";
import {
  createAlert,
  deleteAlert,
  deleteNotification,
  fetchAlerts,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotificationPayload,
  notificationSocketUrl,
  setAlertStatus,
  type AlertDirection,
  type AlertKind,
  type NotificationItem,
  type PriceAlert
} from "./alertApi";

type AlertMenuProps = {
  activeSymbol: string;
  symbols: ChartSymbolDto[];
  authEnabled: boolean;
  authLoading: boolean;
  authUser: AuthUser | null;
  onLogin: () => void;
  onUnreadCountChange?: (count: number) => void;
};

type AlertFormMode = AlertKind;
type AlertRepeatOption = "1" | "unlimited" | "3" | "5" | "10";

const directionLabels: Record<AlertDirection, string> = {
  above: "상승",
  below: "하락"
};

export function AlertMenu({ activeSymbol, symbols, authEnabled, authLoading, authUser, onLogin, onUnreadCountChange }: AlertMenuProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AlertFormMode>("price_cross");
  const [symbol, setSymbol] = useState(activeSymbol);
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [changePct, setChangePct] = useState("3");
  const [windowMin, setWindowMin] = useState("5");
  const [repeatMode, setRepeatMode] = useState<AlertRepeatOption>("1");
  const [formOpen, setFormOpen] = useState(false);
  const canUseAlerts = !authLoading && (!authEnabled || Boolean(authUser));
  const targetPriceKorean = useMemo(() => formatKoreanWon(targetPrice), [targetPrice]);
  const selectedSymbolLabel = useMemo(() => formatSelectedSymbolLabel(symbol, symbols), [symbol, symbols]);

  useEffect(() => {
    setSymbol(activeSymbol);
  }, [activeSymbol]);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!canUseAlerts) {
      setAlerts([]);
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([fetchAlerts(controller.signal), fetchNotifications(controller.signal)])
      .then(([nextAlerts, notificationPayload]) => {
        if (cancelled) {
          return;
        }
        setAlerts(nextAlerts);
        setNotifications(notificationPayload.notifications);
        setUnreadCount(notificationPayload.unreadCount);
      })
      .catch((caught: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "알림 데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canUseAlerts]);

  useEffect(() => {
    if (!canUseAlerts) {
      return undefined;
    }
    const socket = new WebSocket(notificationSocketUrl());
    socket.onmessage = (event) => {
      const payload = readSocketPayload(event.data);
      if (payload.type === "snapshot") {
        const rows = Array.isArray(payload.notifications)
          ? payload.notifications.map(normalizeNotificationPayload).filter((item): item is NotificationItem => Boolean(item))
          : [];
        setNotifications(rows);
        setUnreadCount(asNumber(payload.unreadCount) ?? rows.filter((item) => !item.readAt).length);
        return;
      }
      if (payload.type === "notification") {
        const notification = normalizeNotificationPayload(payload.notification);
        if (!notification) {
          return;
        }
        setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50));
        setUnreadCount((current) => current + (notification.readAt ? 0 : 1));
      }
    };
    socket.onerror = () => setError("알림 스트림 연결을 확인하지 못했습니다.");
    return () => socket.close();
  }, [canUseAlerts]);

  const visibleAlerts = useMemo(() => (
    [...alerts].sort((left, right) => statusRank(left.status) - statusRank(right.status) || right.id - left.id)
  ), [alerts]);

  const submitAlert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canUseAlerts) {
      if (authEnabled) {
        onLogin();
      }
      return;
    }
    const normalizedSymbol = symbol.trim().toUpperCase();
    const repeatLimit = parseRepeatLimit(repeatMode);
    if (!normalizedSymbol) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = mode === "price_cross"
        ? await createAlert({ symbol: normalizedSymbol, type: "price_cross", targetPrice: normalizeNumberForPayload(targetPrice), repeatLimit })
        : await createAlert({ symbol: normalizedSymbol, type: "spike", direction, changePct, windowMin: Number(windowMin), repeatLimit });
      setAlerts((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      if (mode === "price_cross") {
        setTargetPrice("");
      }
      setFormOpen(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "알림을 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const toggleAlertStatus = async (alert: PriceAlert) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await setAlertStatus(alert.id, alert.status === "active" ? "disabled" : "active");
      setAlerts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "알림 상태를 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeAlert = async (alertId: number) => {
    setSaving(true);
    setError(null);
    try {
      await deleteAlert(alertId);
      setAlerts((current) => current.filter((item) => item.id !== alertId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "알림을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const readNotification = async (notification: NotificationItem) => {
    if (notification.readAt) {
      return;
    }
    const updated = await markNotificationRead(notification.id);
    if (!updated) {
      return;
    }
    setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  };

  const readAll = async () => {
    const updated = await markAllNotificationsRead();
    if (updated <= 0) {
      return;
    }
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    setUnreadCount(0);
  };

  const removeNotification = async (notification: NotificationItem) => {
    setSaving(true);
    setError(null);
    try {
      await deleteNotification(notification.id);
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      if (!notification.readAt) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "알림을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bottom-menu-section bottom-menu-scroll alert-menu">
      <header className="bottom-menu-title">
        <Bell size={15} />
        <span>알림</span>
        <small>{unreadCount > 0 ? `${unreadCount} unread` : "live"}</small>
      </header>
      {!canUseAlerts ? (
        <button className="bottom-menu-item surface-raised" type="button" disabled={authLoading} onClick={onLogin}>
          로그인 후 알림 사용
        </button>
      ) : (
        <>
          {!formOpen ? (
            <button className="bottom-menu-item surface-raised alert-add-button" type="button" onClick={() => setFormOpen(true)}>
              <Plus size={14} />
              <span>알림 추가하기</span>
            </button>
          ) : (
            <form className="alert-form" onSubmit={submitAlert}>
              <div className="alert-form-title">
                <strong>새 알림</strong>
                <button
                  type="button"
                  className="alert-icon-button"
                  aria-label="새 알림 닫기"
                  title="새 알림 닫기"
                  onClick={() => setFormOpen(false)}
                >
                  <X size={13} />
                </button>
              </div>
              <div className="alert-form-row">
                <label className="alert-field alert-symbol-field">
                  <span>종목</span>
                  <SymbolSearch
                    symbols={symbols}
                    selectedSymbol={symbol}
                    selectedLabel={selectedSymbolLabel}
                    placeholder="종목 검색"
                    compact
                    className="alert-symbol-search"
                    onSelectSymbol={(nextSymbol) => setSymbol(nextSymbol.toUpperCase())}
                  />
                </label>
                <label className="alert-field">
                  <span>알림 유형</span>
                  <select className="alert-input" value={mode} aria-label="알림 유형" onChange={(event) => setMode(event.target.value as AlertFormMode)}>
                    <option value="price_cross">목표가</option>
                    <option value="spike">급등락</option>
                  </select>
                </label>
              </div>
              {mode === "price_cross" ? (
                <label className="alert-field">
                  <span>목표가</span>
                  <input
                    className="alert-input"
                    inputMode="decimal"
                    placeholder="예: 1,000,000"
                    value={targetPrice}
                    aria-label="목표가"
                    onChange={(event) => setTargetPrice(cleanPriceInput(event.target.value))}
                  />
                  {targetPriceKorean && <small className="alert-target-preview">{targetPriceKorean}</small>}
                </label>
              ) : (
                <div className="alert-form-row alert-form-row-three">
                  <label className="alert-field">
                    <span>방향</span>
                    <select className="alert-input" value={direction} aria-label="급등락 방향" onChange={(event) => setDirection(event.target.value as AlertDirection)}>
                      <option value="above">급등</option>
                      <option value="below">급락</option>
                    </select>
                  </label>
                  <label className="alert-field">
                    <span>변동률</span>
                    <input
                      className="alert-input"
                      inputMode="decimal"
                      value={changePct}
                      aria-label="변동률"
                      placeholder="%"
                      onChange={(event) => setChangePct(cleanNumberInput(event.target.value))}
                    />
                  </label>
                  <label className="alert-field">
                    <span>기간</span>
                    <input
                      className="alert-input"
                      inputMode="numeric"
                      value={windowMin}
                      aria-label="감지 시간"
                      placeholder="분"
                      onChange={(event) => setWindowMin(event.target.value.replace(/[^\d]/g, ""))}
                    />
                    <small className="alert-field-note">현재가를 몇 분 전 가격과 비교할지 정합니다.</small>
                  </label>
                </div>
              )}
              <label className="alert-field">
                <span>재알림 방식</span>
                <select
                  className="alert-input"
                  value={repeatMode}
                  aria-label="재알림 방식"
                  onChange={(event) => setRepeatMode(event.target.value as AlertRepeatOption)}
                >
                  <option value="1">한 번만 알림</option>
                  <option value="unlimited">다시 충족될 때마다 알림</option>
                  <option value="3">최대 3회 알림</option>
                  <option value="5">최대 5회 알림</option>
                  <option value="10">최대 10회 알림</option>
                </select>
              </label>
              <button className="bottom-menu-item surface-raised alert-submit" type="submit" disabled={saving || loading}>
                {saving ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                <span>등록</span>
              </button>
            </form>
          )}
          {error && <p className="alert-menu-error">{error}</p>}
          <section className="alert-menu-group">
            <div className="alert-menu-group-title">
              <strong>내 알림</strong>
              {loading && <LoaderCircle size={13} className="spin" />}
            </div>
            <div className="alert-list">
              {visibleAlerts.map((alert) => (
                <article key={alert.id} className={`alert-row ${alert.status}`}>
                  <div className="alert-row-main">
                    <strong>{alert.symbol}</strong>
                    <span>{alertSummary(alert)}</span>
                  </div>
                  <button
                    type="button"
                    className={`alert-icon-button ${alert.status === "active" ? "is-on" : "is-off"}`}
                    aria-label={alertToggleLabel(alert)}
                    title={alertToggleLabel(alert)}
                    disabled={saving || alert.status === "fired" || alert.status === "expired"}
                    onClick={() => toggleAlertStatus(alert)}
                  >
                    {alert.status === "active" ? <Bell size={13} /> : <BellOff size={13} />}
                  </button>
                  <button
                    type="button"
                    className="alert-icon-button danger"
                    aria-label="알림 삭제"
                    title="알림 삭제"
                    disabled={saving}
                    onClick={() => removeAlert(alert.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </article>
              ))}
              {!loading && visibleAlerts.length === 0 && <p className="bottom-menu-empty">등록된 알림이 없습니다.</p>}
            </div>
          </section>
          <section className="alert-menu-group">
            <div className="alert-menu-group-title">
              <strong>수신함</strong>
              <button type="button" className="alert-inline-button" disabled={unreadCount === 0} onClick={readAll}>
                <Check size={12} />
                <span>읽음</span>
              </button>
            </div>
            <div className="alert-list notifications">
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={`notification-row ${notification.readAt ? "read" : "unread"}`}
                >
                  {notification.readAt ? <BellOff size={13} /> : <Bell size={13} />}
                  <button
                    type="button"
                    className="notification-row-main"
                    disabled={saving || Boolean(notification.readAt)}
                    onClick={() => readNotification(notification)}
                  >
                    <span className="notification-row-copy">
                      <strong>{notificationSymbol(notification)}</strong>
                      {notificationSummary(notification)}
                    </span>
                    {notification.createdAt && (
                      <time className="notification-row-time" dateTime={notification.createdAt}>
                        {formatNotificationTime(notification.createdAt)}
                      </time>
                    )}
                  </button>
                  {notification.readAt && (
                    <button
                      type="button"
                      className="alert-icon-button danger notification-delete-button"
                      aria-label="읽은 알림 삭제"
                      title="읽은 알림 삭제"
                      disabled={saving}
                      onClick={() => removeNotification(notification)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </article>
              ))}
              {!loading && notifications.length === 0 && <p className="bottom-menu-empty">새 알림이 없습니다.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function alertSummary(alert: PriceAlert): string {
  const repeatStatus = repeatStatusLabel(alert);
  const suffix = repeatStatus ? ` · ${repeatStatus}` : "";
  if (alert.type === "price_cross") {
    return `${directionLabel(alert.direction)} ${formatNumber(alert.targetPrice)}${suffix}`;
  }
  return `${directionLabels[alert.direction ?? "above"]} ${formatNumber(alert.changePct)}% / ${alert.windowMin ?? "-"}m${suffix}`;
}

function notificationSymbol(notification: NotificationItem): string {
  const symbol = notification.payload.symbol;
  return typeof symbol === "string" && symbol ? symbol : "ALERT";
}

function notificationSummary(notification: NotificationItem): string {
  const payload = notification.payload;
  if (typeof payload.targetPrice === "number") {
    return ` ${directionLabel(payload.direction)} ${formatNumber(payload.targetPrice)} 도달`;
  }
  if (typeof payload.changePct === "number") {
    return ` ${formatNumber(payload.changePct)}% 변동`;
  }
  return " 알림";
}

function directionLabel(direction: unknown): string {
  return direction === "below" ? "하향" : "상향";
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
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

function alertToggleLabel(alert: PriceAlert): string {
  if (alert.status === "active") {
    return "알림 끄기";
  }
  if (alert.status === "disabled") {
    return "알림 켜기";
  }
  return "이미 울린 알림";
}

function formatNotificationTime(value: string): string {
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
  if (isSameLocalDay(date, now)) {
    return formatClock(date);
  }
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatClock(date)}`;
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function statusRank(status: PriceAlert["status"]): number {
  return status === "active" ? 0 : status === "disabled" ? 1 : 2;
}

function readSocketPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function cleanNumberInput(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function cleanPriceInput(value: string): string {
  const cleaned = cleanNumberInput(value);
  const [integerPart = "", fractionPart] = cleaned.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const groupedInteger = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fractionPart !== undefined) {
    return `${groupedInteger}.${fractionPart}`;
  }
  return groupedInteger;
}

function normalizeNumberForPayload(value: string): string {
  return value.replace(/,/g, "").trim();
}

function parseRepeatLimit(value: AlertRepeatOption): 1 | 3 | 5 | 10 | null {
  if (value === "unlimited") {
    return null;
  }
  if (value === "3" || value === "5" || value === "10") {
    return Number(value) as 3 | 5 | 10;
  }
  return 1;
}

function formatSelectedSymbolLabel(symbol: string, symbols: ChartSymbolDto[]): string {
  const normalizedSymbol = symbol.toUpperCase();
  const match = symbols.find((item) => item.symbol.toUpperCase() === normalizedSymbol);
  return match ? `${match.symbol} - ${match.name}` : normalizedSymbol;
}

function formatKoreanWon(value: string): string {
  const normalized = normalizeNumberForPayload(value);
  if (!/^\d+$/.test(normalized)) {
    return "";
  }
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return "";
  }
  return `${numberToKorean(amount)}원`;
}

const koreanDigits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const koreanSmallUnits = ["", "십", "백", "천"];
const koreanGroupUnits = ["", "만", "억", "조", "경"];

function numberToKorean(value: number): string {
  if (value === 0) {
    return "영";
  }
  const groups: string[] = [];
  let remaining = value;
  let groupIndex = 0;
  while (remaining > 0 && groupIndex < koreanGroupUnits.length) {
    const groupValue = remaining % 10_000;
    if (groupValue > 0) {
      groups.unshift(`${fourDigitToKorean(groupValue)}${koreanGroupUnits[groupIndex]}`);
    }
    remaining = Math.floor(remaining / 10_000);
    groupIndex += 1;
  }
  return groups.join("");
}

function fourDigitToKorean(value: number): string {
  const chars: string[] = [];
  for (let position = 3; position >= 0; position -= 1) {
    const divisor = 10 ** position;
    const digit = Math.floor(value / divisor) % 10;
    if (digit === 0) {
      continue;
    }
    const digitLabel = digit === 1 && position > 0 ? "" : koreanDigits[digit];
    chars.push(`${digitLabel}${koreanSmallUnits[position]}`);
  }
  return chars.join("");
}
