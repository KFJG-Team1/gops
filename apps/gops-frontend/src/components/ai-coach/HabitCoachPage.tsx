import { useId, useState, type KeyboardEvent } from "react";

import styles from "./HabitCoachPage.module.css";
import {
  AVAILABILITY_LABELS,
  type CoachAvailability,
  type CoachValue,
  type ConditionInsight,
  type EvidenceConfidence,
  type HistoricalHabitsPage,
  type HabitCoachPeriod,
  type InsightStage
} from "./types";

export type { HabitCoachPeriod } from "./types";

export type HabitCoachPageProps = {
  viewModel: HistoricalHabitsPage;
  activeStage?: InsightStage;
  defaultStage?: InsightStage;
  onStageChange?: (stage: InsightStage) => void;
  period?: HabitCoachPeriod;
  defaultPeriod?: HabitCoachPeriod;
  onPeriodChange?: (period: HabitCoachPeriod) => void;
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
    label: "진입",
    title: "진입 습관과 다음 원칙",
    scope: "진입 당시 확인 가능했던 조건과 사전 계획 기록을 기준으로 봅니다."
  },
  {
    id: "exit",
    label: "청산",
    title: "매도 습관과 다음 원칙",
    scope: "청산 이유와 손익 결과를 분리해 계획과 실제 행동을 봅니다."
  },
  {
    id: "portfolio",
    label: "포트폴리오",
    title: "포트폴리오 습관과 다음 원칙",
    scope: "비중 변화와 집중도, 시장 국면의 맥락을 함께 봅니다."
  }
];

const PERIOD_OPTIONS: ReadonlyArray<{ id: HabitCoachPeriod; label: string; ariaLabel: string }> = [
  { id: "30d", label: "30일", ariaLabel: "최근 30일" },
  { id: "90d", label: "90일", ariaLabel: "최근 90일" },
  { id: "1y", label: "1년", ariaLabel: "최근 1년" },
  { id: "custom", label: "사용자", ariaLabel: "사용자 지정 기간" }
];

const CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  insufficient: AVAILABILITY_LABELS.insufficient_sample,
  low: "낮음",
  medium: "보통",
  high: "높음"
};

const INSIGHT_KIND_LABELS: Record<ConditionInsight["kind"], string> = {
  effective_candidate: "효과 조건 후보",
  improvement_candidate: "보완 조건 후보",
  observation: "관찰 후보"
};

export function HabitCoachPage({
  viewModel,
  activeStage,
  defaultStage = "entry",
  onStageChange,
  period,
  defaultPeriod,
  onPeriodChange
}: HabitCoachPageProps) {
  const instanceId = useId();
  const [localStage, setLocalStage] = useState<InsightStage>(defaultStage);
  const [localPeriod, setLocalPeriod] = useState<HabitCoachPeriod>(defaultPeriod ?? viewModel.defaultPeriod ?? "90d");
  const selectedStage = activeStage ?? localStage;
  const selectedPeriod = period ?? localPeriod;
  const selectedStageOption =
    STAGE_OPTIONS.find((option) => option.id === selectedStage) ?? STAGE_OPTIONS[0];
  const periodReports = selectedPeriod === "custom"
    ? viewModel.customPeriod?.reports
    : viewModel.reportsByPeriod[selectedPeriod];
  const report = periodReports?.[selectedStage];
  const fallbackAvailability = getFallbackAvailability(report?.availability);
  const tabPanelId = `${instanceId}-panel-${selectedStage}`;

  const selectStage = (stage: InsightStage) => {
    setLocalStage(stage);
    onStageChange?.(stage);
  };

  const selectPeriod = (nextPeriod: HabitCoachPeriod) => {
    setLocalPeriod(nextPeriod);
    onPeriodChange?.(nextPeriod);
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
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>02 / 04 · HISTORICAL HABITS</span>
        <h2>판단 습관과 다음 원칙</h2>
        <p>과거 거래에서 반복된 진입, 청산, 포트폴리오 판단을 근거와 함께 확인합니다.</p>
      </header>

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

        <div className={styles.periodControl} role="group" aria-label="분석 기간">
          {PERIOD_OPTIONS.map((option) => {
            const selected = option.id === selectedPeriod;
            const disabled = option.id === "custom" && !viewModel.customPeriod;

            return (
              <button
                key={option.id}
                type="button"
                aria-label={option.ariaLabel}
                aria-pressed={selected}
                disabled={disabled}
                className={selected ? styles.selectedControl : undefined}
                onClick={() => selectPeriod(option.id)}
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
        <header className={styles.stageHeader}>
          <div>
            <span>{selectedStageOption.label} 리포트</span>
            <h3>{selectedStageOption.title}</h3>
            <p>{selectedStageOption.scope}</p>
          </div>
          {report?.periodLabel && <em>{report.periodLabel}</em>}
        </header>

        <section className={styles.summarySection} aria-labelledby={`${instanceId}-summary-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <span>01</span>
              <h4 id={`${instanceId}-summary-title`}>최근 행동 요약</h4>
            </div>
          </div>
          <p className={report?.summary?.trim() ? styles.summary : styles.unavailableCopy}>
            {displayText(report?.summary, fallbackAvailability)}
          </p>

          <dl className={styles.evidenceGrid}>
            <EvidenceItem
              label="분석 표본"
              value={report ? `${formatNumber(report.sampleSize)}건` : AVAILABILITY_LABELS.not_calculated}
            />
            <EvidenceItem
              label="신뢰도"
              value={report ? CONFIDENCE_LABELS[report.confidence] : AVAILABILITY_LABELS.not_calculated}
              tone={report ? confidenceTone(report.confidence) : "muted"}
            />
            <EvidenceItem
              label="데이터 상태"
              value={report ? availabilityLabel(report.availability) : AVAILABILITY_LABELS[fallbackAvailability]}
              tone={report?.availability === "low_confidence" ? "caution" : "muted"}
            />
            <EvidenceItem
              label="종목·업종 편중"
              value={displayText(report?.concentration, fallbackAvailability)}
            />
            <EvidenceItem
              label="시장 국면 편중"
              value={displayText(report?.regime, fallbackAvailability)}
            />
            <MissingDataItem reportAvailability={report?.availability} items={report?.missingData} />
          </dl>
        </section>

        <div className={styles.detailGrid}>
          <section className={styles.metricSection} aria-labelledby={`${instanceId}-behavior-title`}>
            <div className={styles.sectionHeading}>
              <div>
                <span>02</span>
                <h4 id={`${instanceId}-behavior-title`}>행동 유형별 빈도·성과</h4>
              </div>
              {report && <small>표본 {formatNumber(report.sampleSize)}건</small>}
            </div>

            {report?.behavior?.length ? (
              <div className={styles.metricList}>
                {report.behavior.map((item, index) => (
                  <div className={styles.metricRow} key={`${item.label}-${index}`}>
                    <span>{item.label}</span>
                    <div>
                      <CoachValueOutput value={item.value} fallback={fallbackAvailability} />
                      {item.value?.interpretation && <p>{item.value.interpretation}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptySection availability={fallbackAvailability} />
            )}
          </section>

          <section className={styles.planSection} aria-labelledby={`${instanceId}-plan-title`}>
            <div className={styles.sectionHeading}>
              <div>
                <span>03</span>
                <h4 id={`${instanceId}-plan-title`}>계획과 실제 행동의 일치</h4>
              </div>
            </div>
            <div className={styles.planValue}>
              <span>계획 일관성</span>
              <CoachValueOutput value={report?.planConsistency} fallback={fallbackAvailability} />
              {report?.planConsistency?.interpretation && <p>{report.planConsistency.interpretation}</p>}
            </div>
          </section>
        </div>

        <section className={styles.insightSection} aria-labelledby={`${instanceId}-insight-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <span>04</span>
              <h4 id={`${instanceId}-insight-title`}>다음 원칙 후보</h4>
            </div>
            <small>후보 단계 · 우선순위 미확정</small>
          </div>

          {report?.insights.length ? (
            <div className={styles.insightList}>
              {report.insights.map((insight) => (
                <InsightCandidate key={insight.id} insight={insight} />
              ))}
            </div>
          ) : (
            <EmptySection availability={report ? "observing" : fallbackAvailability} />
          )}
        </section>
      </section>
    </article>
  );
}

function EvidenceItem({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "caution";
}) {
  return (
    <div className={styles.evidenceItem}>
      <dt>{label}</dt>
      <dd className={tone === "default" ? undefined : styles[tone]}>{value}</dd>
    </div>
  );
}

function MissingDataItem({
  reportAvailability,
  items
}: {
  reportAvailability?: CoachAvailability;
  items?: string[];
}) {
  const fallback = getFallbackAvailability(reportAvailability);

  return (
    <div className={`${styles.evidenceItem} ${styles.missingData}`}>
      <dt>데이터 누락</dt>
      <dd>
        {items?.length ? (
          <ul>
            {items.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : reportAvailability === "ready" ? (
          "보고된 누락 없음"
        ) : (
          AVAILABILITY_LABELS[fallback]
        )}
      </dd>
    </div>
  );
}

function CoachValueOutput({ value, fallback }: { value?: CoachValue; fallback: UnavailableState }) {
  const unavailable = value?.availability && value.availability !== "ready" ? value.availability : fallback;

  if (!value || value.value === undefined || value.value === "") {
    return (
      <strong className={unavailable === "low_confidence" ? styles.caution : styles.unavailableValue}>
        {AVAILABILITY_LABELS[unavailable]}
      </strong>
    );
  }

  if (value.availability && value.availability !== "ready") {
    return (
      <strong className={value.availability === "low_confidence" ? styles.caution : styles.unavailableValue}>
        {AVAILABILITY_LABELS[value.availability]}
      </strong>
    );
  }

  return (
    <strong>
      {typeof value.value === "number" ? formatNumber(value.value) : value.value}
      {value.unit ?? ""}
      {value.denominator ? <small> / {value.denominator}</small> : null}
    </strong>
  );
}

function InsightCandidate({ insight }: { insight: ConditionInsight }) {
  return (
    <article className={`${styles.insightCandidate} ${styles[insight.kind]}`}>
      <header>
        <span>{INSIGHT_KIND_LABELS[insight.kind]}</span>
        <small>
          표본 {formatNumber(insight.sampleSize)}건 · 신뢰도 {CONFIDENCE_LABELS[insight.confidence]}
        </small>
      </header>
      <h5>{insight.title}</h5>
      <dl>
        <div>
          <dt>관찰 조건</dt>
          <dd>{insight.condition}</dd>
        </div>
        <div>
          <dt>반복 행동</dt>
          <dd>{insight.observedBehavior}</dd>
        </div>
        {insight.nextAction && (
          <div>
            <dt>다음 검증</dt>
            <dd>{insight.nextAction}</dd>
          </div>
        )}
      </dl>
      {insight.candidateGuardrailId && <p className={styles.guardrailMarker}>가드레일 후보 연결</p>}
    </article>
  );
}

function EmptySection({ availability }: { availability: UnavailableState }) {
  return <p className={styles.emptyState}>{AVAILABILITY_LABELS[availability]}</p>;
}

function getFallbackAvailability(availability?: CoachAvailability): UnavailableState {
  return availability && availability !== "ready" ? availability : "not_calculated";
}

function availabilityLabel(availability: CoachAvailability): string {
  return availability === "ready" ? "분석 가능" : AVAILABILITY_LABELS[availability];
}

function displayText(value: string | undefined, fallback: UnavailableState): string {
  return value?.trim() ? value : AVAILABILITY_LABELS[fallback];
}

function confidenceTone(confidence: EvidenceConfidence): "default" | "muted" | "caution" {
  if (confidence === "low") {
    return "caution";
  }

  return confidence === "insufficient" ? "muted" : "default";
}

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}
