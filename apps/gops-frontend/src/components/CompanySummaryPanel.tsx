import { Building2, ChevronLeft, ChevronRight, CircleDollarSign, ShieldCheck, TrendingUp } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { fetchCompanyEarningsSeries, fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyEarningsSeriesPoint, CompanyFinancialSeriesPoint, Sp500UniverseItem } from "../market/sp500Universe.seed";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

type CompanySummaryPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
  view?: CompanyPanelView | "all";
};

export type CompanyPanelView = "info" | "valuation" | "profitability" | "stability";

const companyMultiViews = [
  { id: "info", label: "기업", title: "기업정보", icon: Building2 },
  { id: "valuation", label: "가치", title: "가치평가", icon: CircleDollarSign },
  { id: "profitability", label: "수익", title: "수익성", icon: TrendingUp },
  { id: "stability", label: "안정", title: "안정성", icon: ShieldCheck }
] as const;

type EarningsMetric = "eps" | "revenue";

type ValuationMetric = {
  label: string;
  detail: string;
  valueLabel: string;
  statusLabel: string;
  tone: "good" | "watch" | "risk" | "neutral";
};

type FinancialTableRow = {
  label: string;
  values: string[];
  marker: "revenue" | "net-income" | "margin" | "growth" | "equity" | "liabilities" | "debt-ratio";
};

type EarningsChartPoint = {
  period: string;
  periodEndDate?: string | null;
  actualEps?: number | null;
  estimatedEps?: number | null;
  actualRevenue?: number | null;
  estimatedRevenue?: number | null;
};

type FinancialChartPoint = {
  period: string;
  periodEndDate?: string | null;
  revenue?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  totalEquity?: number | null;
  operatingCashFlow?: number | null;
  freeCashFlow?: number | null;
  sharesOutstanding?: number | null;
};

export function CompanySummaryPanel({ symbol, item, items = [], view = "all" }: CompanySummaryPanelProps) {
  const [earningsMetric, setEarningsMetric] = useState<EarningsMetric>("eps");
  const [financialSeries, setFinancialSeries] = useState<CompanyFinancialSeriesPoint[] | null>(null);
  const [earningsSeriesFromApi, setEarningsSeriesFromApi] = useState<CompanyEarningsSeriesPoint[] | null>(null);
  const normalizedSymbol = symbol.toUpperCase();
  const companyName = item?.companyName || normalizedSymbol;
  const price = item?.lastPrice ?? item?.layoutPrice ?? null;
  const marketCap = item?.marketCap ?? item?.layoutMarketCap ?? null;
  const changePercent = item?.changePercent ?? null;
  const changeTone = changePercent == null ? "neutral" : changePercent > 0 ? "up" : changePercent < 0 ? "down" : "neutral";
  const dataAsOf = item?.fundamentalsAsOf ?? item?.periodEndDate ?? item?.filedAt ?? item?.priceUpdatedAt ?? item?.layoutPriceUpdatedAt ?? null;
  const comparison = buildComparison(normalizedSymbol, item, items);
  const profitabilitySeries = useMemo(
    () => buildFinancialSeries(financialSeries?.length ? financialSeries : item?.financialSeries, item),
    [financialSeries, item]
  );
  const earningsSeries = useMemo(
    () => buildEarningsSeries(item, profitabilitySeries, earningsSeriesFromApi),
    [earningsSeriesFromApi, item, profitabilitySeries]
  );
  const valuationMetrics = useMemo(
    () => buildValuationMetrics(price, marketCap, item),
    [price, marketCap, item]
  );

  useEffect(() => {
    const controller = new AbortController();
    setFinancialSeries(null);
    setEarningsSeriesFromApi(null);
    fetchCompanyFinancialSeries(normalizedSymbol, controller.signal, { years: 3, period: "quarterly" })
      .then((series) => setFinancialSeries(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFinancialSeries([]);
        }
      });
    fetchCompanyEarningsSeries(normalizedSymbol, controller.signal, { years: 3 })
      .then((series) => setEarningsSeriesFromApi(series))
      .catch(() => {
        if (!controller.signal.aborted) {
          setEarningsSeriesFromApi([]);
        }
      });
    return () => controller.abort();
  }, [normalizedSymbol]);

  const infoRows = [
    ["현재가", formatUsd(price)],
    ["등락률", formatPercent(changePercent), changeTone],
    ["시가총액", formatUsdCompact(marketCap)],
    ["발행주식수", formatShares(item?.sharesOutstanding ?? null)],
    ["거래소", formatExchange(item?.exchange)],
    ["상장일", formatDate(item?.listingDate)],
    ["섹터", item?.sector || "확인 중"],
    ["산업", item?.industry || "확인 중"],
    ["CIK", item?.cik || "확인 중"],
    ["시장", formatMarket(item?.market, item?.country)],
    ["기업정보 원천", formatCompanySource(item)],
    ["데이터 기준", formatDate(dataAsOf)]
  ] as const;

  const infoSection = (
    <section className="company-info-section" aria-label={`${normalizedSymbol} 기본 기업정보`}>
      <header className="company-info-heading">
        <strong>
          <StockLogo symbol={normalizedSymbol} companyName={companyName} size="md" />
          <span>{companyName}</span>
        </strong>
        <em className={`company-summary-change ${changeTone}`}>{formatPercent(changePercent)}</em>
      </header>
      <dl className="company-info-grid">
        {infoRows.map(([label, value, tone]) => (
          <div key={label} className="company-info-cell">
            <dt>{label}</dt>
            <dd className={tone ? `company-summary-value ${tone}` : "company-summary-value"}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  const valuationSection = (
    <section className="company-chart-column company-valuation-column" aria-label={`${normalizedSymbol} 가치평가`}>
      <ValuationGaugePanel metrics={valuationMetrics} />
      <EarningsPanel
        metric={earningsMetric}
        onMetricChange={setEarningsMetric}
        series={earningsSeries}
        comparison={comparison}
      />
    </section>
  );
  const profitabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 수익성 재무`}>
      <ProfitabilityFinanceChart series={profitabilitySeries} />
    </section>
  );
  const stabilitySection = (
    <section className="company-chart-column" aria-label={`${normalizedSymbol} 안정성`}>
      <StabilityFinanceChart series={profitabilitySeries} />
    </section>
  );

  if (view !== "all") {
    const activeSection = view === "info"
      ? infoSection
      : view === "valuation"
        ? valuationSection
        : view === "profitability"
          ? profitabilitySection
          : stabilitySection;
    return (
      <section className={`company-summary-panel company-single-panel is-${view}`} aria-label={`${normalizedSymbol} ${companyPanelViewLabel(view)}`}>
        {view === "info" ? activeSection : (
          <section className="company-fundamental-section company-single-fundamental-section">
            {activeSection}
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
  return <CompanySummaryPanel {...props} view="info" />;
}

export function CompanyValuationPanel(props: CompanySummaryPanelProps) {
  return <CompanySummaryPanel {...props} view="valuation" />;
}

export function CompanyProfitabilityPanel(props: CompanySummaryPanelProps) {
  return <CompanySummaryPanel {...props} view="profitability" />;
}

export function CompanyStabilityPanel(props: CompanySummaryPanelProps) {
  return <CompanySummaryPanel {...props} view="stability" />;
}

export function CompanyMultiPanel(props: CompanySummaryPanelProps) {
  const [activeView, setActiveView] = useState<CompanyPanelView>("info");
  const [direction, setDirection] = useState<"next" | "previous">("next");
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

  return (
    <section className="company-multi-panel" aria-label={`${props.symbol.toUpperCase()} 기업 멀티패널`}>
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
            >
              <Icon aria-hidden="true" />
              <span>{candidate.label}</span>
            </button>
          );
        })}
      </div>
      <div className="company-multi-stage">
        <div key={activeView} className={`company-multi-view is-${direction}`} role="tabpanel">
          <CompanySummaryPanel {...props} view={activeView} />
        </div>
        <button type="button" className="company-multi-arrow previous" aria-label="이전 기업 분석" disabled={activeIndex === 0} onClick={() => selectView(activeIndex - 1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="company-multi-arrow next" aria-label="다음 기업 분석" disabled={activeIndex === companyMultiViews.length - 1} onClick={() => selectView(activeIndex + 1)}>
          <ChevronRight aria-hidden="true" />
        </button>
        <div className="company-multi-dots" aria-hidden="true">
          {companyMultiViews.map((candidate) => <i key={candidate.id} className={candidate.id === activeView ? "active" : ""} />)}
        </div>
      </div>
    </section>
  );
}

function companyPanelViewLabel(view: CompanyPanelView): string {
  return companyMultiViews.find((candidate) => candidate.id === view)?.title ?? "기업정보";
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

function ProfitabilityFinanceChart({ series }: { series: FinancialChartPoint[] }) {
  const points = series
    .filter(isRenderableProfitabilityPoint)
    .slice(-12);
  const tablePoints = points.slice(-6);
  if (!points.length) {
    return (
      <FinancialChartShell
        className="company-profitability-card"
        title="수익성"
        subtitle="재무 시계열 확인 중"
        legend={(
          <div className="company-profitability-legend" aria-label="수익성 범례">
            <span><i className="revenue" />매출</span>
            <span><i className="net-income" />순이익</span>
            <span><i className="margin" />순이익률</span>
          </div>
        )}
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="수익성 재무 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">재무 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const moneyValues = points.flatMap((point) => [point.revenue, point.netIncome]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const marginValues = points.map((point) => safeDivide(point.netIncome, point.revenue)).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1 });
  const marginDomain = paddedDomain(marginValues, { includeZero: true, fallbackMax: 0.3 });
  const chartWidth = 620;
  const chartHeight = 250;
  const plot = { left: 64, right: 28, top: 20, bottom: 46 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = points.length ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(6, Math.min(18, slot * 0.28));
  const zeroY = valueToY(0, moneyDomain, plot.top, innerHeight);
  const moneyY = (value: number) => valueToY(value, moneyDomain, plot.top, innerHeight);
  const marginY = (value: number) => valueToY(value, marginDomain, plot.top, innerHeight);
  const xFor = (index: number) => plot.left + slot * index + slot / 2;
  const marginPath = points
    .map((point, index) => {
      const margin = safeDivide(point.netIncome, point.revenue);
      if (!Number.isFinite(margin ?? NaN)) {
        return "";
      }
      return `${index === 0 ? "M" : "L"} ${xFor(index)} ${marginY(margin as number)}`;
    })
    .filter(Boolean)
    .join(" ");
  const headline = buildProfitabilityHeadline(points);

  return (
    <FinancialChartShell
      className="company-profitability-card"
      title="수익성"
      subtitle={headline}
      legend={(
        <div className="company-profitability-legend" aria-label="수익성 범례">
          <span><i className="revenue" />매출</span>
          <span><i className="net-income" />순이익</span>
          <span><i className="margin" />순이익률</span>
        </div>
      )}
      table={<FinancialSeriesTable points={tablePoints} rows={buildProfitabilityTableRows(tablePoints)} />}
    >
      <svg className="company-profitability-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="SEC 재무 수익성 시계열">
        {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
          const y = moneyY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text x={0} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text>
            </g>
          );
        })}
        <line className="company-profitability-zero" x1={plot.left} x2={chartWidth - plot.right} y1={zeroY} y2={zeroY} />
        {points.map((point, index) => {
          const x = xFor(index);
          const revenue = Number.isFinite(point.revenue ?? NaN) ? point.revenue as number : null;
          const netIncome = Number.isFinite(point.netIncome ?? NaN) ? point.netIncome as number : null;
          return (
            <g key={`${point.period}-${index}`}>
              {revenue != null && (
                <rect
                  className="company-profitability-bar revenue"
                  x={x - barWidth - 2}
                  y={Math.min(moneyY(revenue), zeroY)}
                  width={barWidth}
                  height={Math.max(2, Math.abs(zeroY - moneyY(revenue)))}
                  rx={5}
                />
              )}
              {netIncome != null && (
                <rect
                  className="company-profitability-bar net-income"
                  x={x + 2}
                  y={Math.min(moneyY(netIncome), zeroY)}
                  width={barWidth}
                  height={Math.max(2, Math.abs(zeroY - moneyY(netIncome)))}
                  rx={5}
                />
              )}
              {shouldShowPeriodLabel(index, points.length) && (
                <text className="company-profitability-period" x={x} y={chartHeight - 12}>{formatPeriod(point.period, point.periodEndDate)}</text>
              )}
            </g>
          );
        })}
        {marginPath && <path className="company-profitability-margin-line" d={marginPath} />}
        {points.map((point, index) => {
          const margin = safeDivide(point.netIncome, point.revenue);
          return Number.isFinite(margin ?? NaN)
            ? <circle key={`${point.period}-${index}-margin`} className="company-profitability-margin-dot" cx={xFor(index)} cy={marginY(margin as number)} r={3.5} />
            : null;
        })}
      </svg>
    </FinancialChartShell>
  );
}

function StabilityFinanceChart({ series }: { series: FinancialChartPoint[] }) {
  const points = series
    .filter(isRenderableStabilityPoint)
    .slice(-12);
  const tablePoints = points.slice(-6);
  if (!points.length) {
    return (
      <FinancialChartShell
        className="company-stability-card"
        title="안정성"
        subtitle="부채 · 유동 · 이자보상비율"
        legend={(
          <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
            <span><i className="equity" />총자본</span>
            <span><i className="liabilities" />총부채</span>
            <span><i className="debt-ratio" />부채비율</span>
          </div>
        )}
        table={<FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 재무 데이터 확인 중" />}
      >
        <div className="company-profitability-empty-card">안정성 시계열 확인 중</div>
      </FinancialChartShell>
    );
  }
  const moneyValues = points.flatMap((point) => [point.totalEquity, point.totalLiabilities]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = points.map((point) => safeDivide(point.totalLiabilities, point.totalEquity)).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyDomain = paddedDomain(moneyValues, { includeZero: true, fallbackMax: 1, minFloor: 0 });
  const ratioDomain = paddedDomain(ratioValues, { includeZero: true, fallbackMax: 1 });
  const chartWidth = 620;
  const chartHeight = 250;
  const plot = { left: 64, right: 28, top: 20, bottom: 46 };
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
      const ratio = safeDivide(point.totalLiabilities, point.totalEquity);
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
      title="안정성"
      subtitle="부채 · 유동 · 이자보상비율"
      legend={(
        <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
          <span><i className="equity" />총자본</span>
          <span><i className="liabilities" />총부채</span>
          <span><i className="debt-ratio" />부채비율</span>
        </div>
      )}
      table={<FinancialSeriesTable points={tablePoints} rows={buildStabilityTableRows(tablePoints)} />}
    >
      <svg className="company-profitability-plot company-stability-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="SEC 재무 안정성 시계열">
        {makeTicks(moneyDomain.min, moneyDomain.max, 5).map((tick) => {
          const y = moneyY(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text x={0} y={y + 5}>{formatKoreanMoneyAxis(tick)}</text>
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
          const ratio = safeDivide(point.totalLiabilities, point.totalEquity);
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
  subtitle: string;
  children: ReactNode;
  legend: ReactNode;
  table: ReactNode;
}) {
  return (
    <div className={`company-financial-chart-card ${className}`}>
      <div className="company-financial-chart-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {children}
      {legend}
      {table}
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
        <h3>실적 내역</h3>
        <div className="company-earnings-tabs" role="tablist" aria-label="실적 지표">
          <button type="button" className={metric === "eps" ? "active" : ""} onClick={() => onMetricChange("eps")}>EPS</button>
          <button type="button" className={metric === "revenue" ? "active" : ""} onClick={() => onMetricChange("revenue")}>수익</button>
        </div>
      </div>
      <EarningsHistoryChart metric={metric} series={series} />
      <div className="company-earnings-summary">
        <div>
          <span>동종업계 평균</span>
          <strong>{formatPercent(comparison.averageChangePercent)}</strong>
        </div>
        <div>
          <span>산업 내 순위</span>
          <strong>{comparison.rankLabel}</strong>
        </div>
        <div>
          <span>비교 기준</span>
          <strong>{comparison.scopeLabel}</strong>
        </div>
      </div>
    </section>
  );
}

function ValuationGaugePanel({ metrics }: { metrics: ValuationMetric[] }) {
  return (
    <section className="company-valuation-panel" aria-label="가치평가">
      <div className="company-section-heading">
        <h3>가치평가</h3>
        <span>가격 · 재무 기준 핵심 배수</span>
      </div>
      <div className="company-valuation-gauge-grid">
        {metrics.map((metric) => (
          <ValuationCard key={metric.label} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function ValuationCard({ metric }: { metric: ValuationMetric }) {
  return (
    <article className={`company-valuation-gauge company-valuation-card ${metric.tone}`} aria-label={`${metric.label} ${metric.valueLabel}`}>
      <div className="company-valuation-card-top">
        <span>{metric.label}</span>
        <em>{metric.statusLabel}</em>
      </div>
      <strong>{metric.valueLabel}</strong>
      <p>{metric.detail}</p>
    </article>
  );
}

function FinancialSeriesTable({ points, rows, emptyLabel = "재무 데이터 확인 중" }: { points: FinancialChartPoint[]; rows: FinancialTableRow[]; emptyLabel?: string }) {
  if (!points.length || !rows.length) {
    return <div className="company-financial-table-empty">{emptyLabel}</div>;
  }
  return (
    <div className="company-financial-table-wrap">
      <table className="company-financial-table">
        <thead>
          <tr>
            <th>항목</th>
            {points.map((point, index) => (
              <th key={`${point.period}-${index}`}>{formatTablePeriod(point)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>
                <i className={row.marker} />
                {row.label}
              </th>
              {row.values.map((value, index) => (
                <td key={`${row.label}-${index}`} className={value.startsWith("-") ? "down" : value.startsWith("+") ? "up" : undefined}>{value}</td>
              ))}
            </tr>
          ))}
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
    { label: "PER", detail: "현재가 / EPS", valueLabel: formatMultiple(per), ...valuationStatus(per, { good: 20, watch: 35, higherIsBetter: false }) },
    { label: "PBR", detail: "시가총액 / 총자본", valueLabel: formatMultiple(pbr), ...valuationStatus(pbr, { good: 5, watch: 12, higherIsBetter: false }) },
    { label: "PSR", detail: "시가총액 / 매출", valueLabel: formatMultiple(psr), ...valuationStatus(psr, { good: 8, watch: 18, higherIsBetter: false }) },
    { label: "FCF Yield", detail: "잉여현금흐름 / 시가총액", valueLabel: formatRatioPercent(fcfYield), ...valuationStatus(fcfYield, { good: 0.04, watch: 0, higherIsBetter: true }) }
  ];
}

function valuationStatus(
  value: number | null | undefined,
  rule: { good: number; watch: number; higherIsBetter: boolean }
): Pick<ValuationMetric, "statusLabel" | "tone"> {
  if (!Number.isFinite(value ?? NaN)) {
    return { statusLabel: "확인 중", tone: "neutral" };
  }
  const current = value as number;
  if (rule.higherIsBetter) {
    if (current >= rule.good) {
      return { statusLabel: "양호", tone: "good" };
    }
    if (current >= rule.watch) {
      return { statusLabel: "주의", tone: "watch" };
    }
    return { statusLabel: "위험", tone: "risk" };
  }
  if (current <= rule.good) {
    return { statusLabel: "양호", tone: "good" };
  }
  if (current <= rule.watch) {
    return { statusLabel: "주의", tone: "watch" };
  }
  return { statusLabel: "위험", tone: "risk" };
}

function buildProfitabilityTableRows(points: FinancialChartPoint[]): FinancialTableRow[] {
  return [
    { label: "매출", marker: "revenue", values: points.map((point) => formatUsdCompact(point.revenue)) },
    { label: "순이익", marker: "net-income", values: points.map((point) => formatUsdCompact(point.netIncome)) },
    { label: "순이익률", marker: "margin", values: points.map((point) => formatRatioPercent(safeDivide(point.netIncome, point.revenue))) },
    {
      label: "순이익 성장률",
      marker: "growth",
      values: points.map((point, index) => {
        const previous = points[index - 1];
        const growth = previous ? safeDivide((point.netIncome ?? null) != null && (previous.netIncome ?? null) != null ? (point.netIncome as number) - (previous.netIncome as number) : null, Math.abs(previous.netIncome ?? NaN)) : null;
        return growth == null ? "확인 중" : formatSignedRatio(growth);
      })
    }
  ];
}

function buildStabilityTableRows(points: FinancialChartPoint[]): FinancialTableRow[] {
  return [
    { label: "총자본", marker: "equity", values: points.map((point) => formatUsdCompact(point.totalEquity)) },
    { label: "총부채", marker: "liabilities", values: points.map((point) => formatUsdCompact(point.totalLiabilities)) },
    { label: "부채비율", marker: "debt-ratio", values: points.map((point) => formatRatioPercent(safeDivide(point.totalLiabilities, point.totalEquity))) }
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
    operatingCashFlow: point.operatingCashFlow,
    freeCashFlow: point.freeCashFlow,
    sharesOutstanding: point.sharesOutstanding
  };
}

function buildProfitabilityHeadline(points: FinancialChartPoint[]): string {
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!latest || !Number.isFinite(latest.netIncome ?? NaN)) {
    return "재무 시계열 확인 중";
  }
  const latestIncome = latest.netIncome as number;
  const previousIncome = Number.isFinite(previous?.netIncome ?? NaN) ? previous?.netIncome as number : null;
  const period = formatPeriod(latest.period, latest.periodEndDate);
  if (previousIncome == null || previousIncome === 0) {
    return `${period} 순이익은 ${formatUsdCompact(latestIncome)}입니다.`;
  }
  const change = (latestIncome - previousIncome) / Math.abs(previousIncome);
  return `${period} 순이익은 ${formatUsdCompact(latestIncome)}로 직전 분기 대비 ${formatSignedRatio(change)}입니다.`;
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
  if (point.periodEndDate) {
    const parsed = new Date(point.periodEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getUTCFullYear()).slice(-2)}년 ${parsed.getUTCMonth() + 1}월`;
    }
  }
  return formatPeriod(point.period, point.periodEndDate);
}

function formatUsd(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) {
    return "확인 중";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: value && value >= 100 ? 2 : 2,
    maximumFractionDigits: 2
  }).format(value as number)}달러`;
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

function formatExchange(value: string | null | undefined): string {
  if (!value) {
    return "확인 중";
  }
  const normalized = value.trim().toUpperCase();
  const labels: Record<string, string> = {
    NASDAQ: "나스닥",
    NYSE: "뉴욕증권거래소",
    AMEX: "NYSE 아메리칸",
    ARCA: "NYSE 아카",
    BATS: "Cboe BZX"
  };
  return labels[normalized] ?? value;
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

function formatCompanySource(item: Sp500UniverseItem | undefined): string {
  const source = item?.fundamentalsSource?.toLowerCase() ?? "";
  if (source.includes("sec")) {
    return "SEC 공시";
  }
  if (hasFundamentalShares(item)) {
    return "재무 데이터";
  }
  if (item?.marketCapSource === "seed" || item?.layoutMarketCapSource === "seed") {
    return "기준 유니버스";
  }
  return "확인 중";
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
