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
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import type { ChartSymbolDto } from "../chart/types";
import { SymbolSearch } from "../components/SymbolSearch";
import { GlossaryText } from "../glossary/GlossaryText";
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
  narrativeFailed
}: {
  axis: AxisMeta;
  response: CompanyCompareResponse;
  baseSymbol: string;
  compareSymbol: string;
  narrativeLoading: boolean;
  narrativeFailed: boolean;
}) {
  const quantitative = QUANTITATIVE_AXIS_IDS.has(axis.id);
  const metrics = quantitative ? selectMetrics(response, axis.id) : [];
  const qualitativeSection = quantitative
    ? undefined
    : response.qualitative.sections.find((section) => section.id === axis.id);
  const qualitativeRows = qualitativeSection
    ? buildQualitativeRows(qualitativeSection, baseSymbol, compareSymbol)
    : [];
  const sourceCount = quantitative
    ? countMetricSources(metrics)
    : qualitativeSection?.evidenceRefs.length ?? 0;
  const narrative = response.narrative.sections.find((section) => section.id === axis.id)?.analysis;
  const brief = narrative
    ? compactCompleteBrief(narrative)
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
        <span className="compare-cockpit-source-count">{formatSourceCount(axis.id, sourceCount)}</span>
      </header>

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

      <footer className="compare-cockpit-brief">
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
      </footer>
    </div>
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
        label: "사업 모델",
        baseValue: compactText(baseItem?.summary),
        compareValue: compactText(compareItem?.summary)
      },
      {
        label: "핵심 동력",
        baseValue: compactText(baseItem?.details[0]),
        compareValue: compactText(compareItem?.details[0])
      },
      {
        label: "시장 맥락",
        baseValue: compactText(baseItem?.details[1] ?? sharedItem?.summary),
        compareValue: compactText(compareItem?.details[1] ?? sharedItem?.summary)
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
      label,
      baseValue: compactText(section.id === "recent_flow" ? baseItem?.title : baseItem?.summary),
      compareValue: compactText(section.id === "recent_flow" ? compareItem?.title : compareItem?.summary)
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

function compactText(value: string | null | undefined, maxLength = 42): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return "근거 없음";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
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
