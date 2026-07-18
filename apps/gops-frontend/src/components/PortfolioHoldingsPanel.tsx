import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCcw } from "lucide-react";
import { type CSSProperties, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { usePaperAccount } from "../orders/PaperAccountProvider";
import type { PaperAccountSnapshot } from "../orders/paperTradingClient";
import { PortfolioHoldingsApiError, parsePortfolioHoldingsApiResponse, validPortfolioCash, type PortfolioHoldingsResponse, type PortfolioPosition } from "./portfolioHoldingsApi";
import {
  fetchPortfolioPerformance,
  type PortfolioPerformanceRange,
  type PortfolioPerformanceResponse
} from "./portfolioPerformanceApi";
import { LogoDevAttribution, StockLogo } from "./StockLogo";
import { selectPortfolioHoldingSymbol, usePortfolioSelectedSymbol } from "./portfolioSelection";

type SortMode = "custom" | "value" | "return";
type AllocationMode = "asset" | "symbol" | "sector";
type PerformanceView = "performance" | "purchase";
type PortfolioFlowView = "invested" | "dividend";
type PortfolioMultiView = "summary" | "flow" | "diversification";
type AllocationSlice = {
  key: string;
  label: string;
  value: number;
  weight: number;
  tone: string;
};
type PortfolioInsight = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "watch" | "risk" | "neutral";
};
type PortfolioDashboard = {
  investedValue: number | null;
  totalValue: number | null;
  cashValue: number | null;
  stockValue: number | null;
  totalPnl: number | null;
  totalPnlRate: number | null;
  dayPnl: number | null;
  dayPnlRate: number | null;
  annualDividend: number | null;
  dividendYield: number | null;
  allocation: Record<AllocationMode, AllocationSlice[]>;
  insights: PortfolioInsight[];
};

type PortfolioAssetMetric = {
  key: "stock" | "cash" | "dividend";
  label: string;
  value: number | null;
  weight: number | null;
  progress: number;
  color: string;
};

type AnnualPortfolioPoint = {
  label: string;
  invested: number;
  cumulative: number;
};
type PurchaseComparePoint = {
  symbol: string;
  name: string;
  averagePrice: number;
  currentPrice: number;
  returnPercent: number;
  marketValue: number;
  color: string;
};
type PerformanceChartPoint = {
  time: string;
  value: number;
};

const REFRESH_INTERVAL_MS = 60_000;
const portfolioSectorBySymbol = new Map(sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.sector]));
const allocationTones = ["green-deep", "green", "red", "red-soft", "neutral", "brass", "green-soft", "clay"];
const purchaseCompareColors = [
  "var(--color-point-yellow)",
  "var(--color-point-orange)",
  "var(--color-point-purple)",
  "var(--color-up)",
  "var(--color-down)",
  "var(--color-signal)"
];
const activePortfolioRefreshIntervalMs = 1_000;
const portfolioPerformanceRanges: readonly { value: PortfolioPerformanceRange; label: string }[] = [
  { value: "1W", label: "1주" },
  { value: "1M", label: "1개월" },
  { value: "3M", label: "3개월" },
  { value: "1Y", label: "1년" },
  { value: "ALL", label: "전체" }
];

const portfolioMultiViews = [
  { id: "summary", title: "포트폴리오" },
  { id: "flow", title: "투자" },
  { id: "diversification", title: "분산투자" }
] as const;

function paperSnapshotToPortfolioPayload(snapshot: PaperAccountSnapshot): PortfolioHoldingsResponse {
  const positions: PortfolioPosition[] = snapshot.positions.map((position) => ({
    symbol: position.symbol,
    name: position.name || position.symbol,
    market: position.market || "overseas",
    exchange: position.exchange || "US",
    currency: position.currency || "USD",
    sector: position.sector,
    industry: position.industry,
    quantity: position.qty,
    availableQuantity: position.available_qty,
    averagePrice: position.average_price,
    currentPrice: position.current_price,
    marketValueForeign: position.market_value,
    unrealizedPnlForeign: position.unrealized_pnl,
    unrealizedPnlRate: position.unrealized_pnl_rate,
    dayPnlForeign: position.day_pnl,
    dayPnlRate: position.day_pnl_rate,
    peRatio: position.pe_ratio,
    epsTtm: position.eps_ttm,
    low52: position.low_52,
    high52: position.high_52,
    marketStatsAsOf: position.market_stats_as_of,
    stats52wSource: position.stats_52w_source,
    fundamentalsSource: position.fundamentals_source,
    fundamentalsAsOf: position.fundamentals_as_of,
    dividendYield: position.dividend_yield,
    dividendPerShare: position.dividend_per_share,
    annualDividend: position.annual_dividend,
    nextDividendDate: position.next_dividend_date,
    dividendSource: position.dividend_source
  }));
  const latestPriceTimestamp = positions.length
    ? snapshot.positions.map((position) => position.price_timestamp || "").sort().at(-1)
    : undefined;
  const costBasis = snapshot.positions.reduce((total, position) => total + position.cost_basis, 0);
  return {
    status: positions.length ? "ok" : "empty",
    source: "paper-shared",
    asOf: latestPriceTimestamp || snapshot.account.seeded_at || snapshot.account.started_at,
    account: {
      alias: "10종목 7섹터 균형형 가상계좌",
      market: "overseas",
      currency: snapshot.account.currency,
      cashForeign: snapshot.account.cash_balance,
      stockValueForeign: snapshot.account.market_value,
      totalValueForeign: snapshot.account.equity,
      unrealizedPnlForeign: snapshot.account.unrealized_pnl,
      unrealizedPnlRate: costBasis > 0 ? snapshot.account.unrealized_pnl / costBasis * 100 : 0
    },
    positions,
    limitations: []
  };
}

type PortfolioHoldingsDataState = {
  payload: PortfolioHoldingsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  errorStatus?: number;
};

export type PortfolioHoldingsSource = "active" | "kis";
type PortfolioHoldingsStore = {
  state: PortfolioHoldingsDataState;
  listeners: Set<() => void>;
  inflight: Promise<void> | null;
  intervalId: number | null;
  refreshQueued: boolean;
};
const portfolioStores = new Map<PortfolioHoldingsSource, PortfolioHoldingsStore>();

function portfolioStore(source: PortfolioHoldingsSource): PortfolioHoldingsStore {
  const existing = portfolioStores.get(source);
  if (existing) return existing;
  const created: PortfolioHoldingsStore = {
    state: { payload: null, loading: true, refreshing: false, error: undefined, errorStatus: undefined },
    listeners: new Set(), inflight: null, intervalId: null, refreshQueued: false
  };
  portfolioStores.set(source, created);
  return created;
}

function setPortfolioStoreState(source: PortfolioHoldingsSource, next: Partial<PortfolioHoldingsDataState>): void {
  const store = portfolioStore(source);
  store.state = { ...store.state, ...next };
  store.listeners.forEach((listener) => listener());
}

function loadPortfolioHoldingsStore(source: PortfolioHoldingsSource, showRefreshing = false): Promise<void> {
  const store = portfolioStore(source);
  if (store.inflight) {
    store.refreshQueued ||= showRefreshing;
    return store.inflight;
  }
  setPortfolioStoreState(source, {
    loading: showRefreshing ? store.state.loading : store.state.payload == null,
    refreshing: showRefreshing,
    error: undefined,
    errorStatus: undefined
  });
  const query = new URLSearchParams({ market: "overseas", currency: "USD", source });
  store.inflight = fetch(`/api/account/holdings?${query.toString()}`)
    .then(async (response) => {
      const nextPayload = await parsePortfolioHoldingsApiResponse(response);
      setPortfolioStoreState(source, { payload: nextPayload, loading: false, refreshing: false, error: undefined, errorStatus: undefined });
    })
    .catch((caught) => {
      setPortfolioStoreState(source, {
        payload: source === "kis" ? null : store.state.payload,
        loading: false,
        refreshing: false,
        error: caught instanceof Error ? caught.message : "보유종목을 불러오지 못했습니다.",
        errorStatus: caught instanceof PortfolioHoldingsApiError ? caught.status : undefined
      });
    })
    .finally(() => {
      store.inflight = null;
      if (store.refreshQueued) {
        store.refreshQueued = false;
        void loadPortfolioHoldingsStore(source, true);
      }
    });
  return store.inflight;
}

function subscribePortfolioHoldingsStore(source: PortfolioHoldingsSource, listener: () => void): () => void {
  const store = portfolioStore(source);
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    void loadPortfolioHoldingsStore(source, false);
    if (typeof window !== "undefined") {
      store.intervalId = window.setInterval(() => {
        void loadPortfolioHoldingsStore(source, true);
      }, source === "active" ? activePortfolioRefreshIntervalMs : REFRESH_INTERVAL_MS);
    }
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0 && typeof window !== "undefined") {
      if (store.intervalId != null) {
        window.clearInterval(store.intervalId);
        store.intervalId = null;
      }
    }
  };
}

export function usePortfolioHoldingsData(
  onPortfolioSymbolsChange?: (symbols: readonly string[]) => void,
  source: PortfolioHoldingsSource = "active"
) {
  const paperAccount = usePaperAccount();
  const [state, setState] = useState<PortfolioHoldingsDataState>(() => portfolioStore(source).state);

  useEffect(() => {
    if (source === "active") return undefined;
    const store = portfolioStore(source);
    setState(store.state);
    return subscribePortfolioHoldingsStore(source, () => setState(portfolioStore(source).state));
  }, [source]);

  const activePayload = useMemo(
    () => source === "active" && paperAccount.snapshot
      ? paperSnapshotToPortfolioPayload(paperAccount.snapshot)
      : null,
    [paperAccount.snapshot, source]
  );
  const visibleState: PortfolioHoldingsDataState = source === "active"
    ? {
        payload: activePayload,
        loading: paperAccount.loading,
        refreshing: paperAccount.loading && activePayload != null,
        error: paperAccount.error,
        errorStatus: undefined
      }
    : state;

  useEffect(() => {
    if (visibleState.payload) {
      onPortfolioSymbolsChange?.(visibleState.payload.positions.map((position) => position.symbol));
    }
  }, [onPortfolioSymbolsChange, visibleState.payload]);

  const positions = useMemo(() => sortPositions(visibleState.payload?.positions ?? [], "value"), [visibleState.payload?.positions]);
  const account = visibleState.payload?.account;
  const dashboard = useMemo(() => buildPortfolioDashboard(account, visibleState.payload?.positions ?? []), [account, visibleState.payload?.positions]);
  const loadHoldings = useCallback(
    () => source === "active" ? paperAccount.refresh() : loadPortfolioHoldingsStore(source, true),
    [paperAccount.refresh, source]
  );
  return { payload: visibleState.payload, loading: visibleState.loading, refreshing: visibleState.refreshing, error: visibleState.error, errorStatus: visibleState.errorStatus, positions, dashboard, loadHoldings };
}

export function PortfolioHoldingsPanel({
  onSelectSymbol,
  onPortfolioSymbolsChange
}: {
  onSelectSymbol: (symbol: string) => boolean;
  onPortfolioSymbolsChange?: (symbols: readonly string[]) => void;
}) {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData(onPortfolioSymbolsChange);
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("symbol");
  const [performanceView, setPerformanceView] = useState<PerformanceView>("performance");
  const portfolioSelection = usePortfolioSelectedSymbol();
  const selectedPortfolioSymbol = portfolioSelection.symbol;

  useEffect(() => {
    if (selectedPortfolioSymbol) setPerformanceView("purchase");
  }, [portfolioSelection.revision, selectedPortfolioSymbol]);
  const selectedAllocation = dashboard.allocation[allocationMode];
  const statusMessage = loading
    ? "보유종목을 불러오는 중입니다"
    : error || (positions.length === 0 ? "표시할 미국 주식 보유종목이 없습니다" : "");

  return (
    <section className="portfolio-holdings-panel portfolio-dashboard-panel" aria-label="미국 주식 포트폴리오 대시보드">
      <header className="panel-inline-header portfolio-panel-header">
        <div>
          <strong>포트폴리오</strong>
          <span>{payload?.asOf ? formatPortfolioUpdatedAt(payload.asOf) : "US Stocks"}</span>
        </div>
        <button
          className="portfolio-refresh-button"
          type="button"
          title="포트폴리오 새로고침"
          aria-label="포트폴리오 새로고침"
          onClick={() => void loadHoldings()}
          disabled={refreshing}
        >
          {loading || refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
      </header>
      {statusMessage && (
        <div className={`portfolio-state-row ${error ? "portfolio-error-inline" : ""}`}>
          {loading && <LoaderCircle size={14} className="spin" />}
          <span>{statusMessage}</span>
        </div>
      )}

      {!loading && (
        <div className="portfolio-dashboard-content">
          <div className="portfolio-terminal-grid">
            <article className="portfolio-terminal-card portfolio-performance-card">
              <div className="portfolio-terminal-heading portfolio-performance-heading">
                <div>
                  <span>성과</span>
                  <em>{performanceView === "performance" ? "Invested · Value · Gain" : "Average buy · Current return"}</em>
                </div>
                <div className="portfolio-performance-tabs" role="tablist" aria-label="포트폴리오 성과 보기">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={performanceView === "performance"}
                    className={performanceView === "performance" ? "active" : ""}
                    onClick={() => setPerformanceView("performance")}
                  >
                    성과
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={performanceView === "purchase"}
                    className={performanceView === "purchase" ? "active" : ""}
                    onClick={() => setPerformanceView("purchase")}
                  >
                    매수 비교
                  </button>
                </div>
              </div>
              {performanceView === "performance" ? (
                <PortfolioPerformanceChart refreshToken={payload?.asOf} />
              ) : (
                <PortfolioPurchaseComparisonChart positions={positions} highlightedSymbol={selectedPortfolioSymbol} />
              )}
            </article>

            <article className="portfolio-terminal-card portfolio-annual-card">
              <div className="portfolio-terminal-heading">
                <span>Invested</span>
                <em>Cumulative</em>
              </div>
              <PortfolioAnnualBars dashboard={dashboard} />
            </article>

            <article className="portfolio-terminal-card portfolio-dividend-history-card">
              <div className="portfolio-terminal-heading">
                <span>Dividend</span>
                <em>{formatRatioPercent(dashboard.dividendYield)}</em>
              </div>
              <PortfolioDividendHistory positions={positions} />
            </article>

            <article className="portfolio-terminal-card portfolio-diversification-card">
              <div className="portfolio-terminal-heading">
                <span>Diversification</span>
                <div className="portfolio-terminal-tabs" role="tablist" aria-label="투자 비중">
                  {(["asset", "symbol", "sector"] as AllocationMode[]).map((mode) => (
                    <button key={mode} type="button" className={allocationMode === mode ? "active" : ""} onClick={() => setAllocationMode(mode)}>
                      {allocationModeLabel(mode)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="portfolio-terminal-donut-row">
                <PortfolioAllocationDonut slices={selectedAllocation} />
                <div className="portfolio-terminal-legend">
                  {selectedAllocation.slice(0, 10).map((slice) => (
                    <span key={slice.key}>
                      <i className={`tone-${slice.tone}`} />
                      <em>{slice.label}</em>
                      <strong>{slice.weight.toFixed(1)}%</strong>
                    </span>
                  ))}
                </div>
              </div>
            </article>
          </div>

          <div className="portfolio-terminal-lower-grid">
            <article className="portfolio-terminal-card portfolio-insight-card">
              <div className="portfolio-terminal-heading">
                <span>내 투자 분석</span>
                <em>Risk · Income · Balance</em>
              </div>
              <div className="portfolio-insight-list">
                {dashboard.insights.map((insight) => (
                  <div key={insight.label} className={insight.tone}>
                    <span>{insight.label}</span>
                    <strong>{insight.value}</strong>
                    <em>{insight.detail}</em>
                  </div>
                ))}
              </div>
            </article>

            {positions.length > 0 && (
              <article className="portfolio-terminal-card portfolio-holdings-matrix-card">
                <PortfolioHoldingsMatrix
                  positions={positions}
                  onSelectSymbol={onSelectSymbol}
                />
              </article>
            )}
          </div>
        </div>
      )}
      <LogoDevAttribution className="panel-logo-attribution" />
    </section>
  );
}

export function PortfolioInvestmentStatusPanel({
  onPortfolioSymbolsChange
}: {
  onPortfolioSymbolsChange?: (symbols: readonly string[]) => void;
}) {
  const { loading, error, dashboard } = usePortfolioHoldingsData(onPortfolioSymbolsChange);
  const [activeAllocationIndex, setActiveAllocationIndex] = useState(0);
  const allocationItems = buildPortfolioAssetMetrics(dashboard);
  const statusMessage = loading
    ? "투자현황을 불러오는 중입니다"
    : error || (!dashboard.totalValue ? "표시할 투자현황 데이터가 없습니다" : "");
  const activeAllocation = allocationItems[activeAllocationIndex] ?? allocationItems[0];
  const activeProgress = Math.min(100, Math.max(0, activeAllocation?.progress ?? 0));

  return (
    <section
      className="portfolio-investment-panel portfolio-dashboard-panel"
      aria-label="투자현황 패널"
      style={{
        "--portfolio-investment-meter-color": activeAllocation?.color ?? "var(--investment-bold-blue)",
        "--portfolio-investment-progress": `${activeProgress}%`
      } as CSSProperties}
    >
      {statusMessage && (
        <div className={`portfolio-state-row ${error ? "portfolio-error-inline" : ""}`}>
          {loading && <LoaderCircle size={14} className="spin" />}
          <span>{statusMessage}</span>
        </div>
      )}

      {!loading && (
        <div className="portfolio-investment-window-shell">
          <div className="portfolio-investment-page-window is-portfolio">
            <div className="portfolio-investment-main">
              <div className="portfolio-investment-heading-row">
                <span className="portfolio-investment-kicker">투자현황</span>
                <div className="portfolio-investment-segmented-tabs" role="tablist" aria-label="투자 구성">
                  {allocationItems.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={index === activeAllocationIndex}
                      className={index === activeAllocationIndex ? "active" : ""}
                      onClick={() => setActiveAllocationIndex(index)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <h2>{formatPanelMoney(dashboard.totalValue, "USD")}</h2>
              <div className="portfolio-investment-budget-track" aria-hidden="true">
                <i />
              </div>
              <div className="portfolio-investment-budget-meta">
                <span>
                  <em>{activeAllocation?.label} / 비중</em>
                  <strong>{formatCompactMoney(activeAllocation?.value, "USD")} / {formatPercentPlain(activeAllocation?.weight)}</strong>
                </span>
              </div>
              <div className="portfolio-investment-wallet-chips">
                <span>
                  <em>오늘</em>
                  <strong className={directionClass(dashboard.dayPnl ?? dashboard.dayPnlRate)}>{formatSignedPanelMoney(dashboard.dayPnl, "USD")}</strong>
                  <b className={directionClass(dashboard.dayPnlRate)}>{formatSignedPercentPlain(dashboard.dayPnlRate)}</b>
                </span>
                <span>
                  <em>손익</em>
                  <strong className={directionClass(dashboard.totalPnl ?? dashboard.totalPnlRate)}>{formatSignedPanelMoney(dashboard.totalPnl, "USD")}</strong>
                  <b className={directionClass(dashboard.totalPnlRate)}>{formatSignedPercentPlain(dashboard.totalPnlRate)}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function handlePortfolioSplitPanelWheel(event: WheelEvent<HTMLElement>) {
  if (Math.abs(event.deltaY) < 4) {
    return;
  }
  const movingDown = event.deltaY > 0;
  const canMove = (element: HTMLElement) => {
    const overflowY = window.getComputedStyle(element).overflowY;
    const scrollable = /(auto|scroll|overlay)/.test(overflowY);
    if (!scrollable || element.scrollHeight <= element.clientHeight + 2) {
      return false;
    }
    const atTop = element.scrollTop <= 1;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    return movingDown ? !atBottom : !atTop;
  };

  let target = event.target instanceof HTMLElement ? event.target : null;
  while (target && target !== event.currentTarget) {
    if (canMove(target)) {
      event.stopPropagation();
      return;
    }
    target = target.parentElement;
  }

  if (canMove(event.currentTarget)) {
    event.stopPropagation();
  }
}

export function PortfolioPerformancePanel() {
  const { payload, loading, refreshing, error, positions, loadHoldings } = usePortfolioHoldingsData();
  const [performanceView, setPerformanceView] = useState<PerformanceView>("performance");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const portfolioSelection = usePortfolioSelectedSymbol();
  const selectedPortfolioSymbol = portfolioSelection.symbol;
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "비교할 보유종목이 없습니다");

  useEffect(() => {
    if (selectedPortfolioSymbol) setPerformanceView("purchase");
  }, [portfolioSelection.revision, selectedPortfolioSymbol]);

  const refreshPanel = () => {
    setRefreshRevision((current) => current + 1);
    void loadHoldings();
  };

  return (
    <section
      className="portfolio-split-panel portfolio-performance-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 성과 패널"
    >
      <PortfolioSplitHeader
        title="성과"
        subtitle={performanceView === "performance" ? "평가금 · 수익률 · S&P 500" : "평균 매수가 · 현재 수익률"}
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={refreshPanel}
      />
      <div className="portfolio-performance-tabs portfolio-split-tabs" role="tablist" aria-label="포트폴리오 성과 보기">
        <button
          type="button"
          role="tab"
          aria-selected={performanceView === "performance"}
          className={performanceView === "performance" ? "active" : ""}
          onClick={() => setPerformanceView("performance")}
        >
          성과
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={performanceView === "purchase"}
          className={performanceView === "purchase" ? "active" : ""}
          onClick={() => setPerformanceView("purchase")}
        >
          종목 비교
        </button>
      </div>
      {performanceView === "performance" ? (
        <PortfolioPerformanceChart refreshToken={refreshRevision} />
      ) : statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <PortfolioPurchaseComparisonChart positions={positions} highlightedSymbol={selectedPortfolioSymbol} />
      )}
    </section>
  );
}

export function PortfolioInvestedPanel({ initialView = "invested" }: { initialView?: PortfolioFlowView } = {}) {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [flowView, setFlowView] = useState<PortfolioFlowView>(initialView);
  const statusMessage = portfolioPanelStatusMessage(
    loading,
    error,
    positions.length,
    flowView === "invested" ? "투자금 데이터가 없습니다" : "배당 데이터가 없습니다"
  );
  const isDividend = flowView === "dividend";

  return (
    <section
      className="portfolio-split-panel portfolio-flow-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 투자금 및 배당 패널"
      onWheelCapture={handlePortfolioSplitPanelWheel}
      onWheel={handlePortfolioSplitPanelWheel}
    >
      <PortfolioSplitHeader
        title="Investment Flow"
        subtitle={isDividend ? "예상 연간 배당 흐름" : "연도별 투입 원금과 누적 흐름"}
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
      />
      <div className="portfolio-flow-tabs portfolio-split-tabs" role="tablist" aria-label="투자금 및 배당 보기">
        <button
          type="button"
          role="tab"
          aria-selected={flowView === "invested"}
          className={flowView === "invested" ? "active" : ""}
          onClick={() => setFlowView("invested")}
        >
          Invested
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={flowView === "dividend"}
          className={flowView === "dividend" ? "active" : ""}
          onClick={() => setFlowView("dividend")}
        >
          Dividend
        </button>
      </div>
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <section className={`portfolio-standalone-flow-card ${isDividend ? "is-dividend" : "is-invested"}`}>
          <div className="portfolio-multi-flow-metrics">
            <span>
              <em>{isDividend ? "예상 배당" : "투입 원금"}</em>
              <strong>{isDividend ? formatPanelMoney(dashboard.annualDividend, "USD") : formatCompactMoney(dashboard.investedValue ?? 0, "USD")}</strong>
            </span>
            <span>
              <em>{isDividend ? "Yield" : "현재 평가금"}</em>
              <strong>{isDividend ? formatRatioPercent(dashboard.dividendYield) : formatCompactMoney(dashboard.stockValue ?? 0, "USD")}</strong>
            </span>
          </div>
          <PortfolioMultiFlowChart
            points={isDividend ? buildDividendHistoryPoints(positions) : buildAnnualPortfolioPoints(dashboard)}
            variant={flowView}
            wide
          />
        </section>
      )}
    </section>
  );
}

export function PortfolioDividendPanel() {
  return <PortfolioInvestedPanel initialView="dividend" />;
}

export function PortfolioDiversificationPanel() {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("symbol");
  const selectedAllocation = dashboard.allocation[allocationMode];
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "구성 데이터가 없습니다");

  return (
    <section
      className="portfolio-split-panel portfolio-diversification-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 분산 패널"
      onWheelCapture={handlePortfolioSplitPanelWheel}
      onWheel={handlePortfolioSplitPanelWheel}
    >
      <PortfolioSplitHeader
        title="Diversification"
        subtitle="Portfolio distribution"
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
      />
      <div className="portfolio-terminal-tabs portfolio-split-tabs" role="tablist" aria-label="투자 비중">
        {(["asset", "symbol", "sector"] as AllocationMode[]).map((mode) => (
          <button key={mode} type="button" className={allocationMode === mode ? "active" : ""} onClick={() => setAllocationMode(mode)}>
            {allocationModeLabel(mode)}
          </button>
        ))}
      </div>
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <div className="portfolio-terminal-donut-row">
          <PortfolioAllocationDonut slices={selectedAllocation} />
          <div className="portfolio-terminal-legend">
            {selectedAllocation.slice(0, 10).map((slice) => (
              <span key={slice.key}>
                <i className={`tone-${slice.tone}`} />
                <em>{slice.label}</em>
                <strong>{slice.weight.toFixed(1)}%</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function PortfolioMultiPanel() {
  const { loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [activeView, setActiveView] = useState<PortfolioMultiView>("summary");
  const [transitionDirection, setTransitionDirection] = useState<"next" | "previous">("next");
  const wheelAccumulatorRef = useRef(0);
  const lastWheelAtRef = useRef(0);
  const activeIndex = Math.max(0, portfolioMultiViews.findIndex((view) => view.id === activeView));
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "포트폴리오 데이터가 없습니다");

  const selectViewByIndex = useCallback((index: number) => {
    const boundedIndex = Math.max(0, Math.min(portfolioMultiViews.length - 1, index));
    const nextView = portfolioMultiViews[boundedIndex];
    if (!nextView || nextView.id === activeView) {
      return;
    }
    setTransitionDirection(boundedIndex > activeIndex ? "next" : "previous");
    setActiveView(nextView.id);
  }, [activeIndex, activeView]);

  const handleWheelPageChange = useCallback((event: WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX) || Math.abs(event.deltaY) < 4) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - lastWheelAtRef.current > 260) {
      wheelAccumulatorRef.current = 0;
    }
    if (now - lastWheelAtRef.current < 420) {
      return;
    }
    wheelAccumulatorRef.current += event.deltaY;
    if (Math.abs(wheelAccumulatorRef.current) < 34) {
      return;
    }
    const direction = wheelAccumulatorRef.current > 0 ? 1 : -1;
    wheelAccumulatorRef.current = 0;
    lastWheelAtRef.current = now;
    selectViewByIndex(activeIndex + direction);
  }, [activeIndex, selectViewByIndex]);

  return (
    <section className="portfolio-multi-panel" aria-label="멀티 포트폴리오 패널" onWheel={handleWheelPageChange}>
      <div className="portfolio-multi-stage">
        <div
          key={activeView}
          id={`portfolio-multi-view-${activeView}`}
          className={`portfolio-multi-view is-${transitionDirection}`}
          role="tabpanel"
        >
          {statusMessage ? (
            <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
          ) : activeView === "summary" ? (
            <PortfolioMultiSummaryView dashboard={dashboard} refreshing={refreshing} onRefresh={loadHoldings} />
          ) : activeView === "flow" ? (
            <PortfolioMultiFlowView dashboard={dashboard} positions={positions} />
          ) : (
            <PortfolioMultiDiversificationView dashboard={dashboard} />
          )}
        </div>
        <button type="button" className="portfolio-multi-page-arrow previous" aria-label="이전 포트폴리오 화면" disabled={activeIndex === 0} onClick={() => selectViewByIndex(activeIndex - 1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="portfolio-multi-page-arrow next" aria-label="다음 포트폴리오 화면" disabled={activeIndex === portfolioMultiViews.length - 1} onClick={() => selectViewByIndex(activeIndex + 1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function PortfolioMultiPageHeader({ title, subtitle, aside }: { title: string; subtitle?: string; aside?: string }) {
  return (
    <header className="portfolio-multi-page-header">
      <div><span>{title}</span>{subtitle ? <em>{subtitle}</em> : null}</div>
      {aside ? <strong>{aside}</strong> : null}
    </header>
  );
}

function PortfolioMultiSummaryView({ dashboard, refreshing, onRefresh }: { dashboard: PortfolioDashboard; refreshing: boolean; onRefresh: () => void }) {
  const allocationItems = buildPortfolioAssetMetrics(dashboard);
  const ringRadii = [42, 28, 14];
  return (
    <article className="portfolio-multi-page portfolio-multi-summary-page">
      <button className="portfolio-multi-refresh" type="button" aria-label="포트폴리오 새로고침" onClick={() => void onRefresh()} disabled={refreshing}>
        {refreshing ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
      </button>
      <div className="portfolio-multi-summary-hero">
        <em>Total Balance</em>
        <div>
          <strong>{formatPanelMoney(dashboard.totalValue, "USD")}</strong>
          <span className={directionClass(dashboard.totalPnl ?? dashboard.totalPnlRate)}>
            {formatSignedPanelMoney(dashboard.totalPnl, "USD")} · {formatSignedPercentPlain(dashboard.totalPnlRate)}
          </span>
        </div>
      </div>
      <div className="portfolio-multi-asset-visual" aria-label="포트폴리오 자산 구성">
        <div className="portfolio-multi-asset-orbits">
          <svg viewBox="0 0 100 100" role="img" aria-label="주식, 현금, 배당 비중 활동 링">
            {allocationItems.map((item, index) => {
              const progress = Math.min(100, Math.max(0, item.progress));
              const radius = ringRadii[index] ?? 18;
              return (
                <g key={item.key} className={`portfolio-multi-watch-ring is-${item.key}`}>
                  <circle className="track" cx="50" cy="50" r={radius} pathLength="100" style={{ stroke: item.color }} />
                  <circle
                    className="progress"
                    cx="50"
                    cy="50"
                    r={radius}
                    pathLength="100"
                    style={{ stroke: item.color, strokeDasharray: `${progress} 100` }}
                    transform="rotate(-90 50 50)"
                  />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="portfolio-multi-asset-list">
        {allocationItems.map((item) => (
          <div
            key={item.key}
            className={`portfolio-multi-asset-row is-${item.key}`}
          >
            <i style={{ background: item.color }} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{formatCompactMoney(item.value, "USD")}/{formatPercentPlain(item.weight)}</strong>
          </div>
        ))}
        </div>
      </div>
    </article>
  );
}

function PortfolioMultiFlowView({ dashboard, positions }: { dashboard: PortfolioDashboard; positions: PortfolioPosition[] }) {
  const [flowMode, setFlowMode] = useState<"invested" | "dividend">("invested");
  const leaders = positions.map((position) => ({ symbol: position.symbol, dividend: annualDividendForPosition(position) ?? 0 })).filter((item) => item.dividend > 0).sort((left, right) => right.dividend - left.dividend).slice(0, 3);
  const isDividend = flowMode === "dividend";
  return (
    <article className="portfolio-multi-page portfolio-multi-flow-page">
      <div className="portfolio-multi-flow-head">
        <PortfolioMultiPageHeader title={isDividend ? "배당" : "투자"} />
        <div className="portfolio-multi-flow-switch" role="tablist" aria-label="흐름 선택">
          <button type="button" role="tab" aria-selected={!isDividend} className={!isDividend ? "active" : ""} onClick={() => setFlowMode("invested")}>원금</button>
          <button type="button" role="tab" aria-selected={isDividend} className={isDividend ? "active" : ""} onClick={() => setFlowMode("dividend")}>배당</button>
        </div>
      </div>
      <section className={`portfolio-multi-flow-focus is-${flowMode}`}>
        <div className="portfolio-multi-flow-metrics">
          {isDividend ? (
            <>
              <span><em>예상 배당</em><strong>{formatPanelMoney(dashboard.annualDividend, "USD")}</strong></span>
              <span><em>Yield</em><strong>{formatRatioPercent(dashboard.dividendYield)}</strong></span>
            </>
          ) : (
            <>
              <span><em>투입 원금</em><strong>{formatCompactMoney(dashboard.investedValue ?? 0, "USD")}</strong></span>
              <span><em>현재 평가금</em><strong>{formatCompactMoney(dashboard.stockValue ?? 0, "USD")}</strong></span>
            </>
          )}
        </div>
        <PortfolioMultiFlowChart points={isDividend ? buildDividendHistoryPoints(positions) : buildAnnualPortfolioPoints(dashboard)} variant={flowMode} />
      </section>
      {isDividend ? <div className="portfolio-multi-leaders">{leaders.map((leader) => <span key={leader.symbol}><b>{leader.symbol}</b><em>{formatCompactMoney(leader.dividend, "USD")}</em></span>)}</div> : null}
    </article>
  );
}

function PortfolioMultiDiversificationView({ dashboard }: { dashboard: PortfolioDashboard }) {
  const [mode, setMode] = useState<AllocationMode>("symbol");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const slices = dashboard.allocation[mode];
  const activeSlice = activeKey ? slices.find((slice) => slice.key === activeKey) : undefined;
  return (
    <article className="portfolio-multi-page portfolio-multi-diversification-page">
      <PortfolioMultiPageHeader title="분산투자" />
      <div className="portfolio-multi-mode-tabs" role="tablist" aria-label="분산 기준">
        {(["asset", "symbol", "sector"] as AllocationMode[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            className={mode === item ? "active" : ""}
            onClick={() => {
              setMode(item);
              setActiveKey(null);
            }}
          >
            {allocationModeLabel(item)}
          </button>
        ))}
      </div>
      <PortfolioMultiExplodedPie slices={slices} activeSlice={activeSlice} onSelect={setActiveKey} />
    </article>
  );
}

function PortfolioMultiExplodedPie({
  slices,
  activeSlice,
  onSelect
}: {
  slices: AllocationSlice[];
  activeSlice: AllocationSlice | undefined;
  onSelect: (key: string) => void;
}) {
  if (!slices.length) {
    return <div className="portfolio-allocation-empty">구성 없음</div>;
  }
  const radius = 78;
  const center = 100;
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0) || 1;
  let cursor = -Math.PI / 2;
  return (
    <section
      className={`portfolio-multi-exploded-pie${activeSlice ? " has-selection" : ""}`}
      aria-label="포트폴리오 분산 구성"
    >
      <div className="portfolio-multi-exploded-pie-visual">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={activeSlice ? `${activeSlice.label} 비중 ${activeSlice.weight.toFixed(1)}%` : "포트폴리오 구성 비중을 선택하세요"}
        >
          {slices.map((slice, index) => {
            const span = (slice.weight / total) * Math.PI * 2;
            const selected = activeSlice?.key === slice.key;
            const startAngle = cursor;
            const endAngle = cursor + span;
            const midAngle = cursor + span / 2;
            cursor += span;
            const selectDistance = 6;
            const selectX = Math.cos(midAngle) * selectDistance;
            const selectY = Math.sin(midAngle) * selectDistance;
            return (
              <g key={slice.key}>
                {selected ? (
                  <path
                    d={portfolioPieSlicePath(center, center, radius, startAngle, endAngle)}
                    className="portfolio-multi-pie-slice-underlay"
                    style={{ fill: portfolioMultiPieColor(index) }}
                    aria-hidden="true"
                  />
                ) : null}
                <path
                  d={portfolioPieSlicePath(center, center, radius, startAngle, endAngle)}
                  className={`portfolio-multi-pie-slice${selected ? " is-selected" : ""}`}
                  style={{
                    fill: portfolioMultiPieColor(index),
                    transform: selected ? `translate(${selectX}px, ${selectY}px)` : "translate(0, 0)"
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${slice.label} ${slice.weight.toFixed(1)}% 선택`}
                  onClick={() => onSelect(slice.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(slice.key);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="portfolio-multi-pie-legend" aria-label="포트폴리오 구성 범례">
        {slices.map((slice, index) => {
          const selected = activeSlice?.key === slice.key;
          return (
            <button
              key={slice.key}
              type="button"
              className={selected ? "is-selected" : ""}
              aria-pressed={selected}
              onClick={() => onSelect(slice.key)}
            >
              <i style={{ background: portfolioMultiPieColor(index) }} aria-hidden="true" />
              <span>{slice.label}</span>
              <strong>{slice.weight.toFixed(1)}%</strong>
            </button>
          );
        })}
      </div>
      {activeSlice ? (
        <div className="portfolio-multi-exploded-pie-caption" aria-live="polite">
          <span><i style={{ background: portfolioMultiPieColor(slices.findIndex((slice) => slice.key === activeSlice.key)) }} aria-hidden="true" />{activeSlice.label}</span>
          <strong>{activeSlice.weight.toFixed(1)}%</strong>
        </div>
      ) : null}
    </section>
  );
}

function portfolioPieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const span = Math.max(0, endAngle - startAngle);
  if (span >= Math.PI * 2 - 0.001) {
    return `M ${cx} ${cy} L ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
  }
  const startX = cx + Math.cos(startAngle) * radius;
  const startY = cy + Math.sin(startAngle) * radius;
  const endX = cx + Math.cos(endAngle) * radius;
  const endY = cy + Math.sin(endAngle) * radius;
  const largeArc = span > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

function PortfolioMultiFlowChart({
  points,
  variant,
  wide = false
}: {
  points: AnnualPortfolioPoint[];
  variant: "invested" | "dividend";
  wide?: boolean;
}) {
  const width = wide ? 720 : 620;
  const height = wide ? 220 : 360;
  const left = wide ? 34 : 64;
  const right = 20;
  const top = wide ? 20 : 10;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(...points.map((point) => Math.max(point.invested, point.cumulative)), 1);
  const step = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const barWidth = Math.min(wide ? 52 : 18, step * 0.42);
  const linePoints = points.map((point, index) => `${left + index * step},${top + plotHeight - (point.cumulative / maxValue) * plotHeight}`).join(" ");
  const ticks = (wide ? [0, 1 / 3, 2 / 3, 1] : [0, 0.25, 0.5, 0.75, 1]).map((ratio) => maxValue * ratio);
  return (
    <div className={`portfolio-multi-flow-chart is-${variant}${wide ? " is-wide" : ""}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={variant === "invested" ? "투자 원금 누적 차트" : "배당 누적 차트"}>
        {ticks.map((tick) => { const y = top + plotHeight - (tick / maxValue) * plotHeight; return <g key={tick}><line className="grid" x1={left} x2={width - right} y1={y} y2={y} />{wide ? null : <text className="axis-label" x={0} y={y + 5}>{formatCompactMoney(tick, "USD")}</text>}</g>; })}
        {points.map((point, index) => { const x = left + index * step; const barHeight = Math.max(4, (point.invested / maxValue) * plotHeight); return <g key={point.label}><rect className={index === points.length - 1 ? "bar is-current" : "bar"} x={x - barWidth / 2} y={top + plotHeight - barHeight} width={barWidth} height={barHeight} rx="5" /><text x={x} y={height - 9} textAnchor="middle">{point.label.slice(2)}</text></g>; })}
        <polyline className="line" points={linePoints} />
        {points.map((point, index) => { const x = left + index * step; const y = top + plotHeight - (point.cumulative / maxValue) * plotHeight; return <circle key={point.label} className="point" cx={x} cy={y} r="3" />; })}
      </svg>
      <div className="portfolio-multi-flow-legend"><span><i className="bar" />{variant === "invested" ? "연간 투입" : "연간 배당"}</span><span><i className="line" />누적</span></div>
    </div>
  );
}

export function PortfolioHoldingsOnlyPanel({
  onSelectSymbol
}: {
  onSelectSymbol: (symbol: string) => boolean;
}) {
  const { loading, error, positions } = usePortfolioHoldingsData();
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "보유종목이 없습니다");

  return (
    <section
      className="portfolio-split-panel portfolio-holdings-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 보유종목 패널"
      onWheelCapture={handlePortfolioSplitPanelWheel}
      onWheel={handlePortfolioSplitPanelWheel}
    >
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <PortfolioHoldingsMatrix
          positions={positions}
          onSelectSymbol={onSelectSymbol}
          showSummary={false}
        />
      )}
    </section>
  );
}

export function PortfolioHoldingsFlatCardsPanel({
  onSelectSymbol
}: {
  onSelectSymbol: (symbol: string) => boolean;
}) {
  const { loading, error, positions } = usePortfolioHoldingsData();
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "보유종목이 없습니다");

  return (
    <section
      className="portfolio-split-panel portfolio-holdings-split-panel portfolio-holdings-flat-cards-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 보유종목 평면 카드 패널"
      onWheelCapture={handlePortfolioSplitPanelWheel}
      onWheel={handlePortfolioSplitPanelWheel}
    >
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <PortfolioHoldingsFlatBoard positions={positions} onSelectSymbol={onSelectSymbol} />
      )}
    </section>
  );
}

function PortfolioSplitHeader({
  title,
  subtitle,
  asOf,
  refreshing,
  onRefresh
}: {
  title: string;
  subtitle: string;
  asOf?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="panel-inline-header portfolio-panel-header portfolio-split-header">
      <div>
        <strong>{title}</strong>
        <span>{asOf ? formatPortfolioUpdatedAt(asOf) : subtitle}</span>
      </div>
      <button
        className="portfolio-refresh-button"
        type="button"
        title={`${title} 새로고침`}
        aria-label={`${title} 새로고침`}
        onClick={() => void onRefresh()}
        disabled={refreshing}
      >
        {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
      </button>
    </header>
  );
}

function PortfolioPanelStatus({ message, loading, error }: { message: string; loading: boolean; error: boolean }) {
  return (
    <div className={`portfolio-state-row ${error ? "portfolio-error-inline" : ""}`}>
      {loading && <LoaderCircle size={14} className="spin" />}
      <span>{message}</span>
    </div>
  );
}

function portfolioPanelStatusMessage(loading: boolean, error: string | undefined, positionCount: number, emptyMessage: string): string {
  if (loading) {
    return "포트폴리오 데이터를 불러오는 중입니다";
  }
  if (error) {
    return error;
  }
  return positionCount === 0 ? emptyMessage : "";
}

function PortfolioAllocationDonut({ slices }: { slices: AllocationSlice[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  if (!slices.length) {
    return <div className="portfolio-allocation-empty">구성 없음</div>;
  }
  const activeSlice = slices.find((slice) => slice.key === activeKey) ?? slices[0];
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  return (
    <div className="portfolio-donut" onMouseLeave={() => setActiveKey(null)}>
      <svg viewBox="0 0 120 120" aria-label="포트폴리오 구성 비중">
        <circle cx="60" cy="60" r={radius} className="portfolio-donut-track" />
        {slices.map((slice) => {
          const dash = Math.max(0.6, (slice.weight / 100) * circumference);
          const offset = -cursor;
          cursor += dash;
          return (
            <circle
              key={slice.key}
              cx="60"
              cy="60"
              r={radius}
              className={`portfolio-donut-segment ${activeSlice.key === slice.key ? "active" : ""}`}
              style={{
                stroke: allocationColor(slice.tone),
                strokeDasharray: `${dash} ${circumference - dash}`,
                strokeDashoffset: offset
              }}
              onMouseEnter={() => setActiveKey(slice.key)}
            />
          );
        })}
      </svg>
      <span>
        <strong>{activeSlice.weight.toFixed(0)}%</strong>
        <em>{activeSlice.label}</em>
      </span>
    </div>
  );
}

function PortfolioPerformanceChart({ refreshToken }: { refreshToken?: string | number }) {
  const [range, setRange] = useState<PortfolioPerformanceRange>("1M");
  const [response, setResponse] = useState<PortfolioPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetchPortfolioPerformance(range, controller.signal)
      .then((payload) => {
        setResponse(payload);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setResponse(null);
        setError(caught instanceof Error ? caught.message : "성과 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, refreshToken]);

  const portfolioPoints = response?.portfolio.points ?? [];
  const benchmarkPoints = response?.benchmark.points ?? [];
  const normalizedMoneySeries = (key: "portfolioValue" | "holdingsCostBasis"): PerformanceChartPoint[] => {
    const observed = portfolioPoints.flatMap((point) => {
      const amount = point[key];
      return typeof amount === "number" && Number.isFinite(amount) ? [{ time: point.time, amount }] : [];
    });
    const base = observed[0]?.amount;
    if (base == null || base === 0) return [];
    return observed.map((point) => ({ time: point.time, value: (point.amount / base - 1) * 100 }));
  };
  const portfolioValuePoints = normalizedMoneySeries("portfolioValue");
  const reportedReturnPoints: PerformanceChartPoint[] = portfolioPoints.map((point) => ({
    time: point.time,
    value: point.returnPercent
  }));
  const primaryPoints = portfolioValuePoints.length >= 2 ? portfolioValuePoints : reportedReturnPoints;
  const principalPoints = normalizedMoneySeries("holdingsCostBasis");
  const benchmarkReturnPoints: PerformanceChartPoint[] = benchmarkPoints.map((point) => ({
    time: point.time,
    value: point.returnPercent
  }));
  const allPoints = [...primaryPoints, ...principalPoints, ...benchmarkReturnPoints];
  const portfolioPeriodReturn = primaryPoints.at(-1)?.value ?? null;
  const benchmarkPeriodReturn = benchmarkReturnPoints.at(-1)?.value ?? null;
  const latestPortfolioValue = [...portfolioPoints].reverse().find((point) => point.portfolioValue != null)?.portfolioValue ?? null;
  const latestHoldingsCostBasis = [...portfolioPoints].reverse().find((point) => point.holdingsCostBasis != null)?.holdingsCostBasis ?? null;
  const width = 720;
  const height = 300;
  const padding = { top: 18, right: 18, bottom: 34, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const timestamps = allPoints.map((point) => Date.parse(point.time)).filter(Number.isFinite);
  const values = allPoints.map((point) => point.value).filter(Number.isFinite);
  const minTime = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length ? Math.max(...timestamps) : 1;
  const rawMin = values.length ? Math.min(...values, 0) : 0;
  const rawMax = values.length ? Math.max(...values, 0) : 1;
  const valuePadding = Math.max((rawMax - rawMin) * 0.12, 0.5);
  const minValue = rawMin - valuePadding;
  const maxValue = rawMax + valuePadding;
  const valueSpan = maxValue - minValue || 1;
  const xFor = (time: string) => padding.left + ((Date.parse(time) - minTime) / Math.max(maxTime - minTime, 1)) * chartWidth;
  const yFor = (value: number) => padding.top + chartHeight - ((value - minValue) / valueSpan) * chartHeight;
  const pathFor = (points: PerformanceChartPoint[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(point.time).toFixed(1)} ${yFor(point.value).toFixed(1)}`).join(" ");
  const stepPathFor = (points: PerformanceChartPoint[]) => points.map((point, index) => {
    const x = xFor(point.time).toFixed(1);
    const y = yFor(point.value).toFixed(1);
    return index === 0 ? `M ${x} ${y}` : `H ${x} V ${y}`;
  }).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue - valueSpan * ratio);
  const xTicks = timestamps.length
    ? [0, 0.25, 0.5, 0.75, 1].map((ratio) => minTime + (maxTime - minTime) * ratio)
    : [];
  const hasChart = response?.status === "ready" && primaryPoints.length >= 2;

  return (
    <div className="portfolio-terminal-chart portfolio-performance-chart">
      <div className="portfolio-performance-range-tabs" role="tablist" aria-label="성과 기간">
        {portfolioPerformanceRanges.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={range === item.value}
            className={range === item.value ? "active" : ""}
            onClick={() => setRange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="portfolio-chart-empty"><LoaderCircle size={18} className="spin" /><span>성과 추이를 불러오는 중입니다</span></div>
      ) : error ? (
        <div className="portfolio-chart-empty portfolio-error-inline"><span>{error}</span></div>
      ) : !hasChart ? (
        <div className="portfolio-chart-empty"><span>성과 이력이 두 시점 이상 쌓이면 표시합니다</span></div>
      ) : (
        <>
          <div className="portfolio-performance-return-summary" aria-label="선택 기간 평가금과 수익률">
            <span>
              <i className="portfolio" />평가금
              <strong className={directionClass(portfolioPeriodReturn)}>
                {latestPortfolioValue != null ? `${formatPanelMoney(latestPortfolioValue, "USD")} · ` : ""}{formatSignedPercentPlain(portfolioPeriodReturn)}
              </strong>
            </span>
            <span title="입출금 원장이 아닌 현재 보유 종목의 매입원가입니다.">
              <i className="principal" />보유 원금
              <strong className="neutral">{formatPanelMoney(latestHoldingsCostBasis, "USD")}</strong>
            </span>
            <span>
              <i className="benchmark" />S&amp;P 500
              <strong className={directionClass(benchmarkPeriodReturn)}>{formatSignedPercentPlain(benchmarkPeriodReturn)}</strong>
            </span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${range} 평가금, 보유 원금, S&P 500 변화율 비교`}>
            {yTicks.map((tick) => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="portfolio-terminal-grid-line" />
                  <text x={padding.left - 8} y={y + 4} textAnchor="end" className="portfolio-terminal-axis-label">{formatAxisPercent(tick)}</text>
                </g>
              );
            })}
            <line x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} className="portfolio-terminal-zero-line" />
            <path d={pathFor(primaryPoints)} className="portfolio-performance-return-line portfolio" />
            {principalPoints.length >= 2 && <path d={stepPathFor(principalPoints)} className="portfolio-performance-return-line principal" />}
            {benchmarkReturnPoints.length >= 2 && <path d={pathFor(benchmarkReturnPoints)} className="portfolio-performance-return-line benchmark" />}
            {primaryPoints.at(-1) && (
              <circle cx={xFor(primaryPoints.at(-1)!.time)} cy={yFor(primaryPoints.at(-1)!.value)} r="4" className="portfolio-performance-return-point portfolio">
                <title>{`평가금 ${formatPanelMoney(latestPortfolioValue, "USD")} · ${formatSignedPercentPlain(portfolioPeriodReturn)}`}</title>
              </circle>
            )}
            {principalPoints.at(-1) && (
              <circle cx={xFor(principalPoints.at(-1)!.time)} cy={yFor(principalPoints.at(-1)!.value)} r="4" className="portfolio-performance-return-point principal">
                <title>{`보유 원금 ${formatPanelMoney(latestHoldingsCostBasis, "USD")} · ${formatSignedPercentPlain(principalPoints.at(-1)!.value)}`}</title>
              </circle>
            )}
            {benchmarkReturnPoints.at(-1) && (
              <circle cx={xFor(benchmarkReturnPoints.at(-1)!.time)} cy={yFor(benchmarkReturnPoints.at(-1)!.value)} r="4" className="portfolio-performance-return-point benchmark">
                <title>{`S&P 500 ${formatSignedPercentPlain(benchmarkPeriodReturn)}`}</title>
              </circle>
            )}
            {xTicks.map((tick, index) => (
              <text key={`${tick}-${index}`} x={padding.left + chartWidth * (index / Math.max(xTicks.length - 1, 1))} y={height - 9} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} className="portfolio-terminal-axis-label">
                {formatPerformanceDate(tick, range)}
              </text>
            ))}
          </svg>
          <div className="portfolio-terminal-chart-legend">
            <span><i className="portfolio" />평가금 변화</span>
            <span title="현재 보유 종목의 매입원가 변화"><i className="principal" />보유 원금</span>
            <span><i className="benchmark" />S&amp;P 500</span>
          </div>
        </>
      )}
    </div>
  );
}

function PortfolioPurchaseComparisonChart({
  positions,
  highlightedSymbol
}: {
  positions: PortfolioPosition[];
  highlightedSymbol?: string | null;
}) {
  const points = useMemo(() => buildPurchaseComparePoints(positions), [positions]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const normalizedHighlight = highlightedSymbol?.trim().toUpperCase() ?? null;

  useEffect(() => {
    if (normalizedHighlight && points.some((point) => point.symbol === normalizedHighlight)) {
      setSelectedSymbol(normalizedHighlight);
    }
  }, [normalizedHighlight, points]);

  if (!points.length) {
    return <div className="portfolio-chart-empty"><span>매수 비교 데이터 대기</span></div>;
  }
  const selectedPoint = points.find((point) => point.symbol === selectedSymbol) ?? points[0];
  const width = 720;
  const height = 300;
  const padding = { top: 20, right: 126, bottom: 36, left: 64 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const rawValues = points.flatMap((point) => [0, point.returnPercent]);
  const rawMin = Math.min(...rawValues);
  const rawMax = Math.max(...rawValues);
  const domainMin = Math.min(-3, Math.floor(rawMin * 1.18));
  const domainMax = Math.max(3, Math.ceil(rawMax * 1.18));
  const span = domainMax - domainMin || 1;
  const xStart = padding.left;
  const xEnd = width - padding.right;
  const xMid = padding.left + chartWidth * 0.52;
  const yFor = (value: number) => padding.top + chartHeight - ((value - domainMin) / span) * chartHeight;
  const yZero = yFor(0);
  const ticks = [domainMin, domainMin + span * 0.25, domainMin + span * 0.5, domainMin + span * 0.75, domainMax];
  const endLabels = purchaseEndLabelLayout(points, (point) => yFor(point.returnPercent), padding.top + 12, height - padding.bottom - 8);

  return (
    <div className="portfolio-purchase-compare">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="평균 매수가 대비 현재가 수익률 비교">
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="portfolio-terminal-grid-line" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="portfolio-terminal-axis-label">
                {tick.toFixed(1)}%
              </text>
            </g>
          );
        })}
        <line x1={padding.left} x2={width - padding.right} y1={yZero} y2={yZero} className="portfolio-terminal-zero-line" />
        <text x={xStart} y={height - 10} textAnchor="middle" className="portfolio-terminal-axis-label">평균매수가</text>
        <text x={xEnd} y={height - 10} textAnchor="middle" className="portfolio-terminal-axis-label">현재가</text>
        {points.map((point) => {
          const yEnd = yFor(point.returnPercent);
          const labelY = endLabels.get(point.symbol) ?? yEnd + 4;
          const d = `M ${xStart.toFixed(1)} ${yZero.toFixed(1)} C ${xMid.toFixed(1)} ${yZero.toFixed(1)}, ${xMid.toFixed(1)} ${yEnd.toFixed(1)}, ${xEnd.toFixed(1)} ${yEnd.toFixed(1)}`;
          const isSelected = point.symbol === selectedPoint.symbol;
          return (
            <g
              key={point.symbol}
              className={`portfolio-purchase-series ${isSelected ? "is-selected" : "is-muted"}`}
              role="button"
              tabIndex={0}
              aria-label={`${point.symbol} 매수 비교 선택`}
              onClick={() => {
                setSelectedSymbol(point.symbol);
                selectPortfolioHoldingSymbol(point.symbol);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedSymbol(point.symbol);
                  selectPortfolioHoldingSymbol(point.symbol);
                }
              }}
            >
              <path d={d} className="portfolio-purchase-line" style={{ stroke: point.color }} />
              <circle cx={xStart} cy={yZero} r="4" className="portfolio-purchase-dot start" style={{ stroke: point.color }} />
              <circle cx={xEnd} cy={yEnd} r="4.5" className="portfolio-purchase-dot end" style={{ fill: point.color }} />
              <text x={xEnd + 8} y={labelY} className="portfolio-purchase-end-label" style={{ fill: point.color }}>
                {point.symbol} {formatSignedPercentPlain(point.returnPercent)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="portfolio-purchase-selected-row" aria-label="선택된 보유종목 매수 비교">
        <span>
          <i style={{ background: selectedPoint.color }} />
          <strong className={selectedPoint.symbol === "NVDA" ? "portfolio-nvda-symbol" : undefined}>{selectedPoint.symbol}</strong>
          <em>{selectedPoint.name}</em>
        </span>
        <span>{formatMoney(selectedPoint.averagePrice, "USD")}</span>
        <span>{formatMoney(selectedPoint.currentPrice, "USD")}</span>
        <b className={directionClass(selectedPoint.returnPercent)}>{formatSignedPercentPlain(selectedPoint.returnPercent)}</b>
      </div>
    </div>
  );
}

function PortfolioAnnualBars({ dashboard }: { dashboard: PortfolioDashboard }) {
  const points = buildAnnualPortfolioPoints(dashboard);
  const max = Math.max(...points.map((point) => Math.max(point.invested, point.cumulative)), 1);
  return (
    <div className="portfolio-annual-bars">
      <div className="portfolio-mini-chart">
        {points.map((point) => (
          <span key={point.label}>
            <i style={{ height: `${Math.max(5, (point.invested / max) * 100)}%` }} />
            <b style={{ bottom: `${Math.max(5, (point.cumulative / max) * 100)}%` }} />
            <em>{point.label}</em>
          </span>
        ))}
      </div>
      <div className="portfolio-terminal-chart-legend">
        <span><i className="value" />Invested</span>
        <span><i className="invested" />Cumulative</span>
      </div>
    </div>
  );
}

function PortfolioDividendHistory({ positions }: { positions: PortfolioPosition[] }) {
  const points = buildDividendHistoryPoints(positions);
  const max = Math.max(...points.map((point) => point.invested), 1);
  return (
    <div className="portfolio-annual-bars portfolio-dividend-history">
      <div className="portfolio-mini-chart">
        {points.map((point) => (
          <span key={point.label}>
            <i style={{ height: `${Math.max(4, (point.invested / max) * 100)}%` }} />
            <b style={{ bottom: `${Math.max(5, (point.cumulative / max) * 100)}%` }} />
            <em>{point.label}</em>
          </span>
        ))}
      </div>
      <div className="portfolio-terminal-chart-legend">
        <span><i className="dividend" />Dividend</span>
        <span><i className="brass" />Cumulative</span>
      </div>
    </div>
  );
}

function PortfolioHoldingsMatrix({
  positions,
  onSelectSymbol,
  showSummary = true
}: {
  positions: PortfolioPosition[];
  onSelectSymbol: (symbol: string) => boolean;
  showSummary?: boolean;
}) {
  const totals = positions.reduce(
    (summary, position) => {
      const quantity = position.quantity ?? 0;
      const marketValue = position.marketValueForeign ?? ((position.currentPrice ?? 0) * quantity);
      const costValue = (position.averagePrice ?? 0) * quantity;
      const gainValue = position.unrealizedPnlForeign ?? (marketValue - costValue);
      return {
        marketValue: summary.marketValue + marketValue,
        costValue: summary.costValue + costValue,
        gainValue: summary.gainValue + gainValue,
        dividend: summary.dividend + (annualDividendForPosition(position) ?? 0)
      };
    },
    { marketValue: 0, costValue: 0, gainValue: 0, dividend: 0 }
  );
  const totalReturn = totals.costValue > 0 ? (totals.gainValue / totals.costValue) * 100 : null;

  return (
    <div className="portfolio-holdings-list" aria-label="보유 종목 지표">
      {showSummary && (
        <div className="portfolio-holdings-summary">
          <span>
            <em>보유 종목</em>
            <b>{positions.length}</b>
          </span>
          <span>
            <em>평가금</em>
            <b>{formatPanelMoney(totals.marketValue, "USD")}</b>
          </span>
          <span className={directionClass(totalReturn)}>
            <em>총 수익률</em>
            <b>{formatSignedPercentPlain(totalReturn)}</b>
            <small>{formatSignedPanelMoney(totals.gainValue, "USD")}</small>
          </span>
          <span>
            <em>예상 배당</em>
            <b>{formatCompactMoney(totals.dividend, "USD")}</b>
          </span>
        </div>
      )}

      <div className="portfolio-holdings-table-scroll">
        <div className="portfolio-holdings-table-head" aria-hidden="true">
          <span className="column-symbol">종목</span>
          <span className="column-pe">P/E</span>
          <span className="column-range">52주 범위</span>
          <span className="column-quantity">보유수량</span>
          <span className="column-price">현재가</span>
          <span className="column-cost">매입가</span>
          <span className="column-value">평가금</span>
          <span className="column-gain">손익</span>
          <span className="column-return">수익률</span>
          <span className="column-dividend">배당</span>
          <span className="column-day">오늘</span>
        </div>
        {positions.map((position) => {
          const rangeLow = position.low52 ?? position.currentPrice ?? 0;
          const rangeHigh = position.high52 ?? position.currentPrice ?? rangeLow;
          const rangeSpan = Math.max(rangeHigh - rangeLow, 0);
          const rangePosition = rangeSpan > 0 && position.currentPrice != null
            ? Math.min(100, Math.max(0, ((position.currentPrice - rangeLow) / rangeSpan) * 100))
            : 50;
          const gainTone = directionClass(position.unrealizedPnlRate);
          const dayTone = directionClass(position.dayPnlRate);
          const dividend = annualDividendForPosition(position);
          const marketValue = position.marketValueForeign ?? ((position.currentPrice ?? 0) * (position.quantity ?? 0));

          return (
            <button
              key={position.symbol}
              className="portfolio-holding-row"
              type="button"
              title={`${position.symbol} 차트 열기`}
              aria-label={`${position.symbol} 차트 열기`}
              onClick={() => {
                selectPortfolioHoldingSymbol(position.symbol);
                onSelectSymbol(position.symbol);
              }}
            >
              <span className="portfolio-holding-row-symbol">
                <StockLogo
                  symbol={position.symbol}
                  companyName={position.name}
                  size="xs"
                  className="portfolio-holding-row-logo"
                />
                <strong>{position.symbol}</strong>
              </span>
              <span className="portfolio-holding-cell column-pe">{formatMultiple(position.peRatio)}</span>
              <span className="portfolio-holding-cell portfolio-holding-range column-range">
                <b>{formatCompactMoney(rangeLow, "USD")} - {formatCompactMoney(rangeHigh, "USD")}</b>
                <i title={`52주 범위 중 현재 위치 ${rangePosition.toFixed(0)}%`}>
                  <span style={{ width: `${rangePosition}%` }} />
                </i>
              </span>
              <span className="portfolio-holding-cell column-quantity">{formatHoldingQuantity(position.quantity)}</span>
              <span className="portfolio-holding-cell column-price">{formatPanelMoney(position.currentPrice, "USD")}</span>
              <span className="portfolio-holding-cell column-cost">{formatPanelMoney(position.averagePrice, "USD")}</span>
              <span className="portfolio-holding-cell value column-value">{formatPanelMoney(marketValue, "USD")}</span>
              <span className={`portfolio-holding-cell gain column-gain ${gainTone}`}>
                {formatCompactMoney(position.unrealizedPnlForeign, "USD")}
              </span>
              <span className={`portfolio-holding-cell return column-return ${gainTone}`}>
                {formatSignedPercentPlain(position.unrealizedPnlRate)}
              </span>
              <span className="portfolio-holding-cell dividend column-dividend">{formatCompactMoney(dividend, "USD")}</span>
              <span className={`portfolio-holding-cell day column-day ${dayTone}`}>{formatSignedPercentPlain(position.dayPnlRate)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PortfolioHoldingsFlatBoard({
  positions,
  onSelectSymbol
}: {
  positions: PortfolioPosition[];
  onSelectSymbol: (symbol: string) => boolean;
}) {
  const totalMarketValue = positions.reduce((total, position) => (
    total + (position.marketValueForeign ?? ((position.currentPrice ?? 0) * (position.quantity ?? 0)))
  ), 0);

  return (
    <div className="portfolio-holdings-flat-board" aria-label="보유종목 카드 목록">
      {positions.map((position, index) => (
        <article key={position.symbol} className={`portfolio-holding-flat-card tone-${index % 6}`}>
          <button
            type="button"
            onClick={() => {
              selectPortfolioHoldingSymbol(position.symbol);
              onSelectSymbol(position.symbol);
            }}
          >
            <PortfolioHoldingCardContent position={position} totalMarketValue={totalMarketValue} />
          </button>
        </article>
      ))}
    </div>
  );
}

function PortfolioHoldingCardContent({
  position,
  totalMarketValue
}: {
  position: PortfolioPosition;
  totalMarketValue: number;
}) {
  const marketValue = position.marketValueForeign ?? ((position.currentPrice ?? 0) * (position.quantity ?? 0));
  const rangeLow = position.low52 ?? position.currentPrice ?? 0;
  const rangeHigh = position.high52 ?? position.currentPrice ?? rangeLow;
  const rangeSpan = Math.max(rangeHigh - rangeLow, 0);
  const rangePosition = rangeSpan > 0 && position.currentPrice != null
    ? Math.min(100, Math.max(0, ((position.currentPrice - rangeLow) / rangeSpan) * 100))
    : 50;
  const weight = totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : null;
  const gainTone = directionClass(position.unrealizedPnlRate);
  const dayTone = directionClass(position.dayPnlRate);

  return (
    <>
      <header className="portfolio-holding-column-header">
        <StockLogo
          symbol={position.symbol}
          companyName={position.name}
          size="xs"
          className="portfolio-holding-column-logo"
        />
        <span>
          <strong>{position.symbol}</strong>
          <em>{position.name}</em>
        </span>
        <small>{position.exchange || "US"}</small>
      </header>

      <div className="portfolio-holding-event event-price">
        <span>현재가</span>
        <b>{formatMoney(position.currentPrice, "USD")}</b>
        <em className={dayTone}>{formatSignedPercentPlain(position.dayPnlRate)}</em>
      </div>
      <div className="portfolio-holding-event event-cost">
        <span>매입가</span>
        <b>{formatMoney(position.averagePrice, "USD")}</b>
        <em>{formatCompactMoney(marketValue, "USD")}</em>
      </div>
      <div className={`portfolio-holding-event event-gain ${gainTone}`}>
        <span>손익</span>
        <b>{formatCompactMoney(position.unrealizedPnlForeign, "USD")}</b>
        <em>{formatSignedPercentPlain(position.unrealizedPnlRate)}</em>
      </div>
      <div className="portfolio-holding-event event-range">
        <span>52주</span>
        <b>{formatCompactMoney(rangeLow, "USD")} - {formatCompactMoney(rangeHigh, "USD")}</b>
        <i title={`52주 범위 중 현재 위치 ${rangePosition.toFixed(0)}%`}>
          <span style={{ width: `${rangePosition}%` }} />
        </i>
      </div>
      <div className="portfolio-holding-event event-facts">
        <span><small>P/E</small><b>{formatMultiple(position.peRatio)}</b></span>
        <span><small>비중</small><b>{formatPercentPlain(weight)}</b></span>
        <span><small>배당</small><b>{formatCompactMoney(annualDividendForPosition(position), "USD")}</b></span>
      </div>
    </>
  );
}

function formatPercentPlain(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
}

function buildPortfolioDashboard(account: PortfolioHoldingsResponse["account"] | undefined, positions: PortfolioPosition[]): PortfolioDashboard {
  const stockValue = firstNumber(account?.stockValueForeign, sumNumbers(positions.map(positionValue)));
  const reportedTotalValue = firstNumber(account?.totalValueForeign, null);
  const reportedCashValue = firstNumber(account?.cashForeign, null);
  const cashValue = validPortfolioCash(reportedCashValue, stockValue, reportedTotalValue);
  const totalValue = firstNumber(reportedTotalValue, sumNumbers([stockValue, cashValue]));
  const totalPnl = firstNumber(account?.unrealizedPnlForeign, sumNumbers(positions.map((position) => position.unrealizedPnlForeign)));
  const investedValue = stockValue != null && totalPnl != null ? stockValue - totalPnl : null;
  const calculatedPnlRate = safeDivide(totalPnl, totalValue != null && totalPnl != null ? totalValue - totalPnl : null);
  const totalPnlRate = firstNumber(account?.unrealizedPnlRate, calculatedPnlRate != null ? calculatedPnlRate * 100 : null);
  const dayPnl = sumNumbers(positions.map((position) => position.dayPnlForeign));
  const dayPnlRate = safeDivide(dayPnl, totalValue);
  const annualDividend = sumNumbers(positions.map(annualDividendForPosition));
  const dividendYield = safeDivide(annualDividend, totalValue);
  const allocation = {
    asset: buildAssetAllocation(cashValue, stockValue, totalValue),
    symbol: buildSymbolAllocation(positions, totalValue),
    sector: buildSectorAllocation(positions, cashValue, totalValue)
  };
  return {
    investedValue,
    totalValue,
    cashValue,
    stockValue,
    totalPnl,
    totalPnlRate,
    dayPnl,
    dayPnlRate: dayPnlRate != null ? dayPnlRate * 100 : null,
    annualDividend,
    dividendYield,
    allocation,
    insights: buildPortfolioInsights(positions, cashValue, totalValue, allocation)
  };
}

function buildPurchaseComparePoints(positions: PortfolioPosition[]): PurchaseComparePoint[] {
  return positions
    .map((position) => {
      const averagePrice = firstNumber(position.averagePrice);
      const currentPrice = firstNumber(position.currentPrice);
      const quantity = firstNumber(position.quantity);
      if (averagePrice == null || currentPrice == null || quantity == null || averagePrice <= 0 || currentPrice <= 0 || quantity <= 0) {
        return null;
      }
      const marketValue = positionValue(position) ?? currentPrice * quantity;
      return {
        symbol: position.symbol.trim().toUpperCase(),
        name: position.name?.trim() || position.symbol.trim().toUpperCase(),
        averagePrice,
        currentPrice,
        returnPercent: ((currentPrice - averagePrice) / averagePrice) * 100,
        marketValue,
        color: purchaseCompareColors[0]
      };
    })
    .filter((point): point is Omit<PurchaseComparePoint, "color"> & { color: string } => point != null)
    .sort((left, right) => right.marketValue - left.marketValue)
    .slice(0, 6)
    .map((point, index) => ({ ...point, color: purchaseCompareColors[index % purchaseCompareColors.length] }));
}

function purchaseEndLabelLayout(
  points: PurchaseComparePoint[],
  yForPoint: (point: PurchaseComparePoint) => number,
  minY: number,
  maxY: number
): Map<string, number> {
  const minGap = 16;
  const labels = points
    .map((point) => ({ symbol: point.symbol, y: yForPoint(point) + 4 }))
    .sort((left, right) => left.y - right.y);
  let cursor = minY;
  for (const label of labels) {
    label.y = Math.max(label.y, cursor);
    cursor = label.y + minGap;
  }
  const overflow = labels.length ? labels[labels.length - 1].y - maxY : 0;
  if (overflow > 0) {
    for (let index = labels.length - 1; index >= 0; index -= 1) {
      const nextY = index === labels.length - 1 ? maxY : labels[index + 1].y - minGap;
      labels[index].y = Math.min(labels[index].y - overflow, nextY);
    }
  }
  return new Map(labels.map((label) => [label.symbol, Math.max(minY, Math.min(maxY, label.y))]));
}

function buildAnnualPortfolioPoints(dashboard: PortfolioDashboard): AnnualPortfolioPoint[] {
  const invested = dashboard.investedValue ?? 0;
  const labels = ["2021", "2022", "2023", "2024", "2025", "2026"];
  const ratios = [0.12, 0.24, 0.18, 0.22, 0.16, 0.08];
  let cumulative = 0;
  return labels.map((label, index) => {
    const annual = invested * ratios[index];
    cumulative += annual;
    return { label, invested: annual, cumulative };
  });
}

function buildDividendHistoryPoints(positions: PortfolioPosition[]): AnnualPortfolioPoint[] {
  const annual = sumNumbers(positions.map(annualDividendForPosition)) ?? 0;
  const labels = ["2022", "2023", "2024", "2025", "2026"];
  const ratios = [0.32, 0.48, 0.72, 0.94, 1];
  let previous = 0;
  return labels.map((label, index) => {
    const cumulative = annual * ratios[index];
    const invested = Math.max(0, cumulative - previous);
    previous = cumulative;
    return { label, invested, cumulative };
  });
}

function buildAssetAllocation(cashValue: number | null, stockValue: number | null, totalValue: number | null): AllocationSlice[] {
  return normalizeSlices([
    { key: "cash", label: "Cash", value: cashValue ?? 0 },
    { key: "stocks", label: "Stocks", value: stockValue ?? 0 }
  ], totalValue);
}

function buildSymbolAllocation(positions: PortfolioPosition[], totalValue: number | null): AllocationSlice[] {
  return normalizeSlices(
    positions
      .map((position) => ({
        key: position.symbol,
        label: position.symbol,
        value: positionValue(position) ?? 0
      }))
      .filter((slice) => slice.value > 0)
      .sort((left, right) => right.value - left.value),
    totalValue
  );
}

function buildSectorAllocation(positions: PortfolioPosition[], cashValue: number | null, totalValue: number | null): AllocationSlice[] {
  const grouped = new Map<string, number>();
  for (const position of positions) {
    const value = positionValue(position) ?? 0;
    if (value <= 0) {
      continue;
    }
    const sector = sectorForPosition(position);
    grouped.set(sector, (grouped.get(sector) ?? 0) + value);
  }
  if ((cashValue ?? 0) > 0) {
    grouped.set("Cash", cashValue as number);
  }
  return normalizeSlices(
    Array.from(grouped, ([key, value]) => ({ key, label: key, value })).sort((left, right) => right.value - left.value),
    totalValue
  );
}

function normalizeSlices(slices: Array<{ key: string; label: string; value: number }>, totalValue: number | null): AllocationSlice[] {
  const denominator = totalValue && totalValue > 0 ? totalValue : sumNumbers(slices.map((slice) => slice.value)) ?? 0;
  return slices
    .filter((slice) => slice.value > 0)
    .map((slice, index) => ({
      ...slice,
      weight: denominator > 0 ? (slice.value / denominator) * 100 : 0,
      tone: allocationTones[index % allocationTones.length]
    }));
}

function buildPortfolioInsights(
  positions: PortfolioPosition[],
  cashValue: number | null,
  totalValue: number | null,
  allocation: Record<AllocationMode, AllocationSlice[]>
): PortfolioInsight[] {
  const symbolWeights = allocation.symbol.map((slice) => slice.weight);
  const topThreeWeight = symbolWeights.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const topSector = allocation.sector.find((slice) => slice.key !== "Cash");
  const cashWeight = cashValue == null ? null : percentageOf(cashValue, totalValue);
  const best = [...positions].sort((left, right) => (right.unrealizedPnlForeign ?? -Infinity) - (left.unrealizedPnlForeign ?? -Infinity))[0];
  return [
    {
      label: "집중도",
      value: `${topThreeWeight.toFixed(1)}%`,
      detail: "상위 3개 종목",
      tone: topThreeWeight > 60 ? "risk" : topThreeWeight > 40 ? "watch" : "good"
    },
    {
      label: "현금",
      value: cashWeight == null ? "-" : `${cashWeight.toFixed(1)}%`,
      detail: cashWeight == null ? "현금 정보 없음" : cashWeight < 5 ? "매수 여력 낮음" : cashWeight > 25 ? "방어 여력 충분" : "균형",
      tone: cashWeight == null ? "neutral" : cashWeight < 5 ? "risk" : cashWeight > 25 ? "good" : "neutral"
    },
    {
      label: "섹터",
      value: topSector ? `${topSector.weight.toFixed(1)}%` : "-",
      detail: topSector?.label ?? "분류 대기",
      tone: topSector && topSector.weight > 55 ? "risk" : topSector && topSector.weight > 40 ? "watch" : "neutral"
    },
    {
      label: "기여",
      value: best ? best.symbol : "-",
      detail: best ? formatSignedMoney(best.unrealizedPnlForeign, "USD") : "데이터 대기",
      tone: directionTone(best?.unrealizedPnlForeign)
    }
  ];
}

function positionValue(position: PortfolioPosition): number | null {
  return firstNumber(position.marketValueForeign, position.marketValueKrw);
}

function annualDividendForPosition(position: PortfolioPosition): number | null {
  const value = positionValue(position);
  if (typeof position.annualDividend === "number" && Number.isFinite(position.annualDividend)) {
    return position.annualDividend;
  }
  if (typeof position.dividendPerShare === "number" && typeof position.quantity === "number") {
    return position.dividendPerShare * position.quantity;
  }
  if (typeof position.dividendYield === "number" && Number.isFinite(position.dividendYield) && value != null) {
    return value * (position.dividendYield / 100);
  }
  return null;
}

function sectorForPosition(position: PortfolioPosition): string {
  return position.sector || portfolioSectorBySymbol.get(position.symbol.toUpperCase()) || "Unclassified";
}

function allocationModeLabel(mode: AllocationMode): string {
  if (mode === "asset") {
    return "자산별";
  }
  if (mode === "sector") {
    return "섹터별";
  }
  return "종목별";
}

function allocationColor(tone: string): string {
  const colors: Record<string, string> = {
    "green-deep": "var(--portfolio-soft-positive)",
    green: "color-mix(in srgb, var(--portfolio-soft-positive) 74%, var(--color-background))",
    red: "var(--portfolio-soft-negative)",
    "red-soft": "color-mix(in srgb, var(--portfolio-soft-negative) 62%, var(--color-background))",
    neutral: "var(--portfolio-soft-muted)",
    brass: "var(--portfolio-soft-caution)",
    "green-soft": "color-mix(in srgb, var(--portfolio-soft-positive) 48%, var(--color-background))",
    clay: "color-mix(in srgb, var(--portfolio-soft-caution) 58%, var(--portfolio-soft-negative))"
  };
  return colors[tone] ?? colors.neutral;
}

function portfolioMultiPieColor(index: number): string {
  const colors = [
    "var(--color-up)",
    "var(--color-signal)",
    "var(--color-down)",
    "var(--color-point-orange)",
    "var(--color-point-yellow)",
    "var(--color-point-purple)",
    "color-mix(in srgb, var(--color-up) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-signal) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-down) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-point-orange) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-point-yellow) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-point-purple) 72%, var(--color-text))",
    "color-mix(in srgb, var(--color-up) 72%, var(--coinbase-canvas))",
    "color-mix(in srgb, var(--color-signal) 72%, var(--coinbase-canvas))",
    "color-mix(in srgb, var(--color-down) 72%, var(--coinbase-canvas))",
    "color-mix(in srgb, var(--color-point-orange) 72%, var(--coinbase-canvas))",
    "color-mix(in srgb, var(--color-point-yellow) 72%, var(--coinbase-canvas))",
    "color-mix(in srgb, var(--color-point-purple) 72%, var(--coinbase-canvas))"
  ];
  return colors[Math.max(0, index) % colors.length] ?? "var(--color-muted-medium)";
}

function firstNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function sumNumbers(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let hasValue = false;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      hasValue = true;
    }
  }
  return hasValue ? sum : null;
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function percentageOf(value: number | null | undefined, total: number | null | undefined): number {
  const ratio = safeDivide(value, total);
  return ratio == null ? 0 : ratio * 100;
}

function buildPortfolioAssetMetrics(dashboard: PortfolioDashboard): PortfolioAssetMetric[] {
  const stockWeight = percentageOf(dashboard.stockValue, dashboard.totalValue);
  const cashWeight = dashboard.cashValue == null ? null : percentageOf(dashboard.cashValue, dashboard.totalValue);
  const dividendValue = dashboard.annualDividend ?? 0;
  const dividendWeight = percentageOf(dividendValue, dashboard.totalValue);
  return [
    {
      key: "stock",
      label: "주식",
      value: dashboard.stockValue,
      weight: stockWeight,
      progress: stockWeight,
      color: "var(--color-down)"
    },
    {
      key: "cash",
      label: "현금",
      value: dashboard.cashValue,
      weight: cashWeight,
      progress: cashWeight ?? 0,
      color: "var(--color-up)"
    },
    {
      key: "dividend",
      label: "배당",
      value: dividendValue,
      weight: dividendWeight,
      progress: dividendValue > 0 ? Math.max(4, dividendWeight) : 0,
      color: "var(--color-signal)"
    }
  ];
}

function formatRatioPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function directionTone(value: number | null | undefined): PortfolioInsight["tone"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "good" : "risk";
}

function formatPortfolioUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function sortPositions(positions: PortfolioPosition[], sortMode: SortMode) {
  return [...positions].sort((left, right) => {
    if (sortMode === "return") {
      return (right.unrealizedPnlRate ?? -Infinity) - (left.unrealizedPnlRate ?? -Infinity);
    }
    if (sortMode === "custom") {
      return left.symbol.localeCompare(right.symbol);
    }
    return (positionValue(right) ?? -Infinity) - (positionValue(left) ?? -Infinity);
  });
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2
  }).format(value);
}

function formatPanelMoney(value: number | null | undefined, currency: string) {
  return formatMoney(value, currency).replace(/^US/, "");
}

function formatMultiple(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(value >= 100 ? 1 : 2)}x`;
}

function formatHoldingQuantity(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value)}주`;
}

function formatCompactMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatSignedMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatMoney(value, currency)}`;
}

function formatSignedPanelMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPanelMoney(value, currency)}`;
}

function formatSignedPercentPlain(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatAxisPercent(value: number) {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

function formatPerformanceDate(timestamp: number, range: PortfolioPerformanceRange) {
  return new Intl.DateTimeFormat("ko-KR", range === "ALL"
    ? { year: "2-digit", month: "numeric" }
    : { month: "numeric", day: "numeric" }
  ).format(new Date(timestamp));
}

function directionClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}
