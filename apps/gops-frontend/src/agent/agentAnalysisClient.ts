import {
  formatAgentAnalysisReport,
  normalizeAgentAnalysisReport,
  normalizeLayoutProposal,
  type AgentAnalysisReport,
  type IntentRoute
} from "../agents/agentAnalysis";
import type { AgentLayoutProposal } from "../layout/agentLayoutTypes";

const AGENT_REPORT_TERMINAL_STATUSES = new Set(["completed", "deep_completed", "failed", "canceled"]);
const AGENT_REPORT_POLL_INTERVAL_MS = 1000;
const AGENT_REPORT_POLL_TIMEOUT_MS = 120000;
const AGENT_ENTITY_RESOLVE_STATUSES = new Set<AgentEntityResolveStatus>(["confirmed", "not_found", "ambiguous", "unsupported"]);
const AGENT_LAYOUT_RESOLVE_STATUSES = new Set<AgentLayoutResolveStatus>(["ui_layout", "ui_clarify", "not_ui", "failed"]);

type AgentAnalysisRequest = {
  symbol: string;
  prompt: string;
};

export type AgentAnalysisAccepted = {
  analysisId: string;
  status: string;
  statusUrl: string;
  streamUrl?: string;
};

export type AgentAnalysisRequestOptions = {
  requestId?: string;
  signal?: AbortSignal;
  onAccepted?: (accepted: AgentAnalysisAccepted) => void;
};

export type AgentEntityResolveStatus = "confirmed" | "not_found" | "ambiguous" | "unsupported";

export type AgentEntityResolveResponse = {
  status: AgentEntityResolveStatus;
  chartShortcut: boolean;
  chartAction?: "replace" | "add" | "none";
  chartPlacementIntent?: "top" | "bottom" | "left" | "right" | "center";
  symbol?: string;
  symbols?: string[];
  canonicalName?: string;
  matchedText?: string;
  matchedAlias?: string;
  confidence?: number;
  entityType?: string;
  reason?: string;
};

export type AgentLayoutResolveStatus = "ui_layout" | "ui_clarify" | "not_ui" | "failed";

export type AgentLayoutResolveResponse = {
  status: AgentLayoutResolveStatus;
  summary: string;
  rationale?: string;
  analysisId?: string;
  route: IntentRoute | null;
  layoutProposal: AgentLayoutProposal | null;
  agentTrace: Record<string, unknown>;
};

export async function requestAgentAnalysis({ symbol, prompt }: AgentAnalysisRequest): Promise<AgentAnalysisReport> {
  return requestAgentAnalysisPayload({
    symbol,
    intent: prompt,
    routerMode: "hybrid",
    messages: [{ role: "user", content: prompt }]
  });
}

export async function requestAgentAnalysisPayload(payload: unknown, options: AgentAnalysisRequestOptions = {}): Promise<AgentAnalysisReport> {
  const requestId = options.requestId ?? makeAgentRequestId();
  const response = await fetch("/api/agents/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey()
    },
    body: JSON.stringify(payloadWithRequestId(payload, requestId)),
    signal: options.signal
  });
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, responsePayload, "Agent analysis API"));
  }
  const accepted = normalizeAgentAccepted(responsePayload);
  if (accepted) {
    options.onAccepted?.(accepted);
  }
  return waitForAgentAnalysisReport(responsePayload, options.signal);
}

export function formatAgentAnalysisForChat(report: AgentAnalysisReport): string {
  return formatAgentAnalysisReport(report);
}

export async function resolveAgentLayoutCommand(payload: unknown): Promise<AgentLayoutResolveResponse | null> {
  try {
    const response = await fetch("/api/agents/layout/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const responsePayload = await response.json().catch(() => null);
    if (!response.ok) {
      return null;
    }
    return normalizeAgentLayoutResolveResponse(responsePayload);
  } catch {
    return null;
  }
}

export async function resolveAgentChartShortcut(query: string): Promise<AgentEntityResolveResponse | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  const params = new URLSearchParams({ q: trimmed, mode: "chartShortcut" });
  try {
    const response = await fetch(`/api/agents/entities/resolve?${params.toString()}`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    return normalizeAgentEntityResolveResponse(await response.json() as unknown);
  } catch {
    return null;
  }
}

export async function cancelAgentAnalysis(analysisId: string): Promise<AgentAnalysisReport | null> {
  const requestId = analysisId.trim();
  if (!requestId) {
    return null;
  }
  const response = await fetch(`/api/agents/reports/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, "Agent cancel API"));
  }
  return normalizeAgentAnalysisPayload(payload);
}

export function createAgentAnalysisRequestId(): string {
  return makeAgentRequestId();
}

export function isAgentRequestAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function normalizeAgentLayoutResolveResponse(payload: unknown): AgentLayoutResolveResponse {
  const source = readObject(payload);
  const rawStatus = readString(source?.status);
  const status = rawStatus && AGENT_LAYOUT_RESOLVE_STATUSES.has(rawStatus as AgentLayoutResolveStatus)
    ? rawStatus as AgentLayoutResolveStatus
    : "failed";
  return {
    status,
    summary: readString(source?.summary) ?? "",
    rationale: readString(source?.rationale) ?? undefined,
    analysisId: readString(source?.analysisId) ?? undefined,
    route: normalizeIntentRoute(source?.route),
    layoutProposal: normalizeLayoutProposal(source?.layoutProposal),
    agentTrace: readObject(source?.agentTrace) ?? {}
  };
}

export function normalizeAgentEntityResolveResponse(payload: unknown): AgentEntityResolveResponse {
  const source = readObject(payload);
  const rawStatus = readString(source?.status);
  const status = rawStatus && AGENT_ENTITY_RESOLVE_STATUSES.has(rawStatus as AgentEntityResolveStatus)
    ? rawStatus as AgentEntityResolveStatus
    : "unsupported";
  return {
    status,
    chartShortcut: source?.chartShortcut === true,
    chartAction: readChartAction(source?.chartAction),
    chartPlacementIntent: readChartPlacementIntent(source?.chartPlacementIntent),
    symbol: readString(source?.symbol) ?? undefined,
    symbols: readArray(source?.symbols).map(readString).filter((item): item is string => Boolean(item)),
    canonicalName: readString(source?.canonicalName) ?? undefined,
    matchedText: readString(source?.matchedText) ?? undefined,
    matchedAlias: readString(source?.matchedAlias) ?? undefined,
    confidence: readNumber(source?.confidence) ?? undefined,
    entityType: readString(source?.entityType) ?? undefined,
    reason: readString(source?.reason) ?? undefined
  };
}

function readChartAction(value: unknown): AgentEntityResolveResponse["chartAction"] {
  return value === "replace" || value === "add" || value === "none" ? value : undefined;
}

function readChartPlacementIntent(value: unknown): AgentEntityResolveResponse["chartPlacementIntent"] {
  return value === "top" || value === "bottom" || value === "left" || value === "right" || value === "center" ? value : undefined;
}

function normalizeIntentRoute(value: unknown): IntentRoute | null {
  const source = readObject(value);
  const sourceName = readString(source?.source);
  const intentType = readString(source?.intentType);
  if (!source || !sourceName || !intentType) {
    return null;
  }
  return {
    source: sourceName,
    intentType,
    selectedRoles: readArray(source.selectedRoles).filter((item): item is string => typeof item === "string"),
    confidence: readNumber(source.confidence) ?? undefined,
    reason: readString(source.reason) ?? undefined
  };
}

async function waitForAgentAnalysisReport(payload: unknown, signal?: AbortSignal): Promise<AgentAnalysisReport> {
  throwIfAborted(signal);
  let report = normalizeAgentAnalysisPayload(payload);
  if (isTerminalAgentReport(report)) {
    return report;
  }

  const streamUrl = resolveAgentReportStreamUrl(payload);
  if (streamUrl && typeof EventSource !== "undefined") {
    try {
      return await waitForAgentAnalysisReportStream(streamUrl, signal);
    } catch (error) {
      if (isAgentRequestAbortError(error)) {
        throw error;
      }
      // Redis/SSE may be unavailable in local and compatibility deployments.
    }
  }

  const statusUrl = resolveAgentReportStatusUrl(payload, report);
  const deadline = Date.now() + AGENT_REPORT_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await sleep(AGENT_REPORT_POLL_INTERVAL_MS, signal);
    const response = await fetch(statusUrl, { headers: { Accept: "application/json" }, signal });
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

function waitForAgentAnalysisReportStream(streamUrl: string, signal?: AbortSignal): Promise<AgentAnalysisReport> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const source = new EventSource(streamUrl);
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new Error("Agent report stream timed out.")));
    }, AGENT_REPORT_POLL_TIMEOUT_MS);

    const finish = (complete: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      source.close();
      signal?.removeEventListener("abort", handleAbort);
      complete();
    };

    const handleAbort = () => {
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    source.addEventListener("report", (event) => {
      try {
        const report = normalizeAgentAnalysisPayload(JSON.parse(event.data) as unknown);
        if (isTerminalAgentReport(report)) {
          finish(() => resolve(report));
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error("Agent report stream payload is invalid.")));
      }
    });
    source.addEventListener("timeout", () => {
      finish(() => reject(new Error("Agent report stream timed out.")));
    });
    source.onerror = () => {
      finish(() => reject(new Error("Agent report stream failed.")));
    };
  });
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
    tradeConditionProposals: [],
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
  if (status === "canceled") {
    return "AI 분석을 중단했습니다.";
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

function resolveAgentReportStreamUrl(payload: unknown): string | null {
  const source = readObject(payload);
  return readString(source?.stream_url) ?? readString(source?.streamUrl);
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

function makeAgentRequestId(): string {
  return `agent-request-${makeIdempotencyKey().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

function payloadWithRequestId(payload: unknown, requestId: string): unknown {
  const source = readObject(payload);
  if (!source) {
    return payload;
  }
  return {
    ...source,
    requestId,
    analysisId: readString(source.analysisId) ?? requestId
  };
}

function normalizeAgentAccepted(payload: unknown): AgentAnalysisAccepted | null {
  const report = normalizeAgentAnalysisPayload(payload);
  const source = readObject(payload);
  const statusUrl = readString(source?.status_url) ?? readString(source?.statusUrl) ?? `/api/agents/reports/${encodeURIComponent(report.analysisId)}`;
  return {
    analysisId: report.analysisId,
    status: report.status ?? "unknown",
    statusUrl,
    streamUrl: readString(source?.stream_url) ?? readString(source?.streamUrl) ?? undefined
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
