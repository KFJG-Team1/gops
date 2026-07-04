import { ExternalLink, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type NewsItem = {
  symbol: string;
  symbols: string[];
  title: string;
  summary: string;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
  impactDirection?: string | null;
};

type NewsResponse = {
  symbol: string;
  source?: string;
  items: NewsItem[];
};

export function NewsPanel({ symbol }: { symbol: string }) {
  const [payload, setPayload] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadNews = useCallback(async (signal?: AbortSignal, showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const params = new URLSearchParams({ symbol, limit: "10", locale: "ko-KR" });
      const response = await fetch(`/api/market/news/latest?${params.toString()}`, { signal });
      const nextPayload = normalizeNewsResponse(await response.json().catch(() => null));
      if (!response.ok) {
        throw new Error(`뉴스 API 응답 오류 ${response.status}`);
      }
      setPayload(nextPayload);
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
  }, [symbol]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNews(controller.signal);
    return () => controller.abort();
  }, [loadNews]);

  const items = payload?.items ?? [];
  return (
    <section className="market-news-panel" aria-label={`${symbol} 뉴스 패널`}>
      <header className="panel-inline-header">
        <div>
          <strong>{symbol}</strong>
        </div>
        <button className="panel-icon-button" type="button" title="뉴스 새로고침" onClick={() => void loadNews(undefined, true)}>
          {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
        </button>
      </header>
      {loading && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>뉴스를 불러오는 중입니다</span>
        </div>
      )}
      {error && !loading && <div className="panel-error-row">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="panel-empty-row">{symbol} 관련 저장 뉴스가 없습니다</div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="market-news-list">
          {items.map((item, index) => (
            <article key={`${item.url ?? item.title}-${index}`} className="market-news-row">
              <div className="market-news-main">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  <strong>{item.title}</strong>
                )}
                {item.summary && <p>{item.summary}</p>}
              </div>
              <div className="market-news-meta">
                <span className={`news-impact ${item.impactDirection ?? "unknown"}`}>{impactDirectionText(item.impactDirection)}</span>
                <span>{item.source ?? payload?.source ?? "news"}</span>
                {item.publishedAt && <span>{relativeTimeText(item.publishedAt)}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function normalizeNewsResponse(payload: unknown): NewsResponse {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return {
    symbol: readString(source.symbol) ?? "UNKNOWN",
    source: readString(source.source) ?? undefined,
    items: Array.isArray(source.items) ? source.items.map(normalizeNewsItem).filter((item): item is NewsItem => Boolean(item)) : []
  };
}

function normalizeNewsItem(value: unknown): NewsItem | null {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!source) {
    return null;
  }
  const title = readString(source.title);
  if (!title) {
    return null;
  }
  const symbol = readString(source.symbol) ?? "UNKNOWN";
  return {
    symbol,
    symbols: Array.isArray(source.symbols) ? source.symbols.map(readString).filter((item): item is string => Boolean(item)) : [symbol],
    title,
    summary: readString(source.summary) ?? "",
    url: readString(source.url),
    source: readString(source.source),
    publishedAt: readString(source.publishedAt),
    impactDirection: readString(source.impactDirection)
  };
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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
