import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCcw } from "lucide-react";
import { type CSSProperties, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { parsePortfolioHoldingsApiResponse, type PortfolioHoldingsResponse, type PortfolioPosition } from "./portfolioHoldingsApi";
import { subscribePortfolioRefresh } from "../simulator/simulatorApi";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

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
  weight: number;
  progress: number;
  color: string;
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
  "var(--color-point-yellow)",
  "var(--color-point-orange)",
  "var(--color-point-purple)",
  "var(--color-up)",
  "var(--color-down)",
  "var(--color-signal)"
];
const DEMO_PORTFOLIO_ENABLED =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
const activePortfolioRefreshIntervalMs = DEMO_PORTFOLIO_ENABLED ? 1_000 : REFRESH_INTERVAL_MS;

const portfolioMultiViews = [
  { id: "summary", title: "포트폴리오" },
  { id: "flow", title: "투자" },
  { id: "diversification", title: "분산투자" }
] as const;

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
let portfolioStoreRefreshQueued = false;
const portfolioSelectionListeners = new Set<() => void>();
type PortfolioSelectionState = { symbol: string | null; revision: number };
const emptyPortfolioSelection: PortfolioSelectionState = { symbol: null, revision: 0 };
let portfolioSelectionState = emptyPortfolioSelection;

export function selectPortfolioHoldingSymbol(symbol: string): void {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return;
  portfolioSelectionState = {
    symbol: normalized,
    revision: portfolioSelectionState.revision + 1
  };
  portfolioSelectionListeners.forEach((listener) => listener());
}

export function usePortfolioSelectedSymbol(): PortfolioSelectionState {
  return useSyncExternalStore(
    (listener) => {
      portfolioSelectionListeners.add(listener);
      return () => portfolioSelectionListeners.delete(listener);
    },
    () => portfolioSelectionState,
    () => emptyPortfolioSelection
  );
}

function setPortfolioStoreState(next: Partial<PortfolioHoldingsDataState>): void {
  portfolioStoreState = { ...portfolioStoreState, ...next };
  portfolioStoreListeners.forEach((listener) => listener());
}

function loadPortfolioHoldingsStore(showRefreshing = false): Promise<void> {
  if (portfolioStoreInflight) {
    portfolioStoreRefreshQueued ||= showRefreshing;
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
      if (portfolioStoreRefreshQueued) {
        portfolioStoreRefreshQueued = false;
        void loadPortfolioHoldingsStore(true);
      }
    });
  return portfolioStoreInflight;
}

function refreshPortfolioHoldingsStore(): void {
  void loadPortfolioHoldingsStore(true);
}

function subscribePortfolioHoldingsStore(listener: () => void): () => void {
  portfolioStoreListeners.add(listener);
  if (portfolioStoreListeners.size === 1) {
    void loadPortfolioHoldingsStore(false);
    if (typeof window !== "undefined") {
      portfolioStoreIntervalId = window.setInterval(() => {
        void loadPortfolioHoldingsStore(true);
      }, activePortfolioRefreshIntervalMs);
    }
  }
  return () => {
    portfolioStoreListeners.delete(listener);
    if (portfolioStoreListeners.size === 0 && typeof window !== "undefined") {
      if (portfolioStoreIntervalId != null) {
        window.clearInterval(portfolioStoreIntervalId);
        portfolioStoreIntervalId = null;
      }
    }
  };
}

export function usePortfolioHoldingsData(onPortfolioSymbolsChange?: (symbols: readonly string[]) => void) {
  const [state, setState] = useState<PortfolioHoldingsDataState>(portfolioStoreState);

  useEffect(() => {
    return subscribePortfolioHoldingsStore(() => setState(portfolioStoreState));
  }, []);

  useEffect(() => {
    return subscribePortfolioRefresh(refreshPortfolioHoldingsStore);
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
                  <strong>{formatCompactMoney(activeAllocation?.value ?? 0, "USD")} / {formatPercentPlain(activeAllocation?.weight ?? 0)}</strong>
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
  const { payload, loading, refreshing, error, positions, dashboard, loadHoldings } = usePortfolioHoldingsData();
  const [performanceView, setPerformanceView] = useState<PerformanceView>("purchase");
  const portfolioSelection = usePortfolioSelectedSymbol();
  const selectedPortfolioSymbol = portfolioSelection.symbol;
  const statusMessage = portfolioPanelStatusMessage(loading, error, positions.length, "성과 데이터가 없습니다");

  useEffect(() => {
    if (selectedPortfolioSymbol) setPerformanceView("purchase");
  }, [portfolioSelection.revision, selectedPortfolioSymbol]);

  return (
    <section
      className="portfolio-split-panel portfolio-performance-split-panel portfolio-dashboard-panel"
      aria-label="포트폴리오 성과 패널"
    >
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
            <strong>{formatCompactMoney(item.value ?? 0, "USD")}/{formatPercentPlain(item.weight)}</strong>
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

function PortfolioPerformanceChart({ dashboard }: { dashboard: PortfolioDashboard }) {
  const points = buildPortfolioHistoryPoints(dashboard);
  if (!points.length) {
    return <div className="portfolio-chart-empty"><span>성과 데이터 대기</span></div>;
  }
  const width = 720;
  const height = 300;
  const padding = { top: 18, right: 28, bottom: 36, left: 42 };
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
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="포트폴리오 성과 추이">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="portfolio-terminal-grid-line" />;
        })}
        <line x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} className="portfolio-terminal-zero-line" />
        <path d={pathFor("invested")} className="portfolio-terminal-line invested" />
        <path d={pathFor("value")} className="portfolio-terminal-line value" />
        <path d={pathFor("gain")} className="portfolio-terminal-line gain" />
        {points.flatMap((point, index) => ([
          <circle key={`${point.label}-invested`} cx={xFor(index)} cy={yFor(point.invested)} r="3.4" className="portfolio-terminal-point invested" />,
          <circle key={`${point.label}-value`} cx={xFor(index)} cy={yFor(point.value)} r="3.4" className="portfolio-terminal-point value" />,
          <circle key={`${point.label}-gain`} cx={xFor(index)} cy={yFor(point.gain)} r="3.4" className="portfolio-terminal-point gain" />
        ]))}
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
    },
    {
      symbol: "GOOGL", name: "Alphabet Inc.", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Communication Services", industry: "Interactive Media & Services", quantity: 8,
      averagePrice: 172.4, currentPrice: 184.3, marketValueForeign: 1474.4,
      unrealizedPnlForeign: 95.2, unrealizedPnlRate: 6.9, dayPnlForeign: 12.8, dayPnlRate: 0.88,
      dividendYield: 0, annualDividend: 0, peRatio: 24.18, epsTtm: 7.62, low52: 140.53, high52: 207.05
    },
    {
      symbol: "AMZN", name: "Amazon.com, Inc.", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Consumer Cyclical", industry: "Internet Retail", quantity: 7,
      averagePrice: 194.5, currentPrice: 187.2, marketValueForeign: 1310.4,
      unrealizedPnlForeign: -51.1, unrealizedPnlRate: -3.75, dayPnlForeign: -19.6, dayPnlRate: -1.47,
      dividendYield: 0, annualDividend: 0, peRatio: 31.74, epsTtm: 5.9, low52: 151.61, high52: 242.52
    },
    {
      symbol: "META", name: "Meta Platforms, Inc.", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Communication Services", industry: "Interactive Media & Services", quantity: 3,
      averagePrice: 612, currentPrice: 698.4, marketValueForeign: 2095.2,
      unrealizedPnlForeign: 259.2, unrealizedPnlRate: 14.12, dayPnlForeign: 28.5, dayPnlRate: 1.38,
      dividendYield: 0.3, dividendPerShare: 2.1, annualDividend: 6.3,
      peRatio: 27.36, epsTtm: 25.53, low52: 479.8, high52: 740.91
    },
    {
      symbol: "AVGO", name: "Broadcom Inc.", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Technology", industry: "Semiconductors", quantity: 4,
      averagePrice: 292.5, currentPrice: 326.8, marketValueForeign: 1307.2,
      unrealizedPnlForeign: 137.2, unrealizedPnlRate: 11.73, dayPnlForeign: -18.4, dayPnlRate: -1.39,
      dividendYield: 0.72, dividendPerShare: 2.36, annualDividend: 9.44,
      peRatio: 43.82, epsTtm: 7.46, low52: 138.1, high52: 329.4
    },
    {
      symbol: "TSLA", name: "Tesla, Inc.", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Consumer Cyclical", industry: "Auto Manufacturers", quantity: 5,
      averagePrice: 345, currentPrice: 318.6, marketValueForeign: 1593,
      unrealizedPnlForeign: -132, unrealizedPnlRate: -7.65, dayPnlForeign: 35.1, dayPnlRate: 2.25,
      dividendYield: 0, annualDividend: 0, peRatio: 171.29, epsTtm: 1.86, low52: 182, high52: 488.54
    },
    {
      symbol: "LLY", name: "Eli Lilly and Company", market: "overseas", exchange: "NYSE", currency: "USD",
      sector: "Healthcare", industry: "Drug Manufacturers - General", quantity: 2,
      averagePrice: 750, currentPrice: 789.5, marketValueForeign: 1579,
      unrealizedPnlForeign: 79, unrealizedPnlRate: 5.27, dayPnlForeign: -21.4, dayPnlRate: -1.34,
      dividendYield: 0.66, dividendPerShare: 5.2, annualDividend: 10.4,
      peRatio: 55.8, epsTtm: 14.15, low52: 623.78, high52: 972.53
    },
    {
      symbol: "V", name: "Visa Inc.", market: "overseas", exchange: "NYSE", currency: "USD",
      sector: "Financial Services", industry: "Credit Services", quantity: 6,
      averagePrice: 329, currentPrice: 351.2, marketValueForeign: 2107.2,
      unrealizedPnlForeign: 133.2, unrealizedPnlRate: 6.75, dayPnlForeign: 15.6, dayPnlRate: 0.75,
      dividendYield: 0.67, dividendPerShare: 2.36, annualDividend: 14.16,
      peRatio: 34.42, epsTtm: 10.2, low52: 252.7, high52: 375.51
    },
    {
      symbol: "COST", name: "Costco Wholesale Corporation", market: "overseas", exchange: "NASDAQ", currency: "USD",
      sector: "Consumer Defensive", industry: "Discount Stores", quantity: 2,
      averagePrice: 935, currentPrice: 1005, marketValueForeign: 2010,
      unrealizedPnlForeign: 140, unrealizedPnlRate: 7.49, dayPnlForeign: 18, dayPnlRate: 0.9,
      dividendYield: 0.52, dividendPerShare: 5.2, annualDividend: 10.4,
      peRatio: 58.74, epsTtm: 17.11, low52: 793, high52: 1078.23
    },
    {
      symbol: "HD", name: "The Home Depot, Inc.", market: "overseas", exchange: "NYSE", currency: "USD",
      sector: "Consumer Cyclical", industry: "Home Improvement Retail", quantity: 4,
      averagePrice: 389, currentPrice: 375.5, marketValueForeign: 1502,
      unrealizedPnlForeign: -54, unrealizedPnlRate: -3.47, dayPnlForeign: -12, dayPnlRate: -0.79,
      dividendYield: 2.45, dividendPerShare: 9.2, annualDividend: 36.8,
      peRatio: 25.47, epsTtm: 14.74, low52: 326.31, high52: 439.37
    },
    {
      symbol: "KO", name: "The Coca-Cola Company", market: "overseas", exchange: "NYSE", currency: "USD",
      sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", quantity: 15,
      averagePrice: 66.2, currentPrice: 70.4, marketValueForeign: 1056,
      unrealizedPnlForeign: 63, unrealizedPnlRate: 6.34, dayPnlForeign: 4.8, dayPnlRate: 0.46,
      dividendYield: 2.9, dividendPerShare: 2.04, annualDividend: 30.6,
      peRatio: 27.1, epsTtm: 2.6, low52: 60.62, high52: 74.38
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
  const cashWeight = percentageOf(dashboard.cashValue, dashboard.totalValue);
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
      progress: cashWeight,
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

function directionClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}
