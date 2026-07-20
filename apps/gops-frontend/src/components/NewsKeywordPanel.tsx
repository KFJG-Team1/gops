import { ChevronRight, LoaderCircle, RefreshCcw } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  agentReferenceKey,
  newsDailySummaryReference,
  type AgentReference
} from "../agent/agentReferences";
import { GlossaryText } from "../glossary/GlossaryText";
import {
  latestSimulatorStatus,
  simulatorStatusEvent,
  type SimulatorStatus
} from "../simulator/simulatorApi";
import { ContextualAgentAskButton } from "./ContextualAgentAskButton";

export type NewsKeywordDirection = "positive" | "negative" | "neutral";
export type NewsKeywordImpactDirection = NewsKeywordDirection | "mixed";

export type NewsKeywordTag = {
  label: string;
  direction: NewsKeywordDirection;
};

type NewsKeywordSource = {
  articleId?: string;
  title: string;
  name?: string;
  url: string;
  publishedAt?: string;
};

type NewsKeywordPriceChange = {
  date: string;
  previousClose: number;
  close: number;
  change: number;
  changePercent: number;
};

export type NewsKeywordDailySummary = {
  date: string;
  symbol?: string;
  summary: string;
  keyPoints: string[];
  keywordTags: NewsKeywordTag[];
  impactDirection: NewsKeywordImpactDirection;
  articleIds: string[];
  articleCount?: number;
  sources: NewsKeywordSource[];
  priceChange?: NewsKeywordPriceChange;
};

export type NewsKeywordResponse = {
  symbol: string;
  displayMode?: string;
  dailySummaries: NewsKeywordDailySummary[];
};

export function newsKeywordEndpoint(_mode: SimulatorStatus["mode"]) {
  return "/api/market/news/daily";
}

export const NEWS_KEYWORD_REFRESH_MS = 5 * 60_000;

type NewsKeywordLoadMode = "initial" | "manual" | "background";

type NewsKeywordPanelProps = {
  symbol: string;
  initialPayload?: unknown;
  sourcePanelId?: string;
  selectedAgentReferenceKeys?: string[];
  emphasizedAgentReferenceKeys?: string[];
  onAgentReferenceSelect?: (reference: AgentReference) => void;
  onAgentAsk?: () => void;
};

export function NewsKeywordPanel({
  symbol,
  initialPayload,
  sourcePanelId,
  selectedAgentReferenceKeys = [],
  emphasizedAgentReferenceKeys = [],
  onAgentAsk
}: NewsKeywordPanelProps) {
  const normalizedInitialPayload = initialNewsKeywordResponse(initialPayload, symbol);
  const [payload, setPayload] = useState<NewsKeywordResponse | null>(normalizedInitialPayload);
  const [loading, setLoading] = useState(!normalizedInitialPayload);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [simulatorMode, setSimulatorMode] = useState(
    () => latestSimulatorStatus()?.mode ?? "live"
  );

  const loadNews = useCallback(async (
    signal?: AbortSignal,
    mode: NewsKeywordLoadMode = "initial"
  ) => {
    if (mode === "manual") {
      setRefreshing(true);
    } else if (mode === "initial") {
      setLoading(true);
    }
    if (mode !== "background") {
      setError(undefined);
    }
    try {
      const params = new URLSearchParams({ symbol, limit: "30", locale: "ko-KR" });
      const endpoint = newsKeywordEndpoint(simulatorMode);
      const response = await fetch(`${endpoint}?${params.toString()}`, { signal });
      const parsedPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`뉴스 API 응답 오류 ${response.status}`);
      }
      setPayload(normalizeNewsKeywordResponse(parsedPayload, symbol) ?? emptyNewsKeywordResponse(symbol));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      if (mode === "background") {
        return;
      }
      setError(caught instanceof Error ? caught.message : "뉴스 키워드를 불러오지 못했습니다.");
      setPayload(null);
    } finally {
      if (!signal?.aborted && mode !== "background") {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [simulatorMode, symbol]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      setSimulatorMode((event as CustomEvent<SimulatorStatus>).detail?.mode ?? "live");
    };
    window.addEventListener(simulatorStatusEvent, handleStatus);
    return () => window.removeEventListener(simulatorStatusEvent, handleStatus);
  }, []);

  useEffect(() => {
    const nextPayload = initialNewsKeywordResponse(initialPayload, symbol);
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

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadNews(undefined, "background");
      }
    };
    const intervalId = window.setInterval(refresh, NEWS_KEYWORD_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [loadNews]);

  const summaries = payload?.dailySummaries ?? [];
  const keywordSummaries = summaries.filter((item) => item.keywordTags.length > 0);
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const handleSummaryKeyDown = useCallback((
    event: KeyboardEvent<HTMLElement>,
    key: string
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleExpanded(key);
  }, [toggleExpanded]);

  return (
    <section className="news-keyword-panel" aria-label={`${symbol} 뉴스 키워드 패널`}>
      <header className="news-keyword-panel-header">
        <div className="news-keyword-panel-title">
          <span>{symbol.toUpperCase()}</span>
          <strong>뉴스 키워드</strong>
        </div>
        <button
          className="news-keyword-refresh"
          type="button"
          title="뉴스 키워드 새로고침"
          aria-label="뉴스 키워드 새로고침"
          disabled={refreshing}
          onClick={() => void loadNews(undefined, "manual")}
        >
          {refreshing ? <LoaderCircle size={16} className="spin" /> : <RefreshCcw size={16} />}
        </button>
      </header>

      {loading && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>뉴스 키워드를 불러오는 중입니다</span>
        </div>
      )}
      {error && !loading && <div className="panel-error-row">{error}</div>}
      {!loading && !error && keywordSummaries.length === 0 && (
        <div className="news-keyword-empty">
          {summaries.length > 0
            ? "새 뉴스 키워드 요약을 준비 중입니다"
            : `${symbol.toUpperCase()} 뉴스 키워드가 없습니다`}
        </div>
      )}

      {!loading && !error && keywordSummaries.length > 0 && (
        <div className="news-keyword-list">
          {keywordSummaries.map((item) => {
            const rowKey = `${item.symbol ?? symbol}-${item.date}`;
            const detailsId = `news-keyword-details-${rowKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const expanded = expandedKeys.has(rowKey);
            const reference = newsDailySummaryReference(item, symbol, sourcePanelId);
            const referenceKey = agentReferenceKey(reference);
            const selected = selectedAgentReferenceKeys.includes(referenceKey);
            const emphasized = emphasizedAgentReferenceKeys.includes(referenceKey);
            return (
              <article
                key={rowKey}
                className={[
                  "news-keyword-row",
                  selected ? "is-agent-reference-selected" : "",
                  emphasized ? "is-agent-reference-emphasized" : ""
                ].filter(Boolean).join(" ")}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => toggleExpanded(rowKey)}
                onKeyDown={(event) => handleSummaryKeyDown(event, rowKey)}
              >
                <span
                  className={`news-keyword-verdict is-${item.impactDirection}`}
                  aria-label={`종합 ${newsKeywordImpactText(item.impactDirection)}`}
                >
                  <span aria-hidden="true">{newsKeywordVerdictSymbol(item.impactDirection)}</span>
                </span>

                <div className="news-keyword-row-content">
                  <div className="news-keyword-row-heading">
                    <div className="news-keyword-date-line">
                      <strong>{formatNewsKeywordDate(item.date)}</strong>
                      {item.priceChange && (
                        <span
                          className={`news-keyword-price is-${priceDirection(item.priceChange.change)}`}
                          title={priceChangeTitle(item.priceChange)}
                        >
                          {formatDailyPriceChange(item.priceChange)}
                        </span>
                      )}
                      <span className="news-keyword-article-count">
                        기사 {dailyArticleCount(item)}건
                      </span>
                    </div>
                    <div className="news-keyword-row-controls">
                      <span
                        className={`news-keyword-expand ${expanded ? "is-expanded" : ""}`}
                        aria-hidden="true"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </span>
                    </div>
                  </div>

                  <div className="news-keyword-tags" aria-label={`${item.date} 핵심 뉴스 키워드`}>
                    {item.keywordTags.map((tag) => (
                      <span
                        key={`${tag.label}-${tag.direction}`}
                        className={`news-keyword-chip is-${tag.direction}`}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <GlossaryText text={tag.label} />
                        <span aria-hidden="true">{newsKeywordDirectionSymbol(tag.direction)}</span>
                      </span>
                    ))}
                  </div>

                  {expanded && (
                    <div id={detailsId} className="news-keyword-details">
                      <p><GlossaryText text={item.summary} /></p>
                      {item.sources.length > 0 && (
                        <div className="news-keyword-sources">
                          <span>출처</span>
                          <div aria-label={`${item.date} 출처`}>
                            {item.sources.map((source, index) => (
                              <a
                                key={`${source.url}-${index}`}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                title={`${source.name ?? sourceHost(source.url)} · ${source.title}`}
                                aria-label={`출처: ${source.title}`}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                {sourceBadgeText(source)}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {selected && onAgentAsk && (
                        <span
                          className="news-keyword-agent-ask"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <ContextualAgentAskButton onAsk={onAgentAsk} />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function normalizeNewsKeywordResponse(
  payload: unknown,
  fallbackSymbol = "UNKNOWN"
): NewsKeywordResponse | null {
  const source = readObject(payload);
  if (!source) {
    return null;
  }
  return {
    symbol: readString(source.symbol) ?? fallbackSymbol,
    displayMode: readString(source.displayMode) ?? undefined,
    dailySummaries: readArray(source.dailySummaries)
      .map(normalizeNewsKeywordSummary)
      .filter((item): item is NewsKeywordDailySummary => Boolean(item))
  };
}

function normalizeNewsKeywordSummary(value: unknown): NewsKeywordDailySummary | null {
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
    keyPoints: readArray(source.keyPoints)
      .map(readString)
      .filter((item): item is string => Boolean(item)),
    keywordTags: readArray(source.keywordTags)
      .map(normalizeNewsKeywordTag)
      .filter((item): item is NewsKeywordTag => Boolean(item))
      .slice(0, 3),
    impactDirection: normalizeNewsKeywordImpact(source.impactDirection),
    articleIds: readArray(source.articleIds)
      .map(readString)
      .filter((item): item is string => Boolean(item)),
    articleCount: readNumber(source.articleCount),
    sources: readArray(source.sources)
      .map(normalizeNewsKeywordSource)
      .filter((item): item is NewsKeywordSource => Boolean(item)),
    priceChange: normalizeNewsKeywordPriceChange(source.priceChange) ?? undefined
  };
}

function normalizeNewsKeywordTag(value: unknown): NewsKeywordTag | null {
  const source = readObject(value);
  const label = readString(source?.label);
  const direction = readString(source?.direction);
  if (!source || !label || label.length > 10 || !isNewsKeywordDirection(direction)) {
    return null;
  }
  return { label, direction };
}

function normalizeNewsKeywordSource(value: unknown): NewsKeywordSource | null {
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

function normalizeNewsKeywordPriceChange(value: unknown): NewsKeywordPriceChange | null {
  const source = readObject(value);
  const date = readString(source?.date);
  const previousClose = readNumber(source?.previousClose);
  const close = readNumber(source?.close);
  const change = readNumber(source?.change);
  const changePercent = readNumber(source?.changePercent) ?? 0;
  if (!source || !date || previousClose === undefined || close === undefined || change === undefined) {
    return null;
  }
  return { date, previousClose, close, change, changePercent };
}

function initialNewsKeywordResponse(payload: unknown, symbol: string) {
  return normalizeNewsKeywordResponse(payload, symbol);
}

function emptyNewsKeywordResponse(symbol: string): NewsKeywordResponse {
  return { symbol, displayMode: "dailySummary", dailySummaries: [] };
}

export function newsKeywordDirectionSymbol(direction: NewsKeywordDirection) {
  return direction === "positive" ? "▲" : direction === "negative" ? "▼" : "-";
}

export function newsKeywordVerdictSymbol(direction: NewsKeywordImpactDirection) {
  if (direction === "positive") {
    return "▲";
  }
  if (direction === "negative") {
    return "▼";
  }
  return direction === "mixed" ? "◆" : "-";
}

function newsKeywordImpactText(direction: NewsKeywordImpactDirection) {
  if (direction === "positive") {
    return "긍정";
  }
  if (direction === "negative") {
    return "부정";
  }
  return direction === "mixed" ? "혼재" : "중립";
}

function normalizeNewsKeywordImpact(value: unknown): NewsKeywordImpactDirection {
  return value === "positive" || value === "negative" || value === "mixed" || value === "neutral"
    ? value
    : "neutral";
}

function isNewsKeywordDirection(value: string | null): value is NewsKeywordDirection {
  return value === "positive" || value === "negative" || value === "neutral";
}

function formatNewsKeywordDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(timestamp));
}

function formatDailyPriceChange(value: NewsKeywordPriceChange) {
  const change = Math.abs(value.change) < 0.005 ? 0 : value.change;
  const changeText = `${change > 0 ? "+" : ""}${change.toFixed(2)}`;
  const percentText = `${value.changePercent > 0 ? "+" : ""}${value.changePercent.toFixed(2)}%`;
  return `${changeText} (${percentText})`;
}

function priceDirection(value: number) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function priceChangeTitle(value: NewsKeywordPriceChange) {
  return `전일 종가 ${value.previousClose.toFixed(2)} · 당일 종가 ${value.close.toFixed(2)} · ${value.changePercent.toFixed(2)}%`;
}

function dailyArticleCount(item: NewsKeywordDailySummary) {
  return Math.max(item.articleCount ?? 0, item.articleIds.length, item.sources.length);
}

function sourceBadgeText(source: NewsKeywordSource) {
  const name = source.name ?? sourceHost(source.url);
  const normalizedName = name.replace(/[^A-Za-z0-9가-힣]/g, "");
  const knownBadges: Record<string, string> = {
    bloomberg: "BL",
    cnbc: "CN",
    marketwatch: "MW",
    reuters: "RT",
    seekingalpha: "SA",
    yahoofinance: "YF"
  };
  const knownBadge = knownBadges[normalizedName.toLowerCase()];
  if (knownBadge) {
    return knownBadge;
  }
  const capitalInitials = name.match(/[A-Z]/g)?.join("").slice(0, 2);
  if (capitalInitials?.length === 2) {
    return capitalInitials;
  }
  const words = (source.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
  }
  return normalizedName.slice(0, 2).toUpperCase() || "↗";
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
