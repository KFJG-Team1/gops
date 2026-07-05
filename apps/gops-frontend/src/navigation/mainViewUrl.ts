export type MainView =
  | { mode: "treemap" }
  | { mode: "chart"; symbol: string };

export type MainViewUrlResolution = {
  view: MainView;
  url: string;
};

const homeViewParam = "home";

export function resolveMainViewFromUrl(value: string | URL): MainViewUrlResolution {
  const url = toUrl(value);
  const symbol = normalizeStoredSymbol(url.searchParams.get("symbol"));
  const view: MainView = symbol ? { mode: "chart", symbol } : { mode: "treemap" };
  return {
    view,
    url: createMainViewUrl(url, view)
  };
}

export function createMainViewUrl(value: string | URL, view: MainView): string {
  const url = toUrl(value);
  if (view.mode === "chart") {
    url.searchParams.delete("view");
    url.searchParams.set("symbol", normalizeStoredSymbol(view.symbol) || "NVDA");
  } else {
    url.searchParams.delete("symbol");
    url.searchParams.set("view", homeViewParam);
  }
  return mainViewUrlPath(url);
}

export function mainViewUrlPath(value: string | URL): string {
  const url = toUrl(value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function mainViewsEqual(left: MainView, right: MainView): boolean {
  return left.mode === right.mode && (left.mode !== "chart" || right.mode !== "chart" || left.symbol === right.symbol);
}

export function normalizeStoredSymbol(value: string | null | undefined): string {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : "";
}

function toUrl(value: string | URL): URL {
  return value instanceof URL ? new URL(value.href) : new URL(value, "http://gops.local");
}
