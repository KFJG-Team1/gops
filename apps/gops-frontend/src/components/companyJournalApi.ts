export type CompanyJournalAnalystAction = {
  firm: string;
  action: string;
  fromGrade: string;
  toGrade: string;
  priorPriceTarget: number | null;
  priceTarget: number | null;
  actionAt: string;
  source: string;
  statement?: string;
  tone?: "positive" | "negative" | "neutral";
};

export type CompanyJournalAnalystSummary = {
  statement: string;
  tone: "positive" | "negative" | "neutral";
  sourceAsOf: string | null;
  collectedAt: string | null;
  source: string;
};

export type CompanyJournalReport = {
  contractVersion: string;
  symbol: string;
  analysisAsOf: string;
  generatedAt: string;
  inputDigest: string;
  headline: string;
  keywords: string[];
  recentMovement: string;
  financialStability: string;
  watchItems: string;
  tabs: Record<string, string>;
  serverMetrics: {
    recentSessions?: number;
    stockReturnPercent?: number | null;
    benchmarkSymbol?: string;
    benchmarkReturnPercent?: number | null;
    relativeReturnPercentagePoints?: number | null;
    financial?: Record<string, number | null>;
  };
  sourceReceipt: Record<string, unknown>;
  missingData: string[];
  validationStatus: string;
  sourceMode?: "historical_reconstruction" | string;
  sourceCutoff?: string;
  simulation?: boolean;
};

export type CompanyJournalResponse = {
  status: "ready" | "pending";
  symbol: string;
  report: CompanyJournalReport | null;
  message?: string;
};

export type CompanyJournalEvidenceResponse = {
  contractVersion: string;
  symbol: string;
  sourceAsOf: string | null;
  cutoff?: string | null;
  financialSeries: import("../market/sp500Universe.seed").CompanyFinancialSeriesPoint[];
  earningsSeries: import("../market/sp500Universe.seed").CompanyEarningsSeriesPoint[];
  performanceSeries: Array<{
    symbol: string;
    candles: import("../chart/types").CandleDto[];
  }>;
  analystSummary: CompanyJournalAnalystSummary | null;
  missingData: string[];
  simulation?: boolean;
  sourceMode?: "historical_reconstruction" | string;
  currentProjectionSources?: string[];
};

function analystSummaryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCompanyJournalAnalystSummary(value: unknown): CompanyJournalAnalystSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const statement = analystSummaryText(row.statement);
  if (!statement) return null;
  const rawTone = analystSummaryText(row.tone);
  const tone = rawTone === "positive" || rawTone === "negative" ? rawTone : "neutral";
  return {
    statement,
    tone,
    sourceAsOf: analystSummaryText(row.sourceAsOf ?? row.source_as_of) || null,
    collectedAt: analystSummaryText(row.collectedAt ?? row.collected_at) || null,
    source: analystSummaryText(row.source) || "yahoo-finance"
  };
}

export async function fetchCompanyJournal(symbol: string, signal?: AbortSignal): Promise<CompanyJournalResponse> {
  const response = await fetch(`/api/company-journal/${encodeURIComponent(symbol)}`, {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(response.status === 503 ? "기업저널 저장소에 연결할 수 없습니다." : `기업저널 응답 오류 ${response.status}`);
  }
  if (!payload || (payload.status !== "ready" && payload.status !== "pending")) {
    throw new Error("기업저널 응답 형식이 올바르지 않습니다.");
  }
  return payload as CompanyJournalResponse;
}

export async function fetchCompanyJournalEvidence(
  symbol: string,
  benchmarks: string[],
  signal?: AbortSignal
): Promise<CompanyJournalEvidenceResponse> {
  const params = new URLSearchParams({ benchmarks: benchmarks.join(",") });
  const response = await fetch(`/api/company-journal/${encodeURIComponent(symbol)}/evidence?${params}`, {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !Array.isArray(payload.financialSeries) || !Array.isArray(payload.earningsSeries)) {
    throw new Error(`기업저널 근거 응답 오류 ${response.status}`);
  }
  return {
    ...payload,
    analystSummary: normalizeCompanyJournalAnalystSummary(payload.analystSummary ?? payload.analyst_summary)
  } as CompanyJournalEvidenceResponse;
}
