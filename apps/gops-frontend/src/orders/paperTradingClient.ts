import type { OrderSnapshot } from "./orderClient";

export type PaperPosition = {
  symbol: string;
  qty: number;
  reserved_qty: number;
  available_qty: number;
  average_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  unrealized_pnl_rate: number;
  realized_pnl: number;
  price_source: string;
  price_timestamp?: string | null;
};

export type PaperAccountSummary = {
  generation: number;
  currency: "USD";
  starting_cash: number;
  cash_balance: number;
  reserved_cash: number;
  available_cash: number;
  market_value: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  total_pnl_rate: number;
  started_at: string;
};

export type PaperAccountSnapshot = {
  source: "paper";
  execution_mode: "paper";
  account: PaperAccountSummary;
  positions: PaperPosition[];
  open_orders: OrderSnapshot[];
};

export type PaperSymbolOption = {
  symbol: string;
  name: string;
  market?: string;
  exchange?: string;
  assetClass?: string;
  asset_class?: string;
  tradable?: boolean;
  status?: string;
};

export async function fetchPaperAccount(signal?: AbortSignal): Promise<PaperAccountSnapshot> {
  const response = await fetch("/api/paper/account", { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as PaperAccountSnapshot;
}

export async function fetchPaperOrders(signal?: AbortSignal): Promise<OrderSnapshot[]> {
  const response = await fetch("/api/paper/orders?include_previous=true&limit=200", { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return Array.isArray(body.orders) ? body.orders : [];
}

export async function cancelPaperOrder(orderId: string): Promise<OrderSnapshot> {
  const response = await fetch(`/api/paper/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as OrderSnapshot;
}

export async function resetPaperAccount(startingCash: number): Promise<PaperAccountSnapshot> {
  const response = await fetch("/api/paper/account/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starting_cash: startingCash.toFixed(2) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as PaperAccountSnapshot;
}

export async function searchPaperSymbols(query: string, signal?: AbortSignal): Promise<PaperSymbolOption[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: "20" });
  const response = await fetch(`/api/paper/symbols/search?${params.toString()}`, { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return (Array.isArray(body.symbols) ? body.symbols : [])
    .filter((item: PaperSymbolOption) => item && item.symbol)
    .map((item: PaperSymbolOption) => ({ ...item, symbol: item.symbol.toUpperCase() }));
}

export function paperAccountWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/paper/account`;
}

function errorMessage(body: any, status: number): string {
  return typeof body?.detail === "string" ? body.detail : `가상투자 API 오류 ${status}`;
}
