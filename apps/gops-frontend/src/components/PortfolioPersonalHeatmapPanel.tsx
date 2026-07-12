import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildOntologyGraphFromEvidence } from "../ontology/buildOntologyGraphFromEvidence";
import { requestOntologyReport } from "../ontology/ontologyReportClient";
import type { AgentEvidenceItem, OntologyGraphData } from "../ontology/ontologyTypes";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { sp500UniverseSeed } from "../market/sp500Universe.seed";
import { TreeMapCanvas } from "../treemap/TreeMapCanvas";
import {
  selectPortfolioHoldingSymbol,
  usePortfolioHoldingsData,
  usePortfolioSelectedSymbol
} from "./PortfolioHoldingsPanel";
import type { PortfolioPosition } from "./portfolioHoldingsApi";

type PersonalHeatmapView = "holdings" | "relations";
type RelationCandidate = {
  symbol: string;
  score: number;
  relation: string;
};

const RELATION_TILE_LIMIT = 13;
const relationEvidenceCache = new Map<string, AgentEvidenceItem[]>();

export function PortfolioPersonalHeatmapPanel({
  symbol,
  marketItems,
  onSelectSymbol
}: {
  symbol: string;
  marketItems: Sp500UniverseItem[];
  onSelectSymbol: (symbol: string) => void;
}) {
  const { loading, error, positions } = usePortfolioHoldingsData();
  const portfolioSelection = usePortfolioSelectedSymbol();
  const selectedPortfolioSymbol = portfolioSelection.symbol;
  const normalizedPageSymbol = symbol.trim().toUpperCase();
  const [view, setView] = useState<PersonalHeatmapView>("holdings");
  const [anchorSymbol, setAnchorSymbol] = useState(normalizedPageSymbol);
  const [relationEvidence, setRelationEvidence] = useState<AgentEvidenceItem[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const previousPageSymbol = useRef(normalizedPageSymbol);
  const universe = useMemo(
    () => mergeMarketUniverse(marketItems, sp500UniverseSeed),
    [marketItems]
  );

  useEffect(() => {
    if (positions.length === 0) return;
    if (!positions.some((position) => position.symbol.toUpperCase() === anchorSymbol)) {
      setAnchorSymbol(positions[0]?.symbol.toUpperCase() ?? normalizedPageSymbol);
    }
  }, [anchorSymbol, normalizedPageSymbol, positions]);

  useEffect(() => {
    const previous = previousPageSymbol.current;
    previousPageSymbol.current = normalizedPageSymbol;
    if (previous === normalizedPageSymbol) return;
    if (positions.some((position) => position.symbol.toUpperCase() === normalizedPageSymbol)) {
      setAnchorSymbol(normalizedPageSymbol);
      setView("relations");
    }
  }, [normalizedPageSymbol, positions]);

  useEffect(() => {
    if (!selectedPortfolioSymbol) return;
    if (!positions.some((position) => position.symbol.toUpperCase() === selectedPortfolioSymbol)) return;
    setAnchorSymbol(selectedPortfolioSymbol);
    setView("relations");
  }, [portfolioSelection.revision, positions, selectedPortfolioSymbol]);

  useEffect(() => {
    if (view !== "relations" || !anchorSymbol) return;
    const cached = relationEvidenceCache.get(anchorSymbol);
    if (cached) {
      setRelationEvidence(cached);
      setRelationsLoading(false);
      return;
    }

    const controller = new AbortController();
    setRelationsLoading(true);
    requestOntologyReport({ symbol: anchorSymbol }, controller.signal)
      .then((report) => {
        if (controller.signal.aborted) return;
        const evidence = report?.providerEvidence ?? [];
        relationEvidenceCache.set(anchorSymbol, evidence);
        setRelationEvidence(evidence);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRelationEvidence([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRelationsLoading(false);
      });
    return () => controller.abort();
  }, [anchorSymbol, view]);

  const marketIndex = useMemo(
    () => new Map(universe.map((item) => [item.symbol.toUpperCase(), item])),
    [universe]
  );
  const holdingItems = useMemo(
    () => buildHoldingHeatmapItems(positions, marketIndex),
    [marketIndex, positions]
  );
  const relationGraph = useMemo(
    () => buildOntologyGraphFromEvidence(relationEvidence, anchorSymbol),
    [anchorSymbol, relationEvidence]
  );
  const relationItems = useMemo(
    () => buildRelationHeatmapItems(anchorSymbol, relationGraph, universe, marketIndex),
    [anchorSymbol, marketIndex, relationGraph, universe]
  );
  const items = view === "holdings" ? holdingItems : relationItems;
  const showPreviousPage = () => setView("holdings");
  const showNextPage = () => setView("relations");

  const selectSymbol = (nextSymbol: string) => {
    const normalized = nextSymbol.toUpperCase();
    selectPortfolioHoldingSymbol(normalized);
    setAnchorSymbol(normalized);
    if (view === "holdings") setView("relations");
    onSelectSymbol(normalized);
  };

  const statusMessage = loading
    ? "보유 종목을 불러오는 중입니다"
    : error || (positions.length === 0 ? "표시할 보유 종목이 없습니다" : "");

  return (
    <section className="portfolio-personal-heatmap-panel" aria-label="나만의 히트맵">
      <div className="portfolio-personal-heatmap-stage" key={`${view}-${anchorSymbol}`}>
        {statusMessage ? (
          <div className="portfolio-personal-heatmap-empty">{statusMessage}</div>
        ) : (
          <TreeMapCanvas
            items={items}
            highlightedSymbol={view === "relations" ? anchorSymbol : undefined}
            ariaLabel={view === "holdings" ? "보유 종목 평가금 히트맵" : `${anchorSymbol} 관계 기업 트리맵`}
            onSelectSymbol={selectSymbol}
          />
        )}
        {relationsLoading && view === "relations" ? (
          <span className="portfolio-personal-heatmap-loading" title="온톨로지 관계 보강 중">
            <LoaderCircle size={14} className="is-spinning" />
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="portfolio-personal-heatmap-arrow is-left"
        aria-label="보유 종목 히트맵 보기"
        disabled={view === "holdings"}
        onClick={showPreviousPage}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="portfolio-personal-heatmap-arrow is-right"
        aria-label="관계 기업 히트맵 보기"
        disabled={view === "relations"}
        onClick={showNextPage}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <div className="portfolio-personal-heatmap-pages" role="tablist" aria-label="히트맵 페이지">
        <button
          type="button"
          role="tab"
          aria-label="보유 종목"
          aria-selected={view === "holdings"}
          className={view === "holdings" ? "active" : undefined}
          onClick={showPreviousPage}
        />
        <button
          type="button"
          role="tab"
          aria-label="관계 기업"
          aria-selected={view === "relations"}
          className={view === "relations" ? "active" : undefined}
          onClick={showNextPage}
        />
      </div>
    </section>
  );
}

function buildHoldingHeatmapItems(
  positions: PortfolioPosition[],
  marketIndex: Map<string, Sp500UniverseItem>
): Sp500UniverseItem[] {
  return positions.map((position) => {
    const symbol = position.symbol.toUpperCase();
    const market = marketIndex.get(symbol);
    const marketValue = positiveNumber(
      position.marketValueForeign,
      (position.currentPrice ?? 0) * (position.quantity ?? 0),
      1
    );
    return {
      ...(market ?? baseMarketItem(symbol, position.name)),
      symbol,
      companyName: position.name || market?.companyName || symbol,
      sector: position.sector || market?.sector || "Unclassified",
      sectorLabelKo: position.sectorLabelKo || market?.sectorLabelKo || "미분류",
      industry: position.industry || market?.industry || "보유 종목",
      marketCap: positiveNumber(market?.marketCap, marketValue),
      layoutMarketCap: marketValue,
      indexWeight: undefined,
      lastPrice: position.currentPrice ?? market?.lastPrice,
      changePercent: finiteNumber(position.dayPnlRate, market?.changePercent, 0)
    };
  });
}

function mergeMarketUniverse(
  liveItems: Sp500UniverseItem[],
  fallbackItems: Sp500UniverseItem[]
): Sp500UniverseItem[] {
  const itemsBySymbol = new Map(
    fallbackItems.map((item) => [item.symbol.toUpperCase(), item])
  );
  liveItems.forEach((item) => {
    const symbol = item.symbol.toUpperCase();
    itemsBySymbol.set(symbol, {
      ...itemsBySymbol.get(symbol),
      ...item,
      symbol
    });
  });
  return [...itemsBySymbol.values()];
}

function buildRelationHeatmapItems(
  anchorSymbol: string,
  graph: OntologyGraphData | null,
  universe: Sp500UniverseItem[],
  marketIndex: Map<string, Sp500UniverseItem>
): Sp500UniverseItem[] {
  const anchor = marketIndex.get(anchorSymbol) ?? baseMarketItem(anchorSymbol, anchorSymbol);
  const candidates = new Map<string, RelationCandidate>();
  const add = (symbol: string, score: number, relation: string) => {
    const normalized = symbol.toUpperCase();
    if (normalized === anchorSymbol || !marketIndex.has(normalized)) return;
    const current = candidates.get(normalized);
    if (!current || score > current.score) {
      candidates.set(normalized, { symbol: normalized, score, relation });
    }
  };

  if (graph) {
    relationCandidatesFromGraph(graph, anchorSymbol).forEach((candidate) => {
      add(candidate.symbol, candidate.score, candidate.relation);
    });
  }

  const byMarketCap = [...universe].sort((left, right) => right.marketCap - left.marketCap);
  byMarketCap.forEach((item) => {
    if (item.symbol.toUpperCase() === anchorSymbol) return;
    if (item.industry === anchor.industry) add(item.symbol, 0.72, "동일 산업");
  });
  byMarketCap.forEach((item) => {
    if (item.symbol.toUpperCase() === anchorSymbol) return;
    if (item.sector === anchor.sector) add(item.symbol, 0.52, "동일 섹터");
  });
  byMarketCap.forEach((item) => add(item.symbol, 0.28, "시장 연관"));

  const related = [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
    .slice(0, RELATION_TILE_LIMIT - 1);
  const entries: RelationCandidate[] = [
    { symbol: anchorSymbol, score: 1.16, relation: "선택 기업" },
    ...related
  ];

  return entries.map((entry) => {
    const item = marketIndex.get(entry.symbol) ?? (entry.symbol === anchorSymbol ? anchor : baseMarketItem(entry.symbol, entry.symbol));
    return {
      ...item,
      sector: "Related Companies",
      sectorLabelKo: "관계 기업",
      industry: entry.relation,
      marketCap: positiveNumber(item.marketCap, 1),
      layoutMarketCap: Math.max(0.12, entry.score) * 1_000_000_000_000,
      indexWeight: undefined
    };
  });
}

function relationCandidatesFromGraph(graph: OntologyGraphData, anchorSymbol: string): RelationCandidate[] {
  const anchorId = `symbol:${anchorSymbol}`;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, RelationCandidate>();
  const add = (symbol: string, score: number, relation: string) => {
    const normalized = symbol.toUpperCase();
    const current = candidates.get(normalized);
    if (normalized !== anchorSymbol && (!current || score > current.score)) {
      candidates.set(normalized, { symbol: normalized, score, relation });
    }
  };

  const anchorThemeEdges = graph.edges.filter((edge) => (
    (edge.source === anchorId && nodeById.get(edge.target)?.kind === "theme") ||
    (edge.target === anchorId && nodeById.get(edge.source)?.kind === "theme")
  ));

  graph.edges.forEach((edge) => {
    if (edge.source !== anchorId && edge.target !== anchorId) return;
    const otherId = edge.source === anchorId ? edge.target : edge.source;
    const other = nodeById.get(otherId);
    if (other?.kind === "symbol") {
      add(other.label, edge.relationScore ?? 0.9, edge.label || "직접 관계");
    }
  });

  anchorThemeEdges.forEach((anchorEdge) => {
    const themeId = anchorEdge.source === anchorId ? anchorEdge.target : anchorEdge.source;
    const theme = nodeById.get(themeId)?.label || "공유 테마";
    graph.edges.forEach((edge) => {
      if (edge.source !== themeId && edge.target !== themeId) return;
      const otherId = edge.source === themeId ? edge.target : edge.source;
      const other = nodeById.get(otherId);
      if (other?.kind === "symbol") {
        const score = Math.min(anchorEdge.relationScore ?? 0.72, edge.relationScore ?? 0.66);
        add(other.label, score, `테마 · ${theme}`);
      }
    });
  });

  return [...candidates.values()];
}

function baseMarketItem(symbol: string, companyName = symbol): Sp500UniverseItem {
  return {
    symbol,
    companyName: companyName || symbol,
    sector: "Unclassified",
    sectorLabelKo: "미분류",
    industry: "Unclassified",
    marketCap: 1,
    changePercent: 0
  };
}

function finiteNumber(...values: Array<number | null | undefined>): number {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? 0;
}

function positiveNumber(...values: Array<number | null | undefined>): number {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 1;
}
