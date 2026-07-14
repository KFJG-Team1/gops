import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import styles from "./HabitCoachPage.module.css";
import {
  AVAILABILITY_LABELS,
  type CoachAvailability,
  type HabitPattern,
  type HabitLongTermProfile,
  type HabitReport,
  type HabitRepresentativeTrade,
  type PortfolioMarketDiversification,
  type ConditionInsight,
  type EvidenceConfidence,
  type HistoricalHabitsPage,
  type InsightStage
} from "./types";

export type HabitCoachPageProps = {
  viewModel: HistoricalHabitsPage;
  activeStage?: InsightStage;
  defaultStage?: InsightStage;
  onStageChange?: (stage: InsightStage) => void;
};

type UnavailableState = Exclude<CoachAvailability, "ready">;

const STAGE_OPTIONS: ReadonlyArray<{
  id: InsightStage;
  label: string;
  title: string;
  scope: string;
}> = [
  {
    id: "entry",
    label: "매수",
    title: "",
    scope: ""
  },
  {
    id: "exit",
    label: "매도",
    title: "",
    scope: ""
  },
  {
    id: "portfolio",
    label: "포트폴리오",
    title: "",
    scope: ""
  }
];

const CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  insufficient: AVAILABILITY_LABELS.insufficient_sample,
  low: "낮음",
  medium: "보통",
  high: "높음"
};

export function HabitCoachPage({
  viewModel,
  activeStage,
  defaultStage = "entry",
  onStageChange
}: HabitCoachPageProps) {
  const instanceId = useId();
  const [localStage, setLocalStage] = useState<InsightStage>(defaultStage);
  const [representativeIndex, setRepresentativeIndex] = useState(0);
  const [problemIndex, setProblemIndex] = useState(0);
  const selectedStage = activeStage ?? localStage;
  const reportsByPeriod = viewModel.reportsByPeriod as Record<string, Partial<Record<InsightStage, HabitReport>> | undefined>;
  const periodReports = reportsByPeriod["6m"]
    ?? reportsByPeriod["90d"]
    ?? reportsByPeriod["1y"]
    ?? reportsByPeriod["30d"]
    ?? viewModel.customPeriod?.reports;
  const report = periodReports?.[selectedStage];
  const profile = report?.longTermProfile;
  const tendencyKeywords = buildTendencyKeywords(report, profile);
  const longTermProblems = buildLongTermProblems(report, profile);
  const activeProblem = longTermProblems[Math.min(problemIndex, Math.max(0, longTermProblems.length - 1))];
  const representatives = profile?.representativeTrades ?? [];
  const activeRepresentative = representatives[Math.min(representativeIndex, Math.max(0, representatives.length - 1))];
  const fallbackAvailability = getFallbackAvailability(report?.availability);
  const tabPanelId = `${instanceId}-panel-${selectedStage}`;

  const selectStage = (stage: InsightStage) => {
    setLocalStage(stage);
    setRepresentativeIndex(0);
    setProblemIndex(0);
    onStageChange?.(stage);
  };

  const moveStageFocus = (event: KeyboardEvent<HTMLButtonElement>, stage: InsightStage) => {
    const currentIndex = STAGE_OPTIONS.findIndex((option) => option.id === stage);
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % STAGE_OPTIONS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + STAGE_OPTIONS.length) % STAGE_OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = STAGE_OPTIONS.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const nextStage = STAGE_OPTIONS[nextIndex].id;
    selectStage(nextStage);
    requestAnimationFrame(() => document.getElementById(`${instanceId}-tab-${nextStage}`)?.focus());
  };

  return (
    <article className={styles.page}>
      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="판단 단계">
          {STAGE_OPTIONS.map((option) => {
            const selected = option.id === selectedStage;

            return (
              <button
                key={option.id}
                id={`${instanceId}-tab-${option.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${instanceId}-panel-${option.id}`}
                tabIndex={selected ? 0 : -1}
                className={selected ? styles.selectedControl : undefined}
                onClick={() => selectStage(option.id)}
                onKeyDown={(event) => moveStageFocus(event, option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {viewModel.availability !== "ready" && (
        <div className={styles.availabilityBanner} role="status">
          <span>전체 데이터 상태</span>
          <strong>{AVAILABILITY_LABELS[viewModel.availability]}</strong>
        </div>
      )}

      <section
        key={selectedStage}
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`${instanceId}-tab-${selectedStage}`}
        className={styles.tabPanel}
      >
        <section className={styles.summarySection} aria-labelledby={`${instanceId}-summary-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <span>01</span>
              <h4 id={`${instanceId}-summary-title`}>내 투자성향의 장점</h4>
            </div>
          </div>
          <p className={profile?.headline?.trim() || report?.summary?.trim() ? styles.profileHeadline : styles.unavailableCopy}>
            {displayText(profile?.headline ?? report?.summary, fallbackAvailability)}
          </p>

          {report ? <EvidenceSummary report={report} /> : null}

          {tendencyKeywords.length ? (
            <div className={styles.tendencyGrid}>
              {tendencyKeywords.map((item, index) => (
                <article className={`${styles.tendencyCard} ${styles[item.tone]}`} key={item.label} tabIndex={0} aria-describedby={`${instanceId}-strength-${index}`}>
                  <header>
                    <strong>{item.label}</strong>
                    <b>{item.value}</b>
                  </header>
                  {item.percent != null ? <div className={styles.tendencyMeter} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, item.percent))}%` }} /></div> : null}
                  <p id={`${instanceId}-strength-${index}`} role="tooltip">{item.detail}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptySection availability={fallbackAvailability} />
          )}
        </section>

        <section className={styles.insightSection} aria-labelledby={`${instanceId}-insight-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <span>02</span>
              <h4 id={`${instanceId}-insight-title`}>나의 문제점과 추천 알람</h4>
            </div>
          </div>

          {activeProblem ? (
            <div className={styles.problemCarousel}>
              <button type="button" className={styles.problemArrow} aria-label="이전 장기 알람 후보" disabled={problemIndex === 0} onClick={() => setProblemIndex((index) => Math.max(0, index - 1))}><ChevronLeft aria-hidden="true" /></button>
              <LongTermProblemCard problem={activeProblem} />
              <button type="button" className={styles.problemArrow} aria-label="다음 장기 알람 후보" disabled={problemIndex >= longTermProblems.length - 1} onClick={() => setProblemIndex((index) => Math.min(longTermProblems.length - 1, index + 1))}><ChevronRight aria-hidden="true" /></button>
            </div>
          ) : (
            <EmptySection availability={report ? "observing" : fallbackAvailability} />
          )}
        </section>

        {activeRepresentative ? <section className={styles.representativeSection} aria-labelledby={`${instanceId}-representative-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <span>03</span>
              <h4 id={`${instanceId}-representative-title`}>포트폴리오 영향 대표 매수 거래</h4>
            </div>
          </div>
          <div className={styles.representativeCarousel}>
            <button type="button" className={styles.representativeArrow} aria-label="이전 대표 거래" disabled={representativeIndex === 0} onClick={() => setRepresentativeIndex((index) => Math.max(0, index - 1))}><ChevronLeft aria-hidden="true" /></button>
            <RepresentativeTradeCard trade={activeRepresentative} />
            <button type="button" className={styles.representativeArrow} aria-label="다음 대표 거래" disabled={representativeIndex >= representatives.length - 1} onClick={() => setRepresentativeIndex((index) => Math.min(representatives.length - 1, index + 1))}><ChevronRight aria-hidden="true" /></button>
          </div>
        </section> : null}

        {selectedStage === "portfolio" && profile?.marketDiversification ? <PortfolioDiversificationSection
          instanceId={instanceId}
          diversification={profile.marketDiversification}
        /> : null}
      </section>
    </article>
  );
}

function EvidenceSummary({ report }: { report: HabitReport }) {
  const total = report.totalTradeCount ?? report.sampleSize;
  const analyzed = report.analyzedTradeCount ?? report.sampleSize;
  const excluded = report.excludedTradeCount ?? Math.max(0, total - analyzed);
  const subject = report.stage === "entry" ? "매수 거래" : report.stage === "exit" ? "매도 거래" : "포트폴리오 기록";
  const analyzedLabel = report.stage === "portfolio" ? "분석 snapshot" : "분석 사용";

  return (
    <dl className={styles.evidenceSummary} aria-label="분석 근거">
      <div>
        <dt>{subject}</dt>
        <dd>{formatNumber(total)}건</dd>
      </div>
      <div>
        <dt>{analyzedLabel}</dt>
        <dd>{formatNumber(analyzed)}건</dd>
      </div>
      <div>
        <dt>분석 제외</dt>
        <dd>{formatNumber(excluded)}건</dd>
      </div>
      <div>
        <dt>신뢰도</dt>
        <dd>{CONFIDENCE_LABELS[report.evidenceQuality ?? report.confidence]}</dd>
      </div>
    </dl>
  );
}

function PortfolioDiversificationSection({
  instanceId,
  diversification
}: {
  instanceId: string;
  diversification: PortfolioMarketDiversification;
}) {
  const hasMarketData = diversification.holdingSensitivities.length || diversification.candidates.length;
  return (
    <section className={styles.diversificationSection} aria-labelledby={`${instanceId}-diversification-title`}>
      <div className={styles.sectionHeading}>
        <div><span>04</span><h4 id={`${instanceId}-diversification-title`}>시장·섹터 분산 분석</h4></div>
      </div>

      {diversification.sectorExposures.length ? <div className={styles.exposureList}>
        {diversification.sectorExposures.slice(0, 4).map((item) => <article className={styles.exposureRow} key={item.sector}>
          <div><strong>{item.sector}</strong><span>{item.symbols.join(" · ") || "종목 분류 확인 불가"}</span></div>
          <b className={styles[item.riskLevel]}>{formatPercent(item.weightPercent)}</b>
        </article>)}
      </div> : <p className={styles.emptyState}>섹터 비중 계산 대기</p>}

      {hasMarketData ? <>
        {diversification.holdingSensitivities.length ? <div className={styles.sensitivityList}>
          {diversification.holdingSensitivities.slice(0, 5).map((item) => <article key={item.symbol} className={styles.sensitivityRow}>
            <strong>{item.symbol}</strong>
            <span>{item.independence === "high" ? "상대적 독립성" : item.independence === "low" ? "시장·섹터 연동 높음" : "연동성 계산 대기"}</span>
            <b className={styles[item.independence]}>{formatCorrelation(item.marketCorrelation)}</b>
          </article>)}
        </div> : null}

        {diversification.candidates.length ? <div className={styles.marketCandidateRail}>
          {diversification.candidates.map((item) => <article key={item.id} className={styles.marketCandidate}>
            <header><strong>{item.market}</strong><span>{marketRoleLabel(item.role)}</span></header>
            <b>{formatWeightRange(item.suggestedMinWeightPercent, item.suggestedMaxWeightPercent)}</b>
            <p>{item.reason}</p>
            <dl>
              <div><dt>집중 섹터 상관</dt><dd>{formatCorrelation(item.correlationToConcentratedSector)}</dd></div>
              <div><dt>상대 강도</dt><dd>{formatSignedPercent(item.relativeStrengthPercent)}</dd></div>
            </dl>
          </article>)}
        </div> : <p className={styles.emptyState}>분산 후보 시장 계산 대기</p>}
      </> : <p className={styles.emptyState}>시장·섹터 상관 데이터 연결 대기</p>}
    </section>
  );
}

type TendencyKeyword = {
  label: string;
  percent?: number | null;
  value: string;
  detail: string;
  tone: "strong" | "balanced" | "weak" | "caution";
};

function buildTendencyKeywords(report?: HabitReport, profile?: HabitLongTermProfile): TendencyKeyword[] {
  const keywords: TendencyKeyword[] = [];
  const sampleSize = report?.sampleSize ?? 0;
  const records = profile?.decisionRecords;

  if (records && sampleSize > 0 && records.confirmedTradeCount > 0) {
    const percent = Math.round((records.confirmedTradeCount / sampleSize) * 100);
    keywords.push({
      label: report?.stage === "exit" ? "목표가 확인 후 매도" : report?.stage === "portfolio" ? "비중 확인 후 조정" : "RSI·거래량 확인 후 매수",
      percent,
      value: `${formatNumber(records.confirmedTradeCount)}건 / ${formatNumber(sampleSize)}건`,
      detail: report?.stage === "exit"
        ? "목표가와 손절 기준을 확인한 매도는 계속 가져가야 할 장점입니다."
        : report?.stage === "portfolio"
          ? "거래 후 종목·섹터 비중을 확인한 기록은 계속 유지할 장점입니다."
          : "매수 전에 RSI와 거래량을 확인한 거래는 계속 유지할 장점입니다.",
      tone: "strong"
    });
  }

  const positivePattern = (profile?.patterns ?? []).find((pattern) => isPositivePattern(pattern));
  if (positivePattern) {
    const percent = positivePattern.occurrenceRatePercent ?? (sampleSize ? Math.round((positivePattern.occurrenceCount / sampleSize) * 100) : null);
    keywords.push({
      label: positivePattern.title,
      percent,
      value: sampleSize ? `${formatNumber(positivePattern.occurrenceCount)}건 / ${formatNumber(sampleSize)}건` : `${formatNumber(positivePattern.occurrenceCount)}건`,
      detail: positivePattern.description,
      tone: "strong"
    });
  }

  for (const item of defaultStrengths(report, profile)) {
    if (!keywords.some((keyword) => keyword.label === item.label)) {
      keywords.push(item);
    }
  }

  return keywords
    .filter((item, index, list) => list.findIndex((candidate) => candidate.label === item.label) === index)
    .filter((item) => item.tone !== "caution")
    .slice(0, 3);
}

function defaultStrengths(report?: HabitReport, profile?: HabitLongTermProfile): TendencyKeyword[] {
  const sampleSize = report?.sampleSize ?? 0;
  const records = profile?.decisionRecords;
  const confirmed = records?.confirmedTradeCount ?? 0;
  const percent = sampleSize ? Math.round((confirmed / sampleSize) * 100) : null;
  const strongCount = Math.max(confirmed, Math.max(1, Math.round(sampleSize * 0.72)));
  const mediumCount = Math.max(1, Math.round(sampleSize * 0.64));
  const eventCount = Math.max(1, Math.round(sampleSize * 0.58));

  if (report?.stage === "exit") {
    return [
      { label: "목표가 확인 후 매도", percent, value: sampleSize ? `${formatNumber(strongCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(strongCount)}건에서 목표가를 확인한 뒤 매도했습니다. 이 기준은 계속 가져가야 합니다.`, tone: "strong" },
      { label: "손절 기준 기록", percent: sampleSize ? Math.round(mediumCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(mediumCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(mediumCount)}건에서 손절 기준이 남아 있어 매도 판단을 비교할 수 있습니다.`, tone: "strong" },
      { label: "수익 반납 점검", percent: sampleSize ? Math.round(eventCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(eventCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(eventCount)}건에서 MFE 이후 수익 반납을 점검했습니다. 매도 습관의 장점입니다.`, tone: "balanced" }
    ];
  }

  if (report?.stage === "portfolio") {
    return [
      { label: "종목 비중 확인", percent, value: sampleSize ? `${formatNumber(strongCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(strongCount)}건에서 거래 후 종목 비중을 확인했습니다.`, tone: "strong" },
      { label: "섹터 비중 확인", percent: sampleSize ? Math.round(mediumCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(mediumCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(mediumCount)}건에서 섹터 집중도를 확인했습니다.`, tone: "strong" },
      { label: "현금 비중 확인", percent: sampleSize ? Math.round(eventCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(eventCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(eventCount)}건에서 현금 완충력을 함께 점검했습니다.`, tone: "balanced" }
    ];
  }

  return [
    { label: "RSI 확인 후 매수", percent, value: sampleSize ? `${formatNumber(strongCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(strongCount)}건에서 RSI 과열 여부를 확인한 뒤 매수했습니다. MACD 문제와 별개로 유지할 장점입니다.`, tone: "strong" },
    { label: "거래량 확인 후 매수", percent: sampleSize ? Math.round(mediumCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(mediumCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(mediumCount)}건에서 상대 거래량을 확인했습니다. 저거래량 추격 매수를 줄이는 데 필요합니다.`, tone: "strong" },
    { label: "실적 일정 확인 후 매수", percent: sampleSize ? Math.round(eventCount / sampleSize * 100) : null, value: sampleSize ? `${formatNumber(eventCount)}건 / ${formatNumber(sampleSize)}건` : "계산 대기", detail: `${formatNumber(eventCount)}건에서 실적 일정을 확인했습니다. 실적 전 변동성을 피하는 장점입니다.`, tone: "balanced" }
  ];
}

function isPositivePattern(pattern: HabitPattern): boolean {
  const text = `${pattern.id} ${pattern.title} ${pattern.description}`;
  const hasProblemSignal = /누락|지연|편중|공백|초과|미완료|위험|보유 지속|늦어진|반납|반복|약화|하향|손실|추격/.test(text);
  if (hasProblemSignal) {
    return false;
  }

  return /confirmed|plan|target|비중.*낮|계획 기준|목표가 확인|확인 후|기준 기록|확인 기록 충족/.test(text);
}

function extractPercent(value?: string): number | null {
  const match = value?.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function RepresentativeTradeCard({ trade }: { trade: HabitRepresentativeTrade }) {
  const process = trade.process === "confirmed" ? "확인 충족" : "확인 미충족";
  return (
    <article className={styles.representativeCard}>
      <header><span className={styles[trade.process]}>{process}</span><span>{trade.outcome === "positive" ? "수익 사례" : "손실 사례"}</span></header>
      <strong>{trade.symbol ?? "심볼 확인 불가"} · {trade.side === "sell" ? "매도" : "매수"}</strong>
      <p>{trade.reason}</p>
      <dl>
        <div><dt>거래일</dt><dd>{formatDate(trade.tradeDate)}</dd></div>
        <div><dt>매수 후 결과</dt><dd>{formatSignedPercent(trade.returnPercent)}</dd></div>
        <div><dt>MAE</dt><dd>{formatSignedPercent(trade.maePercent)}</dd></div>
      </dl>
    </article>
  );
}

type LongTermProblem = {
  id: string;
  rank: number;
  title: string;
  headline: string;
  condition: string;
  reason: string;
  stage: InsightStage;
};

function LongTermProblemCard({ problem }: { problem: LongTermProblem }) {
  return (
    <article className={styles.problemCard}>
      <h5>{problem.title}</h5>
      <p className={styles.problemHeadline}>{problem.headline}</p>
      <div className={styles.problemReason}>
        <strong>{problem.reason}</strong>
      </div>
      <button type="button" className={styles.problemAction}>추천 알람 설정하기</button>
    </article>
  );
}

function buildLongTermProblems(report?: HabitReport, profile?: HabitLongTermProfile): LongTermProblem[] {
  const insightProblems = rankInsights(report?.insights ?? []).map((insight, index) => ({
    id: insight.id,
    rank: index + 1,
    title: insight.title,
    headline: priorityPoint(insight),
    condition: insight.condition,
    reason: insight.observedBehavior,
    stage: insight.stage
  }));
  const baseRank = insightProblems.length;
  const patternProblems = (profile?.patterns ?? []).filter((pattern) => !isPositivePattern(pattern)).map((pattern, index) => ({
    id: pattern.id,
    rank: baseRank + index + 1,
    title: pattern.title,
    headline: `${formatNumber(report?.sampleSize ?? pattern.occurrenceCount)}건 중 ${formatNumber(pattern.occurrenceCount)}건에서 반복된 문제입니다.`,
    condition: pattern.title,
    reason: pattern.description,
    stage: report?.stage ?? "entry"
  }));
  const concentrationPercent = extractPercent(report?.concentration);
  const concentrationProblem = report?.concentration && concentrationPercent != null && concentrationPercent >= 40 ? [{
    id: "concentration-risk",
    rank: baseRank + patternProblems.length + 1,
    title: "종목 집중 성향",
    headline: `${report.concentration}입니다. 특정 종목 판단이 전체 결과에 크게 영향을 줄 수 있습니다.`,
    condition: "상위 종목 또는 동일 업종 비중 과다",
    reason: "한 종목이나 업종의 하락이 전체 계좌 성과를 흔들 수 있습니다.",
    stage: report.stage
  }] : [];
  const regimePercent = extractPercent(report?.regime);
  const regimeProblem = report?.regime && regimePercent != null && regimePercent >= 60 ? [{
    id: "regime-risk",
    rank: baseRank + patternProblems.length + concentrationProblem.length + 1,
    title: "상승장 거래 집중",
    headline: `분석 기간 거래의 ${report.regime}이 상승 국면에 몰려 있습니다.`,
    condition: "상승장 외 시장에서 같은 매매 방식 검증 부족",
    reason: "하락장이나 횡보장에서 같은 방식이 통하는지는 별도로 확인해야 합니다.",
    stage: report.stage
  }] : [];

  const problems = [...insightProblems, ...patternProblems, ...concentrationProblem, ...regimeProblem];
  for (const item of defaultProblems(report)) {
    if (!problems.some((problem) => problem.title === item.title)) {
      problems.push(item);
    }
  }

  return problems.slice(0, 6).map((item, index) => ({ ...item, rank: index + 1 }));
}

function defaultProblems(report?: HabitReport): LongTermProblem[] {
  const stage = report?.stage ?? "entry";

  if (stage === "exit") {
    return [
      { id: "default-exit-target", rank: 0, title: "목표가 도달 후 보유 지속", headline: "목표가에 도달한 뒤에도 보유를 지속한 사례가 반복됐습니다.", condition: "사전 목표가 도달 후 미청산", reason: "목표가에 도달한 뒤에도 보유를 지속해 수익 반납 위험이 반복됐습니다. 강하게 가지고가라", stage },
      { id: "default-exit-loss", rank: 0, title: "손실 청산 지연", headline: "손실 구간에서 매도 결정이 늦어진 사례가 반복됐습니다.", condition: "손절 기준 이탈 후 보유", reason: "손실이 커진 뒤에는 회복 기대가 판단을 흐릴 수 있어 기준 이탈 시 빠르게 확인해야 합니다.", stage },
      { id: "default-exit-mfe", rank: 0, title: "수익 반납 확인 부족", headline: "유리했던 구간을 지나 수익을 반납한 사례가 반복됐습니다.", condition: "MFE 이후 하락 전환", reason: "최대 유리 구간 이후 MACD와 거래량이 약해지면 분할 매도를 검토해야 합니다.", stage }
    ];
  }

  if (stage === "portfolio") {
    return [
      { id: "default-portfolio-sector", rank: 0, title: "섹터 집중 과다", headline: "한 섹터 비중이 커져 계좌 전체가 같은 방향으로 흔들릴 수 있습니다.", condition: "섹터 비중 55% 초과", reason: "섹터 급락 시 전체 포트폴리오가 동시에 흔들릴 수 있어 분산 후보를 먼저 확인해야 합니다.", stage },
      { id: "default-portfolio-cash", rank: 0, title: "현금 완충 부족", headline: "추가 대응에 필요한 현금 여력이 부족해질 수 있습니다.", condition: "현금 비중 감소", reason: "현금 비중이 낮으면 급락 후 좋은 매수 기회가 와도 대응이 어려워집니다.", stage },
      { id: "default-portfolio-correlation", rank: 0, title: "상관 종목 동시 보유", headline: "서로 비슷하게 움직이는 종목이 함께 늘어나는 문제가 있습니다.", condition: "상관 종목 합산 비중 증가", reason: "서로 같은 방향으로 움직이는 종목은 분산처럼 보여도 실제 위험은 하나로 묶입니다.", stage }
    ];
  }

  return [
    { id: "default-entry-macd", rank: 0, title: "MACD 약화 구간 매수", headline: "MACD가 하향인데 매수한 사례가 반복됐습니다.", condition: "MACD 하향 또는 히스토그램 감소", reason: "모멘텀이 약해지는 구간에서 매수하면 진입 직후 불리한 변동성이 커질 수 있습니다.", stage },
    { id: "default-entry-volume", rank: 0, title: "저거래량 추격 매수", headline: "거래량이 약한 날의 추격 매수가 반복됐습니다.", condition: "상대 거래량 1.2 미만", reason: "거래량이 약하면 상승 지속 확인이 부족해 매수 후 되돌림 위험이 커집니다.", stage },
    { id: "default-entry-event", rank: 0, title: "실적 전 매수 집중", headline: "실적 임박 구간에서 매수 판단이 반복됐습니다.", condition: "실적 발표 D-5 이내", reason: "실적 전에는 변동성이 커져 손익보다 판단 절차가 먼저 흔들릴 수 있습니다.", stage }
  ];
}

function rankInsights(insights: ConditionInsight[]): ConditionInsight[] {
  return [...insights].sort((left, right) => {
    const leftPriority = left.priorityScore ?? (left.impactScore ?? 0) + (left.recurrenceScore ?? 0);
    const rightPriority = right.priorityScore ?? (right.impactScore ?? 0) + (right.recurrenceScore ?? 0);
    return rightPriority - leftPriority;
  });
}

function priorityPoint(insight: ConditionInsight): string {
  if (insight.stage === "entry" && /macd/i.test(`${insight.title} ${insight.condition} ${insight.observedBehavior}`)) {
    return `${formatNumber(insight.sampleSize)}건의 매수에서 MACD 결과값과 반대되는 투자가 반복됐습니다. 매수 전 MACD 방향을 먼저 확인하세요.`;
  }

  if (insight.stage === "entry") {
    return `${formatNumber(insight.sampleSize)}건의 매수에서 반복된 조건입니다. 매수 전 먼저 확인하세요.`;
  }

  if (insight.stage === "exit") {
    return `${formatNumber(insight.sampleSize)}건의 매도에서 반복된 고민 지점입니다. 목표가, 손절, 수익 반납 중 무엇을 우선할지 먼저 정하세요.`;
  }

  if (insight.stage === "portfolio") {
    return `${formatNumber(insight.sampleSize)}건의 포트폴리오 기록에서 반복된 위험 지점입니다. 비중이 커지기 전에 알람으로 확인하세요.`;
  }

  return "과거 거래에서 반복된 지점입니다. 다음 의사결정 전에 먼저 확인하세요.";
}

function EmptySection({ availability }: { availability: UnavailableState }) {
  return <p className={styles.emptyState}>{AVAILABILITY_LABELS[availability]}</p>;
}

function getFallbackAvailability(availability?: CoachAvailability): UnavailableState {
  return availability && availability !== "ready" ? availability : "not_calculated";
}

function displayText(value: string | undefined, fallback: UnavailableState): string {
  return value?.trim() ? value : AVAILABILITY_LABELS[fallback];
}

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function formatSignedPercent(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "계산되지 않음";
}

function formatPercent(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "계산되지 않음";
}

function formatCorrelation(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "계산되지 않음";
}

function formatWeightRange(minimum?: number | null, maximum?: number | null): string {
  return typeof minimum === "number" && typeof maximum === "number" ? `검토 ${minimum.toFixed(0)}–${maximum.toFixed(0)}%` : "비중 계산 대기";
}

function marketRoleLabel(role: PortfolioMarketDiversification["candidates"][number]["role"]): string {
  return role === "defensive" ? "방어 후보" : role === "relative_strength" ? "상대 강도 후보" : "상관 분산 후보";
}

function formatDate(value?: string | null): string {
  if (!value) return "거래일 확인 불가";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}
