export type SimulatorMode = "live" | "simulation";

export type SimulatorSymbolStatus = {
  symbol: string;
  price?: number | null;
  seedPrice?: number | null;
  changePercent?: number | null;
};

export type SimulatorPhase = {
  id: string;
  label: string;
  atSeconds: number;
  summary?: string;
};

export type SimulatorStatus = {
  available: boolean;
  mode: SimulatorMode;
  state: "idle" | "running" | "paused" | "completed";
  scenarioId?: string | null;
  scenarioTitle?: string | null;
  runId?: string | null;
  phase?: string;
  phaseLabel?: string;
  phaseIndex?: number;
  nextPhase?: string | null;
  phases?: SimulatorPhase[];
  elapsedSeconds: number;
  durationSeconds: number;
  breakingNewsAtSeconds: number;
  breakingNewsReleased: boolean;
  symbols: SimulatorSymbolStatus[];
  detail?: string;
};

export type SimulatorNewsArticle = {
  id: string;
  headline: string;
  summary?: string;
  source?: string;
  url?: string;
  symbols?: string[];
};

export const simulatorStatusEvent = "gops:simulator-status";
export const simulatorActivePollIntervalMs = 1_000;
export const simulatorIdlePollIntervalMs = 30_000;
const portfolioRefreshListeners = new Set<() => void>();
let latestPublishedSimulatorStatus: SimulatorStatus | null = null;

export function simulatorStatusPollIntervalMs(status: Pick<SimulatorStatus, "available" | "mode" | "state">): number {
  return status.available && status.mode === "simulation" && status.state === "running"
    ? simulatorActivePollIntervalMs
    : simulatorIdlePollIntervalMs;
}

export function shouldResetMarketDataForSimulatorTransition(
  previousMode: SimulatorMode,
  nextMode: SimulatorMode
): boolean {
  return previousMode === "simulation" && nextMode === "live";
}

export function subscribePortfolioRefresh(listener: () => void): () => void {
  portfolioRefreshListeners.add(listener);
  return () => portfolioRefreshListeners.delete(listener);
}

export function requestPortfolioRefresh(): void {
  portfolioRefreshListeners.forEach((listener) => listener());
}

export function basketForOrderSide(side: "buy" | "sell"): "energy" | "semiconductor" {
  return side === "sell" ? "semiconductor" : "energy";
}

export function formatSimulatorClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export async function fetchSimulatorStatus(signal?: AbortSignal): Promise<SimulatorStatus> {
  return requestJson<SimulatorStatus>("/api/simulator/status", { signal });
}

export async function setSimulatorMode(mode: SimulatorMode): Promise<SimulatorStatus> {
  return requestJson<SimulatorStatus>("/api/simulator/mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
}

export async function runSimulatorAction(action: "pause" | "resume" | "restart"): Promise<SimulatorStatus> {
  return requestJson<SimulatorStatus>("/api/simulator/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
}

export async function setSimulatorPhase(phase: string): Promise<SimulatorStatus> {
  return requestJson<SimulatorStatus>("/api/simulator/phase", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase })
  });
}

export async function fetchSimulatorNews(): Promise<SimulatorNewsArticle | null> {
  const payload = await requestJson<{ news?: SimulatorNewsArticle[] }>("/api/simulator/news");
  return payload.news?.[0] ?? null;
}

export async function submitSimulatorBasket(side: "buy" | "sell", idempotencyKey: string) {
  return requestJson<{ orders: Array<Record<string, unknown>>; account: Record<string, unknown> }>(
    "/api/simulator/orders/basket",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ basket: basketForOrderSide(side), side })
    }
  );
}

export function publishSimulatorStatus(status: SimulatorStatus): void {
  latestPublishedSimulatorStatus = status;
  window.dispatchEvent(new CustomEvent<SimulatorStatus>(simulatorStatusEvent, { detail: status }));
}

export function latestSimulatorStatus(): SimulatorStatus | null {
  return latestPublishedSimulatorStatus;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail ?? `시뮬레이터 API 오류 ${response.status}`);
  }
  return payload as T;
}
