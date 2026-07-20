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
  name?: string;
  market?: string;
  exchange?: string;
  currency?: string;
  sector?: string | null;
  industry?: string | null;
  day_pnl?: number | null;
  day_pnl_rate?: number | null;
  pe_ratio?: number | null;
  eps_ttm?: number | null;
  low_52?: number | null;
  high_52?: number | null;
  market_stats_as_of?: string | null;
  stats_52w_source?: string | null;
  fundamentals_source?: string | null;
  fundamentals_as_of?: string | null;
  dividend_yield?: number | null;
  dividend_per_share?: number | null;
  annual_dividend?: number | null;
  next_dividend_date?: string | null;
  dividend_source?: string | null;
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
  seed_profile?: string | null;
  seeded_at?: string | null;
  seed_suppressed_at?: string | null;
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
  const response = await fetch("/api/paper/orders?limit=500", { signal });
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
  if (typeof body?.detail === "string") return body.detail;
  if (typeof body?.detail?.code === "string") return body.detail.code;
  return `가상투자 API 오류 ${status}`;
}
