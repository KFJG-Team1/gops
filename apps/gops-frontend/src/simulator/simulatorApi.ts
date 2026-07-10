export type SimulatorMode = "live" | "simulation";

export type SimulatorSymbolStatus = {
  symbol: string;
  price?: number | null;
  seedPrice?: number | null;
  changePercent?: number | null;
};

export type SimulatorStatus = {
  available: boolean;
  mode: SimulatorMode;
  state: "idle" | "running" | "paused" | "completed";
  runId?: string | null;
  phase?: string;
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
const portfolioRefreshListeners = new Set<() => void>();

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
  window.dispatchEvent(new CustomEvent<SimulatorStatus>(simulatorStatusEvent, { detail: status }));
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail ?? `시뮬레이터 API 오류 ${response.status}`);
  }
  return payload as T;
}
