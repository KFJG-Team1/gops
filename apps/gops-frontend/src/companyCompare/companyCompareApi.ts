export type CompanyCompareMetricValue = {
  symbol: string;
  value: number | null;
  display: string;
  asOf?: string | null;
  sourceRef?: string;
  quality?: string | null;
};

export type CompanyCompareMetric = {
  id: string;
  label: string;
  unit: string;
  values: CompanyCompareMetricValue[];
};

export type CompanyCompareSectionId =
  | "business_model"
  | "growth_style"
  | "profit_structure"
  | "financial_health"
  | "earnings_stability"
  | "risk_profile"
  | "relationship"
  | "recent_flow";

export type CompanyCompareSection = {
  id: "growth_style" | "profit_structure" | "financial_health" | "earnings_stability";
  heading: string;
  metrics: CompanyCompareMetric[];
};

export type CompanyCompareQualitativeItem = {
  kind: "10k-business" | "10k-risk" | "ontology-theme" | "ontology-relationship" | "news-event";
  symbol?: string | null;
  title: string;
  summary: string;
  details: string[];
  sourceRef: string;
  observedAt?: string | null;
  url?: string | null;
};

export type CompanyCompareQualitativeSection = {
  id: "business_model" | "risk_profile" | "relationship" | "recent_flow";
  heading: string;
  items: CompanyCompareQualitativeItem[];
  evidenceRefs: string[];
};

export type CompanyCompareAlignedFact = {
  id: string;
  label: string;
  unit: string;
  framePeriod: string;
  values: Array<{
    symbol: string;
    value: number | null;
    display: string;
  }>;
};

export type CompanyCompareGrowthChart = {
  type: "grouped-bar";
  unit: "percent";
  categories: Array<{ id: string; label: string }>;
  series: Array<{
    symbol: string;
    values: CompanyCompareMetricValue[];
  }>;
};

export type CompanyCompareResponse = {
  version: "company-compare.v1";
  status: "ready" | "partial";
  baseSymbol: string;
  compareSymbols: string[];
  comparedSymbols: string[];
  question: string | null;
  quantitative: {
    status: "ready" | "partial";
    companies: Array<{
      symbol: string;
      companyName?: string | null;
      fiscalPeriod?: string | null;
      periodEnd?: string | null;
    }>;
    sections: CompanyCompareSection[];
    growthChart: CompanyCompareGrowthChart;
    alignedFacts: CompanyCompareAlignedFact[];
    periodAlignment: {
      basis: "sec-frames";
      status: "aligned" | "unavailable";
      framePeriods: string[];
    };
    missingFundamentals: string[];
    dataGaps: string[];
  };
  qualitative: {
    status: "not-requested" | "ready" | "partial";
    sections: CompanyCompareQualitativeSection[];
    dataGaps: string[];
  };
  narrative: {
    status: "not-requested" | "loading" | "ready" | "failed";
    summary: string | null;
    sections: Array<{ id: CompanyCompareSectionId; heading: string; analysis: string; evidenceRefs: string[] }>;
    insights: string[];
    dataGaps: string[];
    validationWarnings?: string[];
    cache?: {
      status: "hit" | "miss";
      version: "company-compare-cache.v1";
      ttlSeconds: number;
    };
  };
  sources: Array<{
    id: string;
    label: string;
    symbol: string;
    asOf?: string | null;
    accession?: string | null;
    url?: string | null;
  }>;
  dataGaps: string[];
  createdByAgentId: string;
};

export type CompanyCompareCandidate = {
  symbol: string;
  companyName?: string | null;
  relationType: "same-theme";
  themes: string[];
};

export type CompanyCompareCandidatesResponse = {
  symbol: string;
  candidates: CompanyCompareCandidate[];
  dataGaps: string[];
};

export class CompanyCompareApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CompanyCompareApiError";
  }
}

export async function requestCompanyCompare(
  input: { baseSymbol: string; compareSymbols: string[]; question?: string },
  signal?: AbortSignal
): Promise<CompanyCompareResponse> {
  const response = await fetch("/api/llm/company-compare", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CompanyCompareApiError(response.status, readErrorMessage(payload, "기업 비교 데이터를 불러오지 못했습니다"));
  }
  return payload as CompanyCompareResponse;
}

export async function requestCompanyCompareQuantitative(
  input: { baseSymbol: string; compareSymbols: string[]; question?: string },
  signal?: AbortSignal
): Promise<CompanyCompareResponse> {
  const response = await fetch("/api/llm/company-compare/quantitative", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CompanyCompareApiError(response.status, readErrorMessage(payload, "기업 정량 비교를 불러오지 못했습니다"));
  }
  return payload as CompanyCompareResponse;
}

export async function requestCompanyCompareCandidates(
  symbol: string,
  signal?: AbortSignal
): Promise<CompanyCompareCandidatesResponse> {
  const response = await fetch(`/api/llm/company-compare/candidates?symbol=${encodeURIComponent(symbol)}`, {
    credentials: "same-origin",
    signal
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CompanyCompareApiError(response.status, readErrorMessage(payload, "비교 후보를 불러오지 못했습니다"));
  }
  return payload as CompanyCompareCandidatesResponse;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}
