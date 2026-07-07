import { normalizeSector, normalizeSectorList, sectorLabelKo } from "../market/sectors";

export type RiskLevel = "conservative" | "balanced" | "aggressive";
export type RecommendationSessionMode = "pre" | "regular";
export type RecommendationStatus = "profile_required" | "market_closed" | "loading" | "empty" | "ready" | "stale" | "error" | "completed";

export type InvestmentProfile = {
  riskLevel: RiskLevel;
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

export type StockRecommendationItem = {
  symbol: string;
  action: "buy";
  rank: number;
  score: number;
  confidence: number;
  sector?: string;
  sectorLabelKo?: string;
  reasons: RecommendationReason[];
  riskWarnings: string[];
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
  const params = new URLSearchParams({ sessionMode });
  return normalizeRecommendationPayload(await apiJson(`/api/recommendations/stocks/latest?${params.toString()}`, { signal }));
}

export async function refreshStockRecommendations(
  activeSymbol?: string,
  sessionMode: RecommendationSessionMode = "regular",
  signal?: AbortSignal
): Promise<StockRecommendationPayload> {
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
  return {
    symbol,
    action: "buy",
    rank: asNumber(source.rank) ?? 0,
    score: asNumber(source.score) ?? 0,
    confidence: asNumber(source.confidence) ?? 0,
    sector,
    sectorLabelKo: asString(source.sectorLabelKo) || sectorLabelKo(sector),
    reasons: Array.isArray(source.reasons)
      ? source.reasons.map(normalizeReason).filter((item): item is RecommendationReason => Boolean(item))
      : [],
    riskWarnings: Array.isArray(source.riskWarnings) ? source.riskWarnings.map((item) => String(item)).filter(Boolean) : [],
    metricsSnapshot: asRecord(source.metricsSnapshot)
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
  const maxDrawdownPct = asNumber(source.maxDrawdownPct ?? source.max_drawdown_pct);
  if (!riskLevel || !["conservative", "balanced", "aggressive"].includes(riskLevel) || !maxDrawdownPct) {
    return null;
  }
  return {
    riskLevel,
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
  if (value === "profile_required" || value === "market_closed" || value === "empty" || value === "stale" || value === "error" || value === "completed") {
    return value;
  }
  return "ready";
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
