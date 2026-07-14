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
  "marketOpen",
  "marketClose",
  "extendedHoursMove",
  "targetPrice",
  "rapidMove",
  "volumeSpike",
  "watchlistNews",
  "earningsFiling",
  "executiveChange",
  "socialIssue",
  "regulationLegal",
  "supplyChainMacro"
] as const;

export type NotificationSettingKey = typeof notificationSettingKeys[number];
export type NotificationSettings = Record<NotificationSettingKey, boolean>;

export type NotificationPreferences = {
  settings: NotificationSettings;
  companyOverrides: Record<string, boolean>;
  persisted: boolean;
  updatedAt: string | null;
};

export const defaultNotificationSettings: NotificationSettings = {
  master: true,
  marketOpen: true,
  marketClose: false,
  extendedHoursMove: false,
  targetPrice: true,
  rapidMove: true,
  volumeSpike: false,
  watchlistNews: true,
  earningsFiling: true,
  executiveChange: false,
  socialIssue: true,
  regulationLegal: true,
  supplyChainMacro: false
};

export const readyNotificationSettingKeys = new Set<NotificationSettingKey>([
  "master",
  "marketOpen",
  "targetPrice",
  "rapidMove",
  "volumeSpike"
]);

const defaultNotificationPreferences: NotificationPreferences = {
  settings: { ...defaultNotificationSettings },
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

  const value = useMemo<NotificationPreferencesContextValue>(() => ({
    preferences,
    canUse: canUsePreferences,
    ready,
    loading,
    error,
    savingKeys,
    updateSetting,
    updateCompanyOverride
  }), [canUsePreferences, error, loading, preferences, ready, savingKeys, updateCompanyOverride, updateSetting]);

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
  if (["price_surge", "price_drop", "volatility_expansion", "risk_anomaly_surge"].includes(eventType)) {
    return "rapidMove";
  }
  if (["watchlist_news", "company_news"].includes(eventType)) {
    return "watchlistNews";
  }
  if (["earnings", "guidance", "filing", "disclosure"].includes(eventType)) {
    return "earningsFiling";
  }
  if (["executive_change", "management_change"].includes(eventType)) {
    return "executiveChange";
  }
  if (["social_issue", "controversy", "sentiment_crisis"].includes(eventType)) {
    return "socialIssue";
  }
  if (["regulation", "legal", "lawsuit"].includes(eventType)) {
    return "regulationLegal";
  }
  if (["supply_chain", "macro", "interest_rate"].includes(eventType)) {
    return "supplyChainMacro";
  }
  return null;
}

export function shouldShowNotificationToast(
  notification: NotificationItem,
  preferences: NotificationPreferences
): boolean {
  if (!preferences.settings.master) {
    return false;
  }
  const setting = notificationSettingForItem(notification);
  if (setting && !preferences.settings[setting]) {
    return false;
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
  const rawOverrides = asRecord(source.companyOverrides);
  const settings = { ...defaultNotificationSettings };
  notificationSettingKeys.forEach((key) => {
    if (typeof rawSettings[key] === "boolean") {
      settings[key] = rawSettings[key];
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
