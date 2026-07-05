import { X } from "lucide-react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import type { SemanticSelectionSnapshot } from "../chart/semanticTimeline";
import type { ChartSymbolDto } from "../chart/types";
import type { PanelContentInstance, PanelSlot, PanelSlotId } from "../layout/panelLayout";
import { OntologyPanel } from "../ontology/OntologyPanel";
import { ChartPanel, type ChartHeaderSnapshot, type ChartPanelHandle } from "./ChartPanel";
import { NewsPanel } from "./NewsPanel";
import { OrderTicket } from "./OrderTicket";
import { PortfolioHoldingsPanel } from "./PortfolioHoldingsPanel";
import { SymbolSearch } from "./SymbolSearch";

type PanelContentRendererProps = {
  slot: PanelSlot;
  content: PanelContentInstance;
  symbol: string;
  symbols: ChartSymbolDto[];
  laneHeight: number;
  chartPanelRef: MutableRefObject<ChartPanelHandle | null> | null;
  chartHeaderSnapshot?: ChartHeaderSnapshot;
  setSemanticSelection: (selection: SemanticSelectionSnapshot | null) => void;
  onChartHoverChange: (hovered: boolean) => void;
  onHeaderChange?: (header: ChartHeaderSnapshot) => void;
  onClosePanel: (slotId: PanelSlotId) => void;
  onChangePanelChartSymbol: (contentId: string, symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onChartSwapPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
};

export function PanelContentRenderer({
  slot,
  content,
  symbol,
  symbols,
  laneHeight,
  chartPanelRef,
  chartHeaderSnapshot,
  setSemanticSelection,
  onChartHoverChange,
  onHeaderChange,
  onClosePanel,
  onChangePanelChartSymbol,
  onSelectSymbol,
  onChartSwapPointerDown
}: PanelContentRendererProps) {
  if (content.kind === "news") {
    return <NewsPanel symbol={(content.symbol ?? symbol).toUpperCase()} initialPayload={content.props} />;
  }

  if (content.kind === "ontology") {
    return <OntologyPanel symbol={symbol} />;
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
  const interval = chartHeaderSnapshot?.interval ?? "1D";
  const editable = !content.isDefaultChart;

  return (
    <div className={content.isDefaultChart ? "chart-instance is-default-chart" : "chart-instance is-editable-chart"}>
      <div
        className={editable ? "chart-instance-symbol chart-instance-swap-handle" : "chart-instance-symbol"}
        onPointerEnter={() => onChartHoverChange(true)}
        onPointerMove={() => onChartHoverChange(true)}
        onPointerDown={editable ? onChartSwapPointerDown : undefined}
      >
        <span className="chart-instance-interval">{interval}</span>
        {!editable && <span className="chart-instance-symbol-text">{selectedSymbol}</span>}
        {editable && (
          <div className="chart-instance-symbol-search-wrap" onPointerDown={(event) => event.stopPropagation()}>
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
        )}
      </div>
      {editable && (
        <button
          type="button"
          className="chart-instance-close"
          aria-label="차트 패널 닫기"
          title="차트 패널 닫기"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onClosePanel(slot.id)}
        >
          <X size={13} />
        </button>
      )}
      <ChartPanel
        ref={chartPanelRef ?? undefined}
        symbol={selectedSymbol}
        symbols={symbols}
        laneHeight={laneHeight}
        onSemanticSelectionChange={setSemanticSelection}
        onChartHoverChange={onChartHoverChange}
        onHeaderChange={onHeaderChange}
      />
    </div>
  );
}

function symbolsToWatchlistSymbols(symbols: ChartSymbolDto[]): WatchlistSymbol[] {
  return symbols.map((item) => ({
    symbol: item.symbol.toUpperCase(),
    name: item.name || item.symbol.toUpperCase(),
    market: "US"
  }));
}
