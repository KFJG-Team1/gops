import { normalizeSector, normalizeSectorList, sectorLabelKo } from "../market/sectors";
import { latestSimulatorStatus } from "../simulator/simulatorApi";

export type RiskLevel = "conservative" | "balanced" | "aggressive";
export type RecommendationStyle = "momentum" | "balanced" | "stable";
export type RecommendationSessionMode = "pre" | "regular";
export type RecommendationStatus = "profile_required" | "market_closed" | "data_not_ready" | "loading" | "empty" | "ready" | "stale" | "error" | "completed";

export type InvestmentProfile = {
  riskLevel: RiskLevel;
  recommendationStyle: RecommendationStyle;
  horizon: "intraday";
  maxDrawdownPct: number;
  preferredSectors: string[];
  excludedSectors: string[];
  excludedSymbols: string[];
  updatedAt?: string;
};

export type RecommendationReason = {
  type: string;
  text: string;
  weight?: number;
};

export type RecommendationExplanation = {
  version: "recommendation-explanation.v1";
  locale: "ko-KR";
  decisionLabel: string;
  primary: {
    source: "llm" | "deterministic";
    status: "ready" | "fallback";
    headline: string;
    body: string;
    model?: string | null;
    promptVersion?: string | null;
    generatedAt?: string | null;
  };
  deterministic: {
    summary: string;
    evidence: Array<{ code: string; label: string; sentence: string; score: number; contribution: number }>;
    risks: Array<{ code: string; sentence: string; penalty?: number }>;
    dataQuality: {
      sentence: string;
      evidenceReliability: number;
      confidenceMeaning: "evidence_reliability_not_success_probability";
      cutoff?: string | null;
      missingFactors: string[];
      stale: boolean;
    };
  };
  provenance: {
    algorithmVersion: string;
    ruleSetVersion: string;
    evidenceSnapshotId: string;
    inputDigest: string;
  };
};

export type StockRecommendationItem = {
  symbol: string;
  action: "buy";
  rank: number;
  score: number;
  confidence: number;
  baseAlphaScore?: number;
  extendedBaseAlphaScore?: number;
  styleSignalScore?: number;
  preferenceFitScore?: number;
  preferenceConfidence?: number;
  personalizationDelta?: number;
  portfolioFitScore?: number;
  personalScore?: number;
  fundamentalScore?: number;
  fundamentalWeight?: number;
  fundamentalStatus?: string;
  fundamentalProvenance?: Record<string, unknown>;
  algorithmVersion?: string;
  effectiveWeights?: Record<string, number>;
  riskBudget?: Record<string, unknown>;
  observedRisk?: Record<string, unknown>;
  changePercent?: number;
  sector?: string;
  sectorLabelKo?: string;
  reasons: RecommendationReason[];
  riskWarnings: string[];
  explanation?: RecommendationExplanation;
  metricsSnapshot: Record<string, unknown>;
};

export type StockRecommendationPayload = {
  status: RecommendationStatus;
  runId?: number | string;
  runKey?: string;
  slotStart?: string;
  marketDate?: string;
  generatedAt?: string;
  stale?: boolean;
  idempotentReplay?: boolean;
  items: StockRecommendationItem[];
  profile?: InvestmentProfile | null;
  summary?: Record<string, unknown>;
};

export class RecommendationApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RecommendationApiError";
    this.status = status;
  }
}

export async function fetchInvestmentProfile(signal?: AbortSignal): Promise<InvestmentProfile | null> {
  const payload = await apiJson("/api/recommendations/profile", { signal });
  return normalizeProfile(asRecord(payload).profile);
}

export async function saveInvestmentProfile(profile: InvestmentProfile): Promise<InvestmentProfile> {
  const payload = await apiJson("/api/recommendations/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });
  const normalized = normalizeProfile(asRecord(payload).profile);
  if (!normalized) {
    throw new RecommendationApiError(500, "투자 설정 응답을 읽지 못했습니다.");
  }
  return normalized;
}

export async function fetchStockRecommendations(sessionMode: RecommendationSessionMode = "regular", signal?: AbortSignal): Promise<StockRecommendationPayload> {
  const simulatorStatus = latestSimulatorStatus();
  if (simulatorStatus?.mode === "simulation" && simulatorStatus.recommendations) {
    return normalizeRecommendationPayload(simulatorStatus.recommendations);
  }
  const params = new URLSearchParams({ sessionMode });
  return normalizeRecommendationPayload(await apiJson(`/api/recommendations/stocks/latest?${params.toString()}`, { signal }));
}

export async function refreshStockRecommendations(
  activeSymbol?: string,
  sessionMode: RecommendationSessionMode = "regular",
  signal?: AbortSignal
): Promise<StockRecommendationPayload> {
  const simulatorStatus = latestSimulatorStatus();
  if (simulatorStatus?.mode === "simulation" && simulatorStatus.recommendations) {
    return normalizeRecommendationPayload(simulatorStatus.recommendations);
  }
  return normalizeRecommendationPayload(await apiJson("/api/recommendations/stocks/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeSymbol, sessionMode }),
    signal
  }));
}

function normalizeRecommendationPayload(value: unknown): StockRecommendationPayload {
  const source = asRecord(value);
  const status = normalizeStatus(source.status);
  return {
    status,
    runId: asString(source.runId) ?? asNumber(source.runId),
    runKey: asString(source.runKey),
    slotStart: asString(source.slotStart),
    marketDate: asString(source.marketDate),
    generatedAt: asString(source.generatedAt),
    stale: source.stale === true || status === "stale",
    idempotentReplay: source.idempotentReplay === true,
    items: Array.isArray(source.items)
      ? source.items.map(normalizeRecommendationItem).filter((item): item is StockRecommendationItem => Boolean(item))
      : [],
    profile: normalizeProfile(source.profile),
    summary: asRecord(source.summary)
  };
}

function normalizeRecommendationItem(value: unknown): StockRecommendationItem | null {
  const source = asRecord(value);
  const symbol = asString(source.symbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }
  const sector = normalizeSector(asString(source.sector));
  const metricsSnapshot = asRecord(source.metricsSnapshot);
  return {
    symbol,
    action: "buy",
    rank: asNumber(source.rank) ?? 0,
    score: asNumber(source.score) ?? 0,
    confidence: asNumber(source.confidence) ?? 0,
    baseAlphaScore: asNumber(source.baseAlphaScore) ?? asNumber(metricsSnapshot.baseAlphaScore),
    extendedBaseAlphaScore: asNumber(source.extendedBaseAlphaScore) ?? asNumber(metricsSnapshot.extendedBaseAlphaScore),
    styleSignalScore: asNumber(source.styleSignalScore) ?? asNumber(metricsSnapshot.styleSignalScore),
    preferenceFitScore: asNumber(source.preferenceFitScore) ?? asNumber(metricsSnapshot.preferenceFitScore),
    preferenceConfidence: asNumber(source.preferenceConfidence) ?? asNumber(metricsSnapshot.preferenceConfidence),
    personalizationDelta: asNumber(source.personalizationDelta) ?? asNumber(metricsSnapshot.personalizationDelta),
    portfolioFitScore: asNumber(source.portfolioFitScore) ?? asNumber(metricsSnapshot.portfolioFitScore),
    personalScore: asNumber(source.personalScore) ?? asNumber(metricsSnapshot.personalScore),
    fundamentalScore: asNumber(source.fundamentalScore) ?? asNumber(metricsSnapshot.fundamentalScore),
    fundamentalWeight: asNumber(source.fundamentalWeight) ?? asNumber(metricsSnapshot.fundamentalWeight),
    fundamentalStatus: asString(source.fundamentalStatus) ?? asString(metricsSnapshot.fundamentalStatus),
    fundamentalProvenance: asRecord(source.fundamentalProvenance ?? metricsSnapshot.fundamentalProvenance),
    algorithmVersion: asString(source.algorithmVersion) ?? asString(metricsSnapshot.algorithmVersion),
    effectiveWeights: numberRecord(source.effectiveWeights ?? metricsSnapshot.effectiveWeights),
    riskBudget: asRecord(source.riskBudget ?? metricsSnapshot.riskBudget),
    observedRisk: asRecord(source.observedRisk ?? metricsSnapshot.observedRisk),
    changePercent: asNumber(source.changePercent) ?? asNumber(metricsSnapshot.changePercent),
    sector,
    sectorLabelKo: asString(source.sectorLabelKo) || sectorLabelKo(sector),
    reasons: Array.isArray(source.reasons)
      ? source.reasons.map(normalizeReason).filter((item): item is RecommendationReason => Boolean(item))
      : [],
    riskWarnings: Array.isArray(source.riskWarnings) ? source.riskWarnings.map((item) => String(item)).filter(Boolean) : [],
    explanation: normalizeExplanation(source.explanation),
    metricsSnapshot
  };
}

function normalizeReason(value: unknown): RecommendationReason | null {
  const source = asRecord(value);
  const text = asString(source.text);
  if (!text) {
    return null;
  }
  return {
    type: asString(source.type) || "reason",
    text,
    weight: asNumber(source.weight)
  };
}

function normalizeProfile(value: unknown): InvestmentProfile | null {
  const source = asRecord(value);
  const riskLevel = asString(source.riskLevel ?? source.risk_level) as RiskLevel | undefined;
  const recommendationStyle = (asString(source.recommendationStyle ?? source.recommendation_style) || "balanced") as RecommendationStyle;
  const maxDrawdownPct = asNumber(source.maxDrawdownPct ?? source.max_drawdown_pct);
  if (!riskLevel || !["conservative", "balanced", "aggressive"].includes(riskLevel) || !["momentum", "balanced", "stable"].includes(recommendationStyle) || !maxDrawdownPct) {
    return null;
  }
  return {
    riskLevel,
    recommendationStyle,
    horizon: "intraday",
    maxDrawdownPct,
    preferredSectors: normalizeSectorList(stringArray(source.preferredSectors ?? source.preferred_sectors)),
    excludedSectors: normalizeSectorList(stringArray(source.excludedSectors ?? source.excluded_sectors)),
    excludedSymbols: stringArray(source.excludedSymbols ?? source.excluded_symbols).map((item) => item.toUpperCase()),
    updatedAt: asString(source.updatedAt ?? source.updated_at)
  };
}

async function apiJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RecommendationApiError(response.status, readApiErrorMessage(response, payload));
  }
  return payload;
}

function readApiErrorMessage(response: Response, payload: unknown): string {
  const detail = asRecord(payload).detail;
  if (response.status === 503 && detail === "recommendation database migration required") {
    return "추천 설정 DB 준비가 필요합니다.";
  }
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  return `추천 API 오류: ${response.status}`;
}

function normalizeStatus(value: unknown): RecommendationStatus {
  if (value === "profile_required" || value === "market_closed" || value === "data_not_ready" || value === "empty" || value === "stale" || value === "error" || value === "completed") {
    return value;
  }
  return "ready";
}

function normalizeExplanation(value: unknown): RecommendationExplanation | undefined {
  const source = asRecord(value);
  if (source.version !== "recommendation-explanation.v1") return undefined;
  const primary = asRecord(source.primary);
  const deterministic = asRecord(source.deterministic);
  const dataQuality = asRecord(deterministic.dataQuality);
  const provenance = asRecord(source.provenance);
  const evidence = Array.isArray(deterministic.evidence) ? deterministic.evidence.map((value) => {
    const row = asRecord(value);
    const score = asNumber(row.score);
    const contribution = asNumber(row.contribution);
    if (!asString(row.code) || !asString(row.label) || !asString(row.sentence) || score === undefined || contribution === undefined) return null;
    return { code: String(row.code), label: String(row.label), sentence: String(row.sentence), score, contribution };
  }).filter((row): row is NonNullable<typeof row> => row !== null) : [];
  const risks = Array.isArray(deterministic.risks) ? deterministic.risks.map((value) => {
    const row = asRecord(value);
    if (!asString(row.code) || !asString(row.sentence)) return null;
    return { code: String(row.code), sentence: String(row.sentence), penalty: asNumber(row.penalty) };
  }).filter((row): row is NonNullable<typeof row> => row !== null) : [];
  const reliability = asNumber(dataQuality.evidenceReliability);
  if (!asString(primary.headline) || !asString(primary.body) || reliability === undefined) return undefined;
  return {
    version: "recommendation-explanation.v1",
    locale: "ko-KR",
    decisionLabel: asString(source.decisionLabel) || "매수 관찰",
    primary: {
      source: primary.source === "llm" ? "llm" : "deterministic",
      status: primary.status === "ready" ? "ready" : "fallback",
      headline: String(primary.headline), body: String(primary.body),
      model: asString(primary.model), promptVersion: asString(primary.promptVersion), generatedAt: asString(primary.generatedAt)
    },
    deterministic: {
      summary: asString(deterministic.summary) || "",
      evidence, risks,
      dataQuality: {
        sentence: asString(dataQuality.sentence) || "",
        evidenceReliability: reliability,
        confidenceMeaning: "evidence_reliability_not_success_probability",
        cutoff: asString(dataQuality.cutoff),
        missingFactors: stringArray(dataQuality.missingFactors),
        stale: dataQuality.stale === true
      }
    },
    provenance: {
      algorithmVersion: asString(provenance.algorithmVersion) || "",
      ruleSetVersion: asString(provenance.ruleSetVersion) || "",
      evidenceSnapshotId: asString(provenance.evidenceSnapshotId) || "",
      inputDigest: asString(provenance.inputDigest) || ""
    }
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numberRecord(value: unknown): Record<string, number> {
  const source = asRecord(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, item]) => [key, asNumber(item)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
  );
}
