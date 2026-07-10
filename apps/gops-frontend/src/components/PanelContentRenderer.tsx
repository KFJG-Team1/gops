import { Newspaper } from "lucide-react";
import type { ChartDataStatus, ChartDocument, ChartRuntimeAction, StreamStatus, TradeTickData } from "@gops/chart-engine";
import { useCallback, useRef, useState } from "react";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import type { AgentReference } from "../agent/agentReferences";
import type { OrderFlowResolutionSelection, OrderFlowWindow } from "../chart/orderFlow";
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
import { StockRecommendationsPanel } from "../recommendations/StockRecommendationsPanel";
import { ChartPanel, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import { ChartComparisonPanel } from "./ChartComparisonPanel";
import { CompanySummaryPanel } from "./CompanySummaryPanel";
import { IndexWidgetPanel } from "./IndexWidgetPanel";
import { NewsPanel } from "./NewsPanel";
import { OrderFlowPanel } from "./OrderFlowPanel";
import { OrderTicket } from "./OrderTicket";
import { PopularStocksPanel } from "./PopularStocksPanel";
import {
  PortfolioDividendPanel,
  PortfolioDiversificationPanel,
  PortfolioHoldingsOnlyPanel,
  PortfolioInvestedPanel,
  PortfolioInvestmentStatusPanel,
  PortfolioPerformancePanel
} from "./PortfolioHoldingsPanel";
import { SymbolSearch } from "./SymbolSearch";
import { ThemeRadarPanel } from "./ThemeRadarPanel";
import { WatchlistNewsPanel } from "./WatchlistNewsPanel";

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
  chartDataStatus?: ChartDataStatus;
  chartStreamStatus?: StreamStatus;
  chartStreamMessage?: string;
  chartLiveTrade?: TradeTickData;
  chartDrawingActive: boolean;
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
  onChartDrawingToggle: () => void;
  onChartAddToggle: () => void;
  onSyncPageSymbolFromChart: () => void;
  onUpdatePanelProps: (contentId: string, props: Record<string, unknown>) => void;
  onChangePanelChartSymbol: (contentId: string, symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
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
  chartDataStatus,
  chartStreamStatus,
  chartStreamMessage,
  chartLiveTrade,
  chartDrawingActive,
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
  onChartDrawingToggle,
  onChartAddToggle,
  onSyncPageSymbolFromChart,
  onUpdatePanelProps,
  onChangePanelChartSymbol,
  onSelectSymbol
}: PanelContentRendererProps) {
  const chartPanelHandleRef = useRef<ChartPanelHandle | null>(null);
  const [activeTab, setActiveTab] = useState<"chart" | "company">("chart");
  const setChartPanelHandle = useCallback((handle: ChartPanelHandle | null) => {
    chartPanelHandleRef.current = handle;
    onChartHandleChange(content.id, handle);
  }, [content.id, onChartHandleChange]);

  if (content.kind === "company") {
    return <CompanySummaryPanel symbol={symbol.toUpperCase()} item={companyItem} items={companyItems} />;
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

  if (content.kind === "news") {
    return (
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
    );
  }

  if (content.kind === "newsList") {
    return (
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
    );
  }

  if (content.kind === "watchlistNews") {
    return (
      <WatchlistNewsPanel
        sourcePanelId={content.id}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
        onAgentReferenceSelect={onAgentReferenceSelect}
        onAgentAsk={onAgentAsk}
        variant="flip"
      />
    );
  }

  if (content.kind === "watchlistNewsList") {
    return (
      <WatchlistNewsPanel
        sourcePanelId={content.id}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        emphasizedAgentReferenceKeys={emphasizedAgentReferenceKeys}
        onAgentReferenceSelect={onAgentReferenceSelect}
        onAgentAsk={onAgentAsk}
        variant="list"
      />
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
    return <StockRecommendationsPanel activeSymbol={symbol.toUpperCase()} onSelectSymbol={onSelectSymbol} />;
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

  if (content.kind === "portfolioPerformance") {
    return <PortfolioPerformancePanel />;
  }

  if (content.kind === "portfolioInvested") {
    return <PortfolioInvestedPanel />;
  }

  if (content.kind === "portfolioDividend") {
    return <PortfolioDividendPanel />;
  }

  if (content.kind === "portfolioDiversification") {
    return <PortfolioDiversificationPanel />;
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

  if (content.kind === "trade") {
    const watchlistSymbols = symbolsToWatchlistSymbols(symbols);
    return (
      <OrderTicket
        activeSymbol={symbol.toUpperCase()}
        chartSymbols={watchlistSymbols}
        symbolOptions={watchlistSymbols}
        onSymbolOptionsRequest={() => undefined}
      />
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
      onClick={() => setActiveTab((current) => current === "chart" ? "company" : "chart")}
    >
      {activeTab === "chart" ? "기업정보" : "차트"}
    </button>
  );

  return (
    <div className="chart-instance is-editable-chart">
      <div className="chart-instance-topbar">
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
            <button
              type="button"
              className="chart-instance-sync-page"
              aria-label={`${selectedSymbol}을 현재 페이지 종목으로 설정`}
              title="현재 페이지 종목으로 설정"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onSyncPageSymbolFromChart}
            >
              <Newspaper size={13} />
            </button>
          </div>
        </div>
        <div className="chart-instance-view-controls">
          <select
            className="chart-instance-select chart-instance-chart-type"
            value={chartType}
            aria-label="Chart type"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => handleChartTypeChange(event.target.value as ChartType)}
          >
            {chartTypes.map((nextChartType) => (
              <option key={nextChartType} value={nextChartType}>{chartTypeLabel(nextChartType)}</option>
            ))}
          </select>
          <select
            className="chart-instance-select chart-instance-interval"
            value={chartIntervalValue}
            aria-label="Interval"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => chartPanelHandleRef.current?.setInterval(event.target.value as ChartInterval)}
          >
            {chartIntervalOptions.map((nextInterval) => (
              <option key={nextInterval} value={nextInterval}>{nextInterval}</option>
            ))}
          </select>
        </div>
      </div>
      {activeTab === "chart" ? (
        <ChartPanel
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
          chartDrawingActive={chartDrawingActive}
          chartAddActive={chartAddActive}
          onChartRuntimeAction={onChartRuntimeAction}
          onChartDrawingToggle={onChartDrawingToggle}
          onChartAddToggle={onChartAddToggle}
          onSemanticSelectionChange={setSemanticSelection}
          onAgentAsk={onAgentAsk}
          emphasizeSelection={emphasizeChartSelection}
          onChartHoverChange={onChartHoverChange}
          onHeaderChange={onHeaderChange}
          toolbarLeading={companyToggleButton}
        />
      ) : (
        <div className="chart-tab-content is-company" aria-label={`${selectedSymbol} 기업정보`}>
          <div className="chart-company-toolbar" aria-label="기업정보 컨트롤">
            {companyToggleButton}
          </div>
          <CompanySummaryPanel symbol={selectedSymbol} item={companyItem} items={companyItems} />
        </div>
      )}
    </div>
  );
}

function normalizeChartType(value: string | undefined): ChartType {
  return value === "line" || value === "ohlc" || value === "candle" || value === "bidask" ? value : "candle";
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
