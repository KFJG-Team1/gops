import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  alertRulesChangedEvent,
  deleteAlert,
  fetchAlerts,
  setAlertStatus,
  type AlertCondition,
  type AlertCreatedVia,
  type PriceAlert
} from "../alerts/alertApi";
import {
  useNotificationPreferences,
  type NotificationSettingKey
} from "../alerts/notificationPreferences";
import type { ChartSymbolDto } from "../chart/types";
import { fetchWatchlist } from "../chart/watchlistApi";
import { sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { StockLogo } from "./StockLogo";

type NotificationCenterPanelProps = {
  symbols: ChartSymbolDto[];
  marketItems: Sp500UniverseItem[];
  onOpenCompany: (symbol: string) => void;
};

type PanelTab = "alerts" | "watchlist";
type ReminderKey = Exclude<NotificationSettingKey, "master" | "targetPrice" | "rapidMove" | "extendedHoursMove" | "aiAnomaly">;

const panelTabs: Array<{ id: PanelTab; label: string }> = [
  { id: "alerts", label: "알림" },
  { id: "watchlist", label: "관심 기업" }
];

const reminderRows: Array<{ key: ReminderKey; label: string; validity: string }> = [
  { key: "marketOpen", label: "미국장 개장", validity: "매 거래일" },
  { key: "marketClose", label: "미국장 마감", validity: "매 거래일" },
  { key: "socialIssue", label: "사회 이슈·논란", validity: "상시" },
  { key: "rsiBand", label: "RSI 과매수·과매도", validity: "상시" },
  { key: "economicCalendar", label: "주요 경제지표 일정", validity: "일정 당일" },
  { key: "earnings", label: "실적 발표 일정", validity: "발표 당일" },
  { key: "volumeSpike", label: "거래량 급증", validity: "상시" },
  { key: "tradingHalt", label: "거래 정지·재개", validity: "상시" },
  { key: "marketVolatility", label: "시장 변동성 확대", validity: "상시" }
];

export function NotificationCenterPanel({ symbols, marketItems, onOpenCompany }: NotificationCenterPanelProps) {
  const {
    preferences,
    canUse: canUseNotificationPreferences,
    loading: notificationLoading,
    error: notificationError,
    savingKeys,
    updateSetting
  } = useNotificationPreferences();
  const [activeTab, setActiveTab] = useState<PanelTab>("alerts");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<ChartSymbolDto[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [editingAlerts, setEditingAlerts] = useState(false);
  const [expandedAlertIds, setExpandedAlertIds] = useState<Set<number>>(() => new Set());
  const [savingAlertIds, setSavingAlertIds] = useState<Set<number>>(() => new Set());

  const refreshWatchlist = useCallback((signal?: AbortSignal) => {
    setWatchlistLoading(true);
    setWatchlistError(null);
    return fetchWatchlist(signal)
      .then((payload) => setWatchlistSymbols(payload.symbols))
      .catch(() => {
        if (!signal?.aborted) {
          setWatchlistError("관심 기업을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!signal?.aborted) setWatchlistLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshWatchlist(controller.signal);
    return () => controller.abort();
  }, [refreshWatchlist]);

  const refreshAlerts = useCallback((signal?: AbortSignal) => {
    setAlertsLoading(true);
    setAlertsError(null);
    return fetchAlerts(signal)
      .then(setAlerts)
      .catch(() => {
        if (!signal?.aborted) setAlertsError("기업 알림을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!signal?.aborted) setAlertsLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAlerts(controller.signal);
    const handleRulesChanged = () => void refreshAlerts();
    window.addEventListener(alertRulesChangedEvent, handleRulesChanged);
    return () => {
      controller.abort();
      window.removeEventListener(alertRulesChangedEvent, handleRulesChanged);
    };
  }, [refreshAlerts]);

  const companies = useMemo(
    () => watchlistSymbols.map((item) => mergeCompany(item, symbols)),
    [symbols, watchlistSymbols]
  );
  const changePercentBySymbol = useMemo(
    () => new Map(marketItems.map((item) => [item.symbol.toUpperCase(), item.changePercent])),
    [marketItems]
  );
  const companyNameBySymbol = useMemo(() => {
    const entries = marketItems.map((item) => [item.symbol.toUpperCase(), item.companyName] as const);
    symbols.forEach((item) => entries.push([item.symbol.toUpperCase(), item.name]));
    return new Map(entries);
  }, [marketItems, symbols]);

  const selectTab = useCallback((tab: PanelTab) => setActiveTab(tab), []);
  const handleTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % panelTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + panelTabs.length) % panelTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = panelTabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    selectTab(panelTabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }, [selectTab]);

  const updateAlertBell = async (alert: PriceAlert) => {
    if (savingAlertIds.has(alert.id)) return;
    setSavingAlertIds((current) => new Set(current).add(alert.id));
    setAlerts((current) => current.map((item) => item.id === alert.id
      ? { ...item, status: alert.status === "active" ? "disabled" : "active" }
      : item));
    try {
      await setAlertStatus(alert.id, alert.status === "active" ? "disabled" : "active");
    } catch (caught: unknown) {
      setAlertsError(caught instanceof Error ? caught.message : "알림 상태를 바꾸지 못했습니다.");
      void refreshAlerts();
    } finally {
      setSavingAlertIds((current) => {
        const next = new Set(current);
        next.delete(alert.id);
        return next;
      });
    }
  };

  const removeAlert = async (alert: PriceAlert) => {
    if (savingAlertIds.has(alert.id)) return;
    setSavingAlertIds((current) => new Set(current).add(alert.id));
    try {
      await deleteAlert(alert.id);
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
    } catch (caught: unknown) {
      setAlertsError(caught instanceof Error ? caught.message : "알림을 삭제하지 못했습니다.");
    } finally {
      setSavingAlertIds((current) => {
        const next = new Set(current);
        next.delete(alert.id);
        return next;
      });
    }
  };

  return (
    <section className="alerts-watchlist-panel" aria-label="알림 및 관심 기업 패널">
      <div className="alerts-watchlist-tabs" role="tablist" aria-label="패널 메뉴">
        {panelTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={`alerts-watchlist-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`alerts-watchlist-${tab.id}-panel`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? "is-active" : ""}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id="alerts-watchlist-alerts-panel"
        className="alerts-watchlist-tab-panel alert-rules-panel"
        role="tabpanel"
        aria-labelledby="alerts-watchlist-alerts-tab"
        hidden={activeTab !== "alerts"}
      >
        <section className="alert-rule-section" aria-labelledby="reminder-alerts-heading">
          <header className="alert-rule-section-heading">
            <div>
              <h3 id="reminder-alerts-heading">리마인더</h3>
            </div>
            <AlarmSwitch
              checked={preferences.settings.master}
              label={`전체 알림 ${preferences.settings.master ? "끄기" : "켜기"}`}
              disabled={!canUseNotificationPreferences || notificationLoading || savingKeys.has("setting:master")}
              onClick={() => void updateSetting("master", !preferences.settings.master)}
            />
          </header>
          <div className="alert-rule-columns" aria-hidden="true">
            <span>항목</span><span>유효기간</span><span />
            <span className="alert-rule-column-spacer" />
            <span>항목</span><span>유효기간</span><span />
          </div>
          <div className="alert-rule-list" role="list">
            {reminderRows.map((row) => {
              const checked = preferences.settings[row.key];
              const saving = savingKeys.has(`setting:${row.key}`);
              return (
                <div key={row.key} className="alert-rule-row" role="listitem">
                  <strong>{row.label}</strong>
                  <span className="alert-rule-validity">{row.validity}</span>
                  <span className="alert-rule-actions">
                    <AlarmSwitch
                      checked={checked}
                      label={`${row.label} ${checked ? "끄기" : "켜기"}`}
                      disabled={!canUseNotificationPreferences || notificationLoading || !preferences.settings.master || saving}
                      onClick={() => void updateSetting(row.key, !checked)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="alert-rule-section is-company" aria-labelledby="company-alerts-heading">
          <header className="alert-rule-section-heading">
            <div>
              <h3 id="company-alerts-heading">기업 알림</h3>
            </div>
            <button
              type="button"
              className={`alert-edit-button ${editingAlerts ? "is-active" : ""}`}
              aria-pressed={editingAlerts}
              onClick={() => setEditingAlerts((current) => !current)}
            >
              {editingAlerts ? "완료" : "편집"}
            </button>
          </header>
          <div className="alert-rule-columns" aria-hidden="true">
            <span>기업</span><span>유효기간</span><span />
            <span className="alert-rule-column-spacer" />
            <span>기업</span><span>유효기간</span><span />
          </div>
          {alertsLoading && alerts.length === 0 ? (
            <div className="alerts-watchlist-state" role="status">기업 알림을 불러오는 중입니다.</div>
          ) : alerts.length === 0 ? (
            <PanelLoadState
              message={alertsError ?? "설정된 기업 알림이 없습니다."}
              error={Boolean(alertsError)}
              onRetry={alertsError ? () => void refreshAlerts() : undefined}
            />
          ) : (
            <>
              <div className="alert-rule-list" role="list">
                {alerts.map((alert) => {
                  const expanded = expandedAlertIds.has(alert.id);
                  const companyName = companyNameBySymbol.get(alert.symbol) || alert.symbol;
                  const busy = savingAlertIds.has(alert.id);
                  return (
                    <div
                      key={alert.id}
                      className={`company-alert-rule ${expanded ? "is-expanded" : ""} ${editingAlerts ? "is-editing" : ""}`}
                      role="listitem"
                    >
                      <div className="alert-rule-row">
                        <button
                          type="button"
                          className="company-alert-name"
                          aria-expanded={expanded}
                          aria-controls={`company-alert-detail-${alert.id}`}
                          onClick={() => setExpandedAlertIds((current) => toggledSet(current, alert.id))}
                        >
                          <span><strong>{companyName}</strong><small>{alert.symbol}</small></span>
                          <ChevronDown size={13} aria-hidden="true" />
                        </button>
                        <span className="alert-rule-validity">{alertValidity(alert)}</span>
                        <span className="alert-rule-actions">
                          <AlarmSwitch
                            checked={alert.status === "active"}
                            label={`${companyName} 알림 ${alert.status === "active" ? "끄기" : "켜기"}`}
                            disabled={busy || !preferences.settings.master}
                            onClick={() => void updateAlertBell(alert)}
                          />
                          {editingAlerts && (
                            <button
                              type="button"
                              className="alert-delete-button"
                              aria-label={`${companyName} 알림 삭제`}
                              disabled={busy}
                              onClick={() => void removeAlert(alert)}
                            >
                              삭제
                            </button>
                          )}
                        </span>
                      </div>
                      {expanded && (
                        <div id={`company-alert-detail-${alert.id}`} className="company-alert-detail">
                          <dl>
                            <div><dt>조건</dt><dd>{conditionLabel(alert)}</dd></div>
                            <div><dt>설정 위치</dt><dd>{createdViaLabel(alert.createdVia)}</dd></div>
                          </dl>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {alertsError && <InlineLoadNotice message={alertsError} onRetry={() => void refreshAlerts()} />}
            </>
          )}
        </section>

        {notificationError && <InlineLoadNotice message="알림 설정을 불러오지 못했습니다." />}
      </section>

      <section
        id="alerts-watchlist-watchlist-panel"
        className="alerts-watchlist-tab-panel"
        role="tabpanel"
        aria-labelledby="alerts-watchlist-watchlist-tab"
        hidden={activeTab !== "watchlist"}
      >
        {watchlistLoading && companies.length === 0 ? (
          <div className="alerts-watchlist-state" role="status">관심 기업을 불러오는 중입니다.</div>
        ) : companies.length === 0 ? (
          <PanelLoadState
            message={watchlistError ?? "아직 관심 기업이 없습니다."}
            error={Boolean(watchlistError)}
            onRetry={watchlistError ? () => void refreshWatchlist() : undefined}
          />
        ) : (
          <>
            <div className="alerts-watchlist-company-list" role="list" aria-label="관심 기업 목록">
              {companies.map((company) => {
                const symbol = company.symbol.toUpperCase();
                const changeLabel = formatSignedPercent(changePercentBySymbol.get(symbol));
                return (
                  <div key={company.symbol} className="alerts-watchlist-company-row" role="listitem">
                    <button
                      type="button"
                      className="alerts-watchlist-company-open"
                      aria-label={`${company.name}, ${sectorLabelKo(company.sector)}, ${changeLabel}`}
                      onClick={() => onOpenCompany(company.symbol)}
                    >
                      <StockLogo symbol={company.symbol} companyName={company.name} size="xs" className="alerts-watchlist-company-logo" />
                      <span className="alerts-watchlist-company-copy">
                        <strong>{company.name}</strong>
                        <small>{sectorLabelKo(company.sector)}</small>
                      </span>
                      <span className="alerts-watchlist-company-change">{changeLabel}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            {watchlistError && <InlineLoadNotice message={watchlistError} onRetry={() => void refreshWatchlist()} />}
          </>
        )}
      </section>
    </section>
  );
}

function PanelLoadState({ message, error = false, onRetry }: {
  message: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`alerts-watchlist-state ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry}>다시 불러오기</button>}
    </div>
  );
}

function InlineLoadNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alerts-watchlist-inline-notice" role="status">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry}>다시 불러오기</button>}
    </div>
  );
}

function AlarmSwitch({ checked, label, disabled, onClick }: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`alert-switch-button ${checked ? "is-on" : ""}`}
      role="switch"
      aria-label={label}
      title={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function conditionLabel(alert: PriceAlert): string {
  const condition = alert.condition || legacyCondition(alert);
  if (!condition) return "조건 정보 없음";
  const operator = condition.operator === "below" ? "≤" : "≥";
  if (condition.kind === "price_cross") return `주가 ${operator} $${formatNumber(condition.threshold)}`;
  if (condition.kind === "price_change") {
    const metric = condition.operator === "either" ? "|등락률|" : "등락률";
    return `${condition.windowMin ?? alert.windowMin ?? 0}분 ${metric} ${operator} ${formatNumber(condition.threshold)}%`;
  }
  if (condition.kind === "volume_absolute") return `${condition.interval} 거래량 ${operator} ${formatNumber(condition.threshold)}주`;
  if (condition.kind === "volume_relative") return `${condition.interval} 거래량 ${operator} 최근 ${condition.lookback ?? 20}봉 평균의 ${formatNumber(condition.threshold)}배`;
  return `${condition.interval ?? "1D"} RSI(${condition.period ?? 14}) ${operator} ${formatNumber(condition.threshold)}`;
}

function legacyCondition(alert: PriceAlert): AlertCondition | null {
  if (alert.type === "price_cross" && alert.targetPrice != null) {
    return { kind: "price_cross", operator: alert.direction || "above", threshold: alert.targetPrice };
  }
  if (alert.type === "spike" && alert.changePct != null) {
    return { kind: "price_change", operator: alert.direction || "either", threshold: alert.changePct, windowMin: alert.windowMin };
  }
  return null;
}

function alertValidity(alert: PriceAlert): string {
  if (alert.expiresAt) {
    const date = new Date(alert.expiresAt);
    if (Number.isFinite(date.getTime())) return `${date.getMonth() + 1}.${date.getDate()}까지`;
  }
  if (alert.repeatLimit === null) return "직접 삭제할 때까지";
  if (alert.repeatLimit === 1) return "1회 알림 후 종료";
  return `최대 ${alert.repeatLimit}회`;
}

function createdViaLabel(value: AlertCreatedVia | undefined): string {
  if (value === "agent_chat") return "에이전트";
  if (value === "ai_coach") return "AI 코치";
  if (value === "chart") return "차트 패널";
  if (value === "trade_condition") return "가격 조건 패널";
  return "알림 패널";
}

function toggledSet(current: Set<number>, value: number): Set<number> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function mergeCompany(item: ChartSymbolDto, symbols: ChartSymbolDto[]): ChartSymbolDto {
  const symbol = item.symbol.toUpperCase();
  const catalogItem = symbols.find((candidate) => candidate.symbol.toUpperCase() === symbol);
  return {
    symbol,
    name: item.name && item.name !== symbol ? item.name : catalogItem?.name ?? symbol,
    sector: item.sector || catalogItem?.sector,
    isMock: item.isMock ?? catalogItem?.isMock
  };
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
