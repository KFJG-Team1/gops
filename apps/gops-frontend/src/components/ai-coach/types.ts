export type MissingDataItem = { source?: string; code?: string; message?: string };
export type CoachStatus = "checked" | "unchecked" | "insufficient_data" | "not_applicable";

export type ChartPoint = {
  relativeDay: number;
  time?: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  relativeVolume?: number | null;
  rsi?: number | null;
  macd?: number | null;
  signal?: number | null;
  histogram?: number | null;
};

export type MissedCheck = {
  id?: string;
  type: "price" | "volume" | "rsi" | "macd" | "news" | "fundamentals" | "market";
  label: string;
  relativeDay?: number;
  value?: string | number | null;
  threshold?: string | number | null;
  reason?: string;
  source?: string;
  sourceAsOf?: string | null;
};

export type TradeCase = {
  caseId: string;
  tradeDate?: string | null;
  symbol?: string | null;
  side?: string | null;
  similarityScore?: number | null;
  similarityComponents?: Record<string, number>;
  entryPrice?: number | null;
  exitPrice?: number | null;
  returnPercent?: number | null;
  mfePercent?: number | null;
  maePercent?: number | null;
  holdingDuration?: string | number | null;
  series: ChartPoint[];
  missedChecks: MissedCheck[];
  mistakeSummary?: string | null;
  sameAsToday?: string | null;
  differentFromToday?: string | null;
};

export type TodayTradeSummary = {
  fillId: string;
  symbol: string;
  companyName?: string | null;
  side?: string | null;
  filledAt?: string | null;
  averageFillPrice?: number | null;
  quantity?: number | null;
  currentPrice?: number | null;
  currentReturnPercent?: number | null;
  weightBefore?: number | null;
  weightAfter?: number | null;
  earningsAt?: string | null;
  earningsDaysRemaining?: number | null;
};

export type ChecklistItem = {
  status: CoachStatus;
  label: string;
  checkedAt?: string | null;
  evidence?: string | null;
  source?: string | null;
  sourceAsOf?: string | null;
};

export type WatchCondition = {
  id: string;
  type: string;
  label: string;
  currentValue?: string | number | null;
  threshold?: string | number | null;
  operator?: string | null;
  reason?: string | null;
  recommendedAction?: string | null;
  alertSupported: boolean;
  alertRequest?: AlertRequest;
};

export type DailyTradeReview = {
  selectedFillId: string | null;
  trades: TodayTradeSummary[];
  decisionAssessment: {
    grade?: "good" | "attention" | "risk" | "insufficient_data";
    summary?: string;
    processAssessment?: string;
    outcomeAssessment?: string | number | null;
    evidence?: string[];
    sourceAsOf?: Record<string, string | null>;
  };
  currentCase: TradeCase;
  similarCases: TradeCase[];
  checklist: Record<"chart" | "news" | "fundamentals" | "market", ChecklistItem[]>;
  portfolioImpact: Record<string, unknown> & { riskFlags?: string[] };
  watchConditions: WatchCondition[];
  proposedAlerts: Array<{ id: string; enabled?: boolean }>;
  confidence: { level?: string; reason?: string };
  reviewsByFillId?: Record<string, Omit<DailyTradeReview, "selectedFillId" | "trades" | "reviewsByFillId">>;
};

export type InsightStage = "entry" | "exit" | "portfolio";
export type EvidenceConfidence = "insufficient" | "low" | "medium" | "high";
export type CoachAvailability = "ready" | "insufficient_data" | "insufficient_sample" | "no_confirmation_record" | "not_calculated" | "pending" | "observing" | "low_confidence";
export const AVAILABILITY_LABELS: Record<Exclude<CoachAvailability, "ready">, string> = {
  insufficient_data: "분석 데이터 부족", insufficient_sample: "표본 부족",
  no_confirmation_record: "확인 기록 없음", not_calculated: "계산되지 않음",
  pending: "데이터 연결 대기", observing: "관찰 중", low_confidence: "신뢰도 낮음"
};
export type CoachValue = { value?: string | number | null; unit?: string; denominator?: string; interpretation?: string; availability?: CoachAvailability };
export type ConditionInsight = {
  id: string; stage: InsightStage; kind: "effective_candidate" | "improvement_candidate" | "observation";
  title: string; condition: string; observedBehavior: string; sampleSize: number; confidence: EvidenceConfidence;
  metrics: { avgReturn?: number; avgMfe?: number; avgMae?: number; avgRMultiple?: number; marketAlpha?: number; sectorAlpha?: number; drawdownContribution?: number; riskContribution?: number; planAdherenceRate?: number };
  recurrenceScore?: number; impactScore?: number; controllabilityScore?: number; priorityScore?: number; nextAction?: string; candidateGuardrailId?: string;
};
export type GuardrailScope = "current_position" | "next_trade" | "next_five_trades" | "strategy" | "symbol" | "sector" | "market_group" | "global";
export type TradingGuardrail = {
  id: string; stage: InsightStage | "cross_stage"; title: string; description: string;
  trigger: { conditions: Array<{ metric: string; operator: string; value?: number | string; duration?: number; timeframe?: string }>; matchMode: "all" | "any" };
  severity: "info" | "warning" | "risk"; intervention: "notify" | "require_confirmation" | "cooldown" | "require_plan";
  scope: GuardrailScope; cooldownMinutes?: number; enabled: boolean;
};
export type PlaybookExperiment = {
  id: string; sourceStages: InsightStage[]; title: string; hypothesis: string; sampleTarget: number; appliedCount: number;
  checklist: string[]; successMetrics: string[]; stopConditions: string[]; confidence: EvidenceConfidence;
  status: "candidate" | "active" | "completed" | "paused";
};
export type HabitReport = {
  stage: InsightStage; availability: CoachAvailability; periodLabel?: string; sampleSize: number; confidence: EvidenceConfidence;
  missingData?: string[]; concentration?: string; regime?: string; summary?: string;
  behavior?: Array<{ label: string; value?: CoachValue }>; planConsistency?: CoachValue; insights: ConditionInsight[];
};
export type HabitCoachViewModel = { availability: CoachAvailability; reports: Partial<Record<InsightStage, HabitReport>> };
export type HabitCoachPeriod = "30d" | "90d" | "1y" | "custom";
export type HistoricalHabitsPage = {
  availability: CoachAvailability; defaultPeriod: Exclude<HabitCoachPeriod, "custom">;
  reportsByPeriod: Partial<Record<Exclude<HabitCoachPeriod, "custom">, Partial<Record<InsightStage, HabitReport>>>>;
  customPeriod?: { from: string; to: string; reports: Partial<Record<InsightStage, HabitReport>> };
};
export type ImprovementPriority = "reproduce" | "improve" | "observe" | "insufficient";
export type ImprovementPlan = { availability: CoachAvailability; summary?: string; priorities: Array<ConditionInsight & { priority: ImprovementPriority }>; experiments: PlaybookExperiment[]; guardrails: TradingGuardrail[] };
export type AlertRequest =
  | { symbol: string; type: "price_cross"; targetPrice: string; repeatLimit: 1 | 3 | 5 | 10 }
  | { symbol: string; type: "spike"; direction: "above" | "below"; changePct: string; windowMin: number; repeatLimit: 1 | 3 | 5 | 10 };
export type CoachAlertCandidate = { id: string; title: string; detail?: string; enabled: boolean; alertRequest?: AlertRequest; serverAlertId?: number };
export type CoachActionCenter = { availability: CoachAvailability; activeExperiments: PlaybookExperiment[]; enabledGuardrails: TradingGuardrail[]; recommendedAlerts: CoachAlertCandidate[]; watchingAlerts: CoachAlertCandidate[] };

export type CoachReport = {
  contractVersion: string;
  analysisId: string;
  generatedAt: string;
  sourceAsOf: Record<string, string | null>;
  page1: DailyTradeReview | null;
  page2?: HistoricalHabitsPage | null;
  page3?: ImprovementPlan | null;
  page4?: CoachActionCenter | null;
  snapshotRef?: string | null;
  snapshotDigest?: string | null;
  missingData: MissingDataItem[];
  warnings: string[];
};
