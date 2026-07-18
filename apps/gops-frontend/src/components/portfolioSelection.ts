import { useSyncExternalStore } from "react";

const portfolioSelectionListeners = new Set<() => void>();

type PortfolioSelectionState = {
  symbol: string | null;
  revision: number;
};

const emptyPortfolioSelection: PortfolioSelectionState = { symbol: null, revision: 0 };
let portfolioSelectionState = emptyPortfolioSelection;

export function selectPortfolioHoldingSymbol(symbol: string): void {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return;
  portfolioSelectionState = {
    symbol: normalized,
    revision: portfolioSelectionState.revision + 1
  };
  portfolioSelectionListeners.forEach((listener) => listener());
}

export function usePortfolioSelectedSymbol(): PortfolioSelectionState {
  return useSyncExternalStore(
    (listener) => {
      portfolioSelectionListeners.add(listener);
      return () => portfolioSelectionListeners.delete(listener);
    },
    () => portfolioSelectionState,
    () => emptyPortfolioSelection
  );
}
