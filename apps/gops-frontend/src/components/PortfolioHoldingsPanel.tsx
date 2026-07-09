import { LoaderCircle, RefreshCcw } from "lucide-react";
import { type CSSProperties, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { parsePortfolioHoldingsApiResponse, type PortfolioHoldingsResponse, type PortfolioPosition } from "./portfolioHoldingsApi";
import { LogoDevAttribution } from "./StockLogo";

type SortMode = "custom" | "value" | "return";
type AllocationMode = "asset" | "symbol" | "sector";
type PerformanceView = "performance" | "purchase";
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

type PortfolioHistoryPoint = {
  label: string;
  invested: number;
  value: number;
  gain: number;
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

const REFRESH_INTERVAL_MS = 60_000;
const portfolioSectorBySymbol = new Map(sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.sector]));
const allocationTones = ["green-deep", "green", "red", "red-soft", "neutral", "brass", "green-soft", "clay"];
const purchaseCompareColors = [
  "var(--portfolio-soft-signal)",
  "var(--portfolio-soft-negative)",
  "var(--portfolio-soft-caution)",
  "var(--portfolio-soft-positive)",
  "var(--portfolio-soft-purple)",
  "var(--portfolio-soft-muted)"
];
const DEMO_PORTFOLIO_ENABLED =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));

type PortfolioHoldingsDataState = {
  payload: PortfolioHoldingsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

const portfolioStoreListeners = new Set<() => void>();
let portfolioStoreState: PortfolioHoldingsDataState = {
  payload: null,
  loading: true,
  refreshing: false,
  error: undefined
};
let portfolioStoreInflight: Promise<void> | null = null;
let portfolioStoreIntervalId: number | null = null;

function setPortfolioStoreState(next: Partial<PortfolioHoldingsDataState>): void {
  portfolioStoreState = { ...portfolioStoreState, ...next };
  portfolioStoreListeners.forEach((listener) => listener());
}

function loadPortfolioHoldingsStore(showRefreshing = false): Promise<void> {
  if (portfolioStoreInflight) {
    return portfolioStoreInflight;
  }
  setPortfolioStoreState({
    loading: showRefreshing ? portfolioStoreState.loading : portfolioStoreState.payload == null,
    refreshing: showRefreshing,
    error: undefined
  });
  portfolioStoreInflight = fetch("/api/account/holdings?market=overseas&currency=USD")
    .then(async (response) => {
      const nextPayload = await parsePortfolioHoldingsApiResponse(response);
      setPortfolioStoreState({ payload: nextPayload, loading: false, refreshing: false, error: undefined });
    })
    .catch((caught) => {
      if (DEMO_PORTFOLIO_ENABLED) {
        setPortfolioStoreState({
          payload: buildDemoPortfolioPayload(),
          loading: false,
          refreshing: false,
          error: undefined
        });
      } else {
        setPortfolioStoreState({
          loading: false,
          refreshing: false,
          error: caught instanceof Error ? caught.message : "보유종목을 불러오지 못했습니다."
        });
      }
    })
    .finally(() => {
      portfolioStoreInflight = null;
    });
  return portfolioStoreInflight;
}

function subscribePortfolioHoldingsStore(listener: () => void): () => void {
  portfolioStoreListeners.add(listener);
  if (portfolioStoreListeners.size === 1) {
    void loadPortfolioHoldingsStore(false);
    if (typeof window !== "undefined") {
      portfolioStoreIntervalId = window.setInterval(() => {
        void loadPortfolioHoldingsStore(true);
      }, REFRESH_INTERVAL_MS);
    }
  }
  return () => {
    portfolioStoreListeners.delete(listener);
    if (portfolioStoreListeners.size === 0 && portfolioStoreIntervalId != null) {
      window.clearInterval(portfolioStoreIntervalId);
      portfolioStoreIntervalId = null;
    }
  };
}

function usePortfolioHoldingsData(onPortfolioSymbolsChange?: (symbols: readonly string[]) => void) {
  const [state, setState] = useState<PortfolioHoldingsDataState>(portfolioStoreState);

  useEffect(() => {
    return subscribePortfolioHoldingsStore(() => setState(portfolioStoreState));
  }, []);

  useEffect(() => {
    if (state.payload) {
      onPortfolioSymbolsChange?.(state.payload.positions.map((position) => position.symbol));
    }
  }, [onPortfolioSymbolsChange, state.payload]);

  const positions = useMemo(() => sortPositions(state.payload?.positions ?? [], "value"), [state.payload?.positions]);
  const account = state.payload?.account;
  const dashboard = useMemo(() => buildPortfolioDashboard(account, state.payload?.positions ?? []), [account, state.payload?.positions]);
  const loadHoldings = useCallback(() => loadPortfolioHoldingsStore(true), []);
  return { payload: state.payload, loading: state.loading, refreshing: state.refreshing, error: state.error, positions, dashboard, loadHoldings };
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
  const [performanceView, setPerformanceView] = useState<PerformanceView>("purchase");
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
                  <span>Performance</span>
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
                <PortfolioPerformanceChart dashboard={dashboard} />
              ) : (
                <PortfolioPurchaseComparisonChart positions={positions} />
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
                <div className="portfolio-terminal-heading">
                  <span>Holdings</span>
                  <em>US Stocks</em>
                </div>
                <PortfolioHoldingsMatrix positions={positions} totalValue={dashboard.totalValue} onSelectSymbol={onSelectSymbol} />
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
  const { loading, error, positions, dashboard } = usePortfolioHoldingsData(onPortfolioSymbolsChange);
  const stockWeight = percentageOf(dashboard.stockValue, dashboard.totalValue);
  const cashWeight = percentageOf(dashboard.cashValue, dashboard.totalValue);
  const annualDividendValue = dashboard.annualDividend ?? 0;
  const dividendWeight = percentageOf(annualDividendValue, dashboard.totalValue);
  const [activeAllocationIndex, setActiveAllocationIndex] = useState(0);
  const [activeInvestmentPageIndex, setActiveInvestmentPageIndex] = useState(0);
  const investmentPageWheelLockRef = useRef(0);
  const allocationItems = [
    {
      key: "stock",
      label: "주식",
      value: dashboard.stockValue,
      progress: stockWeight,
      displayProgress: stockWeight,
      color: "var(--investment-bold-blue)"
    },
    {
      key: "cash",
      label: "현금",
      value: dashboard.cashValue,
      progress: cashWeight,
      displayProgress: cashWeight,
      color: "var(--investment-cash)"
    },
    {
      key: "dividend",
      label: "배당",
      value: annualDividendValue,
      progress: annualDividendValue > 0 ? Math.max(4, dividendWeight) : 0,
      displayProgress: dividendWeight,
      color: "var(--investment-dividend)"
    }
  ];
  const statusMessage = loading
    ? "투자현황을 불러오는 중입니다"
    : error || (!dashboard.totalValue ? "표시할 투자현황 데이터가 없습니다" : "");
  const activeAllocation = allocationItems[activeAllocationIndex] ?? allocationItems[0];
  const activeProgress = Math.min(100, Math.max(0, activeAllocation?.progress ?? 0));
  const symbolAllocation = dashboard.allocation.symbol ?? [];
  const selectedAllocation = symbolAllocation.length > 0 ? symbolAllocation : (dashboard.allocation.asset ?? []);
  const investmentPages = [
    {
      key: "summary",
      label: "투자현황",
      content: (
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
          <span className="portfolio-investment-subtitle">총 평가 자산</span>
          <div className="portfolio-investment-budget-track" aria-hidden="true">
            <i />
          </div>
          <div className="portfolio-investment-budget-meta">
            <span>
              <em>{activeAllocation?.label}</em>
              <strong>{formatCompactMoney(activeAllocation?.value ?? 0, "USD")}</strong>
            </span>
            <span>
              <em>비중</em>
              <strong>{formatPercentPlain(activeAllocation?.displayProgress ?? 0)}</strong>
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
      )
    },
    {
      key: "performance",
      label: "Performance",
      content: (
        <article className="portfolio-investment-bezel portfolio-investment-performance-bezel">
          <header className="portfolio-investment-bezel-header">
            <div>
              <strong>Performance</strong>
              <span>매수 비교</span>
            </div>
          </header>
          <div className="portfolio-investment-bezel-body">
            {positions.length > 0 ? (
              <PortfolioPurchaseComparisonChart positions={positions} />
            ) : (
              <PortfolioPanelStatus message="성과 데이터가 없습니다" loading={false} error={false} />
            )}
          </div>
        </article>
      )
    },
    {
      key: "diversification",
      label: "Diversification",
      content: (
        <article className="portfolio-investment-bezel portfolio-investment-diversification-bezel">
          <header className="portfolio-investment-bezel-header">
            <div>
              <strong>Diversification</strong>
              <span>종목 비중</span>
            </div>
          </header>
          <div className="portfolio-investment-bezel-body portfolio-investment-donut-bezel-body">
            {selectedAllocation.length > 0 ? (
              <div className="portfolio-terminal-donut-row">
                <PortfolioAllocationDonut slices={selectedAllocation} />
                <div className="portfolio-terminal-legend">
                  {selectedAllocation.slice(0, 8).map((slice) => (
                    <span key={slice.key}>
                      <i className={`tone-${slice.tone}`} />
                      <em>{slice.label}</em>
                      <strong>{slice.weight.toFixed(1)}%</strong>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <PortfolioPanelStatus message="구성 데이터가 없습니다" loading={false} error={false} />
            )}
          </div>
        </article>
      )
    },
    {
      key: "invested",
      label: "Invested",
      content: (
        <article className="portfolio-investment-bezel portfolio-investment-invested-bezel">
          <header className="portfolio-investment-bezel-header">
            <div>
              <strong>Invested</strong>
              <span>투입 원금</span>
            </div>
          </header>
          <div className="portfolio-split-kpi-row">
            <span>
              <em>원금</em>
              <strong>{formatMoney(dashboard.investedValue, "USD")}</strong>
            </span>
            <span>
              <em>평가금</em>
              <strong>{formatMoney(dashboard.stockValue, "USD")}</strong>
            </span>
          </div>
          <div className="portfolio-investment-bezel-body">
            {positions.length > 0 ? (
              <PortfolioAnnualBars dashboard={dashboard} />
            ) : (
              <PortfolioPanelStatus message="투자금 데이터가 없습니다" loading={false} error={false} />
            )}
          </div>
        </article>
      )
    },
    {
      key: "dividend",
      label: "Dividend",
      content: (
        <article className="portfolio-investment-bezel portfolio-investment-dividend-bezel">
          <header className="portfolio-investment-bezel-header">
            <div>
              <strong>Dividend</strong>
              <span>예상 배당</span>
            </div>
            <em>{formatRatioPercent(dashboard.dividendYield)}</em>
          </header>
          <div className="portfolio-split-kpi-row">
            <span>
              <em>연간</em>
              <strong>{formatMoney(dashboard.annualDividend, "USD")}</strong>
            </span>
            <span>
              <em>수익률</em>
              <strong>{formatRatioPercent(dashboard.dividendYield)}</strong>
            </span>
          </div>
          <div className="portfolio-investment-bezel-body">
            {positions.length > 0 ? (
              <PortfolioDividendHistory positions={positions} />
            ) : (
              <PortfolioPanelStatus message="배당 데이터가 없습니다" loading={false} error={false} />
            )}
          </div>
        </article>
      )
    }
  ];
  const activeInvestmentPage = investmentPages[activeInvestmentPageIndex] ?? investmentPages[0];
  const setInvestmentPage = (index: number) => {
    setActiveInvestmentPageIndex(Math.min(investmentPages.length - 1, Math.max(0, index)));
  };
  const handleInvestmentPageWheel = (event: WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaY) < 36) {
      return;
    }
    const movingDown = event.deltaY > 0;
    let scrollTarget = event.target instanceof HTMLElement ? event.target : null;
    while (scrollTarget && scrollTarget !== event.currentTarget) {
      const overflowY = window.getComputedStyle(scrollTarget).overflowY;
      const canScroll = /(auto|scroll|overlay)/.test(overflowY) && scrollTarget.scrollHeight > scrollTarget.clientHeight + 2;
      if (canScroll) {
        const atTop = scrollTarget.scrollTop <= 1;
        const atBottom = scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 1;
        if ((movingDown && !atBottom) || (!movingDown && !atTop)) {
          return;
        }
      }
      scrollTarget = scrollTarget.parentElement;
    }
    const pageScroller = event.currentTarget.querySelector<HTMLElement>(".portfolio-investment-page-window");
    if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 2) {
      const atTop = pageScroller.scrollTop <= 1;
      const atBottom = pageScroller.scrollTop + pageScroller.clientHeight >= pageScroller.scrollHeight - 1;
      if ((movingDown && !atBottom) || (!movingDown && !atTop)) {
        return;
      }
    }
    event.preventDefault();
    const now = Date.now();
    if (now < investmentPageWheelLockRef.current) {
      return;
    }
    investmentPageWheelLockRef.current = now + 520;
    setActiveInvestmentPageIndex((current) => {
      const next = current + (movingDown ? 1 : -1);
      return Math.min(investmentPages.length - 1, Math.max(0, next));
    });
  };

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
        <div className="portfolio-investment-window-shell" onWheel={handleInvestmentPageWheel}>
          <div className={`portfolio-investment-page-window is-${activeInvestmentPage.key}`} key={activeInvestmentPage.key}>
            {activeInvestmentPage.content}
          </div>
          <div className="portfolio-investment-page-controls" role="tablist" aria-label="투자현황 화면 전환">
            {investmentPages.map((page, index) => (
              <button
                key={page.key}
                type="button"
                role="tab"
                aria-selected={index === activeInvestmentPageIndex}
                className={index === activeInvestmentPageIndex ? "active" : ""}
                onClick={() => setInvestmentPage(index)}
              >
                <span>{page.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function PortfolioPerformancePanel() {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [performanceView, setPerformanceView] = useState<PerformanceView>("purchase");
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "성과 데이터가 없습니다");

  return (
    <section className="portfolio-split-panel portfolio-performance-split-panel portfolio-dashboard-panel" aria-label="포트폴리오 성과 패널">
      <PortfolioSplitHeader
        title="Performance"
        subtitle={performanceView === "performance" ? "Invested · Value · Gain" : "Average buy · Current return"}
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
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
          매수 비교
        </button>
      </div>
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : performanceView === "performance" ? (
        <PortfolioPerformanceChart dashboard={dashboard} />
      ) : (
        <PortfolioPurchaseComparisonChart positions={positions} />
      )}
    </section>
  );
}

export function PortfolioInvestedPanel() {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "투자금 데이터가 없습니다");

  return (
    <section className="portfolio-split-panel portfolio-invested-split-panel portfolio-dashboard-panel" aria-label="포트폴리오 투자금 패널">
      <PortfolioSplitHeader
        title="Invested"
        subtitle="Annual invested capital"
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
      />
      <div className="portfolio-split-kpi-row">
        <span>
          <em>투입 원금</em>
          <strong>{formatMoney(dashboard.investedValue, "USD")}</strong>
        </span>
        <span>
          <em>현재 평가금</em>
          <strong>{formatMoney(dashboard.stockValue, "USD")}</strong>
        </span>
      </div>
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <PortfolioAnnualBars dashboard={dashboard} />
      )}
    </section>
  );
}

export function PortfolioDividendPanel() {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "배당 데이터가 없습니다");

  return (
    <section className="portfolio-split-panel portfolio-dividend-split-panel portfolio-dashboard-panel" aria-label="포트폴리오 배당 패널">
      <PortfolioSplitHeader
        title="Dividend"
        subtitle="Expected annual income"
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
      />
      <div className="portfolio-split-kpi-row">
        <span>
          <em>예상 배당</em>
          <strong>{formatMoney(dashboard.annualDividend, "USD")}</strong>
        </span>
        <span>
          <em>Yield</em>
          <strong>{formatRatioPercent(dashboard.dividendYield)}</strong>
        </span>
      </div>
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <>
          <PortfolioDividendHistory positions={positions} />
          <div className="portfolio-dividend-leaders">
            {positions
              .map((position) => ({ position, dividend: annualDividendForPosition(position) ?? 0 }))
              .filter((item) => item.dividend > 0)
              .sort((left, right) => right.dividend - left.dividend)
              .slice(0, 4)
              .map(({ position, dividend }) => (
                <span key={position.symbol}>
                  <b>{position.symbol}</b>
                  <em>{formatCompactMoney(dividend, "USD")}</em>
                </span>
              ))}
          </div>
        </>
      )}
    </section>
  );
}

export function PortfolioDiversificationPanel() {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("symbol");
  const selectedAllocation = dashboard.allocation[allocationMode];
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "구성 데이터가 없습니다");

  return (
    <section className="portfolio-split-panel portfolio-diversification-split-panel portfolio-dashboard-panel" aria-label="포트폴리오 분산 패널">
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

export function PortfolioHoldingsOnlyPanel({
  onSelectSymbol
}: {
  onSelectSymbol: (symbol: string) => boolean;
}) {
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "보유종목이 없습니다");

  return (
    <section className="portfolio-split-panel portfolio-holdings-split-panel portfolio-dashboard-panel" aria-label="포트폴리오 보유종목 패널">
      <PortfolioSplitHeader
        title="Holdings"
        subtitle="US Stocks"
        asOf={payload?.asOf}
        refreshing={loading || refreshing}
        onRefresh={loadHoldings}
      />
      {statusMessage ? (
        <PortfolioPanelStatus message={statusMessage} loading={loading} error={Boolean(error)} />
      ) : (
        <PortfolioHoldingsMatrix positions={positions} totalValue={dashboard.totalValue} onSelectSymbol={onSelectSymbol} />
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

function PortfolioPerformanceChart({ dashboard }: { dashboard: PortfolioDashboard }) {
  const points = buildPortfolioHistoryPoints(dashboard);
  if (!points.length) {
    return <div className="portfolio-chart-empty"><span>성과 데이터 대기</span></div>;
  }
  const width = 620;
  const height = 320;
  const padding = { top: 20, right: 16, bottom: 34, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = points.flatMap((point) => [point.invested, point.value, point.gain, 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xFor = (index: number) => padding.left + (chartWidth * index) / Math.max(points.length - 1, 1);
  const yFor = (value: number) => padding.top + chartHeight - ((value - min) / span) * chartHeight;
  const pathFor = (key: "invested" | "value" | "gain") =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(point[key]).toFixed(1)}`).join(" ");

  return (
    <div className="portfolio-terminal-chart portfolio-performance-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="포트폴리오 성과 추이">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="portfolio-terminal-grid-line" />;
        })}
        <line x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} className="portfolio-terminal-zero-line" />
        <path d={pathFor("invested")} className="portfolio-terminal-line invested" />
        <path d={pathFor("value")} className="portfolio-terminal-line value" />
        <path d={pathFor("gain")} className="portfolio-terminal-line gain" />
        {points.map((point, index) => index % 2 === 0 || index === points.length - 1 ? (
          <text key={point.label} x={xFor(index)} y={height - 10} textAnchor="middle" className="portfolio-terminal-axis-label">{point.label}</text>
        ) : null)}
      </svg>
      <div className="portfolio-terminal-chart-legend">
        <span><i className="invested" />Invested</span>
        <span><i className="value" />Portfolio Value</span>
        <span><i className="gain" />Gain</span>
      </div>
    </div>
  );
}

function PortfolioPurchaseComparisonChart({ positions }: { positions: PortfolioPosition[] }) {
  const points = buildPurchaseComparePoints(positions);
  if (!points.length) {
    return <div className="portfolio-chart-empty"><span>매수 비교 데이터 대기</span></div>;
  }
  const width = 620;
  const height = 320;
  const padding = { top: 24, right: 92, bottom: 38, left: 54 };
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="평균 매수가 대비 현재가 수익률 비교">
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
          const isNvidia = point.symbol === "NVDA";
          return (
            <g key={point.symbol} className={`portfolio-purchase-series ${isNvidia ? "is-nvidia" : ""}`}>
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
      <div className="portfolio-purchase-legend" aria-label="보유종목 매수 비교">
        {points.map((point) => (
          <div key={point.symbol} className="portfolio-purchase-legend-row">
            <span>
              <i style={{ background: point.color }} />
              <strong className={point.symbol === "NVDA" ? "portfolio-nvda-symbol" : undefined}>{point.symbol}</strong>
              <em>{point.name}</em>
            </span>
            <span>{formatMoney(point.averagePrice, "USD")}</span>
            <span>{formatMoney(point.currentPrice, "USD")}</span>
            <b className={directionClass(point.returnPercent)}>{formatSignedPercentPlain(point.returnPercent)}</b>
          </div>
        ))}
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
  totalValue,
  onSelectSymbol
}: {
  positions: PortfolioPosition[];
  totalValue: number | null;
  onSelectSymbol: (symbol: string) => boolean;
}) {
  return (
    <div className="portfolio-matrix-table">
      <div className="portfolio-matrix-head">
        <span>Symbol</span>
        <span>P/E</span>
        <span>Low 52</span>
        <span>Price</span>
        <span>Unit Cost</span>
        <span>High 52</span>
        <span>Market Value</span>
        <span>Weight</span>
        <span>Gain</span>
        <span>Gain %</span>
        <span>Dividend</span>
        <span>Yield</span>
        <span>Last</span>
      </div>
      {positions.map((position) => {
        const valueTone = heatCellTone(position.unrealizedPnlRate);
        const dayTone = heatCellTone(position.dayPnlRate);
        return (
          <button key={position.symbol} className="portfolio-matrix-row" type="button" onClick={() => onSelectSymbol(position.symbol)}>
            <strong>{position.symbol}</strong>
            <span>{formatMultiple(position.peRatio)}</span>
            <span>{formatMoney(position.low52, "USD")}</span>
            <span>{formatMoney(position.currentPrice, "USD")}</span>
            <span>{formatMoney(position.averagePrice, "USD")}</span>
            <span>{formatMoney(position.high52, "USD")}</span>
            <span className="value-cell" style={portfolioValueCellStyle}>{formatPositionValue(position)}</span>
            <span>{formatWeight(positionValue(position), totalValue)}</span>
            <span className={valueTone} style={portfolioHeatCellStyle(position.unrealizedPnlRate)}>{formatSignedCompactMoney(position.unrealizedPnlForeign, "USD")}</span>
            <span className={valueTone} style={portfolioHeatCellStyle(position.unrealizedPnlRate)}>{formatSignedPercentPlain(position.unrealizedPnlRate)}</span>
            <span>{formatCompactMoney(annualDividendForPosition(position), "USD")}</span>
            <span>{formatSignedPercentPlain(dividendYieldForPosition(position))}</span>
            <span className={dayTone} style={portfolioHeatCellStyle(position.dayPnlRate)}>{formatLastChange(position)}</span>
          </button>
        );
      })}
    </div>
  );
}

function buildDemoPortfolioPayload(): PortfolioHoldingsResponse {
  const positions: PortfolioPosition[] = [
    {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      market: "overseas",
      exchange: "NASDAQ",
      currency: "USD",
      sector: "Technology",
      industry: "Semiconductors",
      quantity: 18,
      averagePrice: 148.42,
      currentPrice: 195.55,
      marketValueForeign: 3519.9,
      unrealizedPnlForeign: 848.34,
      unrealizedPnlRate: 31.75,
      dayPnlForeign: 25.74,
      dayPnlRate: 0.74,
      dividendYield: 0.02,
      dividendPerShare: 0.04,
      annualDividend: 0.72,
      peRatio: 69.41,
      epsTtm: 2.82,
      low52: 86.62,
      high52: 195.95
    },
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      market: "overseas",
      exchange: "NASDAQ",
      currency: "USD",
      sector: "Technology",
      industry: "Technology Hardware",
      quantity: 22,
      averagePrice: 178.1,
      currentPrice: 212.66,
      marketValueForeign: 4678.52,
      unrealizedPnlForeign: 760.32,
      unrealizedPnlRate: 19.41,
      dayPnlForeign: 61.38,
      dayPnlRate: 1.33,
      dividendYield: 0.47,
      dividendPerShare: 1.04,
      annualDividend: 22.88,
      peRatio: 33.24,
      epsTtm: 6.4,
      low52: 164.08,
      high52: 260.1
    },
    {
      symbol: "MSFT",
      name: "Microsoft Corporation",
      market: "overseas",
      exchange: "NASDAQ",
      currency: "USD",
      sector: "Technology",
      industry: "Systems Software",
      quantity: 12,
      averagePrice: 386.74,
      currentPrice: 423.18,
      marketValueForeign: 5078.16,
      unrealizedPnlForeign: 437.28,
      unrealizedPnlRate: 9.42,
      dayPnlForeign: -48.12,
      dayPnlRate: -0.94,
      dividendYield: 0.72,
      dividendPerShare: 3.32,
      annualDividend: 39.84,
      peRatio: 36.92,
      epsTtm: 11.46,
      low52: 344.79,
      high52: 468.35
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices, Inc.",
      market: "overseas",
      exchange: "NASDAQ",
      currency: "USD",
      sector: "Technology",
      industry: "Semiconductors",
      quantity: 16,
      averagePrice: 128.33,
      currentPrice: 141.9,
      marketValueForeign: 2270.4,
      unrealizedPnlForeign: 217.12,
      unrealizedPnlRate: 10.57,
      dayPnlForeign: -38.88,
      dayPnlRate: -1.68,
      dividendYield: 0,
      annualDividend: 0,
      peRatio: 118.25,
      epsTtm: 1.2,
      low52: 76.48,
      high52: 182.5
    },
    {
      symbol: "JPM",
      name: "JPMorgan Chase & Co.",
      market: "overseas",
      exchange: "NYSE",
      currency: "USD",
      sector: "Financial Services",
      industry: "Diversified Banks",
      quantity: 9,
      averagePrice: 199.2,
      currentPrice: 216.44,
      marketValueForeign: 1947.96,
      unrealizedPnlForeign: 155.16,
      unrealizedPnlRate: 8.65,
      dayPnlForeign: 14.49,
      dayPnlRate: 0.75,
      dividendYield: 2.25,
      dividendPerShare: 4.6,
      annualDividend: 41.4,
      peRatio: 12.11,
      epsTtm: 17.87,
      low52: 190.9,
      high52: 247.3
    },
    {
      symbol: "XOM",
      name: "Exxon Mobil Corporation",
      market: "overseas",
      exchange: "NYSE",
      currency: "USD",
      sector: "Energy",
      industry: "Integrated Oil & Gas",
      quantity: 11,
      averagePrice: 109.5,
      currentPrice: 113.22,
      marketValueForeign: 1245.42,
      unrealizedPnlForeign: 40.92,
      unrealizedPnlRate: 3.4,
      dayPnlForeign: 4.07,
      dayPnlRate: 0.33,
      dividendYield: 3.38,
      dividendPerShare: 3.96,
      annualDividend: 43.56,
      peRatio: 13.62,
      epsTtm: 8.31,
      low52: 97.8,
      high52: 126.34
    }
  ];
  const stockValueForeign = sumNumbers(positions.map(positionValue));
  const cashForeign = 1850;
  const totalValueForeign = sumNumbers([stockValueForeign, cashForeign]);
  const unrealizedPnlForeign = sumNumbers(positions.map((position) => position.unrealizedPnlForeign));
  const investedValue = totalValueForeign != null && unrealizedPnlForeign != null ? totalValueForeign - cashForeign - unrealizedPnlForeign : null;

  return {
    status: "ok",
    source: "demo-ui",
    asOf: new Date().toISOString(),
    account: {
      alias: "더미 포트폴리오",
      market: "overseas",
      currency: "USD",
      cashForeign,
      stockValueForeign,
      totalValueForeign,
      unrealizedPnlForeign,
      unrealizedPnlRate: investedValue ? (unrealizedPnlForeign ?? 0) / investedValue * 100 : null
    },
    positions,
    limitations: ["development demo payload"]
  };
}

function buildPortfolioDashboard(account: PortfolioHoldingsResponse["account"] | undefined, positions: PortfolioPosition[]): PortfolioDashboard {
  const stockValue = firstNumber(account?.stockValueForeign, sumNumbers(positions.map(positionValue)));
  const cashValue = firstNumber(account?.cashForeign, null);
  const totalValue = firstNumber(account?.totalValueForeign, sumNumbers([stockValue, cashValue]));
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

function buildPortfolioHistoryPoints(dashboard: PortfolioDashboard): PortfolioHistoryPoint[] {
  const investedNow = dashboard.investedValue ?? (dashboard.totalValue != null && dashboard.totalPnl != null ? dashboard.totalValue - dashboard.totalPnl : null);
  const valueNow = dashboard.totalValue;
  if (investedNow == null || valueNow == null || investedNow <= 0 || valueNow <= 0) {
    return [];
  }
  const gainNow = dashboard.totalPnl ?? valueNow - investedNow;
  const labels = ["2021", "2022", "2023", "2024", "2025", "2026"];
  const investedRatios = [0.18, 0.34, 0.52, 0.72, 0.88, 1];
  const valueRatios = [0.16, 0.31, 0.56, 0.66, 0.86, 1];
  const gainRatios = [-0.08, -0.03, 0.14, 0.04, 0.46, 1];
  return labels.map((label, index) => {
    const invested = investedNow * investedRatios[index];
    const value = valueNow * valueRatios[index];
    const gain = gainNow * gainRatios[index];
    return { label, invested, value, gain };
  });
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
  const cashWeight = percentageOf(cashValue, totalValue);
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
      value: `${cashWeight.toFixed(1)}%`,
      detail: cashWeight < 5 ? "매수 여력 낮음" : cashWeight > 25 ? "방어 여력 충분" : "균형",
      tone: cashWeight < 5 ? "risk" : cashWeight > 25 ? "good" : "neutral"
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

function dividendYieldForPosition(position: PortfolioPosition): number | null {
  if (typeof position.dividendYield === "number" && Number.isFinite(position.dividendYield)) {
    return position.dividendYield;
  }
  const dividend = annualDividendForPosition(position);
  const value = positionValue(position);
  const ratio = safeDivide(dividend, value);
  return ratio == null ? null : ratio * 100;
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

function formatWeight(value: number | null | undefined, total: number | null | undefined): string {
  const ratio = safeDivide(value, total);
  if (ratio == null) {
    return "-";
  }
  return `${(ratio * 100).toFixed(1)}%`;
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

function formatSignedCompactMoney(value: number | null | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatCompactMoney(value, currency)}`;
}

function formatSignedPercentPlain(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatPercentPlain(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatPositionValue(position: PortfolioPosition) {
  return formatMoney(positionValue(position), "USD");
}

function formatLastChange(position: PortfolioPosition) {
  const amount = formatSignedCompactMoney(position.dayPnlForeign, "USD");
  const percent = formatSignedPercentPlain(position.dayPnlRate);
  if (amount === "-" && percent === "-") {
    return "-";
  }
  if (amount === "-") {
    return percent;
  }
  if (percent === "-") {
    return amount;
  }
  return `${amount} ${percent}`;
}

function directionClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function heatCellTone(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "heat-neutral";
  }
  return value > 0 ? "heat-positive" : "heat-negative";
}

const portfolioValueCellStyle = {
  background:
    "linear-gradient(90deg, color-mix(in srgb, var(--portfolio-soft-caution) 9%, transparent), color-mix(in srgb, var(--portfolio-soft-caution) 3%, transparent))"
};

function portfolioHeatCellStyle(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return { background: "rgb(var(--gops-ink-rgb) / 0.04)" };
  }
  if (value > 0) {
    return {
      background:
        "linear-gradient(90deg, color-mix(in srgb, var(--portfolio-soft-positive) 9%, transparent), color-mix(in srgb, var(--portfolio-soft-positive) 3%, transparent))"
    };
  }
  return {
    background:
      "linear-gradient(90deg, color-mix(in srgb, var(--portfolio-soft-negative) 8%, transparent), color-mix(in srgb, var(--portfolio-soft-negative) 3%, transparent))"
  };
}
