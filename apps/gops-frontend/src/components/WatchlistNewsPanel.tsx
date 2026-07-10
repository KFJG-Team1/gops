import { ExternalLink, LoaderCircle, RefreshCcw, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentReferenceKey,
  newsArticleReference,
  type AgentReference
} from "../agent/agentReferences";
import { useAuth } from "../auth/AuthProvider";
import { NewsFlipCard, type NewsFlipCardItem } from "./NewsFlipCard";
import { LogoDevAttribution, StockLogo } from "./StockLogo";

const REFRESH_INTERVAL_MS = 60_000;

type WatchlistNewsMode = "watchlist" | "hot" | "recommended";

const watchlistNewsModes: Array<{ mode: WatchlistNewsMode; label: string; title: string }> = [
  { mode: "watchlist", label: "관심", title: "관심 기업 기준 뉴스" },
  { mode: "recommended", label: "추천", title: "추천 기업 기준 뉴스" },
  { mode: "hot", label: "인기", title: "급등, 급락, 거래대금 상위 종목 기준 뉴스" }
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
  onAgentAsk?: () => void;
  variant?: "flip" | "list";
};

export function WatchlistNewsPanel({
  sourcePanelId,
  selectedAgentReferenceKeys = [],
  emphasizedAgentReferenceKeys = [],
  onAgentReferenceSelect,
  variant = "flip"
}: WatchlistNewsPanelProps) {
  const { authEnabled, user, loading: authLoading, login } = useAuth();
  const localDemoEnabled = isLocalWatchlistNewsDemoHost();
  const [payloadsByMode, setPayloadsByMode] = useState<Record<WatchlistNewsMode, WatchlistNewsResponse | null>>(
    () => localDemoPayloadsByMode() ?? { watchlist: null, recommended: null, hot: null }
  );
  const [loading, setLoading] = useState(!localDemoEnabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [mode, setMode] = useState<WatchlistNewsMode>("watchlist");
  const [revealedMode, setRevealedMode] = useState<WatchlistNewsMode | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<WatchlistNewsMatch | null>(null);
  const [companyPayload, setCompanyPayload] = useState<WatchlistNewsResponse | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyRefreshing, setCompanyRefreshing] = useState(false);
  const [companyError, setCompanyError] = useState<string | undefined>();
  const loginRequired = authEnabled && !authLoading && !user && !localDemoEnabled;
  const panelAuthLoading = authLoading && !localDemoEnabled;
  const activeModeLabel = selectedCompany?.companyName ?? selectedCompany?.symbol ?? watchlistNewsModes.find((item) => item.mode === mode)?.label ?? "관심";

  const loadNews = useCallback(async (targetMode: WatchlistNewsMode, signal?: AbortSignal, showRefreshing = false, background = false) => {
    if (loginRequired) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!background) {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(undefined);
    }
    const demoPayload = localWatchlistNewsDemoResponse(targetMode);
    if (demoPayload) {
      setPayloadsByMode((current) => ({ ...current, [targetMode]: demoPayload }));
      if (!background) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    try {
      const params = new URLSearchParams({ limit: "30", locale: "ko-KR", mode: targetMode });
      const response = await fetch(`/api/market/news/watchlist?${params.toString()}`, { signal });
      const parsedPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(response.status === 401 ? "로그인이 필요합니다." : `뉴스 API 응답 오류 ${response.status}`);
      }
      const nextPayload = normalizeWatchlistNewsResponse(parsedPayload) ?? emptyWatchlistNewsResponse();
      setPayloadsByMode((current) => ({ ...current, [targetMode]: nextPayload }));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      if (!background) {
        setError(caught instanceof Error ? caught.message : "뉴스를 불러오지 못했습니다.");
        setPayloadsByMode((current) => ({ ...current, [targetMode]: null }));
      }
    } finally {
      if (!signal?.aborted && !background) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loginRequired]);

  const loadCompanyNews = useCallback(async (company: WatchlistNewsMatch, signal?: AbortSignal, showRefreshing = false) => {
    if (loginRequired) {
      setCompanyLoading(false);
      setCompanyRefreshing(false);
      return;
    }
    if (showRefreshing) {
      setCompanyRefreshing(true);
    } else {
      setCompanyLoading(true);
    }
    setCompanyError(undefined);
    const demoPayload = localCompanyNewsDemoResponse(company);
    if (demoPayload) {
      setCompanyPayload(demoPayload);
      setCompanyLoading(false);
      setCompanyRefreshing(false);
      return;
    }
    try {
      const params = new URLSearchParams({ symbol: company.symbol, limit: "30", locale: "ko-KR" });
      const response = await fetch(`/api/market/news/latest?${params.toString()}`, { signal });
      const parsedPayload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`뉴스 API 응답 오류 ${response.status}`);
      }
      setCompanyPayload(normalizeCompanyNewsResponse(parsedPayload, company) ?? emptyCompanyNewsResponse(company));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setCompanyError(caught instanceof Error ? caught.message : "뉴스를 불러오지 못했습니다.");
      setCompanyPayload(null);
    } finally {
      if (!signal?.aborted) {
        setCompanyLoading(false);
        setCompanyRefreshing(false);
      }
    }
  }, [loginRequired]);

  useEffect(() => {
    if (panelAuthLoading) {
      return undefined;
    }
    if (loginRequired) {
      setPayloadsByMode({ watchlist: null, recommended: null, hot: null });
      setLoading(false);
      setError(undefined);
      setRevealedMode(null);
      setSelectedCompany(null);
      setCompanyPayload(null);
      setCompanyError(undefined);
      return undefined;
    }
    const controller = new AbortController();
    void loadNews(mode, controller.signal);
    const intervalId = window.setInterval(() => {
      void loadNews(mode, undefined, true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [loadNews, loginRequired, mode, panelAuthLoading]);

  useEffect(() => {
    if (panelAuthLoading || loginRequired) {
      return undefined;
    }
    const controllers: AbortController[] = [];
    watchlistNewsModes.forEach((item) => {
      if (item.mode === mode || payloadsByMode[item.mode]) {
        return;
      }
      const controller = new AbortController();
      controllers.push(controller);
      void loadNews(item.mode, controller.signal, false, true);
    });
    return () => controllers.forEach((controller) => controller.abort());
  }, [loadNews, loginRequired, mode, panelAuthLoading, payloadsByMode]);

  useEffect(() => {
    if (!selectedCompany || panelAuthLoading || loginRequired) {
      return undefined;
    }
    const controller = new AbortController();
    void loadCompanyNews(selectedCompany, controller.signal);
    return () => controller.abort();
  }, [loadCompanyNews, loginRequired, panelAuthLoading, selectedCompany]);

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
  const payload = payloadsByMode[mode];
  const items = selectedCompany ? companyPayload?.items ?? [] : payload?.items ?? [];
  const symbols = payload?.symbols ?? [];
  const modeCompanies = watchlistNewsModes.reduce<Record<WatchlistNewsMode, WatchlistNewsMatch[]>>((accumulator, item) => {
    accumulator[item.mode] = companiesFromPayload(payloadsByMode[item.mode]);
    return accumulator;
  }, { watchlist: [], recommended: [], hot: [] });
  const activeLoading = selectedCompany ? companyLoading : loading;
  const activeRefreshing = selectedCompany ? companyRefreshing : refreshing;
  const activeError = selectedCompany ? companyError : error;
  const emptyMessage = payload?.message || (mode === "watchlist" && symbols.length === 0
    ? "하단 관심종목 메뉴에서 종목을 추가하세요."
    : "표시할 뉴스가 없습니다.");
  const activeEmptyMessage = selectedCompany
    ? `${selectedCompany.symbol} 관련 저장 뉴스가 없습니다.`
    : emptyMessage;
  const handleModeSelect = useCallback((nextMode: WatchlistNewsMode) => {
    setMode(nextMode);
    setRevealedMode(nextMode);
    setSelectedCompany(null);
    setCompanyPayload(null);
    setCompanyError(undefined);
  }, []);
  const handleCompanySelect = useCallback((company: WatchlistNewsMatch) => {
    setSelectedCompany(normalizeCompanySelection(company));
    setCompanyPayload(null);
    setCompanyError(undefined);
  }, []);
  const clearSelectedCompany = useCallback(() => {
    setRevealedMode(null);
    setSelectedCompany(null);
    setCompanyPayload(null);
    setCompanyError(undefined);
  }, []);
  const flipItems = useMemo<NewsFlipCardItem[]>(() => items.map((item, index) => {
    const reference = newsArticleReference(item, sourcePanelId);
    const referenceKey = agentReferenceKey(reference);
    return {
      key: `${item.articleId ?? item.url ?? item.title}-${index}`,
      symbol: selectedCompany?.symbol ?? item.symbol,
      title: item.title,
      url: item.url,
      reference,
      selected: selectedAgentReferenceKeys.includes(referenceKey),
      emphasized: emphasizedAgentReferenceKeys.includes(referenceKey)
    };
  }), [emphasizedAgentReferenceKeys, items, selectedAgentReferenceKeys, selectedCompany?.symbol, sourcePanelId]);

  return (
    <section className={`market-news-panel watchlist-news-panel is-${variant}-view`} aria-label={`관심종목 뉴스 ${variant === "list" ? "목록" : "카드"} 패널`}>
      <button
        className="panel-reload-overlay panel-icon-button"
        type="button"
        title={`${activeModeLabel} 새로고침`}
        aria-label={`${activeModeLabel} 새로고침`}
        onClick={() => {
          if (selectedCompany) {
            void loadCompanyNews(selectedCompany, undefined, true);
            return;
          }
          void loadNews(mode, undefined, true);
        }}
        disabled={panelAuthLoading || loginRequired}
      >
        {activeRefreshing || panelAuthLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
      </button>
      <div className="watchlist-news-topbar">
        <div className="watchlist-company-groups" role="group" aria-label="뉴스 기준">
          {watchlistNewsModes.map((item) => (
            <div
              key={item.mode}
              className={`watchlist-company-group ${modeCompanies[item.mode].length > 0 ? "has-companies" : ""} ${revealedMode === item.mode ? "is-revealed" : ""} ${item.mode === mode && !selectedCompany ? "active" : ""}`}
            >
              <button
                type="button"
                className="watchlist-company-group-button"
                title={item.title}
                aria-label={item.label}
                aria-pressed={item.mode === mode && !selectedCompany}
                onClick={() => handleModeSelect(item.mode)}
                disabled={panelAuthLoading || loginRequired}
              >
                <span className="watchlist-company-group-label">{item.label}</span>
              </button>
              <div className="watchlist-company-logo-tray" role="group" aria-label={`${item.label} 종목`}>
                {modeCompanies[item.mode].slice(0, 5).map((company) => (
                  <button
                    key={company.symbol}
                    type="button"
                    className="watchlist-company-logo-button"
                    title={companyTitle(company)}
                    aria-label={`${companyTitle(company)} 뉴스 보기`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMode(item.mode);
                      handleCompanySelect(company);
                    }}
                    disabled={panelAuthLoading || loginRequired}
                  >
                    <StockLogo symbol={company.symbol} companyName={company.companyName} size="xs" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedCompany && (
        <div className="watchlist-selected-company">
          <StockLogo symbol={selectedCompany.symbol} companyName={selectedCompany.companyName} size="xs" />
          <span>{selectedCompany.symbol}</span>
          <button type="button" title="그룹 뉴스로 돌아가기" aria-label="그룹 뉴스로 돌아가기" onClick={clearSelectedCompany}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      {loginRequired && (
        <div className="panel-state-row">
          <span>로그인하면 관심종목 뉴스가 표시됩니다</span>
          <button className="panel-state-action" type="button" onClick={login}>로그인</button>
        </div>
      )}

      {(activeLoading || panelAuthLoading) && !loginRequired && (
        <div className="panel-state-row">
          <LoaderCircle size={14} className="spin" />
          <span>관심종목 뉴스를 불러오는 중입니다</span>
        </div>
      )}
      {activeError && !activeLoading && !panelAuthLoading && <div className="panel-error-row">{activeError}</div>}
      {!loginRequired && !activeLoading && !panelAuthLoading && !activeError && items.length === 0 && (
        <div className="panel-empty-row">{activeEmptyMessage}</div>
      )}
      {!loginRequired && !activeLoading && !panelAuthLoading && !activeError && variant === "flip" && items.length > 0 && (
        <NewsFlipCard
          items={flipItems}
          ariaLabel={`${activeModeLabel} 뉴스 카드`}
          onSelect={selectReference}
        />
      )}
      {!loginRequired && !activeLoading && !panelAuthLoading && !activeError && variant === "list" && items.length > 0 && (
        <div className="market-news-list">
          {items.map((item, index) => {
            const reference = newsArticleReference(item, sourcePanelId);
            const referenceKey = agentReferenceKey(reference);
            const selected = selectedAgentReferenceKeys.includes(referenceKey);
            const emphasized = emphasizedAgentReferenceKeys.includes(referenceKey);
            const rowMatches = selectedCompany ? [selectedCompany] : item.matches;
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
                {rowMatches.length > 0 && (
                  <div className="watchlist-news-badges" aria-label="관련 종목">
                    {rowMatches.map((match) => (
                      <button
                        key={match.symbol}
                        type="button"
                        className="watchlist-news-badge"
                        title={companyTitle(match)}
                        aria-label={`${companyTitle(match)} 뉴스 보기`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCompanySelect(match);
                        }}
                      >
                        <StockLogo symbol={match.symbol} companyName={match.companyName} size="xs" />
                      </button>
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
      <LogoDevAttribution className="panel-logo-attribution" />
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

function emptyCompanyNewsResponse(company: WatchlistNewsMatch): WatchlistNewsResponse {
  return {
    displayMode: "companyNews",
    symbols: [company.symbol],
    items: [],
    message: `${company.symbol} 관련 저장 뉴스가 없습니다.`
  };
}

function normalizeCompanyNewsResponse(payload: unknown, company: WatchlistNewsMatch): WatchlistNewsResponse | null {
  const source = readObject(payload);
  if (!source) {
    return null;
  }
  const symbol = readString(source.symbol) ?? company.symbol;
  return {
    source: readString(source.source) ?? undefined,
    displayMode: "companyNews",
    symbols: [symbol],
    items: readArray(source.items).map(normalizeWatchlistNewsItem).filter((item): item is WatchlistNewsItem => Boolean(item)),
    message: readString(source.message) ?? undefined
  };
}

function companiesFromPayload(payload: WatchlistNewsResponse | null): WatchlistNewsMatch[] {
  if (!payload) {
    return [];
  }
  const metadataBySymbol = new Map<string, WatchlistNewsMatch>();
  payload.items.forEach((item) => {
    item.matches.forEach((match) => {
      metadataBySymbol.set(match.symbol, { ...metadataBySymbol.get(match.symbol), ...match });
    });
  });
  return payload.symbols
    .map((symbol) => normalizeCompanySelection(metadataBySymbol.get(symbol) ?? { symbol }))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index)
    .slice(0, 8);
}

function normalizeCompanySelection(company: WatchlistNewsMatch): WatchlistNewsMatch {
  return {
    symbol: company.symbol.trim().toUpperCase(),
    companyName: company.companyName,
    reason: company.reason
  };
}

function companyTitle(company: WatchlistNewsMatch): string {
  return company.companyName ? `${company.symbol} · ${company.companyName}` : company.symbol;
}

function localDemoPayloadsByMode(): Record<WatchlistNewsMode, WatchlistNewsResponse | null> | null {
  if (!isLocalWatchlistNewsDemoHost()) {
    return null;
  }
  return {
    watchlist: localWatchlistNewsDemoResponse("watchlist"),
    recommended: localWatchlistNewsDemoResponse("recommended"),
    hot: localWatchlistNewsDemoResponse("hot")
  };
}

function localWatchlistNewsDemoResponse(mode: WatchlistNewsMode): WatchlistNewsResponse | null {
  if (!isLocalWatchlistNewsDemoHost()) {
    return null;
  }
  const companies = localDemoCompaniesByMode[mode];
  return {
    source: "local-demo",
    displayMode: mode === "watchlist" ? "watchlistNews" : mode === "recommended" ? "recommendedNews" : "hotNews",
    symbols: companies.map((company) => company.symbol),
    items: localDemoItemsByMode[mode],
    message: ""
  };
}

function localCompanyNewsDemoResponse(company: WatchlistNewsMatch): WatchlistNewsResponse | null {
  if (!isLocalWatchlistNewsDemoHost()) {
    return null;
  }
  const normalizedCompany = normalizeCompanySelection(company);
  const items = Object.values(localDemoItemsByMode)
    .flat()
    .filter((item) => item.symbols.includes(normalizedCompany.symbol) || item.symbol === normalizedCompany.symbol)
    .slice(0, 6);
  return {
    source: "local-demo",
    displayMode: "companyNews",
    symbols: [normalizedCompany.symbol],
    items: items.length > 0 ? items : [
      localDemoArticle(normalizedCompany, "local-company-fallback-a", "기업 실적 기대가 다시 주목받고 있습니다.", "애널리스트들은 최근 수요 지표와 비용 통제 흐름을 근거로 단기 모멘텀이 유지될 수 있다고 봤습니다.", "positive"),
      localDemoArticle(normalizedCompany, "local-company-fallback-b", "거시 변동성 속에서 밸류에이션 점검이 이어졌습니다.", "금리와 환율 변수가 부담으로 남아 있지만 핵심 사업의 현금창출력은 방어 요인으로 평가됐습니다.", "mixed")
    ],
    message: ""
  };
}

function isLocalWatchlistNewsDemoHost() {
  if (typeof window === "undefined") {
    return false;
  }
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
}

function localDemoArticle(
  company: WatchlistNewsMatch,
  articleId: string,
  title: string,
  summary: string,
  impactDirection: WatchlistNewsItem["impactDirection"],
  extraMatches: WatchlistNewsMatch[] = []
): WatchlistNewsItem {
  const matches = [company, ...extraMatches].map(normalizeCompanySelection);
  return {
    articleId,
    symbol: company.symbol,
    symbols: matches.map((match) => match.symbol),
    title,
    summary,
    url: `https://example.com/news/${articleId}`,
    source: "Local demo",
    publishedAt: "2026-07-10T09:30:00.000Z",
    impactDirection,
    matches
  };
}

const localDemoCompaniesByMode: Record<WatchlistNewsMode, WatchlistNewsMatch[]> = {
  watchlist: [
    { symbol: "NVDA", companyName: "NVIDIA Corporation" },
    { symbol: "AAPL", companyName: "Apple Inc." },
    { symbol: "MSFT", companyName: "Microsoft Corporation" },
    { symbol: "TSLA", companyName: "Tesla, Inc." },
    { symbol: "GOOGL", companyName: "Alphabet Inc." }
  ],
  recommended: [
    { symbol: "MSFT", companyName: "Microsoft Corporation", reason: "추천" },
    { symbol: "AVGO", companyName: "Broadcom Inc.", reason: "추천" },
    { symbol: "AMZN", companyName: "Amazon.com, Inc.", reason: "추천" },
    { symbol: "META", companyName: "Meta Platforms, Inc.", reason: "추천" },
    { symbol: "LLY", companyName: "Eli Lilly and Company", reason: "추천" }
  ],
  hot: [
    { symbol: "NVDA", companyName: "NVIDIA Corporation", reason: "거래대금" },
    { symbol: "AMD", companyName: "Advanced Micro Devices, Inc.", reason: "급등" },
    { symbol: "AAPL", companyName: "Apple Inc.", reason: "거래대금" },
    { symbol: "TSLA", companyName: "Tesla, Inc.", reason: "급락" },
    { symbol: "PLTR", companyName: "Palantir Technologies Inc.", reason: "거래대금" }
  ]
};

const localDemoItemsByMode: Record<WatchlistNewsMode, WatchlistNewsItem[]> = {
  watchlist: [
    localDemoArticle(
      localDemoCompaniesByMode.watchlist[0],
      "watchlist-demo-nvda-aapl",
      "AI 반도체 수요가 대형 기술주 관심을 다시 끌어올렸습니다.",
      "데이터센터 투자 확대 기대가 NVIDIA와 Apple 공급망 전반의 투자심리를 지지했습니다.",
      "positive",
      [localDemoCompaniesByMode.watchlist[1]]
    ),
    localDemoArticle(
      localDemoCompaniesByMode.watchlist[2],
      "watchlist-demo-msft",
      "Microsoft 클라우드 성장률 전망이 방어적인 관심종목 흐름을 만들었습니다.",
      "Azure와 AI 서비스 매출 기여가 확대될 수 있다는 전망이 장중 매수세를 뒷받침했습니다.",
      "positive"
    ),
    localDemoArticle(
      localDemoCompaniesByMode.watchlist[3],
      "watchlist-demo-tsla",
      "Tesla 인도량 전망을 두고 시장 의견이 엇갈렸습니다.",
      "가격 인하 효과와 마진 압박이 함께 거론되며 단기 변동성이 커졌습니다.",
      "mixed"
    )
  ],
  recommended: [
    localDemoArticle(
      localDemoCompaniesByMode.recommended[0],
      "recommended-demo-msft-avgo",
      "추천 리스트 상위 기업들이 AI 인프라 지출 수혜주로 묶였습니다.",
      "Microsoft와 Broadcom은 엔터프라이즈 AI 예산 확대의 직접 수혜 후보로 거론됐습니다.",
      "positive",
      [localDemoCompaniesByMode.recommended[1]]
    ),
    localDemoArticle(
      localDemoCompaniesByMode.recommended[2],
      "recommended-demo-amzn",
      "Amazon은 커머스 마진과 AWS 회복 기대가 동시에 반영됐습니다.",
      "비용 효율화와 클라우드 수요 개선이 추천 점수 상승 요인으로 해석됐습니다.",
      "positive"
    ),
    localDemoArticle(
      localDemoCompaniesByMode.recommended[4],
      "recommended-demo-lly",
      "Eli Lilly는 방어 성장주 선호 속에서 추천 기업으로 유지됐습니다.",
      "비만 치료제 수요와 생산능력 확장 기대가 중장기 매출 전망을 지지했습니다.",
      "neutral"
    )
  ],
  hot: [
    localDemoArticle(
      localDemoCompaniesByMode.hot[0],
      "hot-demo-nvda-amd",
      "거래대금 상위 반도체주가 시장 주도권을 이어갔습니다.",
      "NVIDIA와 AMD가 AI 서버 투자 확대 기대 속에서 높은 회전율을 보였습니다.",
      "positive",
      [localDemoCompaniesByMode.hot[1]]
    ),
    localDemoArticle(
      localDemoCompaniesByMode.hot[2],
      "hot-demo-aapl",
      "Apple은 대형주 거래대금 상위권을 유지했습니다.",
      "신제품 기대와 서비스 매출 방어력이 동시에 주목받으며 장중 관심이 집중됐습니다.",
      "neutral"
    ),
    localDemoArticle(
      localDemoCompaniesByMode.hot[3],
      "hot-demo-tsla-pltr",
      "고변동성 성장주가 인기 종목 화면을 채웠습니다.",
      "Tesla와 Palantir는 수급 쏠림 속에서 단기 뉴스 민감도가 커졌습니다.",
      "mixed",
      [localDemoCompaniesByMode.hot[4]]
    )
  ]
};

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

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
