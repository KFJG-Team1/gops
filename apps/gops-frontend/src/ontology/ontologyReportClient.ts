import type { AgentEvidenceItem, AnalysisReport } from "./ontologyTypes";

type ImportMetaWithEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

type OntologyReportRequest = {
  symbol: string;
};

const defaultOntologyReportUrl = "/api/agents/analyze";
const reportPollIntervalMs = 1_000;
const reportPollTimeoutMs = 20_000;
const terminalStatuses = new Set(["completed", "deep_completed", "failed", "rejected", "cancelled"]);

export async function requestOntologyReport(
  request: OntologyReportRequest,
  signal?: AbortSignal
): Promise<AnalysisReport | null> {
  const endpoint = ontologyReportEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `ontology-${request.symbol}-${Date.now()}`
    },
    body: JSON.stringify({
      symbol: request.symbol,
      intent: `${request.symbol} ontology relationship analysis`,
      routerMode: "hybrid",
      messages: [{ role: "user", content: `${request.symbol} 온톨로지 관계 분석` }],
      chartContext: { symbol: request.symbol },
      analysisMode: "auto"
    }),
    signal
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json().catch(() => null);
  const report = normalizeAnalysisReport(payload);
  if (isTerminalReport(payload, report)) {
    return report;
  }
  return pollAnalysisReport(resolveReportStatusUrl(payload, report), signal);
}

function ontologyReportEndpoint(): string {
  const env = (import.meta as ImportMetaWithEnv).env;
  return env?.VITE_ONTOLOGY_REPORT_URL?.trim() || defaultOntologyReportUrl;
}

export function normalizeAnalysisReport(payload: unknown): AnalysisReport | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as {
    report?: unknown;
    providerEvidence?: unknown;
    symbol?: unknown;
    generatedAt?: unknown;
    analysisId?: unknown;
    request_id?: unknown;
    status?: unknown;
  };
  const report = source.report && typeof source.report === "object" ? source.report as typeof source : source;
  const providerEvidence = Array.isArray(report.providerEvidence)
    ? report.providerEvidence.filter(isAgentEvidenceItem)
    : [];
  return {
    providerEvidence,
    symbol: typeof report.symbol === "string" ? report.symbol : undefined,
    generatedAt: typeof report.generatedAt === "string" ? report.generatedAt : undefined
  };
}

async function pollAnalysisReport(statusUrl: string | null, signal?: AbortSignal): Promise<AnalysisReport | null> {
  if (!statusUrl) {
    return null;
  }
  const deadline = Date.now() + reportPollTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(reportPollIntervalMs, signal);
    const response = await fetch(statusUrl, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null);
    const report = normalizeAnalysisReport(payload);
    if (isTerminalReport(payload, report)) {
      return report;
    }
  }
  return null;
}

function resolveReportStatusUrl(payload: unknown, report: AnalysisReport | null): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as { status_url?: unknown; statusUrl?: unknown; analysisId?: unknown; request_id?: unknown; report?: unknown };
  const nested = source.report && typeof source.report === "object" ? source.report as { analysisId?: unknown } : null;
  const explicit = readString(source.status_url) ?? readString(source.statusUrl);
  const analysisId = readString(source.analysisId) ?? readString(source.request_id) ?? readString(nested?.analysisId) ?? readString((report as { analysisId?: unknown } | null)?.analysisId);
  return explicit ?? (analysisId ? `/api/agents/reports/${encodeURIComponent(analysisId)}` : null);
}

function isTerminalReport(payload: unknown, report: AnalysisReport | null): boolean {
  if (!payload || typeof payload !== "object") {
    return Boolean(report?.providerEvidence?.length);
  }
  const source = payload as { status?: unknown; report?: unknown };
  const nested = source.report && typeof source.report === "object" ? source.report as { status?: unknown } : null;
  const status = readString(nested?.status) ?? readString(source.status);
  return Boolean(report?.providerEvidence?.length) || !status || terminalStatuses.has(status);
}

function isAgentEvidenceItem(value: unknown): value is AgentEvidenceItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as AgentEvidenceItem;
  return typeof item.provider === "string" && typeof item.status === "string";
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
