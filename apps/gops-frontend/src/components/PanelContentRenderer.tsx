import type { ChartDataStatus, ChartDocument, ChartRuntimeAction, StreamStatus, TradeTickData } from "@gops/chart-engine";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import type { AgentReference } from "../agent/agentReferences";
import { rememberChartCommentaryState } from "../agent/chartCommentaryHistory";
import type { OrderFlowResolutionSelection, OrderFlowWindow } from "../chart/orderFlow";
import type { AnalysisAssetInterval } from "../chart/analysisAssetsApi";
import type { ChartPriceSelection } from "../chart/chartTradeAutomation";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import {
  bidAskChartIntervals,
  chartIntervals,
  chartTypes,
  defaultBidAskInterval,
  isBidAskChartInterval,
  type CandleDto,
  type ChartCompareRange,
  type ChartInterval,
  type ChartSymbolDto,
  type ChartType
} from "../chart/types";
import type { PanelContentInstance, PanelSlot } from "../layout/panelLayout";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { OntologyPanel } from "../ontology/OntologyPanel";
import {
  StockRecommendationsPanel,
  type StockRecommendationSelection
} from "../recommendations/StockRecommendationsPanel";
import { StockRecommendationExplainPanel } from "../recommendations/StockRecommendationExplainPanel";
import { ChartPanel, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import { ChartToolbarSelect, type ChartToolbarSelectOption } from "./ChartToolbarSelect";
import { ChartComparisonPanel } from "./ChartComparisonPanel";
import type { CoachReport } from "./ai-coach/types";
import {
  CompanyInfoPanel,
  CompanyMultiPanel,
  CompanyProfitabilityPanel,
  CompanyStabilityPanel,
  CompanyValuationPanel
} from "./CompanySummaryPanel";
import { IndexWidgetPanel } from "./IndexWidgetPanel";
import { OrderFlowPanel } from "./OrderFlowPanel";
import { PopularStocksPanel } from "./PopularStocksPanel";
import {
  PortfolioDividendPanel,
  PortfolioDiversificationPanel,
  PortfolioHoldingsFlatCardsPanel,
  PortfolioHoldingsOnlyPanel,
  PortfolioInvestedPanel,
  PortfolioInvestmentStatusPanel,
  PortfolioMultiPanel,
  PortfolioPerformancePanel
} from "./PortfolioHoldingsPanel";
import { PortfolioPersonalHeatmapPanel } from "./PortfolioPersonalHeatmapPanel";
import { SymbolSearch } from "./SymbolSearch";
import { ThemeRadarPanel } from "./ThemeRadarPanel";

const AiInvestmentCoachPanel = lazy(() => import("./AiInvestmentCoachPanel").then((module) => ({
  default: module.AiInvestmentCoachPanel
})));
const CompanyJournalPanel = lazy(() => import("./CompanyJournalPanel").then((module) => ({
  default: module.CompanyJournalPanel
})));
const PaperAccountPanel = lazy(() => import("./PaperAccountPanel").then((module) => ({
  default: module.PaperAccountPanel
})));
const PriceConditionPanel = lazy(() => import("./PriceConditionPanel").then((module) => ({
  default: module.PriceConditionPanel
})));
const ChartCommentaryPanel = lazy(() => import("./ChartCommentaryPanel").then((module) => ({
  default: module.ChartCommentaryPanel
})));
const ChartAssetOpsPanel = lazy(() => import("./ChartAssetOpsPanel").then((module) => ({
  default: module.ChartAssetOpsPanel
})));
const ChartPatternListPanel = lazy(() => import("./ChartPatternListPanel").then((module) => ({
  default: module.ChartPatternListPanel
})));
const NewsPanel = lazy(() => import("./NewsPanel").then((module) => ({
  default: module.NewsPanel
})));
const WatchlistNewsPanel = lazy(() => import("./WatchlistNewsPanel").then((module) => ({
  default: module.WatchlistNewsPanel
})));
const OrderTicket = lazy(() => import("./OrderTicket").then((module) => ({
  default: module.OrderTicket
})));
const QuickOrderPanel = lazy(() => import("./QuickOrderPanel").then((module) => ({
  default: module.QuickOrderPanel
})));
const CompanyComparePanel = lazy(() => import("../companyCompare/CompanyComparePanel").then((module) => ({
  default: module.CompanyComparePanel
})));

type PanelContentRendererProps = {
  slot: PanelSlot;
  content: PanelContentInstance;
  symbol: string;
  symbols: ChartSymbolDto[];
  companyItem?: Sp500UniverseItem;
  companyItems: Sp500UniverseItem[];
  marketItems: Sp500UniverseItem[];
  laneHeight: number;
  effectiveColSpan?: number;
  effectiveRowSpan?: number;
  layoutResizeSuspended?: boolean;
  chartHeaderSnapshot?: ChartHeaderSnapshot;
  chartDocument?: ChartDocument;
  chartCandles: CandleDto[];
  activeChartDocument?: ChartDocument;
  activeChartCandles: CandleDto[];
  chartDataStatus?: ChartDataStatus;
  chartStreamStatus?: StreamStatus;
  chartStreamMessage?: string;
  chartLiveTrade?: TradeTickData;
  chartDataResetRevision: number;
  chartAddActive: boolean;
  selectedAgentReferenceKeys: string[];
  emphasizedAgentReferenceKeys: string[];
  emphasizeChartSelection: boolean;
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentReferenceSelect: (reference: AgentReference) => void;
  onAgentAsk: () => void;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartHoverChange: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
  onChartHandleChange: (contentId: string, handle: ChartPanelHandle | null) => void;
  onChartAddToggle: () => void;
  onUpdatePanelProps: (contentId: string, props: Record<string, unknown>) => void;
  onChangePanelChartSymbol: (contentId: string, symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  selectedRecommendationSymbol: string | null;
  selectedRecommendation: StockRecommendationSelection | null;
  onSelectRecommendationReference: (
    reference: AgentReference | null,
    selection?: StockRecommendationSelection | null,
    replaceExisting?: boolean
  ) => void;
  onOpenCompany: (symbol: string) => void;
  onSelectPatternAsset: (symbol: string, interval: AnalysisAssetInterval) => void;
  chartLinkOptions: Array<{ chartDocumentId: string; symbol: string; interval: string }>;
  chartSelectionActive: boolean;
  orderPriceSelection: ChartPriceSelection | null;
  onChartPriceSelection: (selection: ChartPriceSelection) => void;
  onChartSelectionToggle: (contentId: string) => void;
  onCommentaryChartChange: (contentId: string, chartDocumentId: string) => void;
};

export function PanelContentRenderer({
  slot,
  content,
  symbol,
  symbols,
  companyItem,
  companyItems,
  marketItems,
  laneHeight,
  effectiveColSpan,
  effectiveRowSpan,
  layoutResizeSuspended = false,
  chartHeaderSnapshot,
  chartDocument,
  chartCandles,
  activeChartDocument,
  activeChartCandles,
  chartDataStatus,
  chartStreamStatus,
  chartStreamMessage,
  chartLiveTrade,
  chartDataResetRevision,
  chartAddActive,
  selectedAgentReferenceKeys,
  emphasizedAgentReferenceKeys,
  emphasizeChartSelection,
  setSemanticSelection,
  onAgentReferenceSelect,
  onAgentAsk,
  onChartRuntimeAction,
  onChartHoverChange,
  onHeaderChange,
  onChartHandleChange,
  onChartAddToggle,
  onUpdatePanelProps,
  onChangePanelChartSymbol,
  onSelectSymbol,
  selectedRecommendationSymbol,
  selectedRecommendation,
  onSelectRecommendationReference,
  onOpenCompany,
  onSelectPatternAsset,
  chartLinkOptions,
  chartSelectionActive,
  orderPriceSelection,
  onChartPriceSelection,
  onChartSelectionToggle,
  onCommentaryChartChange
}: PanelContentRendererProps) {
  const chartPanelHandleRef = useRef<ChartPanelHandle | null>(null);
  const [activeTab, setActiveTab] = useState<"chart" | "company">(
    content.kind === "chart" && content.props?.view === "company" ? "company" : "chart"
  );
  const [openChartDropdown, setOpenChartDropdown] = useState<"chart-type" | "interval" | null>(null);
  const setChartPanelHandle = useCallback((handle: ChartPanelHandle | null) => {
    chartPanelHandleRef.current = handle;
    onChartHandleChange(content.id, handle);
  }, [content.id, onChartHandleChange]);

  useEffect(() => {
    if (content.kind === "chart") {
      setActiveTab(content.props?.view === "company" ? "company" : "chart");
    }
  }, [content.kind, content.props?.view]);

  const activeChartDrawingIds = useMemo(
    () => (activeChartDocument?.drawings ?? []).map((drawing) => drawing.id),
    [activeChartDocument?.drawings]
  );

  if (content.kind === "company") {
    return <CompanyInfoPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
  }

  if (content.kind === "companyJournal") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">AI 기업저널을 불러오는 중입니다</div>}>
        <CompanyJournalPanel
          symbol={symbol.toUpperCase()}
          item={companyItem}
          items={companyItems}
          sourcePanelId={content.id}
          selectedAgentReferenceKeys={selectedAgentReferenceKeys}
          emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
          onAgentReferenceSelect={onAgentReferenceSelect}
          onAgentAsk={onAgentAsk}
        />
      </Suspense>
    );
  }

  if (content.kind === "companyMulti") {
    return <CompanyMultiPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
  }

  if (content.kind === "companyValuation") {
    return <CompanyValuationPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
  }

  if (content.kind === "companyProfitability") {
    return <CompanyProfitabilityPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
  }

  if (content.kind === "companyStability") {
    return <CompanyStabilityPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
  }

  if (content.kind === "compare") {
    const baseSymbol = readCompareBaseSymbol(content, symbol);
    const comparisonSymbols = readCompareSymbols(content, baseSymbol);
    const range = readCompareRange(content);
    return (
      <ChartComparisonPanel
        symbol={baseSymbol}
        comparisonSymbols={comparisonSymbols}
        symbols={symbols}
        range={range}
        onRangeChange={(nextRange) => onUpdatePanelProps(content.id, { range: nextRange })}
        onAddSymbol={(nextSymbol) => onUpdatePanelProps(content.id, {
          symbols: normalizeCompareSymbols([baseSymbol, ...comparisonSymbols, nextSymbol])
        })}
        onRemoveSymbol={(nextSymbol) => onUpdatePanelProps(content.id, {
          symbols: normalizeCompareSymbols([baseSymbol, ...comparisonSymbols.filter((item) => item.toUpperCase() !== nextSymbol.toUpperCase())])
        })}
      />
    );
  }

  if (content.kind === "companyCompare") {
    const baseSymbol = readCompanyCompareBaseSymbol(content, symbol);
    const compareSymbols = readCompanyCompareSymbols(content, baseSymbol);
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">기업 비교 패널을 불러오는 중입니다</div>}>
        <CompanyComparePanel
          baseSymbol={baseSymbol}
          compareSymbols={compareSymbols}
          symbols={symbols}
          onCompareSymbolsChange={(nextSymbols) => onUpdatePanelProps(content.id, { compareSymbols: nextSymbols })}
        />
      </Suspense>
    );
  }

  if (content.kind === "news") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">뉴스를 불러오는 중입니다</div>}>
        <NewsPanel
          symbol={symbol.toUpperCase()}
          initialPayload={content.props}
          sourcePanelId={content.id}
          selectedAgentReferenceKeys={selectedAgentReferenceKeys}
          emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
          onAgentReferenceSelect={onAgentReferenceSelect}
          onAgentAsk={onAgentAsk}
          variant="flip"
        />
      </Suspense>
    );
  }

  if (content.kind === "newsList") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">뉴스 목록을 불러오는 중입니다</div>}>
        <NewsPanel
          symbol={symbol.toUpperCase()}
          initialPayload={content.props}
          sourcePanelId={content.id}
          selectedAgentReferenceKeys={selectedAgentReferenceKeys}
          emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
          onAgentReferenceSelect={onAgentReferenceSelect}
          onAgentAsk={onAgentAsk}
          variant="list"
        />
      </Suspense>
    );
  }

  if (content.kind === "watchlistNews") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">관심 종목 뉴스를 불러오는 중입니다</div>}>
        <WatchlistNewsPanel
          sourcePanelId={content.id}
          selectedAgentReferenceKeys={selectedAgentReferenceKeys}
          emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
          onAgentReferenceSelect={onAgentReferenceSelect}
          onAgentAsk={onAgentAsk}
          variant="flip"
        />
      </Suspense>
    );
  }

  if (content.kind === "watchlistNewsList") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">관심 종목 뉴스 목록을 불러오는 중입니다</div>}>
        <WatchlistNewsPanel
          sourcePanelId={content.id}
          selectedAgentReferenceKeys={selectedAgentReferenceKeys}
          emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
          onAgentReferenceSelect={onAgentReferenceSelect}
          onAgentAsk={onAgentAsk}
          variant="list"
        />
      </Suspense>
    );
  }

  if (content.kind === "indices") {
    return (
      <IndexWidgetPanel
        cols={effectiveColSpan ?? slot.gridRect.colSpan}
        rows={effectiveRowSpan ?? slot.gridRect.rowSpan}
        suspended={layoutResizeSuspended}
      />
    );
  }

  if (content.kind === "popular") {
    return <PopularStocksPanel items={marketItems} onSelectSymbol={onSelectSymbol} />;
  }

  if (content.kind === "recommendations") {
    return (
      <StockRecommendationsPanel
        activeSymbol={symbol.toUpperCase()}
        sourcePanelId={content.id}
        selectedSymbol={selectedRecommendationSymbol}
        selectedRecommendation={selectedRecommendation}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
        onSelectReference={onSelectRecommendationReference}
        initialSessionMode={recommendationSessionMode(content.props?.initialSessionMode)}
      />
    );
  }

  if (content.kind === "recommendationsList") {
    return (
      <StockRecommendationsPanel
        activeSymbol={symbol.toUpperCase()}
        sourcePanelId={content.id}
        selectedSymbol={selectedRecommendationSymbol}
        selectedRecommendation={selectedRecommendation}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
        onSelectReference={onSelectRecommendationReference}
        initialSessionMode={recommendationSessionMode(content.props?.initialSessionMode)}
        variant="list"
      />
    );
  }

  if (content.kind === "recommendationExplain") {
    return (
      <StockRecommendationExplainPanel
        preferredSymbol={selectedRecommendationSymbol ?? symbol.toUpperCase()}
        selection={selectedRecommendation}
      />
    );
  }

  if (content.kind === "themeRadar") {
    return <ThemeRadarPanel items={marketItems} activeSymbol={symbol.toUpperCase()} onSelectSymbol={onSelectSymbol} />;
  }

  if (content.kind === "ontology") {
    return <OntologyPanel symbol={symbol} onSelectSymbol={onSelectSymbol} />;
  }

  if (content.kind === "portfolio") {
    return (
      <PortfolioHoldingsOnlyPanel
        onSelectSymbol={(nextSymbol) => {
          onSelectSymbol(nextSymbol);
          return true;
        }}
      />
    );
  }

  if (content.kind === "portfolioInvestment") {
    return <PortfolioInvestmentStatusPanel />;
  }

  if (content.kind === "portfolioMulti") {
    return <PortfolioMultiPanel />;
  }

  if (content.kind === "portfolioPerformance") {
    return <PortfolioPerformancePanel />;
  }

  if (content.kind === "portfolioInvested") {
    return <PortfolioInvestedPanel initialView={content.props?.initialFlowView === "dividend" ? "dividend" : "invested"} />;
  }

  if (content.kind === "portfolioDividend") {
    return <PortfolioDividendPanel />;
  }

  if (content.kind === "portfolioDiversification") {
    return <PortfolioDiversificationPanel />;
  }

  if (content.kind === "portfolioHeatmap") {
    return (
      <PortfolioPersonalHeatmapPanel
        symbol={symbol}
        marketItems={marketItems}
        onSelectSymbol={onSelectSymbol}
      />
    );
  }

  if (content.kind === "portfolioHoldings") {
    return (
      <PortfolioHoldingsOnlyPanel
        onSelectSymbol={(nextSymbol) => {
          onSelectSymbol(nextSymbol);
          return true;
        }}
      />
    );
  }

  if (content.kind === "portfolioHoldingsFlatCards") {
    return (
      <PortfolioHoldingsFlatCardsPanel
        onSelectSymbol={(nextSymbol) => {
          onSelectSymbol(nextSymbol);
          return true;
        }}
      />
    );
  }

  if (content.kind === "orderFlow") {
    return (
      <OrderFlowPanel
        panelId={slot.id}
        symbol={readOrderFlowSymbol(content)}
        savedWindow={readOrderFlowWindow(content)}
        savedResolution={readOrderFlowResolution(content)}
        onSymbolChange={(nextSymbol) => onUpdatePanelProps(content.id, { symbol: nextSymbol })}
        onWindowChange={(nextWindow) => onUpdatePanelProps(content.id, { window: nextWindow })}
        onResolutionChange={(nextResolution) => onUpdatePanelProps(content.id, { resolution: nextResolution })}
      />
    );
  }

  if (content.kind === "aiCoach") {
    const coachReport = content.props?.coachReport;
    return <Suspense fallback={<div className="workspace-panel-placeholder" role="status">AI 투자 코치를 불러오는 중입니다</div>}>
      <AiInvestmentCoachPanel report={coachReport && typeof coachReport === "object" ? coachReport as CoachReport : null} />
    </Suspense>;
  }

  if (content.kind === "priceCondition") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">알림과 관심 기업을 불러오는 중입니다</div>}>
        <PriceConditionPanel
          view="settings"
          defaultSymbol={symbol.toUpperCase()}
          symbols={symbols}
          marketItems={marketItems}
          onOpenCompany={onOpenCompany}
        />
      </Suspense>
    );
  }

  if (content.kind === "quickOrder") {
    const watchlistSymbols = symbolsToWatchlistSymbols(symbols);
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">빠른 주문을 불러오는 중입니다</div>}>
        <QuickOrderPanel
          symbol={readQuickOrderSymbol(content, symbol)}
          savedQty={readQuickOrderQty(content)}
          symbolOptions={watchlistSymbols}
          onSymbolChange={(nextSymbol) => onUpdatePanelProps(content.id, { symbol: nextSymbol })}
          onQtyChange={(qty) => onUpdatePanelProps(content.id, { qty })}
          chartPriceSelection={orderPriceSelection}
        />
      </Suspense>
    );
  }

  if (content.kind === "paperQuickOrder") {
    const watchlistSymbols = symbolsToWatchlistSymbols(symbols);
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">가상 빠른 주문을 불러오는 중입니다</div>}>
        <QuickOrderPanel
          executionMode="paper"
          symbol={readQuickOrderSymbol(content, symbol)}
          savedQty={readQuickOrderQty(content)}
          symbolOptions={watchlistSymbols}
          onSymbolChange={(nextSymbol) => onUpdatePanelProps(content.id, { symbol: nextSymbol })}
          onQtyChange={(qty) => onUpdatePanelProps(content.id, { qty })}
          chartPriceSelection={orderPriceSelection}
        />
      </Suspense>
    );
  }

  if (content.kind === "trade") {
    const watchlistSymbols = symbolsToWatchlistSymbols(symbols);
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">주문 패널을 불러오는 중입니다</div>}>
        <OrderTicket
          activeSymbol={symbol.toUpperCase()}
          chartSymbols={watchlistSymbols}
          symbolOptions={watchlistSymbols}
          onSymbolOptionsRequest={() => undefined}
          chartPriceSelection={orderPriceSelection}
        />
      </Suspense>
    );
  }

  if (content.kind === "paperTrade") {
    const watchlistSymbols = symbolsToWatchlistSymbols(symbols);
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">가상 주문 패널을 불러오는 중입니다</div>}>
        <OrderTicket
          executionMode="paper"
          activeSymbol={symbol.toUpperCase()}
          chartSymbols={watchlistSymbols}
          symbolOptions={watchlistSymbols}
          onSymbolOptionsRequest={() => undefined}
          chartPriceSelection={orderPriceSelection}
        />
      </Suspense>
    );
  }

  if (content.kind === "paperAccount") {
    return <Suspense fallback={<div className="workspace-panel-placeholder" role="status">가상계좌를 불러오는 중입니다</div>}>
      <PaperAccountPanel
        defaultSymbol={symbol.toUpperCase()}
        symbols={symbols}
        onOpenCompany={onOpenCompany}
      />
    </Suspense>;
  }

  if (content.kind === "chartCommentary") {
    const boundChartDocumentId = readString(content.props?.chartDocumentId) ?? activeChartDocument?.id;
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">차트 해설을 불러오는 중입니다</div>}>
        <ChartCommentaryPanel
          chartDocumentId={boundChartDocumentId}
          sourceAvailable={Boolean(activeChartDocument && (!boundChartDocumentId || activeChartDocument.id === boundChartDocumentId))}
          symbol={(activeChartDocument?.symbol ?? symbol).toUpperCase()}
          interval={normalizeChartInterval(activeChartDocument?.timeframe)}
          candles={activeChartCandles}
          drawingIds={activeChartDrawingIds}
          chartLayers={activeChartDocument?.layers}
          commentaryState={content.props?.commentaryState}
          onCommentaryStateChange={(state) => onUpdatePanelProps(content.id, {
            commentaryState: state,
            commentaryHistoryByDocument: boundChartDocumentId
              ? rememberChartCommentaryState(
                content.props?.commentaryHistoryByDocument,
                boundChartDocumentId,
                state
              )
              : content.props?.commentaryHistoryByDocument
          })}
          chartOptions={chartLinkOptions}
          chartSelectionActive={chartSelectionActive}
          onChartSelectionToggle={() => onChartSelectionToggle(content.id)}
          onChartDocumentChange={(chartDocumentId) => onCommentaryChartChange(content.id, chartDocumentId)}
        />
      </Suspense>
    );
  }

  if (content.kind === "chartAssetOps") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">차트 자산 도구를 불러오는 중입니다</div>}>
        <ChartAssetOpsPanel
          currentSymbol={(activeChartDocument?.symbol ?? symbol).toUpperCase()}
          currentInterval={normalizeChartInterval(activeChartDocument?.timeframe)}
          currentCandles={activeChartCandles}
          currentDrawingIds={activeChartDrawingIds}
        />
      </Suspense>
    );
  }

  if (content.kind === "chartPatternList") {
    return (
      <Suspense fallback={<div className="workspace-panel-placeholder" role="status">차트 패턴을 불러오는 중입니다</div>}>
        <ChartPatternListPanel
          activeSymbol={(activeChartDocument?.symbol ?? symbol).toUpperCase()}
          activeInterval={normalizeChartInterval(activeChartDocument?.timeframe)}
          onSelectPatternAsset={onSelectPatternAsset}
        />
      </Suspense>
    );
  }

  if (content.kind !== "chart") {
    return <div className="workspace-panel-placeholder" aria-label={`${content.title} content`} data-panel-slot-id={slot.id}>준비 중입니다</div>;
  }

  const selectedSymbol = symbol.toUpperCase();
  if (!chartDocument || !chartDataStatus || !chartStreamStatus) {
    return <div className="workspace-panel-placeholder" aria-label="Chart document loading" data-panel-slot-id={slot.id}>차트를 준비 중입니다</div>;
  }
  const interval = (chartDocument.timeframe || chartHeaderSnapshot?.interval || "1D") as ChartInterval;
  const chartType = normalizeChartType(chartDocument.chartType);
  const chartIntervalOptions = chartType === "bidask" ? bidAskChartIntervals : chartIntervals;
  const chartIntervalValue = chartType === "bidask"
    ? (isBidAskChartInterval(interval) ? interval : defaultBidAskInterval)
    : interval;
  const chartTypeOptions: ChartToolbarSelectOption<ChartType>[] = chartTypes.map((nextChartType) => ({
    value: nextChartType,
    label: chartTypeLabel(nextChartType)
  }));
  const chartIntervalSelectOptions: ChartToolbarSelectOption<ChartInterval>[] = chartIntervalOptions.map((nextInterval) => ({
    value: nextInterval,
    label: nextInterval
  }));
  const handleChartTypeChange = (nextChartType: ChartType) => {
    chartPanelHandleRef.current?.setChartType(nextChartType);
  };
  const companyToggleButton = (
    <button
      type="button"
      className="chart-content-toggle"
      aria-label={activeTab === "chart" ? `${selectedSymbol} 기업정보 보기` : `${selectedSymbol} 차트 보기`}
      title={activeTab === "chart" ? "기업정보 보기" : "차트 보기"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        const nextTab = activeTab === "chart" ? "company" : "chart";
        setActiveTab(nextTab);
        onUpdatePanelProps(content.id, { view: nextTab });
      }}
    >
      {activeTab === "chart" ? "기업정보" : "차트"}
    </button>
  );
  const chartNavigationLeading = (
    <>
      <div
        className="chart-instance-symbol"
        onPointerEnter={() => onChartHoverChange(true)}
        onPointerMove={() => onChartHoverChange(true)}
      >
        <div className="chart-instance-symbol-controls" onPointerDown={(event) => event.stopPropagation()}>
          <div className="chart-instance-symbol-search-wrap">
            <SymbolSearch
              symbols={symbols}
              className="chart-instance-symbol-search"
              compact
              selectedSymbol={selectedSymbol}
              selectedLabel={selectedSymbol}
              placeholder={selectedSymbol}
              formatSelectedLabel={(symbolOption) => symbolOption.symbol}
              onSelectSymbol={(nextSymbol) => onChangePanelChartSymbol(content.id, nextSymbol)}
              onPointerActivity={() => onChartHoverChange(true)}
            />
          </div>
        </div>
      </div>
      <div className="chart-instance-view-controls">
        <ChartToolbarSelect
          value={chartType}
          options={chartTypeOptions}
          ariaLabel="Chart type"
          variant="chart-type"
          open={openChartDropdown === "chart-type"}
          onOpenChange={(open) => setOpenChartDropdown(open ? "chart-type" : null)}
          onChange={handleChartTypeChange}
        />
        <ChartToolbarSelect
          value={chartIntervalValue}
          options={chartIntervalSelectOptions}
          ariaLabel="Interval"
          variant="interval"
          open={openChartDropdown === "interval"}
          onOpenChange={(open) => setOpenChartDropdown(open ? "interval" : null)}
          onChange={(nextInterval) => chartPanelHandleRef.current?.setInterval(nextInterval)}
        />
      </div>
    </>
  );

  return (
    <div className="chart-instance is-editable-chart">
      {activeTab === "chart" ? (
        <ChartPanel
          key={`chart-panel-${content.id}-${chartDataResetRevision}`}
          ref={setChartPanelHandle}
          panelId={slot.id}
          document={chartDocument}
          candles={chartCandles}
          dataStatus={chartDataStatus}
          streamStatus={chartStreamStatus}
          streamMessage={chartStreamMessage}
          liveTrade={chartLiveTrade}
          symbols={symbols}
          laneHeight={laneHeight}
          chartAddActive={chartAddActive}
          onChartRuntimeAction={onChartRuntimeAction}
          onChartAddToggle={onChartAddToggle}
          onSemanticSelectionChange={setSemanticSelection}
          onAgentAsk={onAgentAsk}
          emphasizeSelection={emphasizeChartSelection}
          onChartHoverChange={onChartHoverChange}
          onHeaderChange={onHeaderChange}
          onPriceSelection={onChartPriceSelection}
          toolbarLeading={chartNavigationLeading}
          toolbarAfterViewControls={companyToggleButton}
        />
      ) : (
        <div className="chart-tab-content is-company" aria-label={`${selectedSymbol} 기업정보`}>
          <div className="chart-company-toolbar" aria-label="기업정보 컨트롤">
            {companyToggleButton}
          </div>
          <CompanyMultiPanel symbol={selectedSymbol} item={companyItem} items={companyItems} />
        </div>
      )}
    </div>
  );
}

function recommendationSessionMode(value: unknown): "pre" | "regular" | undefined {
  return value === "pre" || value === "regular" ? value : undefined;
}

function normalizeChartType(value: string | undefined): ChartType {
  return value === "line" || value === "ohlc" || value === "candle" || value === "bidask" ? value : "candle";
}

function normalizeChartInterval(value: string | undefined): ChartInterval {
  return chartIntervals.includes(value as ChartInterval) || bidAskChartIntervals.includes(value as ChartInterval)
    ? value as ChartInterval
    : "1D";
}

function chartTypeLabel(chartType: ChartType): string {
  if (chartType === "bidask") {
    return "Bid/Ask";
  }
  if (chartType === "line") {
    return "Line";
  }
  if (chartType === "ohlc") {
    return "OHLC";
  }
  return "Candle";
}

function symbolsToWatchlistSymbols(symbols: ChartSymbolDto[]): WatchlistSymbol[] {
  return symbols.map((item) => ({
    symbol: item.symbol.toUpperCase(),
    name: item.name || item.symbol.toUpperCase(),
    market: "US"
  }));
}

function readCompareBaseSymbol(content: PanelContentInstance, fallbackSymbol: string): string {
  const raw = content.props?.baseSymbol ?? content.props?.symbol ?? fallbackSymbol;
  return typeof raw === "string" && raw.trim() ? raw.trim().toUpperCase() : fallbackSymbol.toUpperCase();
}

function readOrderFlowSymbol(content: PanelContentInstance): string {
  const raw = content.props?.symbol;
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

function readQuickOrderSymbol(content: PanelContentInstance, fallbackSymbol: string): string {
  const raw = content.props?.symbol;
  return typeof raw === "string" && raw.trim() ? raw.trim().toUpperCase() : fallbackSymbol.toUpperCase();
}

function readQuickOrderQty(content: PanelContentInstance): number {
  const raw = content.props?.qty;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 1;
}

function readOrderFlowWindow(content: PanelContentInstance): OrderFlowWindow {
  const raw = content.props?.window;
  return raw === "1m" || raw === "10m" || raw === "1h" || raw === "session" ? raw : "10m";
}

function readOrderFlowResolution(content: PanelContentInstance): OrderFlowResolutionSelection {
  const raw = content.props?.resolution;
  if (raw === "auto") {
    return "auto";
  }
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 8 ? raw : "auto";
}

function readCompareSymbols(content: PanelContentInstance, baseSymbol: string): string[] {
  const raw = content.props?.symbols;
  const values = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
  return normalizeCompareSymbols(values).filter((value) => value !== baseSymbol.toUpperCase());
}

function readCompareRange(content: PanelContentInstance): ChartCompareRange {
  const raw = typeof content.props?.range === "string" ? content.props.range.toUpperCase() : "";
  return raw === "1D" || raw === "1M" || raw === "6M" || raw === "1Y" || raw === "5Y" ? raw : "1D";
}

function readCompanyCompareBaseSymbol(content: PanelContentInstance, fallbackSymbol: string): string {
  return (readString(content.props?.baseSymbol) ?? fallbackSymbol).trim().toUpperCase();
}

function readCompanyCompareSymbols(content: PanelContentInstance, baseSymbol: string): string[] {
  const values = Array.isArray(content.props?.compareSymbols) ? content.props.compareSymbols : [];
  return normalizeCompareSymbols(values.filter((value): value is string => typeof value === "string"))
    .filter((symbol) => symbol !== baseSymbol.toUpperCase())
    .slice(0, 3);
}

function normalizeCompareSymbols(values: string[]): string[] {
  const normalized: string[] = [];
  values.forEach((value) => {
    const symbol = value.trim().toUpperCase();
    if (symbol && !normalized.includes(symbol)) {
      normalized.push(symbol);
    }
  });
  return normalized.slice(0, 6);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
