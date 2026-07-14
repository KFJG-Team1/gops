import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  notificationThresholdValues,
  useNotificationPreferences,
  type NotificationSettingKey,
  type NotificationThresholdKey,
  type NotificationThresholds
} from "../alerts/notificationPreferences";
import type { ChartSymbolDto } from "../chart/types";
import { fetchWatchlist } from "../chart/watchlistApi";
import { sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { StockLogo } from "./StockLogo";

type PriceConditionPanelProps = {
  symbols: ChartSymbolDto[];
  marketItems: Sp500UniverseItem[];
  onOpenCompany: (symbol: string) => void;
};

type PanelTab = "alerts" | "watchlist";

type NotificationSettingDefinition = {
  key: Exclude<NotificationSettingKey, "master">;
  label: string;
  threshold?: NotificationThresholdKey;
};

type NotificationSection = {
  id: string;
  label: string;
  settings: NotificationSettingDefinition[];
};

const panelTabs: Array<{ id: PanelTab; label: string }> = [
  { id: "alerts", label: "알림" },
  { id: "watchlist", label: "관심 기업" }
];

const notificationSections: NotificationSection[] = [
  {
    id: "price-market",
    label: "가격·시세",
    settings: [
      { key: "targetPrice", label: "목표가 도달" },
      { key: "rapidMove", label: "급등/급락", threshold: "rapidMovePct" },
      { key: "volumeSpike", label: "거래량 급증", threshold: "volumeSpikeMultiple" }
    ]
  },
  {
    id: "market-operation",
    label: "장 운영",
    settings: [
      { key: "marketOpen", label: "개장 알림" },
      { key: "marketClose", label: "장 마감 요약" },
      { key: "extendedHoursMove", label: "프리장·애프터장 급변동" }
    ]
  },
  {
    id: "company-event",
    label: "기업 이벤트",
    settings: [
      { key: "earningsD1", label: "실적 발표 D-1" },
      { key: "socialIssue", label: "사회 이슈·논란" }
    ]
  },
  {
    id: "ai-analysis",
    label: "AI 분석",
    settings: [
      { key: "aiAnomaly", label: "AI 이상 신호 (Beta)" }
    ]
  }
];

export function PriceConditionPanel({ symbols, marketItems, onOpenCompany }: PriceConditionPanelProps) {
  const {
    preferences,
    canUse: canUseNotificationPreferences,
    loading: notificationLoading,
    error: notificationError,
    savingKeys,
    updateSetting,
    updateThreshold,
    updateCompanyOverride
  } = useNotificationPreferences();
  const [activeTab, setActiveTab] = useState<PanelTab>("watchlist");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<ChartSymbolDto[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setWatchlistLoading(true);
    setWatchlistError(null);
    void fetchWatchlist(controller.signal)
      .then((payload) => setWatchlistSymbols(payload.symbols))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setWatchlistSymbols([]);
          setWatchlistError(caught instanceof Error ? caught.message : "관심 기업을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setWatchlistLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const companies = useMemo(
    () => watchlistSymbols.map((item) => mergeCompany(item, symbols)),
    [symbols, watchlistSymbols]
  );
  const changePercentBySymbol = useMemo(
    () => new Map(marketItems.map((item) => [item.symbol.toUpperCase(), item.changePercent])),
    [marketItems]
  );

  const selectTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
  }, []);

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

  const masterSaving = savingKeys.has("setting:master");

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
        className="alerts-watchlist-tab-panel"
        role="tabpanel"
        aria-labelledby="alerts-watchlist-alerts-tab"
        hidden={activeTab !== "alerts"}
      >
        <div className="notification-category-list">
          <NotificationRow
            label="전체 알림"
            checked={preferences.settings.master}
            disabled={!canUseNotificationPreferences || notificationLoading || masterSaving}
            status={notificationStatus(
              preferences.settings.master,
              masterSaving,
              canUseNotificationPreferences
            )}
            onToggle={(enabled) => void updateSetting("master", enabled)}
            emphasized
          />

          {notificationSections.map((section) => (
            <section key={section.id} className="notification-settings-section" aria-labelledby={`notification-section-${section.id}`}>
              <h3 id={`notification-section-${section.id}`}>{section.label}</h3>
              {section.settings.map((setting) => {
                const checked = preferences.settings[setting.key];
                const saving = savingKeys.has(`setting:${setting.key}`);
                const thresholdSaving = setting.threshold
                  ? savingKeys.has(`threshold:${setting.threshold}`)
                  : false;
                return (
                  <NotificationRow
                    key={setting.key}
                    label={setting.label}
                    checked={checked}
                    disabled={
                      !canUseNotificationPreferences
                      || notificationLoading
                      || !preferences.settings.master
                      || saving
                    }
                    status={notificationStatus(checked, saving, canUseNotificationPreferences)}
                    onToggle={(enabled) => void updateSetting(setting.key, enabled)}
                    threshold={setting.threshold ? {
                      key: setting.threshold,
                      value: preferences.thresholds[setting.threshold],
                      disabled: (
                        !canUseNotificationPreferences
                        || notificationLoading
                        || !preferences.settings.master
                        || !checked
                        || thresholdSaving
                      ),
                      onSelect: (value) => void updateThreshold(setting.threshold!, value)
                    } : undefined}
                  />
                );
              })}
            </section>
          ))}
        </div>

        {notificationError && (
          <div className="alerts-watchlist-state is-error" role="alert">{notificationError}</div>
        )}
      </section>

      <section
        id="alerts-watchlist-watchlist-panel"
        className="alerts-watchlist-tab-panel"
        role="tabpanel"
        aria-labelledby="alerts-watchlist-watchlist-tab"
        hidden={activeTab !== "watchlist"}
      >
        {watchlistLoading ? (
          <div className="alerts-watchlist-state" role="status">관심 기업을 불러오는 중입니다.</div>
        ) : watchlistError ? (
          <div className="alerts-watchlist-state is-error" role="alert">{watchlistError}</div>
        ) : companies.length === 0 ? (
          <div className="alerts-watchlist-state" role="status">아직 관심 기업이 없습니다.</div>
        ) : (
          <div className="alerts-watchlist-company-list" role="list" aria-label="관심 기업 목록">
            {companies.map((company) => {
              const symbol = company.symbol.toUpperCase();
              const changePercent = changePercentBySymbol.get(symbol);
              const changeLabel = formatSignedPercent(changePercent);
              const companyNotificationsEnabled = preferences.companyOverrides[symbol] !== false;
              const companySaving = savingKeys.has(`company:${symbol}`);
              return (
                <div
                  key={company.symbol}
                  className="alerts-watchlist-company-row"
                  role="listitem"
                >
                  <button
                    type="button"
                    className="alerts-watchlist-company-open"
                    aria-label={`${company.name}, ${sectorLabelKo(company.sector)}, 추적 중, ${changeLabel}`}
                    onClick={() => onOpenCompany(company.symbol)}
                  >
                    <StockLogo
                      symbol={company.symbol}
                      companyName={company.name}
                      size="xs"
                      className="alerts-watchlist-company-logo"
                    />
                    <span className="alerts-watchlist-company-copy">
                      <strong>{company.name}</strong>
                      <small>{sectorLabelKo(company.sector)}</small>
                    </span>
                    <span className="alerts-watchlist-company-change">
                      <span aria-hidden="true" />
                      {changeLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`alerts-watchlist-switch is-company ${companyNotificationsEnabled ? "is-on" : ""}`}
                    role="switch"
                    aria-checked={companyNotificationsEnabled}
                    aria-label={`${company.name} 알림 ${companyNotificationsEnabled ? "끄기" : "켜기"}`}
                    title={companyNotificationsEnabled ? "이 기업 알림 끄기" : "이 기업 알림 켜기"}
                    disabled={!canUseNotificationPreferences || notificationLoading || companySaving}
                    onClick={() => void updateCompanyOverride(symbol, !companyNotificationsEnabled)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function NotificationRow({
  label,
  checked,
  disabled,
  status,
  onToggle,
  emphasized = false,
  threshold
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  status: string;
  onToggle: (enabled: boolean) => void;
  emphasized?: boolean;
  threshold?: {
    key: NotificationThresholdKey;
    value: NotificationThresholds[NotificationThresholdKey];
    disabled: boolean;
    onSelect: (value: NotificationThresholds[NotificationThresholdKey]) => void;
  };
}) {
  return (
    <div className={`notification-setting-item ${emphasized ? "is-emphasized" : ""}`}>
      <div className="notification-category-row">
        <strong>{label}</strong>
        <span className="notification-category-control">
          <small>{status}</small>
          <button
            type="button"
            className={`alerts-watchlist-switch ${checked ? "is-on" : ""}`}
            role="switch"
            aria-checked={checked}
            aria-label={`${label} ${checked ? "끄기" : "켜기"}`}
            disabled={disabled}
            onClick={() => onToggle(!checked)}
          >
            <span aria-hidden="true" />
          </button>
        </span>
      </div>
      {threshold && (
        <div className="notification-threshold-chips" aria-label={`${label} 기준`}>
          {notificationThresholdValues[threshold.key].map((value) => (
            <button
              key={value}
              type="button"
              className={threshold.value === value ? "is-selected" : ""}
              aria-pressed={threshold.value === value}
              disabled={threshold.disabled}
              onClick={() => threshold.onSelect(value)}
            >
              {thresholdLabel(threshold.key, value)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function thresholdLabel(key: NotificationThresholdKey, value: number): string {
  return key === "rapidMovePct" ? `${value}%` : `${value}배`;
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

function notificationStatus(checked: boolean, saving: boolean, canUse: boolean): string {
  if (!canUse) return "로그인 필요";
  if (saving) return "저장 중";
  return checked ? "ON" : "OFF";
}

function formatSignedPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
