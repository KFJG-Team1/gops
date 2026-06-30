export type AgentEvidenceItem = {
  provider: string;
  status: string;
  title?: string;
  summary?: string;
  url?: string;
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

export type AgentAnalysisReport = {
  analysisId: string;
  summary: string;
  symbol?: string;
  status?: string;
  route?: IntentRoute | null;
  finalAnswer?: FinalAnswer | null;
  findings: AgentFinding[];
  providerEvidence: AgentEvidenceItem[];
  notificationDecision?: NotificationDecision | null;
};

export type AgentAnalysisRequestInput = {
  agentIds: string[];
  messages: AgentAnalysisMessage[];
  symbol: string;
  intent: string;
  chartContext: unknown;
  routerMode?: "hybrid" | "rules" | "strict-llm";
};

export type AgentAnalysisMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  [key: string]: unknown;
};

export function buildAgentAnalysisRequest({
  agentIds,
  messages,
  symbol,
  intent,
  chartContext,
  routerMode = "hybrid"
}: AgentAnalysisRequestInput) {
  return {
    agentIds,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    symbol,
    intent,
    chartContext,
    routerMode
  };
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
    findings: readArray(source.findings).map(normalizeFinding).filter((item): item is AgentFinding => Boolean(item)),
    providerEvidence: readArray(source.providerEvidence).map(normalizeEvidence).filter((item): item is AgentEvidenceItem => Boolean(item)),
    notificationDecision: normalizeNotification(source.notificationDecision)
  };
}

export function formatAgentAnalysisReport(report: AgentAnalysisReport): string {
  const lines = report.finalAnswer ? formatFinalAnswer(report.finalAnswer) : [report.summary];

  const unusualEventFinding = report.findings.find((finding) =>
    finding.role === "unusual-event-explanation" && finding.summary && !finding.summary.toLowerCase().startsWith("no unusual")
  );
  if (unusualEventFinding) {
    lines.push("", `이상 이벤트: ${unusualEventFinding.summary}`);
  }

  const noDataEvidence = report.providerEvidence
    .filter((item) => item.status === "no-data")
    .slice(0, 5);
  const ontologyNoData = noDataEvidence.filter(isOntologyRelationshipNoData);
  const providerNoData = noDataEvidence.filter((item) => !isOntologyRelationshipNoData(item));
  if (ontologyNoData.length) {
    lines.push("", "확인되지 않은 내용:");
    lines.push(...ontologyNoData.map((item) => `- ${item.summary ?? "온톨로지 관계 근거가 확인되지 않았습니다."}`));
  }
  if (providerNoData.length) {
    lines.push("", "Provider status:");
    lines.push(...providerNoData.map((item) => `- ${providerNoDataLabel(item)}: ${item.summary ?? "데이터가 아직 연결되지 않았습니다."}`));
  }

  const decision = report.notificationDecision;
  if (decision && ["watch", "alert", "critical"].includes(decision.level)) {
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
  if (verificationFinding) {
    lines.push("", `검증 경고: ${verificationFinding.summary}`);
  }

  return lines.join("\n");
}

function formatFinalAnswer(finalAnswer: FinalAnswer): string[] {
  const lines = [finalAnswer.title, finalAnswer.summary];
  for (const section of finalAnswer.sections.slice(0, 3)) {
    if (!section.title || section.bullets.length === 0) {
      continue;
    }
    lines.push("", section.title);
    lines.push(...section.bullets.slice(0, 5).map((bullet) => `- ${bullet}`));
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
    raw: readObject(source.raw) ?? undefined
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

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function invalidReportError(): Error {
  return new Error("멀티에이전트 분석 응답 형식이 올바르지 않습니다.");
}
