import { ExternalLink, LoaderCircle, RefreshCcw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  agentReferenceKey,
  newsArticleReference,
  type AgentReference
} from "../agent/agentReferences";
import { useAuth } from "../auth/AuthProvider";

const REFRESH_INTERVAL_MS = 60_000;

type WatchlistNewsMode = "watchlist" | "hot" | "recommended";

const watchlistNewsModes: Array<{ mode: WatchlistNewsMode; label: string; title: string }> = [
  { mode: "watchlist", label: "관심 기업순", title: "관심 기업 기준 뉴스" },
  { mode: "hot", label: "인기순", title: "급등, 급락, 거래대금 상위 종목 기준 뉴스" },
  { mode: "recommended", label: "추천 기업순", title: "추천 기업 기준 뉴스" }
];

type WatchlistNewsMatch = {
  symbol: string;
  companyName?: string;
  reason?: string;
};

type WatchlistNewsItem = {
  articleId?: string | null;
  symbol: string;
  symbols: string[];
  title: string;
  summary: string;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
  impactDirection?: string | null;
  matches: WatchlistNewsMatch[];
};

type WatchlistNewsResponse = {
  source?: string;
  displayMode?: string;
  symbols: string[];
  items: WatchlistNewsItem[];
  message?: string;
};

type WatchlistNewsPanelProps = {
  sourcePanelId?: string;
  selectedAgentReferenceKeys?: string[];
  emphasizedAgentReferenceKeys?: string[];
  onAgentReferenceSelect?: (reference: AgentReference) => void;
};

export function WatchlistNewsPanel({
  sourcePanelId,
  selectedAgentReferenceKeys = [],
  emphasizedAgentReferenceKeys = [],
  onAgentReferenceSelect
}: WatchlistNewsPanelProps) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const [payload, setPayload] = useState<WatchlistNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [mode, setMode] = useState<WatchlistNewsMode>("watchlist");
  const loginRequired = authEnabled && !authLoading && !user;
  const activeModeLabel = watchlistNewsModes.find((item) => item.mode === mode)?.label ?? "관심 기업순";

  const loadNews = useCallback(async (signal?: AbortSignal, showRefreshing = false) => {
    if (loginRequired) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const params = new URLSearchParams({ limit: "30", locale: "ko-KR", mode });
      const response = await fetch(`/api/market/news/watchlist?${params.toString()}`, { signal });
      const parsedPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(response.status === 401 ? "로그인이 필요합니다." : `뉴스 API 응답 오류 ${response.status}`);
      }
      setPayload(normalizeWatchlistNewsResponse(parsedPayload) ?? emptyWatchlistNewsResponse());
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "뉴스를 불러오지 못했습니다.");
      setPayload(null);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loginRequired, mode]);

  useEffect(() => {
    if (authLoading) {
      return undefined;
    }
    if (loginRequired) {
      setPayload(null);
      setLoading(false);
      setError(undefined);
      return undefined;
    }
    const controller = new AbortController();
    void loadNews(controller.signal);
    const intervalId = window.setInterval(() => {
      void loadNews(undefined, true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [authLoading, loadNews, loginRequired]);

  const selectReference = useCallback((reference: AgentReference) => {
    onAgentReferenceSelect?.(reference);
  }, [onAgentReferenceSelect]);
  const handleReferenceKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, reference: AgentReference) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    selectReference(reference);
  }, [selectReference]);

  const items = payload?.items ?? [];
  const symbols = payload?.symbols ?? [];
  const emptyMessage = payload?.message || (mode === "watchlist" && symbols.length === 0
    ? "하단 관심종목 메뉴에서 종목을 추가하세요."
    : "표시할 뉴스가 없습니다.");

  return (
    <section className="market-news-panel watchlist-news-panel" aria-label="관심종목 뉴스 패널">
      <div className="watchlist-news-topbar">
        <div className="watchlist-news-mode-tabs" role="group" aria-label="뉴스 기준">
          {watchlistNewsModes.map((item) => (
            <button
              key={item.mode}
              type="button"
              title={item.title}
              className={item.mode === mode ? "active" : undefined}
              aria-pressed={item.mode === mode}
              onClick={() => setMode(item.mode)}
              disabled={authLoading || loginRequired}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          className="panel-icon-button"
          type="button"
          title={`${activeModeLabel} 새로고침`}
          onClick={() => void loadNews(undefined, true)}
          disabled={authLoading || loginRequired}
        >
          {refreshing || authLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
      </div>

      {loginRequired && (
        <div className="panel-state-row">
          <span>로그인하면 관심종목 뉴스가 표시됩니다</span>
          <button className="panel-state-action" type="button" onClick={login}>로그인</button>
        </div>
      )}

      {(loading || authLoading) && !loginRequired && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>관심종목 뉴스를 불러오는 중입니다</span>
        </div>
      )}
      {error && !loading && !authLoading && <div className="panel-error-row">{error}</div>}
      {!loginRequired && !loading && !authLoading && !error && items.length === 0 && (
        <div className="panel-empty-row">{emptyMessage}</div>
      )}
      {!loginRequired && !loading && !authLoading && !error && items.length > 0 && (
        <div className="market-news-list">
          {items.map((item, index) => {
            const reference = newsArticleReference(item, sourcePanelId);
            const referenceKey = agentReferenceKey(reference);
            const selected = selectedAgentReferenceKeys.includes(referenceKey);
            const emphasized = emphasizedAgentReferenceKeys.includes(referenceKey);
            return (
              <article
                key={`${item.articleId ?? item.url ?? item.title}-${index}`}
                className={`market-news-row watchlist-news-row ${selected ? "is-agent-reference-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => selectReference(reference)}
                onKeyDown={(event) => handleReferenceKeyDown(event, reference)}
              >
                <div className="market-news-main">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                      <span className="market-news-text-highlight">{item.title}</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <strong><span className="market-news-text-highlight">{item.title}</span></strong>
                  )}
                  {item.summary && <p><span>{item.summary}</span></p>}
                </div>
                {item.matches.length > 0 && (
                  <div className="watchlist-news-badges" aria-label="관련 종목">
                    {item.matches.map((match) => (
                      <span key={match.symbol} className="watchlist-news-badge" title={match.companyName ?? match.symbol}>
                        {watchlistNewsBadgeText(match)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="market-news-meta">
                  <span className={`news-impact ${item.impactDirection ?? "unknown"}`}>{impactDirectionText(item.impactDirection)}</span>
                  <span>{item.source ?? "news"}</span>
                  {item.publishedAt && <span>{relativeTimeText(item.publishedAt)}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function normalizeWatchlistNewsResponse(payload: unknown): WatchlistNewsResponse | null {
  const source = readObject(payload);
  if (!source) {
    return null;
  }
  return {
    source: readString(source.source) ?? undefined,
    displayMode: readString(source.displayMode) ?? undefined,
    symbols: readArray(source.symbols).map(readString).filter((item): item is string => Boolean(item)),
    items: readArray(source.items).map(normalizeWatchlistNewsItem).filter((item): item is WatchlistNewsItem => Boolean(item)),
    message: readString(source.message) ?? undefined
  };
}

function normalizeWatchlistNewsItem(value: unknown): WatchlistNewsItem | null {
  const source = readObject(value);
  const title = readString(source?.title);
  if (!source || !title) {
    return null;
  }
  const symbol = readString(source.symbol) ?? "UNKNOWN";
  return {
    articleId: readString(source.articleId),
    symbol,
    symbols: readArray(source.symbols).map(readString).filter((item): item is string => Boolean(item)),
    title,
    summary: readString(source.summary) ?? "",
    url: readString(source.url),
    source: readString(source.source),
    publishedAt: readString(source.publishedAt),
    impactDirection: readString(source.impactDirection),
    matches: readArray(source.matches).map(normalizeWatchlistNewsMatch).filter((item): item is WatchlistNewsMatch => Boolean(item))
  };
}

function normalizeWatchlistNewsMatch(value: unknown): WatchlistNewsMatch | null {
  const source = readObject(value);
  const symbol = readString(source?.symbol);
  if (!source || !symbol) {
    return null;
  }
  return {
    symbol,
    companyName: readString(source.companyName) ?? undefined,
    reason: readString(source.reason) ?? undefined
  };
}

function emptyWatchlistNewsResponse(): WatchlistNewsResponse {
  return {
    displayMode: "watchlistNews",
    symbols: [],
    items: []
  };
}

function watchlistNewsBadgeText(match: WatchlistNewsMatch): string {
  return match.reason ? `${match.symbol} · ${match.reason}` : match.symbol;
}

function impactDirectionText(value: string | null | undefined) {
  switch (value) {
    case "positive":
      return "긍정";
    case "negative":
      return "부정";
    case "mixed":
      return "혼재";
    case "neutral":
      return "중립";
    default:
      return "영향 미정";
  }
}

function relativeTimeText(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value.slice(0, 10);
  }
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }
  return `${Math.round(diffHours / 24)}일 전`;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
