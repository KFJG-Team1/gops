import { Newspaper } from "lucide-react";
import type { ChartDataStatus, ChartDocument, ChartRuntimeAction, StreamStatus } from "@gops/chart-engine";
import { useCallback, useRef, useState } from "react";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import type { AgentReference } from "../agent/agentReferences";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import { chartIntervals, chartTypes, type CandleDto, type ChartInterval, type ChartSymbolDto, type ChartType } from "../chart/types";
import type { PanelContentInstance, PanelSlot } from "../layout/panelLayout";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { OntologyPanel } from "../ontology/OntologyPanel";
import { ChartPanel, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import { CompanySummaryPanel } from "./CompanySummaryPanel";
import { IndexPanel } from "./IndexPanel";
import { NewsPanel } from "./NewsPanel";
import { OrderTicket } from "./OrderTicket";
import { PopularStocksPanel } from "./PopularStocksPanel";
import { PortfolioHoldingsPanel } from "./PortfolioHoldingsPanel";
import { SymbolSearch } from "./SymbolSearch";
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
  chartHeaderSnapshot?: ChartHeaderSnapshot;
  chartDocument?: ChartDocument;
  chartCandles: CandleDto[];
  chartDataStatus?: ChartDataStatus;
  chartStreamStatus?: StreamStatus;
  chartStreamMessage?: string;
  chartDrawingActive: boolean;
  chartAddActive: boolean;
  selectedAgentReferenceKeys: string[];
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onAgentReferenceSelect: (reference: AgentReference) => void;
  onChartRuntimeAction: (action: ChartRuntimeAction) => void;
  onChartHoverChange: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
  onChartHandleChange: (contentId: string, handle: ChartPanelHandle | null) => void;
  onChartDrawingToggle: () => void;
  onChartAddToggle: () => void;
  onSyncPageSymbolFromChart: () => void;
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
  chartHeaderSnapshot,
  chartDocument,
  chartCandles,
  chartDataStatus,
  chartStreamStatus,
  chartStreamMessage,
  chartDrawingActive,
  chartAddActive,
  selectedAgentReferenceKeys,
  setSemanticSelection,
  onAgentReferenceSelect,
  onChartRuntimeAction,
  onChartHoverChange,
  onHeaderChange,
  onChartHandleChange,
  onChartDrawingToggle,
  onChartAddToggle,
  onSyncPageSymbolFromChart,
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

  if (content.kind === "news") {
    return (
      <NewsPanel
        symbol={symbol.toUpperCase()}
        initialPayload={content.props}
        sourcePanelId={content.id}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        onAgentReferenceSelect={onAgentReferenceSelect}
      />
    );
  }

  if (content.kind === "watchlistNews") {
    return (
      <WatchlistNewsPanel
        sourcePanelId={content.id}
        selectedAgentReferenceKeys={selectedAgentReferenceKeys}
        onAgentReferenceSelect={onAgentReferenceSelect}
      />
    );
  }

  if (content.kind === "indices") {
    return <IndexPanel />;
  }

  if (content.kind === "popular") {
    return <PopularStocksPanel items={marketItems} onSelectSymbol={onSelectSymbol} />;
  }

  if (content.kind === "ontology") {
    return <OntologyPanel symbol={symbol} onSelectSymbol={onSelectSymbol} />;
  }

  if (content.kind === "portfolio") {
    return (
      <PortfolioHoldingsPanel
        onSelectSymbol={(nextSymbol) => {
          onSelectSymbol(nextSymbol);
          return true;
        }}
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
        <div className="chart-content-tabs" role="tablist" aria-label={`${selectedSymbol} chart tabs`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "chart"}
            className={activeTab === "chart" ? "active" : ""}
            onClick={() => setActiveTab("chart")}
          >
            차트
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "company"}
            className={activeTab === "company" ? "active" : ""}
            onClick={() => setActiveTab("company")}
          >
            기업정보
          </button>
        </div>
        <div className="chart-instance-view-controls">
          <select
            className="chart-instance-select chart-instance-chart-type"
            value={chartType}
            aria-label="Chart type"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => chartPanelHandleRef.current?.setChartType(event.target.value as ChartType)}
          >
            {chartTypes.map((nextChartType) => (
              <option key={nextChartType} value={nextChartType}>{chartTypeLabel(nextChartType)}</option>
            ))}
          </select>
          <select
            className="chart-instance-select chart-instance-interval"
            value={interval}
            aria-label="Interval"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => chartPanelHandleRef.current?.setInterval(event.target.value as ChartInterval)}
          >
            {chartIntervals.map((nextInterval) => (
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
          symbols={symbols}
          laneHeight={laneHeight}
          chartDrawingActive={chartDrawingActive}
          chartAddActive={chartAddActive}
          onChartRuntimeAction={onChartRuntimeAction}
          onChartDrawingToggle={onChartDrawingToggle}
          onChartAddToggle={onChartAddToggle}
          onSemanticSelectionChange={setSemanticSelection}
          onChartHoverChange={onChartHoverChange}
          onHeaderChange={onHeaderChange}
        />
      ) : (
        <div className="chart-tab-content is-company" role="tabpanel" aria-label={`${selectedSymbol} 기업정보`}>
          <CompanySummaryPanel symbol={selectedSymbol} item={companyItem} items={companyItems} />
        </div>
      )}
    </div>
  );
}

function normalizeChartType(value: string | undefined): ChartType {
  return value === "line" || value === "ohlc" || value === "candle" ? value : "candle";
}

function chartTypeLabel(chartType: ChartType): string {
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
