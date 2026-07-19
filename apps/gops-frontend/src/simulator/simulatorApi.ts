export type SimulatorMode = "live" | "simulation";
export type SimulatorState = "idle" | "ready" | "running" | "paused" | "completed";
export type SimulatorSpeed = 1 | 2 | 5 | 10;
export type SimulatorAction = "start" | "pause" | "resume" | "restart";

export const simulatorSpeeds: readonly SimulatorSpeed[] = [1, 2, 5, 10];

export function normalizeSimulatorSpeed(value: unknown): SimulatorSpeed {
  const numeric = Number(value);
  if (simulatorSpeeds.includes(numeric as SimulatorSpeed)) {
    return numeric as SimulatorSpeed;
  }
  return numeric === 20 || numeric === 60 || numeric === 300 ? 10 : 1;
}

export type SimulatorSymbolStatus = {
  symbol: string;
  price?: number | null;
  changePercent?: number | null;
};

export type SimulatorHeatmapItem = {
  symbol: string;
  lastPrice?: number | null;
  changePercent: number | null;
  priceSource?: string | null;
  priceUpdatedAt?: string | null;
};

export type SimulatorStatus = {
  available: boolean;
  mode: SimulatorMode;
  state: SimulatorState;
  datasetId: string;
  phase?: string | null;
  scenarioTitle?: string | null;
  activeCutoff?: string | null;
  recommendations?: unknown;
  runId?: string | null;
  virtualTime: string;
  startTime: string;
  endTime: string;
  requestedSpeed: SimulatorSpeed;
  effectiveSpeed: number;
  processedEventCount: number;
  totalEventCount: number;
  progress: number;
  lagMs: number;
  symbols: SimulatorSymbolStatus[];
  detail?: string;
};

export type SimulatorQuote = {
  symbol: string;
  bid: number;
  ask: number;
  runId?: string | null;
};

export const simulatorStatusEvent = "gops:simulator-status";
export const simulatorActivePollIntervalMs = 1_000;
export const simulatorIdlePollIntervalMs = 30_000;
const portfolioRefreshListeners = new Set<() => void>();
let latestPublishedSimulatorStatus: SimulatorStatus | null = null;
let latestPublishedSimulatorStatusAtMs: number | null = null;

export function simulatorStatusPollIntervalMs(status: Pick<SimulatorStatus, "available" | "mode" | "state">): number {
  return status.available && status.mode === "simulation" && status.state === "running"
    ? simulatorActivePollIntervalMs
    : simulatorIdlePollIntervalMs;
}

export function shouldResetMarketDataForSimulatorTransition(
  previousMode: SimulatorMode,
  nextMode: SimulatorMode,
  previousRunId?: string | null,
  nextRunId?: string | null
): boolean {
  return previousMode !== nextMode
    || (nextMode === "simulation" && previousRunId != null && previousRunId !== nextRunId);
}

export function simulationHeatmapItems<T extends SimulatorHeatmapItem>(
  items: readonly T[],
  status: Pick<SimulatorStatus, "mode" | "virtualTime" | "symbols">
): T[] {
  if (status.mode !== "simulation" || status.symbols.length === 0) {
    return [...items];
  }
  const updates = new Map(status.symbols.map((item) => [item.symbol.trim().toUpperCase(), item]));
  return items
    .filter((item) => updates.has(item.symbol.trim().toUpperCase()))
    .map((item) => {
      const update = updates.get(item.symbol.trim().toUpperCase());
      const price = Number.isFinite(update?.price) ? Number(update?.price) : null;
      const changePercent = Number.isFinite(update?.changePercent) ? Number(update?.changePercent) : null;
      return {
        ...item,
        lastPrice: price,
        changePercent,
        priceSource: price == null ? null : "gops-simulator",
        priceUpdatedAt: price == null ? null : status.virtualTime
      };
    });
}

export function simulatorPrimaryAction(
  status: Pick<SimulatorStatus, "mode" | "state">
): Extract<SimulatorAction, "start" | "pause" | "resume"> {
  if (status.mode === "live") return "start";
  return status.state === "ready" || status.state === "paused" ? "resume" : "pause";
}

export function subscribePortfolioRefresh(listener: () => void): () => void {
  portfolioRefreshListeners.add(listener);
  return () => portfolioRefreshListeners.delete(listener);
}

export function requestPortfolioRefresh(): void {
  portfolioRefreshListeners.forEach((listener) => listener());
}

export function formatSimulatorVirtualTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "--/-- --:--:--";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "--";
  return `${valueFor("month")}/${valueFor("day")} ${valueFor("hour")}:${valueFor("minute")}:${valueFor("second")}`;
}

export function simulationAwareNowMs(
  wallNowMs = Date.now(),
  status: SimulatorStatus | null = latestPublishedSimulatorStatus,
  observedAtMs: number | null = latestPublishedSimulatorStatusAtMs
): number {
  if (status?.mode !== "simulation") {
    return wallNowMs;
  }
  const virtualTimeMs = Date.parse(status.virtualTime);
  if (!Number.isFinite(virtualTimeMs)) {
    return wallNowMs;
  }
  if (status.state !== "running" || observedAtMs === null || !Number.isFinite(observedAtMs)) {
    return virtualTimeMs;
  }
  const elapsedWallMs = Math.max(0, wallNowMs - observedAtMs);
  const effectiveSpeed = Number.isFinite(status.effectiveSpeed)
    ? Math.max(0, status.effectiveSpeed)
    : 0;
  const extrapolatedMs = virtualTimeMs + elapsedWallMs * effectiveSpeed;
  const endTimeMs = Date.parse(status.endTime);
  return Number.isFinite(endTimeMs) ? Math.min(extrapolatedMs, endTimeMs) : extrapolatedMs;
}

export async function fetchSimulatorStatus(signal?: AbortSignal): Promise<SimulatorStatus> {
  return normalizeSimulatorStatus(await requestJson<SimulatorStatus>("/api/simulator/status", { signal }));
}

export async function fetchSimulatorQuote(symbol: string, signal?: AbortSignal): Promise<SimulatorQuote> {
  const params = new URLSearchParams({ symbol: symbol.trim().toUpperCase() });
  return requestJson<SimulatorQuote>(`/api/simulator/quote?${params.toString()}`, { signal });
}

export async function setSimulatorMode(mode: SimulatorMode): Promise<SimulatorStatus> {
  return normalizeSimulatorStatus(await requestJson<SimulatorStatus>("/api/simulator/mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  }));
}

export async function runSimulatorAction(action: SimulatorAction): Promise<SimulatorStatus> {
  return normalizeSimulatorStatus(await requestJson<SimulatorStatus>("/api/simulator/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  }));
}

export async function setSimulatorSpeed(speed: SimulatorSpeed): Promise<SimulatorStatus> {
  return normalizeSimulatorStatus(await requestJson<SimulatorStatus>("/api/simulator/speed", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed })
  }));
}

export function publishSimulatorStatus(status: SimulatorStatus): void {
  latestPublishedSimulatorStatus = status;
  latestPublishedSimulatorStatusAtMs = Date.now();
  window.dispatchEvent(new CustomEvent<SimulatorStatus>(simulatorStatusEvent, { detail: status }));
}

export function latestSimulatorStatus(): SimulatorStatus | null {
  return latestPublishedSimulatorStatus;
}

function normalizeSimulatorStatus(status: SimulatorStatus): SimulatorStatus {
  return {
    ...status,
    requestedSpeed: normalizeSimulatorSpeed(status.requestedSpeed)
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail ?? `시뮬레이터 API 오류 ${response.status}`);
  }
  return payload as T;
}
