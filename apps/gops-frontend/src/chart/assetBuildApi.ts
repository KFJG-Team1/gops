import type { AnalysisAssetInterval, AnalysisAssetStatus } from "./analysisAssetsApi";

export type ChartAssetBuildRequest = {
  symbols: string[] | "sp500";
  intervals: AnalysisAssetInterval[];
  llmEnabled: boolean;
  skipFreshHours: number;
};

export type ChartAssetBuildAccepted = {
  jobId: string;
  status: "queued";
  status_url: string;
  stream_url: string;
};

export type ChartAssetBuildItem = {
  symbol: string;
  interval: AnalysisAssetInterval;
  status: "saved" | "failed" | "skipped";
  stage: string;
  error: string | null;
  elapsedMs: number;
};

export type ChartAssetBuildStatus = {
  jobId: string;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "canceled";
  progress: { total: number; done: number; failed: number; skipped: number; current: string | null };
  recentItems: ChartAssetBuildItem[];
  failedItems?: ChartAssetBuildItem[];
  logs: string[];
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ChartAssetCoverageItem = {
  symbol: string;
  interval: AnalysisAssetInterval;
  generatedAt: string;
  status: AnalysisAssetStatus;
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

export async function fetchChartAssetCoverage(symbols?: string[]): Promise<ChartAssetCoverageItem[]> {
  const query = symbols?.length ? `?${new URLSearchParams({ symbols: symbols.join(",") }).toString()}` : "";
  const response = await apiJson<{ items?: ChartAssetCoverageItem[] }>(`/api/charts/analysis-assets/coverage${query}`);
  return Array.isArray(response.items) ? response.items : [];
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
