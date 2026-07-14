import { LoaderCircle, LogIn, Search, SendHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSymbolMeta, normalizeSupportedSymbol, type SupportedSymbol, type WatchlistSymbol } from "@gops/chart-engine/symbols";
import { useAuth } from "../auth/AuthProvider";
import {
  makeIdempotencyKey,
  orderBalancePath,
  orderWebSocketUrl,
  parseRiskDetail,
  type OrderExecutionMode,
  type OrderSide,
  type OrderSnapshot,
  type OrderSocketPayload,
  type RiskRule,
  type RiskVerdict
} from "../orders/orderClient";
import { searchPaperSymbols } from "../orders/paperTradingClient";
import {
  fetchSimulatorStatus,
  requestPortfolioRefresh,
  simulatorStatusEvent,
  submitSimulatorBasket,
  type SimulatorStatus
} from "../simulator/simulatorApi";

type OrderMarket = "overseas";

type OrderFormState = {
  market: OrderMarket;
  symbol: string;
  side: OrderSide;
  qty: string;
  price: string;
  exchange: string;
};

type OrderTicketProps = {
  activeSymbol: SupportedSymbol;
  chartSymbols: readonly WatchlistSymbol[];
  symbolOptions: readonly WatchlistSymbol[];
  onSymbolOptionsRequest: (query: string) => void;
  executionMode?: OrderExecutionMode;
};

type OrderBalance = {
  currency?: string;
  exchange?: string;
  orderable_cash?: string | null;
  orderable_qty?: string | null;
};

function riskVerdictLabel(risk: RiskVerdict): string {
  if (risk.verdict === "block") {
    return "주문 내용 확인이 필요합니다";
  }
  if (risk.verdict === "resize") {
    return "수량 조정이 필요합니다";
  }
  if (risk.triggeredRules.some((rule) => rule.action === "warn")) {
    return "주문 전 확인 사항이 있습니다";
  }
  return "설정한 위험 한도 이내입니다";
}

function riskBoxTone(risk: RiskVerdict): RiskVerdict["verdict"] | "warn" {
  if (risk.verdict === "allow" && risk.triggeredRules.some((rule) => rule.action === "warn")) {
    return "warn";
  }
  return risk.verdict;
}

const DEFAULT_FORM: OrderFormState = {
  market: "overseas",
  symbol: "AAPL",
  side: "buy",
  qty: "1",
  price: "",
  exchange: "NASD"
};

const ORDER_SEARCH_RESULT_LIMIT = 8;
const SHORT_COMPANY_NAMES: Record<string, string> = {
  NVDA: "NVIDIA"
};

const sideLabels: Record<OrderSide, string> = {
  buy: "매수",
  sell: "매도"
};

function orderStatusLabel(status?: string): string {
  switch (status?.toLowerCase()) {
    case "received":
      return "주문 요청을 받았습니다";
    case "published":
    case "submitting":
    case "pending":
      return "주문을 접수하고 있습니다";
    case "accepted":
    case "submitted":
      return "주문이 접수되었습니다";
    case "partially_filled":
      return "주문이 일부 체결되었습니다";
    case "filled":
      return "주문이 체결되었습니다";
    case "rejected":
      return "주문이 거절되었습니다";
    case "risk_rejected":
      return "위험 한도를 초과해 주문이 거절되었습니다";
    case "cancelled":
    case "canceled":
      return "주문이 취소되었습니다";
    case "submit_failed_unknown":
    case "reconciliation_required":
      return "주문 상태를 확인하고 있습니다";
    case "failed":
      return "주문 처리에 실패했습니다";
    default:
      return status ? "주문 상태를 확인하고 있습니다" : "주문할 수 있습니다";
  }
}

function orderStatusDescription(status?: string): string {
  switch (status?.toLowerCase()) {
    case "received":
    case "published":
    case "submitting":
    case "pending":
      return "주문을 거래 시스템에 전달하고 있습니다. 잠시만 기다려 주십시오.";
    case "accepted":
    case "submitted":
      return "주문이 거래 시스템에 접수되었습니다. 체결 여부는 상태가 바뀌면 알려드립니다.";
    case "partially_filled":
      return "주문 수량 중 일부만 체결되었습니다. 남은 수량은 계속 처리 중입니다.";
    case "filled":
      return "주문한 수량이 모두 체결되었습니다.";
    case "risk_rejected":
      return "설정한 위험 한도를 확인하고 주문 내용을 수정해 주십시오.";
    case "rejected":
      return "주문 가격과 수량을 확인한 뒤 다시 시도해 주십시오.";
    case "cancelled":
    case "canceled":
      return "취소된 주문은 체결되지 않습니다.";
    case "submit_failed_unknown":
    case "reconciliation_required":
      return "거래 시스템의 응답을 확인하고 있습니다. 같은 주문을 반복해서 누르지 마십시오.";
    case "failed":
      return "주문이 접수되지 않았습니다. 잠시 후 다시 시도해 주십시오.";
    default:
      return "잠시 후 주문 상태가 갱신됩니다.";
  }
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatCurrency(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function parseFiniteNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatOrderAmount(qty: string, price: string): string {
  const quantity = Number(qty);
  const orderPrice = Number(price);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(orderPrice) || orderPrice <= 0) {
    return "-";
  }

  return formatUsd(quantity * orderPrice);
}

function displayCompanyName(meta: Pick<WatchlistSymbol, "symbol" | "name">): string {
  return SHORT_COMPANY_NAMES[meta.symbol] ?? meta.name;
}

function formatPriceInput(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(2) : "";
}

function normalizeDecimalText(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function marketToExchange(market: string | undefined, fallback = "NASD"): string {
  switch (market?.trim().toUpperCase()) {
    case "NASDAQ":
      return "NASD";
    case "NYSE":
      return "NYSE";
    case "AMEX":
    case "ARCA":
      return "AMEX";
    default:
      return fallback;
  }
}

function dedupeSymbols(symbols: readonly WatchlistSymbol[]): WatchlistSymbol[] {
  const bySymbol = new Map<string, WatchlistSymbol>();
  for (const item of symbols) {
    const symbol = normalizeSupportedSymbol(item.symbol);
    if (symbol && !bySymbol.has(symbol)) {
      bySymbol.set(symbol, { ...item, symbol });
    }
  }
  return Array.from(bySymbol.values());
}

function resolveSymbolMeta(symbolValue: string, symbols: readonly WatchlistSymbol[]): WatchlistSymbol {
  const symbol = normalizeSupportedSymbol(symbolValue) ?? symbolValue.toUpperCase();
  const known = symbols.find((item) => item.symbol === symbol);
  const fallback = getSymbolMeta(symbol);
  if (known) {
    const name = known.name && known.name !== symbol ? known.name : fallback.name;
    const market = known.market && known.market !== "US" ? known.market : fallback.market;
    return { ...known, name, market };
  }
  return {
    symbol: fallback.symbol,
    name: fallback.name,
    market: fallback.market
  };
}

function symbolSearchScore(item: WatchlistSymbol, query: string): number {
  if (!query) {
    return 0;
  }
  const name = item.name.toUpperCase();
  if (item.symbol === query) {
    return 0;
  }
  if (item.symbol.startsWith(query)) {
    return 1;
  }
  if (name.startsWith(query)) {
    return 2;
  }
  if (item.symbol.includes(query)) {
    return 3;
  }
  if (name.includes(query)) {
    return 4;
  }
  return 5;
}

export function OrderTicket({
  activeSymbol,
  chartSymbols,
  symbolOptions,
  onSymbolOptionsRequest,
  executionMode = "kis"
}: OrderTicketProps) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const [form, setForm] = useState<OrderFormState>({ ...DEFAULT_FORM, symbol: activeSymbol });
  const [symbolSearchQuery, setSymbolSearchQuery] = useState("");
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [paperSymbolOptions, setPaperSymbolOptions] = useState<WatchlistSymbol[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [order, setOrder] = useState<OrderSnapshot | undefined>();
  const [balance, setBalance] = useState<OrderBalance | undefined>();
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | undefined>();
  const [simulationMode, setSimulationMode] = useState(false);
  const [useDemoBasket, setUseDemoBasket] = useState(true);
  const [risk, setRisk] = useState<RiskVerdict | undefined>();
  const [riskLoading, setRiskLoading] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const activeMeta = getSymbolMeta(activeSymbol);
    setForm((current) => ({
      ...current,
      symbol: activeSymbol,
      price: "",
      exchange: marketToExchange(activeMeta.market, current.exchange)
    }));
  }, [activeSymbol]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (executionMode === "paper") {
      setSimulationMode(false);
      return;
    }
    let cancelled = false;
    const refresh = () => void fetchSimulatorStatus()
      .then((status) => {
        if (!cancelled) setSimulationMode(status.mode === "simulation");
      })
      .catch(() => undefined);
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<SimulatorStatus>).detail;
      setSimulationMode(detail?.mode === "simulation");
    };
    refresh();
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => {
      cancelled = true;
      window.removeEventListener(simulatorStatusEvent, handleStatus);
    };
  }, [executionMode]);

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

  const allSymbolOptions = useMemo(
    () => dedupeSymbols([...chartSymbols, ...symbolOptions, ...paperSymbolOptions]),
    [chartSymbols, paperSymbolOptions, symbolOptions]
  );

  const selectedSymbolMeta = useMemo(
    () => resolveSymbolMeta(form.symbol, allSymbolOptions),
    [allSymbolOptions, form.symbol]
  );

  const visibleSearchOptions = useMemo(() => {
    const query = symbolSearchQuery.trim().toUpperCase();
    return dedupeSymbols(allSymbolOptions)
      .filter((item) => !query || item.symbol.includes(query) || item.name.toUpperCase().includes(query))
      .sort((left, right) => symbolSearchScore(left, query) - symbolSearchScore(right, query) || left.symbol.localeCompare(right.symbol))
      .slice(0, ORDER_SEARCH_RESULT_LIMIT);
  }, [allSymbolOptions, symbolSearchQuery]);

  const selectedCompanyName = displayCompanyName(selectedSymbolMeta);
  const orderableCash = parseFiniteNumber(balance?.orderable_cash);
  const balanceCurrency = balance?.currency || "USD";
  const balanceLabel = balanceLoading
    ? "조회 중"
    : orderableCash !== undefined
      ? formatCurrency(orderableCash, balanceCurrency)
      : balanceError ? "조회 실패" : "-";

  useEffect(() => {
    const queryPrice = Number(form.price);
    const balanceQueryPrice = typeof queryPrice === "number" && Number.isFinite(queryPrice) && queryPrice > 0
      ? formatPriceInput(queryPrice)
      : "0";
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setBalanceLoading(true);
      setBalanceError(undefined);
      try {
        const params = new URLSearchParams({
          symbol: form.symbol,
          exchange: form.exchange,
          price: balanceQueryPrice
        });
        const response = await fetch(`${orderBalancePath(executionMode)}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail ?? `잔고 조회 API 오류 ${response.status}`);
        }
        setBalance(payload as OrderBalance);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setBalance(undefined);
          setBalanceError(caught instanceof Error ? caught.message : "잔고 조회에 실패했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setBalanceLoading(false);
        }
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [executionMode, form.exchange, form.price, form.symbol, simulationMode]);

  useEffect(() => {
    if (simulationMode && useDemoBasket) {
      setRisk(undefined);
      return;
    }
    const previewPrice = Number(form.price);
    const quantity = Number(form.qty);
    if (!Number.isInteger(quantity) || quantity <= 0 || typeof previewPrice !== "number" || !Number.isFinite(previewPrice) || previewPrice <= 0) {
      setRisk(undefined);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setRiskLoading(true);
      try {
        const response = await fetch(executionMode === "paper" ? "/api/paper/risk/pretrade" : "/api/risk/pretrade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            market: form.market,
            symbol: form.symbol,
            side: form.side,
            qty: String(quantity),
            price: formatPriceInput(previewPrice),
            exchange: form.exchange,
            order_division: "00"
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload.detail === "string" ? payload.detail : `리스크 점검 API 오류 ${response.status}`);
        }
        setRisk(payload.risk as RiskVerdict);
      } catch {
        if (!controller.signal.aborted) {
          setRisk(undefined);
        }
      } finally {
        if (!controller.signal.aborted) {
          setRiskLoading(false);
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [executionMode, form.exchange, form.market, form.price, form.qty, form.side, form.symbol, simulationMode, useDemoBasket]);

  const applyRuleSuggestion = (rule: RiskRule) => {
    const quantity = rule.suggestedQty ? Number(rule.suggestedQty) : NaN;
    if (Number.isInteger(quantity) && quantity > 0) {
      setForm((current) => ({ ...current, qty: String(quantity) }));
      setError(undefined);
      return;
    }
    const price = rule.suggestedPrice ? Number(rule.suggestedPrice) : NaN;
    if (Number.isFinite(price) && price > 0) {
      setForm((current) => ({ ...current, price: formatPriceInput(price) }));
      setError(undefined);
    }
  };

  const selectOrderSymbol = (symbolValue: string) => {
    const symbol = normalizeSupportedSymbol(symbolValue);
    if (!symbol) {
      setError("유효한 종목 코드 입력이 필요합니다.");
      return;
    }
    const meta = resolveSymbolMeta(symbol, allSymbolOptions);
    setForm((current) => ({
      ...current,
      symbol,
      price: "",
      exchange: marketToExchange(meta.market, current.exchange)
    }));
    setSymbolSearchQuery("");
    setSymbolSearchOpen(false);
    setError(undefined);
  };

  const updateTextField = (field: "qty" | "price", value: string) => {
    setForm((current) => ({ ...current, [field]: normalizeDecimalText(value) }));
  };

  const connectSocket = (orderId: string) => {
    socketRef.current?.close();
    const socket = new WebSocket(orderWebSocketUrl(orderId, executionMode));
    socketRef.current = socket;

    socket.onerror = () => {
      setError("주문 상태를 실시간으로 확인할 수 없습니다. 주문번호로 상태를 다시 확인해 주십시오.");
    };
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as OrderSocketPayload;
      if (payload.type === "error") {
        setError(payload.detail ?? "주문 상태를 확인하는 중 문제가 발생했습니다.");
        return;
      }
      if (payload.order) {
        setOrder(payload.order);
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
    if (simulationMode && useDemoBasket) {
      try {
        const payload = await submitSimulatorBasket(form.side, idempotencyKey);
        const orders = payload.orders;
        const orderIds = orders.map((item) => String(item.order_id ?? "")).filter(Boolean);
        setOrder({
          order_id: orderIds.join(", ") || `sim-basket-${Date.now()}`,
          request_id: idempotencyKey,
          client_order_id: idempotencyKey,
          status: "filled",
          side: form.side,
          qty: String(orders.length),
          simulation: true
        });
        requestPortfolioRefresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "SIM 바스켓 주문에 실패했습니다.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const submitPrice = form.price;
    const quantity = Number(form.qty);
    const price = Number(submitPrice);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError(executionMode === "paper" ? "가상투자는 정수 수량만 주문할 수 있습니다." : "해외주식 모의투자는 정수 수량만 주문할 수 있습니다.");
      setSubmitting(false);
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("주문 가격 입력이 필요합니다.");
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch(executionMode === "paper" ? "/api/paper/orders" : "/api/orders", {
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
          price: submitPrice,
          exchange: form.exchange,
          order_division: "00",
          actor_id: "gops-frontend",
          role: "trader",
          risk_acknowledged: Boolean(risk && risk.verdict !== "allow")
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        const riskDetail = parseRiskDetail(payload.detail);
        if (riskDetail) {
          setRisk(riskDetail);
          const suggestion = riskDetail.adjustedQty ? ` 권장 수량 ${riskDetail.adjustedQty}주로 다시 시도할 수 있습니다.` : "";
          throw new Error(
            riskDetail.verdict === "block"
              ? `리스크 매니저가 주문을 차단했습니다.${suggestion}`
              : `리스크 매니저가 수량 조정을 권고했습니다.${suggestion}`
          );
        }
        throw new Error(
          typeof payload.detail === "string"
            ? payload.detail
            : response.status === 401 ? "주문하려면 Google 로그인이 필요합니다." : `주문 API 오류 ${response.status}`
        );
      }
      if (payload.risk) {
        setRisk(payload.risk as RiskVerdict);
      }
      setOrder(payload);
      if (payload.simulation) {
        requestPortfolioRefresh();
      } else {
        connectSocket(payload.order_id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "주문 요청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const quantity = Number(form.qty);
  const price = Number(form.price);
  const individualOrderReady = Number.isInteger(quantity) && quantity > 0 && Number.isFinite(price) && price > 0;
  const orderReady = simulationMode && useDemoBasket ? true : individualOrderReady;
  const riskNeedsAcknowledgement = executionMode === "kis" && Boolean(risk && risk.verdict !== "allow");
  const paperRiskBlocked = executionMode === "paper" && risk?.verdict === "block";
  const estimatedAmount = formatOrderAmount(form.qty, form.price);
  const orderSummary = `${form.symbol} ${form.qty || "-"}주 · ${sideLabels[form.side]} · 지정가`;

  return (
    <section className="order-ticket order-ticket-v3" data-order-side={form.side} data-execution-mode={executionMode} aria-label={executionMode === "paper" ? "가상 주문 패널" : "주문 패널"}>
      <header className="order-ticket-heading">
        <div>
          <strong>{executionMode === "paper" ? "가상 주문하기" : "주문하기"}</strong>
          <span className="order-side-badge">{sideLabels[form.side]} 주문</span>
        </div>
        <p>주문 방향, 가격과 수량을 확인한 뒤 주문합니다.</p>
      </header>

      <section className="order-ticket-section" aria-labelledby="order-side-title">
        <h3 id="order-side-title">매수 또는 매도</h3>
        <div className="order-side-control" role="group" aria-label="매수 매도 선택">
          <button
            className={form.side === "buy" ? "active" : ""}
            type="button"
            aria-pressed={form.side === "buy"}
            onClick={() => setForm((current) => ({ ...current, side: "buy" }))}
          >
            매수
          </button>
          <button
            className={form.side === "sell" ? "active" : ""}
            type="button"
            aria-pressed={form.side === "sell"}
            onClick={() => setForm((current) => ({ ...current, side: "sell" }))}
          >
            매도
          </button>
        </div>
      </section>

      {executionMode === "kis" && simulationMode && (
        <div className="simulation-order-banner">
          <div>
            <span>SIMULATION · 실제 주문 전송 없음</span>
            <strong>{form.side === "sell" ? "반도체 5종 전량 매도" : "가용 현금으로 에너지 3종 매수"}</strong>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useDemoBasket}
            className={useDemoBasket ? "active" : ""}
            onClick={() => setUseDemoBasket((current) => !current)}
          >
            {useDemoBasket ? "바스켓 ON" : "개별 주문"}
          </button>
        </div>
      )}

      <section className="order-ticket-section" aria-labelledby="order-symbol-title">
        <h3 id="order-symbol-title">종목</h3>
        <div
          className="order-field order-symbol-field"
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setSymbolSearchOpen(false);
            }
          }}
        >
          <label htmlFor="order-symbol-search">주문 종목</label>
          <div className="order-symbol-picker">
            <div className="order-symbol-search">
              <Search size={13} aria-hidden="true" />
              <input
                id="order-symbol-search"
                value={symbolSearchQuery}
                placeholder={`${form.symbol} ${selectedCompanyName}`}
                aria-label="주문 종목 검색"
                aria-expanded={symbolSearchOpen}
                onFocus={() => {
                  setSymbolSearchOpen(true);
                  onSymbolOptionsRequest(symbolSearchQuery);
                }}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  setSymbolSearchQuery(value);
                  setSymbolSearchOpen(true);
                  onSymbolOptionsRequest(value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    const query = event.currentTarget.value.toUpperCase();
                    const exact = visibleSearchOptions.find((item) => item.symbol === query);
                    selectOrderSymbol(exact?.symbol ?? query);
                  }
                  if (event.key === "Escape") {
                    setSymbolSearchOpen(false);
                  }
                }}
              />
            </div>

            {symbolSearchOpen && (
              <div className="order-symbol-dropdown" role="listbox" aria-label="주문 종목 선택">
                <div className="order-symbol-dropdown-section">
                  {visibleSearchOptions.map((item) => (
                    <button
                      key={`search-${item.symbol}`}
                      type="button"
                      role="option"
                      aria-selected={item.symbol === form.symbol}
                      className={item.symbol === form.symbol ? "order-symbol-option active" : "order-symbol-option"}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectOrderSymbol(item.symbol)}
                    >
                      <strong>{item.symbol}</strong>
                      <span>{displayCompanyName(item)}</span>
                    </button>
                  ))}
                  {visibleSearchOptions.length === 0 && (
                    <span className="order-symbol-empty">일치하는 종목이 없습니다</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="order-ticket-section" aria-labelledby="order-entry-title">
        <h3 id="order-entry-title">가격과 수량</h3>
        <div className="order-entry-grid">
          <label className="order-field" htmlFor="order-price-input">
            <span>주문 가격 (USD)</span>
            <div className="order-input-unit">
              <input
                id="order-price-input"
                inputMode="decimal"
                value={form.price}
                placeholder="예: 70.40"
                aria-label="주문 가격"
                onChange={(event) => updateTextField("price", event.target.value)}
              />
              <span>USD</span>
            </div>
            <small>주문할 가격을 직접 입력합니다.</small>
          </label>
          <label className="order-field" htmlFor="order-quantity-input">
            <span>수량 (주)</span>
            <div className="order-input-unit">
              <input
                id="order-quantity-input"
                inputMode="numeric"
                value={form.qty}
                placeholder="예: 1"
                aria-label="주문 수량"
                onChange={(event) => updateTextField("qty", event.target.value)}
              />
              <span>주</span>
            </div>
            <small>보유 가능 금액과 리스크 한도를 함께 확인합니다.</small>
          </label>
        </div>
      </section>

      <div className="order-summary-box order-summary-box-v2">
        <div>
          <span>주문 요약</span>
          <strong>{estimatedAmount === "-" ? "가격 입력이 필요합니다" : estimatedAmount}</strong>
        </div>
        <p>{orderSummary}</p>
        <div className="order-buying-power-row">
          <span>주문 가능 금액</span>
          <strong>{balanceLabel}</strong>
        </div>
      </div>

      {risk && !(simulationMode && useDemoBasket) && (
        <div className={`order-risk-box order-risk-${riskBoxTone(risk)}`} aria-live="polite">
          <div className="order-risk-header">
            <strong>{riskLoading ? "리스크 점검 중" : riskVerdictLabel(risk)}</strong>
          </div>
          {risk.triggeredRules.length > 0 && (
            <ul className="order-risk-rules">
              {risk.triggeredRules.slice(0, 3).map((rule) => (
                <li key={rule.ruleId} data-risk-action={rule.action}>
                  <div className="order-risk-rule-copy">
                    <strong>{rule.title ?? "주문 내용 확인이 필요합니다"}</strong>
                    <p>{rule.explanation}</p>
                    {rule.guidance && <small>{rule.guidance}</small>}
                  </div>
                  {rule.suggestedActionLabel && (rule.suggestedQty || rule.suggestedPrice) && (
                    <button
                      type="button"
                      className="order-risk-rule-action"
                      onClick={() => applyRuleSuggestion(rule)}
                    >
                      {rule.suggestedActionLabel}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="order-submit-area">
        <button
          className="order-submit-button"
          type="button"
          disabled={submitting || authLoading || riskLoading || !orderReady || paperRiskBlocked}
          onClick={submitOrder}
        >
          {submitting
            ? <LoaderCircle size={14} className="spin" />
            : authEnabled && !user ? <LogIn size={14} /> : <SendHorizontal size={14} />}
          {submitting
            ? "주문 전송 중"
            : authEnabled && !user
              ? "로그인"
              : paperRiskBlocked
                ? "주문 가능 범위를 확인해 주세요"
              : simulationMode && useDemoBasket
                ? form.side === "sell" ? "반도체 5종 매도 주문" : "에너지 3종 매수 주문"
                : riskNeedsAcknowledgement
                  ? `경고 확인 후 ${form.symbol} ${form.qty || "-"}주 ${sideLabels[form.side]} 주문`
                  : `${form.symbol} ${form.qty || "-"}주 ${sideLabels[form.side]} 주문`}
        </button>
        <small>
          {riskNeedsAcknowledgement
            ? "리스크 안내를 확인한 뒤에도 입력한 가격과 수량 그대로 주문할 수 있습니다."
            : executionMode === "paper"
              ? `예상 주문 금액 ${estimatedAmount} · 가상계좌 주문으로 접수됩니다.`
            : simulationMode && useDemoBasket
            ? "버튼을 누르면 모의 주문이 바로 전송됩니다."
            : `예상 주문 금액 ${estimatedAmount} · 버튼을 누르면 주문이 바로 전송됩니다.`}
        </small>
      </div>

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
          <p>{orderStatusDescription(order.status)}</p>
        </div>
      )}
    </section>
  );
}
