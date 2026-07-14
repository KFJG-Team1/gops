import {
  agentLayoutCommandTypes,
  type AgentLayoutCommand,
  type AgentLayoutCommandType,
  type AgentLayoutProposal,
  type CommandActor
} from "../layout/agentLayoutTypes";
import type {
  CoachActionCenter,
  CoachAlertCandidate,
  CoachAlertProposalSource,
  CoachReport,
  DailyTradeReview,
  HistoricalHabitsPage,
  HabitPattern,
  PortfolioDiversificationCandidate,
  PortfolioHoldingSensitivity,
  PortfolioSectorExposure,
  HabitProcessOutcome,
  HabitReport,
  HabitRepresentativeTrade,
  ImprovementPlan,
  TradeCase
} from "../components/ai-coach/types";

export type AgentEvidenceItem = {
  provider: string;
  status: string;
  title?: string;
  summary?: string;
  url?: string;
  observedAt?: string;
  raw?: Record<string, unknown>;
};

export type AgentFinding = {
  agentId: string;
  role: string;
  summary: string;
  rationale?: string;
  confidence?: number;
  evidence: AgentEvidenceItem[];
  tags: string[];
};

export type NotificationDecision = {
  level: string;
  eventType?: string;
  title?: string;
  message?: string;
  reason?: string;
};

export type IntentRoute = {
  source: string;
  intentType: string;
  selectedRoles: string[];
  confidence?: number;
  reason?: string;
};

export type FinalAnswerSection = {
  title: string;
  bullets: string[];
};

export type FinalAnswerCitation = {
  provider: string;
  title: string;
  url?: string;
  publishedAt?: string;
};

export type FinalAnswer = {
  title: string;
  summary: string;
  sections: FinalAnswerSection[];
  citations: FinalAnswerCitation[];
  limitations: string[];
};

export type FinalResponse = {
  risk_warnings: string[];
  data_freshness_warnings: string[];
  confidence?: number;
};

export type AgentAnswer = {
  agentId: string;
  role: string;
  title: string;
  content: string;
  confidence?: number;
  citations: FinalAnswerCitation[];
};

export type AgentNewsPanelItem = {
  title: string;
  summary?: string;
  localizedTitle?: string;
  localizedSummary?: string;
  originalTitle?: string;
  originalSummary?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  symbol?: string;
  symbols: string[];
  eventType?: string;
  impactDirection?: string;
  relevanceScore?: number;
  importanceScore?: number;
};

export type AgentNewsSourceLink = {
  articleId?: string;
  title: string;
  name?: string;
  url: string;
  publishedAt?: string;
};

export type AgentNewsPriceChange = {
  date: string;
  previousClose: number;
  close: number;
  change: number;
  changePercent: number;
};

export type AgentDailyNewsSummary = {
  date: string;
  symbol?: string;
  summary: string;
  keyPoints: string[];
  positivePoints: string[];
  concerns: string[];
  impactDirection?: string;
  sentiment?: string;
  articleIds: string[];
  articleCount?: number;
  mentionCount?: number;
  status?: string;
  generatedAt?: string;
  sources: AgentNewsSourceLink[];
  priceChange?: AgentNewsPriceChange;
};

export type AgentNewsPanelData = {
  symbol?: string;
  displayMode?: string;
  updatedAt?: string;
  status?: string;
  emptyMessage?: string;
  dailySummaries: AgentDailyNewsSummary[];
  latestNews: AgentNewsPanelItem[];
  majorNews: AgentNewsPanelItem[];
};

export type AgentAnalysisTiming = {
  totalMs?: number;
  cacheHit?: boolean;
  cacheLayer?: string;
  newsFetchMs?: number;
  roleAnalysisMs?: number;
  finalAnswerMs?: number;
};

export type TradeConditionProposal = {
  proposalId: string;
  analysisId: string;
  symbol: string;
  exchange: string;
  side: "buy" | "sell";
  direction: "atOrBelow" | "atOrAbove";
  triggerPrice: number;
  limitPrice?: number;
  quantity?: number;
  executionEnabled: boolean;
  alertsEnabled: boolean;
  validity: string;
  missingFields: string[];
  rationale?: string;
  createdAt?: string;
  expiresAt?: string;
};

export type AgentAnalysisReport = {
  analysisId: string;
  summary: string;
  symbol?: string;
  status?: string;
  route?: IntentRoute | null;
  finalAnswer?: FinalAnswer | null;
  finalResponse?: FinalResponse | null;
  agentAnswers: AgentAnswer[];
  findings: AgentFinding[];
  providerEvidence: AgentEvidenceItem[];
  dailySummaries: AgentDailyNewsSummary[];
  notificationDecision?: NotificationDecision | null;
  layoutProposal?: AgentLayoutProposal | null;
  tradeConditionProposals: TradeConditionProposal[];
  timing?: AgentAnalysisTiming | null;
  coachReport?: CoachReport | null;
};

export type AgentAnalysisMode = "auto" | "multi_agent";

export type AgentAnalysisRequestInput = {
  messages: AgentAnalysisMessage[];
  symbol: string;
  intent: string;
  chartContext: unknown;
  layoutContext?: unknown;
  references?: unknown[];
  uiContext?: unknown;
  routerMode?: "hybrid" | "rules" | "strict-llm";
  analysisMode?: AgentAnalysisMode;
  agentIds?: string[];
  coachRequest?: {
    enabled: true;
    selectedFillId?: string;
    tradingDate?: string;
  };
};

export type AgentAnalysisMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  [key: string]: unknown;
};

export function buildAgentAnalysisRequest({
  messages,
  symbol,
  intent,
  chartContext,
  layoutContext,
  references,
  uiContext,
  routerMode = "hybrid",
  analysisMode = "auto",
  agentIds = [],
  coachRequest
}: AgentAnalysisRequestInput) {
  const request = {
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    symbol,
    intent,
    chartContext,
    references: references ?? [],
    uiContext: uiContext ?? {},
    routerMode,
    analysisMode,
    agentIds,
    ...(coachRequest ? { coachRequest } : {})
  };
  return layoutContext === undefined ? request : { ...request, layoutContext };
}

export function shouldAutoApplyAgentLayoutProposal(report: AgentAnalysisReport, analysisMode: AgentAnalysisMode): boolean {
  const proposal = report.layoutProposal;
  return analysisMode === "auto" && proposal?.autoApply !== false && Boolean(proposal?.commands.length);
}

export function normalizeAgentAnalysisReport(payload: unknown): AgentAnalysisReport {
  const source = readObject(payload);
  if (!source) {
    throw invalidReportError();
  }

  const analysisId = readString(source.analysisId);
  const summary = readString(source.summary);
  if (!analysisId || !summary) {
    throw invalidReportError();
  }

  return {
    analysisId,
    summary,
    symbol: readString(source.symbol) ?? undefined,
    status: readString(source.status) ?? undefined,
    route: normalizeRoute(source.route),
    finalAnswer: normalizeFinalAnswer(source.finalAnswer),
    finalResponse: normalizeFinalResponse(source.finalResponse),
    agentAnswers: readArray(source.agentAnswers).map(normalizeAgentAnswer).filter((item): item is AgentAnswer => Boolean(item)),
    findings: readArray(source.findings).map(normalizeFinding).filter((item): item is AgentFinding => Boolean(item)),
    providerEvidence: readArray(source.providerEvidence).map(normalizeEvidence).filter((item): item is AgentEvidenceItem => Boolean(item)),
    dailySummaries: readArray(source.dailySummaries).map(normalizeDailySummary).filter((item): item is AgentDailyNewsSummary => Boolean(item)),
    notificationDecision: normalizeNotification(source.notificationDecision),
    layoutProposal: normalizeLayoutProposal(source.layoutProposal),
    tradeConditionProposals: readArray(source.tradeConditionProposals)
      .map(normalizeTradeConditionProposal)
      .filter((item): item is TradeConditionProposal => Boolean(item)),
    timing: normalizeTiming(source.timing),
    coachReport: normalizeCoachReport(source.coachReport)
  };
}

export async function fetchLatestCoachReport(signal?: AbortSignal): Promise<CoachReport | null> {
  const response = await fetch("/api/ai-coach/reports/latest", { signal, credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`AI coach report request failed (${response.status})`);
  }
  const payload = readObject(await response.json());
  return normalizeCoachReport(payload?.report);
}

export function normalizeCoachReport(value: unknown): CoachReport | null {
  const source = readObject(value);
  const contractVersion = readString(source?.contractVersion);
  const analysisId = readString(source?.analysisId);
  if (!source || !contractVersion || !analysisId) return null;
  const sourceAsOf = readObject(source.sourceAsOf) ?? {};
  return {
    contractVersion,
    analysisId,
    generatedAt: readString(source.generatedAt) ?? "",
    sourceAsOf: Object.fromEntries(
      Object.entries(sourceAsOf).map(([key, item]) => [key, readString(item)])
    ),
    page1: normalizeDailyTradeReview(source.page1),
    page2: normalizeHistoricalHabitsPage(source.page2),
    page3: normalizeImprovementPlan(source.page3),
    page4: normalizeCoachActionCenter(source.page4),
    snapshotRef: readString(source.snapshotRef),
    snapshotDigest: readString(source.snapshotDigest),
    missingData: readArray(source.missingData)
      .map(readObject)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        source: readString(item.source) ?? undefined,
        code: readString(item.code) ?? undefined,
        message: readString(item.message) ?? undefined
      })),
    warnings: readArray(source.warnings)
      .map(readString)
      .filter((item): item is string => Boolean(item))
  };
}

function normalizeDailyTradeReview(value: unknown): DailyTradeReview | null {
  const source = readObject(value);
  if (!source) return null;
  const currentCase = normalizeTradeCase(source.currentCase);
  if (!currentCase) return null;
  const trades = readArray(source.trades)
    .map(readObject)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .flatMap((item) => {
      const fillId = readString(item.fillId);
      const symbol = readString(item.symbol);
      return fillId && symbol ? [{ ...item, fillId, symbol }] : [];
    }) as DailyTradeReview["trades"];
  const assessment = readObject(source.decisionAssessment) ?? {};
  const checklist = readObject(source.checklist) ?? {};
  const reviewsSource = readObject(source.reviewsByFillId) ?? {};
  const reviewsByFillId: NonNullable<DailyTradeReview["reviewsByFillId"]> = {};
  for (const [fillId, reviewValue] of Object.entries(reviewsSource)) {
    const review = normalizeTradeReviewBody(reviewValue);
    if (fillId && review) reviewsByFillId[fillId] = review;
  }
  return {
    selectedFillId: readString(source.selectedFillId),
    trades,
    decisionAssessment: {
      ...(assessment as DailyTradeReview["decisionAssessment"]),
      evidence: readArray(assessment.evidence).map(readString).filter((item): item is string => Boolean(item)),
      sourceAsOf: normalizeSourceAsOf(assessment.sourceAsOf)
    },
    currentCase,
    similarCases: readArray(source.similarCases).map(normalizeTradeCase).filter((item): item is TradeCase => Boolean(item)).slice(0, 6),
    checklist: {
      chart: normalizeObjectArray(checklist.chart) as DailyTradeReview["checklist"]["chart"],
      news: normalizeObjectArray(checklist.news) as DailyTradeReview["checklist"]["news"],
      fundamentals: normalizeObjectArray(checklist.fundamentals) as DailyTradeReview["checklist"]["fundamentals"],
      market: normalizeObjectArray(checklist.market) as DailyTradeReview["checklist"]["market"]
    },
    portfolioImpact: readObject(source.portfolioImpact) ?? {},
    watchConditions: normalizeObjectArray(source.watchConditions) as DailyTradeReview["watchConditions"],
    proposedAlerts: normalizeObjectArray(source.proposedAlerts) as DailyTradeReview["proposedAlerts"],
    confidence: (readObject(source.confidence) ?? {}) as DailyTradeReview["confidence"],
    reviewsByFillId
  };
}

function normalizeTradeReviewBody(value: unknown): NonNullable<DailyTradeReview["reviewsByFillId"]>[string] | null {
  const source = readObject(value);
  const currentCase = normalizeTradeCase(source?.currentCase);
  if (!source || !currentCase) return null;
  const assessment = readObject(source.decisionAssessment) ?? {};
  const checklist = readObject(source.checklist) ?? {};
  return {
    decisionAssessment: assessment as DailyTradeReview["decisionAssessment"],
    currentCase,
    similarCases: readArray(source.similarCases).map(normalizeTradeCase).filter((item): item is TradeCase => Boolean(item)).slice(0, 6),
    checklist: {
      chart: normalizeObjectArray(checklist.chart) as DailyTradeReview["checklist"]["chart"],
      news: normalizeObjectArray(checklist.news) as DailyTradeReview["checklist"]["news"],
      fundamentals: normalizeObjectArray(checklist.fundamentals) as DailyTradeReview["checklist"]["fundamentals"],
      market: normalizeObjectArray(checklist.market) as DailyTradeReview["checklist"]["market"]
    },
    portfolioImpact: readObject(source.portfolioImpact) ?? {},
    watchConditions: normalizeObjectArray(source.watchConditions) as DailyTradeReview["watchConditions"],
    proposedAlerts: normalizeObjectArray(source.proposedAlerts) as DailyTradeReview["proposedAlerts"],
    confidence: (readObject(source.confidence) ?? {}) as DailyTradeReview["confidence"]
  };
}

function normalizeTradeCase(value: unknown): TradeCase | null {
  const source = readObject(value);
  const caseId = readString(source?.caseId);
  if (!source || !caseId) return null;
  return {
    ...(source as TradeCase),
    caseId,
    similarityComponents: readObject(source.similarityComponents) as Record<string, number> | null ?? undefined,
    series: normalizeObjectArray(source.series) as TradeCase["series"],
    missedChecks: normalizeObjectArray(source.missedChecks) as TradeCase["missedChecks"]
  };
}

function normalizeHistoricalHabitsPage(value: unknown): HistoricalHabitsPage | null {
  const source = readObject(value);
  if (!source) return null;
  const reportsByPeriod = readObject(source.reportsByPeriod) ?? {};
  return {
    ...(source as HistoricalHabitsPage),
    availability: normalizeAvailability(source.availability),
    defaultPeriod: "6m",
    reportsByPeriod: {
      "6m": normalizeStageReports(reportsByPeriod["6m"] ?? reportsByPeriod["90d"] ?? reportsByPeriod["1y"] ?? reportsByPeriod["30d"])
    }
  };
}

function normalizeImprovementPlan(value: unknown): ImprovementPlan | null {
  const source = readObject(value);
  if (!source) return null;
  return {
    ...(source as ImprovementPlan),
    availability: normalizeAvailability(source.availability),
    summary: readString(source.summary) ?? undefined,
    priorities: normalizeObjectArray(source.priorities) as ImprovementPlan["priorities"],
    experiments: normalizeObjectArray(source.experiments) as ImprovementPlan["experiments"],
    guardrails: normalizeObjectArray(source.guardrails) as ImprovementPlan["guardrails"]
  };
}

function normalizeCoachActionCenter(value: unknown): CoachActionCenter | null {
  const source = readObject(value);
  if (!source) return null;
  return {
    availability: normalizeAvailability(source.availability),
    activeExperiments: normalizeObjectArray(source.activeExperiments) as CoachActionCenter["activeExperiments"],
    enabledGuardrails: normalizeObjectArray(source.enabledGuardrails) as CoachActionCenter["enabledGuardrails"],
    recommendedAlerts: readArray(source.recommendedAlerts)
      .map((item) => normalizeCoachAlertCandidate(item, true))
      .filter((item): item is CoachAlertCandidate => Boolean(item)),
    watchingAlerts: readArray(source.watchingAlerts)
      .map((item) => normalizeCoachAlertCandidate(item, false))
      .filter((item): item is CoachAlertCandidate => Boolean(item))
  };
}

function normalizeCoachAlertCandidate(value: unknown, legacyDailyTradeFallback: boolean): CoachAlertCandidate | null {
  const source = readObject(value);
  const id = readString(source?.id);
  const title = readString(source?.title);
  if (!source || !id || !title) return null;
  const hasProposalSource = Object.prototype.hasOwnProperty.call(source, "proposalSource")
    || Object.prototype.hasOwnProperty.call(source, "proposal_source");
  const proposalSource = normalizeCoachAlertProposalSource(source.proposalSource ?? source.proposal_source);
  if (hasProposalSource && !proposalSource && legacyDailyTradeFallback) return null;
  return {
    id,
    symbol: readString(source.symbol),
    title,
    detail: readString(source.detail) ?? undefined,
    currentValue: readString(source.currentValue) ?? readNumber(source.currentValue),
    threshold: readString(source.threshold) ?? readNumber(source.threshold),
    operator: readString(source.operator),
    recommendedAction: readString(source.recommendedAction),
    alertSupported: readBoolean(source.alertSupported) ?? undefined,
    enabled: readBoolean(source.enabled) ?? false,
    proposalSource: proposalSource ?? (legacyDailyTradeFallback && !hasProposalSource ? "daily_trade" : null),
    alertRequest: (readObject(source.alertRequest) ?? undefined) as CoachAlertCandidate["alertRequest"],
    serverAlertId: readNumber(source.serverAlertId) ?? undefined
  };
}

function normalizeCoachAlertProposalSource(value: unknown): CoachAlertProposalSource | null {
  const source = readString(value);
  return source === "daily_trade" || source === "entry_habit" || source === "exit_habit" || source === "portfolio_risk"
    ? source
    : null;
}

function normalizeStageReports(value: unknown): Record<string, never> | NonNullable<HistoricalHabitsPage["reportsByPeriod"]["6m"]> {
  const source = readObject(value);
  if (!source) return {};
  return Object.fromEntries(
    ["entry", "exit", "portfolio"].flatMap((stage) => {
      const report = readObject(source[stage]);
      if (!report) return [];
      return [[stage, {
        ...report,
        stage,
        availability: normalizeAvailability(report.availability),
        sampleSize: readNumber(report.sampleSize) ?? 0,
        totalTradeCount: readNumber(report.totalTradeCount) ?? readNumber(report.sampleSize) ?? 0,
        analyzedTradeCount: readNumber(report.analyzedTradeCount) ?? readNumber(report.sampleSize) ?? 0,
        excludedTradeCount: readNumber(report.excludedTradeCount) ?? 0,
        evidenceQuality: ["low", "medium", "high"].includes(String(report.evidenceQuality)) ? report.evidenceQuality : report.confidence,
        excludedReasons: readArray(report.excludedReasons).map(readString).filter((item): item is string => Boolean(item)),
        confidence: ["low", "medium", "high"].includes(String(report.confidence)) ? report.confidence : "insufficient",
        missingData: readArray(report.missingData).map(readString).filter((item): item is string => Boolean(item)),
        behavior: normalizeObjectArray(report.behavior),
        longTermProfile: normalizeLongTermProfile(report.longTermProfile),
        insights: normalizeObjectArray(report.insights)
      }]];
    })
  ) as NonNullable<HistoricalHabitsPage["reportsByPeriod"]["6m"]>;
}

function normalizeLongTermProfile(value: unknown): HabitReport["longTermProfile"] {
  const source = readObject(value);
  if (!source) return undefined;
  const decisionRecords = readObject(source.decisionRecords);
  const processOutcome = readArray(source.processOutcome).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
    const process = readString(item.process);
    const outcome = readString(item.outcome);
    const count = readNumber(item.count);
    if ((process !== "confirmed" && process !== "unconfirmed") || (outcome !== "positive" && outcome !== "negative") || count === null) return [];
    return [{ process: process as HabitProcessOutcome["process"], outcome: outcome as HabitProcessOutcome["outcome"], count, averageReturnPercent: readNumber(item.averageReturnPercent) ?? undefined, averageMaePercent: readNumber(item.averageMaePercent) ?? undefined }];
  });
  const patterns = readArray(source.patterns).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
    const id = readString(item.id), title = readString(item.title), description = readString(item.description);
    const occurrenceCount = readNumber(item.occurrenceCount);
    const confidence = readString(item.confidence);
    if (!id || !title || !description || occurrenceCount === null || !["low", "medium", "high"].includes(String(confidence))) return [];
    return [{ id, title, description, occurrenceCount, occurrenceRatePercent: readNumber(item.occurrenceRatePercent) ?? undefined, averageReturnPercent: readNumber(item.averageReturnPercent) ?? undefined, averageMaePercent: readNumber(item.averageMaePercent) ?? undefined, confidence: confidence as HabitPattern["confidence"] }];
  });
  const representativeTrades = readArray(source.representativeTrades).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
    const caseId = readString(item.caseId), process = readString(item.process), outcome = readString(item.outcome), reason = readString(item.reason);
    if (!caseId || !reason || (process !== "confirmed" && process !== "unconfirmed") || (outcome !== "positive" && outcome !== "negative")) return [];
    return [{ caseId, process: process as HabitRepresentativeTrade["process"], outcome: outcome as HabitRepresentativeTrade["outcome"], reason, symbol: readString(item.symbol) ?? undefined, side: readString(item.side) ?? undefined, tradeDate: readString(item.tradeDate) ?? undefined, returnPercent: readNumber(item.returnPercent) ?? undefined, maePercent: readNumber(item.maePercent) ?? undefined }];
  });
  const marketDiversificationSource = readObject(source.marketDiversification);
  const marketDiversification = marketDiversificationSource ? {
    availability: normalizeAvailability(marketDiversificationSource.availability),
    sourceAsOf: readString(marketDiversificationSource.sourceAsOf) ?? undefined,
    concentratedSector: readString(marketDiversificationSource.concentratedSector) ?? undefined,
    concentratedWeightPercent: readNumber(marketDiversificationSource.concentratedWeightPercent) ?? undefined,
    sectorExposures: readArray(marketDiversificationSource.sectorExposures).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
      const sector = readString(item.sector), riskLevel = readString(item.riskLevel);
      if (!sector || !["high", "attention", "normal", "unknown"].includes(String(riskLevel))) return [];
      return [{ sector, riskLevel: riskLevel as PortfolioSectorExposure["riskLevel"], weightPercent: readNumber(item.weightPercent) ?? undefined, symbols: readArray(item.symbols).map(readString).filter((symbol): symbol is string => Boolean(symbol)) }];
    }),
    holdingSensitivities: readArray(marketDiversificationSource.holdingSensitivities).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
      const symbol = readString(item.symbol), independence = readString(item.independence);
      if (!symbol || !["high", "low", "unknown"].includes(String(independence))) return [];
      return [{ symbol, independence: independence as PortfolioHoldingSensitivity["independence"], sector: readString(item.sector) ?? undefined, weightPercent: readNumber(item.weightPercent) ?? undefined, marketCorrelation: readNumber(item.marketCorrelation) ?? undefined, sectorCorrelation: readNumber(item.sectorCorrelation) ?? undefined }];
    }),
    candidates: readArray(marketDiversificationSource.candidates).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item)).flatMap((item) => {
      const id = readString(item.id), market = readString(item.market), role = readString(item.role), reason = readString(item.reason);
      if (!id || !market || !reason || !["defensive", "relative_strength", "diversification"].includes(String(role))) return [];
      return [{ id, market, reason, role: role as PortfolioDiversificationCandidate["role"], sector: readString(item.sector) ?? undefined, etfSymbol: readString(item.etfSymbol) ?? undefined, suggestedMinWeightPercent: readNumber(item.suggestedMinWeightPercent) ?? undefined, suggestedMaxWeightPercent: readNumber(item.suggestedMaxWeightPercent) ?? undefined, correlationToConcentratedSector: readNumber(item.correlationToConcentratedSector) ?? undefined, relativeStrengthPercent: readNumber(item.relativeStrengthPercent) ?? undefined, sourceAsOf: readString(item.sourceAsOf) ?? undefined }];
    }),
    missingData: readArray(marketDiversificationSource.missingData).map(readString).filter((item): item is string => Boolean(item))
  } : undefined;
  return {
    headline: readString(source.headline) ?? undefined,
    decisionRecords: decisionRecords ? {
      recordedTradeCount: readNumber(decisionRecords.recordedTradeCount) ?? 0,
      confirmedTradeCount: readNumber(decisionRecords.confirmedTradeCount) ?? 0,
      unconfirmedTradeCount: readNumber(decisionRecords.unconfirmedTradeCount) ?? 0,
      missedCheckTradeCount: readNumber(decisionRecords.missedCheckTradeCount) ?? 0
    } : undefined,
    processOutcome,
    patterns,
    representativeTrades,
    marketDiversification
  };
}

function normalizeAvailability(value: unknown): HistoricalHabitsPage["availability"] {
  return ["ready", "insufficient_data", "insufficient_sample", "no_confirmation_record", "not_calculated", "pending", "observing", "low_confidence"].includes(String(value))
    ? value as HistoricalHabitsPage["availability"]
    : "insufficient_data";
}

function normalizeObjectArray(value: unknown): Record<string, unknown>[] {
  return readArray(value).map(readObject).filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeSourceAsOf(value: unknown): Record<string, string | null> {
  const source = readObject(value) ?? {};
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, readString(item)]));
}

export function formatAgentAnalysisReport(report: AgentAnalysisReport): string {
  const newsOnly = isNewsOnlyReport(report);
  const lines = report.finalAnswer
    ? formatFinalAnswer(report.finalAnswer, { compactNews: newsOnly })
    : report.agentAnswers.length ? formatAgentAnswers(report.agentAnswers) : [report.summary];
  if (report.finalAnswer && report.agentAnswers.length && !newsOnly) {
    lines.push("", ...formatAgentAnswers(report.agentAnswers, "세부 근거"));
  }

  if (report.tradeConditionProposals.length) {
    lines.push("", "가격 조건 제안");
    for (const proposal of report.tradeConditionProposals.slice(0, 3)) {
      const sideLabel = proposal.side === "buy" ? "매수" : "매도";
      const directionLabel = proposal.direction === "atOrBelow" ? "이하" : "이상";
      const quantityLabel = proposal.quantity ? `${proposal.quantity}주` : "수량 입력 필요";
      lines.push(`  - ${proposal.symbol} $${proposal.triggerPrice.toLocaleString()} ${directionLabel} 도달 시 ${sideLabel} · 지정가 $${proposal.limitPrice?.toLocaleString() ?? "미정"} · ${quantityLabel}`);
      if (proposal.rationale) {
        lines.push(`    ${proposal.rationale}`);
      }
    }
    lines.push("  마음에 들면 ‘이 가격에 예약매매랑 알림 걸어줘’라고 요청하세요.");
  }

  const decision = report.notificationDecision;
  if (decision && ["watch", "alert", "critical"].includes(decision.level) && !newsOnly) {
    lines.push("", `알림 판단: ${decision.level.toUpperCase()}${decision.title ? ` - ${decision.title}` : ""}`);
    if (decision.message) {
      lines.push(decision.message);
    }
    if (decision.reason) {
      lines.push(`근거: ${decision.reason}`);
    }
  }

  const verificationFinding = report.findings.find((finding) =>
    finding.role === "verification-guardrail" && finding.summary && isVerificationWarning(finding)
  );
  if (verificationFinding && !newsOnly) {
    lines.push("", `검증 경고: ${verificationFinding.summary}`);
  }

  const safetyNotice = formatSafetyNotice(report.finalResponse);
  if (safetyNotice) {
    lines.push("", safetyNotice);
  }

  const timingSummary = formatAgentTimingSummary(report.timing);
  if (timingSummary && !newsOnly) {
    lines.push("", timingSummary);
  }

  return lines.join("\n");
}

function formatFinalAnswer(finalAnswer: FinalAnswer, options: { compactNews?: boolean } = {}): string[] {
  const lines = [finalAnswer.title, "", finalAnswer.summary];
  for (const section of finalAnswer.sections.slice(0, 3)) {
    if (!section.title || section.bullets.length === 0) {
      continue;
    }
    lines.push("", section.title);
    lines.push(...section.bullets.slice(0, options.compactNews ? 3 : 5).map((bullet) => `  - ${bullet}`));
  }
  if (options.compactNews) {
    return lines;
  }
  const linkedCitations = finalAnswer.citations.filter((citation) => Boolean(citation.url));
  if (linkedCitations.length) {
    lines.push("", "근거 링크");
    lines.push(...linkedCitations.slice(0, 5).map((citation) =>
      `  - ${citation.title} (${citation.url})`
    ));
  }
  return lines;
}

function formatAgentAnswers(agentAnswers: AgentAnswer[], title = "멀티 에이전트 분석"): string[] {
  const lines = [title];
  for (const answer of agentAnswers) {
    lines.push("", answer.title || answer.role);
    lines.push(answer.content);
    const linkedCitations = answer.citations.filter((citation) => Boolean(citation.url)).slice(0, 3);
    if (linkedCitations.length) {
      lines.push(...linkedCitations.map((citation) => `- ${citation.title} (${citation.url})`));
    }
  }
  return lines;
}

function normalizeAgentAnswer(value: unknown): AgentAnswer | null {
  const source = readObject(value);
  const agentId = readString(source?.agentId);
  const role = readString(source?.role);
  const title = readString(source?.title);
  const content = readString(source?.content);
  if (!source || !agentId || !role || !title || !content) {
    return null;
  }
  return {
    agentId,
    role,
    title,
    content,
    confidence: readNumber(source.confidence) ?? undefined,
    citations: readArray(source.citations).map(normalizeFinalAnswerCitation).filter((item): item is FinalAnswerCitation => Boolean(item))
  };
}

function normalizeTradeConditionProposal(value: unknown): TradeConditionProposal | null {
  const source = readObject(value);
  const proposalId = readString(source?.proposalId);
  const analysisId = readString(source?.analysisId);
  const symbol = readString(source?.symbol)?.toUpperCase();
  const side = readString(source?.side);
  const direction = readString(source?.direction);
  const triggerPrice = readNumber(source?.triggerPrice);
  if (!source || !proposalId || !analysisId || !symbol || triggerPrice === null) {
    return null;
  }
  if ((side !== "buy" && side !== "sell") || (direction !== "atOrBelow" && direction !== "atOrAbove")) {
    return null;
  }
  return {
    proposalId,
    analysisId,
    symbol,
    exchange: readString(source.exchange)?.toUpperCase() ?? "NASD",
    side,
    direction,
    triggerPrice,
    limitPrice: readNumber(source.limitPrice) ?? undefined,
    quantity: readNumber(source.quantity) ?? undefined,
    executionEnabled: source.executionEnabled !== false,
    alertsEnabled: source.alertsEnabled !== false,
    validity: readString(source.validity) ?? "DAY",
    missingFields: readArray(source.missingFields).map(readString).filter((item): item is string => Boolean(item)),
    rationale: readString(source.rationale) ?? undefined,
    createdAt: readString(source.createdAt) ?? undefined,
    expiresAt: readString(source.expiresAt) ?? undefined
  };
}

function isNewsOnlyReport(report: AgentAnalysisReport): boolean {
  const route = report.route;
  if (!route) {
    return false;
  }
  return route.intentType === "news" || (route.selectedRoles.length === 1 && route.selectedRoles[0] === "news");
}

function normalizeFinding(value: unknown): AgentFinding | null {
  const source = readObject(value);
  const agentId = readString(source?.agentId);
  const role = readString(source?.role);
  const summary = readString(source?.summary);
  if (!source || !agentId || !role || !summary) {
    return null;
  }
  return {
    agentId,
    role,
    summary,
    rationale: readString(source.rationale) ?? undefined,
    confidence: typeof source.confidence === "number" ? source.confidence : undefined,
    evidence: readArray(source.evidence).map(normalizeEvidence).filter((item): item is AgentEvidenceItem => Boolean(item)),
    tags: readArray(source.tags).map(readString).filter((item): item is string => Boolean(item))
  };
}

function normalizeEvidence(value: unknown): AgentEvidenceItem | null {
  const source = readObject(value);
  const provider = readString(source?.provider);
  const status = readString(source?.status);
  if (!source || !provider || !status) {
    return null;
  }
  return {
    provider,
    status,
    title: readString(source.title) ?? undefined,
    summary: readString(source.summary) ?? undefined,
    url: readString(source.url) ?? undefined,
    observedAt: readString(source.observedAt) ?? undefined,
    raw: readObject(source.raw) ?? undefined
  };
}

function normalizeDailySummary(value: unknown): AgentDailyNewsSummary | null {
  const source = readObject(value);
  const date = readString(source?.date);
  const summary = readString(source?.summary);
  if (!source || !date || !summary) {
    return null;
  }
  return {
    date,
    symbol: readString(source.symbol) ?? undefined,
    summary,
    keyPoints: readArray(source.keyPoints).map(readString).filter((item): item is string => Boolean(item)),
    positivePoints: readArray(source.positivePoints).map(readString).filter((item): item is string => Boolean(item)),
    concerns: readArray(source.concerns).map(readString).filter((item): item is string => Boolean(item)),
    impactDirection: readString(source.impactDirection) ?? undefined,
    sentiment: readString(source.sentiment) ?? undefined,
    articleIds: readArray(source.articleIds).map(readString).filter((item): item is string => Boolean(item)),
    articleCount: readNumber(source.articleCount) ?? undefined,
    mentionCount: readNumber(source.mentionCount) ?? undefined,
    status: readString(source.status) ?? undefined,
    generatedAt: readString(source.generatedAt) ?? undefined,
    sources: readArray(source.sources).map(normalizeNewsSourceLink).filter((item): item is AgentNewsSourceLink => Boolean(item)),
    priceChange: normalizeNewsPriceChange(source.priceChange) ?? undefined
  };
}

function normalizeNewsPriceChange(value: unknown): AgentNewsPriceChange | null {
  const source = readObject(value);
  const date = readString(source?.date);
  const previousClose = readNumber(source?.previousClose);
  const close = readNumber(source?.close);
  const change = readNumber(source?.change);
  const changePercent = readNumber(source?.changePercent) ?? 0;
  if (!source || !date || previousClose === null || close === null || change === null) {
    return null;
  }
  return {
    date: date.slice(0, 10),
    previousClose,
    close,
    change,
    changePercent
  };
}

function normalizeNewsSourceLink(value: unknown): AgentNewsSourceLink | null {
  const source = readObject(value);
  const title = readString(source?.title);
  const url = readString(source?.url);
  if (!source || !title || !url) {
    return null;
  }
  return {
    articleId: readString(source.articleId) ?? undefined,
    title,
    name: readString(source.name) ?? readString(source.source) ?? undefined,
    url,
    publishedAt: readString(source.publishedAt) ?? undefined
  };
}

function normalizeRoute(value: unknown): IntentRoute | null {
  const source = readObject(value);
  const routeSource = readString(source?.source);
  const intentType = readString(source?.intentType);
  const selectedRoles = readArray(source?.selectedRoles).map(readString).filter((item): item is string => Boolean(item));
  if (!source || !routeSource || !intentType) {
    return null;
  }
  return {
    source: routeSource,
    intentType,
    selectedRoles,
    confidence: typeof source.confidence === "number" ? source.confidence : undefined,
    reason: readString(source.reason) ?? undefined
  };
}

function normalizeFinalAnswer(value: unknown): FinalAnswer | null {
  const source = readObject(value);
  const title = readString(source?.title);
  const summary = readString(source?.summary);
  if (!source || !title || !summary) {
    return null;
  }
  return {
    title,
    summary,
    sections: readArray(source.sections).map(normalizeFinalAnswerSection).filter((item): item is FinalAnswerSection => Boolean(item)),
    citations: readArray(source.citations).map(normalizeFinalAnswerCitation).filter((item): item is FinalAnswerCitation => Boolean(item)),
    limitations: readArray(source.limitations).map(readString).filter((item): item is string => Boolean(item))
  };
}

function normalizeFinalResponse(value: unknown): FinalResponse | null {
  const source = readObject(value);
  if (!source) {
    return null;
  }
  return {
    risk_warnings: readArray(source.risk_warnings).map(readString).filter((item): item is string => Boolean(item)),
    data_freshness_warnings: readArray(source.data_freshness_warnings).map(readString).filter((item): item is string => Boolean(item)),
    confidence: readNumber(source.confidence) ?? undefined
  };
}

function normalizeFinalAnswerSection(value: unknown): FinalAnswerSection | null {
  const source = readObject(value);
  const title = readString(source?.title);
  if (!source || !title) {
    return null;
  }
  return {
    title,
    bullets: readArray(source.bullets).map(readString).filter((item): item is string => Boolean(item))
  };
}

function normalizeFinalAnswerCitation(value: unknown): FinalAnswerCitation | null {
  const source = readObject(value);
  const provider = readString(source?.provider);
  const title = readString(source?.title);
  if (!source || !provider || !title) {
    return null;
  }
  return {
    provider,
    title,
    url: readString(source.url) ?? undefined,
    publishedAt: readString(source.publishedAt) ?? undefined
  };
}

function normalizeNotification(value: unknown): NotificationDecision | null {
  const source = readObject(value);
  const level = readString(source?.level);
  if (!source || !level) {
    return null;
  }
  return {
    level,
    eventType: readString(source.eventType) ?? undefined,
    title: readString(source.title) ?? undefined,
    message: readString(source.message) ?? undefined,
    reason: readString(source.reason) ?? undefined
  };
}

function normalizeTiming(value: unknown): AgentAnalysisTiming | null {
  const source = readObject(value);
  if (!source) {
    return null;
  }
  return {
    totalMs: readNumber(source.totalMs) ?? undefined,
    cacheHit: readBoolean(source.cacheHit) ?? undefined,
    cacheLayer: readString(source.cacheLayer) ?? undefined,
    newsFetchMs: readNumber(source.newsFetchMs) ?? undefined,
    roleAnalysisMs: readNumber(source.roleAnalysisMs) ?? undefined,
    finalAnswerMs: readNumber(source.finalAnswerMs) ?? undefined
  };
}

export function normalizeLayoutProposal(value: unknown): AgentLayoutProposal | null {
  const source = readObject(value);
  const title = readString(source?.title);
  const rationale = readString(source?.rationale);
  if (!source || !title || !rationale) {
    return null;
  }

  return {
    id: readString(source.id) ?? `layout-proposal-${Date.now()}`,
    title,
    rationale,
    autoApply: typeof source.autoApply === "boolean" ? source.autoApply : true,
    panelPriorities: readArray(source.panelPriorities)
      .map(normalizePanelPriority)
      .filter((item): item is NonNullable<AgentLayoutProposal["panelPriorities"]>[number] => Boolean(item)),
    commands: readArray(source.commands)
      .map(normalizeLayoutCommand)
      .filter((item): item is AgentLayoutCommand => Boolean(item)),
    createdAt: readString(source.createdAt) ?? new Date().toISOString()
  };
}

function normalizePanelPriority(value: unknown): NonNullable<AgentLayoutProposal["panelPriorities"]>[number] | null {
  const source = readObject(value);
  const panelId = readString(source?.panelId);
  const layoutWeight = readNumber(source?.layoutWeight);
  if (!source || !panelId || layoutWeight === null) {
    return null;
  }
  return {
    panelId,
    panelType: readString(source.panelType) ?? undefined,
    layoutWeight,
    reason: readString(source.reason) ?? undefined
  };
}

function normalizeLayoutCommand(value: unknown): AgentLayoutCommand | null {
  const source = readObject(value);
  const type = readLayoutCommandType(source?.type);
  const payload = readObject(source?.payload);
  if (!source || !type || !payload) {
    return null;
  }

  const target = readObject(source.target);
  const proposalId = readString(source.proposalId) ?? undefined;
  return {
    id: readString(source.id) ?? `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    actor: readCommandActor(source.actor) ?? "llm",
    target: target ? {
      panelId: readString(target.panelId) ?? undefined,
      group: target.group === "workspace" || target.group === "agentRail" ? target.group : undefined,
      zone: target.zone === "main" || target.zone === "context" || target.zone === "mainContext" || target.zone === "agentRail"
        ? target.zone
        : undefined
    } : undefined,
    payload,
    createdAt: readString(source.createdAt) ?? new Date().toISOString(),
    ...(proposalId ? { proposalId } : {})
  };
}

function readLayoutCommandType(value: unknown): AgentLayoutCommandType | null {
  return typeof value === "string" && agentLayoutCommandTypes.includes(value as AgentLayoutCommandType)
    ? value as AgentLayoutCommandType
    : null;
}

function readCommandActor(value: unknown): CommandActor | null {
  return value === "user" || value === "llm" || value === "system" ? value : null;
}

function isVerificationWarning(finding: AgentFinding): boolean {
  const normalized = finding.summary.trim().toLowerCase();
  if (!normalized || normalized.startsWith("no trading-action guardrail violation detected")) {
    return false;
  }
  return true;
}

function formatSafetyNotice(finalResponse?: FinalResponse | null): string | null {
  const warnings = new Set(finalResponse?.risk_warnings ?? []);
  if (warnings.has("pii_redacted") || warnings.has("profanity_removed") || warnings.has("sensitive_url_redacted")) {
    return "안전 처리: 민감하거나 부적절한 텍스트가 마스킹되었습니다.";
  }
  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function formatAgentTimingSummary(timing?: AgentAnalysisTiming | null): string | null {
  if (!timing) {
    return null;
  }
  const minVisibleMs = 50;
  const parts: string[] = [];
  if (typeof timing.newsFetchMs === "number" && timing.newsFetchMs >= minVisibleMs) {
    parts.push(`검색 ${formatMilliseconds(timing.newsFetchMs)}`);
  }
  if (typeof timing.totalMs === "number" && timing.totalMs >= minVisibleMs) {
    parts.push(`전체 ${formatMilliseconds(timing.totalMs)}`);
  }
  if (!parts.length) {
    return null;
  }
  return parts.join(" / ");
}

function formatMilliseconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}

function invalidReportError(): Error {
  return new Error("멀티에이전트 분석 응답 형식이 올바르지 않습니다.");
}
