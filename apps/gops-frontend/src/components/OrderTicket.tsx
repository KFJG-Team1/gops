import { LoaderCircle, LogIn, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SupportedSymbol } from "@gops/chart-engine/symbols";
import { useAuth } from "../auth/AuthProvider";

type OrderSide = "buy" | "sell";
type OrderMarket = "overseas";
type OrderType = "limit" | "market";
type OrderValidity = "day" | "gtc";

type OrderFormState = {
  market: OrderMarket;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  validity: OrderValidity;
  qty: string;
  price: string;
  exchange: string;
};

type OrderSnapshot = {
  order_id: string;
  request_id: string;
  client_order_id: string;
  status: string;
  symbol?: string;
  side?: string;
  qty?: string;
  price?: string;
  reason?: string | null;
};

type OrderEvent = {
  event_id?: string;
  status: string;
  reason?: string | null;
  created_at?: string;
};

type OrderSocketPayload = {
  type: "snapshot" | "update" | "error";
  order?: OrderSnapshot;
  events?: OrderEvent[];
  detail?: string;
};

const DEFAULT_FORM: OrderFormState = {
  market: "overseas",
  symbol: "AAPL",
  side: "buy",
  orderType: "limit",
  validity: "day",
  qty: "1",
  price: "145.00",
  exchange: "NASD"
};

const marketLabels: Record<OrderMarket, string> = {
  overseas: "해외주식"
};

const sideLabels: Record<OrderSide, string> = {
  buy: "매수",
  sell: "매도"
};

const socketStateLabels: Record<"idle" | "open" | "closed", string> = {
  idle: "대기",
  open: "연결됨",
  closed: "종료"
};

function makeIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function websocketUrl(orderId: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/orders/${orderId}`;
}

function toOrderType(value: string): OrderType {
  return value === "market" ? "market" : "limit";
}

function toOrderValidity(value: string): OrderValidity {
  return value === "gtc" ? "gtc" : "day";
}

function orderStatusLabel(status?: string): string {
  switch (status?.toLowerCase()) {
    case "accepted":
      return "접수";
    case "submitted":
      return "전송";
    case "filled":
      return "체결";
    case "rejected":
      return "거부";
    case "cancelled":
    case "canceled":
      return "취소";
    case "pending":
      return "대기";
    default:
      return status ? status.toUpperCase() : "주문 가능";
  }
}

function formatOrderAmount(qty: string, price: string): string {
  const quantity = Number(qty);
  const limitPrice = Number(price);
  if (!Number.isFinite(quantity) || !Number.isFinite(limitPrice)) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(quantity * limitPrice);
}

export function OrderTicket({ activeSymbol }: { activeSymbol: SupportedSymbol }) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const [form, setForm] = useState<OrderFormState>({ ...DEFAULT_FORM, symbol: activeSymbol });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [order, setOrder] = useState<OrderSnapshot | undefined>();
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [socketState, setSocketState] = useState<"idle" | "open" | "closed">("idle");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setForm((current) => ({ ...current, symbol: activeSymbol }));
  }, [activeSymbol]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const updateTextField = (field: "symbol" | "qty" | "price" | "exchange", value: string) => {
    setForm((current) => ({ ...current, [field]: field === "symbol" || field === "exchange" ? value.toUpperCase() : value }));
  };

  const connectSocket = (orderId: string) => {
    socketRef.current?.close();
    const socket = new WebSocket(websocketUrl(orderId));
    socketRef.current = socket;
    setSocketState("idle");

    socket.onopen = () => setSocketState("open");
    socket.onclose = () => setSocketState("closed");
    socket.onerror = () => {
      setError("주문 스트림에 연결할 수 없습니다.");
      setSocketState("closed");
    };
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as OrderSocketPayload;
      if (payload.type === "error") {
        setError(payload.detail ?? "주문 스트림 오류가 발생했습니다.");
        return;
      }
      if (payload.order) {
        setOrder(payload.order);
      }
      if (payload.events) {
        setEvents(payload.events);
      }
    };
  };

  const submitOrder = async () => {
    if (authEnabled && !user) {
      login();
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const idempotencyKey = makeIdempotencyKey();
    const orderDivision = form.orderType === "market" ? "01" : "00";
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          market: form.market,
          symbol: form.symbol,
          side: form.side,
          qty: form.qty,
          price: form.price,
          exchange: form.exchange,
          order_division: orderDivision,
          actor_id: "gops-frontend",
          role: "trader"
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? (response.status === 401 ? "주문하려면 Google 로그인이 필요합니다." : `주문 API 오류 ${response.status}`));
      }
      setOrder(payload);
      setEvents([]);
      connectSocket(payload.order_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "주문 요청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const estimatedAmount = form.orderType === "market" ? "시장가" : formatOrderAmount(form.qty, form.price);

  return (
    <section className="order-ticket" data-order-side={form.side} aria-label="주문 패널">
      <div className="order-ticket-header">
        <div>
          <strong>{sideLabels[form.side]} 주문</strong>
          <span>{form.symbol} · {marketLabels[form.market]}</span>
        </div>
        <em>{authEnabled && !user ? "로그인 필요" : orderStatusLabel(order?.status)}</em>
      </div>

      <div className="order-account-strip">
        <div>
          <span>계좌</span>
          <strong>모의투자</strong>
        </div>
        <div>
          <span>시장</span>
          <strong>{marketLabels[form.market]}</strong>
        </div>
        <div>
          <span>통화</span>
          <strong>USD</strong>
        </div>
      </div>

      <div className="order-side-control" role="group" aria-label="매수 매도 선택">
        <button className={form.side === "buy" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, side: "buy" }))}>
          매수
        </button>
        <button className={form.side === "sell" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, side: "sell" }))}>
          매도
        </button>
      </div>

      <div className="order-field-grid">
        <label>
          <span>종목</span>
          <input value={form.symbol} onChange={(event) => updateTextField("symbol", event.target.value)} />
        </label>
        <label>
          <span>주문유형</span>
          <select value={form.orderType} onChange={(event) => setForm((current) => ({ ...current, orderType: toOrderType(event.target.value) }))}>
            <option value="limit">지정가</option>
            <option value="market">시장가</option>
          </select>
        </label>
        <label>
          <span>유효기간</span>
          <select value={form.validity} onChange={(event) => setForm((current) => ({ ...current, validity: toOrderValidity(event.target.value) }))}>
            <option value="day">당일</option>
            <option value="gtc">취소 전까지</option>
          </select>
        </label>
        <label>
          <span>수량</span>
          <input inputMode="decimal" value={form.qty} onChange={(event) => updateTextField("qty", event.target.value)} />
        </label>
        <label>
          <span>주문가</span>
          <input inputMode="decimal" value={form.price} disabled={form.orderType === "market"} onChange={(event) => updateTextField("price", event.target.value)} />
        </label>
        <label>
          <span>거래소</span>
          <input value={form.exchange} onChange={(event) => updateTextField("exchange", event.target.value)} />
        </label>
      </div>

      <div className="order-summary-box">
        <div>
          <span>주문 구분</span>
          <strong>{sideLabels[form.side]} · {form.orderType === "market" ? "시장가" : "지정가"}</strong>
        </div>
        <div>
          <span>주문 조건</span>
          <strong>{form.validity === "gtc" ? "취소 전까지" : "당일"} · {form.exchange}</strong>
        </div>
        <div className="order-summary-total">
          <span>예상 금액</span>
          <strong>{estimatedAmount}</strong>
        </div>
      </div>

      <button className="order-submit-button" type="button" disabled={submitting || authLoading} onClick={submitOrder}>
        {authEnabled && !user
          ? <LogIn size={14} />
          : submitting ? <LoaderCircle size={14} className="spin" /> : <SendHorizontal size={14} />}
        {authEnabled && !user ? "로그인" : submitting ? "전송 중" : `${sideLabels[form.side]} 주문 전송`}
      </button>

      {error && <div className="order-error">{error}</div>}

      {order && (
        <div className="order-status-box">
          <div>
            <span>상태</span>
            <strong>{orderStatusLabel(order.status)}</strong>
          </div>
          <div>
            <span>주문번호</span>
            <strong>{order.order_id}</strong>
          </div>
          <div>
            <span>스트림</span>
            <strong>{socketStateLabels[socketState]}</strong>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="order-event-list">
          {events.slice(-3).map((event, index) => (
            <div key={event.event_id ?? `${event.status}-${index}`} className="order-event-row">
              <strong>{event.status}</strong>
              <span>{event.reason ?? event.created_at ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
