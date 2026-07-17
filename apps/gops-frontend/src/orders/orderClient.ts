export type OrderSide = "buy" | "sell";
export type OrderExecutionMode = "kis" | "paper" | "simulation";

export type OrderRequestPayload = {
  market: "overseas";
  symbol: string;
  side: OrderSide;
  qty: string;
  price: string;
  exchange: string;
  order_division: "00";
  actor_id?: string;
  role?: string;
};

export type RiskRule = {
  ruleId: string;
  action: "block" | "resize" | "warn" | "info";
  title?: string;
  explanation: string;
  guidance?: string;
  numbers?: Record<string, string>;
  suggestedQty?: string;
  suggestedPrice?: string;
  suggestedActionLabel?: string;
};

export type RiskVerdict = {
  verdict: "allow" | "resize" | "block";
  requestedQty?: string;
  adjustedQty?: string | null;
  triggeredRules: RiskRule[];
  skippedRules?: { ruleId: string; reason: string }[];
};

export type OrderSnapshot = {
  order_id: string;
  request_id?: string;
  client_order_id?: string;
  status: string;
  symbol?: string;
  side?: string;
  qty?: string | number;
  price?: string | number;
  limit_price?: string | number;
  fill_price?: string | number | null;
  filled_price?: string | number | null;
  created_at?: string;
  filled_at?: string | null;
  virtualSubmittedAt?: string;
  virtualFilledAt?: string | null;
  cancelled_at?: string | null;
  generation?: number;
  execution_mode?: "paper" | "simulation";
  order_type?: "market" | "limit";
  reason?: string | null;
  simulation?: boolean;
  runId?: string;
  risk?: RiskVerdict;
};

export type OrderEvent = {
  event_id?: string;
  status: string;
  reason?: string | null;
  created_at?: string;
};

export type OrderSocketPayload = {
  type: "snapshot" | "update" | "error";
  order?: OrderSnapshot;
  events?: OrderEvent[];
  detail?: string;
};

export function makeIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function orderWebSocketUrl(orderId: string, executionMode: OrderExecutionMode = "kis"): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const path = executionMode === "paper" ? `/ws/paper/orders/${orderId}` : `/ws/orders/${orderId}`;
  return `${protocol}//${window.location.host}${path}`;
}

export function orderBalancePath(executionMode: OrderExecutionMode = "kis"): string {
  return executionMode === "paper" ? "/api/paper/account/balance" : "/api/orders/balance";
}

export function orderSubmitPath(executionMode: OrderExecutionMode = "kis"): string {
  return executionMode === "paper" ? "/api/paper/orders" : "/api/orders";
}

export function orderRiskPath(executionMode: OrderExecutionMode = "kis"): string {
  return executionMode === "paper" ? "/api/paper/risk/pretrade" : "/api/risk/pretrade";
}

export function resolveQuickOrderExecutionMode(
  configuredMode: OrderExecutionMode,
  simulatorMode: "live" | "simulation"
): OrderExecutionMode {
  return simulatorMode === "simulation" ? "simulation" : configuredMode;
}

export function parseRiskDetail(detail: unknown): RiskVerdict | undefined {
  if (!detail || typeof detail !== "object" || !("risk" in detail)) {
    return undefined;
  }
  const risk = (detail as { risk?: unknown }).risk;
  if (!risk || typeof risk !== "object" || !("verdict" in risk)) {
    return undefined;
  }
  return risk as RiskVerdict;
}

export async function submitOrderRequest(
  payload: OrderRequestPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
  executionMode: OrderExecutionMode = "kis"
): Promise<OrderSnapshot> {
  const response = await fetch(orderSubmitPath(executionMode), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload),
    signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(orderErrorMessage(response.status, body));
    Object.assign(error, { status: response.status, detail: body?.detail });
    throw error;
  }
  return body as OrderSnapshot;
}

export async function previewOrderRisk(
  payload: OrderRequestPayload,
  signal?: AbortSignal,
  executionMode: OrderExecutionMode = "kis"
): Promise<RiskVerdict> {
  const response = await fetch(orderRiskPath(executionMode), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.detail === "string" ? body.detail : `리스크 점검 API 오류 ${response.status}`);
  }
  return body.risk as RiskVerdict;
}

function orderErrorMessage(status: number, payload: any): string {
  const risk = parseRiskDetail(payload?.detail);
  if (risk) {
    const suggestion = risk.adjustedQty ? ` 권장 수량 ${risk.adjustedQty}주를 확인하세요.` : "";
    return risk.verdict === "block" ? `리스크 매니저가 주문을 차단했습니다.${suggestion}` : `수량 조정이 필요합니다.${suggestion}`;
  }
  if (typeof payload?.detail === "string") {
    return payload.detail;
  }
  return status === 401 ? "주문하려면 로그인이 필요합니다." : `주문 API 오류 ${status}`;
}
