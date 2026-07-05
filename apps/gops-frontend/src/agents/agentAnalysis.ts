import {
  agentLayoutCommandTypes,
  type AgentLayoutCommand,
  type AgentLayoutCommandType,
  type AgentLayoutProposal,
  type CommandActor
} from "../layout/agentLayoutTypes";

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
  timing?: AgentAnalysisTiming | null;
};

export type AgentAnalysisMode = "auto" | "multi_agent";

export type AgentAnalysisRequestInput = {
  messages: AgentAnalysisMessage[];
  symbol: string;
  intent: string;
  chartContext: unknown;
  layoutContext?: unknown;
  routerMode?: "hybrid" | "rules" | "strict-llm";
  analysisMode?: AgentAnalysisMode;
  agentIds?: string[];
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
  routerMode = "hybrid",
  analysisMode = "auto",
  agentIds = []
}: AgentAnalysisRequestInput) {
  const request = {
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    symbol,
    intent,
    chartContext,
    routerMode,
    analysisMode,
    agentIds
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
    timing: normalizeTiming(source.timing)
  };
}

export function formatAgentAnalysisReport(report: AgentAnalysisReport): string {
  const newsOnly = isNewsOnlyReport(report);
  const lines = report.agentAnswers.length
    ? formatAgentAnswers(report.agentAnswers)
    : report.finalAnswer ? formatFinalAnswer(report.finalAnswer, { compactNews: newsOnly }) : [report.summary];

  const unusualEventFinding = report.findings.find((finding) =>
    finding.role === "unusual-event-explanation" && finding.summary && !finding.summary.toLowerCase().startsWith("no unusual")
  );
  if (unusualEventFinding && !newsOnly) {
    lines.push("", `이상 이벤트: ${unusualEventFinding.summary}`);
  }

  const noDataEvidence = report.providerEvidence
    .filter((item) => item.status === "no-data")
    .slice(0, 5);
  const ontologyNoData = noDataEvidence.filter(isOntologyRelationshipNoData);
  const providerNoData = noDataEvidence.filter((item) => !isOntologyRelationshipNoData(item));
  if (ontologyNoData.length && !newsOnly) {
    lines.push("", "확인되지 않은 내용:");
    lines.push(...ontologyNoData.map((item) => `- ${item.summary ?? "온톨로지 관계 근거가 확인되지 않았습니다."}`));
  }
  if (providerNoData.length && !newsOnly) {
    lines.push("", "Provider status:");
    lines.push(...providerNoData.map((item) => `- ${providerNoDataLabel(item)}: ${item.summary ?? "데이터가 아직 연결되지 않았습니다."}`));
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

  const timingSummary = formatTimingSummary(report.timing);
  if (timingSummary && !newsOnly) {
    lines.push("", timingSummary);
  }

  return lines.join("\n");
}

function formatFinalAnswer(finalAnswer: FinalAnswer, options: { compactNews?: boolean } = {}): string[] {
  const lines = [finalAnswer.title, finalAnswer.summary];
  for (const section of finalAnswer.sections.slice(0, 3)) {
    if (!section.title || section.bullets.length === 0) {
      continue;
    }
    lines.push("", section.title);
    lines.push(...section.bullets.slice(0, options.compactNews ? 3 : 5).map((bullet) => `- ${bullet}`));
  }
  if (options.compactNews) {
    return lines;
  }
  const linkedCitations = finalAnswer.citations.filter((citation) => Boolean(citation.url));
  if (linkedCitations.length) {
    lines.push("", "근거 링크:");
    lines.push(...linkedCitations.slice(0, 5).map((citation) =>
      `- ${citation.title} (${citation.url})`
    ));
  }
  if (finalAnswer.limitations.length) {
    lines.push("", "제한 사항:");
    lines.push(...finalAnswer.limitations.slice(0, 5).map((limitation) => `- ${limitation}`));
  }
  return lines;
}

function formatAgentAnswers(agentAnswers: AgentAnswer[]): string[] {
  const lines = ["멀티 에이전트 분석"];
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
    data_freshness_warnings: readArray(source.data_freshness_warnings).map(readString).filter((item): item is string => Boolean(item))
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

function labelForProvider(provider: string): string {
  const labels: Record<string, string> = {
    news: "뉴스",
    macro: "거시",
    ontology: "온톨로지"
  };
  return labels[provider] ?? provider;
}

function providerNoDataLabel(item: AgentEvidenceItem): string {
  const relationType = typeof item.raw?.relationType === "string" ? item.raw.relationType : "";
  if (item.provider === "ontology" && relationType === "graphdb-unavailable") {
    return "GraphDB 연결 실패";
  }
  return `${labelForProvider(item.provider)} provider 미연결`;
}

function isOntologyRelationshipNoData(item: AgentEvidenceItem): boolean {
  if (item.provider !== "ontology") {
    return false;
  }
  const relationType = typeof item.raw?.relationType === "string" ? item.raw.relationType : "";
  return ["no-direct-control", "no-ontology-evidence"].includes(relationType);
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

function formatTimingSummary(timing?: AgentAnalysisTiming | null): string | null {
  if (!timing) {
    return null;
  }
  const parts: string[] = [];
  if (typeof timing.newsFetchMs === "number") {
    parts.push(`검색 ${formatMilliseconds(timing.newsFetchMs)}`);
  }
  if (typeof timing.totalMs === "number") {
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
