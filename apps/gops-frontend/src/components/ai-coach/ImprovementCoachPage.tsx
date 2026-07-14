import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useState } from "react";
import styles from "./ImprovementCoachPage.module.css";
import {
  AVAILABILITY_LABELS,
  type CoachAvailability,
  type ConditionInsight,
  type EvidenceConfidence,
  type GuardrailScope,
  type ImprovementPlan,
  type InsightStage,
  type PlaybookExperiment,
  type TradingGuardrail
} from "./types";

const MAX_VISIBLE_PRIORITIES = 3;
const MAX_ACTIVE_EXPERIMENTS = 2;
const MAX_ENABLED_GUARDRAILS = 3;
const SAMPLE_REFERENCE_COUNT = 60;

type RankedConditionInsight = ImprovementPlan["priorities"][number];
type ExperimentActivationStatus = Extract<PlaybookExperiment["status"], "active" | "paused">;

export type ImprovementCoachPageProps = {
  plan: ImprovementPlan;
  onExperimentStatusChange: (
    experimentId: PlaybookExperiment["id"],
    status: ExperimentActivationStatus
  ) => void;
  onGuardrailEnabledChange: (
    guardrailId: TradingGuardrail["id"],
    enabled: boolean
  ) => void;
};

const STAGE_LABELS: Record<InsightStage, string> = {
  entry: "매수",
  exit: "매도",
  portfolio: "포트폴리오"
};

const CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  insufficient: AVAILABILITY_LABELS.insufficient_sample,
  low: AVAILABILITY_LABELS.low_confidence,
  medium: "보통",
  high: "높음"
};

const EXPERIMENT_STATUS_LABELS: Record<PlaybookExperiment["status"], string> = {
  candidate: "시작 전",
  active: "진행 중",
  completed: "완료",
  paused: "잠시 멈춤"
};

const SCOPE_LABELS: Record<GuardrailScope, string> = {
  current_position: "현재 보유 종목",
  next_trade: "다음 매수·매도",
  next_five_trades: "다음 5번 매수·매도",
  strategy: "매매 원칙",
  symbol: "종목",
  sector: "업종",
  market_group: "시장 구분",
  global: "모든 거래"
};

const INTERVENTION_LABELS: Record<TradingGuardrail["intervention"], string> = {
  notify: "알림",
  require_confirmation: "확인 요청",
  cooldown: "대기 시간",
  require_plan: "계획 확인"
};

const MATCH_MODE_LABELS: Record<TradingGuardrail["trigger"]["matchMode"], string> = {
  all: "모두 충족",
  any: "하나 이상 충족"
};

type MetricKey = keyof ConditionInsight["metrics"];

const METRIC_DEFINITIONS: ReadonlyArray<{
  key: MetricKey;
  label: string;
  unit: "%" | "%p" | "R";
}> = [
  { key: "avgReturn", label: "평균 수익률", unit: "%" },
  { key: "avgMfe", label: "매수 후 최고 수익률", unit: "%" },
  { key: "avgMae", label: "매수 후 최대 손실률", unit: "%" },
  { key: "avgRMultiple", label: "평균 손익비", unit: "R" },
  { key: "marketAlpha", label: "시장 대비", unit: "%p" },
  { key: "sectorAlpha", label: "업종 대비", unit: "%p" },
  { key: "drawdownContribution", label: "손실 폭에 미친 영향", unit: "%" },
  { key: "riskContribution", label: "전체 위험에서 차지한 비중", unit: "%" },
  { key: "planAdherenceRate", label: "매매 계획을 지킨 비율", unit: "%" }
];

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2
});

export function ImprovementCoachPage({
  plan,
  onExperimentStatusChange,
  onGuardrailEnabledChange
}: ImprovementCoachPageProps) {
  const [effectiveIndex, setEffectiveIndex] = useState(0);
  const [improvementIndex, setImprovementIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const effectivePriorities = plan.priorities
    .filter((insight) => insight.kind === "effective_candidate")
    .slice(0, MAX_VISIBLE_PRIORITIES);
  const improvementPriorities = plan.priorities
    .filter((insight) => insight.kind === "improvement_candidate")
    .slice(0, MAX_VISIBLE_PRIORITIES);
  const activeExperimentCount = plan.experiments.filter(
    (experiment) => experiment.status === "active"
  ).length;
  const enabledGuardrailCount = plan.guardrails.filter(
    (guardrail) => guardrail.enabled
  ).length;
  const experimentLimitReached = activeExperimentCount >= MAX_ACTIVE_EXPERIMENTS;
  const guardrailLimitReached = enabledGuardrailCount >= MAX_ENABLED_GUARDRAILS;
  const actionSlides = [
    ...plan.experiments.map((experiment) => ({
      id: `experiment-${experiment.id}`,
      content: (
        <ExperimentItem
          experiment={experiment}
          activationLimitReached={experimentLimitReached}
          onStatusChange={onExperimentStatusChange}
        />
      )
    })),
    ...plan.guardrails.map((guardrail) => ({
      id: `guardrail-${guardrail.id}`,
      content: (
        <GuardrailItem
          guardrail={guardrail}
          enableLimitReached={guardrailLimitReached}
          onEnabledChange={onGuardrailEnabledChange}
        />
      )
    }))
  ];
  const activeEffectiveIndex = Math.min(effectiveIndex, Math.max(0, effectivePriorities.length - 1));
  const activeImprovementIndex = Math.min(improvementIndex, Math.max(0, improvementPriorities.length - 1));
  const activeActionIndex = Math.min(actionIndex, Math.max(0, actionSlides.length - 1));
  const activeAction = actionSlides[activeActionIndex];

  return (
    <section className={styles.page} aria-label="좋은 매매 습관과 고칠 매매 습관">
      {plan.availability !== "ready" && (
        <div className={styles.availabilityNotice} role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <strong>{AVAILABILITY_LABELS[plan.availability]}</strong>
        </div>
      )}

      <section className={styles.summarySection} aria-labelledby="improvement-summary-title">
        <span id="improvement-summary-title">핵심 요약</span>
        <p>{plan.summary || missingLabel(plan.availability)}</p>
      </section>

      <div className={styles.priorityPair}>
        <PriorityCard
          title="계속할 좋은 습관"
          tone="effective"
          priorities={effectivePriorities}
          activeIndex={activeEffectiveIndex}
          availability={plan.availability}
          onChange={setEffectiveIndex}
        />
        <PriorityCard
          title="먼저 고칠 습관"
          tone="improvement"
          priorities={improvementPriorities}
          activeIndex={activeImprovementIndex}
          availability={plan.availability}
          onChange={setImprovementIndex}
        />
      </div>

      {activeAction ? (
        <section
          className={styles.actionCarousel}
          aria-label="실천 계획 및 매매 전 확인"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft") {
              setActionIndex((current) => Math.max(0, current - 1));
            }
            if (event.key === "ArrowRight") {
              setActionIndex((current) => Math.min(actionSlides.length - 1, current + 1));
            }
          }}
        >
          <div className={styles.actionCarouselHeading}>
            <strong>실전하기</strong>
          </div>
          <div className={styles.carouselViewport} key={activeAction.id}>
            {activeAction.content}
          </div>
          <CarouselControls
            label="실천 항목 전환"
            itemLabel="실천 항목"
            activeIndex={activeActionIndex}
            itemIds={actionSlides.map((slide) => slide.id)}
            onChange={setActionIndex}
          />
        </section>
      ) : (
        <EmptyState availability={plan.availability} />
      )}

    </section>
  );
}

function PriorityCard({
  title,
  tone,
  priorities,
  activeIndex,
  availability,
  onChange
}: {
  title: string;
  tone: "effective" | "improvement";
  priorities: RankedConditionInsight[];
  activeIndex: number;
  availability: CoachAvailability;
  onChange: (index: number) => void;
}) {
  const activePriority = priorities[activeIndex];

  return (
    <section className={styles.priorityCard} aria-label={title}>
      <div className={styles.priorityCardHeading}>
        <strong>{title}</strong>
      </div>
      <div className={styles.priorityCardViewport} key={activePriority?.id ?? `${tone}-empty`}>
        {activePriority
          ? <InsightItem insight={activePriority} tone={tone} compact />
          : <EmptyState availability={availability} />}
      </div>
      <CarouselControls
        label={`${title} 조건 전환`}
        itemLabel={`${title} 조건`}
        activeIndex={activeIndex}
        itemIds={priorities.map((priority) => priority.id)}
        onChange={onChange}
        compact
      />
    </section>
  );
}

function CarouselControls({
  label,
  itemLabel,
  activeIndex,
  itemIds,
  onChange,
  compact = false
}: {
  label: string;
  itemLabel: string;
  activeIndex: number;
  itemIds: string[];
  onChange: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.carouselControls} ${compact ? styles.compactControls : ""}`.trim()} aria-label={label}>
      <button type="button" aria-label={`이전 ${itemLabel}`} disabled={activeIndex === 0} onClick={() => onChange(Math.max(0, activeIndex - 1))}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <div>
        {itemIds.map((id, index) => (
          <button
            type="button"
            key={id}
            aria-label={`${index + 1}번째 ${itemLabel} 보기`}
            aria-current={index === activeIndex ? "step" : undefined}
            className={index === activeIndex ? styles.activeDot : undefined}
            onClick={() => onChange(index)}
          />
        ))}
      </div>
      <button type="button" aria-label={`다음 ${itemLabel}`} disabled={activeIndex >= itemIds.length - 1} onClick={() => onChange(Math.min(itemIds.length - 1, activeIndex + 1))}>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

function InsightItem({
  insight,
  tone,
  compact = false
}: {
  insight: RankedConditionInsight;
  tone: "effective" | "improvement";
  compact?: boolean;
}) {
  const sampleProgress = Math.min(
    SAMPLE_REFERENCE_COUNT,
    Math.max(0, insight.sampleSize)
  );
  const metrics = METRIC_DEFINITIONS.flatMap((definition) => {
    const value = insight.metrics[definition.key];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ ...definition, value }]
      : [];
  });

  return (
    <article className={`${styles.insight} ${compact ? styles.compactInsight : ""}`.trim()}>
      <h4>{insight.title}</h4>
      <dl className={styles.insightDefinition}>
        <div>
          <dt>확인 조건</dt>
          <dd>{insight.condition || AVAILABILITY_LABELS.not_calculated}</dd>
        </div>
        <div>
          <dt>관찰 결과</dt>
          <dd>{insight.observedBehavior || AVAILABILITY_LABELS.not_calculated}</dd>
        </div>
        {insight.nextAction && (
          <div className={tone === "effective" ? styles.nextEffective : styles.nextImprovement}>
            <dt>다음 실천</dt>
            <dd>{insight.nextAction}</dd>
          </div>
        )}
      </dl>
      <div className={styles.evidenceSummary} aria-label="근거 요약">
        <span>
          <small>확인한 거래</small>
          <strong>{formatSampleProgress(insight.sampleSize)}</strong>
          <progress
            className={`${styles.sampleProgress} ${tone === "effective" ? styles.sampleProgressEffective : styles.sampleProgressImprovement}`}
            max={SAMPLE_REFERENCE_COUNT}
            value={sampleProgress}
            aria-label={`확인한 거래 ${formatSampleProgress(insight.sampleSize)}`}
          />
        </span>
        <span>
          <small>근거 수준</small>
          <strong>{CONFIDENCE_LABELS[insight.confidence]}</strong>
        </span>
      </div>
      <details className={styles.evidenceDetails}>
        <summary>
          <span>자세한 결과</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        {metrics.length > 0 ? (
          <dl className={styles.metricGrid}>
            {metrics.map((metric) => (
              <div key={metric.key}>
                <dt>{metric.label}</dt>
                <dd>{formatMetric(metric.value, metric.unit)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.inlineMissing}>{AVAILABILITY_LABELS.not_calculated}</p>
        )}
      </details>
    </article>
  );
}

function ExperimentItem({
  experiment,
  activationLimitReached,
  onStatusChange
}: {
  experiment: PlaybookExperiment;
  activationLimitReached: boolean;
  onStatusChange: ImprovementCoachPageProps["onExperimentStatusChange"];
}) {
  const active = experiment.status === "active";
  const completed = experiment.status === "completed";
  const activationDisabled = !active && (activationLimitReached || completed);
  const disabledLabel = completed ? ", 완료된 실천 계획" : ", 진행 가능한 계획 수를 모두 사용함";
  const progress = experiment.sampleTarget > 0
    ? `${NUMBER_FORMATTER.format(experiment.appliedCount)} / ${NUMBER_FORMATTER.format(experiment.sampleTarget)}회`
    : AVAILABILITY_LABELS.not_calculated;
  return (
    <article className={styles.actionItem}>
      <div className={styles.actionItemHeader}>
        <div>
          <h4>{experiment.title}</h4>
        </div>
        <div className={styles.toggleGroup}>
          <span>{EXPERIMENT_STATUS_LABELS[experiment.status]}</span>
          <ToggleSwitch
            checked={active}
            disabled={activationDisabled}
            label={active
              ? `${experiment.title} 실천 계획 잠시 멈춤`
              : `${experiment.title} 실천 계획 시작${activationDisabled ? disabledLabel : ""}`}
            onChange={() => onStatusChange(experiment.id, active ? "paused" : "active")}
          />
        </div>
      </div>
      <p className={styles.actionDescription}>{experiment.hypothesis}</p>
      <dl className={styles.actionFacts}>
        <div>
          <dt>실천 횟수</dt>
          <dd>{progress}</dd>
        </div>
        <div>
          <dt>근거 수준</dt>
          <dd>{CONFIDENCE_LABELS[experiment.confidence]}</dd>
        </div>
      </dl>
      <div className={styles.criteriaGrid}>
        <CriteriaList title="확인할 내용" items={experiment.checklist} />
        <CriteriaList title="잘된 것으로 보는 기준" items={experiment.successMetrics} />
        <CriteriaList title="멈출 기준" items={experiment.stopConditions} tone="risk" />
      </div>
    </article>
  );
}

function GuardrailItem({
  guardrail,
  enableLimitReached,
  onEnabledChange
}: {
  guardrail: TradingGuardrail;
  enableLimitReached: boolean;
  onEnabledChange: ImprovementCoachPageProps["onGuardrailEnabledChange"];
}) {
  const enableDisabled = !guardrail.enabled && enableLimitReached;
  const stageLabel = guardrail.stage === "cross_stage"
    ? "통합"
    : STAGE_LABELS[guardrail.stage];

  return (
    <article className={styles.actionItem}>
      <div className={styles.actionItemHeader}>
        <div>
          <span className={`${styles.itemEyebrow} ${severityClassName(guardrail.severity)}`}>
            {stageLabel} · {SCOPE_LABELS[guardrail.scope]}
          </span>
          <h4>{guardrail.title}</h4>
        </div>
        <div className={styles.toggleGroup}>
          <span>{guardrail.enabled ? "사용 중" : "꺼짐"}</span>
          <ToggleSwitch
            checked={guardrail.enabled}
            disabled={enableDisabled}
            label={guardrail.enabled
              ? `${guardrail.title} 끄기`
              : `${guardrail.title} 켜기${enableDisabled ? ", 사용 한도 도달" : ""}`}
            onChange={() => onEnabledChange(guardrail.id, !guardrail.enabled)}
          />
        </div>
      </div>
      <p className={styles.actionDescription}>{guardrail.description}</p>
      <dl className={styles.actionFacts}>
        <div>
          <dt>개입</dt>
          <dd>{INTERVENTION_LABELS[guardrail.intervention]}</dd>
        </div>
        <div>
          <dt>조건 방식</dt>
          <dd>{MATCH_MODE_LABELS[guardrail.trigger.matchMode]}</dd>
        </div>
        {guardrail.cooldownMinutes !== undefined && (
          <div>
            <dt>대기 시간</dt>
            <dd>{NUMBER_FORMATTER.format(guardrail.cooldownMinutes)}분</dd>
          </div>
        )}
      </dl>
      <details className={styles.criteriaDetails} open>
        <summary>
          <span>발동 조건</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        {guardrail.trigger.conditions.length > 0 ? (
          <ul className={styles.triggerList}>
            {guardrail.trigger.conditions.map((condition, index) => (
              <li key={`${condition.metric}-${index}`}>
                <span>{condition.metric || AVAILABILITY_LABELS.not_calculated}</span>
                <code>{condition.operator || AVAILABILITY_LABELS.not_calculated}</code>
                <strong>{condition.value ?? AVAILABILITY_LABELS.not_calculated}</strong>
                {(condition.duration !== undefined || condition.timeframe) && (
                  <small>
                    {condition.duration !== undefined && NUMBER_FORMATTER.format(condition.duration)}
                    {condition.duration !== undefined && condition.timeframe ? " · " : ""}
                    {condition.timeframe}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.inlineMissing}>{AVAILABILITY_LABELS.not_calculated}</p>
        )}
      </details>
    </article>
  );
}

function CriteriaList({
  title,
  items,
  tone = "neutral"
}: {
  title: string;
  items: string[];
  tone?: "neutral" | "risk";
}) {
  return (
    <section className={tone === "risk" ? styles.criteriaRisk : undefined}>
      <h5>{title}</h5>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <p>{AVAILABILITY_LABELS.not_calculated}</p>
      )}
    </section>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleChecked : ""} ${disabled ? styles.toggleDisabled : ""}`.trim()}
      onClick={() => {
        if (!disabled) {
          onChange();
        }
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function EmptyState({ availability }: { availability: CoachAvailability }) {
  return (
    <p className={styles.emptyState} role="status">
      {missingLabel(availability)}
    </p>
  );
}

function missingLabel(availability: CoachAvailability) {
  return availability === "ready"
    ? AVAILABILITY_LABELS.not_calculated
    : AVAILABILITY_LABELS[availability];
}

function formatSampleProgress(sampleSize: number) {
  return `${NUMBER_FORMATTER.format(Math.max(0, sampleSize))} / ${SAMPLE_REFERENCE_COUNT}건`;
}

function formatMetric(value: number, unit: "%" | "%p" | "R") {
  return unit === "R"
    ? `${NUMBER_FORMATTER.format(value)}R`
    : `${NUMBER_FORMATTER.format(value)}${unit}`;
}

function severityClassName(severity: TradingGuardrail["severity"]) {
  if (severity === "risk") {
    return styles.severityRisk;
  }
  if (severity === "warning") {
    return styles.severityWarning;
  }
  return styles.severityInfo;
}
