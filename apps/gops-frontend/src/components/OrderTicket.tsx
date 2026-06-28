import { LoaderCircle, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SupportedSymbol } from "@gops/chart-engine/symbols";

type OrderSide = "buy" | "sell";
type OrderMarket = "overseas" | "domestic";

type OrderFormState = {
  market: OrderMarket;
  symbol: string;
  side: OrderSide;
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
  qty: "1",
  price: "145.00",
  exchange: "NASD"
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

function toOrderMarket(value: string): OrderMarket {
  return value === "domestic" ? "domestic" : "overseas";
}

export function OrderTicket({ activeSymbol }: { activeSymbol: SupportedSymbol }) {
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
      setError("Order stream unavailable.");
      setSocketState("closed");
    };
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as OrderSocketPayload;
      if (payload.type === "error") {
        setError(payload.detail ?? "Order stream error.");
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
    setSubmitting(true);
    setError(undefined);
    const idempotencyKey = makeIdempotencyKey();
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
          order_division: "00",
          actor_id: "gops-frontend",
          role: "trader"
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? `Order API returned ${response.status}`);
      }
      setOrder(payload);
      setEvents([]);
      connectSocket(payload.order_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Order request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="order-ticket" aria-label="Order ticket">
      <div className="order-ticket-header">
        <strong>Order</strong>
        <span>{order?.status ?? "Ready"}</span>
      </div>

      <div className="order-side-control" role="group" aria-label="Order side">
        <button className={form.side === "buy" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, side: "buy" }))}>
          Buy
        </button>
        <button className={form.side === "sell" ? "active" : ""} type="button" onClick={() => setForm((current) => ({ ...current, side: "sell" }))}>
          Sell
        </button>
      </div>

      <div className="order-field-grid">
        <label>
          <span>Market</span>
          <select value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: toOrderMarket(event.target.value) }))}>
            <option value="overseas">Overseas</option>
            <option value="domestic">Domestic</option>
          </select>
        </label>
        <label>
          <span>Symbol</span>
          <input value={form.symbol} onChange={(event) => updateTextField("symbol", event.target.value)} />
        </label>
        <label>
          <span>Qty</span>
          <input inputMode="decimal" value={form.qty} onChange={(event) => updateTextField("qty", event.target.value)} />
        </label>
        <label>
          <span>Price</span>
          <input inputMode="decimal" value={form.price} onChange={(event) => updateTextField("price", event.target.value)} />
        </label>
        <label>
          <span>Exchange</span>
          <input value={form.exchange} onChange={(event) => updateTextField("exchange", event.target.value)} />
        </label>
      </div>

      <button className="order-submit-button" type="button" disabled={submitting} onClick={submitOrder}>
        {submitting ? <LoaderCircle size={14} className="spin" /> : <SendHorizontal size={14} />}
        Submit
      </button>

      {error && <div className="order-error">{error}</div>}

      {order && (
        <div className="order-status-box">
          <div>
            <span>Status</span>
            <strong>{order.status}</strong>
          </div>
          <div>
            <span>Order ID</span>
            <strong>{order.order_id}</strong>
          </div>
          <div>
            <span>Stream</span>
            <strong>{socketState}</strong>
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
