import {
  AlertCircle,
  BarChart3,
  Building2,
  LoaderCircle,
  Sparkles,
  X
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  agentReferenceKey,
  compareAxisReference,
  compareContextReference,
  compareMetricReference,
  type AgentReference
} from "../agent/agentReferences";
import type { ChartSymbolDto } from "../chart/types";
import { ContextualAgentAskButton } from "../components/ContextualAgentAskButton";
import { SymbolSearch } from "../components/SymbolSearch";
import { GlossaryText } from "../glossary/GlossaryText";
import { fetchCompanyFinancialSeries } from "../market/heatmapApi";
import type { CompanyFinancialSeriesPoint } from "../market/sp500Universe.seed";
import {
  MAX_COMPANY_COMPARE_SYMBOLS,
  normalizeCompanyCompareSymbols,
  normalizeCompanySymbol
} from "./companyCompareSelection";
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
  sourcePanelId?: string;
  selectedAgentReferenceKeys?: string[];
  emphasizedAgentReferenceKeys?: string[];
  onAgentReferenceSelect?: (reference: AgentReference) => void;
  onAgentAsk?: () => void;
  onCompareSymbolsChange: (symbols: string[]) => void;
};

type AxisMeta = {
  id: CompanyCompareSectionId;
  index: string;
  tab: string;
  eyebrow: string;
  title: string;
};

type FinancialSeriesBySymbol = Record<string, CompanyFinancialSeriesPoint[]>;

type CompanyTrendPoint = {
  period: string;
  periodEndDate: string;
  revenueGrowth: number | null;
  operatingMargin: number | null;
};

type AlignedTrendPoint = {
  id: string;
  label: string;
  values: Record<string, {
    revenueGrowth: number | null;
    operatingMargin: number | null;
  }>;
};

type QualitativeMatrixRow = {
  label: string;
  values: Record<string, string>;
};

type ReferenceOptions = {
  selectedKeys: string[];
  emphasizedKeys: string[];
  onSelect?: (reference: AgentReference) => void;
};

const REQUEST_DEBOUNCE_MS = 400;
const COMPANY_COLORS = ["#33adff", "#ff7a3d", "#b890ff"] as const;
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
  sourcePanelId,
  selectedAgentReferenceKeys = [],
  emphasizedAgentReferenceKeys = [],
  onAgentReferenceSelect,
  onAgentAsk,
  onCompareSymbolsChange
}: CompanyComparePanelProps) {
  const normalizedBase = normalizeCompanySymbol(baseSymbol);
  const normalizedCompares = useMemo(
    () => normalizeCompanyCompareSymbols(normalizedBase, compareSymbols),
    [compareSymbols, normalizedBase]
  );
  const comparedSymbols = useMemo(
    () => [normalizedBase, ...normalizedCompares].filter(Boolean),
    [normalizedBase, normalizedCompares]
  );
  const compareKey = normalizedCompares.join(",");
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

  const referenceOptions: ReferenceOptions = {
    selectedKeys: selectedAgentReferenceKeys,
    emphasizedKeys: emphasizedAgentReferenceKeys,
    onSelect: onAgentReferenceSelect
  };

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
    if (!normalizedBase || normalizedCompares.length === 0) {
      setFinancialSeriesBySymbol({});
      setFinancialSeriesLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setFinancialSeriesLoading(true);
    setFinancialSeriesBySymbol({});
    Promise.allSettled(comparedSymbols.map(async (symbol) => ({
      symbol,
      series: await fetchCompanyFinancialSeries(symbol, controller.signal, { years: 3, period: "quarterly" })
    })))
      .then((results) => {
        if (controller.signal.aborted) return;
        const next: FinancialSeriesBySymbol = {};
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            next[result.value.symbol] = result.value.series;
          }
        });
        setFinancialSeriesBySymbol(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFinancialSeriesLoading(false);
      });
    return () => controller.abort();
  }, [compareKey, normalizedBase]);

  useEffect(() => {
    if (!normalizedBase || normalizedCompares.length === 0) {
      setResponse(null);
      setQuantitativeLoading(false);
      setNarrativeLoading(false);
      setError(null);
      setNarrativeFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const input = { baseSymbol: normalizedBase, compareSymbols: normalizedCompares };
      setQuantitativeLoading(true);
      setNarrativeLoading(true);
      setError(null);
      setNarrativeFailed(false);
      setResponse(null);

      requestCompanyCompareQuantitative(input, controller.signal)
        .then((payload) => {
          if (!controller.signal.aborted) {
            setResponse((current) => (
              current && current.narrative.status !== "not-requested" ? current : payload
            ));
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
          if (controller.signal.aborted) return;
          const validated = validateNarrativeCoverage(payload, comparedSymbols);
          setResponse(validated);
          setNarrativeFailed(validated.narrative.status === "failed");
          setError(null);
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
  }, [compareKey, normalizedBase]);

  const searchSymbols = useMemo(() => {
    const excluded = new Set(comparedSymbols);
    const bySymbol = new Map<string, ChartSymbolDto>();
    symbols.forEach((item) => {
      const symbol = normalizeCompanySymbol(item.symbol);
      if (!symbol || excluded.has(symbol)) return;
      bySymbol.set(symbol, { ...item, symbol });
    });
    candidates.forEach((candidate) => {
      const symbol = normalizeCompanySymbol(candidate.symbol);
      if (!symbol || excluded.has(symbol)) return;
      const current = bySymbol.get(symbol);
      bySymbol.set(symbol, {
        symbol,
        name: candidate.companyName || current?.name || symbol,
        sector: current?.sector
      });
    });
    return Array.from(bySymbol.values()).sort((left, right) => left.symbol.localeCompare(right.symbol));
  }, [candidates, comparedSymbols, symbols]);

  const addCompare = (symbol: string) => {
    onCompareSymbolsChange(normalizeCompanyCompareSymbols(normalizedBase, [...normalizedCompares, symbol]));
  };
  const removeCompare = (symbol: string) => {
    onCompareSymbolsChange(normalizedCompares.filter((value) => value !== normalizeCompanySymbol(symbol)));
  };
  const activeAxis = AXES.find((axis) => axis.id === activeAxisId) ?? AXES[1];
  const contextReference = compareContextReference({
    baseSymbol: normalizedBase,
    compareSymbols: normalizedCompares,
    summary: response?.narrative.summary
      ?? `${comparedSymbols.join(", ")}의 정량 지표와 공시·관계·뉴스 근거 비교`
  }, sourcePanelId);
  const contextState = referenceStateClass(contextReference, referenceOptions);

  return (
    <section className="compare-cockpit compare-cockpit-v2" aria-label="기업 성향 비교">
      <header className="compare-cockpit-topbar">
        <div className="compare-cockpit-brand">
          <BarChart3 size={18} aria-hidden="true" />
          <span>GOPS</span>
        </div>
        <div
          className={`compare-cockpit-symbols compare-reference-surface ${contextState}`}
          aria-label={`${comparedSymbols.join(" 대 ")} 비교를 Agent에 참조`}
          {...referenceSurfaceProps(contextReference, referenceOptions)}
        >
          {comparedSymbols.map((symbol, index) => (
            <span className="compare-cockpit-symbol-chip" key={symbol}>
              <i style={{ "--company-color": companyColor(index) } as CSSProperties} aria-hidden="true" />
              {symbol}
              {index > 0 && (
                <button
                  type="button"
                  aria-label={`${symbol} 비교 삭제`}
                  title={`${symbol} 비교 삭제`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeCompare(symbol);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {comparedSymbols.length > 1 && <em>비교 전체 참조</em>}
        </div>
        <div className="compare-cockpit-add">
          {normalizedCompares.length < MAX_COMPANY_COMPARE_SYMBOLS ? (
            <SymbolSearch
              symbols={searchSymbols}
              selectedLabel=""
              placeholder="기업 추가"
              ariaLabel="비교 기업 추가"
              listboxLabel="비교 기업 검색 결과"
              compact
              allowCustomSymbol
              resultLimit={6}
              className="compare-cockpit-symbol-search"
              menuClassName="compare-cockpit-symbol-menu"
              onSelectSymbol={addCompare}
            />
          ) : (
            <span className="compare-cockpit-limit" role="status">최대 2개 기업까지 비교할 수 있습니다</span>
          )}
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
              disabled={normalizedCompares.length === 0}
              key={axis.id}
              onClick={() => setActiveAxisId(axis.id)}
              onKeyDown={(event) => handleAxisKeyDown(event, index, setActiveAxisId)}
            >
              {axis.index} {axis.tab}
            </button>
          );
        })}
      </nav>

      {normalizedCompares.length === 0 && (
        <CompanyCompareEmptyState
          baseSymbol={normalizedBase}
          candidates={candidates}
          loading={candidateLoading}
          onSelect={addCompare}
        />
      )}

      {normalizedCompares.length > 0 && quantitativeLoading && !response && (
        <CompanyCompareSkeleton symbols={comparedSymbols} />
      )}

      {normalizedCompares.length > 0 && !quantitativeLoading && error && !response && (
        <div className="compare-cockpit-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {normalizedCompares.length > 0 && response && (
        <CockpitAxisContent
          axis={activeAxis}
          response={response}
          symbols={comparedSymbols}
          narrativeLoading={narrativeLoading}
          narrativeFailed={narrativeFailed}
          financialSeriesBySymbol={financialSeriesBySymbol}
          financialSeriesLoading={financialSeriesLoading}
          sourcePanelId={sourcePanelId}
          referenceOptions={referenceOptions}
          onAgentAsk={onAgentAsk}
        />
      )}
    </section>
  );
}

function CockpitAxisContent({
  axis,
  response,
  symbols,
  narrativeLoading,
  narrativeFailed,
  financialSeriesBySymbol,
  financialSeriesLoading,
  sourcePanelId,
  referenceOptions,
  onAgentAsk
}: {
  axis: AxisMeta;
  response: CompanyCompareResponse;
  symbols: string[];
  narrativeLoading: boolean;
  narrativeFailed: boolean;
  financialSeriesBySymbol: FinancialSeriesBySymbol;
  financialSeriesLoading: boolean;
  sourcePanelId?: string;
  referenceOptions: ReferenceOptions;
  onAgentAsk?: () => void;
}) {
  const quantitative = QUANTITATIVE_AXIS_IDS.has(axis.id);
  const metrics = quantitative ? selectMetrics(response, axis.id) : [];
  const qualitativeSection = quantitative
    ? undefined
    : response.qualitative.sections.find((section) => section.id === axis.id);
  const qualitativeRows = qualitativeSection
    ? buildQualitativeRows(qualitativeSection, symbols)
    : [];
  const trendPoints = buildAlignedTrendPoints(financialSeriesBySymbol, symbols);
  const narrativeSection = response.narrative.sections.find((section) => section.id === axis.id);
  const brief = narrativeSection?.analysis
    ?? (narrativeLoading
      ? "정량·공시 근거를 연결해 해석을 준비하고 있습니다."
      : narrativeFailed || response.narrative.status === "failed"
        ? "비교 근거는 확인할 수 있지만 모든 기업을 포함한 AI 해석은 현재 사용할 수 없습니다."
        : "현재 확보된 근거를 같은 기준으로 나란히 비교합니다.");
  const evidenceRefs = narrativeSection?.evidenceRefs
    ?? qualitativeSection?.evidenceRefs
    ?? metrics.flatMap((metric) => metric.values.map((value) => value.sourceRef).filter(Boolean) as string[]);
  const axisReference = compareAxisReference({
    symbols,
    sectionId: axis.id,
    heading: axis.title,
    analysis: brief,
    evidenceRefs
  }, sourcePanelId);
  const axisState = referenceStateClass(axisReference, referenceOptions);

  return (
    <div className="compare-cockpit-content" role="tabpanel" aria-live="polite">
      <header className="compare-cockpit-heading">
        <div>
          <span>{axis.index} / {axis.eyebrow}</span>
          <h2>{axis.title}</h2>
        </div>
        <span className="compare-cockpit-source-count">{formatSourceCount(metrics, qualitativeSection)}</span>
      </header>

      <section
        className={`compare-cockpit-brief compare-reference-surface ${axisState}`}
        aria-label={`${axis.title} AI 근거 요약을 Agent에 참조`}
        {...referenceSurfaceProps(axisReference, referenceOptions)}
      >
        {narrativeLoading && !narrativeSection ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
        <div>
          <span>AI EVIDENCE BRIEF</span>
          <p><GlossaryText text={brief} /></p>
        </div>
        {referenceOptions.selectedKeys.includes(agentReferenceKey(axisReference)) && onAgentAsk && (
          <span className="compare-reference-ask" onClick={(event) => event.stopPropagation()}>
            <ContextualAgentAskButton onAsk={onAgentAsk} />
          </span>
        )}
      </section>

      {axis.id === "earnings_stability" ? (
        <EarningsStabilityView
          points={trendPoints}
          symbols={symbols}
          loading={financialSeriesLoading}
          fallbackMetrics={metrics}
          sourcePanelId={sourcePanelId}
          referenceOptions={referenceOptions}
        />
      ) : axis.id === "relationship" ? (
        <RelationshipPairsView response={response} symbols={symbols} />
      ) : axis.id === "recent_flow" ? (
        <RecentIssuesView response={response} symbols={symbols} />
      ) : axis.id === "business_model" || axis.id === "risk_profile" ? (
        <QualitativeMatrixView rows={qualitativeRows} symbols={symbols} axisTitle={axis.title} />
      ) : (
        <div className="compare-cockpit-metrics is-quantitative">
          {metrics.map((metric) => (
            <QuantitativeMetricRow
              key={metric.id}
              metric={metric}
              sectionId={axis.id}
              symbols={symbols}
              sourcePanelId={sourcePanelId}
              referenceOptions={referenceOptions}
            />
          ))}
          {metrics.length === 0 && (
            <div className="compare-cockpit-no-data">이 분석축에 표시할 비교 근거가 아직 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

function QuantitativeMetricRow({
  metric,
  sectionId,
  symbols,
  sourcePanelId,
  referenceOptions
}: {
  metric: CompanyCompareMetric;
  sectionId: string;
  symbols: string[];
  sourcePanelId?: string;
  referenceOptions: ReferenceOptions;
}) {
  const values = symbols.map((symbol) => metric.values.find((value) => value.symbol === symbol));
  const extent = Math.max(0, ...values.map((value) => Math.abs(value?.value ?? 0)));
  const reference = compareMetricReference({
    symbols,
    sectionId,
    metric: metric.label,
    values: values.map((value, index) => value ?? {
      symbol: symbols[index],
      value: null,
      display: "데이터 없음"
    }),
    asOf: values.map((value) => value?.asOf ?? "").sort().at(-1) || undefined
  }, sourcePanelId);
  const state = referenceStateClass(reference, referenceOptions);
  return (
    <div
      className={`compare-cockpit-metric-row-v2 compare-reference-surface ${state}`}
      aria-label={`${metric.label}: ${symbols.map((symbol, index) => `${symbol} ${values[index]?.display ?? "데이터 없음"}`).join(", ")}`}
      {...referenceSurfaceProps(reference, referenceOptions)}
    >
      <div className="compare-cockpit-metric-heading">
        <strong>{metric.label}</strong>
        <span>{metricCaption(metric.id)}</span>
      </div>
      <div className="compare-cockpit-company-values" style={{ "--company-count": symbols.length } as CSSProperties}>
        {symbols.map((symbol, index) => {
          const value = values[index];
          return (
            <div className="compare-cockpit-company-value" key={symbol}>
              <span><i style={{ "--company-color": companyColor(index) } as CSSProperties} />{symbol}</span>
              <b title={value?.asOf ? `기준 ${value.asOf}` : undefined}>{value?.display ?? "데이터 없음"}</b>
              <div aria-hidden="true">
                <i style={{
                  "--company-color": companyColor(index),
                  "--compare-bar-width": `${barWidth(value?.value ?? null, extent)}%`
                } as CSSProperties} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QualitativeMatrixView({
  rows,
  symbols,
  axisTitle
}: {
  rows: QualitativeMatrixRow[];
  symbols: string[];
  axisTitle: string;
}) {
  if (rows.length === 0) {
    return <div className="compare-cockpit-no-data">비교할 공시 근거가 아직 없습니다.</div>;
  }
  return (
    <div className="compare-cockpit-special-view">
      <div
        className="compare-cockpit-matrix-v2"
        role="table"
        aria-label={`${symbols.join(", ")} ${axisTitle} 비교`}
        style={{ "--company-count": symbols.length } as CSSProperties}
      >
        <div className="compare-cockpit-matrix-row-v2 is-head" role="row">
          <span role="columnheader">비교 항목</span>
          {symbols.map((symbol, index) => (
            <span role="columnheader" key={symbol}>
              <i style={{ "--company-color": companyColor(index) } as CSSProperties} />{symbol}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div className="compare-cockpit-matrix-row-v2" role="row" key={row.label}>
            <strong role="rowheader">{row.label}</strong>
            {symbols.map((symbol) => (
              <span role="cell" data-symbol={symbol} key={symbol}><GlossaryText text={row.values[symbol] ?? "데이터 없음"} /></span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EarningsStabilityView({
  points,
  symbols,
  loading,
  fallbackMetrics,
  sourcePanelId,
  referenceOptions
}: {
  points: AlignedTrendPoint[];
  symbols: string[];
  loading: boolean;
  fallbackMetrics: CompanyCompareMetric[];
  sourcePanelId?: string;
  referenceOptions: ReferenceOptions;
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
            sectionId="earnings_stability"
            symbols={symbols}
            sourcePanelId={sourcePanelId}
            referenceOptions={referenceOptions}
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
          symbols={symbols}
        />
        <TrendLineChart
          title="영업이익률"
          subtitle="분기 누적 공시를 실제 분기값으로 환산"
          metric="operatingMargin"
          points={points}
          symbols={symbols}
        />
      </div>
      <div className="compare-cockpit-trend-note">
        <strong>최근 변화</strong>
        <span>{buildTrendObservation(points, symbols)}</span>
      </div>
    </div>
  );
}

function TrendLineChart({
  title,
  subtitle,
  metric,
  points,
  symbols
}: {
  title: string;
  subtitle: string;
  metric: "revenueGrowth" | "operatingMargin";
  points: AlignedTrendPoint[];
  symbols: string[];
}) {
  const titleId = useId();
  const descriptionId = useId();
  const series = symbols.map((symbol) => points.map((point) => point.values[symbol]?.[metric] ?? null));
  const numericValues = series.flat().filter((value): value is number => Number.isFinite(value ?? NaN));
  const minimum = numericValues.length > 0 ? Math.min(...numericValues) : -0.1;
  const maximum = numericValues.length > 0 ? Math.max(...numericValues) : 0.1;
  const spread = Math.max(maximum - minimum, 0.08);
  const yMinimum = Math.min(0, minimum - spread * 0.16);
  const yMaximum = maximum + spread * 0.16;
  const left = 58;
  const right = 674;
  const top = 22;
  const bottom = 154;
  const xFor = (index: number) => left + (right - left) * index / Math.max(1, points.length - 1);
  const yFor = (value: number) => bottom - (value - yMinimum) / Math.max(0.01, yMaximum - yMinimum) * (bottom - top);
  const ticks = [yMaximum, (yMaximum + yMinimum) / 2, yMinimum];
  const description = points.map((point, pointIndex) => (
    `${point.label} ${symbols.map((symbol, symbolIndex) => `${symbol} ${formatPercent(series[symbolIndex][pointIndex])}`).join(", ")}`
  )).join(". ");
  return (
    <section className="compare-cockpit-trend-block">
      <header className="compare-cockpit-trend-heading">
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <div className="compare-cockpit-trend-legend" aria-label={`${symbols.join(", ")} 범례`}>
          {symbols.map((symbol, index) => (
            <span key={symbol}><i style={{ "--company-color": companyColor(index) } as CSSProperties} />{symbol}</span>
          ))}
        </div>
      </header>
      <svg
        className="compare-cockpit-trend-chart"
        viewBox="0 0 720 192"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{symbols.join(", ")}의 {title}</title>
        <desc id={descriptionId}>{description}</desc>
        <g className="compare-cockpit-chart-grid" aria-hidden="true">
          {ticks.map((tick) => {
            const y = yFor(tick);
            return <g key={tick}><line x1={left} y1={y} x2={right} y2={y} /><text x={left - 10} y={y + 4}>{formatPercent(tick)}</text></g>;
          })}
        </g>
        {series.map((values, symbolIndex) => (
          <g key={symbols[symbolIndex]} aria-hidden="true">
            <path
              className="compare-cockpit-trend-line"
              style={{ stroke: companyColor(symbolIndex) }}
              d={buildLinePath(values, xFor, yFor)}
            />
            {values.map((value, pointIndex) => Number.isFinite(value ?? NaN) && (
              <circle
                key={points[pointIndex].id}
                cx={xFor(pointIndex)}
                cy={yFor(value as number)}
                r="4"
                fill={companyColor(symbolIndex)}
              />
            ))}
          </g>
        ))}
        <g className="compare-cockpit-chart-periods" aria-hidden="true">
          {points.map((point, index) => <text key={point.id} x={xFor(index)} y="184">{point.label}</text>)}
        </g>
      </svg>
    </section>
  );
}

function RelationshipPairsView({ response, symbols }: { response: CompanyCompareResponse; symbols: string[] }) {
  const baseSymbol = symbols[0];
  const relationshipSection = response.qualitative.sections.find((section) => section.id === "relationship");
  const businessSection = response.qualitative.sections.find((section) => section.id === "business_model");
  return (
    <div className="compare-cockpit-pair-grid">
      {symbols.slice(1).map((compareSymbol, index) => {
        const relationItem = findRelationshipItem(relationshipSection?.items ?? [], baseSymbol, compareSymbol);
        const baseBusiness = findBusinessItem(businessSection?.items ?? [], baseSymbol);
        const compareBusiness = findBusinessItem(businessSection?.items ?? [], compareSymbol);
        const relationType = relationItem?.details.find((detail) => detail.startsWith("관계 유형:"))
          ?.replace("관계 유형:", "").trim() || "공통 시장";
        const sharedMarket = relationItem?.details.find((detail) => !detail.startsWith("관계 유형:"))
          ?? relationItem?.title
          ?? "확인된 공통 시장";
        return (
          <article className="compare-cockpit-pair-card" key={compareSymbol}>
            <header>
              <span><i style={{ "--company-color": companyColor(0) } as CSSProperties} />{baseSymbol}</span>
              <b>↔</b>
              <span><i style={{ "--company-color": companyColor(index + 1) } as CSSProperties} />{compareSymbol}</span>
            </header>
            <dl>
              <div><dt>관계 유형</dt><dd><GlossaryText text={relationType} /></dd></div>
              <div><dt>공통 시장</dt><dd><GlossaryText text={sharedMarket} /></dd></div>
              <div><dt>{baseSymbol} 근거</dt><dd><GlossaryText text={plainText(baseBusiness?.summary)} /></dd></div>
              <div><dt>{compareSymbol} 근거</dt><dd><GlossaryText text={plainText(compareBusiness?.summary)} /></dd></div>
              <div><dt>경쟁·협력 근거</dt><dd><GlossaryText text={plainText(relationItem?.summary)} /></dd></div>
            </dl>
          </article>
        );
      })}
      {symbols.length < 2 && <div className="compare-cockpit-no-data">비교 기업을 선택해 주세요.</div>}
    </div>
  );
}

function RecentIssuesView({ response, symbols }: { response: CompanyCompareResponse; symbols: string[] }) {
  const section = response.qualitative.sections.find((item) => item.id === "recent_flow");
  return (
    <div className="compare-cockpit-issue-columns" style={{ "--company-count": symbols.length } as CSSProperties}>
      {symbols.map((symbol, symbolIndex) => {
        const items = findSymbolItems(section?.items ?? [], symbol)
          .sort((left, right) => (right.observedAt ?? "").localeCompare(left.observedAt ?? ""))
          .slice(0, 2);
        return (
          <section key={symbol}>
            <header><i style={{ "--company-color": companyColor(symbolIndex) } as CSSProperties} />{symbol}</header>
            {items.length === 0 && <p className="compare-cockpit-missing">데이터 없음</p>}
            {items.map((item) => {
              const source = response.sources.find((entry) => entry.id === item.sourceRef);
              const url = item.url ?? source?.url ?? null;
              return (
                <article key={`${item.sourceRef}-${item.observedAt ?? ""}`}>
                  <time dateTime={item.observedAt ?? undefined}>{formatObservedDate(item.observedAt)}</time>
                  <b><GlossaryText text={item.title} /></b>
                  <p><GlossaryText text={plainText(item.summary)} /></p>
                  {url
                    ? <a href={url} target="_blank" rel="noreferrer">{source?.label ?? "원문"}</a>
                    : <span>{source?.label ?? "저장 뉴스"}</span>}
                </article>
              );
            })}
          </section>
        );
      })}
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
      <p>상단의 기업 추가 또는 아래의 같은 테마 후보를 사용할 수 있습니다.</p>
      {loading && <span><LoaderCircle size={16} className="spin" /> 비교 후보를 찾고 있습니다</span>}
      {!loading && candidates.length > 0 && (
        <div className="compare-cockpit-candidates" aria-label="온톨로지 비교 후보">
          {candidates.slice(0, 6).map((candidate) => (
            <button type="button" key={candidate.symbol} onClick={() => onSelect(candidate.symbol)}>
              <Building2 size={16} />
              <span><strong>{candidate.symbol}</strong><small>{candidate.companyName ?? candidate.themes.join(" · ")}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCompareSkeleton({ symbols }: { symbols: string[] }) {
  return (
    <div className="compare-cockpit-skeleton" role="status" aria-label="기업 비교 근거를 불러오는 중">
      <span><LoaderCircle size={17} className="spin" /> {symbols.join(", ")} 근거를 불러오고 있습니다</span>
      {[0, 1, 2].map((index) => <i key={index} />)}
    </div>
  );
}

function buildQualitativeRows(
  section: CompanyCompareQualitativeSection,
  symbols: string[]
): QualitativeMatrixRow[] {
  if (section.id === "business_model") {
    const items = Object.fromEntries(symbols.map((symbol) => [symbol, findBusinessItem(section.items, symbol)]));
    return [
      matrixRow("사업 모델", symbols, (symbol) => plainText(items[symbol]?.summary)),
      matrixRow("핵심 동력", symbols, (symbol) => plainText(items[symbol]?.details[0])),
      matrixRow("시장 맥락", symbols, (symbol) => plainText(items[symbol]?.details[1] ?? items[symbol]?.details.at(-1)))
    ];
  }
  if (section.id === "risk_profile") {
    const categories = ["기술 변화", "경쟁 환경", "공급망"];
    return categories.map((category, index) => matrixRow(category, symbols, (symbol) => {
      const items = findSymbolItems(section.items, symbol);
      const matched = items.find((item) => normalizeRiskLabel(item.title) === category) ?? items[index];
      return plainText(matched?.summary);
    }));
  }
  return [];
}

function matrixRow(
  label: string,
  symbols: string[],
  valueFor: (symbol: string) => string
): QualitativeMatrixRow {
  return { label, values: Object.fromEntries(symbols.map((symbol) => [symbol, valueFor(symbol)])) };
}

function buildAlignedTrendPoints(
  financialSeriesBySymbol: FinancialSeriesBySymbol,
  symbols: string[]
): AlignedTrendPoint[] {
  const bySymbol = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    buildCompanyTrendPoints(financialSeriesBySymbol[symbol] ?? []).slice(-4)
  ]));
  const count = Math.max(0, ...symbols.map((symbol) => bySymbol[symbol].length));
  return Array.from({ length: count }, (_, index) => {
    const dates: string[] = [];
    const values: AlignedTrendPoint["values"] = {};
    symbols.forEach((symbol) => {
      const series = bySymbol[symbol];
      const point = series[series.length - count + index];
      if (point?.periodEndDate) dates.push(point.periodEndDate);
      values[symbol] = {
        revenueGrowth: point?.revenueGrowth ?? null,
        operatingMargin: point?.operatingMargin ?? null
      };
    });
    return {
      id: `${index}-${dates.join("-")}`,
      label: formatDateRange(dates),
      values
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
  const quarters: StandaloneQuarter[] = [];
  ordered.forEach((point) => {
    const match = point.period.toUpperCase().match(/^(\d{4})Q([1-4])$/);
    if (!match || !Number.isFinite(point.revenue ?? NaN) || !Number.isFinite(point.operatingIncome ?? NaN)) return;
    const fiscalYear = Number(match[1]);
    const fiscalQuarter = Number(match[2]);
    const revenue = point.revenue as number;
    const operatingIncome = point.operatingIncome as number;
    if (revenue <= 0) return;
    quarters.push({
      fiscalYear,
      fiscalQuarter,
      period: point.period.toUpperCase(),
      periodEndDate: point.periodEndDate ?? "",
      revenue,
      operatingIncome
    });
  });
  const indexed = new Map(quarters.map((point) => [`${point.fiscalYear}Q${point.fiscalQuarter}`, point]));
  return quarters.map((point) => {
    const previous = indexed.get(`${point.fiscalYear - 1}Q${point.fiscalQuarter}`);
    return {
      period: point.period,
      periodEndDate: point.periodEndDate,
      revenueGrowth: previous && previous.revenue > 0 ? point.revenue / previous.revenue - 1 : null,
      operatingMargin: point.operatingIncome / point.revenue
    };
  }).filter((point) => Number.isFinite(point.operatingMargin));
}

function validateNarrativeCoverage(
  response: CompanyCompareResponse,
  symbols: string[]
): CompanyCompareResponse {
  if (response.narrative.status !== "ready") return response;
  const text = [
    response.narrative.summary,
    ...response.narrative.sections.map((section) => section.analysis)
  ].join(" ").toUpperCase();
  const missing = symbols.filter((symbol) => !text.includes(symbol));
  if (missing.length === 0) return response;
  return {
    ...response,
    narrative: {
      ...response.narrative,
      status: "failed",
      validationWarnings: [
        ...(response.narrative.validationWarnings ?? []),
        `missing compared symbols: ${missing.join(",")}`
      ]
    }
  };
}

function referenceSurfaceProps(reference: AgentReference, options: ReferenceOptions) {
  if (!options.onSelect) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": options.selectedKeys.includes(agentReferenceKey(reference)),
    draggable: true,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if ((event.target as Element).closest(".glossary-term, button, a")) return;
      options.onSelect?.(reference);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if ((event.target as Element).closest(".glossary-term")) return;
      event.preventDefault();
      options.onSelect?.(reference);
    },
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-gops-agent-reference", JSON.stringify(reference));
      if (!options.selectedKeys.includes(agentReferenceKey(reference))) {
        options.onSelect?.(reference);
      }
    }
  };
}

function referenceStateClass(reference: AgentReference, options: ReferenceOptions): string {
  const key = agentReferenceKey(reference);
  return [
    options.selectedKeys.includes(key) ? "is-agent-reference-selected" : "",
    options.emphasizedKeys.includes(key) ? "is-agent-reference-emphasized" : ""
  ].filter(Boolean).join(" ");
}

function handleAxisKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  axisIndex: number,
  onSelect: (id: CompanyCompareSectionId) => void
) {
  let nextIndex = axisIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (axisIndex + 1) % AXES.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (axisIndex - 1 + AXES.length) % AXES.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = AXES.length - 1;
  else return;
  event.preventDefault();
  onSelect(AXES[nextIndex].id);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus();
}

function selectMetrics(response: CompanyCompareResponse, axisId: CompanyCompareSectionId): CompanyCompareMetric[] {
  const section = response.quantitative.sections.find((item) => item.id === axisId);
  if (!section) return [];
  const selected = (METRIC_PRIORITY[axisId] ?? [])
    .map((metricId) => section.metrics.find((metric) => metric.id === metricId))
    .filter((metric): metric is CompanyCompareMetric => Boolean(metric));
  return (selected.length > 0 ? selected : section.metrics).slice(0, 3);
}

function metricCaption(metricId: string): string {
  const captions: Record<string, string> = {
    revenue_growth_yoy: "전년 동기 대비",
    operating_income_growth_yoy: "전년 동기 대비",
    net_income_growth_yoy: "전년 동기 대비",
    net_margin: "매출 대비 순이익",
    operating_margin: "매출 대비 영업이익",
    roe: "자기자본 수익성",
    total_debt_to_assets: "낮을수록 부채 부담이 작음",
    current_ratio: "단기 지급 여력",
    free_cash_flow: "최근 공시 기준",
    eps_surprise_mean: "최근 실적 발표 기준",
    eps_surprise_volatility: "낮을수록 변동성이 작음",
    eps_beat_rate: "시장 예상 상회 비율"
  };
  return captions[metricId] ?? "같은 기준으로 비교";
}

function formatSourceCount(
  metrics: CompanyCompareMetric[],
  section?: CompanyCompareQualitativeSection
): string {
  const refs = new Set([
    ...metrics.flatMap((metric) => metric.values.map((value) => value.sourceRef).filter(Boolean)),
    ...(section?.evidenceRefs ?? [])
  ]);
  return refs.size > 0 ? `${refs.size} sources` : "근거 준비 중";
}

function findBusinessItem(items: CompanyCompareQualitativeItem[], symbol: string) {
  return items.find((item) => item.kind === "10k-business" && normalizeCompanySymbol(item.symbol) === symbol);
}

function findRelationshipItem(
  items: CompanyCompareQualitativeItem[],
  baseSymbol: string,
  compareSymbol: string
) {
  return items.find((item) => {
    const itemSymbols = splitItemSymbols(item.symbol);
    return itemSymbols.includes(baseSymbol) && itemSymbols.includes(compareSymbol);
  }) ?? items.find((item) => item.kind === "ontology-relationship") ?? items[0];
}

function findSymbolItems(items: CompanyCompareQualitativeItem[], symbol: string) {
  return items.filter((item) => splitItemSymbols(item.symbol).includes(symbol));
}

function splitItemSymbols(value: string | null | undefined): string[] {
  return (value ?? "").split(/[·,×/]/).map(normalizeCompanySymbol).filter(Boolean);
}

function normalizeRiskLabel(value: string): string {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (normalized.includes("기술변화") || normalized.includes("기술표준")) return "기술 변화";
  if (normalized.includes("경쟁")) return "경쟁 환경";
  if (normalized.includes("공급")) return "공급망";
  return value;
}

function plainText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() || "데이터 없음";
}

function companyColor(index: number): string {
  return COMPANY_COLORS[index] ?? COMPANY_COLORS[COMPANY_COLORS.length - 1];
}

function barWidth(value: number | null, extent: number): number {
  if (value === null || extent === 0) return 0;
  if (value === 0) return 2;
  return Math.max(4, Math.abs(value) / extent * 100);
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

function buildTrendObservation(points: AlignedTrendPoint[], symbols: string[]): string {
  const latest = points.at(-1);
  if (!latest) return "비교 가능한 발표 분기 근거가 없습니다.";
  return symbols.map((symbol) => {
    const value = latest.values[symbol];
    return `${symbol} 매출 성장률 ${formatPercent(value?.revenueGrowth)}, 영업이익률 ${formatPercent(value?.operatingMargin)}`;
  }).join(" · ");
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "데이터 없음";
  const percent = (value as number) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(Math.abs(percent) >= 100 ? 0 : 1)}%`;
}

function formatDateRange(values: string[]): string {
  const dates = values.map((value) => value.match(/^(\d{4})-(\d{2})/)?.slice(1)).filter(Boolean) as string[][];
  if (dates.length === 0) return "공시 분기";
  const labels = dates.map(([year, month]) => `${year}.${month}`).sort();
  return labels[0] === labels.at(-1) ? labels[0] : `${labels[0]}–${labels.at(-1)}`;
}

function formatObservedDate(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "날짜 없음";
}

export default CompanyComparePanel;
