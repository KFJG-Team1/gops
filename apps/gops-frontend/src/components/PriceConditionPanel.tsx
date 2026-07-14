import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  useNotificationPreferences,
  type NotificationSettingKey
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

type NotificationCategory = {
  id: string;
  label: string;
  settingKeys: ReadonlyArray<Exclude<NotificationSettingKey, "master">>;
};

const panelTabs: Array<{ id: PanelTab; label: string }> = [
  { id: "alerts", label: "알림" },
  { id: "watchlist", label: "관심 기업" }
];

const notificationCategories: NotificationCategory[] = [
  {
    id: "market-time",
    label: "거래 시간",
    settingKeys: ["marketOpen", "marketClose", "extendedHoursMove"]
  },
  {
    id: "price-market",
    label: "가격·시장",
    settingKeys: ["targetPrice", "rapidMove", "volumeSpike"]
  },
  {
    id: "company-event",
    label: "기업 이벤트",
    settingKeys: ["watchlistNews", "earningsFiling", "executiveChange"]
  },
  {
    id: "social-risk",
    label: "사회·리스크",
    settingKeys: ["socialIssue", "regulationLegal", "supplyChainMacro"]
  }
];

export function PriceConditionPanel({ symbols, marketItems, onOpenCompany }: PriceConditionPanelProps) {
  const {
    preferences,
    canUse: canUseNotificationPreferences,
    loading: notificationLoading,
    error: notificationError,
    savingKeys,
    updateSetting
  } = useNotificationPreferences();
  const [activeTab, setActiveTab] = useState<PanelTab>("watchlist");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<ChartSymbolDto[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [updatingCategories, setUpdatingCategories] = useState<Set<string>>(() => new Set());

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

  const toggleCategory = useCallback(async (category: NotificationCategory, enabled: boolean) => {
    if (updatingCategories.has(category.id)) return;
    setUpdatingCategories((current) => new Set(current).add(category.id));
    try {
      for (const key of category.settingKeys) {
        if (preferences.settings[key] !== enabled) {
          await updateSetting(key, enabled);
        }
      }
    } finally {
      setUpdatingCategories((current) => {
        const next = new Set(current);
        next.delete(category.id);
        return next;
      });
    }
  }, [preferences.settings, updateSetting, updatingCategories]);

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

          {notificationCategories.map((category) => {
            const checked = category.settingKeys.every((key) => preferences.settings[key]);
            const saving = updatingCategories.has(category.id)
              || category.settingKeys.some((key) => savingKeys.has(`setting:${key}`));
            return (
              <NotificationRow
                key={category.id}
                label={category.label}
                checked={checked}
                disabled={
                  !canUseNotificationPreferences
                  || notificationLoading
                  || !preferences.settings.master
                  || saving
                }
                status={saving ? "저장 중" : checked ? "ON" : "OFF"}
                onToggle={(enabled) => void toggleCategory(category, enabled)}
              />
            );
          })}
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
              const changePercent = changePercentBySymbol.get(company.symbol.toUpperCase());
              const changeLabel = formatSignedPercent(changePercent);
              return (
                <button
                  key={company.symbol}
                  type="button"
                  className="alerts-watchlist-company-row"
                  role="listitem"
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
  emphasized = false
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  status: string;
  onToggle: (enabled: boolean) => void;
  emphasized?: boolean;
}) {
  return (
    <div className={`notification-category-row ${emphasized ? "is-emphasized" : ""}`}>
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
  );
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
