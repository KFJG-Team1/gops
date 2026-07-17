import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  fetchPaperAccount,
  fetchPaperOrders,
  paperAccountWebSocketUrl,
  type PaperAccountSnapshot
} from "./paperTradingClient";
import type { OrderSnapshot } from "./orderClient";

type PaperAccountContextValue = {
  snapshot?: PaperAccountSnapshot;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  orders: OrderSnapshot[];
  ordersLoading: boolean;
  ordersError?: string;
  refreshOrders: () => Promise<void>;
};

type PaperAccountState = Pick<PaperAccountContextValue, "snapshot" | "loading" | "error"> & {
  accountKey: string;
};

type PaperOrderState = Pick<PaperAccountContextValue, "orders" | "ordersLoading" | "ordersError"> & {
  accountKey: string;
};

const PaperAccountContext = createContext<PaperAccountContextValue | undefined>(undefined);

export function PaperAccountProvider({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading: authLoading } = useAuth();
  const accountKey = authEnabled ? (user?.email.trim().toLowerCase() ?? "") : "auth-disabled";
  const canLoad = !authLoading && (!authEnabled || Boolean(user));
  const requestRevisionRef = useRef(0);
  const orderRequestRevisionRef = useRef(0);
  const tradeHistoryRevisionKeyRef = useRef("");
  const [state, setState] = useState<PaperAccountState>({
    accountKey: "",
    snapshot: undefined,
    loading: true,
    error: undefined
  });
  const [orderState, setOrderState] = useState<PaperOrderState>({
    accountKey: "",
    orders: [],
    ordersLoading: true,
    ordersError: undefined
  });

  const refreshOrders = useCallback(async () => {
    if (!canLoad) return;
    const requestedAccountKey = accountKey;
    const requestRevision = ++orderRequestRevisionRef.current;
    setOrderState((current) => ({
      accountKey: requestedAccountKey,
      orders: current.accountKey === requestedAccountKey ? current.orders : [],
      ordersLoading: current.accountKey !== requestedAccountKey || !current.orders.length,
      ordersError: undefined
    }));
    try {
      const orders = await fetchPaperOrders();
      if (orderRequestRevisionRef.current !== requestRevision) return;
      setOrderState({
        accountKey: requestedAccountKey,
        orders,
        ordersLoading: false,
        ordersError: undefined
      });
    } catch (caught) {
      if (orderRequestRevisionRef.current !== requestRevision) return;
      setOrderState((current) => ({
        accountKey: requestedAccountKey,
        orders: current.accountKey === requestedAccountKey ? current.orders : [],
        ordersLoading: false,
        ordersError: caught instanceof Error ? caught.message : "가상계좌 거래내역을 불러오지 못했습니다."
      }));
    }
  }, [accountKey, canLoad]);

  const refresh = useCallback(async () => {
    if (!canLoad) return;
    const requestedAccountKey = accountKey;
    const requestRevision = ++requestRevisionRef.current;
    setState((current) => ({
      accountKey: requestedAccountKey,
      snapshot: current.accountKey === requestedAccountKey ? current.snapshot : undefined,
      loading: current.accountKey !== requestedAccountKey || !current.snapshot,
      error: undefined
    }));
    try {
      const snapshot = await fetchPaperAccount();
      if (requestRevisionRef.current !== requestRevision) return;
      tradeHistoryRevisionKeyRef.current = paperTradeHistoryRevisionKey(snapshot);
      setState({ accountKey: requestedAccountKey, snapshot, loading: false, error: undefined });
    } catch (caught) {
      if (requestRevisionRef.current !== requestRevision) return;
      setState((current) => ({
        accountKey: requestedAccountKey,
        snapshot: current.accountKey === requestedAccountKey ? current.snapshot : undefined,
        loading: false,
        error: caught instanceof Error ? caught.message : "가상계좌를 불러오지 못했습니다."
      }));
    }
  }, [accountKey, canLoad]);

  useEffect(() => {
    requestRevisionRef.current += 1;
    orderRequestRevisionRef.current += 1;
    tradeHistoryRevisionKeyRef.current = "";
    if (!canLoad) {
      setState({ accountKey, snapshot: undefined, loading: false, error: undefined });
      setOrderState({ accountKey, orders: [], ordersLoading: false, ordersError: undefined });
      return undefined;
    }
    let active = true;
    void refresh();
    void refreshOrders();
    const socket = new WebSocket(paperAccountWebSocketUrl());
    socket.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data) as { type?: string; account?: PaperAccountSnapshot; detail?: string };
        if (payload.account) {
          const nextHistoryRevisionKey = paperTradeHistoryRevisionKey(payload.account);
          const historyChanged = nextHistoryRevisionKey !== tradeHistoryRevisionKeyRef.current;
          tradeHistoryRevisionKeyRef.current = nextHistoryRevisionKey;
          requestRevisionRef.current += 1;
          setState({ accountKey, snapshot: payload.account, loading: false, error: undefined });
          if (historyChanged) void refreshOrders();
        } else if (payload.type === "error") {
          setState((current) => ({ ...current, error: payload.detail || "가상계좌 실시간 연결 오류" }));
        }
      } catch {
        setState((current) => ({ ...current, error: "가상계좌 실시간 응답을 읽지 못했습니다." }));
      }
    };
    socket.onerror = () => {
      if (active) {
        setState((current) => ({ ...current, error: "가상계좌 실시간 연결을 확인하고 있습니다." }));
      }
    };
    return () => {
      active = false;
      requestRevisionRef.current += 1;
      orderRequestRevisionRef.current += 1;
      socket.close();
    };
  }, [accountKey, canLoad, refresh, refreshOrders]);

  const visibleState = state.accountKey === accountKey
    ? state
    : { accountKey, snapshot: undefined, loading: canLoad, error: undefined };
  const visibleOrderState = orderState.accountKey === accountKey
    ? orderState
    : { accountKey, orders: [], ordersLoading: canLoad, ordersError: undefined };
  const value = useMemo<PaperAccountContextValue>(() => ({
    snapshot: visibleState.snapshot,
    loading: visibleState.loading,
    error: visibleState.error,
    refresh,
    orders: visibleOrderState.orders,
    ordersLoading: visibleOrderState.ordersLoading,
    ordersError: visibleOrderState.ordersError,
    refreshOrders
  }), [
    refresh,
    refreshOrders,
    visibleOrderState.orders,
    visibleOrderState.ordersError,
    visibleOrderState.ordersLoading,
    visibleState.error,
    visibleState.loading,
    visibleState.snapshot
  ]);

  return <PaperAccountContext.Provider value={value}>{children}</PaperAccountContext.Provider>;
}

function paperTradeHistoryRevisionKey(snapshot: PaperAccountSnapshot): string {
  return JSON.stringify({
    generation: snapshot.account.generation,
    cash: snapshot.account.cash_balance,
    reservedCash: snapshot.account.reserved_cash,
    positions: snapshot.positions.map((position) => [
      position.symbol,
      position.qty,
      position.reserved_qty,
      position.average_price,
      position.realized_pnl
    ]),
    openOrders: snapshot.open_orders.map((order) => [order.order_id, order.status, order.qty])
  });
}

export function usePaperAccount(): PaperAccountContextValue {
  const context = useContext(PaperAccountContext);
  if (!context) {
    throw new Error("usePaperAccount must be used inside PaperAccountProvider");
  }
  return context;
}
