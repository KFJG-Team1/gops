export type AgentEvidenceItem = {
  provider: string;
  status: string;
  title?: string;
  summary?: string;
};

export type AgentFinding = {
  agentId: string;
  role: string;
  summary: string;
  rationale?: string;
  confidence?: number;
  evidence: AgentEvidenceItem[];
};

export type NotificationDecision = {
  level: string;
  title?: string;
  message?: string;
  reason?: string;
};

export type AgentAnalysisReport = {
  analysisId: string;
  summary: string;
  symbol?: string;
  status?: string;
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
  chartContext
}: AgentAnalysisRequestInput) {
  return {
    agentIds,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    symbol,
    intent,
    chartContext
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
    findings: readArray(source.findings).map(normalizeFinding).filter((item): item is AgentFinding => Boolean(item)),
    providerEvidence: readArray(source.providerEvidence).map(normalizeEvidence).filter((item): item is AgentEvidenceItem => Boolean(item)),
    notificationDecision: normalizeNotification(source.notificationDecision)
  };
}

export function formatAgentAnalysisReport(report: AgentAnalysisReport): string {
  const lines = [report.summary];
  const findings = report.findings.filter((finding) => finding.summary).slice(0, 7);
  if (findings.length) {
    lines.push("", "Role findings:");
    lines.push(...findings.map((finding) => `- ${labelForRole(finding)}: ${finding.summary}`));
  }

  const noDataEvidence = report.providerEvidence
    .filter((item) => item.status === "no-data")
    .slice(0, 5);
  if (noDataEvidence.length) {
    lines.push("", "Provider status:");
    lines.push(...noDataEvidence.map((item) => `- ${labelForProvider(item.provider)} provider 미연결: ${item.summary ?? "데이터가 아직 연결되지 않았습니다."}`));
  }

  const decision = report.notificationDecision;
  if (decision && ["watch", "alert", "critical"].includes(decision.level)) {
    lines.push("", `Notification: ${decision.level.toUpperCase()}${decision.title ? ` - ${decision.title}` : ""}`);
    if (decision.message) {
      lines.push(decision.message);
    }
    if (decision.reason) {
      lines.push(`Reason: ${decision.reason}`);
    }
  }

  return lines.join("\n");
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
    evidence: readArray(source.evidence).map(normalizeEvidence).filter((item): item is AgentEvidenceItem => Boolean(item))
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
    summary: readString(source.summary) ?? undefined
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

function labelForRole(finding: AgentFinding): string {
  return finding.role || finding.agentId;
}

function labelForProvider(provider: string): string {
  const labels: Record<string, string> = {
    news: "뉴스",
    macro: "거시",
    ontology: "온톨로지"
  };
  return labels[provider] ?? provider;
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
