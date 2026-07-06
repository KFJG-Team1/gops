import { ExternalLink, LoaderCircle, RefreshCcw } from "lucide-react";
import type { SyntheticEvent } from "react";
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

type NewsSourceLink = {
  articleId?: string;
  title: string;
  name?: string;
  url: string;
  publishedAt?: string;
};

type NewsPriceChange = {
  date: string;
  previousClose: number;
  close: number;
  change: number;
  changePercent: number;
};

type DailyNewsSummary = {
  date: string;
  symbol?: string;
  summary: string;
  keyPoints: string[];
  impactDirection?: string;
  sentiment?: string;
  articleIds: string[];
  articleCount?: number;
  mentionCount?: number;
  status?: string;
  generatedAt?: string;
  sources: NewsSourceLink[];
  priceChange?: NewsPriceChange;
};

type NewsResponse = {
  symbol: string;
  displayMode?: string;
  items: NewsItem[];
  dailySummaries: DailyNewsSummary[];
};

export function NewsPanel({ symbol, initialPayload }: { symbol: string; initialPayload?: unknown }) {
  const normalizedInitialPayload = normalizeNewsResponse(initialPayload, symbol);
  const [payload, setPayload] = useState<NewsResponse | null>(normalizedInitialPayload);
  const [loading, setLoading] = useState(!normalizedInitialPayload);
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
      const params = new URLSearchParams({ symbol, limit: "30", locale: "ko-KR" });
      const response = await fetch(`/api/market/news/daily?${params.toString()}`, { signal });
      const parsedPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`뉴스 API 응답 오류 ${response.status}`);
      }
      setPayload(normalizeNewsResponse(parsedPayload, symbol) ?? emptyNewsResponse(symbol));
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
    const nextPayload = normalizeNewsResponse(initialPayload, symbol);
    if (nextPayload) {
      setPayload(nextPayload);
      setLoading(false);
      setError(undefined);
      return undefined;
    }
    const controller = new AbortController();
    void loadNews(controller.signal);
    return () => controller.abort();
  }, [initialPayload, loadNews, symbol]);

  const dailySummaries = payload?.dailySummaries ?? [];
  const items = payload?.items ?? [];
  const dailyMode = payload?.displayMode === "dailySummary" || dailySummaries.length > 0;
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
      {!loading && !error && (dailyMode ? dailySummaries.length === 0 : items.length === 0) && (
        <div className="panel-empty-row">{symbol} 관련 저장 뉴스가 없습니다</div>
      )}
      {!loading && !error && dailyMode && dailySummaries.length > 0 && (
        <div className="market-news-list market-news-daily-list">
          {dailySummaries.map((item) => (
            <article key={`${item.symbol ?? symbol}-${item.date}`} className="market-news-row market-news-daily-row">
              <div className="market-news-date-row">
                <div className="market-news-date">{formatNewsDate(item.date)}</div>
                {item.priceChange && (
                  <span className={`market-news-price-change ${priceChangeClass(item.priceChange.change)}`} title={priceChangeTitle(item.priceChange)}>
                    {formatPriceChange(item.priceChange.change)}
                  </span>
                )}
              </div>
              <p className="market-news-summary">{item.summary}</p>
              {item.sources.length > 0 && (
                <div className="market-news-source-row">
                  <span>출처</span>
                  <div className="market-news-source-links" aria-label={`${item.date} 출처`}>
                    {item.sources.map((source, index) => (
                      <a
                        key={`${source.url}-${index}`}
                        className="market-news-source-icon"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        title={`${source.name ?? sourceHost(source.url)} · ${source.title}`}
                        aria-label={`출처: ${source.title}`}
                      >
                        <img src={sourceIconUrl(source.url)} alt="" loading="lazy" onError={hideBrokenImage} />
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {!loading && !error && !dailyMode && items.length > 0 && (
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
                <span>{item.source ?? "news"}</span>
                {item.publishedAt && <span>{relativeTimeText(item.publishedAt)}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function normalizeNewsResponse(payload: unknown, fallbackSymbol = "UNKNOWN"): NewsResponse | null {
  const source = readObject(payload);
  if (!source) {
    return null;
  }
  return {
    symbol: readString(source.symbol) ?? fallbackSymbol,
    displayMode: readString(source.displayMode) ?? undefined,
    items: readArray(source.items).map(normalizeNewsItem).filter((item): item is NewsItem => Boolean(item)),
    dailySummaries: readArray(source.dailySummaries)
      .map(normalizeDailyNewsSummary)
      .filter((item): item is DailyNewsSummary => Boolean(item))
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

function normalizeDailyNewsSummary(value: unknown): DailyNewsSummary | null {
  const source = readObject(value);
  const date = readString(source?.date);
  const summary = readString(source?.summary);
  if (!source || !date || !summary) {
    return null;
  }
  return {
    date,
    symbol: readString(source.symbol) ?? undefined,
    summary,
    keyPoints: readArray(source.keyPoints).map(readString).filter((item): item is string => Boolean(item)),
    impactDirection: readString(source.impactDirection) ?? undefined,
    sentiment: readString(source.sentiment) ?? undefined,
    articleIds: readArray(source.articleIds).map(readString).filter((item): item is string => Boolean(item)),
    articleCount: readNumber(source.articleCount) ?? undefined,
    mentionCount: readNumber(source.mentionCount) ?? undefined,
    status: readString(source.status) ?? undefined,
    generatedAt: readString(source.generatedAt) ?? undefined,
    sources: readArray(source.sources).map(normalizeNewsSourceLink).filter((item): item is NewsSourceLink => Boolean(item)),
    priceChange: normalizeNewsPriceChange(source.priceChange) ?? undefined
  };
}

function normalizeNewsPriceChange(value: unknown): NewsPriceChange | null {
  const source = readObject(value);
  const date = readString(source?.date);
  const previousClose = readNumber(source?.previousClose);
  const close = readNumber(source?.close);
  const change = readNumber(source?.change);
  const changePercent = readNumber(source?.changePercent) ?? 0;
  if (!source || !date || previousClose === undefined || close === undefined || change === undefined) {
    return null;
  }
  return {
    date,
    previousClose,
    close,
    change,
    changePercent
  };
}

function normalizeNewsSourceLink(value: unknown): NewsSourceLink | null {
  const source = readObject(value);
  const title = readString(source?.title);
  const url = readString(source?.url);
  if (!source || !title || !url) {
    return null;
  }
  return {
    articleId: readString(source.articleId) ?? undefined,
    title,
    name: readString(source.name) ?? readString(source.source) ?? undefined,
    url,
    publishedAt: readString(source.publishedAt) ?? undefined
  };
}

function emptyNewsResponse(symbol: string): NewsResponse {
  return {
    symbol,
    displayMode: "dailySummary",
    items: [],
    dailySummaries: []
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

function formatNewsDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric"
  }).format(new Date(timestamp));
}

function formatPriceChange(value: number) {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  const prefix = normalized > 0 ? "+" : "";
  return `${prefix}${normalized.toFixed(2)}`;
}

function priceChangeClass(value: number) {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "flat";
}

function priceChangeTitle(value: NewsPriceChange) {
  return `전일 종가 ${value.previousClose.toFixed(2)} · 당일 종가 ${value.close.toFixed(2)} · ${value.changePercent.toFixed(2)}%`;
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function sourceIconUrl(value: string) {
  try {
    const url = new URL(value);
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=32`;
  } catch {
    return "";
  }
}

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
