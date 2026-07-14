import { LoaderCircle, LogIn, RefreshCw, RotateCcw, WalletCards, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { OrderSnapshot } from "../orders/orderClient";
import { useAuth } from "../auth/AuthProvider";
import {
  cancelPaperOrder,
  fetchPaperAccount,
  fetchPaperOrders,
  paperAccountWebSocketUrl,
  resetPaperAccount,
  type PaperAccountSnapshot
} from "../orders/paperTradingClient";

type AccountTab = "holdings" | "open" | "history";

export function PaperAccountPanel() {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<PaperAccountSnapshot>();
  const [history, setHistory] = useState<OrderSnapshot[]>([]);
  const [tab, setTab] = useState<AccountTab>("holdings");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [cancellingOrderId, setCancellingOrderId] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetCash, setResetCash] = useState("100000");
  const [resetting, setResetting] = useState(false);

  const refresh = useCallback(async () => {
    if (authEnabled && !user) {
      setLoading(false);
      return;
    }
    setError(undefined);
    try {
      const account = await fetchPaperAccount();
      setSnapshot(account);
      setResetCash(String(account.account.starting_cash));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가상계좌를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [authEnabled, user]);

  const refreshHistory = useCallback(async () => {
    if (authEnabled && !user) return;
    setHistoryLoading(true);
    try {
      setHistory(await fetchPaperOrders());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "거래내역을 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }, [authEnabled, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === "history") void refreshHistory();
  }, [refreshHistory, tab]);

  useEffect(() => {
    if (authEnabled && !user) return;
    const socket = new WebSocket(paperAccountWebSocketUrl());
    socketRef.current = socket;
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; account?: PaperAccountSnapshot; detail?: string };
      if (payload.account) setSnapshot(payload.account);
      if (payload.type === "error") setError(payload.detail || "가상계좌 실시간 연결 오류");
    };
    socket.onerror = () => setError("가상계좌 실시간 연결을 확인하고 있습니다.");
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [authEnabled, user]);

  const cancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    setError(undefined);
    try {
      await cancelPaperOrder(orderId);
      await Promise.all([refresh(), refreshHistory()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "주문을 취소하지 못했습니다.");
    } finally {
      setCancellingOrderId(undefined);
    }
  };

  const confirmReset = async () => {
    const amount = Number(resetCash);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("새 시작금은 0보다 큰 금액이어야 합니다.");
      return;
    }
    setResetting(true);
    setError(undefined);
    try {
      const account = await resetPaperAccount(amount);
      setSnapshot(account);
      setHistory([]);
      setTab("holdings");
      setResetOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가상계좌를 초기화하지 못했습니다.");
    } finally {
      setResetting(false);
    }
  };

  const orders = useMemo(() => history.filter((order) => order.status !== "pending"), [history]);
  const account = snapshot?.account;

  return (
    <section className="paper-account-panel" aria-label="가상계좌 패널">
      <header className="paper-account-header">
        <div>
          <WalletCards size={17} aria-hidden="true" />
          <strong>가상계좌</strong>
          {account && <span>{account.generation}회차</span>}
        </div>
        {(!authEnabled || user) && (
          <div className="paper-account-header-actions">
            <button type="button" title="새로고침" aria-label="가상계좌 새로고침" onClick={() => void refresh()}>
              <RefreshCw size={15} />
            </button>
            <button type="button" title="계좌 초기화" aria-label="가상계좌 초기화" onClick={() => setResetOpen(true)}>
              <RotateCcw size={15} />
            </button>
          </div>
        )}
      </header>

      {authEnabled && !user ? (
        <div className="paper-account-login">
          <LogIn size={18} aria-hidden="true" />
          <strong>가상계좌를 사용하려면 로그인해 주세요.</strong>
          <button type="button" disabled={authLoading} onClick={login}>로그인</button>
        </div>
      ) : loading && !snapshot ? (
        <div className="paper-account-loading"><LoaderCircle size={18} className="spin" />계좌 조회 중</div>
      ) : account ? (
        <>
          <div className="paper-account-summary">
            <SummaryMetric label="총 자산" value={formatUsd(account.equity)} />
            <SummaryMetric label="주문 가능" value={formatUsd(account.available_cash)} />
            <SummaryMetric label="보유 평가액" value={formatUsd(account.market_value)} />
            <SummaryMetric
              label="총 손익"
              value={`${formatSignedUsd(account.total_pnl)} · ${formatSignedPercent(account.total_pnl_rate)}`}
              tone={toneFor(account.total_pnl)}
            />
          </div>

          <div className="paper-account-tabs" role="tablist" aria-label="가상계좌 보기">
            <TabButton active={tab === "holdings"} onClick={() => setTab("holdings")}>보유종목</TabButton>
            <TabButton active={tab === "open"} onClick={() => setTab("open")}>미체결 {snapshot.open_orders.length}</TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>거래내역</TabButton>
          </div>

          <div className="paper-account-body">
            {tab === "holdings" && (
              snapshot.positions.length ? (
                <div className="paper-account-table paper-position-table">
                  <div className="paper-account-table-head"><span>종목</span><span>수량</span><span>평균가</span><span>현재가</span><span>평가손익</span></div>
                  {snapshot.positions.map((position) => (
                    <div className="paper-account-table-row" key={position.symbol}>
                      <strong>{position.symbol}</strong>
                      <span>{formatShares(position.qty)}</span>
                      <span>{formatUsd(position.average_price)}</span>
                      <span>{formatUsd(position.current_price)}</span>
                      <span className={toneFor(position.unrealized_pnl)}>{formatSignedUsd(position.unrealized_pnl)}<small>{formatSignedPercent(position.unrealized_pnl_rate)}</small></span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState message="아직 보유한 가상 종목이 없습니다." />
            )}

            {tab === "open" && (
              snapshot.open_orders.length ? (
                <div className="paper-account-order-list">
                  {snapshot.open_orders.map((order) => (
                    <OrderRow
                      key={order.order_id}
                      order={order}
                      action={(
                        <button
                          type="button"
                          title="미체결 주문 취소"
                          aria-label={`${order.symbol || "종목"} 주문 취소`}
                          disabled={cancellingOrderId === order.order_id}
                          onClick={() => void cancelOrder(order.order_id)}
                        >
                          {cancellingOrderId === order.order_id ? <LoaderCircle size={14} className="spin" /> : <XCircle size={14} />}
                        </button>
                      )}
                    />
                  ))}
                </div>
              ) : <EmptyState message="대기 중인 가상 주문이 없습니다." />
            )}

            {tab === "history" && (
              historyLoading && !orders.length ? (
                <div className="paper-account-loading"><LoaderCircle size={16} className="spin" />내역 조회 중</div>
              ) : orders.length ? (
                <div className="paper-account-order-list">
                  {orders.map((order) => <OrderRow key={order.order_id} order={order} />)}
                </div>
              ) : <EmptyState message="아직 체결 또는 취소된 주문이 없습니다." />
            )}
          </div>
        </>
      ) : null}

      {error && <div className="paper-account-error">{error}</div>}

      {resetOpen && (!authEnabled || user) && (
        <div className="paper-reset-overlay" role="presentation" onMouseDown={() => !resetting && setResetOpen(false)}>
          <div className="paper-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-reset-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong id="paper-reset-title">가상계좌 초기화</strong>
              <p>미체결 주문과 현재 포지션을 종료하고 새 회차를 시작합니다. 이전 거래내역은 보존됩니다.</p>
            </header>
            <label>
              <span>새 시작금 (USD)</span>
              <input inputMode="decimal" value={resetCash} onChange={(event) => setResetCash(event.target.value.replace(/[^\d.]/g, ""))} />
            </label>
            <div className="paper-reset-actions">
              <button type="button" disabled={resetting} onClick={() => setResetOpen(false)}>취소</button>
              <button type="button" className="danger" disabled={resetting} onClick={() => void confirmReset()}>
                {resetting && <LoaderCircle size={14} className="spin" />}초기화
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return <div><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>{children}</button>;
}

function OrderRow({ order, action }: { order: OrderSnapshot; action?: ReactNode }) {
  const price = Number(order.fill_price ?? order.limit_price ?? order.price ?? 0);
  return (
    <div className="paper-order-row">
      <div><strong>{order.symbol}</strong><span className={order.side === "sell" ? "sell" : "buy"}>{order.side === "sell" ? "매도" : "매수"}</span></div>
      <div><strong>{formatShares(Number(order.qty || 0))}</strong><span>{formatUsd(price)}</span></div>
      <div><strong>{paperOrderStatusLabel(order.status)}</strong><span>{formatDateTime(order.filled_at || order.cancelled_at || order.created_at)}</span></div>
      {action && <div className="paper-order-action">{action}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="paper-account-empty">{message}</div>;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatSignedUsd(value: number): string {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatUsd(numeric)}`;
}

function formatSignedPercent(value: number): string {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatShares(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(value || 0))}주`;
}

function toneFor(value: number): string {
  return Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral";
}

function paperOrderStatusLabel(status: string): string {
  if (status === "filled") return "체결";
  if (status === "cancelled" || status === "canceled") return "취소";
  if (status === "rejected") return "거절";
  return "미체결";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
