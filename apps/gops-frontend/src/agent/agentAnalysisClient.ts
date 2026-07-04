import { formatAgentAnalysisReport, normalizeAgentAnalysisReport, type AgentAnalysisReport } from "../agents/agentAnalysis";

const AGENT_REPORT_TERMINAL_STATUSES = new Set(["completed", "deep_completed", "failed"]);
const AGENT_REPORT_POLL_INTERVAL_MS = 1000;
const AGENT_REPORT_POLL_TIMEOUT_MS = 120000;

type AgentAnalysisRequest = {
  symbol: string;
  prompt: string;
};

export async function requestAgentAnalysis({ symbol, prompt }: AgentAnalysisRequest): Promise<AgentAnalysisReport> {
  const response = await fetch("/api/agents/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey()
    },
    body: JSON.stringify({
      symbol,
      intent: prompt,
      routerMode: "hybrid",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, "Agent analysis API"));
  }
  return waitForAgentAnalysisReport(payload);
}

export function formatAgentAnalysisForChat(report: AgentAnalysisReport): string {
  return formatAgentAnalysisReport(report);
}

async function waitForAgentAnalysisReport(payload: unknown): Promise<AgentAnalysisReport> {
  let report = normalizeAgentAnalysisPayload(payload);
  if (isTerminalAgentReport(report)) {
    return report;
  }

  const statusUrl = resolveAgentReportStatusUrl(payload, report);
  const deadline = Date.now() + AGENT_REPORT_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(AGENT_REPORT_POLL_INTERVAL_MS);
    const response = await fetch(statusUrl, { headers: { Accept: "application/json" } });
    const nextPayload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readApiErrorMessage(response, nextPayload, "Agent report API"));
    }
    report = normalizeAgentAnalysisPayload(nextPayload);
    if (isTerminalAgentReport(report)) {
      return report;
    }
  }

  throw new Error("AI 분석 결과를 제한 시간 안에 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function normalizeAgentAnalysisPayload(payload: unknown): AgentAnalysisReport {
  const source = readObject(payload);
  const nestedReport = readObject(source?.report);
  if (nestedReport) {
    try {
      return normalizeAgentAnalysisReport(nestedReport);
    } catch {
      // Fall through to envelope normalization.
    }
  }

  try {
    return normalizeAgentAnalysisReport(payload);
  } catch (error) {
    const fallback = normalizeAgentAnalysisEnvelope(source);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

function normalizeAgentAnalysisEnvelope(source: Record<string, unknown> | null): AgentAnalysisReport | null {
  const analysisId = readString(source?.analysisId) ?? readString(source?.request_id);
  if (!analysisId) {
    return null;
  }
  const status = readString(source?.status) ?? "queued";
  return {
    analysisId,
    status,
    summary: statusSummaryForAgentReport(status),
    symbol: readString(source?.symbol) ?? undefined,
    route: null,
    finalAnswer: null,
    finalResponse: null,
    agentAnswers: [],
    findings: [],
    providerEvidence: [],
    dailySummaries: [],
    notificationDecision: null,
    layoutProposal: null,
    timing: null
  };
}

function statusSummaryForAgentReport(status: string): string {
  if (status === "queued") {
    return "AI 분석 요청이 대기열에 들어갔습니다.";
  }
  if (status === "running") {
    return "AI 분석을 진행 중입니다.";
  }
  if (status === "failed") {
    return "AI 분석에 실패했습니다.";
  }
  return `AI 분석 상태: ${status}`;
}

function isTerminalAgentReport(report: AgentAnalysisReport): boolean {
  return !report.status || AGENT_REPORT_TERMINAL_STATUSES.has(report.status);
}

function resolveAgentReportStatusUrl(payload: unknown, report: AgentAnalysisReport): string {
  const source = readObject(payload);
  const statusUrl = readString(source?.status_url) ?? readString(source?.statusUrl);
  return statusUrl ?? `/api/agents/reports/${encodeURIComponent(report.analysisId)}`;
}

function readApiErrorMessage(response: Response, payload: unknown, label: string): string {
  const source = readObject(payload);
  const detail = source?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return `${label} 응답 오류 ${response.status}: ${detail}`;
  }
  return `${label} 응답 오류 ${response.status}`;
}

function makeIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
