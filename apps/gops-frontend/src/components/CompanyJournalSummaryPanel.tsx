import { ChevronRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { fetchCandles } from "../chart/cdcClient";
import type { CandleDto } from "../chart/types";
import { GlossaryText } from "../glossary/GlossaryText";
import { fetchCompanyEarningsSeries, fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyEarningsSeriesPoint, CompanyFinancialSeriesPoint, Sp500UniverseItem } from "../market/sp500Universe.seed";
import { CANVAS_FONT_FAMILY, TYPE_ROLE } from "../theme/typography";
import { LogoDevAttribution } from "./StockLogo";
import { formatCompanyJournalAnalystOpinion, type CompanyJournalAnalystOpinion } from "./companyJournalAnalystOpinion";
import type { CompanyJournalAnalystAction } from "./companyJournalApi";
import {
  buildHistoricalValuationSeries,
  financialPriceRequestRange,
  mergeValuationPriceSeries,
  perShareMetricsForPoint,
  type FinancialChartPoint,
  type FinancialPeriodMode,
  type HistoricalValuationPoint,
  type PerShareMetrics,
  type ValuationPricePoint
} from "./companyFinancialHistory";

export { formatCompanyJournalAnalystOpinion } from "./companyJournalAnalystOpinion";
export { mergeValuationPriceSeries as mergeCompanyJournalValuationPrices } from "./companyFinancialHistory";
export type { FinancialChartPoint, FinancialPeriodMode, ValuationPricePoint } from "./companyFinancialHistory";

type CompanySummaryPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
  view: CompanyPanelView;
  onEvidenceChange?: (evidence: CompanyJournalEvidence) => void;
  disableRemoteFetch?: boolean;
  valuationContent?: "combined" | "earnings" | "valuation";
  valuationPriceSeries?: ValuationPricePoint[];
  stabilityContent?: "stability" | "stability-dashboard";
  journalPresentation?: boolean;
  focusedValuationMetric?: string | null;
  focusedStabilityMetric?: string | null;
  focusedFinancialMetric?: string | null;
  focusedFinancialYear?: number | null;
  comparisonFinancialYear?: number | null;
  financialPeriodMode?: FinancialPeriodMode;
  onFinancialPeriodModeChange?: (mode: FinancialPeriodMode) => void;
  onFinancialSelectionChange?: () => void;
  analystActions?: readonly CompanyJournalAnalystAction[];
  showAnalystOpinion?: boolean;
};

export type CompanyPanelView = "valuation" | "profitability" | "stability";

const emptyValuationPriceSeries: ValuationPricePoint[] = [];
const emptyAnalystActions: readonly CompanyJournalAnalystAction[] = [];

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

export const COMPANY_JOURNAL_HISTORY_START_YEAR = 2021;

export function companyJournalHistoryYears(currentYear = new Date().getUTCFullYear()): number {
  return Math.max(1, currentYear - COMPANY_JOURNAL_HISTORY_START_YEAR + 1);
}

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
const financialChartAxisLabelX = 0;

type ResponsiveChartPlotOptions = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  compactLeft?: number;
  compactRight?: number;
};

function responsiveChartPlot(chartWidth: number, options: ResponsiveChartPlotOptions) {
  const progress = Math.min(1, Math.max(0, (chartWidth - 320) / 480));
  const compactLeft = options.compactLeft ?? Math.min(options.left, 58);
  const compactRight = options.compactRight ?? Math.min(options.right, 18);
  return {
    left: compactLeft + (options.left - compactLeft) * progress,
    right: compactRight + (options.right - compactRight) * progress,
    top: options.top,
    bottom: options.bottom
  };
}

function financialChartPointX(
  index: number,
  pointCount: number,
  plotLeft: number,
  innerWidth: number,
  edgePadding: number
) {
  if (pointCount <= 1) return plotLeft + innerWidth / 2;
  const safeEdgePadding = Math.min(Math.max(0, edgePadding), innerWidth / 2);
  const availableWidth = Math.max(0, innerWidth - safeEdgePadding * 2);
  return plotLeft + safeEdgePadding + (index / (pointCount - 1)) * availableWidth;
}

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
      const nextSize = measuredSize;
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

function JournalChartAnnotation({
  target,
  label,
  x,
  y,
  top,
  chartWidth
}: {
  target: string;
  label: string;
  x: number;
  y: number;
  top: number;
  chartWidth: number;
}) {
  const labelWidth = Math.min(176, Math.max(92, Array.from(label).length * 10 + 20));
  const labelX = x - labelWidth - 10 >= 4
    ? x - labelWidth - 10
    : Math.min(chartWidth - labelWidth - 4, x + 10);
  const labelY = top + 2;
  return (
    <g className="company-journal-chart-annotation" data-journal-annotation={target} aria-hidden="true">
      <line className="company-journal-chart-annotation-guide" x1={x} x2={x} y1={labelY + 26} y2={y} />
      <circle className="company-journal-chart-annotation-anchor" cx={x} cy={y} r={6} />
      <rect className="company-journal-chart-annotation-label" x={labelX} y={labelY} width={labelWidth} height={25} rx={7} />
      <text className="company-journal-chart-annotation-text" x={labelX + 9} y={labelY + 17}>{label}</text>
    </g>
  );
}

export function CompanySummaryPanel({ symbol, item, items = [], view, onEvidenceChange, disableRemoteFetch = false, valuationContent = "combined", valuationPriceSeries = emptyValuationPriceSeries, stabilityContent = "stability", journalPresentation = false, focusedValuationMetric = null, focusedStabilityMetric = null, focusedFinancialMetric = null, focusedFinancialYear = null, comparisonFinancialYear = null, financialPeriodMode: controlledFinancialPeriodMode, onFinancialPeriodModeChange, onFinancialSelectionChange, analystActions = emptyAnalystActions, showAnalystOpinion = true }: CompanySummaryPanelProps) {
  const [earningsMetric, setEarningsMetric] = useState<EarningsMetric>("eps");
  const [internalFinancialPeriodMode, setInternalFinancialPeriodMode] = useState<FinancialPeriodMode>(journalPresentation ? "annual" : "quarterly");
  const financialPeriodMode = controlledFinancialPeriodMode ?? internalFinancialPeriodMode;
  const [selectedFinancialPeriod, setSelectedFinancialPeriod] = useState<string | null>(null);
  const [financialSeries, setFinancialSeries] = useState<CompanyFinancialSeriesPoint[] | null>(null);
  const [earningsSeriesFromApi, setEarningsSeriesFromApi] = useState<CompanyEarningsSeriesPoint[] | null>(null);
  const [valuationCandles, setValuationCandles] = useState<CandleDto[] | null>(null);
  const normalizedSymbol = symbol.toUpperCase();
  const companyName = item?.companyName || normalizedSymbol;
  const price = item?.lastPrice ?? item?.layoutPrice ?? null;
  const marketCap = item?.marketCap ?? item?.layoutMarketCap ?? null;
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
  const periodEarningsSeries = useMemo(
    () => financialPeriodMode === "annual"
      ? companyJournalAnnualHistory(aggregateEarningsSeriesToAnnual(earningsSeries))
      : earningsSeries.slice(-12),
    [earningsSeries, financialPeriodMode]
  );
  const valuationMetrics = useMemo(
    () => buildValuationMetrics(price, marketCap, item),
    [price, marketCap, item]
  );
  const valuationPrices = useMemo<ValuationPricePoint[]>(
    () => mergeValuationPriceSeries(
      valuationPriceSeries,
      (valuationCandles ?? []).map((candle) => ({ timestamp: candle.timestamp, close: candle.close }))
    ),
    [valuationCandles, valuationPriceSeries]
  );

  const changeFinancialPeriodMode = useCallback((mode: FinancialPeriodMode) => {
    setSelectedFinancialPeriod(null);
    onFinancialSelectionChange?.();
    if (controlledFinancialPeriodMode === undefined) {
      setInternalFinancialPeriodMode(mode);
    }
    onFinancialPeriodModeChange?.(mode);
  }, [controlledFinancialPeriodMode, onFinancialPeriodModeChange, onFinancialSelectionChange]);
  const selectFinancialPeriod = useCallback((period: string) => {
    setSelectedFinancialPeriod(period);
    onFinancialSelectionChange?.();
  }, [onFinancialSelectionChange]);

  useEffect(() => {
    if (disableRemoteFetch) {
      setFinancialSeries([]);
      return undefined;
    }
    const controller = new AbortController();
    setFinancialSeries(null);
    fetchCompanyFinancialSeries(normalizedSymbol, controller.signal, {
      years: companyJournalHistoryYears(),
      period: "quarterly"
    })
      .then((series) => setFinancialSeries(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFinancialSeries([]);
        }
    });
    return () => controller.abort();
  }, [disableRemoteFetch, normalizedSymbol]);

  useEffect(() => {
    if (disableRemoteFetch) {
      setEarningsSeriesFromApi([]);
      return undefined;
    }
    const controller = new AbortController();
    setEarningsSeriesFromApi(null);
    fetchCompanyEarningsSeries(normalizedSymbol, controller.signal, { years: companyJournalHistoryYears() })
      .then((series) => setEarningsSeriesFromApi(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setEarningsSeriesFromApi([]);
        }
    });
    return () => controller.abort();
  }, [disableRemoteFetch, normalizedSymbol]);

  useEffect(() => {
    if (disableRemoteFetch) {
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
  }, [disableRemoteFetch, normalizedSymbol, profitabilitySeries]);

  useEffect(() => {
    if (selectedFinancialPeriod && !profitabilitySeries.some((point) => financialPointKey(point) === selectedFinancialPeriod)) {
      setSelectedFinancialPeriod(null);
    }
  }, [profitabilitySeries, selectedFinancialPeriod]);

  useEffect(() => {
    if (focusedFinancialYear == null) return;
    const matchingPoint = profitabilitySeries.find((point) => financialPointYear(point) === focusedFinancialYear);
    if (matchingPoint) setSelectedFinancialPeriod(financialPointKey(matchingPoint));
  }, [focusedFinancialYear, profitabilitySeries]);

  useEffect(() => {
    onEvidenceChange?.({
      financialSeries: profitabilitySeries,
      earningsSeries: periodEarningsSeries,
      selectedFinancialPeriod,
      financialPeriodMode
    });
  }, [financialPeriodMode, onEvidenceChange, periodEarningsSeries, profitabilitySeries, selectedFinancialPeriod]);

  const valuationSection = (
    <ValuationPagedPanel
      key={normalizedSymbol}
      symbol={normalizedSymbol}
      metric={earningsMetric}
      onMetricChange={setEarningsMetric}
      series={periodEarningsSeries}
      comparison={comparison}
      metrics={valuationMetrics}
      financialSeries={profitabilitySeries}
      periodMode={financialPeriodMode}
      selectedPeriod={selectedFinancialPeriod}
      onPeriodModeChange={changeFinancialPeriodMode}
      onPeriodSelect={selectFinancialPeriod}
      contentMode={valuationContent}
      valuationPrices={valuationPrices}
      compactJournal={journalPresentation}
      focusedValuationMetric={focusedValuationMetric}
      focusedFinancialMetric={focusedFinancialMetric}
      focusedFinancialYear={focusedFinancialYear}
      comparisonFinancialYear={comparisonFinancialYear}
      analystActions={analystActions}
      showAnalystOpinion={showAnalystOpinion}
      companyName={companyName}
    />
  );
  const profitabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 수익성 재무`}>
      <ProfitabilityDashboard
        series={profitabilitySeries}
        periodMode={financialPeriodMode}
        selectedPeriod={selectedFinancialPeriod}
        onPeriodModeChange={changeFinancialPeriodMode}
        onPeriodSelect={selectFinancialPeriod}
        compactJournal={journalPresentation}
        focusedMetric={focusedFinancialMetric}
        focusedYear={focusedFinancialYear}
        comparisonYear={comparisonFinancialYear}
      />
    </section>
  );
  const stabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 안정성`}>
      {stabilityContent === "stability-dashboard" ? (
        <StabilityDashboard
          financialSeries={profitabilitySeries}
          periodMode={financialPeriodMode}
          onPeriodModeChange={changeFinancialPeriodMode}
          compactJournal={journalPresentation}
          focusedMetric={focusedStabilityMetric}
          focusedYear={focusedFinancialYear}
          comparisonYear={comparisonFinancialYear}
        />
      ) : <StabilityFinanceChart series={profitabilitySeries} />}
    </section>
  );

  const activeSection = view === "valuation"
    ? valuationSection
    : view === "profitability"
      ? profitabilitySection
      : stabilitySection;
  const activeLabel = view === "valuation" ? "가치평가" : view === "profitability" ? "수익성" : "안정성";
  return (
    <section className={`company-summary-panel company-single-panel is-${view}`} aria-label={`${normalizedSymbol} ${activeLabel}`}>
      <section className="company-fundamental-section company-single-fundamental-section">
        {activeSection}
      </section>
      <LogoDevAttribution className="panel-logo-attribution" />
    </section>
  );
}

function EarningsHistoryChart({ metric, series }: { metric: EarningsMetric; series: EarningsChartPoint[] }) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
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
  const plot = responsiveChartPlot(chartWidth, {
    left: metric === "revenue" ? 110 : 90,
    right: 36,
    top: 24,
    bottom: 40,
    compactLeft: metric === "revenue" ? 72 : 58,
    compactRight: 22
  });
  const xStep = points.length > 1 ? (chartWidth - plot.left - plot.right) / (points.length - 1) : 0;
  const yFor = (value: number) => {
    const span = paddedMax - minValue || 1;
    return plot.top + (1 - (value - minValue) / span) * (chartHeight - plot.top - plot.bottom);
  };
  const yTicks = makeTicks(minValue, paddedMax, 5);
  const latestIndex = points.length - 1;
  const latestPoint = points[latestIndex];
  const latestX = points.length > 1 ? plot.left + xStep * latestIndex : chartWidth - plot.right - 22;
  const latestYValues = [latestPoint?.actual, latestPoint?.estimate]
    .filter((value): value is number => Number.isFinite(value ?? NaN))
    .map(yFor);

  return (
    <div className="company-earnings-history-card">
      <div className="company-earnings-legend" aria-label="실적 범례">
        <span><i className="estimate" />추정</span>
        <span><i className="beat" />예상치 상회</span>
        <span><i className="miss" />예상치 하회</span>
        <span><i className="match" />실적</span>
      </div>
      <svg ref={chartRef} className="company-earnings-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${metric === "eps" ? "EPS" : "수익"} 실적 내역`}>
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
          const estimateX = x;
          const actualX = x;
          return (
            <g
              key={`${point.period}-${index}`}
              className="company-earnings-point"
              data-journal-mark={index === points.length - 1 ? "earnings-latest" : undefined}
              style={{ "--earnings-index": index } as CSSProperties}
            >
              {estimate != null && (
                <circle className="company-earnings-dot estimate" cx={estimateX} cy={estimateY ?? 0} r={7}>
                  <title>{`${formatPeriod(point.period, point.periodEndDate)} · 추정 ${formatEarningsAxisValue(estimate, metric)}`}</title>
                </circle>
              )}
              {hasComparison && (
                <line
                  className={`company-earnings-surprise-stem ${tone}`}
                  x1={estimateX}
                  x2={actualX}
                  y1={estimateY ?? 0}
                  y2={actualY ?? 0}
                  pathLength={1}
                />
              )}
              {actual != null && (
                <circle
                  className={`company-earnings-dot actual ${tone}`}
                  cx={actualX}
                  cy={actualY ?? 0}
                  r={7}
                  style={hasComparison ? { "--earnings-actual-offset-y": `${(estimateY ?? 0) - (actualY ?? 0)}px` } as CSSProperties : undefined}
                >
                  <title>{`${formatPeriod(point.period, point.periodEndDate)} · 실적 ${formatEarningsAxisValue(actual, metric)}`}</title>
                </circle>
              )}
              {shouldShowPeriodLabel(index, points.length) && (
                <text className="company-earnings-period" x={x} y={chartHeight - 11}>{formatPeriod(point.period, point.periodEndDate)}</text>
              )}
            </g>
          );
        })}
        {points.length > 0 && (
          <JournalChartAnnotation
            target="earnings-latest"
            label="실제치·추정치 차이"
            x={latestX}
            y={latestYValues.length ? Math.min(...latestYValues) : plot.top}
            top={plot.top}
            chartWidth={chartWidth}
          />
        )}
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
  onPeriodSelect,
  compactJournal = false,
  focusedMetric = null,
  focusedYear = null,
  comparisonYear = null
}: {
  series: FinancialChartPoint[];
  periodMode: FinancialPeriodMode;
  selectedPeriod: string | null;
  onPeriodModeChange: (mode: FinancialPeriodMode) => void;
  onPeriodSelect: (period: string) => void;
  compactJournal?: boolean;
  focusedMetric?: string | null;
  focusedYear?: number | null;
  comparisonYear?: number | null;
}) {
  const renderablePoints = series.filter(isRenderableProfitabilityPoint);
  const points = periodMode === "annual" ? companyJournalAnnualHistory(renderablePoints) : renderablePoints.slice(-12);
  const tablePoints = points.slice(periodMode === "annual" ? -companyJournalHistoryYears() : -8);
  const selectedPoint = points.find((point) => financialPointKey(point) === selectedPeriod) ?? points.at(-1);
  const focusedPoint = focusedYear == null ? null : tablePoints.find((point) => financialPointYear(point) === focusedYear);
  const comparisonPoint = comparisonYear == null ? null : tablePoints.find((point) => financialPointYear(point) === comparisonYear);
  const financialFocus = focusedMetric && focusedPoint ? {
    periods: [focusedPoint, comparisonPoint].filter((point): point is FinancialChartPoint => point != null).map(financialPointKey),
    rowMarkers: [focusedMetric as FinancialTableRow["marker"]],
    primaryRowMarker: focusedMetric as FinancialTableRow["marker"]
  } : undefined;
  const comparisonPeriod = comparisonPoint ? financialPointKey(comparisonPoint) : null;
  return (
    <section className="company-profitability-dashboard" aria-label="수익성과 투자수익률">
      {!compactJournal && <header className="company-profitability-dashboard-header">
        <div>
          <strong>{selectedPoint ? formatFinancialSelectionLabel(selectedPoint, periodMode) : "재무 시계열"}</strong>
          <span>막대 또는 선의 점을 선택하면 기업저널 해석이 같은 기간으로 바뀝니다.</span>
        </div>
        <div className="company-financial-period-controls" role="group" aria-label="재무 표시 기간">
          <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>2021년~</button>
          <button type="button" aria-pressed={periodMode === "quarterly"} onClick={() => onPeriodModeChange("quarterly")}>분기 12개</button>
        </div>
      </header>}
      <div className="company-profitability-chart-grid">
        <section className="company-financial-metric-block" aria-label="수익 성장지표와 기간별 수치">
          <ProfitGrowthChart points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedMetric} />
          <section className="company-profitability-table-section" aria-label="기간별 수익 성장 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 수익 성장 수치</strong>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildProfitGrowthRows(tablePoints, periodMode)}
              selectedPeriod={selectedPeriod}
              focus={financialFocus}
              emptyLabel="수익 성장 데이터 확인 중"
            />
          </section>
        </section>
        <section className="company-financial-metric-block" aria-label="투자수익률과 기간별 수치">
          <InvestmentReturnChart points={points} periodMode={periodMode} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedMetric} />
          <section className="company-profitability-table-section" aria-label="기간별 투자수익률 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 투자수익률 수치</strong>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildInvestmentReturnRows(tablePoints, periodMode)}
              selectedPeriod={selectedPeriod}
              focus={financialFocus}
              emptyLabel="투자수익률 데이터 확인 중"
            />
          </section>
        </section>
      </div>
    </section>
  );
}

function ProfitGrowthChart({ points, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps) {
  return (
    <FinancialStaticChartCard
      title="수익 성장지표"
    >
      <ProfitGrowthPlot points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedMetric} />
    </FinancialStaticChartCard>
  );
}

function ProfitGrowthPlot({ points, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  if (!points.length) return <div className="company-profitability-empty-card">재무 시계열 확인 중</div>;
  const moneyValues = points.map((point) => point.revenue).filter((value): value is number => Number.isFinite(value ?? NaN));
  const operatingMargins = points.map((point) => safeDivide(point.operatingIncome, point.revenue));
  const netMargins = points.map((point) => safeDivide(point.netIncome, point.revenue));
  const marginValues = [...operatingMargins, ...netMargins].filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1 });
  const marginDomain = paddedDomain(marginValues, { includeZero: true, fallbackMax: 0.3 });
  const plot = responsiveChartPlot(chartWidth, { left: 96, right: 54, top: 12, bottom: 38, compactLeft: 62, compactRight: 38 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(8, Math.min(34, slot * 0.45));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, marginDomain, plot.top, innerHeight);
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, barWidth / 2 + 4);
  const operatingPath = financialLinePath(operatingMargins, xFor, ratioY);
  const netPath = financialLinePath(netMargins, xFor, ratioY);
  const latestIndex = points.length - 1;
  const latestRevenue = points[latestIndex]?.revenue;
  const latestYValues = [
    Number.isFinite(latestRevenue ?? NaN) ? moneyY(latestRevenue as number) : null,
    Number.isFinite(operatingMargins[latestIndex] ?? NaN) ? ratioY(operatingMargins[latestIndex] as number) : null,
    Number.isFinite(netMargins[latestIndex] ?? NaN) ? ratioY(netMargins[latestIndex] as number) : null
  ].filter((value): value is number => value != null);
  return (
    <svg ref={chartRef} className="company-profitability-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="매출액 영업이익률 순이익률 시계열">
      {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
        const y = moneyY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text></g>;
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
            className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""} ${key === comparisonPeriod ? "is-comparison" : ""}`}
            data-journal-mark={index === points.length - 1 ? "profitability-latest" : undefined}
            role="button"
            tabIndex={0}
            aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`}
            onClick={() => onPeriodSelect(key)}
            onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}
          >
            {revenue != null && <rect data-journal-financial-metric={focusedMetric === "revenue" ? "revenue" : undefined} data-journal-financial-year={focusedMetric === "revenue" ? financialPointYear(point) ?? undefined : undefined} className={`company-profitability-bar revenue ${focusedMetric === "revenue" && (key === selectedPeriod || key === comparisonPeriod) ? "is-focused" : ""}`} x={x - barWidth / 2} y={Math.min(moneyY(revenue), zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - moneyY(revenue)))} rx={5} />}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>}
          </g>
        );
      })}
      {operatingPath && <path className="company-profitability-operating-line" d={operatingPath} />}
      {netPath && <path className="company-profitability-net-line" d={netPath} />}
      {points.flatMap((point, index) => financialRatioDots(point, index, [
        { key: "operating-margin", value: operatingMargins[index], className: "company-profitability-operating-dot" },
        { key: "net-margin", value: netMargins[index], className: "company-profitability-net-dot" }
      ], xFor, ratioY, selectedPeriod, comparisonPeriod, onPeriodSelect, index === points.length - 1 ? "profitability-latest" : undefined, focusedMetric))}
      <JournalChartAnnotation
        target="profitability-latest"
        label="매출·마진 동반 개선"
        x={xFor(latestIndex)}
        y={latestYValues.length ? Math.min(...latestYValues) : plot.top}
        top={plot.top}
        chartWidth={chartWidth}
      />
    </svg>
  );
}

function InvestmentReturnChart({ points, periodMode, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps & { periodMode: FinancialPeriodMode }) {
  const multiplier = periodMode === "quarterly" ? 4 : 1;
  const roe = points.map((point, index) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalEquity")));
  const roa = points.map((point, index) => safeDivide(multiplyFinite(point.netIncome, multiplier), averageFinancialBalance(points, index, "totalAssets")));
  const fcfMargin = points.map((point) => safeDivide(point.freeCashFlow, point.revenue));
  return (
    <FinancialStaticChartCard
      title="투자수익률"
    >
      <InvestmentReturnPlot points={points} ratios={{ roe, roa, fcfMargin }} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedMetric} />
    </FinancialStaticChartCard>
  );
}

function InvestmentReturnPlot({ points, ratios, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps & { ratios: ReturnRatios }) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  if (!points.length) return <div className="company-profitability-empty-card">투자수익률 데이터 확인 중</div>;
  const moneyValues = points.map((point) => point.netIncome).filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = [...ratios.roe, ...ratios.roa, ...ratios.fcfMargin].filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1 });
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 0.3 });
  const plot = responsiveChartPlot(chartWidth, { left: 96, right: 54, top: 12, bottom: 38, compactLeft: 62, compactRight: 38 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(8, Math.min(34, slot * 0.45));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, barWidth / 2 + 4);
  const latestIndex = points.length - 1;
  const latestIncome = points[latestIndex]?.netIncome;
  const latestYValues = [
    Number.isFinite(latestIncome ?? NaN) ? moneyY(latestIncome as number) : null,
    Number.isFinite(ratios.roe[latestIndex] ?? NaN) ? ratioY(ratios.roe[latestIndex] as number) : null,
    Number.isFinite(ratios.roa[latestIndex] ?? NaN) ? ratioY(ratios.roa[latestIndex] as number) : null,
    Number.isFinite(ratios.fcfMargin[latestIndex] ?? NaN) ? ratioY(ratios.fcfMargin[latestIndex] as number) : null
  ].filter((value): value is number => value != null);
  return (
    <svg ref={chartRef} className="company-profitability-plot company-return-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="당기순이익 ROE ROA FCF Margin 시계열">
      {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
        const y = moneyY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text></g>;
      })}
      {makeTicks(ratioDomain.min, ratioDomain.max, 5).map((tick) => <text key={`ratio-${tick}`} className="company-financial-axis-ratio" x={chartWidth - plot.right + 8} y={ratioY(tick) + 5}>{formatRatioPercent(tick)}</text>)}
      <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
      {points.map((point, index) => {
        const x = xFor(index);
        const key = financialPointKey(point);
        const netIncome = Number.isFinite(point.netIncome ?? NaN) ? point.netIncome as number : null;
        return (
          <g key={`${key}-${index}`} className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""} ${key === comparisonPeriod ? "is-comparison" : ""}`} data-journal-mark={index === points.length - 1 ? "returns-latest" : undefined} role="button" tabIndex={0} aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`} onClick={() => onPeriodSelect(key)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}>
            {netIncome != null && <rect data-journal-financial-metric={focusedMetric === "net-income" ? "net-income" : undefined} data-journal-financial-year={focusedMetric === "net-income" ? financialPointYear(point) ?? undefined : undefined} className={`company-return-bar net-income ${focusedMetric === "net-income" && (key === selectedPeriod || key === comparisonPeriod) ? "is-focused" : ""}`} x={x - barWidth / 2} y={Math.min(moneyY(netIncome), zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - moneyY(netIncome)))} rx={5} />}
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
        { key: "fcf-margin", value: ratios.fcfMargin[index], className: "company-return-dot fcf-margin" }
      ], xFor, ratioY, selectedPeriod, comparisonPeriod, onPeriodSelect, index === points.length - 1 ? "returns-latest" : undefined, focusedMetric))}
      <JournalChartAnnotation
        target="returns-latest"
        label="자본 효율·현금 확인"
        x={xFor(latestIndex)}
        y={latestYValues.length ? Math.min(...latestYValues) : plot.top}
        top={plot.top}
        chartWidth={chartWidth}
      />
    </svg>
  );
}

function FinancialStaticChartCard({ title, children, legend, className = "" }: { title: ReactNode; children: ReactNode; legend?: ReactNode; className?: string }) {
  return <section className={`company-financial-static-card ${className}`.trim()}><strong>{title}</strong>{children}{legend}</section>;
}

type FinancialInteractiveChartProps = {
  points: FinancialChartPoint[];
  selectedPeriod: string | null;
  comparisonPeriod?: string | null;
  onPeriodSelect: (period: string) => void;
  focusedMetric?: string | null;
};

type ReturnRatios = { roe: Array<number | null>; roa: Array<number | null>; fcfMargin: Array<number | null> };

function StabilityDashboard({
  financialSeries,
  periodMode,
  onPeriodModeChange,
  compactJournal = false,
  focusedMetric = null,
  focusedYear = null,
  comparisonYear = null
}: {
  financialSeries: FinancialChartPoint[];
  periodMode: FinancialPeriodMode;
  onPeriodModeChange: (mode: FinancialPeriodMode) => void;
  compactJournal?: boolean;
  focusedMetric?: string | null;
  focusedYear?: number | null;
  comparisonYear?: number | null;
}) {
  const renderablePoints = financialSeries.filter(isRenderableStabilityPoint);
  const points = periodMode === "annual" ? companyJournalAnnualHistory(renderablePoints) : renderablePoints.slice(-12);
  const tablePoints = points.slice(periodMode === "annual" ? -companyJournalHistoryYears() : -8);
  const focusedPoint = focusedYear == null
    ? tablePoints.at(-1)
    : tablePoints.find((point) => financialPointYear(point) === focusedYear);
  const comparisonPoint = comparisonYear == null
    ? null
    : tablePoints.find((point) => financialPointYear(point) === comparisonYear);
  const focusPeriods = [focusedPoint, comparisonPoint].filter((point): point is FinancialChartPoint => point != null).map(financialPointKey);
  const stabilityFocus = focusedMetric ? {
    periods: focusPeriods,
    rowMarkers: [focusedMetric as FinancialTableRow["marker"]],
    primaryRowMarker: focusedMetric as FinancialTableRow["marker"]
  } : undefined;
  return (
    <section className="company-stability-dashboard" aria-label="재무 안정성">
      {!compactJournal && <header className="company-valuation-dashboard-header">
        <div>
          <strong>재무 안정성</strong>
          <span>자본·부채 구조와 단기 유동성, 이자 부담을 같은 기간으로 확인합니다.</span>
        </div>
        <div className="company-financial-period-controls" role="group" aria-label="안정성 표시 기간">
          <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>2021년~</button>
          <button type="button" aria-pressed={periodMode === "quarterly"} onClick={() => onPeriodModeChange("quarterly")}>분기 12개</button>
        </div>
      </header>}
      <div className="company-stability-dashboard-grid">
        <section className="company-financial-metric-block" aria-label="자본·부채 구조와 기간별 수치">
          <StabilityFinanceChart series={points} focusedMetric={focusedMetric} focusPeriods={focusPeriods} />
          <section className="company-stability-dashboard-table" aria-label="자본·부채 기간별 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 자본·부채 수치</strong>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildStabilityCapitalRows(tablePoints, periodMode)}
              emptyLabel="자본·부채 데이터 확인 중"
              focus={stabilityFocus}
            />
          </section>
        </section>
        <section className="company-financial-metric-block" aria-label="안정성지표와 기간별 수치">
          <StabilityRatiosChart series={points} focusedMetric={focusedMetric} focusPeriods={focusPeriods} />
          <section className="company-stability-dashboard-table" aria-label="유동성과 이자 부담 기간별 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 안정성 수치</strong>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildStabilityHealthRows(tablePoints, periodMode)}
              emptyLabel="안정성지표 데이터 확인 중"
              focus={stabilityFocus}
            />
          </section>
        </section>
      </div>
    </section>
  );
}

function StabilityRatiosChart({
  series,
  focusedMetric = null,
  focusPeriods = []
}: {
  series: FinancialChartPoint[];
  focusedMetric?: string | null;
  focusPeriods?: string[];
}) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  const points = series.filter(isRenderableStabilityRatiosPoint).slice(-12);
  if (!points.length) {
    return (
      <FinancialChartShell
        className="company-stability-ratios-card"
        title="안정성지표"
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 비율 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">안정성 비율 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const debtRatios = points.map(debtRatioFor);
  const currentRatios = points.map(currentLiabilityRatioFor);
  const noncurrentRatios = points.map(noncurrentLiabilityRatioFor);
  const focusedHealthDefinition = focusedMetric === "current-ratio"
    ? { key: "current-ratio", values: points.map(currentRatioFor), className: "current-ratio" }
    : focusedMetric === "interest-coverage"
      ? { key: "interest-coverage", values: points.map(interestCoverageFor), className: "interest-coverage" }
      : focusedMetric === "financial-cost-burden"
        ? { key: "financial-cost-burden", values: points.map(financialCostBurdenFor), className: "financial-cost-burden" }
        : null;
  const ratioDefinitions = focusedHealthDefinition ? [focusedHealthDefinition] : [
    { key: "debt-ratio", values: debtRatios, className: "debt-ratio" },
    { key: "current-liability-ratio", values: currentRatios, className: "current-liability-ratio" },
    { key: "noncurrent-liability-ratio", values: noncurrentRatios, className: "noncurrent-liability-ratio" }
  ];
  const ratioValues = ratioDefinitions.flatMap((definition) => definition.values)
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 1 });
  const plot = responsiveChartPlot(chartWidth, { left: 78, right: 20, top: 10, bottom: 34, compactLeft: 58, compactRight: 12 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, 6);
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  const latestIndex = points.length - 1;
  const latestYValues = ratioDefinitions.map((definition) => definition.values[latestIndex])
    .filter((value): value is number => Number.isFinite(value ?? NaN))
    .map(ratioY);
  return (
    <FinancialChartShell
      className="company-stability-ratios-card"
      title="안정성지표"
      table={<FinancialSeriesTable points={points.slice(-6)} rows={buildStabilityRatioTableRows(points.slice(-6))} />}
    >
      <svg ref={chartRef} className="company-profitability-plot company-stability-ratios-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={focusedHealthDefinition ? `${focusedHealthDefinition.key} 시계열` : "부채비율 유동부채비율 비유동부채비율 시계열"}>
        {makeTicks(ratioDomain.min, ratioDomain.max, 5).map((tick) => {
          const y = ratioY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{formatRatioPercent(tick)}</text>
            </g>
          );
        })}
        {points.map((point, index) => shouldShowPeriodLabel(index, points.length)
          ? <text key={`${point.period}-${index}-label`} className="company-profitability-period" x={xFor(index)} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>
          : null)}
        {ratioDefinitions.map((definition) => <path key={definition.key} className={`company-stability-metric-line ${definition.className}`} d={financialLinePath(definition.values, xFor, ratioY)} />)}
        {points.flatMap((point, index) => ratioDefinitions.map((metric) => Number.isFinite(metric.values[index] ?? NaN)
          ? <circle key={`${point.period}-${index}-${metric.key}`} className={`company-stability-metric-dot ${metric.className} ${focusedMetric === metric.key && focusPeriods.includes(financialPointKey(point)) ? "is-focused" : ""}`} data-journal-mark={index === points.length - 1 ? "stability-ratios-latest" : undefined} data-journal-financial-metric={focusedMetric === metric.key ? metric.key : undefined} data-journal-financial-year={focusedMetric === metric.key ? financialPointYear(point) ?? undefined : undefined} cx={xFor(index)} cy={ratioY(metric.values[index] as number)} r={focusedMetric === metric.key && focusPeriods.includes(financialPointKey(point)) ? 5 : 3.5} />
          : null))}
        <JournalChartAnnotation
          target="stability-ratios-latest"
          label="부채 구성 개선"
          x={xFor(latestIndex)}
          y={latestYValues.length ? Math.min(...latestYValues) : plot.top}
          top={plot.top}
          chartWidth={chartWidth}
        />
      </svg>
    </FinancialChartShell>
  );
}

function StabilityFinanceChart({
  series,
  focusedMetric = null,
  focusPeriods = []
}: {
  series: FinancialChartPoint[];
  focusedMetric?: string | null;
  focusPeriods?: string[];
}) {
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
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 재무 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">안정성 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const focusedMoneyDefinition = focusedMetric === "total-debt"
    ? { key: "total-debt", values: points.map((point) => Number.isFinite(point.totalDebt ?? NaN) ? point.totalDebt as number : null) }
    : focusedMetric === "net-debt"
      ? { key: "net-debt", values: points.map(netDebtFor) }
      : null;
  const moneyValues = points
    .flatMap((point, index) => [point.totalEquity, point.totalLiabilities, focusedMoneyDefinition?.values[index]])
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = points.map(debtRatioFor).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1, minFloor: 0 });
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 1 });
  const plot = responsiveChartPlot(chartWidth, { left: 92, right: 20, top: 10, bottom: 34, compactLeft: 62, compactRight: 12 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = points.length ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(6, Math.min(18, slot * 0.28));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const ratioY = (value: number) => valueToY(value, ratioDomain, plot.top, innerHeight);
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, barWidth + 4);
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
  const focusedMoneyPath = focusedMoneyDefinition
    ? financialLinePath(focusedMoneyDefinition.values, xFor, moneyY)
    : "";
  const latestIndex = points.length - 1;
  const latestPoint = points[latestIndex];
  const latestRatio = latestPoint ? debtRatioFor(latestPoint) : null;
  const latestYValues = [
    Number.isFinite(latestPoint?.totalEquity ?? NaN) ? moneyY(latestPoint?.totalEquity as number) : null,
    Number.isFinite(latestPoint?.totalLiabilities ?? NaN) ? moneyY(latestPoint?.totalLiabilities as number) : null,
    Number.isFinite(latestRatio ?? NaN) ? ratioY(latestRatio as number) : null,
    Number.isFinite(focusedMoneyDefinition?.values[latestIndex] ?? NaN)
      ? moneyY(focusedMoneyDefinition?.values[latestIndex] as number)
      : null
  ].filter((value): value is number => value != null);

  return (
    <FinancialChartShell
      className="company-stability-card"
      title="자본·부채 구조"
      table={<FinancialSeriesTable points={tablePoints} rows={buildStabilityTableRows(tablePoints)} />}
    >
      <svg ref={chartRef} className="company-profitability-plot company-stability-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="SEC 재무 안정성 시계열">
        {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
          const y = moneyY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text>
            </g>
          );
        })}
        <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
        {points.map((point, index) => {
          const x = xFor(index);
          const periodKey = financialPointKey(point);
          const focusedPeriod = focusPeriods.includes(periodKey);
          const totalEquity = Number.isFinite(point.totalEquity ?? NaN) ? point.totalEquity as number : null;
          const totalLiabilities = Number.isFinite(point.totalLiabilities ?? NaN) ? point.totalLiabilities as number : null;
          return (
            <g key={`${point.period}-${index}`} data-journal-mark={index === points.length - 1 ? "stability-capital-latest" : undefined}>
              {totalEquity != null && (
                <rect
                  className={`company-stability-bar equity ${focusedMetric === "equity" && focusedPeriod ? "is-focused" : ""}`}
                  data-journal-financial-metric={focusedMetric === "equity" ? "equity" : undefined}
                  data-journal-financial-year={focusedMetric === "equity" ? financialPointYear(point) ?? undefined : undefined}
                  x={x - barWidth - 2}
                  y={moneyY(totalEquity)}
                  width={barWidth}
                  height={Math.max(2, zeroY - moneyY(totalEquity))}
                  rx={5}
                />
              )}
              {totalLiabilities != null && (
                <rect
                  className={`company-stability-bar liabilities ${focusedMetric === "liabilities" && focusedPeriod ? "is-focused" : ""}`}
                  data-journal-financial-metric={focusedMetric === "liabilities" ? "liabilities" : undefined}
                  data-journal-financial-year={focusedMetric === "liabilities" ? financialPointYear(point) ?? undefined : undefined}
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
        {focusedMoneyDefinition && focusedMoneyPath && (
          <path className={`company-stability-money-line ${focusedMoneyDefinition.key}`} d={focusedMoneyPath} />
        )}
        {focusedMoneyDefinition && points.map((point, index) => {
          const value = focusedMoneyDefinition.values[index];
          if (!Number.isFinite(value ?? NaN)) return null;
          const focusedPeriod = focusPeriods.includes(financialPointKey(point));
          return (
            <circle
              key={`${point.period}-${index}-${focusedMoneyDefinition.key}`}
              className={`company-stability-money-dot ${focusedMoneyDefinition.key} ${focusedPeriod ? "is-focused" : ""}`}
              data-journal-financial-metric={focusedMoneyDefinition.key}
              data-journal-financial-year={financialPointYear(point) ?? undefined}
              cx={xFor(index)}
              cy={moneyY(value as number)}
              r={focusedPeriod ? 5 : 3.5}
            />
          );
        })}
        {ratioPath && <path className="company-stability-ratio-line" d={ratioPath} />}
        {points.map((point, index) => {
          const ratio = debtRatioFor(point);
          return Number.isFinite(ratio ?? NaN)
            ? <circle key={`${point.period}-${index}-debt-ratio`} className={`company-stability-ratio-dot ${focusedMetric === "debt-ratio" && focusPeriods.includes(financialPointKey(point)) ? "is-focused" : ""}`} data-journal-mark={index === points.length - 1 ? "stability-capital-latest" : undefined} data-journal-financial-metric={focusedMetric === "debt-ratio" ? "debt-ratio" : undefined} data-journal-financial-year={focusedMetric === "debt-ratio" ? financialPointYear(point) ?? undefined : undefined} cx={xFor(index)} cy={ratioY(ratio as number)} r={focusedMetric === "debt-ratio" && focusPeriods.includes(financialPointKey(point)) ? 5 : 3.5} />
            : null;
        })}
        <JournalChartAnnotation
          target="stability-capital-latest"
          label="자본 증가가 더 빠름"
          x={xFor(latestIndex)}
          y={latestYValues.length ? Math.min(...latestYValues) : plot.top}
          top={plot.top}
          chartWidth={chartWidth}
        />
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
  legend?: ReactNode;
  table: ReactNode;
}) {
  const [activePage, setActivePage] = useState<0 | 1>(0);
  return (
    <div className={`company-financial-chart-card ${className}`}>
      <div key={activePage} className={`company-analysis-page ${activePage === 0 ? "company-financial-overview-page" : "company-financial-detail-page"}`}>
        {activePage === 0 ? (
          <>
            <div className="company-financial-chart-copy">
              <strong>{title}</strong>
              {subtitle && <span>{subtitle}</span>}
            </div>
            {children}
            {legend}
          </>
        ) : (
          <>
            <div className="company-financial-chart-copy">
              <strong>{title}</strong>
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
  valuationPrices,
  compactJournal = false,
  focusedValuationMetric = null,
  focusedFinancialMetric = null,
  focusedFinancialYear = null,
  comparisonFinancialYear = null,
  analystActions = emptyAnalystActions,
  showAnalystOpinion = true,
  companyName
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
  compactJournal?: boolean;
  focusedValuationMetric?: string | null;
  focusedFinancialMetric?: string | null;
  focusedFinancialYear?: number | null;
  comparisonFinancialYear?: number | null;
  analystActions?: readonly CompanyJournalAnalystAction[];
  showAnalystOpinion?: boolean;
  companyName: string;
}) {
  const renderablePoints = financialSeries.filter(isRenderablePerSharePoint);
  const points = periodMode === "annual" ? companyJournalAnnualHistory(renderablePoints) : renderablePoints.slice(-12);
  const tablePoints = points.slice(periodMode === "annual" ? -companyJournalHistoryYears() : -8);
  const selectedPoint = points.find((point) => financialPointKey(point) === selectedPeriod) ?? points.at(-1);
  const historicalValuationSeries = buildHistoricalValuationSeries(points, valuationPrices);
  const focusedPoint = focusedFinancialYear == null
    ? null
    : tablePoints.find((point) => financialPointYear(point) === focusedFinancialYear);
  const comparisonPoint = comparisonFinancialYear == null
    ? null
    : tablePoints.find((point) => financialPointYear(point) === comparisonFinancialYear);
  const comparisonPeriod = comparisonPoint ? financialPointKey(comparisonPoint) : null;
  const perShareFocus = focusedFinancialMetric && ["eps", "bps", "sps", "cps"].includes(focusedFinancialMetric) && focusedPoint ? {
    periods: [focusedPoint, comparisonPoint].filter((point): point is FinancialChartPoint => point != null).map(financialPointKey),
    rowMarkers: [focusedFinancialMetric as FinancialTableRow["marker"]],
    primaryRowMarker: focusedFinancialMetric as FinancialTableRow["marker"]
  } : undefined;
  const showEarnings = contentMode !== "valuation";
  const showValuation = contentMode !== "earnings";
  return (
    <section className={`company-chart-column company-valuation-column company-valuation-dashboard is-${contentMode}`} aria-label={`${symbol} ${contentMode === "earnings" ? "실적" : contentMode === "valuation" ? "가치평가" : "실적과 가치평가"}`}>
      {showValuation && !compactJournal && (
        <header className="company-valuation-dashboard-header">
          <div>
            <strong>{selectedPoint ? formatFinancialSelectionLabel(selectedPoint, periodMode) : "가치"}</strong>
            <span>주당지표의 변화와 현재 가격 기준 가치지표를 함께 봅니다.</span>
          </div>
          <div className="company-financial-period-controls" role="group" aria-label="가치지표 표시 기간">
            <button type="button" aria-pressed={periodMode === "annual"} onClick={() => onPeriodModeChange("annual")}>2021년~</button>
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
            analystActions={analystActions}
            showAnalystOpinion={showAnalystOpinion}
            companyName={companyName}
          />
          {showValuation && <PerShareIndicatorsChart points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedFinancialMetric} />}
        </div>
      )}
      {showValuation && !showEarnings && (
        <div className="company-valuation-dashboard-grid is-valuation-only">
          <section className="company-financial-metric-block company-per-share-block" aria-label="주당지표와 기간별 주당지표">
            <PerShareIndicatorsChart points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedFinancialMetric} />
            <section className="company-per-share-table-section" aria-label="기간별 주당지표 수치">
              <div className="company-profitability-table-heading">
                <strong>기간별 주당지표</strong>
              </div>
              <FinancialSeriesTable
                points={tablePoints}
                rows={buildPerShareTableRows(tablePoints, periodMode)}
                selectedPeriod={selectedPeriod}
                focus={perShareFocus}
                emptyLabel="주당지표 데이터 확인 중"
              />
            </section>
          </section>
          <section className="company-financial-metric-block company-valuation-metrics-block" aria-label="가치배수 추이와 현재 가치배수">
            <HistoricalValuationChart points={historicalValuationSeries} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedValuationMetric} />
            <ValuationMetricsPanel metrics={metrics} focusedMetric={focusedValuationMetric} />
          </section>
        </div>
      )}
      {showValuation && showEarnings && (
        <div className={`company-valuation-dashboard-detail ${!showEarnings ? "is-valuation-only" : ""}`}>
          <ValuationMetricsPanel metrics={metrics} focusedMetric={focusedValuationMetric} />
          <section className="company-per-share-table-section" aria-label="기간별 주당지표 수치">
            <div className="company-profitability-table-heading">
              <strong>기간별 주당지표</strong>
            </div>
            <FinancialSeriesTable
              points={tablePoints}
              rows={buildPerShareTableRows(tablePoints, periodMode)}
              selectedPeriod={selectedPeriod}
              focus={perShareFocus}
              emptyLabel="주당지표 데이터 확인 중"
            />
          </section>
        </div>
      )}
    </section>
  );
}

function PerShareIndicatorsChart({ points, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps) {
  return (
    <FinancialStaticChartCard
      title="주당지표"
    >
      <PerShareIndicatorsPlot points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={focusedMetric} />
    </FinancialStaticChartCard>
  );
}

function HistoricalValuationChart({
  points,
  selectedPeriod,
  comparisonPeriod,
  onPeriodSelect,
  focusedMetric
}: {
  points: HistoricalValuationPoint[];
  selectedPeriod: string | null;
  comparisonPeriod?: string | null;
  onPeriodSelect: (period: string) => void;
  focusedMetric: string | null;
}) {
  const historicalFocus = focusedMetric === "per" || focusedMetric === "pbr" || focusedMetric === "psr" || focusedMetric === "fcf-yield"
    ? focusedMetric
    : null;
  return (
    <FinancialStaticChartCard
      title={<GlossaryText text="가치배수 추이" />}
      className={historicalFocus ? "has-focused-valuation-metric" : ""}
      legend={(
        <div className="company-profitability-legend company-historical-valuation-legend" aria-label="가치지표 범례">
          <span className={historicalFocus === "per" ? "is-focused" : ""}><i className="per" /><GlossaryText text="PER" /></span>
          <span className={historicalFocus === "pbr" ? "is-focused" : ""}><i className="pbr" /><GlossaryText text="PBR" /></span>
          <span className={historicalFocus === "psr" ? "is-focused" : ""}><i className="psr" /><GlossaryText text="PSR" /></span>
          <span className={historicalFocus === "fcf-yield" ? "is-focused" : ""}><i className="fcf-yield" /><GlossaryText text="FCF Yield" /></span>
        </div>
      )}
    >
      <HistoricalValuationPlot points={points} selectedPeriod={selectedPeriod} comparisonPeriod={comparisonPeriod} onPeriodSelect={onPeriodSelect} focusedMetric={historicalFocus} />
    </FinancialStaticChartCard>
  );
}

function HistoricalValuationPlot({
  points,
  selectedPeriod,
  comparisonPeriod,
  onPeriodSelect,
  focusedMetric
}: {
  points: HistoricalValuationPoint[];
  selectedPeriod: string | null;
  comparisonPeriod?: string | null;
  onPeriodSelect: (period: string) => void;
  focusedMetric: string | null;
}) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  const per = points.map((point) => point.per);
  const pbr = points.map((point) => point.pbr);
  const psr = points.map((point) => point.psr);
  const fcfYield = points.map((point) => point.fcfYield);
  const showingFcfYield = focusedMetric === "fcf-yield";
  const seriesDefinitions: Array<{ key: string; values: Array<number | null>; className: string }> = showingFcfYield
    ? [{ key: "fcf-yield", values: fcfYield, className: "fcf-yield" }]
    : [
      { key: "per", values: per, className: "per" },
      { key: "pbr", values: pbr, className: "pbr" },
      { key: "psr", values: psr, className: "psr" }
    ];
  const values = seriesDefinitions.flatMap((definition) => definition.values).filter((value): value is number => Number.isFinite(value ?? NaN));
  if (!points.length || !values.length) return <div className="company-profitability-empty-card">결산일 가격 데이터 확인 중</div>;
  const domain = paddedDomain(values, { includeZero: true, fallbackMax: showingFcfYield ? 0.05 : 10, minFloor: showingFcfYield ? undefined : 0 });
  const plot = responsiveChartPlot(chartWidth, { left: 70, right: 24, top: 12, bottom: 38, compactLeft: 54, compactRight: 14 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, 6);
  const multipleY = (value: number) => valueToY(value, domain, plot.top, innerHeight);
  const latestIndex = points.length - 1;
  const latestValues = seriesDefinitions
    .map((definition) => definition.values[latestIndex])
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const latestY = latestValues.length ? Math.min(...latestValues.map(multipleY)) : plot.top;
  return (
    <svg ref={chartRef} className="company-profitability-plot company-historical-valuation-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={showingFcfYield ? "결산일 가격 기준 FCF Yield 시계열" : "결산일 가격 기준 PER PBR PSR 시계열"}>
      {makeTicks(domain.min, domain.max, 5).map((tick) => {
        const y = multipleY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{showingFcfYield ? formatRatioPercent(tick) : formatMultipleAxis(tick)}</text></g>;
      })}
      {seriesDefinitions.map((definition) => (
        <path key={definition.key} data-journal-metric={definition.key} className={`company-historical-valuation-line ${definition.className} ${focusedMetric === definition.key ? "is-focused" : focusedMetric ? "is-muted" : ""}`} d={financialLinePath(definition.values, xFor, multipleY)} />
      ))}
      {points.map((point, index) => {
        const periodKey = financialPointKey(point.financial);
        return (
          <g key={`${periodKey}-${index}`} className={`company-financial-period-point ${periodKey === selectedPeriod ? "is-selected" : ""} ${periodKey === comparisonPeriod ? "is-comparison" : ""}`} data-journal-mark={index === points.length - 1 ? "valuation-latest" : undefined} role="button" tabIndex={0} aria-label={`${formatPeriod(point.financial.period, point.financial.periodEndDate)} 가치지표 선택`} onClick={() => onPeriodSelect(periodKey)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(periodKey))}>
            {seriesDefinitions.map((definition) => {
              const value = definition.values[index];
              if (!Number.isFinite(value ?? NaN)) return null;
              const exactFocus = focusedMetric === definition.key && (periodKey === selectedPeriod || periodKey === comparisonPeriod);
              const valueLabel = definition.key === "fcf-yield" ? formatRatioPercent(value) : formatMultiple(value);
              return <circle key={definition.key} data-journal-metric={definition.key} data-journal-financial-metric={exactFocus ? definition.key : undefined} data-journal-financial-year={exactFocus ? financialPointYear(point.financial) ?? undefined : undefined} className={`company-historical-valuation-dot ${definition.className} ${periodKey === selectedPeriod ? "is-selected" : ""} ${periodKey === comparisonPeriod ? "is-comparison" : ""} ${exactFocus ? "is-focused" : focusedMetric ? "is-muted" : ""}`} cx={xFor(index)} cy={multipleY(value as number)} r={periodKey === selectedPeriod || periodKey === comparisonPeriod || exactFocus ? 5 : 3.8}><title>{`${formatPeriod(point.financial.period, point.financial.periodEndDate)} · ${definition.key.toUpperCase()} ${valueLabel}`}</title></circle>;
            })}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={xFor(index)} y={chartHeight - 12}>{formatPeriod(point.financial.period, point.financial.periodEndDate)}</text>}
          </g>
        );
      })}
      <JournalChartAnnotation
        target="valuation-latest"
        label="현재 가치 배수 확인"
        x={xFor(latestIndex)}
        y={latestY}
        top={plot.top}
        chartWidth={chartWidth}
      />
    </svg>
  );
}

function PerShareIndicatorsPlot({ points, selectedPeriod, comparisonPeriod, onPeriodSelect, focusedMetric }: FinancialInteractiveChartProps) {
  const { chartRef, chartWidth, chartHeight } = useFinancialChartSize();
  if (!points.length) return <div className="company-profitability-empty-card">주당지표 시계열 확인 중</div>;
  const metrics = points.map(perShareMetricsForPoint);
  const values = metrics.flatMap((point) => [point.eps, point.bps, point.sps, point.cps]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const domain = paddedDomain(values, { includeZero: true, fallbackMax: 1 });
  const plot = responsiveChartPlot(chartWidth, { left: 76, right: 20, top: 12, bottom: 38, compactLeft: 56, compactRight: 12 });
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = innerWidth / points.length;
  const barWidth = Math.max(4, Math.min(15, slot * 0.17));
  const zeroY = valueToY(0, domain, plot.top, innerHeight);
  const valueY = (value: number) => valueToY(value, domain, plot.top, innerHeight);
  const xFor = (index: number) => financialChartPointX(index, points.length, plot.left, innerWidth, barWidth * 2 + 4);
  const seriesDefinitions = [
    { key: "eps", className: "eps", offset: -1.5 },
    { key: "bps", className: "bps", offset: -0.5 },
    { key: "sps", className: "sps", offset: 0.5 },
    { key: "cps", className: "cps", offset: 1.5 }
  ] as const;
  const latestIndex = points.length - 1;
  const latestMetrics = metrics[latestIndex]!;
  const latestValues = seriesDefinitions
    .map((definition) => latestMetrics[definition.key])
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const latestY = latestValues.length ? Math.min(...latestValues.map(valueY)) : plot.top;
  return (
    <svg ref={chartRef} className="company-profitability-plot company-per-share-plot" style={financialChartAxisTypography} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="EPS BPS SPS CPS 주당지표 시계열">
      {makeTicks(domain.min, domain.max, 5).map((tick) => {
        const y = valueY(tick);
        return <g key={tick}><line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} /><text className="company-financial-axis-value" x={financialChartAxisLabelX} y={y + 5}>{formatPerShareAxis(tick)}</text></g>;
      })}
      <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
      {points.map((point, index) => {
        const x = xFor(index);
        const key = financialPointKey(point);
        const valuesForPoint = metrics[index]!;
        return (
          <g key={`${key}-${index}`} className={`company-financial-period-point ${key === selectedPeriod ? "is-selected" : ""} ${key === comparisonPeriod ? "is-comparison" : ""}`} data-journal-mark={index === points.length - 1 ? "per-share-latest" : undefined} role="button" tabIndex={0} aria-label={`${formatPeriod(point.period, point.periodEndDate)} 선택`} onClick={() => onPeriodSelect(key)} onKeyDown={(event) => handleFinancialPointKeyDown(event.key, () => onPeriodSelect(key))}>
            {seriesDefinitions.map((definition) => {
              const value = valuesForPoint[definition.key];
              if (!Number.isFinite(value ?? NaN)) return null;
              const y = valueY(value as number);
              const exactFocus = (key === selectedPeriod || key === comparisonPeriod) && definition.key === focusedMetric;
              return <rect key={definition.key} data-journal-financial-metric={exactFocus ? definition.key : undefined} data-journal-financial-year={exactFocus ? financialPointYear(point) ?? undefined : undefined} className={`company-per-share-bar ${definition.className} ${exactFocus ? "is-focused" : ""}`} x={x + definition.offset * barWidth - barWidth / 2} y={Math.min(y, zeroY)} width={barWidth} height={Math.max(2, Math.abs(zeroY - y))} rx={3} />;
            })}
            {shouldShowPeriodLabel(index, points.length) && <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>}
          </g>
        );
      })}
      <JournalChartAnnotation
        target="per-share-latest"
        label="주당 실적 증가"
        x={xFor(latestIndex)}
        y={latestY}
        top={plot.top}
        chartWidth={chartWidth}
      />
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

export function CompanyJournalAnalystOpinionPanel({
  analystActions,
  companyName
}: {
  analystActions: readonly CompanyJournalAnalystAction[];
  companyName: string;
}) {
  const analystOpinion = analystActions
    .map((action) => formatCompanyJournalAnalystOpinion(action, companyName))
    .find((opinion): opinion is CompanyJournalAnalystOpinion => opinion != null) ?? null;
  return (
    <section className="company-journal-analyst-opinion" aria-label="투자사 의견" aria-live="polite">
      <h3>투자사 의견</h3>
      <p>{analystOpinion?.message ?? "확인된 투자사 의견이 없습니다."}</p>
    </section>
  );
}

function EarningsPanel({
  metric,
  onMetricChange,
  series,
  comparison,
  analystActions,
  showAnalystOpinion,
  companyName
}: {
  metric: EarningsMetric;
  onMetricChange: (metric: EarningsMetric) => void;
  series: EarningsChartPoint[];
  comparison: ReturnType<typeof buildComparison>;
  analystActions: readonly CompanyJournalAnalystAction[];
  showAnalystOpinion: boolean;
  companyName: string;
}) {
  return (
    <section className="company-earnings-panel" aria-label="실적 내역">
      <div className="company-earnings-panel-header">
        {showAnalystOpinion && <CompanyJournalAnalystOpinionPanel analystActions={analystActions} companyName={companyName} />}
        <div className="company-earnings-heading">
          <h3>실적 내역</h3>
          <div className="company-earnings-tabs" role="tablist" aria-label="실적 지표">
            <button type="button" className={metric === "eps" ? "active" : ""} onClick={() => onMetricChange("eps")}>EPS</button>
            <button type="button" className={metric === "revenue" ? "active" : ""} onClick={() => onMetricChange("revenue")}>수익</button>
          </div>
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

function ValuationMetricsPanel({ metrics, focusedMetric }: { metrics: ValuationMetric[]; focusedMetric: string | null }) {
  return (
    <section className="company-valuation-panel" aria-label="가치평가">
      <div className="company-section-heading">
        <h3><GlossaryText text="현재 가치배수" /></h3>
        <span><GlossaryText text="PER · PBR · PSR · FCF Yield" /></span>
      </div>
      <dl className="company-valuation-metric-list">
        {metrics.map((metric) => (
          <ValuationRow key={metric.label} metric={metric} focused={valuationMetricKey(metric.label) === focusedMetric} />
        ))}
      </dl>
    </section>
  );
}

function ValuationRow({ metric, focused }: { metric: ValuationMetric; focused: boolean }) {
  const metricKey = valuationMetricKey(metric.label);
  return (
    <div className={`company-valuation-metric-row ${focused ? "is-focused" : ""}`} data-journal-metric-row={metricKey} aria-label={`${metric.label} ${metric.valueLabel}${focused ? " 강조됨" : ""}`}>
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
  emptyLabel = "재무 데이터 확인 중",
  focus
}: {
  points: FinancialChartPoint[];
  rows: FinancialTableRow[];
  selectedPeriod?: string | null;
  emptyLabel?: string;
  focus?: {
    periods: string[];
    rowMarkers: FinancialTableRow["marker"][];
    primaryRowMarker: FinancialTableRow["marker"];
  };
}) {
  if (!points.length || !rows.length) {
    return <div className="company-financial-table-empty">{emptyLabel}</div>;
  }
  const showYoy = rows.some((row) => row.yoy !== undefined);
  return (
    <div className="company-financial-table-wrap">
      <table className="company-financial-table">
        <colgroup>
          <col className="company-financial-table-label-column" />
          {points.map((point, index) => (
            <col key={`${point.period}-${index}`} className="company-financial-table-period-column" />
          ))}
          {showYoy && <col className="company-financial-table-change-column" />}
        </colgroup>
        <thead>
          <tr>
            <th>항목</th>
            {points.map((point, index) => (
              <th
                key={`${point.period}-${index}`}
                className={[
                  financialPointKey(point) === selectedPeriod ? "is-selected" : "",
                  focus?.periods.includes(financialPointKey(point)) ? "is-evidence-period" : ""
                ].filter(Boolean).join(" ") || undefined}
              >{formatTablePeriod(point)}</th>
            ))}
            {showYoy && <th>전년대비</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const focusedRow = focus?.rowMarkers.includes(row.marker) ?? false;
            const primaryFocusedRow = focus?.primaryRowMarker === row.marker;
            return (
            <tr key={row.label} className={focusedRow ? "is-evidence-row" : undefined}>
              <th className={primaryFocusedRow ? "is-primary-evidence-row" : focusedRow ? "is-related-evidence-row" : undefined}>
                <i className={row.marker} />
                <GlossaryText text={row.label} />
              </th>
              {row.values.map((value, index) => {
                const point = points[index]!;
                const evidenceCell = focusedRow && (focus?.periods.includes(financialPointKey(point)) ?? false);
                const primaryEvidenceCell = evidenceCell && primaryFocusedRow && focus?.periods[0] === financialPointKey(point);
                return (
                <td
                  key={`${row.label}-${index}`}
                  className={[
                    value.startsWith("-") ? "down" : value.startsWith("+") ? "up" : "",
                    financialPointKey(point) === selectedPeriod ? "is-selected" : "",
                    evidenceCell ? "is-evidence-focus" : "",
                    primaryEvidenceCell ? "is-primary-evidence-focus" : ""
                  ].filter(Boolean).join(" ") || undefined}
                  data-journal-stability-focus={evidenceCell ? row.marker : undefined}
                  data-journal-financial-metric={evidenceCell ? row.marker : undefined}
                  data-journal-financial-year={evidenceCell ? financialPointYear(point) ?? undefined : undefined}
                  aria-label={evidenceCell ? `${formatTablePeriod(point)} ${row.label} ${value}${primaryEvidenceCell ? " 선택 근거" : " 관련 근거"}` : undefined}
                >{value}</td>
                );
              })}
              {showYoy && <td className={row.yoy?.startsWith("-") ? "down" : row.yoy?.startsWith("+") ? "up" : undefined}>{row.yoy ?? "확인 중"}</td>}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildValuationMetrics(price: number | null | undefined, marketCap: number | null | undefined, item: Sp500UniverseItem | undefined): ValuationMetric[] {
  const per = safeDivide(price, item?.eps);
  const pbr = safeDivide(marketCap, item?.totalEquity);
  const psr = safeDivide(marketCap, item?.revenue);
  const fcfYield = safeDivide(item?.freeCashFlow, marketCap);
  return [
    { label: "PER", valueLabel: formatMultiple(per) },
    { label: "PBR", valueLabel: formatMultiple(pbr) },
    { label: "PSR", valueLabel: formatMultiple(psr) },
    { label: "FCF Yield", valueLabel: formatRatioPercent(fcfYield) }
  ];
}

function valuationMetricKey(label: string): string {
  return label.toLowerCase().replaceAll(" ", "-");
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
      values: points.map((point) => formatUsdCompactTable(point.revenue)),
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
      values: points.map((point) => formatUsdCompactTable(point.netIncome)),
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

function buildProfitGrowthRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  return buildProfitabilityDashboardRows(points, periodMode).slice(0, 3);
}

function buildInvestmentReturnRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  return buildProfitabilityDashboardRows(points, periodMode).slice(3);
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

function buildStabilityCapitalRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  const latestIndex = points.length - 1;
  const comparisonIndex = latestIndex - (periodMode === "quarterly" ? 4 : 1);
  const latest = points[latestIndex];
  const comparison = points[comparisonIndex];
  const ratioYoy = (current: number | null, previous: number | null) => current == null || previous == null
    ? "확인 중"
    : formatPercentagePointChange(current - previous);
  return [
    {
      label: "총자본",
      marker: "equity",
      values: points.map((point) => formatUsdCompact(point.totalEquity)),
      yoy: formatValueGrowth(comparison?.totalEquity, latest?.totalEquity)
    },
    {
      label: "총부채",
      marker: "liabilities",
      values: points.map((point) => formatUsdCompact(point.totalLiabilities)),
      yoy: formatValueGrowth(comparison?.totalLiabilities, latest?.totalLiabilities)
    },
    {
      label: "부채비율",
      marker: "debt-ratio",
      values: points.map((point) => formatRatioPercent(debtRatioFor(point))),
      yoy: ratioYoy(latest ? debtRatioFor(latest) : null, comparison ? debtRatioFor(comparison) : null)
    }
  ];
}

function buildStabilityHealthRows(points: FinancialChartPoint[], periodMode: FinancialPeriodMode): FinancialTableRow[] {
  return buildStabilityDashboardTableRows(points, periodMode).slice(1);
}

function isRenderableProfitabilityPoint(point: FinancialChartPoint): boolean {
  return Number.isFinite(point.revenue ?? NaN) &&
    Number.isFinite(point.netIncome ?? NaN) &&
    (point.revenue as number) > 0;
}

function isRenderableStabilityPoint(point: FinancialChartPoint): boolean {
  return Number.isFinite(point.totalEquity ?? NaN) &&
    Number.isFinite(totalLiabilitiesFor(point) ?? NaN) &&
    (point.totalEquity as number) !== 0;
}

function isRenderableStabilityRatiosPoint(point: FinancialChartPoint): boolean {
  return [debtRatioFor(point), currentLiabilityRatioFor(point), noncurrentLiabilityRatioFor(point)]
    .some((value) => Number.isFinite(value ?? NaN));
}

function debtRatioFor(point: FinancialChartPoint): number | null {
  return firstFinite(point.debtRatio, safeDivide(totalLiabilitiesFor(point), point.totalEquity)) ?? null;
}

function currentLiabilityRatioFor(point: FinancialChartPoint): number | null {
  return firstFinite(point.currentLiabilityRatio, safeDivide(point.currentLiabilities, point.totalEquity)) ?? null;
}

function noncurrentLiabilityRatioFor(point: FinancialChartPoint): number | null {
  const totalLiabilities = totalLiabilitiesFor(point);
  const noncurrentLiabilities = Number.isFinite(totalLiabilities ?? NaN) && Number.isFinite(point.currentLiabilities ?? NaN)
    ? (totalLiabilities as number) - (point.currentLiabilities as number)
    : null;
  return firstFinite(point.noncurrentLiabilityRatio, safeDivide(noncurrentLiabilities, point.totalEquity)) ?? null;
}

export function totalLiabilitiesFor(point: FinancialChartPoint): number | null {
  if (Number.isFinite(point.totalLiabilities ?? NaN)) return point.totalLiabilities as number;
  if (!Number.isFinite(point.totalAssets ?? NaN) || !Number.isFinite(point.totalEquity ?? NaN)) return null;
  const derived = (point.totalAssets as number) - (point.totalEquity as number);
  return derived >= 0 ? derived : null;
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

export function aggregateQuarterlySeriesToAnnual(series: FinancialChartPoint[]): FinancialChartPoint[] {
  const grouped = new Map<number, FinancialChartPoint[]>();
  series.forEach((sourcePoint) => {
    const point = normalizeFinancialPoint(sourcePoint);
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
      const pointInTime = {
        ...latest,
        totalAssets: latestFiniteFinancialValue(sorted, "totalAssets"),
        totalLiabilities: latestFiniteFinancialValue(sorted, "totalLiabilities"),
        totalEquity: latestFiniteFinancialValue(sorted, "totalEquity"),
        currentAssets: latestFiniteFinancialValue(sorted, "currentAssets"),
        currentLiabilities: latestFiniteFinancialValue(sorted, "currentLiabilities"),
        cashAndCashEquivalents: latestFiniteFinancialValue(sorted, "cashAndCashEquivalents"),
        sharesOutstanding: latestFiniteFinancialValue(sorted, "sharesOutstanding"),
        debtRatio: latestFiniteFinancialValue(sorted, "debtRatio"),
        currentLiabilityRatio: latestFiniteFinancialValue(sorted, "currentLiabilityRatio"),
        noncurrentLiabilityRatio: latestFiniteFinancialValue(sorted, "noncurrentLiabilityRatio"),
        currentRatio: latestFiniteFinancialValue(sorted, "currentRatio"),
        totalDebt: latestFiniteFinancialValue(sorted, "totalDebt"),
        netDebt: latestFiniteFinancialValue(sorted, "netDebt")
      } satisfies FinancialChartPoint;
      return [{
        period: `${year}FY`,
        periodEndDate: latest.periodEndDate,
        revenue,
        operatingIncome,
        netIncome: sumFinancialValues(sorted, "netIncome"),
        eps: sumFinancialValues(sorted, "eps"),
        totalAssets: pointInTime.totalAssets,
        totalLiabilities: pointInTime.totalLiabilities,
        totalEquity: pointInTime.totalEquity,
        currentAssets: pointInTime.currentAssets,
        currentLiabilities: pointInTime.currentLiabilities,
        cashAndCashEquivalents: pointInTime.cashAndCashEquivalents,
        interestExpense,
        operatingCashFlow: sumFinancialValues(sorted, "operatingCashFlow"),
        freeCashFlow: sumFinancialValues(sorted, "freeCashFlow"),
        sharesOutstanding: pointInTime.sharesOutstanding,
        debtRatio: debtRatioFor(pointInTime),
        currentLiabilityRatio: currentLiabilityRatioFor(pointInTime),
        noncurrentLiabilityRatio: noncurrentLiabilityRatioFor(pointInTime),
        currentRatio: currentRatioFor(pointInTime),
        totalDebt: pointInTime.totalDebt,
        interestCoverage: safeDivide(operatingIncome, absoluteInterestExpense),
        financialCostBurdenRatio: safeDivide(absoluteInterestExpense, revenue),
        netDebt: netDebtFor(pointInTime)
      } satisfies FinancialChartPoint];
    });
  return annual.length ? annual : series;
}

function aggregateEarningsSeriesToAnnual(series: EarningsChartPoint[]): EarningsChartPoint[] {
  const grouped = new Map<number, EarningsChartPoint[]>();
  series.forEach((point) => {
    const year = financialPointYear({ period: point.period, periodEndDate: point.periodEndDate });
    if (year == null) return;
    const points = grouped.get(year) ?? [];
    points.push(point);
    grouped.set(year, points);
  });
  const annual = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([year, points]) => {
      if (points.length < 4) return [];
      const sorted = [...points].sort(compareEarningsPoints);
      const latest = sorted.at(-1)!;
      return [{
        period: `${year}FY`,
        periodEndDate: latest.periodEndDate,
        actualEps: sumNullableNumbers(sorted.map((point) => point.actualEps)),
        estimatedEps: sumNullableNumbers(sorted.map((point) => point.estimatedEps)),
        actualRevenue: sumNullableNumbers(sorted.map((point) => point.actualRevenue)),
        estimatedRevenue: sumNullableNumbers(sorted.map((point) => point.estimatedRevenue))
      }];
    });
  return annual.length ? annual : series;
}

function sumNullableNumbers(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => Number.isFinite(value ?? NaN));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
}

function sumFinancialValues(points: FinancialChartPoint[], key: keyof FinancialChartPoint): number | null {
  const values = points.map((point) => point[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function latestFiniteFinancialValue(
  points: FinancialChartPoint[],
  key: keyof FinancialChartPoint
): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function companyJournalAnnualHistory<T extends { period: string; periodEndDate?: string | null }>(points: T[]): T[] {
  const fromStartYear = points.filter((point) => {
    const year = financialPointYear(point);
    return year != null && year >= COMPANY_JOURNAL_HISTORY_START_YEAR;
  });
  return fromStartYear.length > 0
    ? fromStartYear
    : points.slice(-companyJournalHistoryYears());
}

function financialPointYear(point: { period: string; periodEndDate?: string | null }): number | null {
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
  comparisonPeriod: string | null | undefined,
  onPeriodSelect: (period: string) => void,
  journalMark?: string,
  focusedMetric?: string | null
): ReactNode[] {
  const periodKey = financialPointKey(point);
  const focusedPeriod = periodKey === selectedPeriod || periodKey === comparisonPeriod;
  return metrics.flatMap((metric) => Number.isFinite(metric.value ?? NaN) ? [
    <circle
      key={`${periodKey}-${metric.key}`}
      className={`${metric.className} ${periodKey === selectedPeriod ? "is-selected" : ""} ${periodKey === comparisonPeriod ? "is-comparison" : ""} ${focusedPeriod && metric.key === focusedMetric ? "is-focused" : ""}`}
      data-journal-mark={journalMark}
      data-journal-financial-metric={metric.key === focusedMetric ? metric.key : undefined}
      data-journal-financial-year={metric.key === focusedMetric ? financialPointYear(point) ?? undefined : undefined}
      cx={xFor(index)}
      cy={yFor(metric.value as number)}
      r={focusedPeriod ? 5 : 3.5}
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
  const normalized = {
    period: point.period,
    periodEndDate: point.periodEndDate,
    revenue: point.revenue,
    operatingIncome: point.operatingIncome,
    netIncome: point.netIncome,
    eps: point.eps,
    totalAssets: point.totalAssets,
    totalLiabilities: totalLiabilitiesFor(point),
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
  } satisfies FinancialChartPoint;
  return {
    ...normalized,
    debtRatio: debtRatioFor(normalized),
    currentLiabilityRatio: currentLiabilityRatioFor(normalized),
    noncurrentLiabilityRatio: noncurrentLiabilityRatioFor(normalized),
    currentRatio: currentRatioFor(normalized)
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

function formatUsdCompact(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${formatKoreanCompact(value as number)} 달러`;
}

function formatUsdCompactTable(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `US$${formatKoreanCompact(value as number)}`;
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
