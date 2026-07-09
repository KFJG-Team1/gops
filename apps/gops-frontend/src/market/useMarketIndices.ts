import { useCallback, useEffect, useState } from "react";
import { fetchMarketIndices, type MarketIndicesPayload } from "./indicesApi";

const FALLBACK_REFRESH_MS = 30_000;

export function useMarketIndices() {
  const [payload, setPayload] = useState<MarketIndicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadIndices = useCallback(async (signal?: AbortSignal, showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const nextPayload = await fetchMarketIndices(signal);
      setPayload(nextPayload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "지수 데이터를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadIndices(controller.signal);
    return () => controller.abort();
  }, [loadIndices]);

  const refreshMs = Math.max(10_000, (payload?.refreshSeconds ?? FALLBACK_REFRESH_MS / 1000) * 1000);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const controller = new AbortController();
      void loadIndices(controller.signal, true);
    }, refreshMs);
    return () => window.clearInterval(intervalId);
  }, [loadIndices, refreshMs]);

  const reload = useCallback((showRefreshing = true) => loadIndices(undefined, showRefreshing), [loadIndices]);
  const warning = visibleMarketIndicesWarning(payload?.warning);

  return { payload, loading, refreshing, error, warning, reload };
}

function visibleMarketIndicesWarning(warning: string | undefined): string | undefined {
  if (!warning) {
    return undefined;
  }
  if (
    warning === "Refresh already in progress; serving the last successful snapshot." ||
    warning === "Refreshing in background; serving the last successful snapshot."
  ) {
    return undefined;
  }
  return warning;
}
