import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useAuth } from "../auth/AuthProvider";
import type { NotificationItem } from "./alertApi";
import { readMarketOpenReminderEnabled } from "./marketOpenReminder";

export const notificationSettingKeys = [
  "master",
  "targetPrice",
  "rapidMove",
  "volumeSpike",
  "marketOpen",
  "marketClose",
  "socialIssue",
  "rsiBand",
  "economicCalendar",
  "earnings",
  "tradingHalt",
  "marketVolatility",
  "extendedHoursMove",
  "aiAnomaly"
] as const;

export type NotificationSettingKey = typeof notificationSettingKeys[number];
export type NotificationSettings = Record<NotificationSettingKey, boolean>;

export const notificationThresholdValues = {
  rapidMovePct: [3, 5, 10],
  volumeSpikeMultiple: [2, 3, 5]
} as const;

export type NotificationThresholdKey = keyof typeof notificationThresholdValues;
export type NotificationThresholds = {
  rapidMovePct: 3 | 5 | 10;
  volumeSpikeMultiple: 2 | 3 | 5;
};

export type NotificationPreferences = {
  settings: NotificationSettings;
  thresholds: NotificationThresholds;
  companyOverrides: Record<string, boolean>;
  persisted: boolean;
  updatedAt: string | null;
};

export const defaultNotificationSettings: NotificationSettings = {
  master: true,
  targetPrice: true,
  rapidMove: true,
  volumeSpike: false,
  marketOpen: true,
  marketClose: true,
  rsiBand: true,
  economicCalendar: true,
  earnings: true,
  tradingHalt: true,
  marketVolatility: true,
  extendedHoursMove: false,
  socialIssue: false,
  aiAnomaly: true
};

export const defaultNotificationThresholds: NotificationThresholds = {
  rapidMovePct: 5,
  volumeSpikeMultiple: 3
};

export const readyNotificationSettingKeys = new Set<NotificationSettingKey>([
  "master",
  "marketOpen",
  "marketClose",
  "rsiBand",
  "economicCalendar",
  "earnings",
  "tradingHalt",
  "marketVolatility",
  "extendedHoursMove",
  "targetPrice",
  "rapidMove",
  "volumeSpike",
  "socialIssue",
  "aiAnomaly"
]);

const defaultNotificationPreferences: NotificationPreferences = {
  settings: { ...defaultNotificationSettings },
  thresholds: { ...defaultNotificationThresholds },
  companyOverrides: {},
  persisted: false,
  updatedAt: null
};

type NotificationPreferencesContextValue = {
  preferences: NotificationPreferences;
  canUse: boolean;
  ready: boolean;
  loading: boolean;
  error: string | null;
  savingKeys: ReadonlySet<string>;
  updateSetting: (key: NotificationSettingKey, enabled: boolean) => Promise<void>;
  updateThreshold: (
    key: NotificationThresholdKey,
    value: NotificationThresholds[NotificationThresholdKey]
  ) => Promise<void>;
  updateCompanyOverride: (symbol: string, enabled: boolean) => Promise<void>;
};

const NotificationPreferencesContext = createContext<NotificationPreferencesContextValue | undefined>(undefined);

export function NotificationPreferencesProvider({ children }: { children: ReactNode }) {
  const { authEnabled, loading: authLoading, user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const canUsePreferences = !authLoading && (!authEnabled || Boolean(user));

  useEffect(() => {
    if (authLoading) {
      setReady(false);
      setLoading(true);
      return undefined;
    }
    if (!canUsePreferences) {
      setPreferences(defaultNotificationPreferences);
      setReady(true);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setReady(false);
    setLoading(true);
    setError(null);
    void fetchNotificationPreferences(controller.signal)
      .then(async (response) => {
        let next = response;
        if (!response.persisted && !readMarketOpenReminderEnabled()) {
          next = await patchNotificationPreferences({ settings: { marketOpen: false } });
        }
        if (!cancelled) {
          setPreferences(next);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setPreferences(defaultNotificationPreferences);
          setError(caught instanceof Error ? caught.message : "알림 설정을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authLoading, canUsePreferences, user?.email]);

  const updateSetting = useCallback(async (key: NotificationSettingKey, enabled: boolean) => {
    const savingKey = `setting:${key}`;
    if (savingKeys.has(savingKey)) {
      return;
    }
    const previous = preferences.settings[key];
    setError(null);
    setSavingKeys((current) => new Set(current).add(savingKey));
    setPreferences((current) => ({
      ...current,
      settings: { ...current.settings, [key]: enabled }
    }));
    try {
      const updated = await patchNotificationPreferences({ settings: { [key]: enabled } });
      setPreferences(updated);
    } catch (caught: unknown) {
      setPreferences((current) => ({
        ...current,
        settings: { ...current.settings, [key]: previous }
      }));
      setError(caught instanceof Error ? caught.message : "알림 설정을 저장하지 못했습니다.");
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(savingKey);
        return next;
      });
    }
  }, [preferences.settings, savingKeys]);

  const updateCompanyOverride = useCallback(async (symbolValue: string, enabled: boolean) => {
    const symbol = normalizeSymbol(symbolValue);
    if (!symbol) {
      return;
    }
    const savingKey = `company:${symbol}`;
    if (savingKeys.has(savingKey)) {
      return;
    }
    const hadPrevious = Object.prototype.hasOwnProperty.call(preferences.companyOverrides, symbol);
    const previous = preferences.companyOverrides[symbol];
    setError(null);
    setSavingKeys((current) => new Set(current).add(savingKey));
    setPreferences((current) => ({
      ...current,
      companyOverrides: { ...current.companyOverrides, [symbol]: enabled }
    }));
    try {
      const updated = await patchNotificationPreferences({ companyOverrides: { [symbol]: enabled } });
      setPreferences(updated);
    } catch (caught: unknown) {
      setPreferences((current) => {
        const companyOverrides = { ...current.companyOverrides };
        if (hadPrevious) {
          companyOverrides[symbol] = previous;
        } else {
          delete companyOverrides[symbol];
        }
        return { ...current, companyOverrides };
      });
      setError(caught instanceof Error ? caught.message : "기업별 알림 설정을 저장하지 못했습니다.");
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(savingKey);
        return next;
      });
    }
  }, [preferences.companyOverrides, savingKeys]);

  const updateThreshold = useCallback(async (
    key: NotificationThresholdKey,
    value: NotificationThresholds[NotificationThresholdKey]
  ) => {
    const savingKey = `threshold:${key}`;
    if (savingKeys.has(savingKey)) {
      return;
    }
    const previous = preferences.thresholds[key];
    setError(null);
    setSavingKeys((current) => new Set(current).add(savingKey));
    setPreferences((current) => ({
      ...current,
      thresholds: { ...current.thresholds, [key]: value }
    }));
    try {
      const updated = await patchNotificationPreferences({
        thresholds: { [key]: value } as Partial<NotificationThresholds>
      });
      setPreferences(updated);
    } catch (caught: unknown) {
      setPreferences((current) => ({
        ...current,
        thresholds: { ...current.thresholds, [key]: previous }
      }));
      setError(caught instanceof Error ? caught.message : "알림 임계값을 저장하지 못했습니다.");
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(savingKey);
        return next;
      });
    }
  }, [preferences.thresholds, savingKeys]);

  const value = useMemo<NotificationPreferencesContextValue>(() => ({
    preferences,
    canUse: canUsePreferences,
    ready,
    loading,
    error,
    savingKeys,
    updateSetting,
    updateThreshold,
    updateCompanyOverride
  }), [canUsePreferences, error, loading, preferences, ready, savingKeys, updateCompanyOverride, updateSetting, updateThreshold]);

  return (
    <NotificationPreferencesContext.Provider value={value}>
      {children}
    </NotificationPreferencesContext.Provider>
  );
}

export function useNotificationPreferences(): NotificationPreferencesContextValue {
  const context = useContext(NotificationPreferencesContext);
  if (!context) {
    throw new Error("useNotificationPreferences must be used inside NotificationPreferencesProvider");
  }
  return context;
}

export function notificationSettingForItem(notification: NotificationItem): NotificationSettingKey | null {
  if (notification.type === "system.market_open" || notification.payload.kind === "market_open") {
    return "marketOpen";
  }
  if (
    notification.type === "system.market_close"
    || notification.type === "system.market_close_summary"
    || notification.payload.kind === "market_close"
    || notification.payload.kind === "market_close_summary"
  ) {
    return "marketClose";
  }
  if (notification.type === "system.volume_spike" || notification.payload.kind === "volume_spike") {
    return "volumeSpike";
  }
  if (notification.type === "system.rsi_band" || notification.payload.kind === "rsi_band") {
    return "rsiBand";
  }
  if (notification.type === "alert.price_cross") {
    return "targetPrice";
  }
  if (notification.type === "alert.spike") {
    return "rapidMove";
  }

  const decision = asRecord(notification.payload.decision);
  const eventType = asString(decision.eventType ?? notification.payload.eventType)?.toLowerCase();
  if (!eventType) {
    return null;
  }
  if (eventType === "volume_spike") {
    return "volumeSpike";
  }
  if (["price_surge", "price_drop"].includes(eventType)) {
    return "rapidMove";
  }
  if (["extended_hours_move", "premarket_move", "after_hours_move"].includes(eventType)) {
    return "extendedHoursMove";
  }
  if (["risk_anomaly_surge", "volatility_expansion"].includes(eventType)) {
    return "aiAnomaly";
  }
  if (["social_issue", "controversy", "sentiment_crisis"].includes(eventType)) {
    return "socialIssue";
  }
  return null;
}

export function shouldShowNotificationToast(
  notification: NotificationItem,
  preferences: NotificationPreferences
): boolean {
  if (notification.type === "system.earnings_d1" || notification.payload.kind === "earnings_d1") {
    return false;
  }
  if (!preferences.settings.master) {
    return false;
  }
  if (notification.alertId != null && notification.type.startsWith("alert.")) {
    return true;
  }
  const setting = notificationSettingForItem(notification);
  if (!setting && notification.type === "AGENT_ALERT") {
    return false;
  }
  if (setting && !preferences.settings[setting]) {
    return false;
  }
  if (setting === "rapidMove") {
    const change = notificationMetric(notification, "changePct", "changePercent", "percentChange");
    if (change == null || Math.abs(change) < preferences.thresholds.rapidMovePct) {
      return false;
    }
  }
  if (setting === "volumeSpike") {
    const multiple = notificationMetric(notification, "multiplier", "volumeMultiple", "volumeRatio");
    if (multiple == null || multiple < preferences.thresholds.volumeSpikeMultiple) {
      return false;
    }
  }
  if (setting === "extendedHoursMove") {
    const change = notificationMetric(notification, "changePct", "changePercent", "percentChange");
    if (change == null || Math.abs(change) < 5) {
      return false;
    }
  }
  const symbol = notificationPreferenceSymbol(notification);
  return !symbol || preferences.companyOverrides[symbol] !== false;
}

export async function fetchNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
  const response = await fetch("/api/notification-preferences", {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(response, payload, "알림 설정을 불러오지 못했습니다."));
  }
  return normalizeNotificationPreferences(payload);
}

export async function patchNotificationPreferences(body: {
  settings?: Partial<NotificationSettings>;
  thresholds?: Partial<NotificationThresholds>;
  companyOverrides?: Record<string, boolean>;
}): Promise<NotificationPreferences> {
  const response = await fetch("/api/notification-preferences", {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(response, payload, "알림 설정을 저장하지 못했습니다."));
  }
  return normalizeNotificationPreferences(payload);
}

export function normalizeNotificationPreferences(payload: unknown): NotificationPreferences {
  const source = asRecord(payload);
  const rawSettings = asRecord(source.settings);
  const rawThresholds = asRecord(source.thresholds);
  const rawOverrides = asRecord(source.companyOverrides);
  const settings = { ...defaultNotificationSettings };
  notificationSettingKeys.forEach((key) => {
    if (typeof rawSettings[key] === "boolean") {
      settings[key] = rawSettings[key];
    }
  });
  const thresholds = { ...defaultNotificationThresholds };
  (Object.keys(notificationThresholdValues) as NotificationThresholdKey[]).forEach((key) => {
    const value = rawThresholds[key];
    const allowed = notificationThresholdValues[key] as readonly number[];
    if (typeof value === "number" && allowed.includes(value)) {
      Object.assign(thresholds, { [key]: value });
    }
  });
  const companyOverrides: Record<string, boolean> = {};
  Object.entries(rawOverrides).forEach(([symbolValue, enabled]) => {
    const symbol = normalizeSymbol(symbolValue);
    if (symbol && typeof enabled === "boolean") {
      companyOverrides[symbol] = enabled;
    }
  });
  return {
    settings,
    thresholds,
    companyOverrides,
    persisted: source.persisted === true,
    updatedAt: asString(source.updatedAt) ?? null
  };
}

function notificationPreferenceSymbol(notification: NotificationItem): string {
  const decision = asRecord(notification.payload.decision);
  const symbol = normalizeSymbol(asString(notification.payload.symbol ?? decision.symbol) ?? "");
  return symbol && !["MARKET", "PORTFOLIO", "UNKNOWN", "ALERT"].includes(symbol) ? symbol : "";
}

function notificationMetric(notification: NotificationItem, ...keys: string[]): number | null {
  const payload = notification.payload;
  const decision = asRecord(payload.decision);
  const sources = [payload, asRecord(payload.metrics), decision, asRecord(decision.metrics)];
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{0,9}(?:\.[A-Z])?$/.test(symbol) ? symbol : "";
}

function readErrorMessage(response: Response, payload: unknown, fallback: string): string {
  const detail = asRecord(payload).detail;
  return typeof detail === "string" && detail.trim() ? detail.trim() : `${fallback} (${response.status})`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
