import { LoaderCircle, LogIn, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { OrderSnapshot } from "../orders/orderClient";
import { useAuth } from "../auth/AuthProvider";
import type { ChartSymbolDto } from "../chart/types";
import {
  cancelPaperOrder
} from "../orders/paperTradingClient";
import { usePaperAccount } from "../orders/PaperAccountProvider";
import { PriceConditionPanel } from "./PriceConditionPanel";

type AccountTab = "holdings" | "open" | "history" | "conditions";

type PaperAccountPanelProps = {
  defaultSymbol: string;
  symbols: ChartSymbolDto[];
  onOpenCompany: (symbol: string) => void;
};

export function PaperAccountPanel({ defaultSymbol, symbols, onOpenCompany }: PaperAccountPanelProps) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const {
    snapshot,
    loading,
    error: accountError,
    refresh,
    orders: history,
    ordersLoading: historyLoading,
    ordersError: historyError,
    refreshOrders: refreshHistory
  } = usePaperAccount();
  const [tab, setTab] = useState<AccountTab>("holdings");
  const [actionError, setActionError] = useState<string>();
  const [cancellingOrderId, setCancellingOrderId] = useState<string>();

  useEffect(() => {
    if (tab === "history") void refreshHistory();
  }, [refreshHistory, tab]);

  const cancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    setActionError(undefined);
    try {
      await cancelPaperOrder(orderId);
      await Promise.all([refresh(), refreshHistory()]);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "주문을 취소하지 못했습니다.");
    } finally {
      setCancellingOrderId(undefined);
    }
  };

  const orders = useMemo(() => history.filter((order) => order.status !== "pending"), [history]);
  const account = snapshot?.account;

  return (
    <section className="paper-account-panel" aria-label="가상계좌 패널">
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
          <div className="paper-account-tabs" role="tablist" aria-label="가상계좌 보기">
            <TabButton active={tab === "conditions"} onClick={() => setTab("conditions")}>예약 매매</TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>거래내역</TabButton>
            <TabButton active={tab === "open"} onClick={() => setTab("open")}>미체결 {snapshot.open_orders.length}</TabButton>
            <TabButton active={tab === "holdings"} onClick={() => setTab("holdings")}>보유종목</TabButton>
          </div>

          <div className="paper-account-body">
            {tab === "holdings" && (
              snapshot.positions.length ? (
                <div className="paper-account-order-list paper-position-list">
                  <OrderTableHead showSide={false} />
                  {snapshot.positions.map((position) => (
                    <div className="paper-order-row paper-position-row" key={position.symbol}>
                      <div className="paper-order-symbol"><strong>{position.symbol}</strong></div>
                      <div><strong>{formatShares(position.qty)}</strong></div>
                      <div><span>{formatUsd(position.current_price)}</span></div>
                      <div><strong>{formatUsd(position.market_value)}</strong></div>
                      <div className={`paper-order-status ${toneFor(position.unrealized_pnl)}`}>
                        <strong>{formatSignedUsd(position.unrealized_pnl)}</strong>
                        <span>{formatSignedPercent(position.unrealized_pnl_rate)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState message="아직 보유한 가상 종목이 없습니다." />
            )}

            {tab === "open" && (
              snapshot.open_orders.length ? (
                <div className="paper-account-order-list">
                  <OrderTableHead />
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
                  <OrderTableHead />
                  {orders.map((order) => <OrderRow key={order.order_id} order={order} />)}
                </div>
              ) : <EmptyState message="아직 체결 또는 취소된 주문이 없습니다." />
            )}

            {tab === "conditions" && (
              <PriceConditionPanel
                view="account"
                defaultSymbol={defaultSymbol}
                symbols={symbols}
                onOpenCompany={onOpenCompany}
              />
            )}
          </div>
        </>
      ) : null}

      {(actionError || historyError || accountError) && (
        <div className="paper-account-error">{actionError || historyError || accountError}</div>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>{children}</button>;
}

function OrderTableHead({ showSide = true }: { showSide?: boolean }) {
  return (
    <div className="paper-account-order-head" aria-hidden="true">
      <span>종목</span>
      <span>수량</span>
      <span>가격</span>
      {showSide ? <span>구분</span> : <span>평가금액</span>}
      <span>상태</span>
    </div>
  );
}

function OrderRow({ order, action }: { order: OrderSnapshot; action?: ReactNode }) {
  const price = Number(order.fill_price ?? order.limit_price ?? order.price ?? 0);
  return (
    <div className="paper-order-row">
      <div className="paper-order-symbol"><strong>{order.symbol}</strong></div>
      <div><strong>{formatShares(Number(order.qty || 0))}</strong></div>
      <div><span>{formatUsd(price)}</span></div>
      <div className={`paper-order-side ${order.side === "sell" ? "sell" : "buy"}`}>
        <strong>{order.side === "sell" ? "매도" : "매수"}</strong>
      </div>
      <div className={`paper-order-status ${paperOrderStatusTone(order.status)}`}>
        <strong>{paperOrderStatusLabel(order.status)}</strong>
        {action && <span className="paper-order-action">{action}</span>}
      </div>
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

function paperOrderStatusTone(status: string): string {
  if (status === "filled") return "filled";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}
