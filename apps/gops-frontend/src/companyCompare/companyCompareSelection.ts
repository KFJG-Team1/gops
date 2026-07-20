import type { TiledPanelState } from "../layout/panelLayout";

export const COMPANY_COMPARE_SELECTION_STORAGE_KEY = "gops:company-compare-selections:v1";
export const MAX_COMPANY_COMPARE_TOTAL_SYMBOLS = 10;
export const MAX_COMPANY_COMPARE_SYMBOLS = MAX_COMPANY_COMPARE_TOTAL_SYMBOLS - 1;

export type CompanyCompareSelectionState = Record<string, string[]>;

export function normalizeCompanySymbol(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeCompanyCompareSymbols(
  baseSymbol: string,
  values: readonly unknown[]
): string[] {
  const base = normalizeCompanySymbol(baseSymbol);
  const normalized: string[] = [];
  for (const value of values) {
    const symbol = normalizeCompanySymbol(value);
    if (!symbol || symbol === base || normalized.includes(symbol)) {
      continue;
    }
    normalized.push(symbol);
    if (normalized.length === MAX_COMPANY_COMPARE_SYMBOLS) {
      break;
    }
  }
  return normalized;
}

export function loadCompanyCompareSelections(): CompanyCompareSelectionState {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPANY_COMPARE_SELECTION_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: CompanyCompareSelectionState = {};
    for (const [rawBase, rawValues] of Object.entries(parsed)) {
      const base = normalizeCompanySymbol(rawBase);
      if (!base || !Array.isArray(rawValues)) {
        continue;
      }
      result[base] = normalizeCompanyCompareSymbols(base, rawValues);
    }
    return result;
  } catch {
    return {};
  }
}

export function persistCompanyCompareSelections(state: CompanyCompareSelectionState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(COMPANY_COMPARE_SELECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Comparison remains usable for the current session when storage is unavailable.
  }
}

export function migratePanelCompareSelections(
  current: CompanyCompareSelectionState,
  panelState: TiledPanelState,
  fallbackBaseSymbol: string
): CompanyCompareSelectionState {
  const candidates = new Map<string, unknown[]>();
  for (const content of Object.values(panelState.contents)) {
    if (content.kind !== "compare" && content.kind !== "companyCompare") {
      continue;
    }
    const base = normalizeCompanySymbol(
      content.props?.baseSymbol ?? content.props?.symbol ?? fallbackBaseSymbol
    );
    if (!base || Object.prototype.hasOwnProperty.call(current, base)) {
      continue;
    }
    const rawValues = content.kind === "compare"
      ? content.props?.symbols
      : content.props?.compareSymbols;
    const values = Array.isArray(rawValues) ? rawValues : [];
    candidates.set(base, [...(candidates.get(base) ?? []), ...values]);
  }
  if (candidates.size === 0) {
    return current;
  }
  const next = { ...current };
  for (const [base, values] of candidates) {
    next[base] = normalizeCompanyCompareSymbols(base, values);
  }
  return next;
}
