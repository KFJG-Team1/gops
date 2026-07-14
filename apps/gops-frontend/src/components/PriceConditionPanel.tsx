import { Bell, CheckCircle2, ChevronDown, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  readyNotificationSettingKeys,
  useNotificationPreferences,
  type NotificationSettingKey,
  type NotificationSettings
} from "../alerts/notificationPreferences";
import type { ChartSymbolDto } from "../chart/types";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { fetchWatchlist, replaceWatchlistSymbols } from "../chart/watchlistApi";
import { sectorLabelKo } from "../market/sectors";
import {
  createPriceCondition,
  deletePriceCondition,
  fetchPriceConditions,
  subscribeTradeConditionsChanged,
  updatePriceCondition,
  type PriceCondition,
  type PriceConditionDirection,
  type PriceConditionSide,
  type PriceConditionStatus
} from "../priceCondition/priceConditionApi";
import { LogoDevAttribution, StockLogo } from "./StockLogo";
import { SymbolSearch } from "./SymbolSearch";
import { NotificationCenterPanel } from "./NotificationCenterPanel";

const statusLabels: Record<PriceConditionStatus, string> = {
  watching: "감시 중",
  triggered: "확인 필요",
  paused: "중지"
};

type PriceConditionDraft = {
  symbol: string;
  side: PriceConditionSide;
  direction: PriceConditionDirection;
  triggerPrice: string;
  limitPrice: string;
  quantity: string;
  validity: string;
};

type PriceConditionPanelProps = {
  defaultSymbol?: string;
  symbols: ChartSymbolDto[];
  marketItems?: Sp500UniverseItem[];
  onOpenCompany: (symbol: string) => void;
  view?: "account" | "settings";
};

type HubTab = "price" | "alerts" | "watchlist";

type PrototypeNotificationSetting = NotificationSettingKey;
type PrototypeNotificationSettings = NotificationSettings;

const settingsHubTabs: Array<{ id: HubTab; label: string }> = [
  { id: "alerts", label: "알림" },
  { id: "watchlist", label: "관심 기업" }
];

const notificationGroups: Array<{
  title: string;
  description: string;
  items: Array<{ key: Exclude<PrototypeNotificationSetting, "master">; label: string; description: string }>;
}> = [
  {
    title: "거래 시간",
    description: "미국 시장의 시작·마감과 시간외 움직임을 알려드립니다.",
    items: [
      { key: "marketOpen", label: "본장 시작", description: "정규장이 시작되면 알려드려요." },
      { key: "marketClose", label: "본장 마감", description: "정규장 마감과 오늘의 변화를 요약해요." },
      { key: "extendedHoursMove", label: "시간외 급변", description: "프리마켓·애프터마켓 급변을 감지해요." }
    ]
  },
  {
    title: "가격·시장",
    description: "등록한 가격과 평소보다 큰 시장 움직임을 감시합니다.",
    items: [
      { key: "targetPrice", label: "목표가 도달", description: "설정한 목표 가격에 도달하면 알려드려요." },
      { key: "rapidMove", label: "급등락", description: "짧은 시간에 큰 가격 변화가 발생하면 알려드려요." },
      { key: "volumeSpike", label: "거래량 급증", description: "평균보다 거래량이 빠르게 늘어날 때 알려드려요." }
    ]
  },
  {
    title: "기업 이벤트",
    description: "관심 기업의 뉴스와 주요 경영 이벤트를 모니터링합니다.",
    items: [
      { key: "earnings", label: "관심기업 뉴스", description: "관심 기업과 직접 관련된 새 뉴스를 알려드려요." },
      { key: "earnings", label: "실적·공시", description: "실적 발표와 중요 공시가 나오면 알려드려요." },
      { key: "socialIssue", label: "경영진 변화", description: "대표·핵심 임원의 변동을 감지해요." }
    ]
  },
  {
    title: "사회·리스크",
    description: "기업 가치에 영향을 줄 수 있는 비가격 위험을 감지합니다.",
    items: [
      { key: "socialIssue", label: "사회적 논란", description: "여론 악화나 사회적 이슈 발생을 알려드려요." },
      { key: "socialIssue", label: "규제·소송", description: "정부 규제, 조사, 소송 위험을 감지해요." },
      { key: "marketVolatility", label: "공급망·거시 충격", description: "공급 차질과 거시 환경 변화를 알려드려요." }
    ]
  }
];

function initialConditionDraft(symbol: string): PriceConditionDraft {
  return {
    symbol: symbol.toUpperCase(),
    side: "buy",
    direction: "atOrBelow",
    triggerPrice: "",
    limitPrice: "",
    quantity: "1",
    validity: "당일"
  };
}

export function PriceConditionPanel(props: PriceConditionPanelProps) {
  const defaultSymbol = props.defaultSymbol ?? props.symbols[0]?.symbol ?? "AAPL";
  if ((props.view ?? "settings") === "settings") {
    return (
      <NotificationCenterPanel
        symbols={props.symbols}
        marketItems={props.marketItems ?? []}
        onOpenCompany={props.onOpenCompany}
      />
    );
  }
  return (
    <AccountPriceConditionPanel
      defaultSymbol={defaultSymbol}
      symbols={props.symbols}
      onOpenCompany={props.onOpenCompany}
      view="account"
    />
  );
}

function AccountPriceConditionPanel({
  defaultSymbol = "AAPL",
  symbols,
  onOpenCompany,
  view = "account"
}: PriceConditionPanelProps) {
  const {
    preferences: notificationPreferences,
    canUse: canUseNotificationPreferences,
    loading: notificationPreferencesLoading,
    error: notificationPreferencesError,
    savingKeys: notificationPreferenceSavingKeys,
    updateSetting: updateNotificationSetting,
    updateCompanyOverride
  } = useNotificationPreferences();
  const [initialWatchlist] = useState(() => initialPrototypeWatchlist(symbols, defaultSymbol));
  const [activeHubTab, setActiveHubTab] = useState<HubTab>(() => view === "account" ? "price" : "alerts");
  const accountViewRef = useRef<HTMLElement | null>(null);
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [conditions, setConditions] = useState<PriceCondition[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [draft, setDraft] = useState<PriceConditionDraft>(() => initialConditionDraft(defaultSymbol));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(initialWatchlist);
  const [selectedCompanySymbol, setSelectedCompanySymbol] = useState(initialWatchlist[0] ?? defaultSymbol.toUpperCase());
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [watchlistPersisted, setWatchlistPersisted] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const loadConditions = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchPriceConditions(signal);
      setConditions(next);
      setError(null);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "가격 조건을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "account") {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    void loadConditions(controller.signal);
    const unsubscribe = subscribeTradeConditionsChanged(() => void loadConditions());
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [loadConditions, view]);

  useEffect(() => {
    if (view !== "settings") {
      setWatchlistLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setWatchlistLoading(true);
    setWatchlistError(null);
    void fetchWatchlist(controller.signal)
      .then((payload) => {
        const nextSymbols = payload.symbols.map((item) => item.symbol.toUpperCase());
        setWatchlistSymbols(nextSymbols);
        setWatchlistPersisted(payload.persisted);
        setSelectedCompanySymbol((current) => (
          nextSymbols.includes(current) ? current : nextSymbols[0] ?? defaultSymbol.toUpperCase()
        ));
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setWatchlistError(caught instanceof Error ? caught.message : "관심 기업을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setWatchlistLoading(false);
        }
      });
    return () => controller.abort();
  }, [defaultSymbol, view]);

  useEffect(() => {
    if (!builderOpen) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBuilderOpen(false);
      }
    };
    window.document.addEventListener("keydown", closeOnEscape);
    return () => window.document.removeEventListener("keydown", closeOnEscape);
  }, [builderOpen]);

  const statusCounts = useMemo(() => conditions.reduce<Record<PriceConditionStatus, number>>(
    (counts, condition) => ({ ...counts, [condition.status]: counts[condition.status] + 1 }),
    { watching: 0, triggered: 0, paused: 0 }
  ), [conditions]);
  const normalizedDraftSymbol = draft.symbol.trim().toUpperCase();
  const numericDraftTriggerPrice = Number(draft.triggerPrice);
  const numericDraftLimitPrice = Number(draft.limitPrice);
  const numericDraftQuantity = Number(draft.quantity);
  const draftValid = useMemo(() => (
    /^[A-Z0-9.-]{1,10}$/.test(normalizedDraftSymbol)
    && Number.isFinite(numericDraftTriggerPrice)
    && numericDraftTriggerPrice > 0
    && Number.isFinite(numericDraftLimitPrice)
    && numericDraftLimitPrice > 0
    && Number.isInteger(numericDraftQuantity)
    && numericDraftQuantity > 0
  ), [normalizedDraftSymbol, numericDraftLimitPrice, numericDraftQuantity, numericDraftTriggerPrice]);
  const selectedCompany = useMemo(
    () => companyForSymbol(symbols, selectedCompanySymbol),
    [selectedCompanySymbol, symbols]
  );
  const panelLabel = view === "account" ? "가상계좌 가격 조건" : "알림 및 관심 기업 패널";

  const selectHubTab = (nextTab: HubTab) => {
    setActiveHubTab(nextTab);
    setBuilderOpen(false);
    setPendingDeleteId(null);
    setReviewingId(null);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? settingsHubTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + settingsHubTabs.length) % settingsHubTabs.length;
    const nextTab = settingsHubTabs[nextIndex];
    if (!nextTab) return;
    selectHubTab(nextTab.id);
    tabButtonRefs.current[nextIndex]?.focus();
  };

  const toggleNotificationSetting = (key: PrototypeNotificationSetting) => {
    if (!canUseNotificationPreferences || notificationPreferenceSavingKeys.has(`setting:${key}`)) {
      return;
    }
    void updateNotificationSetting(key, !notificationPreferences.settings[key]);
  };

  const addWatchlistSymbol = async (symbolValue: string) => {
    const normalizedSymbol = symbolValue.toUpperCase();
    if (watchlistSaving || watchlistSymbols.includes(normalizedSymbol)) {
      return;
    }
    const previous = watchlistSymbols;
    const optimistic = [...previous, normalizedSymbol];
    setWatchlistSymbols(optimistic);
    setWatchlistSaving(true);
    setWatchlistError(null);
    try {
      const payload = await replaceWatchlistSymbols(optimistic);
      setWatchlistSymbols(payload.symbols.map((item) => item.symbol.toUpperCase()));
      setWatchlistPersisted(payload.persisted);
    } catch (caught: unknown) {
      setWatchlistSymbols(previous);
      setWatchlistError(caught instanceof Error ? caught.message : "관심 기업을 저장하지 못했습니다.");
    } finally {
      setWatchlistSaving(false);
    }
  };

  const toggleCompanyAlert = (symbolValue: string) => {
    const normalizedSymbol = symbolValue.toUpperCase();
    if (!canUseNotificationPreferences || notificationPreferenceSavingKeys.has(`company:${normalizedSymbol}`)) {
      return;
    }
    void updateCompanyOverride(
      normalizedSymbol,
      notificationPreferences.companyOverrides[normalizedSymbol] === false
    );
  };

  const toggleExpanded = (conditionId: string) => {
    setExpandedId((current) => current === conditionId ? null : conditionId);
    setPendingDeleteId(null);
    setReviewingId(null);
  };

  const toggleAlert = async (conditionId: string) => {
    const condition = conditions.find((item) => item.id === conditionId);
    if (!condition) return;
    try {
      const updated = await updatePriceCondition(conditionId, { alertsEnabled: !condition.alertsEnabled });
      setConditions((current) => current.map((item) => item.id === conditionId ? updated : item));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "알림 설정을 변경하지 못했습니다.");
    }
  };

  const toggleStatus = async (conditionId: string) => {
    const condition = conditions.find((item) => item.id === conditionId);
    if (!condition) return;
    try {
      const updated = await updatePriceCondition(conditionId, {
        status: condition.status === "paused" ? "watching" : "paused"
      });
      setConditions((current) => current.map((item) => item.id === conditionId ? updated : item));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "감시 상태를 변경하지 못했습니다.");
    }
  };

  const requestDelete = (conditionId: string) => {
    setExpandedId(conditionId);
    setPendingDeleteId(conditionId);
    setReviewingId(null);
  };

  const deleteCondition = async (conditionId: string) => {
    try {
      await deletePriceCondition(conditionId);
      setConditions((current) => current.filter((condition) => condition.id !== conditionId));
      setExpandedId((current) => current === conditionId ? null : current);
      setPendingDeleteId(null);
      setReviewingId(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가격 조건을 삭제하지 못했습니다.");
    }
  };

  const openConditionBuilder = () => {
    accountViewRef.current?.closest(".paper-account-body")?.scrollTo({ left: 0 });
    setDraft(initialConditionDraft(defaultSymbol));
    setBuilderOpen(true);
    setPendingDeleteId(null);
    setReviewingId(null);
  };

  const addCondition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftValid || submitting) return;
    setSubmitting(true);
    try {
      const condition = await createPriceCondition({
        symbol: normalizedDraftSymbol,
        side: draft.side,
        direction: draft.direction,
        triggerPrice: numericDraftTriggerPrice,
        limitPrice: numericDraftLimitPrice,
        quantity: numericDraftQuantity,
        validity: draft.validity,
        alertsEnabled: true,
        executionEnabled: true
      });
      setConditions((current) => [condition, ...current.filter((item) => item.id !== condition.id)]);
      setExpandedId(condition.id);
      setBuilderOpen(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가격 조건을 추가하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "account") {
    return (
      <section ref={accountViewRef} className="paper-reservation-panel" aria-label={panelLabel}>
        {builderOpen && (
          <div className="paper-reservation-builder-backdrop">
            <form className="paper-reservation-builder" aria-label="예약 매매 조건 추가" onSubmit={addCondition}>
              <header>
                <div>
                  <strong>예약 매매 조건 추가</strong>
                  <span>가격 도달 시 제출할 지정가 주문을 설정합니다.</span>
                </div>
                <button type="button" aria-label="예약 매매 조건 추가 닫기" onClick={() => setBuilderOpen(false)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="paper-reservation-builder-grid">
                <label className="paper-reservation-builder-field">
                  <span>종목</span>
                  <input
                    type="text"
                    maxLength={10}
                    autoComplete="off"
                    value={draft.symbol}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      symbol: event.target.value.toUpperCase()
                    }))}
                  />
                </label>

                <div className="paper-reservation-builder-field">
                  <span>구분</span>
                  <div className="paper-reservation-side-options" aria-label="매수 또는 매도 선택">
                    <button
                      type="button"
                      className={draft.side === "buy" ? "is-buy is-selected" : "is-buy"}
                      aria-pressed={draft.side === "buy"}
                      onClick={() => setDraft((current) => ({ ...current, side: "buy" }))}
                    >
                      매수
                    </button>
                    <button
                      type="button"
                      className={draft.side === "sell" ? "is-sell is-selected" : "is-sell"}
                      aria-pressed={draft.side === "sell"}
                      onClick={() => setDraft((current) => ({ ...current, side: "sell" }))}
                    >
                      매도
                    </button>
                  </div>
                </div>

                <label className="paper-reservation-builder-field">
                  <span>발동 조건</span>
                  <select
                    value={draft.direction}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      direction: event.target.value as PriceConditionDirection
                    }))}
                  >
                    <option value="atOrBelow">가격 이하 도달</option>
                    <option value="atOrAbove">가격 이상 도달</option>
                  </select>
                </label>

                <label className="paper-reservation-builder-field">
                  <span>발동 가격</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.triggerPrice}
                    onChange={(event) => setDraft((current) => ({ ...current, triggerPrice: event.target.value }))}
                  />
                </label>

                <label className="paper-reservation-builder-field">
                  <span>지정 가격</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.limitPrice}
                    onChange={(event) => setDraft((current) => ({ ...current, limitPrice: event.target.value }))}
                  />
                </label>

                <label className="paper-reservation-builder-field">
                  <span>수량</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={draft.quantity}
                    onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}
                  />
                </label>

                <label className="paper-reservation-builder-field">
                  <span>유효기간</span>
                  <select
                    value={draft.validity}
                    onChange={(event) => setDraft((current) => ({ ...current, validity: event.target.value }))}
                  >
                    <option value="당일">당일</option>
                    <option value="직접 취소 전">직접 취소 전</option>
                  </select>
                </label>
              </div>

              <footer>
                <button type="button" onClick={() => setBuilderOpen(false)}>취소</button>
                <button type="submit" className="is-primary" disabled={!draftValid || submitting}>
                  {submitting ? "등록 중" : "조건 추가"}
                </button>
              </footer>
            </form>
          </div>
        )}

        {error && <div className="paper-reservation-message is-error" role="alert">{error}</div>}

        {loading ? (
          <div className="paper-reservation-message" role="status">예약 매매 조건을 불러오는 중입니다.</div>
        ) : conditions.length > 0 ? (
          <div className="paper-reservation-table">
            <div className="paper-reservation-table-head" aria-hidden="true">
              <span>종목</span>
              <span>구분</span>
              <span>유효기간</span>
              <span>지정가</span>
              <span>수량</span>
              <span>관리</span>
            </div>
            <div className="paper-reservation-table-body" role="list" aria-label="예약 매매 조건 목록">
              {conditions.map((condition) => {
                const expanded = expandedId === condition.id;
                const deletePending = pendingDeleteId === condition.id;
                const reviewing = reviewingId === condition.id;
                const detailId = `paper-reservation-detail-${condition.id}`;
                const sideLabel = condition.side === "buy" ? "매수" : "매도";
                const directionOperator = condition.direction === "atOrBelow" ? "<=" : ">=";
                return (
                  <article
                    key={condition.id}
                    className={`paper-reservation-row ${expanded ? "is-expanded" : ""}`}
                    data-status={condition.status}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${condition.symbol} 예약 매매 상세 ${expanded ? "닫기" : "열기"}`}
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => toggleExpanded(condition.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpanded(condition.id);
                      }
                    }}
                  >
                    <div className="paper-reservation-instrument">
                      <strong>{condition.symbol}</strong>
                    </div>
                    <div className={`paper-reservation-side is-${condition.side}`}>
                      <strong>{sideLabel}</strong>
                    </div>
                    <div className="paper-reservation-validity">
                      <strong>{condition.validity}</strong>
                    </div>
                    <div className="paper-reservation-order">
                      <strong>US${formatPrice(condition.limitPrice)}</strong>
                    </div>
                    <div className="paper-reservation-quantity">
                      <strong>{condition.quantity}주</strong>
                    </div>
                    <div className="paper-reservation-actions" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className={`paper-reservation-icon-button ${condition.alertsEnabled ? "is-active" : ""}`}
                        aria-label={`${condition.symbol} 가격 조건 알림 ${condition.alertsEnabled ? "끄기" : "켜기"}`}
                        aria-pressed={condition.alertsEnabled}
                        title={`알림 ${condition.alertsEnabled ? "끄기" : "켜기"}`}
                        onClick={() => void toggleAlert(condition.id)}
                      >
                        <Bell size={15} fill={condition.alertsEnabled ? "currentColor" : "none"} aria-hidden="true" />
                      </button>
                      {condition.status === "triggered" ? (
                        <button
                          type="button"
                          className="paper-reservation-icon-button is-triggered"
                          aria-label={`${condition.symbol} 예약 주문 상태 보기`}
                          aria-pressed={reviewing}
                          title="주문 상태 보기"
                          onClick={() => {
                            setExpandedId(condition.id);
                            setPendingDeleteId(null);
                            setReviewingId((current) => current === condition.id ? null : condition.id);
                          }}
                        >
                          <CheckCircle2 size={15} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`paper-reservation-icon-button is-${condition.status}`}
                          aria-label={`${condition.symbol} ${condition.status === "paused" ? "감시 재개" : "감시 중지"}`}
                          title={condition.status === "paused" ? "감시 재개" : "감시 중지"}
                          onClick={() => void toggleStatus(condition.id)}
                        >
                          {condition.status === "paused"
                            ? <Play size={15} aria-hidden="true" />
                            : <Pause size={15} aria-hidden="true" />}
                        </button>
                      )}
                      <button
                        type="button"
                        className="paper-reservation-icon-button is-delete"
                        aria-label={`${condition.symbol} 가격 조건 삭제`}
                        title="삭제"
                        onClick={() => requestDelete(condition.id)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>

                    {expanded && (
                      <div className="paper-reservation-detail" id={detailId} onClick={(event) => event.stopPropagation()}>
                        <div className="paper-reservation-detail-grid">
                          <ReservationDetail label="발동 조건" value={`현재가 ${directionOperator} US$${formatPrice(condition.triggerPrice)}`} />
                        </div>

                        {reviewing && (
                          <div className="paper-reservation-review" role="status">
                            <span>예약 주문 처리 상태</span>
                            <strong>{condition.orderId ? `주문번호 ${condition.orderId}` : condition.errorReason ?? condition.lastChecked}</strong>
                          </div>
                        )}

                        {deletePending && (
                          <div
                            className="paper-reservation-delete-confirm"
                            role="alertdialog"
                            aria-labelledby={`paper-reservation-delete-title-${condition.id}`}
                          >
                            <div>
                              <strong id={`paper-reservation-delete-title-${condition.id}`}>{condition.symbol} 예약 매매를 삭제할까요?</strong>
                              <span>가격 감시와 예약 주문 조건이 함께 해제됩니다.</span>
                            </div>
                            <div>
                              <button type="button" onClick={() => setPendingDeleteId(null)}>취소</button>
                              <button type="button" className="is-danger" onClick={() => void deleteCondition(condition.id)}>삭제</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="paper-reservation-add-row">
              <button type="button" className="paper-reservation-add-button" onClick={openConditionBuilder}>
                <Plus size={15} aria-hidden="true" />
                조건 추가
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="paper-reservation-message" role="status">
              등록된 예약 매매 조건이 없습니다.
            </div>
            <div className="paper-reservation-add-row">
              <button type="button" className="paper-reservation-add-button" onClick={openConditionBuilder}>
                <Plus size={15} aria-hidden="true" />
                조건 추가
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section
      className="auto-trade-panel price-condition-hub is-settings-view"
      aria-label={panelLabel}
    >
      {view === "settings" && <header className="price-condition-hub-tabs" role="tablist" aria-label="알림 설정 패널 메뉴">
        {settingsHubTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabButtonRefs.current[index] = element; }}
            id={`price-condition-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeHubTab === tab.id}
            aria-controls={`price-condition-${tab.id}-panel`}
            tabIndex={activeHubTab === tab.id ? 0 : -1}
            className={activeHubTab === tab.id ? "is-active" : ""}
            onClick={() => selectHubTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </header>}

      {activeHubTab === "price" && (
        <div
          id="price-condition-price-panel"
          className="price-condition-tab-panel is-price-tab"
          role="tabpanel"
          aria-labelledby="price-condition-price-tab"
        >
      <header className="auto-trade-overview">
        <div className="auto-trade-overview-copy">
          <div className="auto-trade-mode-badges" aria-label="가격 조건 동작 모드">
            <span>PRICE CONDITION</span>
            <span>SERVER SYNC</span>
          </div>
          <p>가격 조건을 감시하고 충족 시 리스크 확인 후 예약 주문을 제출합니다.</p>
        </div>
        <div className="auto-trade-overview-actions">
          <button type="button" className="auto-trade-add-button" onClick={openConditionBuilder}>
            <Plus size={13} aria-hidden="true" />
            조건 추가
          </button>
          <dl className="auto-trade-status-counts" aria-label="가격 조건 상태 요약">
            <div className="is-watching"><dt>감시</dt><dd>{statusCounts.watching}</dd></div>
            <div className="is-triggered"><dt>충족</dt><dd>{statusCounts.triggered}</dd></div>
            <div className="is-paused"><dt>중지</dt><dd>{statusCounts.paused}</dd></div>
          </dl>
        </div>
      </header>

      {builderOpen && (
        <div className="auto-trade-panel-builder-backdrop">
          <form className="auto-trade-panel-builder" aria-label="가격 조건 직접 추가" onSubmit={addCondition}>
            <header>
              <div>
                <span>NEW PRICE CONDITION</span>
                <strong>가격 조건 직접 추가</strong>
              </div>
              <button type="button" aria-label="가격 조건 직접 추가 닫기" onClick={() => setBuilderOpen(false)}>
                <X size={15} aria-hidden="true" />
              </button>
            </header>

            <label className="auto-trade-panel-builder-symbol">
              <span>종목</span>
              <input
                type="text"
                maxLength={10}
                value={draft.symbol}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  symbol: event.target.value.toUpperCase()
                }))}
              />
            </label>

            <div className="chart-price-condition-side" aria-label="매수 또는 매도 선택">
              <button
                type="button"
                className={draft.side === "buy" ? "is-buy is-selected" : "is-buy"}
                aria-pressed={draft.side === "buy"}
                onClick={() => setDraft((current) => ({ ...current, side: "buy" }))}
              >
                매수
              </button>
              <button
                type="button"
                className={draft.side === "sell" ? "is-sell is-selected" : "is-sell"}
                aria-pressed={draft.side === "sell"}
                onClick={() => setDraft((current) => ({ ...current, side: "sell" }))}
              >
                매도
              </button>
            </div>

            <div className="chart-price-condition-form-grid">
              <label>
                <span>발동 조건</span>
                <select
                  value={draft.direction}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    direction: event.target.value as PriceConditionDirection
                  }))}
                >
                  <option value="atOrBelow">가격 이하 도달</option>
                  <option value="atOrAbove">가격 이상 도달</option>
                </select>
              </label>
              <label>
                <span>발동 가격</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.triggerPrice}
                  onChange={(event) => setDraft((current) => ({ ...current, triggerPrice: event.target.value }))}
                />
              </label>
              <label>
                <span>주문 방식</span>
                <select value="limit" disabled>
                  <option value="limit">지정가</option>
                </select>
              </label>
              <label>
                <span>지정 가격</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.limitPrice}
                  onChange={(event) => setDraft((current) => ({ ...current, limitPrice: event.target.value }))}
                />
              </label>
              <label>
                <span>수량</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={draft.quantity}
                  onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}
                />
              </label>
              <label>
                <span>유효기간</span>
                <select
                  value={draft.validity}
                  onChange={(event) => setDraft((current) => ({ ...current, validity: event.target.value }))}
                >
                  <option value="당일">당일</option>
                  <option value="직접 취소 전">직접 취소 전</option>
                </select>
              </label>
            </div>

            <p className="chart-price-condition-warning">
              차트가 없어도 조건을 추가할 수 있습니다. 조건 충족 시 계좌와 리스크를 다시 확인한 뒤 예약 주문을 제출합니다.
            </p>

            <footer className="auto-trade-panel-builder-actions">
              <button type="button" onClick={() => setBuilderOpen(false)}>취소</button>
              <button type="submit" className="is-primary" disabled={!draftValid || submitting}>{submitting ? "등록 중" : "조건 추가"}</button>
            </footer>
          </form>
        </div>
      )}

      {error && <div className="auto-trade-empty is-error" role="alert"><span>{error}</span></div>}

      {loading ? (
        <div className="auto-trade-empty" role="status"><span>가격 조건을 불러오는 중입니다.</span></div>
      ) : conditions.length > 0 ? (
        <div className="auto-trade-strategy-list" role="list" aria-label="가격 조건 목록">
          {conditions.map((condition) => {
            const expanded = expandedId === condition.id;
            const deletePending = pendingDeleteId === condition.id;
            const reviewing = reviewingId === condition.id;
            const detailId = `price-condition-detail-${condition.id}`;
            const sideLabel = condition.side === "buy" ? "매수" : "매도";
            const directionLabel = condition.direction === "atOrBelow" ? "이하" : "이상";
            return (
              <article
                key={condition.id}
                className={`auto-trade-strategy ${expanded ? "is-expanded" : ""}`}
                data-status={condition.status}
                role="listitem"
              >
                <div className="auto-trade-strategy-bar">
                  <button
                    type="button"
                    className="auto-trade-strategy-main"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    onClick={() => toggleExpanded(condition.id)}
                  >
                    <span className="auto-trade-strategy-company">
                      <StockLogo symbol={condition.symbol} companyName={condition.companyName} size="sm" />
                      <span className="auto-trade-strategy-identity">
                        <span className={`auto-trade-status is-${condition.status}`}>
                          <i aria-hidden="true" />
                          {statusLabels[condition.status]}
                        </span>
                        <strong>{condition.symbol}</strong>
                        <small className={`auto-trade-side is-${condition.side}`}>{sideLabel} 조건</small>
                      </span>
                    </span>
                    <span className="auto-trade-strategy-conditions">
                      <span className="auto-trade-condition-time">{condition.marketHours} · {condition.validity}</span>
                      <strong>${formatPrice(condition.triggerPrice)} {directionLabel} 도달 시</strong>
                      <small>지정가 ${formatPrice(condition.limitPrice)} · {condition.quantity}주 · 리스크 확인 후 제출</small>
                    </span>
                    <ChevronDown className="auto-trade-expand-icon" size={16} aria-hidden="true" />
                  </button>
                  <div className="auto-trade-strategy-actions">
                    <button
                      type="button"
                      className={`auto-trade-icon-button auto-trade-alert-button ${condition.alertsEnabled ? "is-active" : ""}`}
                      aria-label={`${condition.symbol} 가격 조건 알림 ${condition.alertsEnabled ? "끄기" : "켜기"}`}
                      aria-pressed={condition.alertsEnabled}
                      title={`가격 조건 알림 ${condition.alertsEnabled ? "끄기" : "켜기"}`}
                      onClick={() => toggleAlert(condition.id)}
                    >
                      <Bell size={15} fill={condition.alertsEnabled ? "currentColor" : "none"} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="auto-trade-icon-button auto-trade-delete-button"
                      aria-label={`${condition.symbol} 가격 조건 삭제`}
                      title="가격 조건 삭제"
                      onClick={() => requestDelete(condition.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="auto-trade-strategy-detail" id={detailId}>
                    <div className="auto-trade-detail-grid">
                      <DetailItem label="발동 조건" value={`현재가가 $${formatPrice(condition.triggerPrice)} ${directionLabel}에 도달`} />
                      <DetailItem label="주문 초안" value={`${sideLabel} 지정가 $${formatPrice(condition.limitPrice)} · ${condition.quantity}주`} />
                      <DetailItem label="유효기간" value={condition.validity} />
                      <DetailItem label="감시 시간" value={condition.marketHours} />
                      <DetailItem label="최근 확인" value={condition.lastChecked} />
                    </div>
                    <div className="auto-trade-detail-footer">
                      <span>발동 가격과 실제 체결 가격은 다를 수 있습니다.</span>
                      {condition.status === "triggered" ? (
                        <button
                          type="button"
                          className="auto-trade-status-control is-triggered"
                          onClick={() => setReviewingId((current) => current === condition.id ? null : condition.id)}
                        >
                          <CheckCircle2 size={13} aria-hidden="true" />
                          주문 상태 보기
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`auto-trade-status-control is-${condition.status}`}
                          onClick={() => toggleStatus(condition.id)}
                        >
                          {condition.status === "paused"
                            ? <Play size={13} aria-hidden="true" />
                            : <Pause size={13} aria-hidden="true" />}
                          {condition.status === "paused" ? "감시 재개" : "감시 중지"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {reviewing && (
                  <div className="auto-trade-order-review" role="dialog" aria-label={`${condition.symbol} 예약 주문 상태`}>
                    <div>
                      <span>예약 주문 처리 상태</span>
                      <strong>{condition.symbol} {sideLabel} · {condition.quantity}주 · 지정가 ${formatPrice(condition.limitPrice)}</strong>
                      <small>{condition.orderId ? `주문번호 ${condition.orderId}` : condition.errorReason ?? condition.lastChecked}</small>
                    </div>
                    <div className="auto-trade-order-review-actions">
                      <button type="button" onClick={() => setReviewingId(null)}>닫기</button>
                    </div>
                  </div>
                )}

                {deletePending && (
                  <div
                    className="auto-trade-delete-confirm"
                    role="alertdialog"
                    aria-labelledby={`price-condition-delete-title-${condition.id}`}
                  >
                    <div>
                      <strong id={`price-condition-delete-title-${condition.id}`}>{condition.symbol} 가격 조건을 삭제할까요?</strong>
                      <span>등록된 가격 감시와 예약 주문 조건이 함께 해제됩니다.</span>
                    </div>
                    <div className="auto-trade-delete-confirm-actions">
                      <button type="button" onClick={() => setPendingDeleteId(null)}>
                        <X size={13} aria-hidden="true" />
                        취소
                      </button>
                      <button type="button" className="is-danger" onClick={() => deleteCondition(condition.id)}>
                        <Trash2 size={13} aria-hidden="true" />
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="auto-trade-empty" role="status">
          <strong>표시할 가격 조건이 없습니다.</strong>
          <span>상단 ‘조건 추가’ 버튼에서 새 조건을 만들 수 있습니다.</span>
        </div>
      )}

      <footer className="auto-trade-panel-footer">
        <span>조건은 계정에 저장되며 패널을 닫아도 가격 감시는 계속됩니다.</span>
        <LogoDevAttribution className="auto-trade-logo-attribution" />
      </footer>
        </div>
      )}

      {activeHubTab === "alerts" && (
        <NotificationSettingsView
          settings={notificationPreferences.settings}
          watchlistSymbols={watchlistSymbols}
          symbols={symbols}
          companyAlerts={notificationPreferences.companyOverrides}
          canUse={canUseNotificationPreferences}
          loading={notificationPreferencesLoading}
          error={notificationPreferencesError}
          savingKeys={notificationPreferenceSavingKeys}
          onToggleSetting={toggleNotificationSetting}
          onToggleCompanyAlert={toggleCompanyAlert}
        />
      )}

      {activeHubTab === "watchlist" && (
        <WatchlistSettingsView
          symbols={symbols}
          selectedCompany={selectedCompany}
          watchlistSymbols={watchlistSymbols}
          loading={watchlistLoading}
          saving={watchlistSaving}
          persisted={watchlistPersisted}
          error={watchlistError}
          onSelectCompany={setSelectedCompanySymbol}
          onAddWatchlist={(symbol) => void addWatchlistSymbol(symbol)}
          onOpenCompany={onOpenCompany}
        />
      )}
    </section>
  );
}

function NotificationSettingsView({
  settings,
  watchlistSymbols,
  symbols,
  companyAlerts,
  canUse,
  loading,
  error,
  savingKeys,
  onToggleSetting,
  onToggleCompanyAlert
}: {
  settings: PrototypeNotificationSettings;
  watchlistSymbols: string[];
  symbols: ChartSymbolDto[];
  companyAlerts: Record<string, boolean>;
  canUse: boolean;
  loading: boolean;
  error: string | null;
  savingKeys: ReadonlySet<string>;
  onToggleSetting: (key: PrototypeNotificationSetting) => void;
  onToggleCompanyAlert: (symbol: string) => void;
}) {
  return (
    <section
      id="price-condition-alerts-panel"
      className="price-condition-tab-panel is-settings-tab notification-settings-view"
      role="tabpanel"
      aria-labelledby="price-condition-alerts-tab"
    >
      <div className="prototype-settings-hero">
        <div>
          <span>NOTIFICATION CONTROL</span>
          <strong>알림 설정</strong>
          <p>시장 시간부터 기업 이슈까지, 받고 싶은 알림만 선택하세요.</p>
        </div>
        <PrototypeSwitch
          checked={settings.master}
          label="전체 알림"
          description={settings.master ? "모든 선택 알림을 수신합니다." : "현재 모든 알림이 중지되어 있습니다."}
          emphasized
          disabled={!canUse || loading || savingKeys.has("setting:master")}
          statusLabel={savingKeys.has("setting:master") ? "저장 중" : undefined}
          onToggle={() => onToggleSetting("master")}
        />
      </div>

      <div className={`prototype-settings-content ${settings.master ? "" : "is-master-off"}`}>
        <div className="prototype-settings-groups">
          {notificationGroups.map((group) => (
            <section key={group.title} className="prototype-settings-group">
              <header>
                <strong>{group.title}</strong>
                <span>{group.description}</span>
              </header>
              <div>
                {group.items.map((item) => (
                  <PrototypeSwitch
                    key={item.key}
                    checked={settings[item.key]}
                    label={item.label}
                    description={item.description}
                    disabled={
                      !canUse
                      || loading
                      || !settings.master
                      || !readyNotificationSettingKeys.has(item.key)
                      || savingKeys.has(`setting:${item.key}`)
                    }
                    statusLabel={
                      !readyNotificationSettingKeys.has(item.key)
                        ? "준비 중"
                        : savingKeys.has(`setting:${item.key}`)
                          ? "저장 중"
                          : undefined
                    }
                    onToggle={() => onToggleSetting(item.key)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="prototype-settings-group company-alert-scope">
          <header>
            <strong>관심기업별 알림</strong>
            <span>관심 기업마다 뉴스·이슈 알림을 따로 제어할 수 있습니다.</span>
          </header>
          <div>
            {watchlistSymbols.map((symbol) => {
              const company = companyForSymbol(symbols, symbol);
              return (
                <PrototypeSwitch
                  key={symbol}
                  checked={companyAlerts[symbol] !== false}
                  label={`${company.symbol} · ${company.name}`}
                  description="가격, 시장 움직임, 사회·리스크 이슈"
                  disabled={!canUse || loading || !settings.master || savingKeys.has(`company:${symbol}`)}
                  statusLabel={savingKeys.has(`company:${symbol}`) ? "저장 중" : undefined}
                  logo={<StockLogo symbol={company.symbol} companyName={company.name} size="xs" />}
                  onToggle={() => onToggleCompanyAlert(symbol)}
                />
              );
            })}
            {watchlistSymbols.length === 0 && (
              <div className="prototype-settings-empty">관심 기업 탭에서 기업을 추가하면 여기에 표시됩니다.</div>
            )}
          </div>
        </section>
      </div>

      <footer className="prototype-panel-note">
        <span>{loading ? "알림 설정을 불러오는 중입니다." : "알림 설정은 계정에 저장됩니다."}</span>
        {!canUse && <strong>로그인 후 알림 설정을 저장할 수 있습니다.</strong>}
        {error && <strong role="alert">{error}</strong>}
      </footer>
    </section>
  );
}

function PrototypeSwitch({
  checked,
  label,
  description,
  disabled = false,
  emphasized = false,
  logo,
  statusLabel,
  onToggle
}: {
  checked: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  emphasized?: boolean;
  logo?: ReactNode;
  statusLabel?: string;
  onToggle: () => void;
}) {
  return (
    <div className={`prototype-switch-row ${emphasized ? "is-emphasized" : ""} ${disabled ? "is-disabled" : ""}`}>
      {logo}
      <span className="prototype-switch-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      {statusLabel && <small className="prototype-switch-status">{statusLabel}</small>}
      <button
        type="button"
        className={`prototype-switch ${checked ? "is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={`${label} ${checked ? "끄기" : "켜기"}`}
        disabled={disabled}
        onClick={onToggle}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

function WatchlistSettingsView({
  symbols,
  selectedCompany,
  watchlistSymbols,
  loading,
  saving,
  persisted,
  error,
  onSelectCompany,
  onAddWatchlist,
  onOpenCompany
}: {
  symbols: ChartSymbolDto[];
  selectedCompany: ChartSymbolDto;
  watchlistSymbols: string[];
  loading: boolean;
  saving: boolean;
  persisted: boolean;
  error: string | null;
  onSelectCompany: (symbol: string) => void;
  onAddWatchlist: (symbol: string) => void;
  onOpenCompany: (symbol: string) => void;
}) {
  return (
    <section
      id="price-condition-watchlist-panel"
      className="price-condition-tab-panel is-settings-tab watchlist-settings-view"
      role="tabpanel"
      aria-labelledby="price-condition-watchlist-tab"
    >
      <div className="watchlist-list-toolbar">
        <SymbolSearch
          symbols={symbols}
          selectedSymbol={selectedCompany.symbol}
          selectedLabel={`${selectedCompany.symbol} · ${selectedCompany.name}`}
          placeholder="기업명 또는 티커 검색"
          className="watchlist-company-search"
          portalMenu={false}
          onSelectSymbol={(symbol) => {
            if (saving) {
              return;
            }
            const normalizedSymbol = symbol.toUpperCase();
            onSelectCompany(normalizedSymbol);
            onAddWatchlist(normalizedSymbol);
          }}
        />
        <span className="watchlist-list-count">{watchlistSymbols.length}개 관심 기업</span>
      </div>

      <div className="watchlist-company-list" role="list" aria-label="관심 기업 목록">
        {watchlistSymbols.map((symbol) => {
          const company = companyForSymbol(symbols, symbol);
          return (
            <button
              key={symbol}
              type="button"
              className="watchlist-company-row"
              role="listitem"
              aria-label={`${company.symbol} 기업정보 열기`}
              onClick={() => onOpenCompany(company.symbol)}
            >
              <StockLogo
                symbol={company.symbol}
                companyName={company.name}
                size="xs"
                className="watchlist-company-logo"
              />
              <span className="watchlist-company-symbol-line">
                <strong>{company.symbol}</strong>
                <small>추적 중</small>
              </span>
              <span className="watchlist-company-reasons">
                <em>{company.name}의 뉴스와 공시를 모니터링합니다.</em>
                <em>사회·리스크와 주요 기업 이슈를 추적합니다.</em>
              </span>
              <span className="watchlist-company-sector">{sectorLabelKo(company.sector)}</span>
            </button>
          );
        })}
        {watchlistSymbols.length === 0 && (
          <div className="watchlist-company-empty" role="status">
            <strong>아직 관심 기업이 없습니다.</strong>
            <span>위 검색창에서 기업을 선택하면 목록에 추가됩니다.</span>
          </div>
        )}
      </div>

      <footer className="prototype-panel-note">
        <span>
          {loading
            ? "관심 기업을 불러오는 중입니다."
            : saving
              ? "관심 기업을 저장하는 중입니다."
              : persisted
                ? "관심 기업은 계정에 저장되어 뉴스와 추천에 반영됩니다."
                : "검색에서 기업을 추가하면 계정에 저장됩니다."}
        </span>
        {error && <strong role="alert">{error}</strong>}
      </footer>
    </section>
  );
}

function initialPrototypeWatchlist(symbols: ChartSymbolDto[], defaultSymbol: string): string[] {
  const available = new Set(symbols.map((item) => item.symbol.toUpperCase()));
  const normalizedDefault = defaultSymbol.trim().toUpperCase();
  const candidates = [normalizedDefault, "AAPL", "MSFT", "NVDA", ...symbols.map((item) => item.symbol.toUpperCase())];
  const result: string[] = [];
  candidates.forEach((symbol) => {
    if (!symbol || result.includes(symbol) || (symbol !== normalizedDefault && !available.has(symbol))) {
      return;
    }
    result.push(symbol);
  });
  return result.slice(0, 3);
}

function companyForSymbol(symbols: ChartSymbolDto[], symbolValue: string): ChartSymbolDto {
  const normalizedSymbol = symbolValue.trim().toUpperCase();
  return symbols.find((item) => item.symbol.toUpperCase() === normalizedSymbol) ?? {
    symbol: normalizedSymbol || "NVDA",
    name: normalizedSymbol || "NVDA"
  };
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="auto-trade-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReservationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="paper-reservation-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
