import type { MarketIndexItem } from "./indicesApi";
import type { SimulatorStatus } from "../simulator/simulatorApi";

export type RelatedIndexRelType = "constituent" | "sector" | "macro";

export type RelatedIndexEvidence = {
  label: string;
  value: string;
};

export type RelatedIndexCommentary = {
  title: string;
  body: string;
  evidence: RelatedIndexEvidence[];
  source: "template" | "llm";
  generatedAt: string;
};

export type RelatedIndexItem = MarketIndexItem & {
  relType: RelatedIndexRelType;
  relLabel: string;
  correlation60d?: number;
  weightPct?: number;
  companyChangePercent?: number;
  commentary: RelatedIndexCommentary;
};

export type RelatedIndicesPayload = {
  source: string;
  cacheStatus: "fresh" | "stale" | "miss";
  warning?: string;
  symbol: string;
  companyName: string;
  generatedAt: string;
  coverage: {
    selected: number;
    priced: number;
    missing: string[];
  };
  items: RelatedIndexItem[];
  simulation?: boolean;
  datasetId?: string;
  runId?: string;
  virtualTime?: string;
};

type RawRecord = Record<string, unknown>;

export function relatedIndicesSimulatorContextKey(
  status: Pick<SimulatorStatus, "mode" | "runId"> | null
): string {
  if (status === null) {
    return "unknown";
  }
  return status.mode === "simulation" ? `simulation:${status.runId ?? "pending"}` : "live";
}

export async function fetchRelatedIndices(symbol: string, signal?: AbortSignal): Promise<RelatedIndicesPayload> {
  const params = new URLSearchParams({ symbol: symbol.trim().toUpperCase() });
  const response = await fetch(`/api/market/indices/related?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`관련 지수 API 응답 오류 ${response.status}`);
  }
  return normalizeRelatedIndicesPayload(payload);
}

export async function fetchRelatedIndexCommentary(
  payload: RelatedIndicesPayload,
  item: RelatedIndexItem,
  signal?: AbortSignal
): Promise<RelatedIndexCommentary> {
  const response = await fetch("/api/llm/related-index-commentary", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: payload.symbol,
      companyName: payload.companyName,
      indexSymbol: item.symbol,
      indexName: item.name,
      relType: item.relType,
      relLabel: item.relLabel,
      correlation60d: item.correlation60d,
      weightPct: item.weightPct,
      companyChangePercent: item.companyChangePercent,
      indexChangePercent: item.changePercent,
      evidence: item.commentary.evidence,
      templateBody: item.commentary.body
    }),
    signal
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`관련 지수 해설 API 응답 오류 ${response.status}`);
  }
  const source = asRecord(raw);
  const body = asString(source.body);
  if (!body) {
    throw new Error("관련 지수 해설 본문이 없습니다");
  }
  return {
    title: asString(source.title) ?? item.commentary.title,
    body,
    evidence: item.commentary.evidence,
    source: source.source === "llm" ? "llm" : "template",
    generatedAt: asString(source.generatedAt) ?? item.commentary.generatedAt
  };
}

export function normalizeRelatedIndicesPayload(payload: unknown): RelatedIndicesPayload {
  const source = asRecord(payload);
  const coverage = asRecord(source.coverage);
  const items = readArray(source.items)
    .map(normalizeRelatedIndexItem)
    .filter((item): item is RelatedIndexItem => Boolean(item))
    .slice(0, 4);
  return {
    source: asString(source.source) ?? "market-indices-related",
    cacheStatus: normalizeCacheStatus(source.cacheStatus),
    warning: asString(source.warning),
    symbol: asString(source.symbol) ?? "",
    companyName: asString(source.companyName) ?? asString(source.symbol) ?? "",
    generatedAt: asString(source.generatedAt) ?? "",
    coverage: {
      selected: asNumber(coverage.selected) ?? items.length,
      priced: asNumber(coverage.priced) ?? items.length,
      missing: readArray(coverage.missing).map(asString).filter((value): value is string => Boolean(value))
    },
    items,
    simulation: source.simulation === true,
    datasetId: asString(source.datasetId),
    runId: asString(source.runId),
    virtualTime: asString(source.virtualTime)
  };
}

function normalizeRelatedIndexItem(value: unknown): RelatedIndexItem | null {
  const source = asRecord(value);
  const symbol = asString(source.symbol);
  const relType = normalizeRelType(source.relType);
  const commentary = normalizeCommentary(source.commentary);
  if (!symbol || !relType || !commentary || asNumber(source.price) === undefined) {
    return null;
  }
  return {
    symbol,
    name: asString(source.name) ?? symbol,
    assetClass: asString(source.assetClass) ?? "equity_index",
    group: asString(source.group) ?? "Market",
    currency: asString(source.currency) ?? "",
    unit: asString(source.unit) ?? "",
    price: asNumber(source.price),
    open: asNumber(source.open),
    high: asNumber(source.high),
    low: asNumber(source.low),
    previousClose: asNumber(source.previousClose),
    change: asNumber(source.change),
    changePercent: asNumber(source.changePercent),
    sparkline: readArray(source.sparkline).map(asNumber).filter((item): item is number => item !== undefined),
    updatedAt: asString(source.updatedAt),
    status: asString(source.status) ?? "unknown",
    relType,
    relLabel: asString(source.relLabel) ?? relationshipFallback(relType),
    correlation60d: asNumber(source.correlation60d),
    weightPct: asNumber(source.weightPct),
    companyChangePercent: asNumber(source.companyChangePercent),
    commentary
  };
}

function normalizeCommentary(value: unknown): RelatedIndexCommentary | null {
  const source = asRecord(value);
  const body = asString(source.body);
  if (!body) {
    return null;
  }
  const evidence = readArray(source.evidence)
    .map((candidate) => {
      const item = asRecord(candidate);
      const label = asString(item.label);
      const evidenceValue = asString(item.value);
      return label && evidenceValue ? { label, value: evidenceValue } : null;
    })
    .filter((item): item is RelatedIndexEvidence => Boolean(item))
    .slice(0, 4);
  return {
    title: asString(source.title) ?? "왜 이 지수를 보여줬나요?",
    body,
    evidence,
    source: source.source === "llm" ? "llm" : "template",
    generatedAt: asString(source.generatedAt) ?? ""
  };
}

function normalizeRelType(value: unknown): RelatedIndexRelType | null {
  return value === "constituent" || value === "sector" || value === "macro" ? value : null;
}

function relationshipFallback(type: RelatedIndexRelType): string {
  return type === "constituent" ? "편입 지수" : type === "sector" ? "업종 지수" : "거시 지표";
}

function normalizeCacheStatus(value: unknown): RelatedIndicesPayload["cacheStatus"] {
  return value === "fresh" || value === "stale" || value === "miss" ? value : "miss";
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
