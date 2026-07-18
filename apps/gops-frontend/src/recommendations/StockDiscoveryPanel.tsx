import { Activity, Filter, Flame, LoaderCircle, RefreshCcw, RotateCcw, Search, Sparkles, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { agentReferenceKey, stockRecommendationReference, type AgentReference } from "../agent/agentReferences";
import { LogoDevAttribution, StockLogo } from "../components/StockLogo";
import { canonicalSectorOptions, normalizeSector, sectorLabelKo } from "../market/sectors";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import {
  fetchStockRecommendations,
  refreshStockRecommendations,
  type StockRecommendationItem,
  type StockRecommendationPayload
} from "./recommendationApi";
import { recommendationBlockLabels, ScoreProfileManager } from "./ScoreProfileManager";
import type { StockRecommendationSelection } from "./StockRecommendationsPanel";

export const DISCOVERY_PAGE_SIZE = 50;
export type DiscoveryListMode = "recommended" | "popular" | "gainers" | "volume" | "all";
export type DirectionFilter = "up" | "down";
export type ScreenerMetricKey =
  | "rsi14"
  | "peRatio"
  | "pbRatio"
  | "roePct"
  | "debtRatioPct"
  | "operatingMarginPct"
  | "freeCashFlowMarginPct"
  | "dollarVolumeMillion"
  | "recommendationScore";
export type NumericRange = { min: string; max: string };

export const screenerMetricDefinitions: Array<{
  key: ScreenerMetricKey;
  label: string;
  unit: string;
  step: string;
}> = [
  { key: "rsi14", label: "RSI(14)", unit: "", step: "1" },
  { key: "peRatio", label: "PER(공시 EPS)", unit: "배", step: "0.1" },
  { key: "pbRatio", label: "PBR", unit: "배", step: "0.1" },
  { key: "roePct", label: "ROE", unit: "%", step: "0.1" },
  { key: "debtRatioPct", label: "부채비율", unit: "%", step: "0.1" },
  { key: "operatingMarginPct", label: "영업이익률", unit: "%", step: "0.1" },
  { key: "freeCashFlowMarginPct", label: "FCF 마진", unit: "%", step: "0.1" },
  { key: "dollarVolumeMillion", label: "거래대금", unit: "백만$", step: "1" },
  { key: "recommendationScore", label: "추천 점수", unit: "점", step: "1" }
];

export type DiscoveryRow = {
  market: Sp500UniverseItem;
  recommendation?: StockRecommendationItem;
  volumeRank?: number;
  metrics: Record<ScreenerMetricKey, number | null>;
};

const modeLimitOptions: Record<DiscoveryListMode, number[]> = {
  recommended: [],
  popular: [],
  gainers: [10, 20, 50],
  volume: [10, 20, 50],
  all: []
};

export function StockDiscoveryPanel({
  activeSymbol,
  sourcePanelId,
  marketItems,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  onSelectReference,
  initialPopular = false
}: {
  activeSymbol: string;
  sourcePanelId: string;
  marketItems: readonly Sp500UniverseItem[];
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  onSelectReference: (
    reference: AgentReference | null,
    selection?: StockRecommendationSelection | null,
    replaceExisting?: boolean
  ) => void;
  initialPopular?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"list" | "logic">("list");
  const [payload, setPayload] = useState<StockRecommendationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedMarketSymbol, setSelectedMarketSymbol] = useState<string | null>(null);
  const [mode, setMode] = useState<DiscoveryListMode>(initialPopular ? "popular" : "recommended");
  const [modeLimits, setModeLimits] = useState<Record<DiscoveryListMode, number>>({ recommended: Number.MAX_SAFE_INTEGER, popular: 10, gainers: 20, volume: 20, all: Number.MAX_SAFE_INTEGER });
  const [directions, setDirections] = useState<Set<DirectionFilter>>(new Set());
  const [sectors, setSectors] = useState<Set<string>>(new Set());
  const [metricRanges, setMetricRanges] = useState<Record<ScreenerMetricKey, NumericRange>>(emptyMetricRanges);
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await fetchStockRecommendations(signal));
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "추천을 불러오지 못했습니다.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setPayload(await refreshStockRecommendations(activeSymbol));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천을 갱신하지 못했습니다.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [activeSymbol]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const rows = useMemo(() => buildDiscoveryRows(marketItems, payload?.items ?? []), [marketItems, payload?.items]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredRows = useMemo(() => filterDiscoveryRows(rows, {
    mode,
    query: normalizedQuery,
    directions,
    sectors,
    metricRanges,
    limit: modeLimits[mode]
  }), [directions, metricRanges, mode, modeLimits, normalizedQuery, rows, sectors]);

  useEffect(() => setVisibleCount(DISCOVERY_PAGE_SIZE), [directions, metricRanges, mode, modeLimits, normalizedQuery, sectors]);
  const visibleRows = discoveryPage(filteredRows, visibleCount);
  const activeMetricCount = screenerMetricDefinitions.filter(({ key }) => rangeActive(metricRanges[key])).length;
  const activeFilterCount = sectors.size + activeMetricCount + directions.size;

  return (
    <section className="stock-discovery-panel" aria-label="추천 종목 통합 탐색">
      <nav className="stock-discovery-tabs" aria-label="추천 패널 탭">
        <button type="button" className={activeTab === "list" ? "active" : ""} onClick={() => setActiveTab("list")}>종목 목록</button>
        <button type="button" className={activeTab === "logic" ? "active" : ""} onClick={() => {
          setMode("recommended");
          setActiveTab("logic");
        }}>
          <SlidersHorizontal size={13} /> 추천 로직 설정
        </button>
      </nav>

      {activeTab === "list" ? (
        <>
          <nav className="stock-discovery-mode-switcher" aria-label="종목 목록 선택">
            <button type="button" className={mode === "recommended" ? "active" : ""} aria-pressed={mode === "recommended"} onClick={() => setMode("recommended")}>
              <Sparkles size={13} /> 추천
            </button>
            <button type="button" className={mode === "popular" ? "active" : ""} aria-pressed={mode === "popular"} onClick={() => setMode("popular")}>
              <Flame size={13} /> 인기 Top 15
            </button>
            <button type="button" className={mode === "gainers" ? "active" : ""} aria-pressed={mode === "gainers"} onClick={() => setMode("gainers")}>
              <TrendingUp size={13} /> 급등주
            </button>
            <button type="button" className={mode === "volume" ? "active" : ""} aria-pressed={mode === "volume"} onClick={() => setMode("volume")}>
              <Activity size={13} /> 거래대금
            </button>
            <button type="button" className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>
              <Search size={13} /> 전체 종목
            </button>
          </nav>

          <header className="stock-discovery-toolbar">
            <label className="stock-discovery-search">
              <Search size={14} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="티커·기업·산업·섹터 검색" />
            </label>
            <button type="button" className="panel-icon-button" title="추천 갱신" disabled={loading || refreshing} onClick={refresh}>
              {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCcw size={14} />}
            </button>
          </header>

          <details className="stock-discovery-filters stock-discovery-context-filters">
            <summary><Filter size={13} />필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}<span>›</span></summary>
            <div className="stock-discovery-filter-groups">
              {modeLimitOptions[mode].length > 0 && <FilterGroup label="표시 개수">
                {modeLimitOptions[mode].map((limit) => (
                  <ToggleChip key={limit} active={modeLimits[mode] === limit} onClick={() => setModeLimits((current) => ({ ...current, [mode]: limit }))}>
                    Top {limit}
                  </ToggleChip>
                ))}
              </FilterGroup>}
              <FilterGroup label="등락 방향">
                <ToggleChip active={directions.has("up")} onClick={() => setDirections(toggleSet(directions, "up"))}>상승</ToggleChip>
                <ToggleChip active={directions.has("down")} onClick={() => setDirections(toggleSet(directions, "down"))}>하락</ToggleChip>
              </FilterGroup>
              <FilterGroup label="섹터">
                {canonicalSectorOptions.map((sector) => (
                  <ToggleChip key={sector} active={sectors.has(sector)} onClick={() => setSectors(toggleSet(sectors, sector))}>
                    {sectorLabelKo(sector)}
                  </ToggleChip>
                ))}
              </FilterGroup>
              <div className="stock-discovery-filter-group is-metrics">
                <strong>상세 지표</strong>
                <div className="stock-discovery-metric-filters">
                  {screenerMetricDefinitions.map((definition) => (
                    <MetricRangeFilter
                      key={definition.key}
                      definition={definition}
                      value={metricRanges[definition.key]}
                      onChange={(value) => setMetricRanges((current) => ({ ...current, [definition.key]: value }))}
                    />
                  ))}
                </div>
              </div>
              {activeFilterCount > 0 && (
                <button type="button" className="stock-discovery-filter-reset" onClick={() => {
                  setDirections(new Set());
                  setSectors(new Set());
                  setMetricRanges(emptyMetricRanges());
                }}><RotateCcw size={12} /> 필터 초기화</button>
              )}
            </div>
          </details>

          {(loading || error) && (
        <div className={error ? "stock-discovery-notice is-error" : "stock-discovery-notice"}>
          {loading && <LoaderCircle size={13} className="spin" />}
          <span>{error ?? "추천 점수를 불러오는 중입니다. 시장 목록은 계속 탐색할 수 있습니다."}</span>
        </div>
      )}

          <div className="stock-discovery-list">
        {visibleRows.map((row, index) => {
          const recommendation = row.recommendation;
          const reference = recommendation ? stockRecommendationReference(recommendation, sourcePanelId) : null;
          const scoreBreakdown = recommendation ? recommendationScoreBreakdown(recommendation) : [];
          const referenceKey = reference ? agentReferenceKey(reference) : "";
          const selected = mode === "recommended"
            ? Boolean(reference && selectedAgentReferenceKeys.includes(referenceKey))
            : selectedMarketSymbol === row.market.symbol;
          const emphasized = reference ? emphasizedAgentReferenceKeys.includes(referenceKey) : false;
          return (
            <div key={row.market.symbol} className={`stock-discovery-row ${selected ? "is-selected" : ""} ${emphasized ? "is-agent-reference-emphasized" : ""}`}>
              <button
                type="button"
                className={`stock-discovery-select-row ${mode === "recommended" || mode === "popular" ? "has-rank" : ""} ${mode === "recommended" ? "has-score" : ""}`}
                aria-label={`${row.market.symbol} 선택`}
                aria-pressed={selected}
                onClick={() => {
                  if (mode === "recommended" && recommendation && reference && payload) {
                    onSelectReference(reference, { item: recommendation, payload, reference });
                  } else if (mode !== "recommended") {
                    setSelectedMarketSymbol((current) => current === row.market.symbol ? null : row.market.symbol);
                  }
                }}
              >
                {(mode === "recommended" || mode === "popular") && <span className="stock-discovery-rank">{index + 1}</span>}
                <StockLogo symbol={row.market.symbol} companyName={row.market.companyName} size="xs" />
                <span className="stock-discovery-company"><strong>{row.market.symbol}</strong><span>{row.market.companyName}</span></span>
                <span className={changeClass(row.market.changePercent)}>{formatChange(row.market.changePercent)}</span>
                <span className="stock-discovery-sector">{sectorLabelKo(row.market.sector)}</span>
                {mode === "recommended" && recommendation && (
                  <span className="stock-discovery-badges">
                    <em className="is-recommended">{formatScore(effectiveRecommendationScore(recommendation))}점</em>
                    {scoreBreakdown.length > 0 && (
                      <span className="stock-discovery-score-breakdown" role="tooltip">
                        <strong>종합 {formatScore(effectiveRecommendationScore(recommendation))}점</strong>
                        {scoreBreakdown.map((part) => (
                          <span key={part.key}>
                            <span>{part.label}</span>
                            <em>{formatScore(part.score)}점</em>
                            {part.weight !== null && <i>{formatScore(part.weight)}%</i>}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {visibleRows.length === 0 && <div className="panel-empty-row">조건에 맞는 종목이 없습니다</div>}
      </div>
          {visibleCount < filteredRows.length && (
        <button type="button" className="stock-discovery-more" onClick={() => setVisibleCount((current) => current + DISCOVERY_PAGE_SIZE)}>
          더 보기
        </button>
      )}
          <LogoDevAttribution className="panel-logo-attribution" />
        </>
      ) : (
        <section className="stock-discovery-logic-page" aria-label="추천 로직 세부 가중치">
          <header><strong>추천 점수 설계</strong></header>
            <div className="stock-discovery-logic-scroll">
              <ScoreProfileManager
                onActivated={() => {
                  setActiveTab("list");
                  void refresh();
                }}
              />
            </div>
        </section>
      )}
    </section>
  );
}

export function buildDiscoveryRows(
  marketItems: readonly Sp500UniverseItem[],
  recommendationItems: readonly StockRecommendationItem[]
): DiscoveryRow[] {
  const recommendations = new Map<string, StockRecommendationItem>();
  [...recommendationItems]
    .sort((left, right) => {
      const scoreDelta = effectiveRecommendationScore(right) - effectiveRecommendationScore(left);
      return scoreDelta || left.rank - right.rank || left.symbol.localeCompare(right.symbol);
    })
    .forEach((item) => {
      const symbol = item.symbol.toUpperCase();
      if (!recommendations.has(symbol)) recommendations.set(symbol, item);
    });
  const uniqueMarketItems = Array.from(new Map(marketItems.map((item) => [item.symbol.toUpperCase(), item])).values());
  const volumeSorted = uniqueMarketItems
    .filter((item) => typeof item.sessionDollarVolume === "number" && Number.isFinite(item.sessionDollarVolume))
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const volumeDelta = finiteVolume(right.item.sessionDollarVolume) - finiteVolume(left.item.sessionDollarVolume);
      return volumeDelta || left.item.symbol.localeCompare(right.item.symbol) || left.index - right.index;
    });
  const volumeRank = new Map(volumeSorted.map(({ item }, index) => [item.symbol.toUpperCase(), index + 1]));
  return uniqueMarketItems
    .map((market) => {
      const recommendation = recommendations.get(market.symbol.toUpperCase());
      return {
        market,
        recommendation,
        volumeRank: volumeRank.get(market.symbol.toUpperCase()),
        metrics: discoveryMetrics(market, recommendation)
      };
    });
}

export function effectiveRecommendationScore(item: StockRecommendationItem): number {
  return finiteValue(item.customRankScore ?? item.score) ?? 0;
}

export type RecommendationScoreBreakdownPart = {
  key: string;
  label: string;
  score: number;
  weight: number | null;
};

const recommendationBlockOrder = [
  "trendStrength",
  "participationConfirmation",
  "priceStructure",
  "catalystQuality",
  "executionQuality",
  "qualityStability"
] as const;

export function recommendationScoreBreakdown(item: StockRecommendationItem): RecommendationScoreBreakdownPart[] {
  const metrics = recordValue(item.metricsSnapshot);
  const scores = recordValue(Object.keys(recordValue(metrics.effectiveBlockScores)).length > 0
    ? metrics.effectiveBlockScores
    : metrics.blockScores);
  const weights = recordValue(metrics.effectiveStyleWeights ?? metrics.effectiveWeights);
  const parts: RecommendationScoreBreakdownPart[] = recommendationBlockOrder.flatMap((key) => {
    const score = finiteValue(scores[key]);
    if (score === null) return [];
    return [{
      key,
      label: recommendationBlockLabels[key] ?? key,
      score,
      weight: normalizePercentWeight(finiteValue(weights[key]))
    }];
  });
  const portfolioScore = finiteValue(metrics.portfolioCompatibility ?? item.portfolioFitScore);
  if (portfolioScore !== null) {
    parts.push({
      key: "portfolioCompatibility",
      label: "포트폴리오 적합도",
      score: portfolioScore,
      weight: normalizePercentWeight(finiteValue(metrics.portfolioWeight))
    });
  }
  return parts;
}

export function filterDiscoveryRows(
  rows: readonly DiscoveryRow[],
  filters: {
    mode: DiscoveryListMode;
    query: string;
    directions: ReadonlySet<DirectionFilter>;
    sectors: ReadonlySet<string>;
    metricRanges: Readonly<Record<ScreenerMetricKey, NumericRange>>;
    limit: number;
  }
): DiscoveryRow[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("ko-KR");
  const filtered = rows
    .filter((row) => {
      if (filters.mode === "recommended" && !row.recommendation) return false;
      if (filters.mode === "popular" && !(row.volumeRank && row.volumeRank <= 15)) return false;
      if (filters.mode === "gainers" && !(typeof row.market.changePercent === "number" && row.market.changePercent > 0)) return false;
      if ((filters.mode === "volume" || filters.mode === "popular") && finiteVolume(row.market.sessionDollarVolume) === Number.NEGATIVE_INFINITY) return false;
      const sector = normalizeSector(row.market.sector);
      const searchText = [
        row.market.symbol,
        row.market.companyName,
        row.market.industry,
        sector,
        sectorLabelKo(sector)
      ].join(" ").toLocaleLowerCase("ko-KR");
      if (normalizedQuery && !searchText.includes(normalizedQuery)) return false;
      if (filters.directions.size > 0) {
        const change = row.market.changePercent;
        const directionMatch = (filters.directions.has("up") && typeof change === "number" && change > 0)
          || (filters.directions.has("down") && typeof change === "number" && change < 0);
        if (!directionMatch) return false;
      }
      if (filters.sectors.size > 0 && !filters.sectors.has(sector)) return false;
      return screenerMetricDefinitions.every(({ key }) => metricInRange(row.metrics[key], filters.metricRanges[key]));
    })
    .sort((left, right) => {
      if (filters.mode === "recommended") {
        return effectiveRecommendationScore(right.recommendation!) - effectiveRecommendationScore(left.recommendation!)
          || left.market.symbol.localeCompare(right.market.symbol);
      }
      if (filters.mode === "gainers") {
        return finiteValue(right.market.changePercent)! - finiteValue(left.market.changePercent)!
          || left.market.symbol.localeCompare(right.market.symbol);
      }
      if (filters.mode === "all") return left.market.symbol.localeCompare(right.market.symbol);
      return finiteVolume(right.market.sessionDollarVolume) - finiteVolume(left.market.sessionDollarVolume)
        || left.market.symbol.localeCompare(right.market.symbol);
    });
  if (filters.mode === "recommended" || filters.mode === "all") return filtered;
  if (filters.mode === "popular") return filtered.slice(0, 15);
  return filtered.slice(0, Math.max(0, filters.limit));
}

export function discoveryPage(rows: readonly DiscoveryRow[], visibleCount = DISCOVERY_PAGE_SIZE): DiscoveryRow[] {
  return rows.slice(0, Math.max(0, visibleCount));
}

function toggleSet<T>(source: Set<T>, value: T): Set<T> {
  const next = new Set(source);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="stock-discovery-filter-group"><strong>{label}</strong><div>{children}</div></div>;
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function MetricRangeFilter({ definition, value, onChange }: {
  definition: (typeof screenerMetricDefinitions)[number];
  value: NumericRange;
  onChange: (value: NumericRange) => void;
}) {
  return (
    <label className={rangeActive(value) ? "stock-discovery-metric-filter is-active" : "stock-discovery-metric-filter"}>
      <strong>{definition.label}</strong>
      <span>
        <input type="number" step={definition.step} value={value.min} placeholder="최소" aria-label={`${definition.label} 최소`} onChange={(event) => onChange({ ...value, min: event.target.value })} />
        <i>~</i>
        <input type="number" step={definition.step} value={value.max} placeholder="최대" aria-label={`${definition.label} 최대`} onChange={(event) => onChange({ ...value, max: event.target.value })} />
        {definition.unit && <em>{definition.unit}</em>}
      </span>
    </label>
  );
}

export function emptyMetricRanges(): Record<ScreenerMetricKey, NumericRange> {
  return Object.fromEntries(screenerMetricDefinitions.map(({ key }) => [key, { min: "", max: "" }])) as Record<ScreenerMetricKey, NumericRange>;
}

function discoveryMetrics(market: Sp500UniverseItem, recommendation?: StockRecommendationItem): Record<ScreenerMetricKey, number | null> {
  const raw = recordValue(recommendation?.metricsSnapshot?.rawFactors);
  const price = finiteValue(market.lastPrice);
  const eps = finiteValue(market.eps);
  const equity = finiteValue(market.totalEquity);
  const assets = finiteValue(market.totalAssets);
  const liabilities = finiteValue(market.totalLiabilities);
  const revenue = finiteValue(market.revenue);
  const operatingIncome = finiteValue(market.operatingIncome);
  const netIncome = finiteValue(market.netIncome);
  const freeCashFlow = finiteValue(market.freeCashFlow);
  return {
    rsi14: finiteValue(market.rsi14) ?? finiteValue(raw.rsi14),
    peRatio: price !== null && eps !== null && eps !== 0 ? price / eps : null,
    pbRatio: equity !== null && equity > 0 ? market.marketCap / equity : null,
    roePct: netIncome !== null && equity !== null && equity !== 0
      ? netIncome / equity * 100
      : null,
    debtRatioPct: liabilities !== null && assets !== null && assets > 0 ? liabilities / assets * 100 : null,
    operatingMarginPct: operatingIncome !== null && revenue !== null && revenue !== 0 ? operatingIncome / revenue * 100 : null,
    freeCashFlowMarginPct: freeCashFlow !== null && revenue !== null && revenue !== 0 ? freeCashFlow / revenue * 100 : null,
    dollarVolumeMillion: finiteValue(market.sessionDollarVolume) !== null ? market.sessionDollarVolume! / 1_000_000 : null,
    recommendationScore: finiteValue(recommendation?.customRankScore ?? recommendation?.score)
  };
}

function metricInRange(value: number | null, range: NumericRange): boolean {
  if (!rangeActive(range)) return true;
  if (value === null || !Number.isFinite(value)) return false;
  const minimum = range.min === "" ? null : Number(range.min);
  const maximum = range.max === "" ? null : Number(range.max);
  if (minimum !== null && (!Number.isFinite(minimum) || value < minimum)) return false;
  if (maximum !== null && (!Number.isFinite(maximum) || value > maximum)) return false;
  return true;
}

function rangeActive(range: NumericRange): boolean {
  return range.min.trim() !== "" || range.max.trim() !== "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePercentWeight(value: number | null): number | null {
  if (value === null) return null;
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function finiteVolume(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function formatChange(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function changeClass(value: number | null | undefined) {
  return `stock-discovery-change ${typeof value === "number" && value > 0 ? "up" : typeof value === "number" && value < 0 ? "down" : "flat"}`;
}
