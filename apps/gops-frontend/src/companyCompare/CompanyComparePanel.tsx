import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  LoaderCircle,
  Sparkles
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import type { ChartSymbolDto } from "../chart/types";
import { SymbolSearch } from "../components/SymbolSearch";
import { GlossaryText } from "../glossary/GlossaryText";
import { fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyFinancialSeriesPoint } from "../market/sp500Universe.seed";
import {
  requestCompanyCompare,
  requestCompanyCompareCandidates,
  requestCompanyCompareQuantitative,
  type CompanyCompareCandidate,
  type CompanyCompareMetric,
  type CompanyCompareQualitativeItem,
  type CompanyCompareQualitativeSection,
  type CompanyCompareResponse,
  type CompanyCompareSectionId
} from "./companyCompareApi";

type CompanyComparePanelProps = {
  baseSymbol: string;
  compareSymbols: string[];
  symbols: ChartSymbolDto[];
  onCompareSymbolsChange: (symbols: string[]) => void;
};

type AxisMeta = {
  id: CompanyCompareSectionId;
  index: string;
  tab: string;
  eyebrow: string;
  title: string;
};

type QualitativeRow = {
  label: string;
  baseValue: string;
  compareValue: string;
};

type FinancialSeriesBySymbol = Record<string, CompanyFinancialSeriesPoint[]>;

type CompanyTrendPoint = {
  period: string;
  periodEndDate: string;
  revenueGrowth: number | null;
  operatingMargin: number | null;
};

type PairedTrendPoint = {
  id: string;
  label: string;
  basePeriod: string;
  comparePeriod: string;
  baseRevenueGrowth: number | null;
  compareRevenueGrowth: number | null;
  baseOperatingMargin: number | null;
  compareOperatingMargin: number | null;
};

type RelationshipMatrixRow = {
  label: string;
  baseValue: string;
  sharedTitle: string;
  sharedSummary: string;
  compareValue: string;
};

type RecentIssueRow = {
  label: string;
  baseItem?: CompanyCompareQualitativeItem;
  compareItem?: CompanyCompareQualitativeItem;
};

const REQUEST_DEBOUNCE_MS = 400;
const MAX_COMPARE_SYMBOLS = 1;
const AXES: AxisMeta[] = [
  { id: "growth_style", index: "01", tab: "성장성", eyebrow: "GROWTH", title: "성장성" },
  { id: "profit_structure", index: "02", tab: "수익성", eyebrow: "PROFITABILITY", title: "수익성" },
  { id: "financial_health", index: "03", tab: "재무 안정성", eyebrow: "FINANCIAL STABILITY", title: "재무 안정성" },
  { id: "earnings_stability", index: "04", tab: "실적", eyebrow: "EARNINGS STABILITY", title: "실적 안정성" },
  { id: "business_model", index: "05", tab: "주요 사업", eyebrow: "KEY BUSINESSES", title: "주요 사업" },
  { id: "risk_profile", index: "06", tab: "위험 요인", eyebrow: "RISK FACTORS", title: "위험 요인" },
  { id: "relationship", index: "07", tab: "연관성", eyebrow: "RELATIONSHIPS", title: "연관성" },
  { id: "recent_flow", index: "08", tab: "최근 이슈", eyebrow: "RECENT ISSUES", title: "최근 이슈" }
];
const QUANTITATIVE_AXIS_IDS = new Set<CompanyCompareSectionId>([
  "growth_style",
  "profit_structure",
  "financial_health",
  "earnings_stability"
]);
const METRIC_PRIORITY: Partial<Record<CompanyCompareSectionId, string[]>> = {
  growth_style: ["revenue_growth_yoy", "operating_income_growth_yoy", "net_income_growth_yoy"],
  profit_structure: ["net_margin", "operating_margin", "roe"],
  financial_health: ["total_debt_to_assets", "current_ratio", "free_cash_flow"],
  earnings_stability: ["eps_surprise_mean", "eps_surprise_volatility", "eps_beat_rate"]
};

export function CompanyComparePanel({
  baseSymbol,
  compareSymbols,
  symbols,
  onCompareSymbolsChange
}: CompanyComparePanelProps) {
  const normalizedBase = normalizeSymbol(baseSymbol);
  const normalizedCompare = useMemo(
    () => normalizeCompareSymbols(compareSymbols, normalizedBase),
    [compareSymbols, normalizedBase]
  );
  const selectedCompare = normalizedCompare[0] ?? "";
  const [activeAxisId, setActiveAxisId] = useState<CompanyCompareSectionId>("profit_structure");
  const [response, setResponse] = useState<CompanyCompareResponse | null>(null);
  const [candidates, setCandidates] = useState<CompanyCompareCandidate[]>([]);
  const [quantitativeLoading, setQuantitativeLoading] = useState(false);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [financialSeriesBySymbol, setFinancialSeriesBySymbol] = useState<FinancialSeriesBySymbol>({});
  const [financialSeriesLoading, setFinancialSeriesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrativeFailed, setNarrativeFailed] = useState(false);

  useEffect(() => {
    if (!normalizedBase) {
      setCandidates([]);
      return undefined;
    }
    const controller = new AbortController();
    setCandidateLoading(true);
    requestCompanyCompareCandidates(normalizedBase, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setCandidates(payload.candidates);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCandidates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCandidateLoading(false);
      });
    return () => controller.abort();
  }, [normalizedBase]);

  useEffect(() => {
    if (!normalizedBase || !selectedCompare) {
      setFinancialSeriesBySymbol({});
      setFinancialSeriesLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setFinancialSeriesLoading(true);
    setFinancialSeriesBySymbol({});
    Promise.all([
      fetchCompanyFinancialSeries(normalizedBase, controller.signal, { years: 3, period: "quarterly" }),
      fetchCompanyFinancialSeries(selectedCompare, controller.signal, { years: 3, period: "quarterly" })
    ])
      .then(([baseSeries, compareSeries]) => {
        if (!controller.signal.aborted) {
          setFinancialSeriesBySymbol({
            [normalizedBase]: baseSeries,
            [selectedCompare]: compareSeries
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFinancialSeriesBySymbol({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setFinancialSeriesLoading(false);
      });

    return () => controller.abort();
  }, [normalizedBase, selectedCompare]);

  useEffect(() => {
    if (!normalizedBase || !selectedCompare) {
      setResponse(null);
      setQuantitativeLoading(false);
      setNarrativeLoading(false);
      setError(null);
      setNarrativeFailed(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const input = { baseSymbol: normalizedBase, compareSymbols: [selectedCompare] };
      setQuantitativeLoading(true);
      setNarrativeLoading(true);
      setError(null);
      setNarrativeFailed(false);
      setResponse(null);

      requestCompanyCompareQuantitative(input, controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setResponse((current) => current?.narrative.status === "ready" ? current : payload);
          }
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(reason instanceof Error ? reason.message : "기업 비교 데이터를 불러오지 못했습니다");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuantitativeLoading(false);
        });

      requestCompanyCompare(input, controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setResponse(payload);
            setError(null);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setNarrativeFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setNarrativeLoading(false);
        });
    }, REQUEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedBase, selectedCompare]);

  const compareSearchSymbols = useMemo(() => {
    const bySymbol = new Map<string, ChartSymbolDto>();
    symbols.forEach((item) => {
      const symbol = normalizeSymbol(item.symbol);
      if (!symbol || symbol === normalizedBase) return;
      bySymbol.set(symbol, { ...item, symbol });
    });
    candidates.forEach((candidate) => {
      const symbol = normalizeSymbol(candidate.symbol);
      if (!symbol || symbol === normalizedBase) return;
      const current = bySymbol.get(symbol);
      bySymbol.set(symbol, {
        symbol,
        name: candidate.companyName || current?.name || symbol,
        sector: current?.sector
      });
    });
    if (selectedCompare && !bySymbol.has(selectedCompare)) {
      bySymbol.set(selectedCompare, { symbol: selectedCompare, name: selectedCompare });
    }
    return Array.from(bySymbol.values()).sort((left, right) => left.symbol.localeCompare(right.symbol));
  }, [candidates, normalizedBase, selectedCompare, symbols]);

  const handleCompareChange = (symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    onCompareSymbolsChange(normalized && normalized !== normalizedBase ? [normalized] : []);
  };

  const handleAxisKeyDown = (event: KeyboardEvent<HTMLButtonElement>, axisIndex: number) => {
    let nextIndex = axisIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (axisIndex + 1) % AXES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (axisIndex - 1 + AXES.length) % AXES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = AXES.length - 1;
    else return;

    event.preventDefault();
    setActiveAxisId(AXES[nextIndex].id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[nextIndex]?.focus();
  };

  const activeAxis = AXES.find((axis) => axis.id === activeAxisId) ?? AXES[1];

  return (
    <section className="compare-cockpit" aria-label="기업 성향 비교">
      <header className="compare-cockpit-topbar">
        <div className="compare-cockpit-brand">
          <BarChart3 size={18} aria-hidden="true" />
          <span>GOPS</span>
        </div>
        <div className="compare-cockpit-pair" aria-label="비교 기업">
          <span><i className="is-base" />{normalizedBase || "기업"}</span>
          <em>vs</em>
          <div className="compare-cockpit-symbol-picker">
            <i className="is-compare" aria-hidden="true" />
            <SymbolSearch
              symbols={compareSearchSymbols}
              selectedSymbol={selectedCompare}
              selectedLabel={selectedCompare}
              placeholder="기업 검색"
              ariaLabel="비교 기업 검색"
              listboxLabel="비교 기업 검색 결과"
              compact
              allowCustomSymbol
              resultLimit={6}
              className="compare-cockpit-symbol-search"
              menuClassName="compare-cockpit-symbol-menu"
              onSelectSymbol={handleCompareChange}
            />
          </div>
        </div>
      </header>

      <nav className="compare-cockpit-tabs" role="tablist" aria-label="기업 비교 분석축">
        {AXES.map((axis, index) => {
          const selected = activeAxis.id === axis.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={!selectedCompare}
              key={axis.id}
              onClick={() => setActiveAxisId(axis.id)}
              onKeyDown={(event) => handleAxisKeyDown(event, index)}
            >
              {axis.index} {axis.tab}
            </button>
          );
        })}
      </nav>

      {!selectedCompare && (
        <CompanyCompareEmptyState
          baseSymbol={normalizedBase}
          candidates={candidates}
          loading={candidateLoading}
          onSelect={handleCompareChange}
        />
      )}

      {selectedCompare && quantitativeLoading && !response && (
        <CompanyCompareSkeleton baseSymbol={normalizedBase} compareSymbol={selectedCompare} />
      )}

      {selectedCompare && !quantitativeLoading && error && !response && (
        <div className="compare-cockpit-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {selectedCompare && response && (
        <CockpitAxisContent
          axis={activeAxis}
          response={response}
          baseSymbol={normalizedBase}
          compareSymbol={selectedCompare}
          narrativeLoading={narrativeLoading}
          narrativeFailed={narrativeFailed}
          financialSeriesBySymbol={financialSeriesBySymbol}
          financialSeriesLoading={financialSeriesLoading}
        />
      )}
    </section>
  );
}

function CockpitAxisContent({
  axis,
  response,
  baseSymbol,
  compareSymbol,
  narrativeLoading,
  narrativeFailed,
  financialSeriesBySymbol,
  financialSeriesLoading
}: {
  axis: AxisMeta;
  response: CompanyCompareResponse;
  baseSymbol: string;
  compareSymbol: string;
  narrativeLoading: boolean;
  narrativeFailed: boolean;
  financialSeriesBySymbol: FinancialSeriesBySymbol;
  financialSeriesLoading: boolean;
}) {
  const quantitative = QUANTITATIVE_AXIS_IDS.has(axis.id);
  const metrics = quantitative ? selectMetrics(response, axis.id) : [];
  const qualitativeSection = quantitative
    ? undefined
    : response.qualitative.sections.find((section) => section.id === axis.id);
  const qualitativeRows = qualitativeSection
    ? buildQualitativeRows(qualitativeSection, baseSymbol, compareSymbol)
    : [];
  const pairedTrends = buildPairedTrendPoints(
    financialSeriesBySymbol[baseSymbol] ?? [],
    financialSeriesBySymbol[compareSymbol] ?? []
  );
  const relationshipRows = buildRelationshipMatrixRows(response, baseSymbol, compareSymbol);
  const recentIssueRows = buildRecentIssueRows(response, baseSymbol, compareSymbol);
  const defaultSourceCount = quantitative
    ? countMetricSources(metrics)
    : qualitativeSection?.evidenceRefs.length ?? 0;
  const sourceLabel = axis.id === "earnings_stability" && pairedTrends.length > 0
    ? `${pairedTrends.length * 2} SEC filings`
    : axis.id === "relationship" && relationshipRows.length > 0
      ? `${countRelationshipEvidence(response)} filing + graph sources`
      : axis.id === "recent_flow" && recentIssueRows.length > 0
        ? `${countRecentIssueEvidence(response)} News sources`
        : formatSourceCount(axis.id, defaultSourceCount);
  const narrative = response.narrative.sections.find((section) => section.id === axis.id)?.analysis;
  const brief = narrative
    ? (axis.id === "business_model" || axis.id === "risk_profile"
      ? compactQualitativeBrief(narrative, axis.id)
      : compactCompleteBrief(narrative))
    : (narrativeLoading
      ? "정량·공시 근거를 연결해 짧은 해석을 준비하고 있습니다."
      : narrativeFailed || response.narrative.status === "failed"
        ? "비교 근거는 확인할 수 있지만 AI 해석은 현재 사용할 수 없습니다."
        : "현재 확보된 근거를 같은 기준으로 나란히 비교합니다.");
  const briefParts = splitBriefForDisplay(brief);

  return (
    <div className="compare-cockpit-content" role="tabpanel" aria-live="polite">
      <header className="compare-cockpit-heading">
        <div>
          <span>{axis.index} / {axis.eyebrow}</span>
          <h2>{axis.title}</h2>
        </div>
        <span className="compare-cockpit-source-count">{sourceLabel}</span>
      </header>

      <section className="compare-cockpit-brief" aria-label="AI 근거 요약">
        {narrativeLoading && !narrative ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
        <div>
          <span>AI EVIDENCE BRIEF</span>
          <p aria-label={brief}>
            <span className="compare-cockpit-brief-primary" aria-hidden="true"><GlossaryText text={briefParts.primary} /></span>
            {briefParts.secondary && (
              <span className="compare-cockpit-brief-secondary" aria-hidden="true"> <GlossaryText text={briefParts.secondary} /></span>
            )}
          </p>
        </div>
      </section>

      {axis.id === "earnings_stability" ? (
        <EarningsStabilityView
          points={pairedTrends}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
          loading={financialSeriesLoading}
          fallbackMetrics={metrics}
        />
      ) : axis.id === "relationship" ? (
        <RelationshipMatrixView
          rows={relationshipRows}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
        />
      ) : axis.id === "recent_flow" ? (
        <RecentIssuesMatrixView
          rows={recentIssueRows}
          response={response}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
        />
      ) : axis.id === "business_model" || axis.id === "risk_profile" ? (
        <FilingComparisonMatrixView
          rows={qualitativeRows}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
        />
      ) : (
        <div className={`compare-cockpit-metrics${quantitative ? " is-quantitative" : " is-qualitative"}`}>
          {quantitative && metrics.map((metric) => (
            <QuantitativeMetricRow
              key={metric.id}
              metric={metric}
              baseSymbol={baseSymbol}
              compareSymbol={compareSymbol}
            />
          ))}
          {!quantitative && qualitativeRows.map((row) => (
            <QualitativeMetricRow
              key={row.label}
              row={row}
              baseSymbol={baseSymbol}
              compareSymbol={compareSymbol}
            />
          ))}
          {((quantitative && metrics.length === 0) || (!quantitative && qualitativeRows.length === 0)) && (
            <div className="compare-cockpit-no-data">이 분석축에 표시할 비교 근거가 아직 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

function FilingComparisonMatrixView({
  rows,
  baseSymbol,
  compareSymbol
}: {
  rows: QualitativeRow[];
  baseSymbol: string;
  compareSymbol: string;
}) {
  if (rows.length === 0) {
    return <div className="compare-cockpit-no-data">비교할 공시 근거가 아직 없습니다.</div>;
  }

  return (
    <div className="compare-cockpit-special-view">
      <div className="compare-cockpit-filing-matrix" role="table" aria-label={`${baseSymbol}와 ${compareSymbol} 공시 비교`}>
        <div className="compare-cockpit-filing-row is-head" role="row">
          <span role="columnheader">비교 항목</span>
          <span role="columnheader"><i className="is-base" />{baseSymbol}</span>
          <span role="columnheader"><i className="is-compare" />{compareSymbol}</span>
        </div>
        {rows.map((row) => (
          <div className="compare-cockpit-filing-row" role="row" key={row.label}>
            <strong role="rowheader">{row.label}</strong>
            <span role="cell"><GlossaryText text={row.baseValue} /></span>
            <span role="cell"><GlossaryText text={row.compareValue} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EarningsStabilityView({
  points,
  baseSymbol,
  compareSymbol,
  loading,
  fallbackMetrics
}: {
  points: PairedTrendPoint[];
  baseSymbol: string;
  compareSymbol: string;
  loading: boolean;
  fallbackMetrics: CompanyCompareMetric[];
}) {
  if (loading && points.length === 0) {
    return (
      <div className="compare-cockpit-special-loading" role="status">
        <LoaderCircle size={17} className="spin" /> 실제 발표 분기의 실적 추세를 맞추고 있습니다
      </div>
    );
  }

  if (points.length < 2) {
    return (
      <div className="compare-cockpit-metrics is-quantitative">
        {fallbackMetrics.map((metric) => (
          <QuantitativeMetricRow
            key={metric.id}
            metric={metric}
            baseSymbol={baseSymbol}
            compareSymbol={compareSymbol}
          />
        ))}
        {fallbackMetrics.length === 0 && (
          <div className="compare-cockpit-no-data">비교 가능한 분기 실적 추세가 아직 없습니다.</div>
        )}
      </div>
    );
  }

  return (
    <div className="compare-cockpit-special-view is-earnings">
      <div className="compare-cockpit-trend-grid">
        <TrendLineChart
          title="매출 성장률"
          subtitle="전년 같은 분기 대비"
          metric="revenueGrowth"
          points={points}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
        />
        <TrendLineChart
          title="영업이익률"
          subtitle="분기 누적 공시를 실제 분기값으로 환산"
          metric="operatingMargin"
          points={points}
          baseSymbol={baseSymbol}
          compareSymbol={compareSymbol}
        />
      </div>
      <div className="compare-cockpit-trend-note">
        <strong>추세 확인</strong>
        <span>{buildTrendObservation(points, baseSymbol, compareSymbol)}</span>
      </div>
    </div>
  );
}

function TrendLineChart({
  title,
  subtitle,
  metric,
  points,
  baseSymbol,
  compareSymbol
}: {
  title: string;
  subtitle: string;
  metric: "revenueGrowth" | "operatingMargin";
  points: PairedTrendPoint[];
  baseSymbol: string;
  compareSymbol: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const baseValues = points.map((point) => (
    metric === "revenueGrowth" ? point.baseRevenueGrowth : point.baseOperatingMargin
  ));
  const compareValues = points.map((point) => (
    metric === "revenueGrowth" ? point.compareRevenueGrowth : point.compareOperatingMargin
  ));
  const values = [...baseValues, ...compareValues].filter((value): value is number => Number.isFinite(value));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, 0.08);
  const yMinimum = Math.min(0, minimum - spread * 0.16);
  const yMaximum = maximum + spread * 0.16;
  const chartLeft = 58;
  const chartRight = 674;
  const chartTop = 22;
  const chartBottom = 154;
  const xFor = (index: number) => (
    points.length === 1
      ? (chartLeft + chartRight) / 2
      : chartLeft + (chartRight - chartLeft) * index / (points.length - 1)
  );
  const yFor = (value: number) => (
    chartBottom - (value - yMinimum) / Math.max(yMaximum - yMinimum, 0.01) * (chartBottom - chartTop)
  );
  const ticks = [yMaximum, (yMaximum + yMinimum) / 2, yMinimum];
  const description = points.map((point, index) => (
    `${point.label} ${baseSymbol} ${formatChartPercent(baseValues[index])}, ${compareSymbol} ${formatChartPercent(compareValues[index])}`
  )).join(". ");

  return (
    <section className="compare-cockpit-trend-block">
      <header className="compare-cockpit-trend-heading">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="compare-cockpit-trend-legend" aria-label={`${baseSymbol}와 ${compareSymbol} 범례`}>
          <span><i className="is-base" />{baseSymbol}</span>
          <span><i className="is-compare" />{compareSymbol}</span>
        </div>
      </header>
      <svg
        className="compare-cockpit-trend-chart"
        viewBox="0 0 720 192"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{baseSymbol}와 {compareSymbol}의 {title}</title>
        <desc id={descriptionId}>{description}</desc>
        <g className="compare-cockpit-chart-grid" aria-hidden="true">
          {ticks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} />
                <text x={chartLeft - 10} y={y + 4}>{formatChartPercent(tick)}</text>
              </g>
            );
          })}
        </g>
        <path className="compare-cockpit-trend-line is-base" d={buildLinePath(baseValues, xFor, yFor)} aria-hidden="true" />
        <path className="compare-cockpit-trend-line is-compare" d={buildLinePath(compareValues, xFor, yFor)} aria-hidden="true" />
        <g className="compare-cockpit-trend-points is-base" aria-hidden="true">
          {baseValues.map((value, index) => Number.isFinite(value) && (
            <g key={points[index].id}>
              <circle cx={xFor(index)} cy={yFor(value as number)} r="5" />
              <text x={xFor(index)} y={yFor(value as number) - 10}>{formatChartPercent(value)}</text>
            </g>
          ))}
        </g>
        <g className="compare-cockpit-trend-points is-compare" aria-hidden="true">
          {compareValues.map((value, index) => Number.isFinite(value) && (
            <g key={points[index].id}>
              <path d={diamondPath(xFor(index), yFor(value as number), 6)} />
              <text x={xFor(index)} y={yFor(value as number) + 18}>{formatChartPercent(value)}</text>
            </g>
          ))}
        </g>
        <g className="compare-cockpit-chart-periods" aria-hidden="true">
          {points.map((point, index) => (
            <text key={point.id} x={xFor(index)} y="184">{point.label}</text>
          ))}
        </g>
      </svg>
    </section>
  );
}

function RelationshipMatrixView({
  rows,
  baseSymbol,
  compareSymbol
}: {
  rows: RelationshipMatrixRow[];
  baseSymbol: string;
  compareSymbol: string;
}) {
  if (rows.length === 0) {
    return <div className="compare-cockpit-no-data">두 기업을 연결할 공시·온톨로지 근거가 아직 없습니다.</div>;
  }

  return (
    <div className="compare-cockpit-special-view">
      <div className="compare-cockpit-relationship-matrix" role="table" aria-label={`${baseSymbol}와 ${compareSymbol} 연관성 비교`}>
        <div className="compare-cockpit-relationship-row is-head" role="row">
          <span role="columnheader">관계 축</span>
          <span role="columnheader"><i className="is-base" />{baseSymbol} 쪽</span>
          <span role="columnheader">공통 영역</span>
          <span role="columnheader"><i className="is-compare" />{compareSymbol} 쪽</span>
        </div>
        {rows.map((row) => (
          <div className="compare-cockpit-relationship-row" role="row" key={row.label}>
            <strong role="rowheader">{row.label}</strong>
            <span role="cell"><GlossaryText text={row.baseValue} /></span>
            <span className="is-shared" role="cell">
              <b><GlossaryText text={row.sharedTitle} /></b>
              <em><GlossaryText text={row.sharedSummary} /></em>
            </span>
            <span role="cell"><GlossaryText text={row.compareValue} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentIssuesMatrixView({
  rows,
  response,
  baseSymbol,
  compareSymbol
}: {
  rows: RecentIssueRow[];
  response: CompanyCompareResponse;
  baseSymbol: string;
  compareSymbol: string;
}) {
  if (rows.length === 0) {
    return <div className="compare-cockpit-no-data">비교할 최근 뉴스 근거가 아직 없습니다.</div>;
  }

  return (
    <div className="compare-cockpit-special-view">
      <div className="compare-cockpit-issue-matrix" role="table" aria-label={`${baseSymbol}와 ${compareSymbol} 최근 이슈 비교`}>
        <div className="compare-cockpit-issue-row is-head" role="row">
          <span role="columnheader">변화 축</span>
          <span role="columnheader"><i className="is-base" />{baseSymbol}</span>
          <span role="columnheader"><i className="is-compare" />{compareSymbol}</span>
        </div>
        {rows.map((row, index) => (
          <div className="compare-cockpit-issue-row" role="row" key={`${row.label}-${index}`}>
            <strong role="rowheader">{row.label}</strong>
            <IssueEvidenceCell item={row.baseItem} response={response} symbol={baseSymbol} />
            <IssueEvidenceCell item={row.compareItem} response={response} symbol={compareSymbol} />
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueEvidenceCell({
  item,
  response,
  symbol
}: {
  item?: CompanyCompareQualitativeItem;
  response: CompanyCompareResponse;
  symbol: string;
}) {
  if (!item) {
    return (
      <article className="compare-cockpit-issue-cell is-empty" role="cell">
        <b>{symbol}</b>
        <p>이 변화 축에서 확인된 최근 저장 근거가 없습니다.</p>
      </article>
    );
  }

  const source = response.sources.find((entry) => entry.id === item.sourceRef);
  const url = item.url ?? source?.url ?? null;
  return (
    <article className="compare-cockpit-issue-cell" role="cell">
      <time dateTime={item.observedAt ?? undefined}>{formatObservedDate(item.observedAt)}</time>
      <b><GlossaryText text={item.title} /></b>
      <p><GlossaryText text={compactEvidencePhrase(item.summary)} /></p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">{source?.label ?? "원문"}</a>
      ) : (
        <span className="compare-cockpit-issue-source">{source?.label ?? "저장 뉴스"}</span>
      )}
    </article>
  );
}

function QuantitativeMetricRow({
  metric,
  baseSymbol,
  compareSymbol
}: {
  metric: CompanyCompareMetric;
  baseSymbol: string;
  compareSymbol: string;
}) {
  const baseValue = metric.values.find((value) => value.symbol === baseSymbol);
  const compareValue = metric.values.find((value) => value.symbol === compareSymbol);
  const extent = Math.max(Math.abs(baseValue?.value ?? 0), Math.abs(compareValue?.value ?? 0));
  const baseWidth = barWidth(baseValue?.value ?? null, extent);
  const compareWidth = barWidth(compareValue?.value ?? null, extent);
  const baseStyle = { "--compare-bar-width": `${baseWidth}%` } as CSSProperties;
  const compareStyle = { "--compare-bar-width": `${compareWidth}%` } as CSSProperties;

  return (
    <div
      className="compare-cockpit-metric-row"
      aria-label={`${metric.label}: ${baseSymbol} ${baseValue?.display ?? "데이터 없음"}, ${compareSymbol} ${compareValue?.display ?? "데이터 없음"}`}
    >
      <div className="compare-cockpit-primary-value">
        <span>{metric.label}</span>
        <strong title={baseValue?.asOf ? `기준 ${baseValue.asOf}` : undefined}>{baseValue?.display ?? "데이터 없음"}</strong>
      </div>
      <div className="compare-cockpit-bars" aria-hidden="true">
        <i className="is-base" style={baseStyle} />
        <i className="is-compare" style={compareStyle} />
      </div>
      <div className="compare-cockpit-secondary-value">
        <strong title={compareValue?.asOf ? `기준 ${compareValue.asOf}` : undefined}>{compareValue?.display ?? "데이터 없음"}</strong>
        <span>{formatMetricDelta(metric, baseValue?.value ?? null, compareValue?.value ?? null)}</span>
      </div>
    </div>
  );
}

function QualitativeMetricRow({
  row,
  baseSymbol,
  compareSymbol
}: {
  row: QualitativeRow;
  baseSymbol: string;
  compareSymbol: string;
}) {
  return (
    <div className="compare-cockpit-metric-row is-qualitative">
      <span className="compare-cockpit-row-label">{row.label}</span>
      <div className="compare-cockpit-paired-copy">
        <span><b>{baseSymbol}</b><strong><GlossaryText text={row.baseValue} /></strong></span>
        <span><b>{compareSymbol}</b><strong><GlossaryText text={row.compareValue} /></strong></span>
      </div>
    </div>
  );
}

function CompanyCompareEmptyState({
  baseSymbol,
  candidates,
  loading,
  onSelect
}: {
  baseSymbol: string;
  candidates: CompanyCompareCandidate[];
  loading: boolean;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="compare-cockpit-empty">
      <Building2 size={24} />
      <h2>{baseSymbol}와 비교할 기업을 선택하세요</h2>
      <p>상단의 기업 선택 또는 아래의 같은 테마 후보를 사용할 수 있습니다.</p>
      {loading && <span><LoaderCircle size={16} className="spin" /> 비교 후보를 찾고 있습니다</span>}
      {!loading && candidates.length > 0 && (
        <div className="compare-cockpit-candidates" aria-label="온톨로지 비교 후보">
          {candidates.slice(0, 6).map((candidate) => (
            <button type="button" key={candidate.symbol} onClick={() => onSelect(candidate.symbol)}>
              <strong>{candidate.symbol}</strong>
              <small>{candidate.themes.slice(0, 2).join(" · ") || "같은 테마"}</small>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCompareSkeleton({
  baseSymbol,
  compareSymbol
}: {
  baseSymbol: string;
  compareSymbol: string;
}) {
  return (
    <div className="compare-cockpit-skeleton" role="status" aria-label="기업 비교 근거를 불러오는 중">
      <span><LoaderCircle size={17} className="spin" /> {baseSymbol}와 {compareSymbol} 근거를 불러오고 있습니다</span>
      {[0, 1, 2].map((index) => <i key={index} />)}
    </div>
  );
}

function buildPairedTrendPoints(
  baseSeries: CompanyFinancialSeriesPoint[],
  compareSeries: CompanyFinancialSeriesPoint[]
): PairedTrendPoint[] {
  const basePoints = buildCompanyTrendPoints(baseSeries).slice(-4);
  const comparePoints = buildCompanyTrendPoints(compareSeries).slice(-4);
  const pairCount = Math.min(basePoints.length, comparePoints.length, 4);
  if (pairCount === 0) return [];
  const alignedBase = basePoints.slice(-pairCount);
  const alignedCompare = comparePoints.slice(-pairCount);
  return alignedBase.map((basePoint, index) => {
    const comparePoint = alignedCompare[index];
    return {
      id: `${basePoint.period}-${comparePoint.period}`,
      label: formatPeriodRange(basePoint.periodEndDate, comparePoint.periodEndDate),
      basePeriod: basePoint.period,
      comparePeriod: comparePoint.period,
      baseRevenueGrowth: basePoint.revenueGrowth,
      compareRevenueGrowth: comparePoint.revenueGrowth,
      baseOperatingMargin: basePoint.operatingMargin,
      compareOperatingMargin: comparePoint.operatingMargin
    };
  });
}

function buildCompanyTrendPoints(series: CompanyFinancialSeriesPoint[]): CompanyTrendPoint[] {
  type StandaloneQuarter = {
    fiscalYear: number;
    fiscalQuarter: number;
    period: string;
    periodEndDate: string;
    revenue: number;
    operatingIncome: number;
  };

  const ordered = [...series]
    .filter((point) => point.periodEndDate)
    .sort((left, right) => (left.periodEndDate ?? "").localeCompare(right.periodEndDate ?? ""));
  const rawByPeriod = new Map(ordered.map((point) => [point.period.toUpperCase(), point]));
  const quarters: StandaloneQuarter[] = [];

  ordered.forEach((point) => {
    const match = point.period.toUpperCase().match(/^(\d{4})Q([1-4])$/);
    const revenue = point.revenue;
    const operatingIncome = point.operatingIncome;
    if (!match || !Number.isFinite(revenue ?? NaN) || !Number.isFinite(operatingIncome ?? NaN)) return;
    const fiscalYear = Number(match[1]);
    const fiscalQuarter = Number(match[2]);
    if (fiscalQuarter === 4) return;

    let standaloneRevenue = revenue as number;
    let standaloneOperatingIncome = operatingIncome as number;
    if (fiscalQuarter > 1) {
      const previous = rawByPeriod.get(`${fiscalYear}Q${fiscalQuarter - 1}`);
      if (!Number.isFinite(previous?.revenue ?? NaN) || !Number.isFinite(previous?.operatingIncome ?? NaN)) return;
      standaloneRevenue -= previous?.revenue as number;
      standaloneOperatingIncome -= previous?.operatingIncome as number;
    }
    if (standaloneRevenue <= 0) return;
    quarters.push({
      fiscalYear,
      fiscalQuarter,
      period: point.period.toUpperCase(),
      periodEndDate: point.periodEndDate ?? "",
      revenue: standaloneRevenue,
      operatingIncome: standaloneOperatingIncome
    });
  });

  const byFiscalQuarter = new Map(quarters.map((point) => [
    `${point.fiscalYear}Q${point.fiscalQuarter}`,
    point
  ]));
  return quarters.map((point) => {
    const previousYear = byFiscalQuarter.get(`${point.fiscalYear - 1}Q${point.fiscalQuarter}`);
    return {
      period: point.period,
      periodEndDate: point.periodEndDate,
      revenueGrowth: previousYear && previousYear.revenue > 0
        ? point.revenue / previousYear.revenue - 1
        : null,
      operatingMargin: point.revenue > 0 ? point.operatingIncome / point.revenue : null
    };
  }).filter((point) => Number.isFinite(point.revenueGrowth ?? NaN) && Number.isFinite(point.operatingMargin ?? NaN));
}

function buildRelationshipMatrixRows(
  response: CompanyCompareResponse,
  baseSymbol: string,
  compareSymbol: string
): RelationshipMatrixRow[] {
  const businessSection = response.qualitative.sections.find((section) => section.id === "business_model");
  const relationshipSection = response.qualitative.sections.find((section) => section.id === "relationship");
  const baseItem = businessSection ? findBusinessItem(businessSection.items, baseSymbol) : undefined;
  const compareItem = businessSection ? findBusinessItem(businessSection.items, compareSymbol) : undefined;
  const sharedItem = relationshipSection?.items.find((item) => item.kind === "ontology-relationship")
    ?? relationshipSection?.items[0];
  if (!baseItem && !compareItem && !sharedItem) return [];

  const sharedTheme = sharedItem?.details.find((detail) => !detail.startsWith("관계 유형:"))
    ?? sharedItem?.title
    ?? "공통 영역";
  const baseEcosystem = findDetailByKeywords(baseItem, ["소프트웨어", "cuda", "라이선스", "플랫폼", "개발도구"]);
  const compareEcosystem = findDetailByKeywords(compareItem, ["소프트웨어", "rocm", "라이선스", "플랫폼", "개발도구"]);

  return [
    {
      label: "사업 구조",
      baseValue: compactEvidencePhrase(baseItem?.summary),
      sharedTitle: sharedTheme,
      sharedSummary: compactEvidencePhrase(sharedItem?.summary),
      compareValue: compactEvidencePhrase(compareItem?.summary)
    },
    {
      label: "제품 구성",
      baseValue: compactEvidencePhrase(baseItem?.details[0] ?? baseItem?.summary),
      sharedTitle: `${sharedTheme} 수요`,
      sharedSummary: "공통 테마 안에서 양사가 공시한 주요 제품 구성을 나란히 비교합니다.",
      compareValue: compactEvidencePhrase(compareItem?.details[0] ?? compareItem?.summary)
    },
    {
      label: "생태계",
      baseValue: compactEvidencePhrase(baseEcosystem ?? baseItem?.details[1]),
      sharedTitle: `${sharedTheme} 채택`,
      sharedSummary: "같은 테마에서 소프트웨어와 플랫폼 채택 방식이 어떻게 갈리는지 확인합니다.",
      compareValue: compactEvidencePhrase(compareEcosystem ?? compareItem?.details[1])
    },
    {
      label: "차별화 축",
      baseValue: compactEvidencePhrase(baseItem?.details.at(-1)),
      sharedTitle: "공시상 경쟁 요인",
      sharedSummary: compactEvidencePhrase(sharedItem?.summary),
      compareValue: compactEvidencePhrase(compareItem?.details.at(-1))
    }
  ];
}

function buildRecentIssueRows(
  response: CompanyCompareResponse,
  baseSymbol: string,
  compareSymbol: string
): RecentIssueRow[] {
  const section = response.qualitative.sections.find((item) => item.id === "recent_flow");
  if (!section) return [];
  const baseItems = findSymbolItems(section.items, baseSymbol).sort(sortEvidenceByObservedAt).slice(0, 2);
  const compareItems = findSymbolItems(section.items, compareSymbol).sort(sortEvidenceByObservedAt).slice(0, 2);
  const rowCount = Math.min(2, Math.max(baseItems.length, compareItems.length));
  return Array.from({ length: rowCount }, (_, index) => {
    const baseItem = baseItems[index];
    const compareItem = compareItems[index];
    const baseCategory = baseItem ? classifyRecentIssue(baseItem) : "";
    const compareCategory = compareItem ? classifyRecentIssue(compareItem) : "";
    return {
      label: baseCategory && compareCategory && baseCategory !== compareCategory
        ? `${baseCategory} · ${compareCategory}`
        : baseCategory || compareCategory || "최근 변화",
      baseItem,
      compareItem
    };
  });
}

function classifyRecentIssue(item: CompanyCompareQualitativeItem): string {
  const text = [item.title, item.summary, ...item.details].join(" ").toLowerCase();
  if (/(실적|매출|eps|earnings|전망|목표주가|투자의견)/.test(text)) return "실적·전망";
  if (/(규제|수출|관세|법률|정책|제재)/.test(text)) return "규제·정책";
  if (/(공급|생산|출하|제품|gpu|cpu|칩|반도체|데이터센터)/.test(text)) return "제품·공급";
  if (/(고객|계약|협업|투자|구축|클라우드)/.test(text)) return "고객·투자";
  if (/(ai|인공지능|생태계|소프트웨어|모델)/.test(text)) return "AI 생태계";
  return "시장 반응";
}

function sortEvidenceByObservedAt(left: CompanyCompareQualitativeItem, right: CompanyCompareQualitativeItem): number {
  return (right.observedAt ?? "").localeCompare(left.observedAt ?? "");
}

function findDetailByKeywords(item: CompanyCompareQualitativeItem | undefined, keywords: string[]): string | undefined {
  return item?.details.find((detail) => {
    const normalized = detail.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
  });
}

function countRelationshipEvidence(response: CompanyCompareResponse): number {
  const refs = response.qualitative.sections
    .filter((section) => section.id === "business_model" || section.id === "relationship")
    .flatMap((section) => section.evidenceRefs);
  return new Set(refs).size;
}

function countRecentIssueEvidence(response: CompanyCompareResponse): number {
  const section = response.qualitative.sections.find((item) => item.id === "recent_flow");
  return new Set(section?.items.map((item) => item.sourceRef) ?? []).size;
}

function buildTrendObservation(points: PairedTrendPoint[], baseSymbol: string, compareSymbol: string): string {
  const latest = points.at(-1);
  if (!latest) return "비교 가능한 발표 분기 근거가 없습니다.";
  return `최근 확인 분기에서 ${baseSymbol}의 매출 성장률은 ${formatChartPercent(latest.baseRevenueGrowth)}, 영업이익률은 ${formatChartPercent(latest.baseOperatingMargin)}입니다. ${compareSymbol}는 각각 ${formatChartPercent(latest.compareRevenueGrowth)}, ${formatChartPercent(latest.compareOperatingMargin)}로 나타났습니다.`;
}

function buildLinePath(
  values: Array<number | null>,
  xFor: (index: number) => number,
  yFor: (value: number) => number
): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value ?? NaN)) {
      drawing = false;
      return;
    }
    path += `${drawing ? " L" : "M"}${xFor(index)} ${yFor(value as number)}`;
    drawing = true;
  });
  return path;
}

function diamondPath(x: number, y: number, radius: number): string {
  return `M${x} ${y - radius} L${x + radius} ${y} L${x} ${y + radius} L${x - radius} ${y} Z`;
}

function formatChartPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "자료 없음";
  const percent = (value as number) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(Math.abs(percent) >= 100 ? 0 : 1)}%`;
}

function formatPeriodRange(baseDate: string, compareDate: string): string {
  const base = parseYearMonth(baseDate);
  const compare = parseYearMonth(compareDate);
  if (!base && !compare) return "발표 분기";
  if (!base || !compare) {
    const value = base ?? compare;
    return `${value?.year}.${String(value?.month).padStart(2, "0")}`;
  }
  if (base.year === compare.year && base.month === compare.month) {
    return `${base.year}.${String(base.month).padStart(2, "0")}`;
  }
  if (base.year === compare.year) {
    const months = [base.month, compare.month].sort((left, right) => left - right);
    return `${base.year}.${String(months[0]).padStart(2, "0")}–${String(months[1]).padStart(2, "0")}`;
  }
  return `${compare.year}.${String(compare.month).padStart(2, "0")}–${base.year}.${String(base.month).padStart(2, "0")}`;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

function formatObservedDate(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "날짜 확인 중";
}

function compactEvidencePhrase(value: string | null | undefined): string {
  const normalized = compactText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "근거 없음") return normalized;
  const clauses = normalized
    .split(/[,;]|(?<=[.!?])\s+/)
    .map((clause) => clause.replace(/[.!?]+$/, "").trim())
    .filter(Boolean);
  if (clauses.length === 0) return normalized;
  let phrase = clauses[0];
  for (const clause of clauses.slice(1)) {
    if (phrase.length >= 38 || `${phrase} · ${clause}`.length > 88) break;
    phrase = `${phrase} · ${clause}`;
  }
  return phrase;
}

function selectMetrics(response: CompanyCompareResponse, axisId: CompanyCompareSectionId): CompanyCompareMetric[] {
  const section = response.quantitative.sections.find((item) => item.id === axisId);
  if (!section) return [];
  const priority = METRIC_PRIORITY[axisId] ?? [];
  const selected = priority
    .map((metricId) => section.metrics.find((metric) => metric.id === metricId))
    .filter((metric): metric is CompanyCompareMetric => Boolean(metric));
  return (selected.length > 0 ? selected : section.metrics).slice(0, 3);
}

function buildQualitativeRows(
  section: CompanyCompareQualitativeSection,
  baseSymbol: string,
  compareSymbol: string
): QualitativeRow[] {
  if (section.id === "business_model") {
    const baseItem = findBusinessItem(section.items, baseSymbol);
    const compareItem = findBusinessItem(section.items, compareSymbol);
    const sharedItem = section.items.find((item) => item.kind === "ontology-theme" || item.kind === "ontology-relationship");
    return [
      {
        label: "사업 구조",
        baseValue: compactEvidencePhrase(baseItem?.summary),
        compareValue: compactEvidencePhrase(compareItem?.summary)
      },
      {
        label: "핵심 수익원",
        baseValue: compactEvidencePhrase(baseItem?.details[0]),
        compareValue: compactEvidencePhrase(compareItem?.details[0])
      },
      {
        label: "성장 기반",
        baseValue: compactEvidencePhrase(baseItem?.details[1] ?? sharedItem?.summary),
        compareValue: compactEvidencePhrase(compareItem?.details[1] ?? sharedItem?.summary)
      }
    ];
  }

  if (section.id === "relationship") {
    const items = section.items.slice(0, 3);
    return [0, 1, 2].map((index) => ({
      label: index === 0 ? "공통 테마" : index === 1 ? "관계 유형" : "연결 근거",
      baseValue: compactText(items[index]?.summary ?? items[index]?.title),
      compareValue: compactText(items[index]?.summary ?? items[index]?.title)
    }));
  }

  const baseItems = findSymbolItems(section.items, baseSymbol);
  const compareItems = findSymbolItems(section.items, compareSymbol);
  return [0, 1, 2].map((index) => {
    const baseItem = baseItems[index];
    const compareItem = compareItems[index];
    const label = section.id === "recent_flow"
      ? `최근 이슈 ${index + 1}`
      : cleanItemLabel(baseItem?.title ?? compareItem?.title, index);
    return {
      label: section.id === "risk_profile" ? normalizeRiskLabel(label) : label,
      baseValue: section.id === "risk_profile"
        ? compactEvidencePhrase(baseItem?.summary)
        : compactText(section.id === "recent_flow" ? baseItem?.title : baseItem?.summary),
      compareValue: section.id === "risk_profile"
        ? compactEvidencePhrase(compareItem?.summary)
        : compactText(section.id === "recent_flow" ? compareItem?.title : compareItem?.summary)
    };
  });
}

function findBusinessItem(items: CompanyCompareQualitativeItem[], symbol: string) {
  return items.find((item) => item.kind === "10k-business" && item.symbol === symbol);
}

function findSymbolItems(items: CompanyCompareQualitativeItem[], symbol: string) {
  return items.filter((item) => {
    const symbols = (item.symbol ?? "").split("·").map(normalizeSymbol);
    return symbols.includes(symbol);
  });
}

function cleanItemLabel(value: string | undefined, index: number): string {
  if (!value) return `주요 위험 ${index + 1}`;
  const [, category] = value.split("·").map((part) => part.trim());
  return compactText(category || value, 14);
}

function normalizeRiskLabel(value: string): string {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (normalized.includes("기술변화") || normalized.includes("기술표준")) return "기술 변화";
  if (normalized.includes("경쟁")) return "경쟁 환경";
  if (normalized.includes("공급")) return "공급망";
  return value;
}

function compactText(value: string | null | undefined, maxLength?: number): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return "근거 없음";
  return maxLength && normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function compactCompleteBrief(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/.*?[.!?](?=\s|$)/g);
  if (!sentences || sentences.length === 0) return normalized;

  let result = "";
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence.trim()}` : sentence.trim();
    if (result && result.length >= 80) break;
    if (result && candidate.length > 220) break;
    result = candidate;
  }
  return result || sentences[0].trim();
}

function compactQualitativeBrief(value: string, axisId: CompanyCompareSectionId): string {
  const phrase = compactEvidencePhrase(value);
  if (phrase === "근거 없음" || /[.!?]$/.test(phrase)) return phrase;
  if (axisId === "risk_profile" && !/(다|니다|있다|없다|된다|한다)$/.test(phrase)) {
    return `${phrase} 등이 주요 위험으로 제시됩니다.`;
  }
  return `${phrase}.`;
}

function splitBriefForDisplay(value: string): { primary: string; secondary: string } {
  const normalized = value.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/.*?[.!?](?=\s|$)/g)?.map((sentence) => sentence.trim());
  if (!sentences || sentences.length === 0) {
    return { primary: normalized, secondary: "" };
  }
  return {
    primary: sentences[0],
    secondary: sentences.slice(1).join(" ")
  };
}

function countMetricSources(metrics: CompanyCompareMetric[]): number {
  return new Set(metrics.flatMap((metric) => (
    metric.values
      .filter((value) => value.value !== null)
      .map((value) => value.sourceRef)
      .filter((value): value is string => Boolean(value))
  ))).size;
}

function formatSourceCount(axisId: CompanyCompareSectionId, count: number): string {
  if (count === 0) return "근거 준비 중";
  if (QUANTITATIVE_AXIS_IDS.has(axisId)) return `${count} SEC sources`;
  if (axisId === "recent_flow") return `${count} News sources`;
  if (axisId === "relationship") return `${count} Graph sources`;
  return `${count} filing sources`;
}

function barWidth(value: number | null, extent: number): number {
  if (value === null || extent === 0) return 0;
  if (value === 0) return 2;
  return Math.max(4, Math.abs(value) / extent * 90);
}

function formatMetricDelta(metric: CompanyCompareMetric, baseValue: number | null, compareValue: number | null): string {
  if (baseValue === null || compareValue === null) return "비교 불가";
  const difference = Math.abs(baseValue - compareValue);
  if (metric.unit === "percent") return `${(difference * 100).toFixed(1)}%p 차이`;
  if (metric.unit === "ratio") return `${difference.toFixed(2)} 차이`;
  if (metric.unit === "count") return `${difference.toFixed(0)}개 차이`;
  return "규모 차이";
}

function normalizeCompareSymbols(symbols: string[], baseSymbol: string): string[] {
  const normalized: string[] = [];
  for (const value of symbols) {
    const symbol = normalizeSymbol(value);
    if (symbol && symbol !== baseSymbol && !normalized.includes(symbol)) normalized.push(symbol);
  }
  return normalized.slice(0, MAX_COMPARE_SYMBOLS);
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export default CompanyComparePanel;
