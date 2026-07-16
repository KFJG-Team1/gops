import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  RefreshCcw,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StockLogo } from "../components/StockLogo";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { latestSimulatorStatus, simulatorStatusEvent, type SimulatorStatus } from "../simulator/simulatorApi";
import {
  fetchStockRecommendations,
  type StockRecommendationItem,
  type StockRecommendationPayload
} from "./recommendationApi";
import type { StockRecommendationSelection } from "./StockRecommendationsPanel";
import styles from "./StockRecommendationExplainPanel.module.css";

const companyNameBySymbol = new Map(
  sp500UniverseSeed.map((item) => [item.symbol.toUpperCase(), item.companyName])
);

type MetricView = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "neutral" | "caution";
};

export function StockRecommendationExplainPanel({
  preferredSymbol,
  selection
}: {
  preferredSymbol?: string | null;
  selection?: StockRecommendationSelection | null;
}) {
  const [payload, setPayload] = useState<StockRecommendationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus | null>(() => latestSimulatorStatus());
  const simulatorPhaseRef = useRef("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      setPayload(await fetchStockRecommendations("regular", signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "추천 해설을 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<SimulatorStatus>).detail;
      setSimulatorStatus(status);
      const key = `${status.mode}:${status.runId ?? ""}:${status.phase ?? ""}`;
      if (key === simulatorPhaseRef.current) return;
      simulatorPhaseRef.current = key;
      void load();
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, [load]);

  const preferred = preferredSymbol?.trim().toUpperCase();
  const item = useMemo(() => {
    if (selection) {
      return selection.item;
    }
    const items = payload?.items ?? [];
    return items.find((candidate) => candidate.symbol === preferred)
      ?? items[0]
      ?? null;
  }, [payload?.items, preferred, selection]);
  const displayPayload = selection?.payload ?? payload;

  if (loading && !selection) {
    return <PanelState icon={<Activity size={16} />} message="추천 근거를 정리하고 있습니다" />;
  }

  if (error && !selection) {
    return <PanelState icon={<AlertTriangle size={16} />} message={error} tone="error" onRetry={() => void load()} />;
  }

  if (!item) {
    return (
      <PanelState
        icon={<AlertTriangle size={16} />}
        message={simulatorStatus?.mode === "simulation"
          ? `${simulatorStatus.scenarioTitle ?? "실데이터 리플레이"} · ${emptyMessage(displayPayload)}`
          : emptyMessage(displayPayload)}
        onRetry={() => void load()}
      />
    );
  }

  const companyName = companyNameBySymbol.get(item.symbol) ?? item.symbol;
  const score = clamp(item.score, 0, 100);
  const confidence = normalizeConfidence(item.confidence);
  const metrics = buildMetricViews(item);
  const generatedAt = formatTimestamp(displayPayload?.generatedAt ?? displayPayload?.slotStart);
  const v3 = item.algorithmVersion === "deterministic-evidence-v3" ? item.explanation : undefined;

  return (
    <section className={styles.panel} aria-label={`${item.symbol} 추천 해설`}>
      {simulatorStatus?.mode === "simulation" && (
        <div className={styles.replayBanner}>
          <strong>{simulatorStatus.scenarioTitle ?? "실데이터 리플레이"}</strong>
          <span>기준 시각 {formatTimestamp(simulatorStatus.activeCutoff ?? undefined)}</span>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.identity}>
          <StockLogo symbol={item.symbol} companyName={companyName} size="lg" className={styles.logo} />
          <div className={styles.identityCopy}>
            <h2>{item.symbol}</h2>
            <span className={styles.companyName}>{companyName}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" aria-label="추천 해설 새로고침" onClick={() => void load()}>
            <RefreshCcw size={16} />
          </button>
        </div>
      </header>

      <div className={styles.verdict}>
        <div className={styles.verdictCopy}>
          <strong>{v3?.decisionLabel ?? "매수 관찰"}</strong>
        </div>
        <div className={styles.scoreBlock} aria-label={`${v3 ? "V3 종합 점수" : "추천 점수"} ${Math.round(score)}점`}>
          <span className={styles.scoreLabel}>{v3 ? "V3 종합 점수" : "추천 점수"}</span>
          <div className={styles.scoreValue}>
            <strong>{Math.round(score)}</strong>
            <span>/ 100</span>
          </div>
          <div className={styles.scoreTrack} aria-hidden="true">
            <span style={{ width: `${score}%` }} />
          </div>
          <div className={styles.scoreMeta}>
            <span>{v3 ? "근거 신뢰도" : "신뢰도"}</span>
            <strong>{Math.round(confidence)}%</strong>
          </div>
        </div>
      </div>

      <div className={styles.contentGrid}>
        <div className={styles.primaryColumn}>
          {v3 && (
            <section className={`${styles.section} ${styles.narrative}`}>
              <SectionTitle icon={<Sparkles size={16} />} title="추천 설명" />
              <h3>{v3.primary.headline}</h3>
              <p>{v3.primary.body}</p>
              <small>{v3.primary.source === "llm" ? "OpenAI 문장 정리 · 결정론적 근거 권위 유지" : "결정론적 설명 fallback"}</small>
            </section>
          )}
          {v3 ? <V3Evidence item={item} /> : <>
          <section className={styles.section}>
            <SectionTitle icon={<BarChart3 size={16} />} title="핵심 신호" />
            <div className={styles.metricList}>
              {metrics.map((metric) => (
                <div className={styles.metricRow} key={metric.key}>
                  <div>
                    <span>{metric.label}</span>
                    <small>{metric.detail}</small>
                  </div>
                  <strong className={styles[metric.tone]}>{metric.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <SectionTitle icon={<Sparkles size={16} />} title="추천 근거" />
            <div className={styles.reasonList}>
              {item.reasons.length > 0 ? item.reasons.map((reason, index) => (
                <div className={styles.reasonRow} key={`${reason.type}-${reason.text}`}>
                  <span className={styles.reasonIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <p>{reason.text}</p>
                  {typeof reason.weight === "number" && <strong>{formatSigned(reason.weight)}</strong>}
                </div>
              )) : (
                <p className={styles.mutedCopy}>제공된 정성 근거가 없습니다. 지표 스냅샷을 확인하세요.</p>
              )}
            </div>
          </section>
          </>}
        </div>

        <aside className={styles.secondaryColumn}>
          <section className={styles.section}>
            <SectionTitle icon={<ShieldAlert size={16} />} title="리스크 체크" />
            {v3 && v3.deterministic.risks.length > 0 ? (
              <ul className={styles.riskList}>
                {v3.deterministic.risks.map((risk) => <li key={risk.code}>{risk.sentence}</li>)}
              </ul>
            ) : item.riskWarnings.length > 0 ? (
              <ul className={styles.riskList}>
                {item.riskWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <div className={styles.clearRisk}><Check size={16} /><span>명시된 추가 경고 없음</span></div>
            )}
          </section>

          <section className={styles.section}>
            <SectionTitle icon={<Activity size={16} />} title="판단 맥락" />
            <dl className={styles.contextList}>
              <div><dt>추천 세션</dt><dd>{sessionLabel(displayPayload, selection?.sessionMode)}</dd></div>
              <div><dt>생성 시각</dt><dd>{generatedAt}</dd></div>
              <div><dt>데이터 시각</dt><dd>{formatTimestamp(readStringMetric(item, "dataFreshness", "data_freshness"))}</dd></div>
              <div><dt>추천 방식</dt><dd>{algorithmLabel(item)}</dd></div>
            </dl>
          </section>

          {item.algorithmVersion === "continuous-personalization-v2" && (
            <V2Evidence item={item} />
          )}

        </aside>
      </div>
    </section>
  );
}

function V3Evidence({ item }: { item: StockRecommendationItem }) {
  const explanation = item.explanation!;
  const quality = explanation.deterministic.dataQuality;
  return (
    <>
      <section className={styles.section}>
        <SectionTitle icon={<BarChart3 size={16} />} title="결정론적 근거" />
        <p className={styles.summaryCopy}>{explanation.deterministic.summary}</p>
        <div className={styles.evidenceGrid}>
          {explanation.deterministic.evidence.map((row) => (
            <div className={styles.evidenceRow} key={row.code}>
              <span>{row.label}</span>
              <strong className={row.contribution >= 0 ? styles.positive : styles.caution}>
                {formatSigned(row.contribution)}
              </strong>
              <small>{row.sentence}</small>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <SectionTitle icon={<Activity size={16} />} title="데이터 품질" />
        <p className={styles.summaryCopy}>{quality.sentence}</p>
        <dl className={styles.contextList}>
          <div><dt>근거 신뢰도</dt><dd>{quality.evidenceReliability.toFixed(1)} / 100</dd></div>
          <div><dt>기준 시각</dt><dd>{formatTimestamp(quality.cutoff ?? undefined)}</dd></div>
          <div><dt>누락 근거</dt><dd>{quality.missingFactors.length ? quality.missingFactors.map(factorLabel).join(", ") : "없음"}</dd></div>
          <div><dt>신선도</dt><dd>{quality.stale ? "기준 초과" : "기준 충족"}</dd></div>
        </dl>
        <p className={styles.reliabilityNotice}>근거 신뢰도는 예측 성공 확률이 아닙니다.</p>
      </section>
      <section className={styles.section}>
        <SectionTitle icon={<ShieldAlert size={16} />} title="알고리즘 출처" />
        <dl className={styles.contextList}>
          <div><dt>알고리즘</dt><dd>{explanation.provenance.algorithmVersion}</dd></div>
          <div><dt>규칙 세트</dt><dd>{explanation.provenance.ruleSetVersion}</dd></div>
          <div><dt>근거 snapshot</dt><dd>{explanation.provenance.evidenceSnapshotId || "없음"}</dd></div>
          <div><dt>입력 digest</dt><dd className={styles.digest}>{explanation.provenance.inputDigest || "없음"}</dd></div>
        </dl>
      </section>
    </>
  );
}

function V2Evidence({ item }: { item: StockRecommendationItem }) {
  const weights = Object.entries(item.effectiveWeights ?? {})
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort((left, right) => right[1] - left[1]);
  const riskRows = buildRiskEvidence(item.riskBudget, item.observedRisk);
  const provenance = item.fundamentalProvenance ?? {};
  const provenanceText = [
    recordString(provenance, "schemaVersion"),
    recordString(provenance, "featureVersion"),
    recordString(provenance, "sourceAsOf")
  ].filter(Boolean).join(" · ");
  return (
    <>
      <section className={styles.section}>
        <SectionTitle icon={<Sparkles size={16} />} title="개인화 가중치" />
        <div className={styles.evidenceGrid}>
          {weights.length > 0 ? weights.map(([key, value]) => (
            <div className={styles.evidenceRow} key={key}>
              <span>{factorLabel(key)}</span>
              <strong>{value.toFixed(1)}%</strong>
            </div>
          )) : <p className={styles.mutedCopy}>표시할 개인화 가중치가 없습니다.</p>}
        </div>
      </section>

      <section className={styles.section}>
        <SectionTitle icon={<Sparkles size={16} />} title="펀더멘털 데이터" />
        <p className={styles.mutedCopy}>
          {item.fundamentalStatus === "ready"
            ? provenanceText || "검증된 펀더멘털 snapshot을 사용했습니다."
            : `시장 9팩터 fallback · ${item.fundamentalStatus || "unavailable"}`}
        </p>
      </section>

      <section className={styles.section}>
        <SectionTitle icon={<ShieldAlert size={16} />} title="위험예산 비교" />
        <div className={styles.evidenceGrid}>
          {riskRows.length > 0 ? riskRows.map((row) => (
            <div className={styles.evidenceRow} key={row.key}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <small>{row.detail}</small>
            </div>
          )) : <p className={styles.mutedCopy}>신뢰 가능한 포트폴리오 위험 관측값이 없습니다.</p>}
        </div>
      </section>
    </>
  );
}

function buildRiskEvidence(
  budget: Record<string, unknown> | undefined,
  observed: Record<string, unknown> | undefined
) {
  const definitions = [
    ["targetAnnualVolatilityPct", "annualVolatilityPct", "연 변동성"],
    ["maxDrawdownPct", "maxDrawdownPct", "최대 낙폭"],
    ["maximumTurnoverPct", "turnover30dPct", "30일 회전율"],
    ["maxSingleStockPct", "maxSingleStockPct", "단일 종목"],
    ["maxSectorPct", "maxSectorPct", "섹터 집중도"]
  ] as const;
  return definitions.flatMap(([budgetKey, observedKey, label]) => {
    const limit = recordNumber(budget, budgetKey);
    const current = recordNumber(observed, observedKey);
    if (limit === null && current === null) return [];
    return [{
      key: budgetKey,
      label,
      value: current === null ? "관측 없음" : `${current.toFixed(1)}%`,
      detail: limit === null ? "preset fallback" : `적용 한도 ${limit.toFixed(1)}%`
    }];
  });
}

function factorLabel(key: string) {
  const labels: Record<string, string> = {
    oneDayRelativeStrength: "1일 상대강도",
    previousSessionStrength: "이전 세션 강도",
    abnormalDollarVolume: "비정상 거래대금",
    closingLocationValue: "종가 위치",
    lastHourRelativeStrength: "마지막 1시간 강도",
    high52WeekProximity: "52주 고가 근접도",
    newsImpact: "뉴스 영향",
    liquidityQuality: "유동성 품질",
    lowVolatilityQuality: "저변동성 품질",
    value: "가치",
    quality: "품질",
    growth: "성장",
    earningsRevision: "실적 추정 변화",
    catalystQuality: "촉매 품질",
    valueQuality: "가치 품질",
    companyQuality: "기업 품질",
    growthQuality: "성장 품질",
    earningsRevisionQuality: "실적 추정 변화"
  };
  return labels[key] ?? key;
}

function recordNumber(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className={styles.sectionTitle}>
      <span>{icon}</span>
      <h3>{title}</h3>
    </div>
  );
}

function PanelState({
  icon,
  message,
  tone,
  onRetry
}: {
  icon: React.ReactNode;
  message: string;
  tone?: "error";
  onRetry?: () => void;
}) {
  return (
    <section className={`${styles.panel} ${styles.statePanel}`} aria-live="polite">
      <div className={tone === "error" ? styles.errorState : styles.state}>
        {icon}
        <span>{message}</span>
        {onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
      </div>
    </section>
  );
}

function buildMetricViews(item: StockRecommendationItem): MetricView[] {
  const return3h = readNumberMetric(item, "return3hPct", "return_3h_pct");
  const relativeStrength = readNumberMetric(item, "relativeStrength", "relative_strength");
  const volumeRatio = readNumberMetric(item, "volumeRatio", "volume_ratio");
  const intradayRange = readNumberMetric(item, "intradayRangePct", "intraday_range_pct");
  const dollarVolume = readNumberMetric(item, "sessionDollarVolume", "session_dollar_volume");
  const breakout = readBooleanMetric(item, "breakout");
  const v2Metrics: MetricView[] = item.algorithmVersion === "continuous-personalization-v2" ? [
    {
      key: "extended-alpha",
      label: "V2 확장 알파",
      value: formatScore(item.extendedBaseAlphaScore),
      detail: "시장 9팩터와 cutoff-safe 기업 팩터 결합",
      tone: (item.extendedBaseAlphaScore ?? 0) >= 60 ? "positive" : "neutral"
    },
    {
      key: "fundamental",
      label: "기업 펀더멘털",
      value: item.fundamentalStatus === "ready" ? formatScore(item.fundamentalScore) : "Fallback",
      detail: item.fundamentalStatus === "ready"
        ? `전체 점수에 ${formatWeight(item.fundamentalWeight)} 반영`
        : "유효 데이터가 없어 시장 9팩터로 계산",
      tone: item.fundamentalStatus === "ready" ? "positive" : "neutral"
    },
    {
      key: "preference-fit",
      label: "행동 선호 적합도",
      value: formatScore(item.preferenceFitScore),
      detail: `실제 매수 기반 개인화 신뢰도 ${Math.round((item.preferenceConfidence ?? 0) * 100)}%`,
      tone: (item.preferenceFitScore ?? 0) >= 60 ? "positive" : "neutral"
    },
    {
      key: "portfolio-fit",
      label: "포트폴리오 적합도",
      value: formatScore(item.portfolioFitScore),
      detail: "집중도·상관·유동성과 연속 위험예산 반영",
      tone: (item.portfolioFitScore ?? 0) >= 60 ? "positive" : "neutral"
    }
  ] : [];
  return [
    ...v2Metrics,
    {
      key: "return",
      label: "3시간 수익률",
      value: formatPercent(return3h),
      detail: return3h === null ? "수익률 데이터 없음" : return3h > 0 ? "단기 상승 모멘텀" : "단기 모멘텀 약화",
      tone: return3h === null ? "neutral" : return3h > 0 ? "positive" : "caution"
    },
    {
      key: "relative-strength",
      label: "시장 대비 강도",
      value: formatPercent(relativeStrength),
      detail: relativeStrength === null ? "SPY 비교 데이터 없음" : relativeStrength > 0 ? "SPY 대비 초과 성과" : "SPY 대비 열위",
      tone: relativeStrength === null ? "neutral" : relativeStrength > 0 ? "positive" : "caution"
    },
    {
      key: "volume",
      label: "거래량 배수",
      value: volumeRatio === null ? "--" : `${formatNumber(volumeRatio)}×`,
      detail: volumeRatio === null ? "거래량 데이터 없음" : volumeRatio >= 1.2 ? "직전 구간 대비 확대" : "확대 기준 1.2× 미만",
      tone: volumeRatio === null ? "neutral" : volumeRatio >= 1.2 ? "positive" : "neutral"
    },
    {
      key: "breakout",
      label: "전고점 돌파",
      value: breakout === null ? "--" : breakout ? "확인" : "미확인",
      detail: breakout ? "선택 세션 이전 고점 상회" : "돌파 신호가 아직 없음",
      tone: breakout === null ? "neutral" : breakout ? "positive" : "neutral"
    },
    {
      key: "range",
      label: "장중 변동폭",
      value: formatAbsolutePercent(intradayRange),
      detail: intradayRange === null ? "변동폭 데이터 없음" : intradayRange <= 4 ? "실행 가드레일 안쪽" : "확대된 변동성 주의",
      tone: intradayRange === null ? "neutral" : intradayRange <= 4 ? "positive" : "caution"
    },
    {
      key: "liquidity",
      label: "세션 거래대금",
      value: formatCompactCurrency(dollarVolume),
      detail: dollarVolume === null ? "유동성 데이터 없음" : dollarVolume >= 10_000_000 ? "본장 최소 유동성 충족" : "유동성 기준 재확인",
      tone: dollarVolume === null ? "neutral" : dollarVolume >= 10_000_000 ? "positive" : "caution"
    }
  ];
}

function emptyMessage(payload: StockRecommendationPayload | null) {
  const reason = payload?.summary?.emptyReason;
  if (reason === "opening_data_accumulating") {
    return "09:30 개장 데이터가 누적 중이며 첫 V3 추천은 10:00에 표시됩니다.";
  }
  if (reason === "fixture_not_extracted") {
    return "실데이터 fixture가 gate를 통과하지 않아 추천을 표시하지 않습니다.";
  }
  if (payload?.status === "profile_required") {
    return "추천 설정을 저장하면 종목별 설명이 표시됩니다.";
  }
  if (payload?.status === "market_closed") {
    return "미국 본장 추천이 생성되면 설명이 표시됩니다.";
  }
  if (payload?.status === "data_not_ready") {
    const reason = payload.summary?.emptyReason;
    return reason === "benchmark_data_not_ready"
      ? "SPY 기준 데이터가 아직 준비되지 않아 V3 추천을 만들지 않았습니다."
      : "신뢰도 기준을 충족한 후보가 15개 미만이라 V3 추천을 만들지 않았습니다.";
  }
  return "설명할 추천 종목이 없습니다.";
}

function sessionLabel(payload: StockRecommendationPayload | null, sessionMode?: "pre" | "regular") {
  return (sessionMode ?? payload?.summary?.sessionMode) === "pre" ? "장전 / 데이장" : "미국 본장";
}

function algorithmLabel(item: StockRecommendationItem) {
  if (item.algorithmVersion === "continuous-personalization-v2") {
    return "연속형 개인화 V2";
  }
  if (item.algorithmVersion === "professional-personalization-v1") {
    return "전문 개인화 V1";
  }
  if (item.algorithmVersion === "deterministic-evidence-v3") {
    return "결정론적 근거 V3";
  }
  return "규칙 기반 점수화";
}

function readNumberMetric(item: StockRecommendationItem, ...keys: string[]) {
  for (const key of keys) {
    const value = item.metricsSnapshot[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readBooleanMetric(item: StockRecommendationItem, ...keys: string[]) {
  for (const key of keys) {
    const value = item.metricsSnapshot[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function readStringMetric(item: StockRecommendationItem, ...keys: string[]) {
  for (const key of keys) {
    const value = item.metricsSnapshot[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeConfidence(value: number) {
  const normalized = value <= 1 ? value * 100 : value;
  return clamp(normalized, 0, 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatPercent(value: number | null) {
  return value === null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAbsolutePercent(value: number | null) {
  return value === null ? "--" : `${value.toFixed(2)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatSigned(value: number) {
  const formatted = formatNumber(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatScore(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} / 100` : "--";
}

function formatWeight(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "0%";
}

function formatCompactCurrency(value: number | null) {
  if (value === null) {
    return "--";
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
