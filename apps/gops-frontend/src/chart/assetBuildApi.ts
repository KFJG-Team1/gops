import type { AnalysisAssetInterval, AnalysisAssetStatus } from "./analysisAssetsApi";

export type ChartAssetBuildRequest = {
  assetKind?: "geometry" | "czardas";
  symbols: string[] | "sp500";
  intervals: AnalysisAssetInterval[];
  force?: boolean;
};

export type ChartAssetBuildAccepted = {
  assetKind?: "czardas";
  jobId: string;
  status: "queued";
  status_url: string;
};

export type ChartAssetBuildItem = {
  symbol: string;
  interval: AnalysisAssetInterval;
  status: "saved" | "saved_with_warning" | "unchanged" | "failed" | "skipped";
  stage: string;
  error: string | null;
  elapsedMs: number;
  warning?: string;
  reason?: string;
};

export type ChartAssetBuildStatus = {
  assetKind?: "czardas";
  jobId: string;
  status: "queued" | "running" | "completed" | "completed_with_warnings" | "completed_with_errors" | "failed" | "canceled";
  progress: { total: number; done: number; failed: number; skipped: number; warnings: number; current: string | null };
  repair?: {
    checkedSymbols: number;
    attemptedSymbols: number;
    repairedSymbols: number;
    unavailableSymbols: number;
    missingBarsBefore: number;
    missingBarsAfter: number;
    materializedRows: number;
    reasonCodes?: Record<string, number>;
  };
  recentItems: ChartAssetBuildItem[];
  failedItems?: ChartAssetBuildItem[];
  logs?: string[];
  createdEntities?: number;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ChartAssetCoverageItem = {
  symbol: string;
  interval: AnalysisAssetInterval;
  generatedAt: string;
  status: AnalysisAssetStatus;
  assetVersion?: "geometry";
  assetKind?: "geometry" | "czardas";
  coverageState?: "full" | "partial";
  payloadBytes?: number;
  drawingCount?: number;
  storedDrawingCount?: number;
  freshness?: "current" | "stale" | "unknown";
  staleByBars?: number | null;
};

export type ChartAssetDeleteResult = {
  symbols: string[];
  intervals: AnalysisAssetInterval[];
  deleted: number;
};

export async function submitChartAssetBuild(request: ChartAssetBuildRequest): Promise<ChartAssetBuildAccepted> {
  return apiJson("/api/charts/analysis-assets/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function fetchChartAssetBuildStatus(statusUrl: string): Promise<ChartAssetBuildStatus> {
  return apiJson(statusUrl);
}

export async function cancelChartAssetBuild(jobId: string): Promise<ChartAssetBuildStatus> {
  return apiJson(`/api/charts/analysis-assets/build/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function fetchChartAssetCoverage(symbols?: string[], assetKind: "geometry" | "czardas" = "geometry"): Promise<ChartAssetCoverageItem[]> {
  const params = new URLSearchParams({ assetKind });
  if (symbols?.length) params.set("symbols", symbols.join(","));
  const query = `?${params.toString()}`;
  const response = await apiJson<{ items?: ChartAssetCoverageItem[] }>(`/api/charts/analysis-assets/coverage${query}`);
  return Array.isArray(response.items) ? response.items : [];
}

export async function deleteChartAssets(symbols: string[], intervals: AnalysisAssetInterval[], assetKind: "geometry" | "czardas" = "geometry"): Promise<ChartAssetDeleteResult> {
  const query = new URLSearchParams({ symbols: symbols.join(","), intervals: intervals.join(","), assetKind });
  return apiJson(`/api/charts/analysis-assets?${query.toString()}`, { method: "DELETE" });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}
