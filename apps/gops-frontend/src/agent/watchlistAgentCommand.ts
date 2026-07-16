export type WatchlistAgentCommand =
  | { status: "not_matched" }
  | { status: "clarify" }
  | { status: "add"; symbol: string };

export function resolveWatchlistAgentCommand(text: string, contextSymbol?: string): WatchlistAgentCommand {
  const compact = String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,!?~'"“”‘’()\[\]{}:_-]+/g, "");
  const mentionsWatchlist = /(관심종목|관심기업|관심목록|watchlist)/.test(compact);
  const requestsAdd = /(추가|넣어|담아|등록|add)/.test(compact);
  if (!mentionsWatchlist || !requestsAdd) {
    return { status: "not_matched" };
  }
  const symbol = String(contextSymbol || "").trim().toUpperCase();
  return symbol ? { status: "add", symbol } : { status: "clarify" };
}
