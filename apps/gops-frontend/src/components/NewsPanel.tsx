import { ExternalLink, LoaderCircle, RefreshCcw } from "lucide-react";
import type { KeyboardEvent, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentReferenceKey,
  newsArticleReference,
  newsDailySummaryReference,
  type AgentReference
} from "../agent/agentReferences";
import { NewsFlipCard, type NewsFlipCardItem } from "./NewsFlipCard";

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

type NewsPanelProps = {
  symbol: string;
  initialPayload?: unknown;
  sourcePanelId?: string;
  selectedAgentReferenceKeys?: string[];
  emphasizedAgentReferenceKeys?: string[];
  onAgentReferenceSelect?: (reference: AgentReference) => void;
  variant?: "flip" | "list";
};

export function NewsPanel({ symbol, initialPayload, sourcePanelId, selectedAgentReferenceKeys = [], emphasizedAgentReferenceKeys = [], onAgentReferenceSelect, variant = "flip" }: NewsPanelProps) {
  const normalizedInitialPayload = normalizeNewsResponse(initialPayload, symbol) ?? localNewsDemoResponse(symbol);
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
    const nextPayload = normalizeNewsResponse(initialPayload, symbol) ?? localNewsDemoResponse(symbol);
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
  const flipItems = useMemo<NewsFlipCardItem[]>(() => {
    if (dailyMode) {
      return dailySummaries.map((item) => {
        const reference = newsDailySummaryReference(item, symbol, sourcePanelId);
        const referenceKey = agentReferenceKey(reference);
        return {
          key: `${item.symbol ?? symbol}-${item.date}`,
          symbol: item.symbol ?? symbol,
          title: item.sources[0]?.title ?? summaryHeadline(item.summary),
          url: item.sources[0]?.url,
          reference,
          selected: selectedAgentReferenceKeys.includes(referenceKey),
          emphasized: emphasizedAgentReferenceKeys.includes(referenceKey)
        };
      });
    }
    return items.map((item, index) => {
      const reference = newsArticleReference(item, sourcePanelId);
      const referenceKey = agentReferenceKey(reference);
      return {
        key: `${item.url ?? item.title}-${index}`,
        symbol: item.symbol || symbol,
        title: item.title,
        url: item.url,
        reference,
        selected: selectedAgentReferenceKeys.includes(referenceKey),
        emphasized: emphasizedAgentReferenceKeys.includes(referenceKey)
      };
    });
  }, [dailyMode, dailySummaries, emphasizedAgentReferenceKeys, items, selectedAgentReferenceKeys, sourcePanelId, symbol]);
  return (
    <section className={`market-news-panel is-${variant}-view`} aria-label={`${symbol} ${variant === "list" ? "뉴스 목록" : "뉴스 카드"} 패널`}>
      <button
        className="panel-reload-overlay panel-icon-button"
        type="button"
        title="뉴스 새로고침"
        aria-label="뉴스 새로고침"
        onClick={() => void loadNews(undefined, true)}
      >
        {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
      </button>
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
      {!loading && !error && variant === "flip" && flipItems.length > 0 && (
        <NewsFlipCard
          items={flipItems}
          ariaLabel={`${symbol} 뉴스 카드`}
          onSelect={selectReference}
        />
      )}
      {!loading && !error && variant === "list" && dailyMode && dailySummaries.length > 0 && (
        <div className="market-news-list market-news-daily-list">
          {dailySummaries.map((item) => {
            const reference = newsDailySummaryReference(item, symbol, sourcePanelId);
            const referenceKey = agentReferenceKey(reference);
            const selected = selectedAgentReferenceKeys.includes(referenceKey);
            const emphasized = emphasizedAgentReferenceKeys.includes(referenceKey);
            return (
              <article
                key={`${item.symbol ?? symbol}-${item.date}`}
                className={`market-news-row market-news-daily-row ${selected ? "is-agent-reference-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => selectReference(reference)}
                onKeyDown={(event) => handleReferenceKeyDown(event, reference)}
              >
                <span className="market-news-timeline-dot" aria-hidden="true" />
                <div className="market-news-daily-content">
                  <div className="market-news-date-row">
                    <span className="market-news-date">{formatNewsDate(item.date)}</span>
                    {item.priceChange && (
                      <span className={`market-news-price-change ${priceChangeClass(item.priceChange.change)}`} title={priceChangeTitle(item.priceChange)}>
                        {formatDailyPriceChange(item.priceChange)}
                      </span>
                    )}
                  </div>
                  <p className="market-news-summary"><span>{item.summary}</span></p>
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
                            onClick={(event) => event.stopPropagation()}
                          >
                            <img src={sourceIconUrl(source.url)} alt="" loading="lazy" onError={hideBrokenImage} />
                            <ExternalLink size={11} aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !error && variant === "list" && !dailyMode && items.length > 0 && (
        <div className="market-news-list">
          {items.map((item, index) => {
            const reference = newsArticleReference(item, sourcePanelId);
            const referenceKey = agentReferenceKey(reference);
            const selected = selectedAgentReferenceKeys.includes(referenceKey);
            const emphasized = emphasizedAgentReferenceKeys.includes(referenceKey);
            return (
              <article
                key={`${item.url ?? item.title}-${index}`}
                className={`market-news-row ${selected ? "is-agent-reference-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`}
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

function localNewsDemoResponse(symbol: string): NewsResponse | null {
  if (!isLocalNewsDemoHost()) {
    return null;
  }
  const normalizedSymbol = symbol.trim().toUpperCase() || "GOOGL";
  return {
    symbol: normalizedSymbol,
    displayMode: "dailySummary",
    items: [],
    dailySummaries: [
      {
        date: "2026-07-09",
        symbol: normalizedSymbol,
        summary: `${normalizedSymbol} closed modestly lower as broad risk-off trading weighed on mega-cap technology, while AI and cloud demand remained the main positive company-specific thread. Search traffic momentum, enterprise AI partnerships, and cloud revenue growth kept analysts focused on durable advertising and infrastructure demand despite softer index sentiment.`,
        keyPoints: [],
        impactDirection: "mixed",
        sentiment: "mixed",
        articleIds: ["demo-news-2026-07-09-a", "demo-news-2026-07-09-b", "demo-news-2026-07-09-c"],
        articleCount: 6,
        mentionCount: 9,
        status: "demo",
        generatedAt: "2026-07-09T21:53:00-04:00",
        sources: [
          {
            articleId: "demo-news-2026-07-09-a",
            title: "AI partnerships keep cloud demand in focus",
            name: "CNBC",
            url: "https://www.cnbc.com/",
            publishedAt: "2026-07-09T21:53:00-04:00"
          },
          {
            articleId: "demo-news-2026-07-09-b",
            title: "Analysts weigh valuation after mixed technology session",
            name: "Reuters",
            url: "https://www.reuters.com/",
            publishedAt: "2026-07-09T18:22:00-04:00"
          },
          {
            articleId: "demo-news-2026-07-09-c",
            title: "Cloud growth remains a core bull case",
            name: "MarketWatch",
            url: "https://www.marketwatch.com/",
            publishedAt: "2026-07-09T16:35:00-04:00"
          }
        ],
        priceChange: {
          date: "2026-07-09",
          previousClose: 358.71,
          close: 356.24,
          change: -2.47,
          changePercent: -0.69
        }
      },
      {
        date: "2026-07-08",
        symbol: normalizedSymbol,
        summary: `${normalizedSymbol} declined as investors reduced exposure to long-duration growth stocks before macro data and Federal Reserve commentary. Company news was more constructive than the tape, with AI product adoption and cloud bookings still cited as support for medium-term earnings expectations.`,
        keyPoints: [],
        impactDirection: "negative",
        sentiment: "neutral",
        articleIds: ["demo-news-2026-07-08-a", "demo-news-2026-07-08-b"],
        articleCount: 4,
        mentionCount: 6,
        status: "demo",
        generatedAt: "2026-07-08T16:15:00-04:00",
        sources: [
          {
            articleId: "demo-news-2026-07-08-a",
            title: "Mega-cap technology shares slip with rates in focus",
            name: "Bloomberg",
            url: "https://www.bloomberg.com/",
            publishedAt: "2026-07-08T16:15:00-04:00"
          },
          {
            articleId: "demo-news-2026-07-08-b",
            title: "Cloud and AI demand offsets weaker market tone",
            name: "The Motley Fool",
            url: "https://www.fool.com/",
            publishedAt: "2026-07-08T14:40:00-04:00"
          }
        ],
        priceChange: {
          date: "2026-07-08",
          previousClose: 363.62,
          close: 358.71,
          change: -4.91,
          changePercent: -1.35
        }
      },
      {
        date: "2026-07-07",
        symbol: normalizedSymbol,
        summary: `${normalizedSymbol} finished higher after buyers returned to large-cap software and internet names. The session was led by renewed interest in AI monetization, advertising efficiency, and operating leverage from cloud infrastructure investments.`,
        keyPoints: [],
        impactDirection: "positive",
        sentiment: "positive",
        articleIds: ["demo-news-2026-07-07-a", "demo-news-2026-07-07-b"],
        articleCount: 5,
        mentionCount: 7,
        status: "demo",
        generatedAt: "2026-07-07T16:08:00-04:00",
        sources: [
          {
            articleId: "demo-news-2026-07-07-a",
            title: "AI monetization narrative lifts large-cap tech",
            name: "Seeking Alpha",
            url: "https://seekingalpha.com/",
            publishedAt: "2026-07-07T16:08:00-04:00"
          },
          {
            articleId: "demo-news-2026-07-07-b",
            title: "Advertising and cloud margins remain in focus",
            name: "Yahoo Finance",
            url: "https://finance.yahoo.com/",
            publishedAt: "2026-07-07T13:25:00-04:00"
          }
        ],
        priceChange: {
          date: "2026-07-07",
          previousClose: 358.11,
          close: 363.62,
          change: 5.51,
          changePercent: 1.54
        }
      }
    ]
  };
}

function isLocalNewsDemoHost() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.port === "5173" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function summaryHeadline(summary: string) {
  const firstSentence = summary.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const headline = firstSentence || summary;
  return headline.length > 120 ? `${headline.slice(0, 117).trimEnd()}…` : headline;
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
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  return diffHours < 24 ? `${diffHours}시간 전` : `${Math.round(diffHours / 24)}일 전`;
}

function formatNewsDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(timestamp));
}

function formatPriceChange(value: number) {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}`;
}

function formatDailyPriceChange(value: NewsPriceChange) {
  const percent = `${value.changePercent > 0 ? "+" : ""}${value.changePercent.toFixed(2)}%`;
  return `${formatPriceChange(value.change)} (${percent})`;
}

function priceChangeClass(value: number) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "flat";
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
