import { ChartNoAxesCombined, ChevronRight, CircleDollarSign, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { fetchCandles } from "../chart/cdcClient";
import type { CandleDto } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";
import { fetchCompanyEarningsSeries, fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyEarningsSeriesPoint, CompanyFinancialSeriesPoint, Sp500UniverseItem } from "../market/sp500Universe.seed";
import { buildStockLogoUrl, stockLogoInitials } from "../market/stockLogo";
import { CANVAS_FONT_FAMILY, TYPE_ROLE } from "../theme/typography";
import { LogoDevAttribution } from "./StockLogo";
import {
  buildHistoricalValuationSeries,
  financialPriceRequestRange,
  perShareMetricsForPoint,
  type FinancialChartPoint,
  type FinancialPeriodMode,
  type HistoricalValuationPoint,
  type PerShareMetrics,
  type ValuationPricePoint
} from "./companyFinancialHistory";

export type { FinancialChartPoint, FinancialPeriodMode, ValuationPricePoint } from "./companyFinancialHistory";

type CompanySummaryPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
  view?: CompanyPanelView | "all";
  onEvidenceChange?: (evidence: CompanyJournalEvidence) => void;
  disableRemoteFetch?: boolean;
  valuationContent?: "combined" | "earnings" | "valuation";
  valuationPriceFixture?: ValuationPricePoint[];
  stabilityContent?: "stability" | "stability-dashboard";
  insightContext?: CompanyInsightContext | null;
};

type CompanyInfoRow = {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
  marketMetric?: CompanyInfoMarketMetricKey;
};

type CompanyInfoMarketMetricKey = "price" | "change" | "market-cap";

export type CompanyPanelView = "info" | "current" | "growth" | "valuation" | "profitability" | "stability";

const emptyValuationPriceFixture: ValuationPricePoint[] = [];

const companyMultiViews = [
  { id: "current", label: "현재 핵심", title: "현재 핵심", icon: Sparkles },
  { id: "growth", label: "성장", title: "성장", icon: ChartNoAxesCombined },
  { id: "profitability", label: "수익성", title: "수익성", icon: TrendingUp },
  { id: "stability", label: "안정성", title: "안정성", icon: ShieldCheck },
  { id: "valuation", label: "가치평가", title: "가치평가", icon: CircleDollarSign }
] as const;

type CompanyInsightContext = {
  date: string | null;
  summary: string;
  keywords: string[];
  priceChangePercent: number | null;
};

type CompanyAnalysisDevFixture = {
  item: Sp500UniverseItem;
  insightContext: CompanyInsightContext;
};

type CompanyInsightBlock = {
  title: string;
  keywords: string[];
  body: string;
};

type EarningsMetric = "eps" | "revenue";

type ValuationMetric = {
  label: string;
  valueLabel: string;
};

type FinancialTableRow = {
  label: string;
  values: string[];
  marker: "revenue" | "net-income" | "margin" | "operating-margin" | "net-margin" | "growth" | "roe" | "roa" | "fcf-margin" | "equity" | "liabilities" | "assets" | "debt-ratio" | "current-liability-ratio" | "noncurrent-liability-ratio" | "current-ratio" | "total-debt" | "interest-coverage" | "financial-cost-burden" | "net-debt" | "operating-cash-flow" | "free-cash-flow" | "eps" | "bps" | "sps" | "cps";
  yoy?: string;
};

type EarningsChartPoint = {
  period: string;
  periodEndDate?: string | null;
  actualEps?: number | null;
  estimatedEps?: number | null;
  actualRevenue?: number | null;
  estimatedRevenue?: number | null;
};

export type CompanyJournalEvidence = {
  financialSeries: FinancialChartPoint[];
  earningsSeries: EarningsChartPoint[];
  selectedFinancialPeriod?: string | null;
  financialPeriodMode?: FinancialPeriodMode;
};

const financialChartAxisTypography = {
  fontFamily: CANVAS_FONT_FAMILY,
  fontSize: `${TYPE_ROLE.caption.size}px`,
  fontWeight: TYPE_ROLE.caption.weight,
  letterSpacing: `${TYPE_ROLE.caption.letterSpacing}px`,
  lineHeight: TYPE_ROLE.caption.lineHeight,
  textTransform: TYPE_ROLE.caption.textTransform
} satisfies CSSProperties;

const defaultFinancialChartSize = { width: 620, height: 360 };
const financialChartPlot = { left: 92, right: 12, top: 10, bottom: 34 } as const;
const financialChartPlotAspectRatio = (620 - 112 - 20) / (360 - 10 - 34);
const COMPANY_ANALYSIS_DEV_FIXTURE_ENABLED = import.meta.env.DEV
  && import.meta.env.VITE_COMPANY_ANALYSIS_DEV_FIXTURE !== "false";

function useFinancialChartSize() {
  const [chart, setChart] = useState<SVGSVGElement | null>(null);
  const [size, setSize] = useState(defaultFinancialChartSize);
  const chartRef = useCallback((node: SVGSVGElement | null) => setChart(node), []);

  useEffect(() => {
    if (!chart) {
      return undefined;
    }
    const measure = () => {
      const bounds = chart.getBoundingClientRect();
      const measuredSize = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
      if (measuredSize.width < 180 || measuredSize.height < 100) {
        return;
      }
      const plotWidth = measuredSize.width - financialChartPlot.left - financialChartPlot.right;
      const proportionalHeight = financialChartPlot.top
        + financialChartPlot.bottom
        + plotWidth / financialChartPlotAspectRatio;
      const nextSize = {
        width: measuredSize.width,
        height: Math.min(measuredSize.height, Math.round(proportionalHeight))
      };
      setSize((current) => (
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      ));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(chart);
    return () => observer.disconnect();
  }, [chart]);

  return { chartRef, chartWidth: size.width, chartHeight: size.height };
}

export function CompanySummaryPanel({ symbol, item, items = [], view = "all", onEvidenceChange, disableRemoteFetch = false, valuationContent = "combined", valuationPriceFixture = emptyValuationPriceFixture, stabilityContent = "stability", insightContext = null }: CompanySummaryPanelProps) {
  const [earningsMetric, setEarningsMetric] = useState<EarningsMetric>("eps");
  const [financialPeriodMode, setFinancialPeriodMode] = useState<FinancialPeriodMode>("quarterly");
  const [selectedFinancialPeriod, setSelectedFinancialPeriod] = useState<string | null>(null);
  const [financialSeries, setFinancialSeries] = useState<CompanyFinancialSeriesPoint[] | null>(null);
  const [earningsSeriesFromApi, setEarningsSeriesFromApi] = useState<CompanyEarningsSeriesPoint[] | null>(null);
  const [valuationCandles, setValuationCandles] = useState<CandleDto[] | null>(null);
  const normalizedSymbol = symbol.toUpperCase();
  const companyName = item?.companyName || normalizedSymbol;
  const companyNameHeaderLines = splitCompanyNameForHeader(companyName);
  const companyTabTextWidthCh = Math.min(
    28,
    Math.max(10, ...companyNameHeaderLines.map((line) => Math.ceil(Array.from(line).length * 1.3) + 1))
  );
  const companyLogoBackdropUrl = useMemo(
    () => buildStockLogoUrl(normalizedSymbol, { size: 256 }),
    [normalizedSymbol]
  );
  const [failedCompanyLogoBackdropUrl, setFailedCompanyLogoBackdropUrl] = useState<string | null>(null);
  const price = item?.lastPrice ?? item?.layoutPrice ?? null;
  const marketCap = item?.marketCap ?? item?.layoutMarketCap ?? null;
  const sharesOutstanding = item?.sharesOutstanding
    ?? (Number.isFinite(marketCap ?? NaN) && Number.isFinite(price ?? NaN) && (price as number) > 0
      ? (marketCap as number) / (price as number)
      : null);
  const changePercent = item?.changePercent ?? null;
  const changeTone = changePercent == null ? "neutral" : changePercent > 0 ? "up" : changePercent < 0 ? "down" : "neutral";
  const comparison = buildComparison(normalizedSymbol, item, items);
  const baseFinancialSeries = useMemo(
    () => buildFinancialSeries(financialSeries?.length ? financialSeries : item?.financialSeries, item),
    [financialSeries, item]
  );
  const profitabilitySeries = useMemo(() => (
    financialPeriodMode === "annual" && !baseFinancialSeries.some(isAnnualFinancialPoint)
      ? aggregateQuarterlySeriesToAnnual(baseFinancialSeries)
      : baseFinancialSeries
  ), [baseFinancialSeries, financialPeriodMode]);
  const earningsActualSeries = useMemo(
    () => disableRemoteFetch ? buildFinancialSeries(item?.financialSeries, item) : [],
    [disableRemoteFetch, item]
  );
  const earningsSeries = useMemo(
    () => buildEarningsSeries(item, earningsActualSeries, earningsSeriesFromApi),
    [earningsActualSeries, earningsSeriesFromApi, item]
  );
  const valuationMetrics = useMemo(
    () => buildValuationMetrics(price, marketCap, item),
    [price, marketCap, item]
  );
  const valuationPrices = useMemo<ValuationPricePoint[]>(
    () => valuationPriceFixture.length
      ? valuationPriceFixture
      : (valuationCandles ?? []).map((candle) => ({ timestamp: candle.timestamp, close: candle.close })),
    [valuationCandles, valuationPriceFixture]
  );

  useEffect(() => {
    setFailedCompanyLogoBackdropUrl(null);
  }, [companyLogoBackdropUrl]);

  useEffect(() => {
    if (disableRemoteFetch) {
      setFinancialSeries([]);
      return undefined;
    }
    const controller = new AbortController();
    setFinancialSeries(null);
    fetchCompanyFinancialSeries(normalizedSymbol, controller.signal, {
      years: financialPeriodMode === "annual" ? 5 : 3,
      period: financialPeriodMode
    })
      .then((series) => setFinancialSeries(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFinancialSeries([]);
        }
      });
    return () => controller.abort();
  }, [disableRemoteFetch, financialPeriodMode, normalizedSymbol]);

  useEffect(() => {
    if (disableRemoteFetch) {
      setEarningsSeriesFromApi([]);
      return undefined;
    }
    const controller = new AbortController();
    setEarningsSeriesFromApi(null);
    fetchCompanyEarningsSeries(normalizedSymbol, controller.signal, { years: 3 })
      .then((series) => setEarningsSeriesFromApi(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setEarningsSeriesFromApi([]);
        }
    });
    return () => controller.abort();
  }, [disableRemoteFetch, normalizedSymbol]);

  useEffect(() => {
    if (disableRemoteFetch || valuationPriceFixture.length) {
      setValuationCandles([]);
      return undefined;
    }
    const range = financialPriceRequestRange(profitabilitySeries);
    if (!range) {
      setValuationCandles([]);
      return undefined;
    }
    const controller = new AbortController();
    setValuationCandles(null);
    fetchCandles({
      symbol: normalizedSymbol,
      interval: "1D",
      limit: 2000,
      from: range.from,
      to: range.to
    }, controller.signal)
      .then((response) => setValuationCandles(response.candles))
      .catch(() => {
        if (!controller.signal.aborted) setValuationCandles([]);
      });
    return () => controller.abort();
  }, [disableRemoteFetch, normalizedSymbol, profitabilitySeries, valuationPriceFixture.length]);

  useEffect(() => {
    if (selectedFinancialPeriod && !profitabilitySeries.some((point) => financialPointKey(point) === selectedFinancialPeriod)) {
      setSelectedFinancialPeriod(null);
    }
  }, [profitabilitySeries, selectedFinancialPeriod]);

  useEffect(() => {
    onEvidenceChange?.({
      financialSeries: profitabilitySeries,
      earningsSeries,
      selectedFinancialPeriod,
      financialPeriodMode
    });
  }, [earningsSeries, financialPeriodMode, onEvidenceChange, profitabilitySeries, selectedFinancialPeriod]);

  const infoRows: readonly CompanyInfoRow[] = [
    { label: "현재가", value: formatCompanyInfoPrice(price), marketMetric: "price" },
    { label: "등락률", value: formatCompanyInfoChange(changePercent), tone: changeTone, marketMetric: "change" },
    { label: "시가총액", value: formatCompanyInfoMarketCap(marketCap), marketMetric: "market-cap" },
    { label: "발행주식수", value: formatShares(sharesOutstanding) },
    { label: "거래소", value: "SIP" },
    { label: "섹터", value: item?.sector || "확인 중" },
    { label: "산업", value: item?.industry || "확인 중" },
    { label: "시장", value: formatMarket(item?.market, item?.country) }
  ];

  const infoSection = (
    <section
      className="company-info-section"
      aria-label={`${normalizedSymbol} 기본 기업정보`}
      style={{ "--company-tab-text-width": `${companyTabTextWidthCh}ch` } as CSSProperties}
    >
      {isCompanyAnalysisDevFixture(item) && <em className="company-analysis-dev-badge">DEV FIXTURE</em>}
      <div className="company-info-backdrop" aria-hidden="true">
        {companyLogoBackdropUrl && failedCompanyLogoBackdropUrl !== companyLogoBackdropUrl ? (
          <>
            <img
              className="company-info-backdrop-fill"
              src={companyLogoBackdropUrl}
              alt=""
              loading="lazy"
              referrerPolicy="origin"
              onError={() => setFailedCompanyLogoBackdropUrl(companyLogoBackdropUrl)}
            />
            <img
              className="company-info-backdrop-mark"
              src={companyLogoBackdropUrl}
              alt=""
              loading="lazy"
              referrerPolicy="origin"
              onError={() => setFailedCompanyLogoBackdropUrl(companyLogoBackdropUrl)}
            />
          </>
        ) : (
          <span>{stockLogoInitials(normalizedSymbol)}</span>
        )}
      </div>
      <strong className="company-info-tab-title" aria-label={companyName}>
        {companyNameHeaderLines.map((line) => <span key={line} aria-hidden="true">{line}</span>)}
      </strong>
      <div className="company-info-sheet">
        <dl className="company-info-grid">
          {infoRows.map(({ label, value, tone, marketMetric }) => {
            const missing = marketMetric !== undefined && value === companyInfoMissingValue;
            return (
              <div
                key={label}
                className={`company-info-cell${marketMetric ? " company-info-market-metric" : ""}${missing ? " is-missing" : ""}`}
                data-company-info-metric={marketMetric}
              >
                <dt><GlossaryText text={label} /></dt>
                <dd
                  className={tone ? `company-summary-value ${tone}` : "company-summary-value"}
                  aria-label={missing ? "확인 중" : undefined}
                >
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
  const valuationSection = (
    <ValuationPagedPanel
      key={normalizedSymbol}
      symbol={normalizedSymbol}
      metric={earningsMetric}
      onMetricChange={setEarningsMetric}
      series={earningsSeries}
      comparison={comparison}
      metrics={valuationMetrics}
      financialSeries={profitabilitySeries}
      periodMode={financialPeriodMode}
      selectedPeriod={selectedFinancialPeriod}
      onPeriodModeChange={(mode) => {
        setSelectedFinancialPeriod(null);
        setFinancialPeriodMode(mode);
      }}
      onPeriodSelect={setSelectedFinancialPeriod}
      contentMode={valuationContent}
      valuationPrices={valuationPrices}
    />
  );
  const profitabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 수익성 재무`}>
      <ProfitabilityDashboard
        series={profitabilitySeries}
        periodMode={financialPeriodMode}
        selectedPeriod={selectedFinancialPeriod}
        onPeriodModeChange={(mode) => {
          setSelectedFinancialPeriod(null);
          setFinancialPeriodMode(mode);
        }}
        onPeriodSelect={setSelectedFinancialPeriod}
      />
    </section>
  );
  const stabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 안정성`}>
      {stabilityContent === "stability-dashboard" ? (
        <StabilityDashboard
          financialSeries={profitabilitySeries}
          periodMode={financialPeriodMode}
          onPeriodModeChange={(mode) => {
            setSelectedFinancialPeriod(null);
            setFinancialPeriodMode(mode);
          }}
        />
      ) : <StabilityFinanceChart series={profitabilitySeries} />}
    </section>
  );

  if (view !== "all") {
    const activeSection = view === "info"
      ? infoSection
      : view === "valuation"
        ? valuationSection
        : view === "stability"
          ? stabilitySection
          : view === "profitability" || view === "growth" || view === "current"
          ? profitabilitySection
          : profitabilitySection;
    const insightBlocks = buildCompanyInsightBlocks({
      view,
      companyName,
      item,
      financialSeries: profitabilitySeries,
      insightContext
    });
    return (
      <section className={`company-summary-panel company-single-panel is-${view}`} aria-label={`${normalizedSymbol} ${companyPanelViewLabel(view)}`}>
        {view === "info" ? activeSection : (
          <section className="company-fundamental-section company-single-fundamental-section company-insight-detail-layout">
            <div className="company-insight-visual-column">
              {activeSection}
            </div>
            <CompanyInsightNarrative blocks={insightBlocks} />
          </section>
        )}
        <LogoDevAttribution className="panel-logo-attribution" />
      </section>
    );
  }

  return (
    <section className="company-summary-panel" aria-label={`${normalizedSymbol} 기업정보`}>
      {infoSection}

      <section className="company-fundamental-section" aria-label={`${normalizedSymbol} 투자지표와 비교`}>
        <div className="company-fundamental-grid">
          {valuationSection}
          {profitabilitySection}
          {stabilitySection}
        </div>
      </section>

      <p className="company-summary-note">
        {hasFundamentalShares(item)
          ? "시가총액은 현재가와 발행주식수로 계산합니다."
          : "재무 데이터가 없으면 기준 유니버스 값을 임시로 표시합니다."}
      </p>
      <LogoDevAttribution className="panel-logo-attribution" />
    </section>
  );
}

export function CompanyInfoPanel(props: CompanySummaryPanelProps) {
  return <CompanyPanelWithDevFixture {...props} view="info" />;
}

export function CompanyValuationPanel(props: CompanySummaryPanelProps) {
  return <CompanyPanelWithDevFixture {...props} view="valuation" />;
}

export function CompanyProfitabilityPanel(props: CompanySummaryPanelProps) {
  return <CompanyPanelWithDevFixture {...props} view="profitability" />;
}

export function CompanyStabilityPanel(props: CompanySummaryPanelProps) {
  return <CompanyPanelWithDevFixture {...props} view="stability" />;
}

export function CompanyMultiPanel(props: CompanySummaryPanelProps) {
  const [activeView, setActiveView] = useState<CompanyPanelView>("current");
  const [direction, setDirection] = useState<"next" | "previous">("next");
  const fixture = useCompanyAnalysisDevFixture(props.symbol);
  const fixtureItem = useMemo(
    () => mergeCompanyAnalysisFixtureItem(props.item, fixture?.item),
    [fixture?.item, props.item]
  );
  const fetchedInsightContext = useCompanyInsightContext(props.symbol);
  const insightContext = fixture?.insightContext ?? fetchedInsightContext;
  const activeIndex = companyMultiViews.findIndex((candidate) => candidate.id === activeView);
  const selectView = (index: number) => {
    const nextIndex = Math.max(0, Math.min(companyMultiViews.length - 1, index));
    const nextView = companyMultiViews[nextIndex];
    if (!nextView || nextView.id === activeView) {
      return;
    }
    setDirection(nextIndex > activeIndex ? "next" : "previous");
    setActiveView(nextView.id);
  };
  const companyName = fixtureItem?.companyName || props.symbol.toUpperCase();
  const heroText = insightContext?.summary || buildCompanyInsightFallbackHeadline(companyName, fixtureItem);

  return (
    <section className="company-multi-panel" aria-label={`${props.symbol.toUpperCase()} 기업 멀티패널`}>
      <header className="company-insight-hero">
        <div className="company-insight-brand" aria-label="GOPS AI 기업 요약">
          <span aria-hidden="true"><Sparkles /></span>
          <strong>gopsai</strong>
          {fixture && <em className="company-analysis-dev-badge">DEV FIXTURE</em>}
        </div>
        <p><GlossaryText text={heroText} /></p>
        {(insightContext?.keywords.length ?? 0) > 0 && (
          <div className="company-insight-keywords" aria-label="현재 핵심 키워드">
            {insightContext?.keywords.map((keyword) => <span key={keyword}><GlossaryText text={keyword} /></span>)}
          </div>
        )}
      </header>
      <div className="company-multi-tabs" role="tablist" aria-label="기업 분석 화면">
        {companyMultiViews.map((candidate, index) => {
          const Icon = candidate.icon;
          const selected = candidate.id === activeView;
          return (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "active" : ""}
              title={candidate.title}
              onClick={() => selectView(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectView(activeIndex - 1);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectView(activeIndex + 1);
                }
              }}
            >
              <Icon aria-hidden="true" />
              <span>{candidate.label}</span>
            </button>
          );
        })}
      </div>
      <div className="company-multi-stage">
        <div className={`company-multi-view is-${direction}`} role="tabpanel">
          <CompanySummaryPanel {...props} item={fixtureItem} view={activeView} insightContext={insightContext} />
        </div>
      </div>
    </section>
  );
}

function CompanyPanelWithDevFixture(props: CompanySummaryPanelProps) {
  const fixture = useCompanyAnalysisDevFixture(props.symbol);
  const fixtureItem = useMemo(
    () => mergeCompanyAnalysisFixtureItem(props.item, fixture?.item),
    [fixture?.item, props.item]
  );
  return <CompanySummaryPanel {...props} item={fixtureItem} />;
}

function useCompanyAnalysisDevFixture(symbol: string): CompanyAnalysisDevFixture | null {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [fixture, setFixture] = useState<CompanyAnalysisDevFixture | null>(null);

  useEffect(() => {
    let active = true;
    if (!COMPANY_ANALYSIS_DEV_FIXTURE_ENABLED) {
      setFixture(null);
      return () => {
        active = false;
      };
    }
    void import("./company-analysis/devFixture")
      .then(({ companyAnalysisDevFixture }) => {
        if (active) {
          setFixture(companyAnalysisDevFixture(normalizedSymbol));
        }
      })
      .catch(() => {
        if (active) {
          setFixture(null);
        }
      });
    return () => {
      active = false;
    };
  }, [normalizedSymbol]);

  return fixture;
}

function mergeCompanyAnalysisFixtureItem(
  item: Sp500UniverseItem | undefined,
  fixtureItem: Sp500UniverseItem | undefined
): Sp500UniverseItem | undefined {
  if (!fixtureItem) {
    return item;
  }
  return { ...item, ...fixtureItem };
}

function isCompanyAnalysisDevFixture(item: Sp500UniverseItem | undefined): boolean {
  return COMPANY_ANALYSIS_DEV_FIXTURE_ENABLED && item?.fundamentalsSource === "DEV FIXTURE";
}

function companyPanelViewLabel(view: CompanyPanelView): string {
  return companyMultiViews.find((candidate) => candidate.id === view)?.title ?? "기업정보";
}

const companyInsightContextCache = new Map<string, CompanyInsightContext | null>();

function useCompanyInsightContext(symbol: string): CompanyInsightContext | null {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [context, setContext] = useState<CompanyInsightContext | null>(() => (
    companyInsightContextCache.get(normalizedSymbol) ?? null
  ));

  useEffect(() => {
    if (!normalizedSymbol) {
      setContext(null);
      return undefined;
    }
    if (companyInsightContextCache.has(normalizedSymbol)) {
      setContext(companyInsightContextCache.get(normalizedSymbol) ?? null);
      return undefined;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol: normalizedSymbol, limit: "10", locale: "ko-KR" });
    void fetch(`/api/market/news/daily?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`company insight news ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        const next = companyInsightContextFromPayload(payload);
        companyInsightContextCache.set(normalizedSymbol, next);
        setContext(next);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        companyInsightContextCache.set(normalizedSymbol, null);
        setContext(null);
      });
    return () => controller.abort();
  }, [normalizedSymbol]);

  return context;
}

function companyInsightContextFromPayload(payload: unknown): CompanyInsightContext | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const summaries = (payload as { dailySummaries?: unknown }).dailySummaries;
  if (!Array.isArray(summaries)) {
    return null;
  }
  const latest = summaries.find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, unknown> | undefined;
  const summary = typeof latest?.summary === "string" ? latest.summary.trim() : "";
  if (!summary) {
    return null;
  }
  const keywords = Array.isArray(latest?.keyPoints)
    ? latest.keyPoints
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => compactInsightKeyword(value))
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .slice(0, 3)
    : [];
  const priceChange = latest?.priceChange && typeof latest.priceChange === "object" && !Array.isArray(latest.priceChange)
    ? latest.priceChange as Record<string, unknown>
    : null;
  const priceChangePercent = typeof priceChange?.changePercent === "number" && Number.isFinite(priceChange.changePercent)
    ? priceChange.changePercent
    : null;
  return {
    date: typeof latest?.date === "string" ? latest.date : null,
    summary,
    keywords,
    priceChangePercent
  };
}

function compactInsightKeyword(value: string): string {
  const normalized = value.trim().replace(/[.!?]+$/g, "");
  if (normalized.length <= 28) {
    return normalized;
  }
  const firstClause = normalized.split(/[,:;·]/)[0]?.trim() || normalized;
  return firstClause.length <= 28 ? firstClause : `${Array.from(firstClause).slice(0, 27).join("")}…`;
}

function buildCompanyInsightFallbackHeadline(companyName: string, item: Sp500UniverseItem | undefined): string {
  const business = item?.industry || item?.sectorLabelKo || item?.sector;
  if (business) {
    return `${companyName}은 ${business} 사업을 중심으로 움직입니다. 최신 뉴스와 SEC 재무 흐름이 실제 매출과 현금흐름으로 이어지는지 함께 확인하세요.`;
  }
  return `${companyName}의 최신 뉴스와 SEC 재무 흐름을 함께 확인하고 있습니다. 확인된 근거가 들어오는 순서대로 핵심 내용을 정리합니다.`;
}

function CompanyInsightNarrative({ blocks }: { blocks: CompanyInsightBlock[] }) {
  return (
    <aside className="company-insight-narrative" aria-label="GOPS AI 기업 해설">
      {blocks.map((block) => (
        <section key={block.title} className="company-insight-block">
          <h3><GlossaryText text={block.title} /></h3>
          {block.keywords.length > 0 && (
            <div className="company-insight-block-keywords">
              {block.keywords.map((keyword) => <span key={keyword}><GlossaryText text={keyword} /></span>)}
            </div>
          )}
          <p><GlossaryText text={block.body} /></p>
        </section>
      ))}
    </aside>
  );
}

function buildCompanyInsightBlocks({
  view,
  companyName,
  item,
  financialSeries,
  insightContext
}: {
  view: CompanyPanelView;
  companyName: string;
  item: Sp500UniverseItem | undefined;
  financialSeries: FinancialChartPoint[];
  insightContext: CompanyInsightContext | null;
}): CompanyInsightBlock[] {
  const points = financialSeries.filter((point) => (
    Number.isFinite(point.revenue ?? NaN) ||
    Number.isFinite(point.netIncome ?? NaN) ||
    Number.isFinite(point.totalEquity ?? NaN) ||
    Number.isFinite(point.totalLiabilities ?? NaN)
  ));
  const latest = points.at(-1);
  const previous = points.at(-2);
  const revenueGrowth = periodGrowth(latest?.revenue, previous?.revenue);
  const incomeGrowth = periodGrowth(latest?.netIncome, previous?.netIncome);
  const operatingMargin = safeDivide(latest?.operatingIncome, latest?.revenue);
  const netMargin = safeDivide(latest?.netIncome, latest?.revenue);
  const debtRatio = safeDivide(latest?.totalLiabilities, latest?.totalEquity);
  const freeCashFlow = latest?.freeCashFlow ?? item?.freeCashFlow ?? null;
  const displayedChange = insightContext?.priceChangePercent ?? item?.changePercent ?? null;
  const marketDate = insightContext?.date ? formatDate(insightContext.date) : "최신 시장 데이터";
  const businessKeywords = [item?.sectorLabelKo || item?.sector, item?.industry]
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);

  if (view === "current") {
    const stabilityLabel = financialStabilityLabel(debtRatio, freeCashFlow);
    return [
      {
        title: "현재 핵심",
        keywords: insightContext?.keywords.length ? insightContext.keywords : businessKeywords,
        body: insightContext?.summary || buildCompanyInsightFallbackHeadline(companyName, item)
      },
      {
        title: "최근 움직임",
        keywords: displayedChange == null ? ["가격 데이터 확인 중"] : [`${marketDate} ${formatPercent(displayedChange)}`],
        body: displayedChange == null
          ? "같은 거래일의 가격 자료가 준비되면 뉴스와 주가 움직임을 함께 설명합니다."
          : `${companyName}은 ${marketDate} 기준 ${displayedChange > 0 ? "상승" : displayedChange < 0 ? "하락" : "보합"}했습니다. 단일 거래일 움직임만으로 특정 뉴스가 직접 원인이라고 단정하지 않습니다.`
      },
      {
        title: "재무 안정성",
        keywords: [stabilityLabel, debtRatio == null ? "부채비율 확인 중" : `부채비율 ${formatRatioPercent(debtRatio)}`],
        body: stabilityNarrative(debtRatio, freeCashFlow)
      },
      {
        title: "앞으로 볼 것",
        keywords: watchKeywords(revenueGrowth, incomeGrowth, freeCashFlow),
        body: watchNarrative(revenueGrowth, incomeGrowth, freeCashFlow)
      }
    ];
  }

  if (view === "growth") {
    return [
      {
        title: "매출 성장",
        keywords: [revenueGrowth == null ? "분기 비교 자료 부족" : `최근 분기 ${formatSignedRatio(revenueGrowth)}`],
        body: growthNarrative("매출", revenueGrowth)
      },
      {
        title: "이익 동행",
        keywords: [incomeGrowth == null ? "순이익 비교 자료 부족" : `순이익 ${formatSignedRatio(incomeGrowth)}`],
        body: growthNarrative("순이익", incomeGrowth)
      },
      {
        title: "함께 확인할 것",
        keywords: ["매출", "순이익", "잉여현금흐름"],
        body: "매출 증가가 순이익과 잉여현금흐름 증가로 이어지는지 같은 기간으로 확인해야 성장의 질을 판단할 수 있습니다."
      }
    ];
  }

  if (view === "profitability") {
    return [
      {
        title: "본업 수익성",
        keywords: [operatingMargin == null ? "영업이익률 확인 중" : `영업이익률 ${formatRatioPercent(operatingMargin)}`],
        body: marginNarrative("영업이익률", operatingMargin)
      },
      {
        title: "최종 수익성",
        keywords: [netMargin == null ? "순이익률 확인 중" : `순이익률 ${formatRatioPercent(netMargin)}`],
        body: marginNarrative("순이익률", netMargin)
      },
      {
        title: "현금으로 남는가",
        keywords: [cashFlowKeyword(freeCashFlow)],
        body: cashFlowNarrative(freeCashFlow)
      }
    ];
  }

  if (view === "stability") {
    return [
      {
        title: "부채 부담",
        keywords: [debtRatio == null ? "부채비율 확인 중" : `부채비율 ${formatRatioPercent(debtRatio)}`],
        body: debtNarrative(debtRatio)
      },
      {
        title: "현금 완충력",
        keywords: [cashFlowKeyword(freeCashFlow)],
        body: cashFlowNarrative(freeCashFlow)
      },
      {
        title: "앞으로 볼 것",
        keywords: ["부채비율", "영업현금흐름", "잉여현금흐름"],
        body: "부채비율이 계속 높아지는지와 영업현금흐름이 투자와 부채 부담을 감당하는지를 함께 확인해야 합니다."
      }
    ];
  }

  const price = item?.lastPrice ?? item?.layoutPrice ?? null;
  const marketCap = item?.marketCap ?? item?.layoutMarketCap ?? null;
  const valuation = buildValuationMetrics(price, marketCap, item);
  return [
    {
      title: "이익 기준 가격",
      keywords: valuation.slice(0, 1).map((metric) => `${metric.label} ${metric.valueLabel}`),
      body: "PER은 현재 주가를 주당순이익과 비교합니다. 값 하나만으로 비싸거나 싸다고 단정하지 않고 성장률과 이익의 지속성을 함께 봅니다."
    },
    {
      title: "자본·매출 기준",
      keywords: valuation.slice(1, 3).map((metric) => `${metric.label} ${metric.valueLabel}`),
      body: "PBR과 PSR은 각각 자기자본과 매출에 비해 현재 기업가치가 어느 수준인지 보여줍니다. 업종이 다른 기업끼리 단순 비교하지 않습니다."
    },
    {
      title: "현금 기준",
      keywords: valuation.slice(3).map((metric) => `${metric.label} ${metric.valueLabel}`),
      body: "FCF Yield는 기업가치에 비해 잉여현금흐름이 얼마나 발생하는지 보여줍니다. 일시적인 현금 변동이 아닌 여러 분기 흐름을 함께 확인해야 합니다."
    }
  ];
}

function periodGrowth(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!Number.isFinite(current ?? NaN) || !Number.isFinite(previous ?? NaN) || previous === 0) {
    return null;
  }
  return ((current as number) - (previous as number)) / Math.abs(previous as number);
}

function financialStabilityLabel(debtRatio: number | null, freeCashFlow: number | null): string {
  if (debtRatio == null && !Number.isFinite(freeCashFlow ?? NaN)) return "판단 자료 부족";
  if ((debtRatio != null && debtRatio >= 2) || (freeCashFlow != null && freeCashFlow < 0)) return "주의";
  if (debtRatio != null && debtRatio >= 1) return "관찰";
  return "양호";
}

function stabilityNarrative(debtRatio: number | null, freeCashFlow: number | null): string {
  if (debtRatio == null && !Number.isFinite(freeCashFlow ?? NaN)) {
    return "부채와 현금흐름 자료가 충분하지 않아 현재 재무 안정성을 판단하기 어렵습니다.";
  }
  return `${debtNarrative(debtRatio)} ${cashFlowNarrative(freeCashFlow)}`;
}

function debtNarrative(debtRatio: number | null): string {
  if (debtRatio == null) return "총부채와 자기자본 자료가 충분하지 않아 부채비율을 계산하지 못했습니다.";
  if (debtRatio >= 2) return "총부채가 자기자본의 두 배 이상이어서 이자 부담과 현금흐름을 함께 점검해야 합니다.";
  if (debtRatio >= 1) return "총부채가 자기자본보다 커서 부채비율의 추가 상승 여부를 관찰해야 합니다.";
  return "총부채가 자기자본보다 낮아 현재 수치만 보면 부채 부담은 비교적 낮은 편입니다.";
}

function cashFlowKeyword(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "잉여현금흐름 확인 중";
  return (value as number) >= 0 ? "잉여현금흐름 플러스" : "잉여현금흐름 마이너스";
}

function cashFlowNarrative(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "잉여현금흐름 자료가 없어 실제 현금 완충력은 추가 확인이 필요합니다.";
  if ((value as number) >= 0) return "잉여현금흐름이 플러스여서 투자 이후에도 현금이 남는 흐름이 확인됩니다.";
  return "잉여현금흐름이 마이너스여서 투자 지출과 영업현금흐름의 변화를 확인해야 합니다.";
}

function growthNarrative(label: string, value: number | null): string {
  if (value == null) return `최근 두 분기의 ${label} 자료가 충분하지 않아 변화율을 계산하지 못했습니다.`;
  if (value > 0) return `최근 두 분기를 비교하면 ${label}이 증가했습니다. 다음 분기에도 같은 방향이 이어지는지 확인해야 합니다.`;
  if (value < 0) return `최근 두 분기를 비교하면 ${label}이 감소했습니다. 일시적인 변동인지 성장 둔화인지 다음 공시에서 확인해야 합니다.`;
  return `최근 두 분기의 ${label}은 큰 변화가 없었습니다.`;
}

function marginNarrative(label: string, value: number | null): string {
  if (value == null) return `${label}을 계산할 수 있는 재무 자료가 충분하지 않습니다.`;
  if (value >= 0.2) return `${label}이 20% 이상으로 현재 수치에서는 이익을 남기는 힘이 강한 편입니다.`;
  if (value < 0.05) return `${label}이 5%보다 낮아 비용 증가나 매출 둔화에 이익이 민감하게 움직일 수 있습니다.`;
  return `${label}이 플러스를 유지하고 있습니다. 여러 분기 동안 개선되는지 함께 확인해야 합니다.`;
}

function watchKeywords(revenueGrowth: number | null, incomeGrowth: number | null, freeCashFlow: number | null): string[] {
  const keywords = [
    revenueGrowth == null ? "매출 추세" : revenueGrowth >= 0 ? "매출 성장 유지" : "매출 둔화 확인",
    incomeGrowth == null ? "순이익 추세" : incomeGrowth >= 0 ? "순이익 동행" : "순이익 회복",
    cashFlowKeyword(freeCashFlow)
  ];
  return keywords;
}

function watchNarrative(revenueGrowth: number | null, incomeGrowth: number | null, freeCashFlow: number | null): string {
  if (revenueGrowth == null && incomeGrowth == null && !Number.isFinite(freeCashFlow ?? NaN)) {
    return "다음 공시에서 매출, 순이익, 잉여현금흐름이 함께 개선되는지 확인해야 합니다.";
  }
  return "다음 공시에서는 매출 변화가 순이익과 잉여현금흐름으로 이어지는지 확인해야 합니다. 세 지표가 함께 움직일 때 사업 변화의 지속성을 더 잘 판단할 수 있습니다.";
}

function splitCompanyNameForHeader(companyName: string): string[] {
  const normalizedName = companyName.trim();
  const words = normalizedName.split(/\s+/).filter(Boolean);
  if (normalizedName.length <= 20 || words.length < 2) {
    return [normalizedName];
  }

  let bestBreakIndex = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const firstLineLength = words.slice(0, index).join(" ").length;
    const secondLineLength = words.slice(index).join(" ").length;
    const difference = Math.abs(firstLineLength - secondLineLength);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestBreakIndex = index;
    }
  }

  return [words.slice(0, bestBreakIndex).join(" "), words.slice(bestBreakIndex).join(" ")];
}

function EarningsHistoryChart({ metric, series }: { metric: EarningsMetric; series: EarningsChartPoint[] }) {
  const points = series
    .map((point) => ({
      ...point,
      actual: metric === "eps" ? point.actualEps : normalizeRevenueForChart(point.actualRevenue),
      estimate: metric === "eps" ? point.estimatedEps : normalizeRevenueForChart(point.estimatedRevenue)
    }))
    .filter((point) => Number.isFinite(point.actual ?? NaN) || Number.isFinite(point.estimate ?? NaN));
  const values = points.flatMap((point) => [point.actual, point.estimate]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const minValue = values.length ? Math.min(0, ...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const paddedMax = maxValue === minValue ? maxValue + 1 : maxValue + (maxValue - minValue) * 0.16;
  const chartWidth = 620;
  const chartHeight = 238;
  const plot = { left: metric === "revenue" ? 74 : 48, right: 22, top: 24, bottom: 40 };
  const xStep = points.length > 1 ? (chartWidth - plot.left - plot.right) / (points.length - 1) : 0;
  const yFor = (value: number) => {
    const span = paddedMax - minValue || 1;
    return plot.top + (1 - (value - minValue) / span) * (chartHeight - plot.top - plot.bottom);
  };
  const yTicks = makeTicks(minValue, paddedMax, 5);

  return (
    <div className="company-earnings-history-card">
      <div className="company-earnings-legend" aria-label="실적 범례">
        <span><i className="estimate" />추정</span>
        <span><i className="beat" />예상치 상회</span>
        <span><i className="miss" />예상치 하회</span>
        <span><i className="match" />실적</span>
      </div>
      <svg className="company-earnings-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metric === "eps" ? "EPS" : "수익"} 실적 내역`}>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text x={0} y={y + 5}>{formatEarningsAxisValue(tick, metric)}</text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = points.length > 1 ? plot.left + xStep * index : chartWidth - plot.right - 22;
          const actual = Number.isFinite(point.actual ?? NaN) ? point.actual as number : null;
          const estimate = Number.isFinite(point.estimate ?? NaN) ? point.estimate as number : null;
          const tone = earningsTone(actual, estimate);
          const actualY = actual == null ? null : yFor(actual);
          const estimateY = estimate == null ? null : yFor(estimate);
          const hasComparison = actualY != null && estimateY != null;
          return (
            <g key={`${point.period}-${index}`} className="company-earnings-point" style={{ "--earnings-index": index } as CSSProperties}>
              {estimate != null && (
                <circle className="company-earnings-dot estimate" cx={x} cy={estimateY ?? 0} r={9} />
              )}
              {hasComparison && (
                <line
                  className={`company-earnings-surprise-stem ${tone}`}
                  x1={x}
                  x2={x}
                  y1={estimateY ?? 0}
                  y2={actualY ?? 0}
                  pathLength={1}
                />
              )}
              {actual != null && (
                <circle
                  className={`company-earnings-dot actual ${tone}`}
                  cx={x}
                  cy={actualY ?? 0}
                  r={8}
                  style={hasComparison ? { "--earnings-actual-offset-y": `${(estimateY ?? 0) - (actualY ?? 0)}px` } as CSSProperties : undefined}
                />
              )}
              {shouldShowPeriodLabel(index, points.length) && (
                <text className="company-earnings-period" x={x} y={chartHeight - 11}>{formatPeriod(point.period, point.periodEndDate)}</text>
              )}
            </g>
          );
        })}
        {!points.length && (
          <text className="company-earnings-empty" x={chartWidth / 2} y={chartHeight / 2}>실적 시계열 확인 중</text>
        )}
      </svg>
    </div>
  );
}

function ProfitabilityDashboard({
  series,
  periodMode,
  selectedPeriod,
  onPeriodModeChange,
  onPeriodSelect
}: {
  series: FinancialChartPoint[];
  periodMode: FinancialPeriodMode;
  selectedPeriod: string | null;
  onPeriodModeChange: (mode: FinancialPeriodMode) => void;
  onPeriodSelect: (period: string) => void;
}) {
  const points = series.filter(isRenderableProfitabilityPoint).slice(periodMode === "annual" ? -5 : -12);
  const tablePoints = points.slice(periodMode === "annual" ? -5 : -8);
  const selectedPoint = points.find((point) => financialPointKey(point) === selectedPeriod) ?? points.at(-1);
  return (
    <section className="company-profitability-dashboard" aria-label="수익성과 투자수익률">
      <header className="company-profitability-dashboard-header">
        <div>
          <strong>{selectedPoint ? formatFinancialSelectionLabel(selectedPoint, periodMode) : "재무 시계열"}</strong>
          <span>막대 또는 선의 점을 선택하면 기업저널 해석이 같은 기간으로 바뀝니다.</span>
        </div>
        <div className="company-financial-period-controls" role="group" aria-label="재무 표시 기간">
          <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>연간 5년</button>
          <button type="button" aria-pressed={periodMode === "quarterly"} onClick={() => onPeriodModeChange("quarterly")}>분기 12개</button>
        </div>
      </header>
      <div className="company-profitability-chart-grid">
        <ProfitGrowthChart points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
        <InvestmentReturnChart points={points} periodMode={periodMode} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
      </div>
      <div className="company-profitability-table-section">
        <div className="company-profitability-table-heading">
          <strong>기간별 핵심 수치</strong>
          <span>ROIC · 계산되지 않음</span>
        </div>
        <FinancialSeriesTable
          points={tablePoints}
          rows={buildProfitabilityDashboardRows(tablePoints, periodMode)}
          selectedPeriod={selectedPeriod}
          emptyLabel="수익성 재무 데이터 확인 중"
        />
      </div>
    </section>
  );
}

function ProfitGrowthChart({ points, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps) {
  return (
    <FinancialStaticChartCard
      title="수익 성장지표"
      legend={(
        <div className="company-profitability-legend" aria-label="수익 성장지표 범례">
          <span><i className="revenue" />매출액</span>
          <span><i className="operating-margin" />영업이익률</span>
          <span><i className="net-margin" />순이익률</span>
        </div>
      )}
    >
      <ProfitGrowthPlot points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
    </FinancialStaticChartCard>
  );
}

function ProfitGrowthPlot({ points, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps) {
  if (!points.length) return <div className="company-profitability-empty-card">재무 시계열 확인 중</div>;
  const moneyValues = points.map((point) => point.revenue).filter((value): value is number => Number.isFinite(value ?? NaN));
  const operatingMargins = points.map((point) => safeDivide(point.operatingIncome, point.revenue));
  const netMargins = points.map((point) => safeDivide(point.netIncome, point.revenue));
  const marginValues = [...operatingMargins, ...netMargins].filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1 });
  const marginDomain = paddedDomain(marginValues, { includeZero: true, fallbackMax: 0.3 });
  const chartWidth = 620;
  const chartHeight = 300;
  const plot = { left: 96, right: 54, top: 12, bottom: 38 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(8, Math.min(34, slot * 0.45));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, marginDomain, plot.top, innerHeight);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const operatingPath = financialLinePath(operatingMargins, xFor, ratioY);
  const netPath = financialLinePath(netMargins, xFor, ratioY);
  return (
    <svg className="company-profitability-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="매출액 영업이익률 순이익률 시계열">
      {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
        const y = moneyY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={plot.left - 10} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text></g>;
      })}
      {makeTicks(marginDomain.min, marginDomain.max, 5).map((tick) => <text key={`ratio-${tick}`} className="company-financial-axis-ratio" x={chartWidth - plot.right + 8} y={ratioY(tick) + 5}>{formatRatioPercent(tick)}</text>)}
      <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
      {points.map((point, index) => {
        const x = xFor(index);
        const key = financialPointKey(point);
        const revenue = Number.isFinite(point.revenue ?? NaN) ? point.revenue as number : null;
        return (
          <g
            key={`${key}-${index}`}
            className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`}
            onClick={() => onPeriodSelect(key)}
            onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}
          >
            {revenue != null && <rect className="company-profitability-bar revenue" x={x - barWidth / 2} y={Math.min(moneyY(revenue), zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - moneyY(revenue)))} rx={5} />}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>}
          </g>
        );
      })}
      {operatingPath && <path className="company-profitability-operating-line" d={operatingPath} />}
      {netPath && <path className="company-profitability-net-line" d={netPath} />}
      {points.flatMap((point, index) => financialRatioDots(point, index, [
        { key: "operating", value: operatingMargins[index], className: "company-profitability-operating-dot" },
        { key: "net", value: netMargins[index], className: "company-profitability-net-dot" }
      ], xFor, ratioY, selectedPeriod, onPeriodSelect))}
    </svg>
  );
}

function InvestmentReturnChart({ points, periodMode, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps & { periodMode: FinancialPeriodMode }) {
  const multiplier = periodMode === "quarterly" ? 4 : 1;
  const roe = points.map((point, index) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalEquity")));
  const roa = points.map((point, index) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalAssets")));
  const fcfMargin = points.map((point) => safeDivide(point.freeCashFlow, point.revenue));
  return (
    <FinancialStaticChartCard
      title="투자수익률"
      legend={(
        <div className="company-profitability-legend company-return-legend" aria-label="투자수익률 범례">
          <span><i className="net-income" />당기순이익</span>
          <span><i className="roe" />ROE</span>
          <span><i className="roa" />ROA</span>
          <span><i className="fcf-margin" />FCF Margin</span>
        </div>
      )}
    >
      <InvestmentReturnPlot points={points} ratios={{ roe, roa, fcfMargin }} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
    </FinancialStaticChartCard>
  );
}

function InvestmentReturnPlot({ points, ratios, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps & { ratios: ReturnRatios }) {
  if (!points.length) return <div className="company-profitability-empty-card">투자수익률 데이터 확인 중</div>;
  const moneyValues = points.map((point) => point.netIncome).filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = [...ratios.roe, ...ratios.roa, ...ratios.fcfMargin].filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1 });
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 0.3 });
  const chartWidth = 620;
  const chartHeight = 300;
  const plot = { left: 96, right: 54, top: 12, bottom: 38 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(8, Math.min(34, slot * 0.45));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  return (
    <svg className="company-profitability-plot company-return-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="당기순이익 ROE ROA FCF Margin 시계열">
      {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
        const y = moneyY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={plot.left - 10} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text></g>;
      })}
      {makeTicks(ratioDomain.min, ratioDomain.max, 5).map((tick) => <text key={`ratio-${tick}`} className="company-financial-axis-ratio" x={chartWidth - plot.right + 8} y={ratioY(tick) + 5}>{formatRatioPercent(tick)}</text>)}
      <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
      {points.map((point, index) => {
        const x = xFor(index);
        const key = financialPointKey(point);
        const netIncome = Number.isFinite(point.netIncome ?? NaN) ? point.netIncome as number : null;
        return (
          <g key={`${key}-${index}`} className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`} onClick={() => onPeriodSelect(key)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}>
            {netIncome != null && <rect className="company-return-bar net-income" x={x - barWidth / 2} y={Math.min(moneyY(netIncome), zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - moneyY(netIncome)))} rx={5} />}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>}
          </g>
        );
      })}
      <path className="company-return-line roe" d={financialLinePath(ratios.roe, xFor, ratioY)} />
      <path className="company-return-line roa" d={financialLinePath(ratios.roa, xFor, ratioY)} />
      <path className="company-return-line fcf-margin" d={financialLinePath(ratios.fcfMargin, xFor, ratioY)} />
      {points.flatMap((point, index) => financialRatioDots(point, index, [
        { key: "roe", value: ratios.roe[index], className: "company-return-dot roe" },
        { key: "roa", value: ratios.roa[index], className: "company-return-dot roa" },
        { key: "fcf", value: ratios.fcfMargin[index], className: "company-return-dot fcf-margin" }
      ], xFor, ratioY, selectedPeriod, onPeriodSelect))}
    </svg>
  );
}

function FinancialStaticChartCard({ title, children, legend }: { title: string; children: ReactNode; legend: ReactNode }) {
  return <section className="company-financial-static-card"><strong>{title}</strong>{children}{legend}</section>;
}

type FinancialInteractiveChartProps = {
  points: FinancialChartPoint[];
  selectedPeriod: string | null;
  onPeriodSelect: (period: string) => void;
};

type ReturnRatios = { roe: Array<number | null>; roa: Array<number | null>; fcfMargin: Array<number | null> };

function StabilityDashboard({
  financialSeries,
  periodMode,
  onPeriodModeChange
}: {
  financialSeries: FinancialChartPoint[];
  periodMode: FinancialPeriodMode;
  onPeriodModeChange: (mode: FinancialPeriodMode) => void;
}) {
  const points = financialSeries.filter(isRenderableStabilityPoint).slice(periodMode === "annual" ? -5 : -12);
  const tablePoints = points.slice(periodMode === "annual" ? -5 : -8);
  return (
    <section className="company-stability-dashboard" aria-label="재무 안정성">
      <header className="company-valuation-dashboard-header">
        <div>
          <strong>재무 안정성</strong>
          <span>자본·부채 구조와 단기 유동성, 이자 부담을 같은 기간으로 확인합니다.</span>
        </div>
        <div className="company-financial-period-controls" role="group" aria-label="안정성 표시 기간">
          <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>연간 5년</button>
          <button type="button" aria-pressed={periodMode === "quarterly"} onClick={() => onPeriodModeChange("quarterly")}>분기 12개</button>
        </div>
      </header>
      <div className="company-stability-dashboard-grid">
        <StabilityFinanceChart series={points} />
        <StabilityRatiosChart series={points} />
      </div>
      <section className="company-stability-dashboard-table" aria-label="안정성 기간별 수치">
        <div className="company-profitability-table-heading">
          <strong>안정성 수치</strong>
          <span>총부채, 이자성 부채와 순부채를 구분해 표시합니다.</span>
        </div>
        <FinancialSeriesTable
          points={tablePoints}
          rows={buildStabilityDashboardTableRows(tablePoints, periodMode)}
          emptyLabel="안정성 재무 데이터 확인 중"
        />
      </section>
    </section>
  );
}

function StabilityRatiosChart({ series }: { series: FinancialChartPoint[] }) {
  const points = series.filter(isRenderableStabilityRatiosPoint).slice(-12);
  const legend = (
    <div className="company-profitability-legend company-stability-ratios-legend" aria-label="안정성지표 범례">
      <span><i className="debt-ratio" />부채비율</span>
      <span><i className="current-liability-ratio" />유동부채비율</span>
      <span><i className="noncurrent-liability-ratio" />비유동부채비율</span>
    </div>
  );
  if (!points.length) {
    return (
      <FinancialChartShell
        className="company-stability-ratios-card"
        title="안정성지표"
        legend={legend}
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 비율 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">안정성 비율 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const debtRatios = points.map(debtRatioFor);
  const currentRatios = points.map(currentLiabilityRatioFor);
  const noncurrentRatios = points.map(noncurrentLiabilityRatioFor);
  const ratioValues = [...debtRatios, ...currentRatios, ...noncurrentRatios]
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 1 });
  const chartWidth = 620;
  const chartHeight = 360;
  const plot = { left: 78, right: 20, top: 10, bottom: 34 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / Math.max(1, points.length);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  return (
    <FinancialChartShell
      className="company-stability-ratios-card"
      title="안정성지표"
      legend={legend}
      table={<FinancialSeriesTable points={points.slice(-6)} rows={buildStabilityRatioTableRows(points.slice(-6))} />}
    >
      <svg className="company-profitability-plot company-stability-ratios-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="부채비율 유동부채비율 비유동부채비율 시계열">
        {makeTicks(ratioDomain.min, ratioDomain.max, 5).map((tick) => {
          const y = ratioY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text className="company-financial-axis-value" x={plot.left - 10} y={y + 5}>{formatRatioPercent(tick)}</text>
            </g>
          );
        })}
        {points.map((point, index) => shouldShowPeriodLabel(index, points.length)
          ? <text key={`${point.period}-${index}-label`} className="company-profitability-period" x={xFor(index)} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>
          : null)}
        <path className="company-stability-metric-line debt-ratio" d={financialLinePath(debtRatios, xFor, ratioY)} />
        <path className="company-stability-metric-line current-liability-ratio" d={financialLinePath(currentRatios, xFor, ratioY)} />
        <path className="company-stability-metric-line noncurrent-liability-ratio" d={financialLinePath(noncurrentRatios, xFor, ratioY)} />
        {points.flatMap((point, index) => [
          { key: "debt", value: debtRatios[index], className: "debt-ratio" },
          { key: "current", value: currentRatios[index], className: "current-liability-ratio" },
          { key: "noncurrent", value: noncurrentRatios[index], className: "noncurrent-liability-ratio" }
        ].map((metric) => Number.isFinite(metric.value ?? NaN)
          ? <circle key={`${point.period}-${index}-${metric.key}`} className={`company-stability-metric-dot ${metric.className}`} cx={xFor(index)} cy={ratioY(metric.value as number)} r={3.5} />
          : null))}
      </svg>
    </FinancialChartShell>
  );
}

function StabilityFinanceChart({ series }: { series: FinancialChartPoint[] }) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  const points = series
    .filter(isRenderableStabilityPoint)
    .slice(-12);
  const tablePoints = points.slice(-6);
  if (!points.length) {
    return (
      <FinancialChartShell
        className="company-stability-card"
        title="자본·부채 구조"
        legend={(
          <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
            <span><i className="equity" /><GlossaryText text="총자본" /></span>
            <span><i className="liabilities" /><GlossaryText text="총부채" /></span>
            <span><i className="debt-ratio" /><GlossaryText text="부채비율" /></span>
          </div>
        )}
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 재무 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">안정성 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const moneyValues = points.flatMap((point) => [point.totalEquity, point.totalLiabilities]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = points.map(debtRatioFor).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1, minFloor: 0 });
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 1 });
  const plot = financialChartPlot;
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = points.length ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(6, Math.min(18, slot * 0.28));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const ratioPath = points
    .map((point, index) => {
      const ratio = debtRatioFor(point);
      if (!Number.isFinite(ratio ?? NaN)) {
        return "";
      }
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${ratioY(ratio as number)}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <FinancialChartShell
      className="company-stability-card"
      title="자본·부채 구조"
      legend={(
        <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
          <span><i className="equity" /><GlossaryText text="총자본" /></span>
          <span><i className="liabilities" /><GlossaryText text="총부채" /></span>
          <span><i className="debt-ratio" /><GlossaryText text="부채비율" /></span>
        </div>
      )}
      table={<FinancialSeriesTable points={tablePoints} rows={buildStabilityTableRows(tablePoints)} />}
    >
      <svg ref={chartRef} className="company-profitability-plot company-stability-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="SEC 재무 안정성 시계열">
        {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
          const y = moneyY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text className="company-financial-axis-value" x={plot.left - 12} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text>
            </g>
          );
        })}
        <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
        {points.map((point, index) => {
          const x = xFor(index);
          const totalEquity = Number.isFinite(point.totalEquity ?? NaN) ? point.totalEquity as number : null;
          const totalLiabilities = Number.isFinite(point.totalLiabilities ?? NaN) ? point.totalLiabilities as number : null;
          return (
            <g key={`${point.period}-${index}`}>
              {totalEquity != null && (
                <rect
                  className="company-stability-bar equity"
                  x={x - barWidth - 2}
                  y={moneyY(totalEquity)}
                  width={barWidth}
                  height={Math.max(2, zeroY - moneyY(totalEquity))}
                  rx={5}
                />
              )}
              {totalLiabilities != null && (
                <rect
                  className="company-stability-bar liabilities"
                  x={x + 2}
                  y={moneyY(totalLiabilities)}
                  width={barWidth}
                  height={Math.max(2, zeroY - moneyY(totalLiabilities))}
                  rx={5}
                />
              )}
              {shouldShowPeriodLabel(index, points.length) && (
                <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>
              )}
            </g>
          );
        })}
        {ratioPath && <path className="company-stability-ratio-line" d={ratioPath} />}
        {points.map((point, index) => {
          const ratio = debtRatioFor(point);
          return Number.isFinite(ratio ?? NaN)
            ? <circle key={`${point.period}-${index}-debt-ratio`} className="company-stability-ratio-dot" cx={xFor(index)} cy={ratioY(ratio as number)} r={3.5} />
            : null;
        })}
      </svg>
    </FinancialChartShell>
  );
}

function FinancialChartShell({
  className,
  title,
  subtitle,
  children,
  legend,
  table
}: {
  className: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  legend: ReactNode;
  table: ReactNode;
}) {
  const [activePage, setActivePage] = useState<0 | 1>(0);
  return (
    <div className={`company-financial-chart-card ${className}`}>
      <div key={activePage} className={`company-analysis-page ${activePage === 0 ? "company-financial-overview-page" : "company-financial-detail-page"}`}>
        {activePage === 0 ? (
          <>
            <div className="company-financial-chart-copy">
              <strong><GlossaryText text={title} /></strong>
              {subtitle && <span>{subtitle}</span>}
            </div>
            {children}
            {legend}
          </>
        ) : (
          <>
            <div className="company-financial-chart-copy">
              <strong><GlossaryText text={title} /></strong>
            </div>
            {table}
          </>
        )}
      </div>
      <CompanyAnalysisPageNav label={title} onAdvance={() => setActivePage((page) => page === 0 ? 1 : 0)} />
    </div>
  );
}

function ValuationPagedPanel({
  symbol,
  metric,
  onMetricChange,
  series,
  comparison,
  metrics,
  financialSeries,
  periodMode,
  selectedPeriod,
  onPeriodModeChange,
  onPeriodSelect,
  contentMode,
  valuationPrices
}: {
  symbol: string;
  metric: EarningsMetric;
  onMetricChange: (metric: EarningsMetric) => void;
  series: EarningsChartPoint[];
  comparison: ReturnType<typeof buildComparison>;
  metrics: ValuationMetric[];
  financialSeries: FinancialChartPoint[];
  periodMode: FinancialPeriodMode;
  selectedPeriod: string | null;
  onPeriodModeChange: (mode: FinancialPeriodMode) => void;
  onPeriodSelect: (period: string) => void;
  contentMode: "combined" | "earnings" | "valuation";
  valuationPrices: ValuationPricePoint[];
}) {
  const points = financialSeries.filter(isRenderablePerSharePoint).slice(periodMode === "annual" ? -5 : -12);
  const tablePoints = points.slice(periodMode === "annual" ? -5 : -8);
  const selectedPoint = points.find((point) => financialPointKey(point) === selectedPeriod) ?? points.at(-1);
  const historicalValuationSeries = buildHistoricalValuationSeries(points, valuationPrices);
  const showEarnings = contentMode !== "valuation";
  const showValuation = contentMode !== "earnings";
  return (
    <section className={`company-chart-column company-valuation-column company-valuation-dashboard is-${contentMode}`} aria-label={`${symbol} ${contentMode === "earnings" ? "실적" : contentMode === "valuation" ? "가치평가" : "실적과 가치평가"}`}>
      {showValuation && (
        <header className="company-valuation-dashboard-header">
          <div>
            <strong>{selectedPoint ? formatFinancialSelectionLabel(selectedPoint, periodMode) : "가치"}</strong>
            <span>주당지표의 변화와 현재 가격 기준 가치지표를 함께 봅니다.</span>
          </div>
          <div className="company-financial-period-controls" role="group" aria-label="가치지표 표시 기간">
            <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>연간 5년</button>
            <button type="button" aria-pressed={periodMode === "quarterly"} onClick={() => onPeriodModeChange("quarterly")}>분기 12개</button>
          </div>
        </header>
      )}
      {showEarnings && (
        <div className={showValuation ? "company-valuation-dashboard-grid" : "company-earnings-only-view"}>
          <EarningsPanel
            metric={metric}
            onMetricChange={onMetricChange}
            series={series}
            comparison={comparison}
          />
          {showValuation && <PerShareIndicatorsChart points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />}
        </div>
      )}
      {showValuation && !showEarnings && (
        <div className="company-valuation-dashboard-grid is-valuation-only">
          <PerShareIndicatorsChart points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
          <HistoricalValuationChart points={historicalValuationSeries} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
        </div>
      )}
      {showValuation && (
        <div className={`company-valuation-dashboard-detail ${!showEarnings ? "is-valuation-only" : ""}`}>
          <ValuationMetricsPanel metrics={metrics} />
          <section className="company-per-share-table-section" aria-label="기간별 주당지표 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 주당지표</strong>
              <span>EPS · BPS · SPS · CPS</span>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildPerShareTableRows(tablePoints, periodMode)}
              selectedPeriod={selectedPeriod}
              emptyLabel="주당지표 데이터 확인 중"
            />
          </section>
        </div>
      )}
    </section>
  );
}

function PerShareIndicatorsChart({ points, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps) {
  return (
    <FinancialStaticChartCard
      title="주당지표"
      legend={(
        <div className="company-profitability-legend company-per-share-legend" aria-label="주당지표 범례">
          <span><i className="eps" />EPS</span>
          <span><i className="bps" />BPS</span>
          <span><i className="sps" />SPS</span>
          <span><i className="cps" />CPS</span>
        </div>
      )}
    >
      <PerShareIndicatorsPlot points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
    </FinancialStaticChartCard>
  );
}

function HistoricalValuationChart({
  points,
  selectedPeriod,
  onPeriodSelect
}: {
  points: HistoricalValuationPoint[];
  selectedPeriod: string | null;
  onPeriodSelect: (period: string) => void;
}) {
  return (
    <FinancialStaticChartCard
      title="가치지표"
      legend={(
        <div className="company-profitability-legend company-historical-valuation-legend" aria-label="가치지표 범례">
          <span><i className="per" />PER</span>
          <span><i className="pbr" />PBR</span>
          <span><i className="psr" />PSR</span>
        </div>
      )}
    >
      <HistoricalValuationPlot points={points} selectedPeriod={selectedPeriod} onPeriodSelect={onPeriodSelect} />
    </FinancialStaticChartCard>
  );
}

function HistoricalValuationPlot({
  points,
  selectedPeriod,
  onPeriodSelect
}: {
  points: HistoricalValuationPoint[];
  selectedPeriod: string | null;
  onPeriodSelect: (period: string) => void;
}) {
  const per = points.map((point) => point.per);
  const pbr = points.map((point) => point.pbr);
  const psr = points.map((point) => point.psr);
  const values = [...per, ...pbr, ...psr].filter((value): value is number => Number.isFinite(value ?? NaN));
  if (!points.length || !values.length) return <div className="company-profitability-empty-card">결산일 가격 데이터 확인 중</div>;
  const domain = paddedDomain(values, { includeZero: true, fallbackMax: 10, minFloor: 0 });
  const chartWidth = 620;
  const chartHeight = 300;
  const plot = { left: 70, right: 24, top: 12, bottom: 38 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const multipleY = (value: number) => valueToY(value, domain, plot.top, innerHeight);
  const seriesDefinitions = [
    { key: "per", values: per, className: "per" },
    { key: "pbr", values: pbr, className: "pbr" },
    { key: "psr", values: psr, className: "psr" }
  ] as const;
  return (
    <svg className="company-profitability-plot company-historical-valuation-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="결산일 가격 기준 PER PBR PSR 시계열">
      {makeTicks(domain.min, domain.max, 5).map((tick) => {
        const y = multipleY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={plot.left - 10} y={y + 5}>{formatMultipleAxis(tick)}</text></g>;
      })}
      {seriesDefinitions.map((definition) => (
        <path key={definition.key} className={`company-historical-valuation-line ${definition.className}`} d={financialLinePath(definition.values, xFor, multipleY)} />
      ))}
      {points.map((point, index) => {
        const periodKey = financialPointKey(point.financial);
        return (
          <g key={`${periodKey}-${index}`} className={`company-financial-period-point ${periodKey === selectedPeriod ? "is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${formatPeriod(point.financial.period, point.financial.periodEndDate)} 가치지표 선택`} onClick={() => onPeriodSelect(periodKey)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(periodKey))}>
            {seriesDefinitions.map((definition) => {
              const value = definition.values[index];
              if (!Number.isFinite(value ?? NaN)) return null;
              return <circle key={definition.key} className={`company-historical-valuation-dot ${definition.className} ${periodKey === selectedPeriod ? "is-selected" : ""}`} cx={xFor(index)} cy={multipleY(value as number)} r={periodKey === selectedPeriod ? 5 : 3.8}><title>{`${formatPeriod(point.financial.period, point.financial.periodEndDate)} · ${definition.key.toUpperCase()} ${formatMultiple(value)}`}</title></circle>;
            })}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={xFor(index)} y={chartHeight - 12}>{formatPeriod(point.financial.period, point.financial.periodEndDate)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function PerShareIndicatorsPlot({ points, selectedPeriod, onPeriodSelect }: FinancialInteractiveChartProps) {
  if (!points.length) return <div className="company-profitability-empty-card">주당지표 시계열 확인 중</div>;
  const metrics = points.map(perShareMetricsForPoint);
  const values = metrics.flatMap((point) => [point.eps, point.bps, point.sps, point.cps]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const domain = paddedDomain(values, { includeZero: true, fallbackMax: 1 });
  const chartWidth = 620;
  const chartHeight = 300;
  const plot = { left: 76, right: 20, top: 12, bottom: 38 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(4, Math.min(15, slot * 0.17));
  const zeroY = valueToY(0, domain, plot.top, innerHeight);
  const valueY = (value: number) => valueToY(value, domain, plot.top, innerHeight);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const seriesDefinitions = [
    { key: "eps", className: "eps", offset: -1.5 },
    { key: "bps", className: "bps", offset: -0.5 },
    { key: "sps", className: "sps", offset: 0.5 },
    { key: "cps", className: "cps", offset: 1.5 }
  ] as const;
  return (
    <svg className="company-profitability-plot company-per-share-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="EPS BPS SPS CPS 주당지표 시계열">
      {makeTicks(domain.min, domain.max, 5).map((tick) => {
        const y = valueY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={plot.left - 10} y={y + 5}>{formatPerShareAxis(tick)}</text></g>;
      })}
      <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
      {points.map((point, index) => {
        const x = xFor(index);
        const key = financialPointKey(point);
        const valuesForPoint = metrics[index]!;
        return (
          <g key={`${key}-${index}`} className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`} onClick={() => onPeriodSelect(key)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}>
            {seriesDefinitions.map((definition) => {
              const value = valuesForPoint[definition.key];
              if (!Number.isFinite(value ?? NaN)) return null;
              const y = valueY(value as number);
              return <rect key={definition.key} className={`company-per-share-bar ${definition.className}`} x={x + definition.offset * barWidth - barWidth / 2} y={Math.min(y, zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - y))} rx={3} />;
            })}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function CompanyAnalysisPageNav({ label, onAdvance }: { label: string; onAdvance: () => void }) {
  return (
    <div className="company-analysis-page-nav">
      <button type="button" aria-label={`다음 ${label} 페이지`} onClick={onAdvance}>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

function EarningsPanel({
  metric,
  onMetricChange,
  series,
  comparison
}: {
  metric: EarningsMetric;
  onMetricChange: (metric: EarningsMetric) => void;
  series: EarningsChartPoint[];
  comparison: ReturnType<typeof buildComparison>;
}) {
  return (
    <section className="company-earnings-panel" aria-label="실적 내역">
      <div className="company-earnings-heading">
        <h3><GlossaryText text="실적 내역" /></h3>
        <div className="company-earnings-tabs" role="tablist" aria-label="실적 지표">
          <button type="button" className={metric === "eps" ? "active" : ""} onClick={() => onMetricChange("eps")}><GlossaryText text="EPS" /></button>
          <button type="button" className={metric === "revenue" ? "active" : ""} onClick={() => onMetricChange("revenue")}><GlossaryText text="매출" /></button>
        </div>
      </div>
      <EarningsHistoryChart metric={metric} series={series} />
      <dl className="company-earnings-summary">
        <div className="company-earnings-summary-cell">
          <dt>동종업계 평균</dt>
          <dd>{formatPercent(comparison.averageChangePercent)}</dd>
        </div>
        <div className="company-earnings-summary-cell">
          <dt>산업 내 순위</dt>
          <dd>{comparison.rankLabel}</dd>
        </div>
        <div className="company-earnings-summary-cell">
          <dt>비교 기준</dt>
          <dd>{comparison.scopeLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

function ValuationMetricsPanel({ metrics }: { metrics: ValuationMetric[] }) {
  return (
    <section className="company-valuation-panel" aria-label="가치평가">
      <div className="company-section-heading">
        <h3><GlossaryText text="현재 가치지표" /></h3>
        <span>현재가와 최신 재무 기준</span>
      </div>
      <dl className="company-valuation-metric-list">
        {metrics.map((metric) => (
          <ValuationRow key={metric.label} metric={metric} />
        ))}
      </dl>
    </section>
  );
}

function ValuationRow({ metric }: { metric: ValuationMetric }) {
  return (
    <div className="company-valuation-metric-row" aria-label={`${metric.label} ${metric.valueLabel}`}>
      <dt><GlossaryText text={metric.label} /></dt>
      <dd>
        <strong>{metric.valueLabel}</strong>
      </dd>
    </div>
  );
}

function FinancialSeriesTable({
  points,
  rows,
  selectedPeriod = null,
  emptyLabel = "재무 데이터 확인 중"
}: {
  points: FinancialChartPoint[];
  rows: FinancialTableRow[];
  selectedPeriod?: string | null;
  emptyLabel?: string;
}) {
  if (!points.length || !rows.length) {
    return <div className="company-financial-table-empty">{emptyLabel}</div>;
  }
  const showYoy = rows.some((row) => row.yoy !== undefined);
  return (
    <div className="company-financial-table-wrap">
      <table className="company-financial-table">
        <thead>
          <tr>
            <th>항목</th>
            {points.map((point, index) => (
              <th key={`${point.period}-${index}`} className={financialPointKey(point) === selectedPeriod ? "is-selected" : undefined}>{formatTablePeriod(point)}</th>
            ))}
            {showYoy && <th>전년대비</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>
                <i className={row.marker} />
                <GlossaryText text={row.label} />
              </th>
              {row.values.map((value, index) => (
                <td
                  key={`${row.label}-${index}`}
                  className={[
                    value.startsWith("-") ? "down" : value.startsWith("+") ? "up" : "",
                    financialPointKey(points[index]!) === selectedPeriod ? "is-selected" : ""
                  ].filter(Boolean).join(" ") || undefined}
                >{value}</td>
              ))}
              {showYoy && <td className={row.yoy?.startsWith("-") ? "down" : row.yoy?.startsWith("+") ? "up" : undefined}>{row.yoy ?? "확인 중"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildValuationMetrics(price: number | null | undefined, marketCap: number | null | undefined, item: Sp500UniverseItem | undefined): ValuationMetric[] {
  const shares = item?.sharesOutstanding;
  const bps = safeDivide(item?.totalEquity, shares);
  const sps = safeDivide(item?.revenue, shares);
  const cps = safeDivide(item?.operatingCashFlow, shares);
  const per = safeDivide(price, item?.eps);
  const pbr = safeDivide(marketCap, item?.totalEquity);
  const psr = safeDivide(marketCap, item?.revenue);
  const fcfYield = safeDivide(item?.freeCashFlow, marketCap);
  return [
    { label: "EPS", valueLabel: formatPerShareValue(item?.eps) },
    { label: "BPS", valueLabel: formatPerShareValue(bps) },
    { label: "SPS", valueLabel: formatPerShareValue(sps) },
    { label: "CPS", valueLabel: formatPerShareValue(cps) },
    { label: "PER", valueLabel: formatMultiple(per) },
    { label: "PBR", valueLabel: formatMultiple(pbr) },
    { label: "PSR", valueLabel: formatMultiple(psr) },
    { label: "FCF Yield", valueLabel: formatRatioPercent(fcfYield) }
  ];
}

function isRenderablePerSharePoint(point: FinancialChartPoint): boolean {
  const metrics = perShareMetricsForPoint(point);
  return [metrics.eps, metrics.bps, metrics.sps, metrics.cps].some((value) => Number.isFinite(value ?? NaN));
}

function buildPerShareTableRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  const metrics = points.map(perShareMetricsForPoint);
  const latestIndex = metrics.length - 1;
  const comparisonIndex = latestIndex - (periodMode === "quarterly" ? 4 : 1);
  const buildRow = (label: string, marker: "eps" | "bps" | "sps" | "cps", key: keyof PerShareMetrics): FinancialTableRow => ({
    label,
    marker,
    values: metrics.map((point) => formatPerShareValue(point[key])),
    yoy: formatValueGrowth(metrics[comparisonIndex]?.[key], metrics[latestIndex]?.[key])
  });
  return [
    buildRow("EPS", "eps", "eps"),
    buildRow("BPS", "bps", "bps"),
    buildRow("SPS", "sps", "sps"),
    buildRow("CPS", "cps", "cps")
  ];
}

function buildProfitabilityDashboardRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  const multiplier = periodMode === "quarterly" ? 4 : 1;
  const latestIndex = points.length - 1;
  const comparisonIndex = latestIndex - (periodMode === "quarterly" ? 4 : 1);
  const latest = points[latestIndex];
  const comparison = points[comparisonIndex];
  const roeFor = (point: FinancialChartPoint, index: number) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalEquity"));
  const roaFor = (point: FinancialChartPoint, index: number) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalAssets"));
  const ratioYoy = (current: number | null, previous: number | null) => current == null || previous == null ? "확인 중" : formatPercentagePointChange(current - previous);
  return [
    {
      label: "매출액",
      marker: "revenue",
      values: points.map((point) => formatUsdCompact(point.revenue)),
      yoy: formatValueGrowth(comparison?.revenue, latest?.revenue)
    },
    {
      label: "영업이익률",
      marker: "operating-margin",
      values: points.map((point) => formatRatioPercent(safeDivide(point.operatingIncome, point.revenue))),
      yoy: ratioYoy(safeDivide(latest?.operatingIncome, latest?.revenue), safeDivide(comparison?.operatingIncome, comparison?.revenue))
    },
    {
      label: "순이익률",
      marker: "net-margin",
      values: points.map((point) => formatRatioPercent(safeDivide(point.netIncome, point.revenue))),
      yoy: ratioYoy(safeDivide(latest?.netIncome, latest?.revenue), safeDivide(comparison?.netIncome, comparison?.revenue))
    },
    {
      label: "당기순이익",
      marker: "net-income",
      values: points.map((point) => formatUsdCompact(point.netIncome)),
      yoy: formatValueGrowth(comparison?.netIncome, latest?.netIncome)
    },
    {
      label: "ROE",
      marker: "roe",
      values: points.map((point, index) => formatRatioPercent(roeFor(point, index))),
      yoy: ratioYoy(latest ? roeFor(latest, latestIndex) : null, comparison ? roeFor(comparison, comparisonIndex) : null)
    },
    {
      label: "ROA",
      marker: "roa",
      values: points.map((point, index) => formatRatioPercent(roaFor(point, index))),
      yoy: ratioYoy(latest ? roaFor(latest, latestIndex) : null, comparison ? roaFor(comparison, comparisonIndex) : null)
    },
    {
      label: "FCF Margin",
      marker: "fcf-margin",
      values: points.map((point) => formatRatioPercent(safeDivide(point.freeCashFlow, point.revenue))),
      yoy: ratioYoy(safeDivide(latest?.freeCashFlow, latest?.revenue), safeDivide(comparison?.freeCashFlow, comparison?.revenue))
    }
  ];
}

function buildStabilityTableRows(points: FinancialChartPoint[]): FinancialTableRow[] {
  return [
    { label: "총자본", marker: "equity", values: points.map((point) => formatUsdCompact(point.totalEquity)) },
    { label: "총부채", marker: "liabilities", values: points.map((point) => formatUsdCompact(point.totalLiabilities)) },
    { label: "부채비율", marker: "debt-ratio", values: points.map((point) => formatRatioPercent(debtRatioFor(point))) }
  ];
}

function buildStabilityRatioTableRows(points: FinancialChartPoint[]): FinancialTableRow[] {
  return [
    { label: "부채비율", marker: "debt-ratio", values: points.map((point) => formatRatioPercent(debtRatioFor(point))) },
    { label: "유동부채비율", marker: "current-liability-ratio", values: points.map((point) => formatRatioPercent(currentLiabilityRatioFor(point))) },
    { label: "비유동부채비율", marker: "noncurrent-liability-ratio", values: points.map((point) => formatRatioPercent(noncurrentLiabilityRatioFor(point))) }
  ];
}

function buildStabilityDashboardTableRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  const latestIndex = points.length - 1;
  const comparisonIndex = latestIndex - (periodMode === "quarterly" ? 4 : 1);
  const latest = points[latestIndex];
  const comparison = points[comparisonIndex];
  const ratioYoy = (current: number | null, previous: number | null) => current == null || previous == null ? "확인 중" : formatPercentagePointChange(current - previous);
  return [
    {
      label: "부채비율",
      marker: "debt-ratio",
      values: points.map((point) => formatRatioPercent(debtRatioFor(point))),
      yoy: ratioYoy(latest ? debtRatioFor(latest) : null, comparison ? debtRatioFor(comparison) : null)
    },
    {
      label: "유동부채비율",
      marker: "current-liability-ratio",
      values: points.map((point) => formatRatioPercent(currentLiabilityRatioFor(point))),
      yoy: ratioYoy(latest ? currentLiabilityRatioFor(latest) : null, comparison ? currentLiabilityRatioFor(comparison) : null)
    },
    {
      label: "비유동부채비율",
      marker: "noncurrent-liability-ratio",
      values: points.map((point) => formatRatioPercent(noncurrentLiabilityRatioFor(point))),
      yoy: ratioYoy(latest ? noncurrentLiabilityRatioFor(latest) : null, comparison ? noncurrentLiabilityRatioFor(comparison) : null)
    },
    {
      label: "유동비율",
      marker: "current-ratio",
      values: points.map((point) => formatRatioPercent(currentRatioFor(point))),
      yoy: ratioYoy(latest ? currentRatioFor(latest) : null, comparison ? currentRatioFor(comparison) : null)
    },
    { label: "이자발생부채", marker: "total-debt", values: points.map((point) => formatUsdCompact(point.totalDebt)), yoy: formatValueGrowth(comparison?.totalDebt, latest?.totalDebt) },
    { label: "이자보상배율", marker: "interest-coverage", values: points.map((point) => formatMultiple(interestCoverageFor(point))), yoy: formatValueGrowth(comparison ? interestCoverageFor(comparison) : null, latest ? interestCoverageFor(latest) : null) },
    {
      label: "금융비용부담률",
      marker: "financial-cost-burden",
      values: points.map((point) => formatRatioPercent(financialCostBurdenFor(point))),
      yoy: ratioYoy(latest ? financialCostBurdenFor(latest) : null, comparison ? financialCostBurdenFor(comparison) : null)
    },
    { label: "순부채", marker: "net-debt", values: points.map((point) => formatUsdCompact(netDebtFor(point))), yoy: formatValueGrowth(comparison ? netDebtFor(comparison) : null, latest ? netDebtFor(latest) : null) }
  ];
}

function isRenderableProfitabilityPoint(point: FinancialChartPoint): boolean {
  return Number.isFinite(point.revenue ?? NaN) &&
    Number.isFinite(point.netIncome ?? NaN) &&
    (point.revenue as number) > 0;
}

function isRenderableStabilityPoint(point: FinancialChartPoint): boolean {
  return Number.isFinite(point.totalEquity ?? NaN) &&
    Number.isFinite(point.totalLiabilities ?? NaN) &&
    (point.totalEquity as number) !== 0;
}

function isRenderableStabilityRatiosPoint(point: FinancialChartPoint): boolean {
  return [debtRatioFor(point), currentLiabilityRatioFor(point), noncurrentLiabilityRatioFor(point)]
    .some((value) => Number.isFinite(value ?? NaN));
}

function debtRatioFor(point: FinancialChartPoint): number | null {
  return firstFinite(point.debtRatio, safeDivide(point.totalLiabilities, point.totalEquity)) ?? null;
}

function currentLiabilityRatioFor(point: FinancialChartPoint): number | null {
  return firstFinite(point.currentLiabilityRatio, safeDivide(point.currentLiabilities, point.totalEquity)) ?? null;
}

function noncurrentLiabilityRatioFor(point: FinancialChartPoint): number | null {
  const noncurrentLiabilities = Number.isFinite(point.totalLiabilities ?? NaN) && Number.isFinite(point.currentLiabilities ?? NaN)
    ? (point.totalLiabilities as number) - (point.currentLiabilities as number)
    : null;
  return firstFinite(point.noncurrentLiabilityRatio, safeDivide(noncurrentLiabilities, point.totalEquity)) ?? null;
}

function currentRatioFor(point: FinancialChartPoint): number | null {
  return firstFinite(point.currentRatio, safeDivide(point.currentAssets, point.currentLiabilities)) ?? null;
}

function interestCoverageFor(point: FinancialChartPoint): number | null {
  const expense = Number.isFinite(point.interestExpense ?? NaN) ? Math.abs(point.interestExpense as number) : null;
  return firstFinite(point.interestCoverage, safeDivide(point.operatingIncome, expense)) ?? null;
}

function financialCostBurdenFor(point: FinancialChartPoint): number | null {
  const expense = Number.isFinite(point.interestExpense ?? NaN) ? Math.abs(point.interestExpense as number) : null;
  return firstFinite(point.financialCostBurdenRatio, safeDivide(expense, point.revenue)) ?? null;
}

function netDebtFor(point: FinancialChartPoint): number | null {
  const fallback = Number.isFinite(point.totalDebt ?? NaN) && Number.isFinite(point.cashAndCashEquivalents ?? NaN)
    ? (point.totalDebt as number) - (point.cashAndCashEquivalents as number)
    : null;
  return firstFinite(point.netDebt, fallback) ?? null;
}

function buildFinancialSeries(series: CompanyFinancialSeriesPoint[] | null | undefined, item: Sp500UniverseItem | undefined): FinancialChartPoint[] {
  const fromSeries = series?.map(normalizeFinancialPoint).filter((point) => (
    Number.isFinite(point.revenue ?? NaN) ||
    Number.isFinite(point.netIncome ?? NaN) ||
    Number.isFinite(point.operatingIncome ?? NaN) ||
    Number.isFinite(point.totalEquity ?? NaN) ||
    Number.isFinite(point.totalLiabilities ?? NaN)
  )) ?? [];
  if (fromSeries.length) {
    return fromSeries;
  }
  const period = item?.fiscalPeriod || item?.periodEndDate || item?.fundamentalsAsOf;
  if (!period) {
    return [];
  }
  const fallbackPoint = normalizeFinancialPoint({
    period,
    periodEndDate: item?.periodEndDate,
    revenue: item?.revenue,
    operatingIncome: item?.operatingIncome,
    netIncome: item?.netIncome,
    eps: item?.eps,
    totalAssets: item?.totalAssets,
    totalLiabilities: item?.totalLiabilities,
    totalEquity: item?.totalEquity,
    operatingCashFlow: item?.operatingCashFlow,
    freeCashFlow: item?.freeCashFlow,
    sharesOutstanding: item?.sharesOutstanding
  });
  return Number.isFinite(fallbackPoint.revenue ?? NaN) ||
    Number.isFinite(fallbackPoint.netIncome ?? NaN) ||
    Number.isFinite(fallbackPoint.totalEquity ?? NaN) ||
    Number.isFinite(fallbackPoint.totalLiabilities ?? NaN)
    ? [fallbackPoint]
    : [];
}

function isAnnualFinancialPoint(point: FinancialChartPoint): boolean {
  return /FY|annual|연간/i.test(point.period);
}

function aggregateQuarterlySeriesToAnnual(series: FinancialChartPoint[]): FinancialChartPoint[] {
  const grouped = new Map<number, FinancialChartPoint[]>();
  series.forEach((point) => {
    const year = financialPointYear(point);
    if (year == null) return;
    const points = grouped.get(year) ?? [];
    points.push(point);
    grouped.set(year, points);
  });
  const annual = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([year, points]) => {
      const sorted = [...points].sort((left, right) => financialPointKey(left).localeCompare(financialPointKey(right)));
      if (sorted.length < 4) return [];
      const latest = sorted.at(-1)!;
      const revenue = sumFinancialValues(sorted, "revenue");
      const operatingIncome = sumFinancialValues(sorted, "operatingIncome");
      const interestExpense = sumFinancialValues(sorted, "interestExpense");
      const absoluteInterestExpense = Number.isFinite(interestExpense ?? NaN) ? Math.abs(interestExpense as number) : null;
      return [{
        period: `${year}FY`,
        periodEndDate: latest.periodEndDate,
        revenue,
        operatingIncome,
        netIncome: sumFinancialValues(sorted, "netIncome"),
        eps: sumFinancialValues(sorted, "eps"),
        totalAssets: latest.totalAssets,
        totalLiabilities: latest.totalLiabilities,
        totalEquity: latest.totalEquity,
        currentAssets: latest.currentAssets,
        currentLiabilities: latest.currentLiabilities,
        cashAndCashEquivalents: latest.cashAndCashEquivalents,
        interestExpense,
        operatingCashFlow: sumFinancialValues(sorted, "operatingCashFlow"),
        freeCashFlow: sumFinancialValues(sorted, "freeCashFlow"),
        sharesOutstanding: latest.sharesOutstanding,
        debtRatio: debtRatioFor(latest),
        currentLiabilityRatio: currentLiabilityRatioFor(latest),
        noncurrentLiabilityRatio: noncurrentLiabilityRatioFor(latest),
        currentRatio: currentRatioFor(latest),
        totalDebt: latest.totalDebt,
        interestCoverage: safeDivide(operatingIncome, absoluteInterestExpense),
        financialCostBurdenRatio: safeDivide(absoluteInterestExpense, revenue),
        netDebt: netDebtFor(latest)
      } satisfies FinancialChartPoint];
    });
  return annual.length ? annual : series;
}

function sumFinancialValues(points: FinancialChartPoint[], key: keyof FinancialChartPoint): number | null {
  const values = points.map((point) => point[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function financialPointYear(point: FinancialChartPoint): number | null {
  const periodYear = point.period.match(/(?:19|20)\d{2}/)?.[0];
  if (periodYear) return Number(periodYear);
  if (!point.periodEndDate) return null;
  const parsed = new Date(point.periodEndDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

function financialPointKey(point: FinancialChartPoint): string {
  return point.periodEndDate || point.period;
}

function averageFinancialBalance(points: FinancialChartPoint[], index: number, key: "totalAssets" | "totalEquity"): number | null {
  const current = points[index]?.[key];
  const previous = points[index - 1]?.[key];
  if (!Number.isFinite(current ?? NaN)) return null;
  return Number.isFinite(previous ?? NaN) ? ((current as number) + (previous as number)) / 2 : current as number;
}

function multiplyFinite(value: number | null | undefined, multiplier: number): number | null {
  return Number.isFinite(value ?? NaN) ? (value as number) * multiplier : null;
}

function financialLinePath(values: Array<number | null>, xFor: (index: number) => number, yFor: (value: number) => number): string {
  let started = false;
  return values.map((value, index) => {
    if (!Number.isFinite(value ?? NaN)) {
      started = false;
      return "";
    }
    const command = started ? "L" : "M";
    started = true;
    return `${command} ${xFor(index)} ${yFor(value as number)}`;
  }).filter(Boolean).join(" ");
}

function financialRatioDots(
  point: FinancialChartPoint,
  index: number,
  metrics: Array<{ key: string; value: number | null | undefined; className: string }>,
  xFor: (index: number) => number,
  yFor: (value: number) => number,
  selectedPeriod: string | null,
  onPeriodSelect: (period: string) => void
): ReactNode[] {
  const periodKey = financialPointKey(point);
  return metrics.flatMap((metric) => Number.isFinite(metric.value ?? NaN) ? [
    <circle
      key={`${periodKey}-${metric.key}`}
      className={`${metric.className} ${periodKey === selectedPeriod ? "is-selected" : ""}`}
      cx={xFor(index)}
      cy={yFor(metric.value as number)}
      r={periodKey === selectedPeriod ? 5 : 3.5}
      onClick={() => onPeriodSelect(periodKey)}
    />
  ] : []);
}

function handleFinancialPointKeyDown(key: string, onSelect: () => void): void {
  if (key === "Enter" || key === " ") onSelect();
}

function formatFinancialSelectionLabel(point: FinancialChartPoint, periodMode: FinancialPeriodMode): string {
  return `선택 구간 · ${periodMode === "annual" ? formatAnnualPeriod(point) : formatPeriod(point.period, point.periodEndDate)}`;
}

function formatValueGrowth(previous: number | null | undefined, current: number | null | undefined): string {
  if (!Number.isFinite(previous ?? NaN) || !Number.isFinite(current ?? NaN) || previous === 0) return "확인 중";
  return formatSignedRatio(((current as number) - (previous as number)) / Math.abs(previous as number));
}

function formatPercentagePointChange(value: number): string {
  const percentagePoints = value * 100;
  if (Math.abs(percentagePoints) < 0.005) return "0.00%p";
  const sign = percentagePoints > 0 ? "+" : "";
  return `${sign}${percentagePoints.toFixed(2)}%p`;
}

function normalizeFinancialPoint(point: CompanyFinancialSeriesPoint): FinancialChartPoint {
  return {
    period: point.period,
    periodEndDate: point.periodEndDate,
    revenue: point.revenue,
    operatingIncome: point.operatingIncome,
    netIncome: point.netIncome,
    eps: point.eps,
    totalAssets: point.totalAssets,
    totalLiabilities: point.totalLiabilities,
    totalEquity: point.totalEquity,
    currentAssets: point.currentAssets,
    currentLiabilities: point.currentLiabilities,
    cashAndCashEquivalents: point.cashAndCashEquivalents,
    interestExpense: point.interestExpense,
    operatingCashFlow: point.operatingCashFlow,
    freeCashFlow: point.freeCashFlow,
    sharesOutstanding: point.sharesOutstanding,
    debtRatio: point.debtRatio,
    currentLiabilityRatio: point.currentLiabilityRatio,
    noncurrentLiabilityRatio: point.noncurrentLiabilityRatio,
    currentRatio: point.currentRatio,
    totalDebt: point.totalDebt,
    interestCoverage: point.interestCoverage,
    financialCostBurdenRatio: point.financialCostBurdenRatio,
    netDebt: point.netDebt
  };
}

function buildEarningsSeries(
  item: Sp500UniverseItem | undefined,
  financialSeries: FinancialChartPoint[] = [],
  apiSeries: CompanyEarningsSeriesPoint[] | null = null
): EarningsChartPoint[] {
  const merged = new Map<string, EarningsChartPoint>();
  const addPoint = (point: EarningsChartPoint) => {
    if (!hasEarningsValue(point)) {
      return;
    }
    const key = earningsPeriodKey(point);
    if (!key) {
      return;
    }
    const current = merged.get(key) ?? { period: point.period, periodEndDate: point.periodEndDate };
    current.period = current.period || point.period;
    current.periodEndDate = current.periodEndDate || point.periodEndDate;
    current.actualEps = firstFinite(current.actualEps, point.actualEps);
    current.estimatedEps = firstFinite(current.estimatedEps, point.estimatedEps);
    current.actualRevenue = firstFinite(current.actualRevenue, point.actualRevenue);
    current.estimatedRevenue = firstFinite(current.estimatedRevenue, point.estimatedRevenue);
    merged.set(key, current);
  };
  const actualSeries = financialSeries
    .map((point) => ({
      period: point.period,
      periodEndDate: point.periodEndDate,
      actualEps: point.eps,
      estimatedEps: null,
      actualRevenue: point.revenue,
      estimatedRevenue: null
    }))
    .filter(hasEarningsValue);
  actualSeries.forEach(addPoint);
  (item?.earningsSeries ?? []).map((point) => normalizeEarningsPoint(point)).forEach(addPoint);
  (apiSeries ?? []).map((point) => normalizeEarningsPoint(point)).forEach(addPoint);
  const period = item?.fiscalPeriod || item?.periodEndDate || item?.fundamentalsAsOf;
  if (period) {
    addPoint({
      period,
      periodEndDate: item?.periodEndDate,
      actualEps: item?.eps,
      estimatedEps: null,
      actualRevenue: item?.revenue,
      estimatedRevenue: null
    });
  }
  return Array.from(merged.values()).sort(compareEarningsPoints);
}

function normalizeEarningsPoint(point: CompanyEarningsSeriesPoint): EarningsChartPoint {
  return {
    period: point.period,
    periodEndDate: point.periodEndDate,
    actualEps: point.actualEps,
    estimatedEps: point.estimatedEps,
    actualRevenue: point.actualRevenue,
    estimatedRevenue: point.estimatedRevenue
  };
}

function hasEarningsValue(point: EarningsChartPoint): boolean {
  return Number.isFinite(point.actualEps ?? NaN) ||
    Number.isFinite(point.estimatedEps ?? NaN) ||
    Number.isFinite(point.actualRevenue ?? NaN) ||
    Number.isFinite(point.estimatedRevenue ?? NaN);
}

function firstFinite(current: number | null | undefined, next: number | null | undefined): number | null | undefined {
  return Number.isFinite(current ?? NaN) ? current : next;
}

function earningsPeriodKey(point: EarningsChartPoint): string {
  return point.period || point.periodEndDate || "";
}

function compareEarningsPoints(left: EarningsChartPoint, right: EarningsChartPoint): number {
  return earningsPointOrder(left) - earningsPointOrder(right);
}

function earningsPointOrder(point: EarningsChartPoint): number {
  const timestamp = point.periodEndDate ? Date.parse(point.periodEndDate) : NaN;
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }
  const match = point.period.match(/(\d{4})\D?Q([1-4])/i) || point.period.match(/Q([1-4])\D?(\d{4})/i);
  if (!match) {
    return 0;
  }
  const year = Number(match[1].length === 4 ? match[1] : match[2]);
  const quarter = Number(match[1].length === 4 ? match[2] : match[1]);
  return year * 4 + quarter;
}

function normalizeRevenueForChart(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  return (value as number) / 100_000_000;
}

function makeTicks(minValue: number, maxValue: number, count: number): number[] {
  const safeCount = Math.max(2, count);
  const span = maxValue - minValue || 1;
  return Array.from({ length: safeCount }, (_, index) => minValue + (span / (safeCount - 1)) * index);
}

function paddedDomain(
  values: number[],
  options: { includeZero?: boolean; fallbackMax?: number; minFloor?: number } = {}
): { min: number; max: number } {
  const finiteValues = values.filter(Number.isFinite);
  let min = finiteValues.length ? Math.min(...finiteValues) : 0;
  let max = finiteValues.length ? Math.max(...finiteValues) : options.fallbackMax ?? 1;
  if (options.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    const expansion = Math.max(Math.abs(max) * 0.12, options.fallbackMax ?? 1);
    min -= expansion;
    max += expansion;
  } else {
    const padding = (max - min) * 0.1;
    min -= padding;
    max += padding;
  }
  if (options.minFloor != null) {
    min = Math.max(min, options.minFloor);
  }
  if (min === max) {
    max = min + (options.fallbackMax ?? 1);
  }
  return { min, max };
}

function valueToY(value: number, domain: { min: number; max: number }, top: number, height: number): number {
  const span = domain.max - domain.min || 1;
  return top + (1 - (value - domain.min) / span) * height;
}

function formatEarningsAxisValue(value: number, metric: EarningsMetric): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: abs > 0 && abs < 10 ? 2 : 0,
    maximumFractionDigits: abs > 0 && abs < 10 ? 2 : 0
  }).format(abs);
  return metric === "eps" ? `${sign}US$${formatted}` : `${sign}US$${formatted}억`;
}

function formatKoreanMoneyAxis(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000_000) {
    return `${sign}${formatFixed(abs / 100_000_000)}억`;
  }
  if (abs >= 10_000) {
    return `${sign}${formatFixed(abs / 10_000)}만`;
  }
  return `${sign}${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(abs)}`;
}

function formatSignedRatio(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value * 100)}%`;
}

function earningsTone(actual: number | null, estimate: number | null): "beat" | "miss" | "match" | "actual-only" {
  if (actual == null || estimate == null) {
    return "actual-only";
  }
  const tolerance = Math.max(Math.abs(estimate) * 0.005, 0.005);
  if (actual > estimate + tolerance) {
    return "beat";
  }
  if (actual < estimate - tolerance) {
    return "miss";
  }
  return "match";
}

function shouldShowPeriodLabel(index: number, count: number): boolean {
  if (count <= 5) {
    return true;
  }
  return index === 0 || index === count - 1 || index % Math.ceil(count / 4) === 0;
}

function formatPeriod(period: string, periodEndDate: string | null | undefined): string {
  const source = period || periodEndDate || "";
  if (/FY|annual|연간/i.test(source)) {
    const year = source.match(/(?:19|20)\d{2}/)?.[0];
    return year ?? source;
  }
  const quarterMatch = source.match(/(\d{4})\D?Q([1-4])/i) || source.match(/Q([1-4])\D?(\d{4})/i);
  if (quarterMatch) {
    const year = quarterMatch[1].length === 4 ? quarterMatch[1] : quarterMatch[2];
    const quarter = quarterMatch[1].length === 4 ? quarterMatch[2] : quarterMatch[1];
    return `Q${quarter} '${year.slice(-2)}`;
  }
  if (periodEndDate) {
    const parsed = new Date(periodEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1;
      return `Q${quarter} '${String(parsed.getUTCFullYear()).slice(-2)}`;
    }
  }
  return source || "분기";
}

function formatTablePeriod(point: FinancialChartPoint): string {
  if (isAnnualFinancialPoint(point)) {
    return formatAnnualPeriod(point);
  }
  if (point.periodEndDate) {
    const parsed = new Date(point.periodEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getUTCFullYear()).slice(-2)}년 ${parsed.getUTCMonth() + 1}월`;
    }
  }
  return formatPeriod(point.period, point.periodEndDate);
}

function formatAnnualPeriod(point: FinancialChartPoint): string {
  const year = point.period.match(/(?:19|20)\d{2}/)?.[0] ?? (point.periodEndDate ? String(new Date(point.periodEndDate).getUTCFullYear()) : "");
  return year ? `${year}년` : point.period;
}

export const companyInfoMissingValue = "—";

export function formatCompanyInfoPrice(value: number | null | undefined): string {
  if (!isPositiveFinite(value)) {
    return companyInfoMissingValue;
  }
  return `US$${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)}`;
}

export function formatCompanyInfoChange(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return companyInfoMissingValue;
  }
  const numeric = value as number;
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric)}%`;
}

export function formatCompanyInfoMarketCap(value: number | null | undefined): string {
  if (!isPositiveFinite(value) || value <= 1) {
    return companyInfoMissingValue;
  }
  return `US$${formatKoreanCompact(value)}`;
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return Number.isFinite(value ?? NaN) && (value as number) > 0;
}

function formatUsdCompact(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${formatKoreanCompact(value as number)} 달러`;
}

function formatShares(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${formatKoreanCompact(value as number)} 주`;
}

function formatKoreanCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${formatFixed(value / 1_000_000_000_000)}조`;
  }
  if (abs >= 100_000_000) {
    return `${formatFixed(value / 100_000_000)}억`;
  }
  if (abs >= 10_000) {
    return `${formatFixed(value / 10_000)}만`;
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value);
}

function formatFixed(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  const sign = (value as number) > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value as number)}%`;
}

function formatMultiple(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value as number)}배`;
}

function formatMultipleAxis(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)}배`;
}

function formatPerShareValue(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "확인 중";
  return `US$${new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value as number)}`;
}

function formatPerShareAxis(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000) return `${sign}$${formatFixed(abs / 1_000)}K`;
  return `${sign}$${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: abs < 10 ? 1 : 0 }).format(abs)}`;
}

function formatRatioPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format((value as number) * 100)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "확인 중";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(parsed);
}

function formatMarket(market: string | null | undefined, country: string | null | undefined): string {
  const value = market || country;
  if (!value) {
    return "미국";
  }
  const normalized = value.trim().toUpperCase();
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "미국"].includes(normalized)) {
    return "미국";
  }
  return value;
}

function hasFundamentalShares(item: Sp500UniverseItem | undefined): boolean {
  return item?.marketCapSource === "fundamentals" || Number.isFinite(item?.sharesOutstanding ?? NaN);
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!Number.isFinite(numerator ?? NaN) || !Number.isFinite(denominator ?? NaN) || denominator === 0) {
    return null;
  }
  return (numerator as number) / (denominator as number);
}

function buildComparison(symbol: string, item: Sp500UniverseItem | undefined, items: Sp500UniverseItem[]) {
  const sameIndustry = item
    ? items.filter((candidate) => (
      candidate.symbol.toUpperCase() !== symbol &&
      candidate.industry === item.industry &&
      candidate.sector === item.sector
    ))
    : [];
  const sameSector = item
    ? items.filter((candidate) => (
      candidate.symbol.toUpperCase() !== symbol &&
      candidate.sector === item.sector
    ))
    : [];
  const peers = [...sameIndustry]
    .sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a))
    .slice(0, 4);
  const rankGroup = item ? [item, ...sameIndustry].filter((candidate) => comparableMarketCap(candidate) > 0) : [];
  const ranked = [...rankGroup].sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a));
  const rank = ranked.findIndex((candidate) => candidate.symbol.toUpperCase() === symbol);
  const averageChangePercent = average(sameIndustry.map((candidate) => candidate.changePercent));
  return {
    peers: peers.length ? peers : sameSector.sort((a, b) => comparableMarketCap(b) - comparableMarketCap(a)).slice(0, 4),
    averageChangePercent,
    rankLabel: rank >= 0 ? `${rank + 1}/${ranked.length}` : "확인 중",
    scopeLabel: sameIndustry.length ? item?.industry ?? "산업" : item?.sector ?? "섹터"
  };
}

function comparableMarketCap(item: Sp500UniverseItem): number {
  const value = item.layoutMarketCap ?? item.marketCap;
  return Number.isFinite(value) ? value : 0;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => Number.isFinite(value ?? NaN));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}
