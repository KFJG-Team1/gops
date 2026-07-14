export type PriceConditionSide = "buy" | "sell";
export type PriceConditionDirection = "atOrBelow" | "atOrAbove";
export type PriceConditionStatus = "watching" | "triggered" | "paused";

export type PriceCondition = {
  id: string;
  alertId: number;
  symbol: string;
  companyName: string;
  side: PriceConditionSide;
  direction: PriceConditionDirection;
  triggerPrice: number;
  limitPrice: number;
  quantity: number;
  status: PriceConditionStatus;
  backendStatus: string;
  alertsEnabled: boolean;
  executionEnabled: boolean;
  marketHours: string;
  validity: string;
  lastChecked: string;
  orderId?: string;
  errorReason?: string;
};

export type CreatePriceConditionInput = {
  symbol: string;
  side: PriceConditionSide;
  direction: PriceConditionDirection;
  triggerPrice: number;
  limitPrice: number;
  quantity: number;
  exchange?: string;
  executionEnabled?: boolean;
  alertsEnabled?: boolean;
  validity?: string;
};

export type TradeConditionCommandResponse = {
  status: "not_matched" | "clarify" | "rejected" | "created";
  clarification?: string;
  reason?: string;
  condition?: PriceCondition;
  idempotentReplay?: boolean;
};

const changedEvent = "gops:trade-conditions-changed";

export async function fetchPriceConditions(signal?: AbortSignal): Promise<PriceCondition[]> {
  const payload = await apiJson("/api/trade-conditions", { signal });
  const rows = asArray(asRecord(payload).conditions);
  return rows.map(normalizePriceCondition).filter((item): item is PriceCondition => Boolean(item));
}

export async function createPriceCondition(input: CreatePriceConditionInput): Promise<PriceCondition> {
  const payload = await apiJson("/api/trade-conditions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      exchange: input.exchange ?? "NASD",
      executionEnabled: input.executionEnabled ?? true,
      alertsEnabled: input.alertsEnabled ?? true,
      validity: normalizeValidityForApi(input.validity)
    })
  });
  const condition = normalizePriceCondition(asRecord(payload).condition);
  if (!condition) throw new Error("가격 조건 등록 응답을 읽지 못했습니다.");
  publishTradeConditionsChanged();
  return condition;
}

export async function updatePriceCondition(
  conditionId: string,
  patch: { status?: "watching" | "paused"; alertsEnabled?: boolean }
): Promise<PriceCondition> {
  const payload = await apiJson(`/api/trade-conditions/${encodeURIComponent(conditionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  const condition = normalizePriceCondition(asRecord(payload).condition);
  if (!condition) throw new Error("가격 조건 변경 응답을 읽지 못했습니다.");
  publishTradeConditionsChanged();
  return condition;
}

export async function deletePriceCondition(conditionId: string): Promise<void> {
  await apiJson(`/api/trade-conditions/${encodeURIComponent(conditionId)}`, { method: "DELETE" });
  publishTradeConditionsChanged();
}

export async function resolveTradeConditionCommand(input: {
  text: string;
  analysisId: string;
  proposalId?: string;
}): Promise<TradeConditionCommandResponse> {
  const payload = asRecord(await apiJson("/api/trade-conditions/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }));
  const status = readString(payload.status);
  return {
    status: status === "clarify" || status === "rejected" || status === "created" ? status : "not_matched",
    clarification: readString(payload.clarification),
    reason: readString(payload.reason),
    condition: normalizePriceCondition(payload.condition) ?? undefined,
    idempotentReplay: payload.idempotentReplay === true
  };
}

export function subscribeTradeConditionsChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(changedEvent, listener);
  return () => window.removeEventListener(changedEvent, listener);
}

export function publishTradeConditionsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(changedEvent));
}

function normalizePriceCondition(value: unknown): PriceCondition | null {
  const source = asRecord(value);
  const id = readNumber(source.id);
  const alertId = readNumber(source.alert_id ?? source.alertId);
  const symbol = readString(source.symbol)?.toUpperCase();
  const side = readString(source.side);
  const rawDirection = readString(source.direction);
  const triggerPrice = readNumber(source.target_price ?? source.triggerPrice);
  const limitPrice = readNumber(source.limit_price ?? source.limitPrice);
  const quantity = readNumber(source.quantity);
  if (!id || !alertId || !symbol || !triggerPrice || !limitPrice || !quantity) return null;
  if (side !== "buy" && side !== "sell") return null;
  const direction = rawDirection === "below" || rawDirection === "atOrBelow" ? "atOrBelow"
    : rawDirection === "above" || rawDirection === "atOrAbove" ? "atOrAbove"
      : null;
  if (!direction) return null;
  const backendStatus = readString(source.status) ?? "watching";
  return {
    id: String(id),
    alertId,
    symbol,
    companyName: symbol,
    side,
    direction,
    triggerPrice,
    limitPrice,
    quantity,
    status: presentationStatus(backendStatus),
    backendStatus,
    alertsEnabled: source.notifications_enabled !== false && source.alertsEnabled !== false,
    executionEnabled: source.execution_enabled !== false && source.executionEnabled !== false,
    marketHours: readString(source.market_hours) === "REGULAR" ? "정규장 · 09:30–16:00 ET" : readString(source.market_hours) ?? "정규장 · 09:30–16:00 ET",
    validity: normalizeValidityForUi(readString(source.validity)),
    lastChecked: lastCheckedLabel(source, backendStatus),
    orderId: readString(source.order_id ?? source.orderId),
    errorReason: readString(source.error_reason ?? source.errorReason)
  };
}

function presentationStatus(status: string): PriceConditionStatus {
  if (status === "watching") return "watching";
  if (status === "paused") return "paused";
  return "triggered";
}

function lastCheckedLabel(source: Record<string, unknown>, status: string): string {
  if (status === "watching") return "서버에서 감시 중";
  if (status === "paused") return "사용자 일시정지";
  if (status === "completed") return readString(source.order_id) ? `주문 접수 · ${readString(source.order_id)}` : "주문 접수 완료";
  if (status === "blocked") return `리스크 차단${readString(source.error_reason) ? ` · ${readString(source.error_reason)}` : ""}`;
  if (status === "failed") return `주문 실패${readString(source.error_reason) ? ` · ${readString(source.error_reason)}` : ""}`;
  return "조건 충족";
}

function normalizeValidityForApi(value?: string): string {
  return value === "직접 취소 전" || value === "GTC" ? "GTC" : "DAY";
}

function normalizeValidityForUi(value?: string): string {
  return value === "GTC" ? "직접 취소 전" : "당일";
}

async function apiJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { Accept: "application/json", ...init.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = asRecord(payload).detail;
    throw new Error(typeof detail === "string" && detail.trim() ? detail : `가격 조건 API 오류: ${response.status}`);
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
