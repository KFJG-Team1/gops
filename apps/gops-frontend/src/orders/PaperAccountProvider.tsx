import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  fetchPaperAccount,
  paperAccountWebSocketUrl,
  type PaperAccountSnapshot
} from "./paperTradingClient";

type PaperAccountContextValue = {
  snapshot?: PaperAccountSnapshot;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

type PaperAccountState = Omit<PaperAccountContextValue, "refresh"> & {
  accountKey: string;
};

const PaperAccountContext = createContext<PaperAccountContextValue | undefined>(undefined);

export function PaperAccountProvider({ children }: { children: ReactNode }) {
  const { authEnabled, user, loading: authLoading } = useAuth();
  const accountKey = authEnabled ? (user?.email.trim().toLowerCase() ?? "") : "auth-disabled";
  const canLoad = !authLoading && (!authEnabled || Boolean(user));
  const requestRevisionRef = useRef(0);
  const [state, setState] = useState<PaperAccountState>({
    accountKey: "",
    snapshot: undefined,
    loading: true,
    error: undefined
  });

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
    if (!canLoad) {
      setState({ accountKey, snapshot: undefined, loading: false, error: undefined });
      return undefined;
    }
    let active = true;
    void refresh();
    const socket = new WebSocket(paperAccountWebSocketUrl());
    socket.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data) as { type?: string; account?: PaperAccountSnapshot; detail?: string };
        if (payload.account) {
          requestRevisionRef.current += 1;
          setState({ accountKey, snapshot: payload.account, loading: false, error: undefined });
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
      socket.close();
    };
  }, [accountKey, canLoad, refresh]);

  const visibleState = state.accountKey === accountKey
    ? state
    : { accountKey, snapshot: undefined, loading: canLoad, error: undefined };
  const value = useMemo<PaperAccountContextValue>(() => ({
    snapshot: visibleState.snapshot,
    loading: visibleState.loading,
    error: visibleState.error,
    refresh
  }), [refresh, visibleState.error, visibleState.loading, visibleState.snapshot]);

  return <PaperAccountContext.Provider value={value}>{children}</PaperAccountContext.Provider>;
}

export function usePaperAccount(): PaperAccountContextValue {
  const context = useContext(PaperAccountContext);
  if (!context) {
    throw new Error("usePaperAccount must be used inside PaperAccountProvider");
  }
  return context;
}
