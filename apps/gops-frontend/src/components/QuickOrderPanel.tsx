import { AlertTriangle, LoaderCircle, Minus, Plus, Search, SendHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import { useAuth } from "../auth/AuthProvider";
import { openChartSocket } from "../chart/cdcClient";
import {
  fetchOrderFlowIntraday,
  fetchOrderFlowSymbols,
  subscribeOrderFlowDemoTicks
} from "../chart/orderFlowClient";
import { replaceOrderFlowMinute, type OrderFlowMinuteDto } from "../chart/orderFlow";
import type { CandleEventDto } from "../chart/types";
import {
  makeIdempotencyKey,
  orderBalancePath,
  orderWebSocketUrl,
  parseRiskDetail,
  previewOrderRisk,
  submitOrderRequest,
  type OrderExecutionMode,
  type OrderRequestPayload,
  type OrderSnapshot,
  type OrderSocketPayload,
  type RiskVerdict
} from "../orders/orderClient";
import { searchPaperSymbols } from "../orders/paperTradingClient";
import {
  baseQuickOrderIntents,
  deltaTone,
  imbalanceCandidates,
  normalizedDelta,
  quoteIsUsable,
  type QuickOrderIntent,
  type QuickOrderQuote
} from "../orders/quickOrderModel";

type QuickOrderPanelProps = {
  symbol: string;
  savedQty?: number;
  symbolOptions: readonly WatchlistSymbol[];
  onSymbolChange?: (symbol: string) => void;
  onQtyChange?: (qty: number) => void;
  executionMode?: OrderExecutionMode;
};

type StreamState = "idle" | "connecting" | "live" | "error";
type ToastTone = "pending" | "success" | "error" | "info";
type ToastItem = { id: string; tone: ToastTone; message: string };
type Balance = { orderable_cash?: string | null; currency?: string };

const terminalStatuses = new Set(["filled", "rejected", "cancelled", "canceled"]);

export function QuickOrderPanel({
  symbol,
  savedQty = 1,
  symbolOptions,
  onSymbolChange,
  onQtyChange,
  executionMode = "kis"
}: QuickOrderPanelProps) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const socketsRef = useRef(new Map<string, WebSocket>());
  const toastTimersRef = useRef(new Map<string, number>());
  const symbolSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [supportedSymbols, setSupportedSymbols] = useState<string[]>([]);
  const [paperSymbolOptions, setPaperSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(symbol.trim().toUpperCase());
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [qtyText, setQtyText] = useState(String(Math.max(1, Math.floor(savedQty))));
  const [minutes, setMinutes] = useState<Map<string, OrderFlowMinuteDto>>(new Map());
  const [quote, setQuote] = useState<QuickOrderQuote | null>(null);
  const [priceBinSize, setPriceBinSize] = useState(0.01);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [intent, setIntent] = useState<QuickOrderIntent | null>(null);
  const [priceText, setPriceText] = useState("");
  const [risk, setRisk] = useState<RiskVerdict>();
  const [riskLoading, setRiskLoading] = useState(false);
  const [balance, setBalance] = useState<Balance>();
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    setSelectedSymbol(symbol.trim().toUpperCase());
    setSymbolSearchQuery("");
    setSymbolSearchOpen(false);
  }, [symbol]);
  useEffect(() => setQtyText(String(Math.max(1, Math.floor(savedQty)))), [savedQty]);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrderFlowSymbols(controller.signal)
      .then((response) => {
        setSupportedSymbols(response.symbols);
        setPriceBinSize(response.priceBinSize);
      })
      .catch(() => setSupportedSymbols([]));
    return () => controller.abort();
  }, []);

  const orderFlowSupported = supportedSymbols.includes(selectedSymbol);
  const supported = executionMode === "paper" || orderFlowSupported;
  const quickOrderSymbolOptions = useMemo(() => {
    const allOptions = [...symbolOptions, ...paperSymbolOptions];
    const symbolMeta = new Map(allOptions.map((item) => [item.symbol.toUpperCase(), item]));
    const candidates = executionMode === "paper"
      ? [selectedSymbol, ...allOptions.map((item) => item.symbol)]
      : supportedSymbols.length ? supportedSymbols : [selectedSymbol];
    return Array.from(new Set(candidates.map((candidate) => candidate.toUpperCase()))).map((normalized) => {
      const meta = symbolMeta.get(normalized);
      return { symbol: normalized, name: meta?.name || normalized };
    });
  }, [executionMode, paperSymbolOptions, selectedSymbol, supportedSymbols, symbolOptions]);
  const visibleSymbolOptions = useMemo(() => {
    const query = symbolSearchQuery.trim().toUpperCase();
    return quickOrderSymbolOptions
      .filter((item) => !query || item.symbol.includes(query) || item.name.toUpperCase().includes(query))
      .sort((left, right) => symbolSearchScore(left, query) - symbolSearchScore(right, query) || left.symbol.localeCompare(right.symbol))
      .slice(0, 8);
  }, [quickOrderSymbolOptions, symbolSearchQuery]);
  const selectedSymbolName = quickOrderSymbolOptions.find((item) => item.symbol === selectedSymbol)?.name;

  useEffect(() => {
    if (!symbolSearchOpen) return;
    const frame = window.requestAnimationFrame(() => symbolSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [symbolSearchOpen]);

  useEffect(() => {
    if (executionMode !== "paper" || !symbolSearchOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPaperSymbols(symbolSearchQuery, controller.signal)
        .then((items) => setPaperSymbolOptions(items.map((item) => ({
          symbol: item.symbol,
          name: item.name || item.symbol,
          market: item.exchange || item.market || "US"
        }))))
        .catch(() => undefined);
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [executionMode, symbolSearchOpen, symbolSearchQuery]);

  useEffect(() => {
    setIntent(null);
    setPriceText("");
    setRisk(undefined);
    setMinutes(new Map());
    setQuote(null);
    if (!orderFlowSupported) return;
    const controller = new AbortController();
    fetchOrderFlowIntraday(selectedSymbol, controller.signal)
      .then((response) => {
        setMinutes(new Map(response.minutes.map((minute) => [minute.eventMinute, minute])));
        setQuote(response.liveQuote);
        setPriceBinSize(response.priceBinSize);
      })
      .catch(() => {
        setMinutes(new Map());
        setQuote(null);
      });
    return () => controller.abort();
  }, [orderFlowSupported, selectedSymbol]);

  useEffect(() => {
    if (!supported) {
      setStreamState("idle");
      return;
    }
    const onEvent = (event: CandleEventDto) => {
      if (event.symbol.toUpperCase() !== selectedSymbol) return;
      if (event.type === "LIVE_QUOTE_UPDATE") setQuote(normalizeQuote(event));
      if (event.type === "ORDER_FLOW_BINS_UPDATE") setMinutes((current) => replaceOrderFlowMinute(current, event.data));
    };
    const onState = (state: StreamState) => setStreamState(state);
    const demoCleanup = orderFlowSupported ? subscribeOrderFlowDemoTicks(selectedSymbol, onEvent, onState) : undefined;
    return demoCleanup ?? openChartSocket(selectedSymbol, "1m", onEvent, onState);
  }, [orderFlowSupported, selectedSymbol, supported]);

  const baseIntents = useMemo(() => baseQuickOrderIntents(quote), [quote]);
  const imbalances = useMemo(() => imbalanceCandidates(minutes, quote, priceBinSize), [minutes, priceBinSize, quote]);
  const delta = useMemo(() => normalizedDelta(minutes), [minutes]);
  const tone = deltaTone(delta);
  const quoteUsable = quoteIsUsable(quote);
  const transportReady = streamState === "idle" || streamState === "live";
  const marketDataReady = quoteUsable && transportReady;
  const price = parsePositivePrice(priceText);
  const qty = parsePositiveInteger(qtyText);
  const exchange = exchangeForSymbol(selectedSymbol, [...symbolOptions, ...paperSymbolOptions]);
  const disabledReason = quickOrderDisabledReason({ supported, quoteUsable, streamState, submitting });

  useEffect(() => {
    if (!intent || price === null || !marketDataReady || !supported || qty === null) {
      setRisk(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRiskLoading(true);
      previewOrderRisk(orderPayload(selectedSymbol, exchange, qty, { ...intent, price }), controller.signal, executionMode)
        .then(setRisk)
        .catch(() => setRisk(undefined))
        .finally(() => setRiskLoading(false));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [exchange, executionMode, intent, marketDataReady, price, qty, selectedSymbol, supported]);

  useEffect(() => {
    if (!intent || price === null || !marketDataReady) {
      setBalance(undefined);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol: selectedSymbol, exchange, price: price.toFixed(2) });
    fetch(`${orderBalancePath(executionMode)}?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then(setBalance)
      .catch(() => setBalance(undefined));
    return () => controller.abort();
  }, [exchange, executionMode, intent, marketDataReady, price, selectedSymbol]);

  useEffect(() => () => {
    socketsRef.current.forEach((socket) => socket.close());
    toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const selectIntent = (next: QuickOrderIntent) => {
    if (disabledReason) return;
    setIntent(next);
    setPriceText(next.price.toFixed(2));
  };

  const updatePriceText = (value: string) => {
    const normalizedText = normalizePriceText(value);
    setPriceText(normalizedText);
    if (intent) {
      const parsed = parsePositivePrice(normalizedText);
      setIntent({ ...intent, ...(parsed === null ? {} : { price: parsed }), source: "manual", label: "직접 입력" });
    }
  };

  const normalizePriceInput = () => {
    if (price === null) {
      setPriceText("");
      return;
    }
    setPriceText(price.toFixed(2));
  };

  const selectSymbol = (nextSymbol: string) => {
    const normalized = nextSymbol.trim().toUpperCase();
    if (!quickOrderSymbolOptions.some((item) => item.symbol === normalized)) return;
    setSelectedSymbol(normalized);
    setSymbolSearchQuery("");
    setSymbolSearchOpen(false);
    symbolSearchInputRef.current?.blur();
    onSymbolChange?.(normalized);
  };

  const updateQty = (next: number) => {
    const normalized = Math.max(1, Math.floor(next));
    setQtyText(String(normalized));
    onQtyChange?.(normalized);
  };

  const updateQtyText = (value: string) => {
    const normalizedText = value.replace(/[^\d]/g, "").slice(0, 9);
    setQtyText(normalizedText);
    const parsed = parsePositiveInteger(normalizedText);
    if (parsed !== null) onQtyChange?.(parsed);
  };

  const normalizeQtyInput = () => {
    if (qty === null) updateQty(1);
  };

  const applyBuyingPowerRatio = (ratio: number) => {
    const cashValue = Number(balance?.orderable_cash);
    if (price === null || !Number.isFinite(cashValue) || cashValue <= 0) return;
    updateQty(Math.max(1, Math.floor((cashValue * ratio) / price)));
  };

  const submit = async () => {
    if (authEnabled && !user) {
      login();
      return;
    }
    if (!intent || price === null || qty === null || disabledReason || risk?.verdict === "block") return;
    setSubmitting(true);
    const idempotencyKey = makeIdempotencyKey();
    const pendingToastId = `pending-${idempotencyKey}`;
    showToast({ id: pendingToastId, tone: "pending", message: `${selectedSymbol} 주문 전송 중` }, false);
    try {
      const order = await submitOrderRequest(orderPayload(selectedSymbol, exchange, qty, { ...intent, price }), idempotencyKey, undefined, executionMode);
      removeToast(pendingToastId);
      showToast({ id: order.order_id, tone: "info", message: `${selectedSymbol} 주문이 접수되었습니다.` });
      if (order.simulation) {
        showToast({ id: `${order.order_id}-sim`, tone: "success", message: "모의 체결가는 재생 엔진 기준입니다." });
      } else {
        trackOrder(order);
      }
    } catch (error) {
      removeToast(pendingToastId);
      const detail = (error as Error & { detail?: unknown }).detail;
      const nextRisk = parseRiskDetail(detail);
      if (nextRisk) setRisk(nextRisk);
      showToast({ id: `error-${idempotencyKey}`, tone: "error", message: error instanceof Error ? error.message : "주문 전송에 실패했습니다." });
    } finally {
      window.setTimeout(() => setSubmitting(false), 300);
    }
  };

  const trackOrder = (order: OrderSnapshot) => {
    if (!order.order_id) return;
    while (socketsRef.current.size >= 5) {
      const oldest = socketsRef.current.entries().next().value as [string, WebSocket] | undefined;
      if (!oldest) break;
      oldest[1].close();
      socketsRef.current.delete(oldest[0]);
    }
    const socket = new WebSocket(orderWebSocketUrl(order.order_id, executionMode));
    socketsRef.current.set(order.order_id, socket);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as OrderSocketPayload;
      if (payload.type === "error") {
        showToast({ id: `${order.order_id}-stream`, tone: "error", message: payload.detail ?? "주문 상태 연결 오류" });
        return;
      }
      const status = payload.order?.status?.toLowerCase();
      if (!status || !terminalStatuses.has(status)) return;
      showToast({
        id: `${order.order_id}-${status}`,
        tone: status === "filled" ? "success" : "error",
        message: status === "filled" ? `${selectedSymbol} 주문이 체결되었습니다.` : `${selectedSymbol} 주문이 ${status === "rejected" ? "거부" : "취소"}되었습니다.`
      });
      socket.close();
      socketsRef.current.delete(order.order_id);
    };
    socket.onclose = () => socketsRef.current.delete(order.order_id);
  };

  const showToast = (toast: ToastItem, autoDismiss = true) => {
    setToasts((current) => [...current.filter((item) => item.id !== toast.id), toast].slice(-4));
    if (!autoDismiss) return;
    const timer = window.setTimeout(() => removeToast(toast.id), 3_000);
    toastTimersRef.current.set(toast.id, timer);
  };
  const removeToast = (id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
  };

  const askIntent = baseIntents.find((item) => item.source === "best-ask");
  const bidIntent = baseIntents.find((item) => item.source === "best-bid");
  const offsetIntents = baseIntents.filter((item) => item.source.endsWith("offset"));
  const estimatedAmount = intent && price !== null && qty !== null ? qty * price : 0;
  const cash = Number(balance?.orderable_cash);
  const symbolPicker = (
    <div
      className="quick-order-symbol-picker"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setSymbolSearchOpen(false);
          setSymbolSearchQuery("");
        }
      }}
    >
      <div className={`quick-order-symbol-search ${symbolSearchOpen ? "is-searching" : "is-selected"}`}>
        {symbolSearchOpen ? (
          <>
            <Search size={14} aria-hidden="true" />
            <input
              ref={symbolSearchInputRef}
              value={symbolSearchQuery}
              placeholder={executionMode === "paper" ? "회사명 검색" : "종목 검색"}
              aria-label={executionMode === "paper" ? "빠른 주문 회사명 검색" : "빠른 주문 종목 검색"}
              aria-expanded="true"
              aria-haspopup="listbox"
              onFocus={() => setSymbolSearchQuery("")}
              onChange={(event) => setSymbolSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  const query = event.currentTarget.value.trim().toUpperCase();
                  const exact = visibleSymbolOptions.find((item) => item.symbol === query || item.name.toUpperCase() === query);
                  const next = exact ?? visibleSymbolOptions[0];
                  if (next) selectSymbol(next.symbol);
                }
                if (event.key === "Escape") {
                  setSymbolSearchOpen(false);
                  setSymbolSearchQuery("");
                }
              }}
            />
          </>
        ) : (
          <button
            type="button"
            className="quick-order-selected-symbol"
            aria-label={`선택 종목 ${selectedSymbolName || selectedSymbol}. ${executionMode === "paper" ? "회사명" : "종목"} 검색 열기`}
            aria-expanded="false"
            aria-haspopup="listbox"
            onClick={() => {
              setSymbolSearchQuery("");
              setSymbolSearchOpen(true);
            }}
          >
            <strong>{executionMode === "paper" ? selectedSymbolName || selectedSymbol : selectedSymbol}</strong>
          </button>
        )}
      </div>
      {symbolSearchOpen && (
        <div className="quick-order-symbol-dropdown" role="listbox" aria-label={executionMode === "paper" ? "빠른 주문 회사 선택" : "빠른 주문 종목 선택"}>
          {visibleSymbolOptions.map((item) => (
            <button
              key={item.symbol}
              type="button"
              role="option"
              aria-selected={item.symbol === selectedSymbol}
              className={item.symbol === selectedSymbol ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSymbol(item.symbol)}
            >
              <strong>{item.symbol}</strong>
              <span>{item.name}</span>
            </button>
          ))}
          {visibleSymbolOptions.length === 0 && <span className="quick-order-symbol-empty">일치하는 {executionMode === "paper" ? "회사" : "종목"}가 없습니다</span>}
        </div>
      )}
    </div>
  );

  return (
    <section className="quick-order-panel" data-stream-state={streamState} data-execution-mode={executionMode} aria-label={executionMode === "paper" ? "가상 빠른 주문 패널" : "빠른 주문 패널"}>
      {executionMode !== "paper" && (
        <header className="quick-order-header">
          <span className="quick-order-title">빠른 주문</span>
          {symbolPicker}
        </header>
      )}

      <div className="quick-order-quote-grid" role="group" aria-label="주문 가격 선택">
        <button type="button" className={`quick-order-quote buy ${intent?.source === "best-bid" ? "selected" : ""}`} aria-pressed={intent?.source === "best-bid"} disabled={Boolean(disabledReason)} onClick={() => bidIntent && selectIntent(bidIntent)}>
          <span>최우선 매수호가</span>
          <div className="quick-order-quote-price">
            <strong>{formatPrice(quote?.bidPrice)}</strong>
            <small>대기 {quote?.bidSize ? `${quote.bidSize}주` : "--주"}</small>
          </div>
        </button>
        <div className="quick-order-center-metrics" aria-label="호가 지표">
          <div className="quick-order-metric">
            <span>호가 차이</span>
            <strong>{formatPrice(spread(quote))}</strong>
          </div>
          <div className={`quick-order-metric delta ${tone}`}>
            <span>1분 델타</span>
            <strong>{formatPercent(delta)}</strong>
          </div>
        </div>
        <button type="button" className={`quick-order-quote sell ${intent?.source === "best-ask" ? "selected" : ""}`} aria-pressed={intent?.source === "best-ask"} disabled={Boolean(disabledReason)} onClick={() => askIntent && selectIntent(askIntent)}>
          <span>최우선 매도호가</span>
          <div className="quick-order-quote-price">
            <strong>{formatPrice(quote?.askPrice)}</strong>
            <small>대기 {quote?.askSize ? `${quote.askSize}주` : "--주"}</small>
          </div>
        </button>
      </div>

      <div className="quick-order-controls-grid">
      <div className="quick-order-shortcuts">
        {offsetIntents.map((item) => (
            <button key={item.source} type="button" disabled={Boolean(disabledReason)} aria-label={item.label} aria-pressed={intent?.source === item.source} className={`offset ${item.side} ${intent?.source === item.source ? "selected" : ""}`} onClick={() => selectIntent(item)}>
              <span>{item.side === "buy" ? "매수 -1틱" : "매도 +1틱"}</span>
            <strong>{formatPrice(item.price)}</strong>
          </button>
        ))}
        <button
            type="button"
            aria-label="매수 우위 후보가"
          className={intent?.source === "ask-imbalance" ? "selected signal buy" : "signal buy"}
          aria-pressed={intent?.source === "ask-imbalance"}
          disabled={Boolean(disabledReason) || !imbalances.ask}
          onClick={() => imbalances.ask && selectIntent(imbalances.ask)}
        >
            <span>매수 우위</span><strong>{imbalances.ask ? formatPrice(imbalances.ask.price) : "--"}</strong>
        </button>
        <button
            type="button"
            aria-label="매도 우위 후보가"
          className={intent?.source === "bid-imbalance" ? "selected signal sell" : "signal sell"}
          aria-pressed={intent?.source === "bid-imbalance"}
          disabled={Boolean(disabledReason) || !imbalances.bid}
          onClick={() => imbalances.bid && selectIntent(imbalances.bid)}
        >
            <span>매도 우위</span><strong>{imbalances.bid ? formatPrice(imbalances.bid.price) : "--"}</strong>
        </button>
      </div>

      <div className="quick-order-quantity-section">
          <div className="quick-order-price-header">
            <span>가격</span>
            {intent && <small className={intent.side}>{intent.side === "buy" ? "매수" : "매도"}</small>}
          </div>
        <div className="quick-order-price-editor">
          <label>
            <input
              inputMode="decimal"
              value={priceText}
              placeholder="가격 선택"
              aria-label="빠른 주문 가격 직접 입력"
              disabled={!intent}
              onChange={(event) => updatePriceText(event.target.value)}
              onBlur={normalizePriceInput}
            />
            <span>USD</span>
          </label>
        </div>
          <div className="quick-order-quantity-header">
            <span>수량</span>
        </div>
        <div className="quick-order-quantity-editor">
          <label>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={qtyText}
              placeholder="수량 입력"
              aria-label="주문 수량 직접 입력"
              onChange={(event) => updateQtyText(event.target.value)}
              onBlur={normalizeQtyInput}
            />
            <span>주</span>
          </label>
          <div className="quick-order-quantity-steppers" role="group" aria-label="수량 조정">
            <button type="button" onClick={() => updateQty((qty ?? 1) - 1)} aria-label="수량 줄이기"><Minus size={16} /></button>
            <button type="button" onClick={() => updateQty((qty ?? 0) + 1)} aria-label="수량 늘리기"><Plus size={16} /></button>
          </div>
        </div>
        <div className="quick-order-ratio-buttons" role="group" aria-label="주문 가능 금액 비율">
          {[0.1, 0.25, 0.5, 1].map((ratio) => (
            <button key={ratio} type="button" disabled={price === null || !Number.isFinite(cash)} onClick={() => applyBuyingPowerRatio(ratio)}>
              {ratio === 1 ? "최대" : `${ratio * 100}%`}
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="quick-order-footer">
      <div className="quick-order-review" aria-live="polite">
        {executionMode === "paper" ? symbolPicker : <strong className="quick-order-review-company">{selectedSymbolName || selectedSymbol}</strong>}
        <span className="quick-order-total-label">예상 주문액</span>
        <strong className="quick-order-total-value">{intent && price !== null && qty !== null ? `$${estimatedAmount.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}</strong>
      </div>
      <button className={`quick-order-submit ${intent?.side ?? ""}`} type="button" disabled={!intent || price === null || qty === null || Boolean(disabledReason) || authLoading || Boolean(risk && risk.verdict !== "allow")} onClick={submit}>
        {submitting ? <LoaderCircle size={15} className="spin" /> : <SendHorizontal size={15} />}
        {authEnabled && !user ? "로그인 후 주문" : submitting ? "전송 중" : "주문 전송"}
      </button>
      </div>

      <div className="quick-order-status-layer" aria-live="polite">
        {risk && intent && risk.verdict !== "allow" && (
          <div className={`quick-order-risk ${risk.verdict}`}>
            {riskLoading ? <LoaderCircle size={13} className="spin" /> : <AlertTriangle size={13} />}
            <span>{risk.verdict === "resize" ? `권장 수량 ${risk.adjustedQty ?? "확인 필요"}` : "리스크 정책으로 주문 차단"}</span>
            {risk.verdict === "resize" && risk.adjustedQty && <button type="button" onClick={() => updateQty(Number(risk.adjustedQty))}>적용</button>}
          </div>
        )}
        {disabledReason && !HIDDEN_STATE_MESSAGES.has(disabledReason) && <div className="quick-order-state-note" data-blocked="true">{disabledReason}</div>}
      </div>

      <div className="quick-order-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => <div key={toast.id} className={`quick-order-toast ${toast.tone}`}>{toast.message}</div>)}
      </div>
    </section>
  );
}

function normalizeQuote(event: Extract<CandleEventDto, { type: "LIVE_TRADE_UPDATE" | "LIVE_QUOTE_UPDATE" }>): QuickOrderQuote {
  const data = event.data;
  return {
    bidPrice: finiteNumber(data.bidPrice), askPrice: finiteNumber(data.askPrice),
    bidSize: finiteNumber(data.bidSize), askSize: finiteNumber(data.askSize),
    timestamp: typeof data.timestamp === "string" ? data.timestamp : undefined
  };
}

function orderPayload(symbol: string, exchange: string, qty: number, intent: QuickOrderIntent): OrderRequestPayload {
  return { market: "overseas", symbol, side: intent.side, qty: String(qty), price: intent.price.toFixed(2), exchange, order_division: "00", actor_id: "gops-frontend", role: "trader" };
}

function exchangeForSymbol(symbol: string, options: readonly WatchlistSymbol[]): string {
  const market = options.find((item) => item.symbol === symbol)?.market?.toUpperCase();
  if (market === "NYSE") return "NYSE";
  if (market === "AMEX" || market === "ARCA") return "AMEX";
  return "NASD";
}

function quickOrderDisabledReason(input: { supported: boolean; quoteUsable: boolean; streamState: StreamState; submitting: boolean }): string | null {
  if (!input.supported) return "현재 Order Flow 지원 종목에서만 사용할 수 있습니다.";
  if (input.streamState === "error") return "실시간 시세 연결을 복구하는 중입니다.";
  if (input.streamState === "connecting") return "실시간 시세에 연결하는 중입니다.";
  if (!input.quoteUsable) return WAITING_FOR_QUOTE_MESSAGE;
  if (input.submitting) return WAITING_FOR_SUBMISSION_MESSAGE;
  return null;
}

const WAITING_FOR_QUOTE_MESSAGE = "유효한 최우선 매수·매도호가를 기다리는 중입니다.";
const WAITING_FOR_SUBMISSION_MESSAGE = "이전 주문의 접수 결과를 기다리는 중입니다.";
const HIDDEN_STATE_MESSAGES = new Set([WAITING_FOR_QUOTE_MESSAGE, WAITING_FOR_SUBMISSION_MESSAGE]);

function spread(quote: QuickOrderQuote | null): number | undefined {
  return typeof quote?.bidPrice === "number" && typeof quote.askPrice === "number" ? quote.askPrice - quote.bidPrice : undefined;
}
function formatPrice(value: number | undefined): string { return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "--"; }
function formatPercent(value: number): string { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function symbolSearchScore(item: { symbol: string; name: string }, query: string): number {
  if (!query) return 0;
  if (item.symbol === query) return 0;
  if (item.symbol.startsWith(query)) return 1;
  if (item.name.toUpperCase().startsWith(query)) return 2;
  if (item.symbol.includes(query)) return 3;
  return 4;
}
function finiteNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePriceText(value: string): string {
  const sanitized = value.replace(/[^\d.]/g, "");
  const [whole = "", ...decimalParts] = sanitized.split(".");
  const normalizedWhole = whole.slice(0, 9);
  if (!decimalParts.length) return normalizedWhole;
  return `${normalizedWhole}.${decimalParts.join("").slice(0, 2)}`;
}

function parsePositivePrice(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
