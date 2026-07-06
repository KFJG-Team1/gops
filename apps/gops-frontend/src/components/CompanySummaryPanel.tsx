import { useEffect, useMemo, useState } from "react";
import { fetchCompanyEarningsSeries, fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyEarningsSeriesPoint, CompanyFinancialSeriesPoint, Sp500UniverseItem } from "../market/sp500Universe.seed";

type CompanySummaryPanelProps = {
  symbol: string;
  item?: Sp500UniverseItem;
  items?: Sp500UniverseItem[];
};

type EarningsMetric = "eps" | "revenue";

type ValuationMetric = {
  label: string;
  detail: string;
  valueLabel: string;
  score: number | null;
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

export function CompanySummaryPanel({ symbol, item, items = [] }: CompanySummaryPanelProps) {
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
    () => buildFinancialSeries(financialSeries ?? item?.financialSeries, item),
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
  return (
    <section className="company-summary-panel" aria-label={`${normalizedSymbol} 기업정보`}>
      <section className="company-info-section" aria-label={`${normalizedSymbol} 기본 기업정보`}>
        <header className="company-info-heading">
          <span>기업정보</span>
          <strong>{companyName}</strong>
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

      <section className="company-fundamental-section" aria-label={`${normalizedSymbol} 투자지표와 비교`}>
        <h2>투자지표</h2>
        <div className="company-fundamental-grid">
          <section className="company-chart-column company-valuation-column" aria-label={`${normalizedSymbol} 가치평가`}>
            <ValuationGaugePanel metrics={valuationMetrics} />
            <EarningsPanel
              metric={earningsMetric}
              onMetricChange={setEarningsMetric}
              series={earningsSeries}
              comparison={comparison}
            />
          </section>
          <section className="company-chart-column" aria-label={`${normalizedSymbol} 수익성 재무`}>
            <ProfitabilityFinanceChart series={profitabilitySeries} />
          </section>
          <section className="company-chart-column" aria-label={`${normalizedSymbol} 안정성`}>
            <StabilityFinanceChart series={profitabilitySeries} />
          </section>
        </div>
      </section>

      <p className="company-summary-note">
        {hasFundamentalShares(item)
          ? "시가총액은 현재가와 발행주식수로 계산합니다."
          : "재무 데이터가 없으면 기준 유니버스 값을 임시로 표시합니다."}
      </p>
    </section>
  );
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
  const chartHeight = 270;
  const plot = { left: 42, right: 22, top: 28, bottom: 46 };
  const xStep = points.length > 1 ? (chartWidth - plot.left - plot.right) / (points.length - 1) : 0;
  const yFor = (value: number) => {
    const span = paddedMax - minValue || 1;
    return plot.top + (1 - (value - minValue) / span) * (chartHeight - plot.top - plot.bottom);
  };
  const yTicks = makeTicks(minValue, paddedMax, 5);
  const sourceLabel = metric === "eps" ? "US$" : "US$억";

  return (
    <div className="company-earnings-history-card">
      <div className="company-earnings-legend" aria-label="실적 범례">
        <span><i className="estimate" />추정</span>
        <span><i className="beat" />예상치 상회</span>
        <span><i className="miss" />예상치 하회</span>
        <span><i className="match" />매치</span>
      </div>
      <svg className="company-earnings-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${metric === "eps" ? "EPS" : "수익"} 실적 내역`}>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={plot.left} x2={chartWidth - plot.right} y1={y} y2={y} />
              <text x={0} y={y + 5}>{formatAxisValue(tick, sourceLabel)}</text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = points.length > 1 ? plot.left + xStep * index : chartWidth - plot.right - 22;
          const actual = Number.isFinite(point.actual ?? NaN) ? point.actual as number : null;
          const estimate = Number.isFinite(point.estimate ?? NaN) ? point.estimate as number : null;
          const tone = earningsTone(actual, estimate);
          return (
            <g key={`${point.period}-${index}`}>
              {estimate != null && (
                <circle className="company-earnings-dot estimate" cx={x} cy={yFor(estimate)} r={9} />
              )}
              {actual != null && (
                <circle className={`company-earnings-dot actual ${tone}`} cx={x} cy={yFor(actual)} r={8} />
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
    .filter((point) => Number.isFinite(point.revenue ?? NaN) || Number.isFinite(point.netIncome ?? NaN))
    .slice(-12);
  const tablePoints = points.slice(-9);
  if (!points.length) {
    return (
      <div className="company-profitability-card">
        <div className="company-profitability-copy">
          <strong>수익성</strong>
          <span>재무 시계열 확인 중</span>
        </div>
        <div className="company-profitability-empty-card">재무 시계열 확인 중</div>
        <div className="company-profitability-legend" aria-label="수익성 범례">
          <span><i className="revenue" />매출</span>
          <span><i className="net-income" />순이익</span>
          <span><i className="margin" />순이익률</span>
        </div>
        <FinancialSeriesTable points={[]} rows={[]} emptyLabel="수익성 재무 데이터 확인 중" />
      </div>
    );
  }
  const moneyValues = points.flatMap((point) => [point.revenue, point.netIncome]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const marginValues = points.map((point) => safeDivide(point.netIncome, point.revenue)).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyMin = moneyValues.length ? Math.min(0, ...moneyValues) : 0;
  const moneyMax = moneyValues.length ? Math.max(...moneyValues) : 1;
  const moneySpan = moneyMax === moneyMin ? 1 : moneyMax - moneyMin;
  const marginMin = marginValues.length ? Math.min(0, ...marginValues) : 0;
  const marginMax = marginValues.length ? Math.max(...marginValues) : 0.3;
  const marginSpan = marginMax === marginMin ? 1 : marginMax - marginMin;
  const chartWidth = 620;
  const chartHeight = 250;
  const plot = { left: 44, right: 40, top: 20, bottom: 46 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = points.length ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(6, Math.min(18, slot * 0.28));
  const zeroY = plot.top + (1 - (0 - moneyMin) / moneySpan) * innerHeight;
  const moneyY = (value: number) => plot.top + (1 - (value - moneyMin) / moneySpan) * innerHeight;
  const marginY = (value: number) => plot.top + (1 - (value - marginMin) / marginSpan) * innerHeight;
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
    <div className="company-profitability-card">
      <div className="company-profitability-copy">
        <strong>수익성</strong>
        <span>{headline}</span>
      </div>
      <svg className="company-profitability-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="SEC 재무 수익성 시계열">
        {makeTicks(moneyMin, moneyMax, 5).map((tick) => {
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
      <div className="company-profitability-legend" aria-label="수익성 범례">
        <span><i className="revenue" />매출</span>
        <span><i className="net-income" />순이익</span>
        <span><i className="margin" />순이익률</span>
      </div>
      <FinancialSeriesTable points={tablePoints} rows={buildProfitabilityTableRows(tablePoints)} />
    </div>
  );
}

function StabilityFinanceChart({ series }: { series: FinancialChartPoint[] }) {
  const points = series
    .filter((point) => Number.isFinite(point.totalEquity ?? NaN) || Number.isFinite(point.totalLiabilities ?? NaN))
    .slice(-12);
  const tablePoints = points.slice(-9);
  if (!points.length) {
    return (
      <div className="company-stability-card">
        <div className="company-stability-copy">
          <strong>안정성</strong>
          <span>부채 · 유동 · 이자보상비율</span>
        </div>
        <div className="company-profitability-empty-card">안정성 시계열 확인 중</div>
        <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
          <span><i className="equity" />총자본</span>
          <span><i className="liabilities" />총부채</span>
          <span><i className="debt-ratio" />부채비율</span>
        </div>
        <FinancialSeriesTable points={[]} rows={[]} emptyLabel="안정성 재무 데이터 확인 중" />
      </div>
    );
  }
  const moneyValues = points.flatMap((point) => [point.totalEquity, point.totalLiabilities]).filter((value): value is number => Number.isFinite(value ?? NaN));
  const ratioValues = points.map((point) => safeDivide(point.totalLiabilities, point.totalEquity)).filter((value): value is number => Number.isFinite(value ?? NaN));
  const moneyMin = 0;
  const moneyMax = moneyValues.length ? Math.max(...moneyValues) : 1;
  const moneySpan = moneyMax - moneyMin || 1;
  const ratioMin = ratioValues.length ? Math.min(0, ...ratioValues) : 0;
  const ratioMax = ratioValues.length ? Math.max(...ratioValues) : 1;
  const ratioSpan = ratioMax === ratioMin ? 1 : ratioMax - ratioMin;
  const chartWidth = 620;
  const chartHeight = 250;
  const plot = { left: 44, right: 40, top: 20, bottom: 46 };
  const innerWidth = chartWidth - plot.left - plot.right;
  const innerHeight = chartHeight - plot.top - plot.bottom;
  const slot = points.length ? innerWidth / points.length : innerWidth;
  const barWidth = Math.max(6, Math.min(18, slot * 0.28));
  const zeroY = plot.top + innerHeight;
  const moneyY = (value: number) => plot.top + (1 - (value - moneyMin) / moneySpan) * innerHeight;
  const ratioY = (value: number) => plot.top + (1 - (value - ratioMin) / ratioSpan) * innerHeight;
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
    <div className="company-stability-card">
      <div className="company-stability-copy">
        <strong>안정성</strong>
        <span>부채 · 유동 · 이자보상비율</span>
      </div>
      <svg className="company-profitability-plot company-stability-plot" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="SEC 재무 안정성 시계열">
        {makeTicks(moneyMin, moneyMax, 5).map((tick) => {
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
      <div className="company-profitability-legend company-stability-legend" aria-label="안정성 범례">
        <span><i className="equity" />총자본</span>
        <span><i className="liabilities" />총부채</span>
        <span><i className="debt-ratio" />부채비율</span>
      </div>
      <FinancialSeriesTable points={tablePoints} rows={buildStabilityTableRows(tablePoints)} />
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
      <h3>가치평가</h3>
      <div className="company-valuation-gauge-grid">
        {metrics.map((metric) => (
          <ValuationGauge key={metric.label} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function ValuationGauge({ metric }: { metric: ValuationMetric }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const score = Number.isFinite(metric.score ?? NaN) ? Math.max(0.08, Math.min(1, metric.score as number)) : 0;
  const dashOffset = circumference * (1 - score);
  return (
    <article className="company-valuation-gauge" aria-label={`${metric.label} ${metric.valueLabel}`}>
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <circle className="company-gauge-track" cx="48" cy="48" r={radius} />
        <circle
          className="company-gauge-value"
          cx="48"
          cy="48"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="company-gauge-center">
        <strong>{metric.valueLabel}</strong>
        <span>{metric.label}</span>
      </div>
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
      <div className="company-financial-table-scroll" aria-hidden="true" />
    </div>
  );
}

function buildValuationMetrics(price: number | null | undefined, marketCap: number | null | undefined, item: Sp500UniverseItem | undefined): ValuationMetric[] {
  const per = safeDivide(price, item?.eps);
  const pbr = safeDivide(marketCap, item?.totalEquity);
  const psr = safeDivide(marketCap, item?.revenue);
  const fcfYield = safeDivide(item?.freeCashFlow, marketCap);
  return [
    { label: "PER", detail: "현재가 / EPS", valueLabel: formatMultiple(per), score: scoreMultiple(per, 50) },
    { label: "PBR", detail: "시가총액 / 총자본", valueLabel: formatMultiple(pbr), score: scoreMultiple(pbr, 20) },
    { label: "PSR", detail: "시가총액 / 매출", valueLabel: formatMultiple(psr), score: scoreMultiple(psr, 30) },
    { label: "FCF Yield", detail: "잉여현금흐름 / 시가총액", valueLabel: formatRatioPercent(fcfYield), score: scoreYield(fcfYield) }
  ];
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
  const fromSeries = (apiSeries?.length ? apiSeries : item?.earningsSeries)?.map((point) => normalizeEarningsPoint(point)) ?? [];
  const validSeries = fromSeries.filter((point) => (
    Number.isFinite(point.actualEps ?? NaN) ||
    Number.isFinite(point.estimatedEps ?? NaN) ||
    Number.isFinite(point.actualRevenue ?? NaN) ||
    Number.isFinite(point.estimatedRevenue ?? NaN)
  ));
  if (validSeries.length) {
    return validSeries;
  }
  const actualSeries = financialSeries
    .map((point) => ({
      period: point.period,
      periodEndDate: point.periodEndDate,
      actualEps: point.eps,
      estimatedEps: null,
      actualRevenue: point.revenue,
      estimatedRevenue: null
    }))
    .filter((point) => Number.isFinite(point.actualEps ?? NaN) || Number.isFinite(point.actualRevenue ?? NaN));
  if (actualSeries.length) {
    return actualSeries;
  }
  const period = item?.fiscalPeriod || item?.periodEndDate || item?.fundamentalsAsOf;
  if (!period) {
    return [];
  }
  const fallbackPoint = {
    period,
    periodEndDate: item?.periodEndDate,
    actualEps: item?.eps,
    estimatedEps: null,
    actualRevenue: item?.revenue,
    estimatedRevenue: null
  };
  return Number.isFinite(fallbackPoint.actualEps ?? NaN) || Number.isFinite(fallbackPoint.actualRevenue ?? NaN)
    ? [fallbackPoint]
    : [];
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

function normalizeRevenueForChart(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  return (value as number) / 100_000_000;
}

function scoreMultiple(value: number | null | undefined, highWatermark: number): number | null {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  return Math.max(0.08, Math.min(1, Math.abs(value as number) / highWatermark));
}

function scoreYield(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  return Math.max(0.08, Math.min(1, Math.abs(value as number) / 0.12));
}

function makeTicks(minValue: number, maxValue: number, count: number): number[] {
  const safeCount = Math.max(2, count);
  const span = maxValue - minValue || 1;
  return Array.from({ length: safeCount }, (_, index) => minValue + (span / (safeCount - 1)) * index);
}

function formatAxisValue(value: number, prefix: string): string {
  return `${prefix}${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: value > 0 && value < 10 ? 2 : 0,
    maximumFractionDigits: value > 0 && value < 10 ? 2 : 0
  }).format(value)}`;
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
