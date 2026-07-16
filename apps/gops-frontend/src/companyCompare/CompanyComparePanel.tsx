import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  CircleCheck,
  Database,
  FileText,
  GitBranch,
  LoaderCircle,
  Plus,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  requestCompanyCompare,
  requestCompanyCompareCandidates,
  requestCompanyCompareQuantitative,
  type CompanyCompareCandidate,
  type CompanyCompareGrowthChart,
  type CompanyCompareQualitativeItem,
  type CompanyCompareQualitativeSection,
  type CompanyCompareResponse,
  type CompanyCompareSection,
  type CompanyCompareSectionId
} from "./companyCompareApi";

type CompanyComparePanelProps = {
  baseSymbol: string;
  compareSymbols: string[];
  symbolOptions: string[];
  onCompareSymbolsChange: (symbols: string[]) => void;
};

const REQUEST_DEBOUNCE_MS = 400;
const MAX_COMPARE_SYMBOLS = 3;
const SERIES_COLORS = ["#9a8cff", "#38d1bb", "#f0ae54", "#ee7e9b"];
const SECTION_META: Record<CompanyCompareSectionId, { index: string; label: string }> = {
  growth_style: { index: "01", label: "GROWTH" },
  profit_structure: { index: "02", label: "PROFIT" },
  financial_health: { index: "03", label: "HEALTH" },
  earnings_stability: { index: "04", label: "EARNINGS" },
  business_model: { index: "05", label: "BUSINESS" },
  risk_profile: { index: "06", label: "RISK" },
  relationship: { index: "07", label: "RELATION" },
  recent_flow: { index: "08", label: "FLOW" }
};

export function CompanyComparePanel({
  baseSymbol,
  compareSymbols,
  symbolOptions,
  onCompareSymbolsChange
}: CompanyComparePanelProps) {
  const normalizedBase = normalizeSymbol(baseSymbol);
  const normalizedCompare = useMemo(
    () => normalizeCompareSymbols(compareSymbols, normalizedBase),
    [compareSymbols, normalizedBase]
  );
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
    if (!normalizedBase || normalizedCompare.length === 0) {
      setResponse(null);
      setQuantitativeLoading(false);
      setNarrativeLoading(false);
      setError(null);
      setNarrativeFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const input = { baseSymbol: normalizedBase, compareSymbols: normalizedCompare };
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
  }, [normalizedBase, normalizedCompare.join("|")]);

  const availableOptions = useMemo(() => {
    const blocked = new Set([normalizedBase, ...normalizedCompare]);
    return Array.from(new Set(symbolOptions.map(normalizeSymbol)))
      .filter((symbol) => symbol && !blocked.has(symbol))
      .sort();
  }, [normalizedBase, normalizedCompare, symbolOptions]);

  const addSymbol = (symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || normalized === normalizedBase || normalizedCompare.includes(normalized)) return;
    onCompareSymbolsChange([...normalizedCompare, normalized].slice(0, MAX_COMPARE_SYMBOLS));
  };
  const removeSymbol = (symbol: string) => {
    onCompareSymbolsChange(normalizedCompare.filter((item) => item !== symbol));
  };

  return (
    <section className="company-compare-panel" aria-label="기업 성향 비교">
      <header className="company-compare-hero">
        <div className="company-compare-hero-copy">
          <span className="company-compare-eyebrow"><Sparkles size={12} /> Evidence comparison</span>
          <div className="company-compare-title-row">
            <h2>기업 성향 비교</h2>
            <span>8개 분석축</span>
          </div>
          <p>재무·10-K·온톨로지·뉴스 근거를 나란히 읽습니다. 점수나 판정은 만들지 않습니다.</p>
        </div>
        <div className="company-compare-controls">
          <div className="company-compare-pair" aria-label="비교 기업">
            <span className="company-compare-base-chip">{normalizedBase || "기업"}<small>BASE</small></span>
            <span className="company-compare-versus">×</span>
            {normalizedCompare.map((symbol) => (
              <span className="company-compare-selected-chip" key={symbol}>
                {symbol}
                <button type="button" aria-label={`${symbol} 비교에서 제거`} onClick={() => removeSymbol(symbol)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          {normalizedCompare.length < MAX_COMPARE_SYMBOLS && (
            <label className="company-compare-direct-select">
              <Plus size={13} aria-hidden="true" />
              <select value="" onChange={(event) => addSymbol(event.target.value)} aria-label="비교 기업 직접 선택">
                <option value="">기업 추가</option>
                {availableOptions.map((symbol) => <option value={symbol} key={symbol}>{symbol}</option>)}
              </select>
            </label>
          )}
        </div>
      </header>

      {normalizedCompare.length === 0 && (
        <CompanyCompareEmptyState
          baseSymbol={normalizedBase}
          candidates={candidates}
          loading={candidateLoading}
          onSelect={addSymbol}
        />
      )}

      {normalizedCompare.length > 0 && (
        <div className="company-compare-layers">
          <section className="company-compare-quantitative-layer" aria-label="비교 근거">
            {quantitativeLoading && !response && <CompanyCompareSkeleton symbols={[normalizedBase, ...normalizedCompare]} />}
            {!quantitativeLoading && error && !response && (
              <div className="company-compare-error" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}
            {response && <EvidenceComparison response={response} />}
          </section>

          <section className="company-compare-narrative-layer" aria-label="AI 근거 해석">
            <NarrativeComparison
              response={response}
              loading={narrativeLoading}
              failed={narrativeFailed || Boolean(error)}
            />
          </section>
        </div>
      )}
    </section>
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
    <div className="company-compare-empty">
      <div className="company-compare-empty-mark"><Building2 size={28} /></div>
      <span className="company-compare-eyebrow">Start a comparison</span>
      <h3>{baseSymbol}와 비교할 기업을 선택하세요</h3>
      <p>같은 산업 안에서도 성장 방식과 수익 구조, 사업 위험은 다르게 나타납니다.</p>
      <div className="company-compare-empty-preview" aria-label="비교 분석 범위">
        <span><Activity size={14} /> 성장·수익</span>
        <span><Database size={14} /> 재무 건전성</span>
        <span><FileText size={14} /> 10-K 사업·위험</span>
        <span><GitBranch size={14} /> 관계·최근 흐름</span>
      </div>
      {loading && <span className="company-compare-inline-loading"><LoaderCircle size={14} className="spin" /> 비교 후보를 찾고 있습니다</span>}
      {!loading && candidates.length > 0 && (
        <div className="company-compare-candidates" aria-label="온톨로지 비교 후보">
          {candidates.slice(0, 8).map((candidate) => (
            <button type="button" key={candidate.symbol} onClick={() => onSelect(candidate.symbol)}>
              <span><strong>{candidate.symbol}</strong><ArrowRight size={14} /></span>
              <small>{candidate.themes.slice(0, 2).join(" · ") || "같은 테마"}</small>
            </button>
          ))}
          {candidates.length > 8 && <small className="company-compare-candidate-more">외 {candidates.length - 8}개 · 기업 추가에서 선택</small>}
        </div>
      )}
      {!loading && candidates.length === 0 && (
        <span className="company-compare-empty-hint">같은 테마 후보가 없습니다. 우측 상단의 ‘기업 추가’에서 직접 선택할 수 있습니다.</span>
      )}
    </div>
  );
}

function EvidenceComparison({ response }: { response: CompanyCompareResponse }) {
  const sourceById = new Map(response.sources.map((source) => [source.id, formatSourceLabel(source)]));
  const sourceDates = response.sources.map((source) => source.asOf?.slice(0, 10) ?? "").filter(Boolean).sort();
  const latestAsOf = sourceDates[sourceDates.length - 1];
  return (
    <>
      <div className="company-compare-status-strip">
        <span className={`company-compare-data-status is-${response.status}`}>
          <CircleCheck size={13} /> {response.status === "ready" ? "8개 분석축 준비됨" : "일부 데이터 공백"}
        </span>
        <span>{response.sources.length}개 근거 출처</span>
        {latestAsOf && <span>최근 기준 {latestAsOf}</span>}
        <span>생성 주체 · {response.createdByAgentId}</span>
      </div>

      <AnalysisGroupHeader
        kicker="QUANTITATIVE · 01—04"
        title="숫자로 확인하는 기업의 작동 방식"
        description="동일한 지표를 같은 단위로 배치합니다. 크거나 작은 값에 의미를 임의로 부여하지 않습니다."
        icon={<Activity size={17} />}
      />
      <div className={`company-compare-overview-grid${response.quantitative.alignedFacts.length === 0 ? " is-single" : ""}`}>
        <GrowthComparisonChart chart={response.quantitative.growthChart} />
        {response.quantitative.alignedFacts.length > 0 && <AlignedFactsTable response={response} />}
      </div>
      <div className="company-compare-section-grid">
        {response.quantitative.sections.map((section) => (
          <MetricSection key={section.id} section={section} symbols={response.comparedSymbols} sourceById={sourceById} />
        ))}
      </div>

      {response.qualitative?.sections?.length > 0 && (
        <QualitativeEvidence response={response} sections={response.qualitative.sections} />
      )}

      <EvidenceFooter response={response} />
    </>
  );
}

function AnalysisGroupHeader({
  kicker,
  title,
  description,
  icon
}: {
  kicker: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="company-compare-group-header">
      <div className="company-compare-group-icon">{icon}</div>
      <div>
        <span>{kicker}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function QualitativeEvidence({
  response,
  sections
}: {
  response: CompanyCompareResponse;
  sections: CompanyCompareQualitativeSection[];
}) {
  const sourceById = new Map(response.sources.map((source) => [source.id, `${source.symbol} · ${source.label}`]));
  return (
    <section className="company-compare-qualitative" aria-label="공시와 맥락 비교">
      <AnalysisGroupHeader
        kicker="CONTEXT · 05—08"
        title="공시와 관계에서 읽는 사업의 맥락"
        description="10-K 원문, 기업 관계 그래프, 저장된 최근 뉴스를 사실 단위로 보여줍니다."
        icon={<FileText size={17} />}
      />
      <div className="company-compare-qualitative-grid">
        {sections.map((section) => {
          const meta = SECTION_META[section.id];
          return (
            <article className="company-compare-qualitative-card" key={section.id}>
              <CardHeading meta={meta} title={section.heading} sourceCount={section.evidenceRefs.length} />
              <EvidenceItems items={section.items} sourceById={sourceById} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceItems({
  items,
  sourceById
}: {
  items: CompanyCompareQualitativeItem[];
  sourceById: Map<string, string>;
}) {
  const visibleItems = items.slice(0, 3);
  const remainingItems = items.slice(3);
  return (
    <div className="company-compare-qualitative-items">
      {visibleItems.map((item, index) => <EvidenceItem key={`${item.sourceRef}-${index}`} item={item} sourceById={sourceById} />)}
      {remainingItems.length > 0 && (
        <details className="company-compare-more-evidence">
          <summary>{remainingItems.length}개 근거 더 보기</summary>
          {remainingItems.map((item, index) => <EvidenceItem key={`${item.sourceRef}-more-${index}`} item={item} sourceById={sourceById} />)}
        </details>
      )}
    </div>
  );
}

function EvidenceItem({
  item,
  sourceById
}: {
  item: CompanyCompareQualitativeItem;
  sourceById: Map<string, string>;
}) {
  return (
    <div className={`company-compare-qualitative-item is-${item.kind}`}>
      <div className="company-compare-evidence-title">
        {item.symbol && <span>{item.symbol}</span>}
        <strong>{item.title}</strong>
      </div>
      <p>{item.summary}</p>
      {item.details.length > 0 && (
        <ul>{item.details.slice(0, 3).map((detail) => <li key={detail}>{detail}</li>)}</ul>
      )}
      <small>{sourceById.get(item.sourceRef) ?? fallbackEvidenceLabel(item.sourceRef)}</small>
    </div>
  );
}

function NarrativeComparison({
  response,
  loading,
  failed
}: {
  response: CompanyCompareResponse | null;
  loading: boolean;
  failed: boolean;
}) {
  const narrative = response?.narrative;
  const ready = narrative?.status === "ready";
  const cacheHit = ready && narrative?.cache?.status === "hit";
  const layerState = ready ? "ready" : loading ? "loading" : failed || narrative?.status === "failed" ? "failed" : "idle";
  const sourceById = new Map((response?.sources ?? []).map((source) => [source.id, `${source.symbol} · ${source.label}`]));
  const narrativeSections = [...(narrative?.sections ?? [])].sort((left, right) => (
    Number(SECTION_META[left.id].index) - Number(SECTION_META[right.id].index)
  ));
  return (
    <>
      <AnalysisGroupHeader
        kicker="AI EVIDENCE BRIEF"
        title="근거를 연결한 성향 해석"
        description="계산은 서버가 끝냈고, AI는 위의 사실을 읽기 쉬운 문장으로만 연결합니다."
        icon={<Sparkles size={17} />}
      />
      <span className={`company-compare-layer-badge is-${layerState}`}>
        {cacheHit ? "검증된 캐시 응답" : ready ? "근거 검증 완료" : loading ? "해석 구성 중" : failed || narrative?.status === "failed" ? "근거 데이터만 표시" : "해석 대기"}
      </span>
      {loading && (
        <div className="company-compare-narrative-loading">
          <LoaderCircle size={18} className="spin" />
          <div><strong>8개 분석축을 연결하고 있습니다</strong><span>정량 데이터는 먼저 확인할 수 있습니다.</span></div>
        </div>
      )}
      {!loading && ready && narrative && (
        <div className="company-compare-narrative-content">
          <div className="company-compare-narrative-lead">
            <span>SUMMARY</span>
            <p>{narrative.summary}</p>
          </div>
          {narrative.insights.length > 0 && (
            <div className="company-compare-insights">
              {narrative.insights.map((insight, index) => (
                <span key={insight}><small>{String(index + 1).padStart(2, "0")}</small>{insight}</span>
              ))}
            </div>
          )}
          <div className="company-compare-narrative-grid">
            {narrativeSections.map((section, index) => {
              const meta = SECTION_META[section.id];
              return (
                <details key={section.id} open={index < 2}>
                  <summary>
                    <span className="company-compare-axis-number">{meta.index}</span>
                    <span><small>{meta.label}</small><strong>{section.heading}</strong></span>
                    <Plus size={14} />
                  </summary>
                  <p>{section.analysis}</p>
                  {section.evidenceRefs.length > 0 && (
                    <div className="company-compare-evidence-refs">
                      {section.evidenceRefs.map((reference) => (
                        <span key={reference}>{sourceById.get(reference) ?? fallbackEvidenceLabel(reference)}</span>
                      ))}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
          <small className="company-compare-information-notice">정보성 분석이며 투자 판단을 대신하지 않습니다.</small>
        </div>
      )}
      {!loading && !ready && (
        <p className="company-compare-narrative-state">
          {narrative?.dataGaps?.[0] ?? "근거 데이터는 정상 표시되며 AI 해석은 현재 사용할 수 없습니다."}
        </p>
      )}
    </>
  );
}

function GrowthComparisonChart({ chart }: { chart: CompanyCompareGrowthChart }) {
  const width = 720;
  const labelWidth = 150;
  const chartWidth = 520;
  const zeroX = labelWidth + chartWidth / 2;
  const groupHeight = Math.max(60, chart.series.length * 15 + 24);
  const height = Math.max(116, chart.categories.length * groupHeight + 26);
  if (chart.categories.length === 0) return null;
  return (
    <article className="company-compare-growth-chart">
      <div className="company-compare-chart-heading">
        <div><span>OVERVIEW</span><strong>최근 성장률</strong></div>
        <div className="company-compare-chart-legend">
          {chart.series.map((series, index) => (
            <span key={series.symbol}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{series.symbol}</span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="기업별 전년 대비 성장률 막대 차트">
        <line x1={zeroX} x2={zeroX} y1={8} y2={height - 8} className="company-compare-zero-axis" />
        {chart.categories.map((category, categoryIndex) => {
          const baseY = categoryIndex * groupHeight + 26;
          return (
            <g key={category.id}>
              <text x={0} y={baseY + 7} className="company-compare-chart-label">{category.label}</text>
              {chart.series.map((series, seriesIndex) => {
                const point = series.values[categoryIndex];
                const percent = (point?.value ?? 0) * 100;
                const categoryExtent = Math.max(10, ...chart.series.map((item) => (
                  Math.abs((item.values[categoryIndex]?.value ?? 0) * 100)
                )));
                const barWidth = Math.abs(percent) / categoryExtent * (chartWidth / 2 - 42);
                const x = percent >= 0 ? zeroX : zeroX - barWidth;
                const y = baseY + seriesIndex * 15 - 6;
                return (
                  <g key={series.symbol}>
                    <rect x={x} y={y} width={barWidth} height={10} rx={5} fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}>
                      <title>{`${series.symbol} ${category.label}: ${point?.display ?? "데이터 없음"}`}</title>
                    </rect>
                    <text
                      x={percent >= 0 ? x + barWidth + 6 : x - 6}
                      y={y + 9}
                      textAnchor={percent >= 0 ? "start" : "end"}
                      className="company-compare-chart-value"
                    >
                      {point?.display ?? "-"}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <small className="company-compare-scale-note">각 지표는 해당 행의 최대 절대값을 기준으로 표시합니다.</small>
    </article>
  );
}

function AlignedFactsTable({ response }: { response: CompanyCompareResponse }) {
  return (
    <article className="company-compare-table-card company-compare-aligned-card">
      <div className="company-compare-table-heading">
        <div><span>ALIGNED FACTS</span><strong>동일 회계기간 규모</strong></div>
        <small>{response.quantitative.periodAlignment.framePeriods.join(", ")}</small>
      </div>
      <table>
        <thead><tr><th>지표</th>{response.comparedSymbols.map((symbol) => <th key={symbol}>{symbol}</th>)}</tr></thead>
        <tbody>
          {response.quantitative.alignedFacts.map((fact) => (
            <tr key={fact.id}>
              <th>{fact.label}<small>{fact.framePeriod}</small></th>
              {response.comparedSymbols.map((symbol) => (
                <td key={symbol}>{fact.values.find((value) => value.symbol === symbol)?.display ?? "데이터 없음"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="company-compare-provider-note">SEC frames</span>
    </article>
  );
}

function MetricSection({
  section,
  symbols,
  sourceById
}: {
  section: CompanyCompareSection;
  symbols: string[];
  sourceById: Map<string, string>;
}) {
  const sourceRefs = Array.from(new Set(
    section.metrics.flatMap((metric) => metric.values.map((value) => value.sourceRef).filter((value): value is string => Boolean(value)))
  ));
  const meta = SECTION_META[section.id];
  return (
    <article className="company-compare-table-card">
      <CardHeading meta={meta} title={section.heading} sourceCount={sourceRefs.length} />
      <table>
        <thead><tr><th>지표</th>{symbols.map((symbol) => <th key={symbol}>{symbol}</th>)}</tr></thead>
        <tbody>
          {section.metrics.map((metric) => (
            <tr key={metric.id}>
              <th>{metric.label}</th>
              {symbols.map((symbol) => {
                const value = metric.values.find((item) => item.symbol === symbol);
                return <td key={symbol} title={value?.asOf ? `기준 ${value.asOf}` : undefined}>{value?.display ?? "데이터 없음"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sourceRefs.length > 0 && (
        <div className="company-compare-source-line">
          {sourceRefs.map((reference) => <span key={reference}>{sourceById.get(reference) ?? fallbackEvidenceLabel(reference)}</span>)}
        </div>
      )}
    </article>
  );
}

function CardHeading({
  meta,
  title,
  sourceCount
}: {
  meta: { index: string; label: string };
  title: string;
  sourceCount: number;
}) {
  return (
    <div className="company-compare-table-heading">
      <span className="company-compare-axis-number">{meta.index}</span>
      <div><span>{meta.label}</span><strong>{title}</strong></div>
      <small>{sourceCount} sources</small>
    </div>
  );
}

function EvidenceFooter({ response }: { response: CompanyCompareResponse }) {
  return (
    <footer className="company-compare-sources">
      <details>
        <summary><Database size={14} /> 전체 출처 {response.sources.length}개</summary>
        <div className="company-compare-source-list" aria-label="기업 비교 전체 출처">
          {response.sources.map((source) => <span key={source.id}>{formatSourceLabel(source)}</span>)}
        </div>
      </details>
      {response.dataGaps.length > 0 && (
        <details>
          <summary><AlertCircle size={14} /> 데이터 공백 {response.dataGaps.length}건</summary>
          <ul>{response.dataGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
        </details>
      )}
    </footer>
  );
}

function CompanyCompareSkeleton({ symbols }: { symbols: string[] }) {
  const style = { "--compare-columns": symbols.length } as CSSProperties;
  return (
    <div className="company-compare-skeleton" role="status" aria-label="기업 비교 근거를 불러오는 중" style={style}>
      <span><LoaderCircle size={16} className="spin" /> 재무·공시 근거를 불러오고 있습니다</span>
      <div className="company-compare-skeleton-chart" />
      <div className="company-compare-skeleton-grid">
        {[0, 1, 2, 3].map((index) => <div key={index} />)}
      </div>
    </div>
  );
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

function fallbackEvidenceLabel(reference: string): string {
  const [provider, symbol] = reference.split(":", 2);
  if (provider === "financial" && symbol) return `${symbol} · SEC companyfacts`;
  if (provider === "earnings" && symbol) return `${symbol} · 실적 컨센서스`;
  if (provider === "tenk" && symbol) return `${symbol} · 10-K 프로파일`;
  if (provider === "ontology") return "GraphDB · 기업 관계";
  if (provider === "news" && symbol) return `${symbol} · 저장 뉴스`;
  return reference;
}

function formatSourceLabel(source: CompanyCompareResponse["sources"][number]): string {
  const asOf = source.asOf ? ` · ${source.asOf.slice(0, 10)}` : "";
  return `${source.symbol} · ${source.label}${asOf}`;
}

export default CompanyComparePanel;
