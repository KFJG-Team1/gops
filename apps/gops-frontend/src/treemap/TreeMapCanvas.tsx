import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Sp500UniverseItem } from "../market/sp500Universe.seed";
import { sp500WeightValue } from "../market/sp500Universe.seed";
import { hitTestTreeMapTile, layoutSp500TreeMap } from "./treemapLayout";
import type { TreeMapInputItem, TreeMapRect, TreeMapTile } from "./treemapTypes";
import {
  createTreeMapOpacityScale,
  tileFillForChange,
  tileOpacityForChange,
  tileTextForOpacity,
  toneForChange,
  type TreeMapOpacityScale
} from "./treemapColors";
import { readThemeColors, type ThemeColors } from "../theme/colors";
import { applyCanvasTypography, CANVAS_FONT_FAMILY, nearestTypeRole, TYPE_ROLE } from "../theme/typography";

type TreeMapCanvasProps = {
  items: Sp500UniverseItem[];
  onSelectSymbol?: (symbol: string) => void;
  onHoverTileChange?: (tile: TreeMapTile | null) => void;
  highlightedSymbol?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  className?: string;
  interactive?: boolean;
};

type CanvasSize = {
  width: number;
  height: number;
};

type TreeMapSymbolBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type TreeMapHoverState = {
  tile: TreeMapTile;
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
};

const canvasPadding = 4;
const labelPadding = 8;
const tileGap = 0.85;
const hoverPanelMargin = 10;
const hoverPanelOffset = 16;
const hoverPanelHeaderHeight = 32;
const hoverPanelFeaturedHeight = 84;
const hoverPanelRowHeight = 28;
const hoverPanelVerticalPadding = 8;
const hoverPanelMaxRows = 12;
const categoryHighlightColor = "#ffeb00";
const categoryDividerLineWidth = tileGap * 2;

type TreeMapHoverPanelModel = {
  panel: TreeMapRect;
  rows: TreeMapTile[];
};

export function TreeMapCanvas({
  items,
  onSelectSymbol,
  onHoverTileChange,
  highlightedSymbol,
  ariaLabel = "S&P 500 TreeMap",
  style,
  className,
  interactive = true
}: TreeMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesRef = useRef<TreeMapTile[]>([]);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1 });
  const [hoverState, setHoverState] = useState<TreeMapHoverState | null>(null);

  const inputItems = useMemo((): TreeMapInputItem[] => items.map((item) => ({
    symbol: item.symbol,
    companyName: item.companyName,
    sector: item.sector,
    sectorLabelKo: item.sectorLabelKo,
    industry: item.industry,
    value: sp500WeightValue(item),
    marketCap: item.layoutMarketCap ?? item.marketCap,
    indexWeight: item.indexWeight,
    lastPrice: item.lastPrice,
    volume: item.volume,
    sessionDollarVolume: item.sessionDollarVolume,
    changePercent: item.changePercent
  })), [items]);

  const tiles = useMemo(() => layoutSp500TreeMap(inputItems, {
    x: canvasPadding,
    y: canvasPadding,
    width: Math.max(1, size.width - canvasPadding * 2),
    height: Math.max(1, size.height - canvasPadding * 2)
  }), [inputItems, size.height, size.width]);
  const opacityScale = useMemo(() => createTreeMapOpacityScale(inputItems.map((item) => item.changePercent)), [inputItems]);
  const hoverPanel = useMemo(
    () => buildHoverPanelModel(hoverState, tiles),
    [hoverState, tiles]
  );

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      setSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height)
      });
    };
    const observer = new ResizeObserver(syncSize);
    observer.observe(canvas);
    syncSize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(size.width * ratio));
    const height = Math.max(1, Math.floor(size.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTreeMap(context, size, tiles, hoverState, opacityScale, highlightedSymbol);
  }, [highlightedSymbol, hoverState, opacityScale, size, tiles]);

  const updateHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const panelWidth = event.currentTarget.offsetWidth;
    const panelHeight = event.currentTarget.offsetHeight;
    const panelScaleX = panelWidth / Math.max(1, rect.width);
    const panelScaleY = panelHeight / Math.max(1, rect.height);
    const next = hitTestTreeMapTile(tilesRef.current, x, y) ?? null;
    setHoverState((current) => {
      if (!next) {
        if (current) {
          onHoverTileChange?.(null);
        }
        return null;
      }
      if (current?.tile.id !== next.id) {
        onHoverTileChange?.(next);
      }
      return {
        tile: next,
        panelX: x * panelScaleX,
        panelY: y * panelScaleY,
        panelWidth,
        panelHeight
      };
    });
  };

  const clearHover = () => {
    setHoverState((current) => {
      if (current) {
        onHoverTileChange?.(null);
      }
      return null;
    });
  };

  const selectPointerTile = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !onSelectSymbol) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const tile = hitTestTreeMapTile(tilesRef.current, x, y);
    if (tile?.symbol) {
      onSelectSymbol(tile.symbol);
    }
  };

  return (
    <section className={`treemap-panel${className ? ` ${className}` : ""}`} style={style} aria-label={ariaLabel}>
      <canvas
        ref={canvasRef}
        className="treemap-canvas"
        style={{ cursor: interactive && hoverState?.tile.symbol ? "pointer" : "default" }}
        aria-label={`${ariaLabel} canvas`}
        onPointerMove={interactive ? updateHover : undefined}
        onPointerLeave={interactive ? clearHover : undefined}
        onClick={interactive ? selectPointerTile : undefined}
      />
      {hoverPanel && hoverState ? (
        <TreeMapHoverPanel model={hoverPanel} hoveredTile={hoverState.tile} />
      ) : null}
    </section>
  );
}

function TreeMapHoverPanel({ model, hoveredTile }: { model: TreeMapHoverPanelModel; hoveredTile: TreeMapTile }) {
  const detailText = hoverDetailText(hoveredTile);
  const tone = toneForChange(hoveredTile.changePercent);

  return (
    <aside
      className="treemap-hover-panel"
      style={{
        left: model.panel.x,
        top: model.panel.y,
        width: model.panel.width,
        height: model.panel.height
      }}
      aria-hidden="true"
    >
      <div className="treemap-hover-header">{hoverCategoryTitle(hoveredTile)}</div>
      <div className={`treemap-hover-featured is-${tone}`}>
        <div className="treemap-hover-featured-summary">
          <span className="treemap-hover-featured-symbol">{hoveredTile.symbol || hoveredTile.label}</span>
          <span className="treemap-hover-featured-quote">{formatHoverQuote(hoveredTile)}</span>
        </div>
        <div className="treemap-hover-featured-company">{hoveredTile.companyName || ""}</div>
        {detailText ? <div className="treemap-hover-featured-detail">{detailText}</div> : null}
      </div>
      <div className="treemap-hover-rows">
        {model.rows.map((tile) => (
          <div
            key={tile.id}
            className={`treemap-hover-row${tile.id === hoveredTile.id ? " is-hovered" : ""}`}
          >
            <span className="treemap-hover-row-symbol">{tile.symbol || tile.label}</span>
            <span className="treemap-hover-row-company">{tile.companyName || ""}</span>
            <span className="treemap-hover-row-price">{formatPrice(tile.lastPrice)}</span>
            <span className={`treemap-hover-row-change is-${toneForChange(tile.changePercent)}`}>
              {formatChange(tile.changePercent)}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function drawTreeMap(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  tiles: TreeMapTile[],
  hoverState: TreeMapHoverState | null,
  opacityScale: TreeMapOpacityScale,
  highlightedSymbol?: string
) {
  const theme = readTheme();
  context.clearRect(0, 0, size.width, size.height);

  const symbolTiles = tiles.filter((tile) => tile.kind === "symbol");
  const industryTiles = tiles.filter((tile) => tile.kind === "industry");
  const sectorTiles = tiles.filter((tile) => tile.kind === "sector");
  const hoveredTile = hoverState?.tile ?? null;
  const highlightedIndustry = hoveredTile ? industryTiles.find((tile) => tile.id === hoveredTile.parentId) : undefined;
  const highlightedSymbols = highlightedIndustry
    ? symbolTiles.filter((tile) => tile.parentId === highlightedIndustry.id)
    : [];
  const symbolBounds = boundsForSymbolTiles(symbolTiles);
  symbolTiles.forEach((tile) => drawSymbol(
    context,
    tile,
    hoveredTile?.id,
    theme,
    opacityScale,
    symbolBounds,
    highlightedSymbol?.toUpperCase() === tile.symbol?.toUpperCase()
  ));
  industryTiles.forEach((tile) => drawIndustry(context, tile, theme, opacityScale, symbolTiles));
  sectorTiles.forEach((tile) => drawSector(context, tile, theme));
  if (highlightedIndustry) {
    drawCategoryHighlight(context, highlightedIndustry, highlightedSymbols, categoryHighlightColor);
  }
}

function drawSector(context: CanvasRenderingContext2D, tile: TreeMapTile, theme: TreeMapTheme) {
  const band = tile.band;
  const minimumHeight = Math.ceil(TYPE_ROLE.labelMd.size * TYPE_ROLE.labelMd.lineHeight);
  if (!band || band.width < 92 || band.height < minimumHeight) {
    return;
  }
  context.save();
  clipRect(context, band);
  const changeText = formatChange(tile.changePercent);
  context.textBaseline = "middle";
  applyCanvasTypography(context, "caption", theme.serif);
  const changeWidth = context.measureText(changeText).width;
  const canShowChange = band.width >= 146;
  const labelMaxWidth = band.width - labelPadding * 2 - (canShowChange ? changeWidth + 12 : 0);
  applyCanvasTypography(context, "labelMd", theme.serif);
  context.fillStyle = theme.colors.text;
  fillFittedText(context, tile.label, band.x + labelPadding, band.y + band.height / 2, labelMaxWidth);
  if (canShowChange) {
    applyCanvasTypography(context, "caption", theme.serif);
    context.textAlign = "right";
    context.fillStyle = toneForChange(tile.changePercent) === "down" ? theme.colors.changeDown : theme.colors.changeUp;
    context.fillText(changeText, band.x + band.width - labelPadding, band.y + band.height / 2);
    context.textAlign = "start";
  }
  context.restore();
}

function drawIndustry(
  context: CanvasRenderingContext2D,
  tile: TreeMapTile,
  theme: TreeMapTheme,
  opacityScale: TreeMapOpacityScale,
  symbolTiles: TreeMapTile[]
) {
  const band = categoryBandForTopEdge(tile.band, tile, symbolTiles);
  if (!band || band.width <= 2 || band.height <= 0) {
    return;
  }
  const opacity = tileOpacityForChange(tile.changePercent, opacityScale);
  context.save();
  context.fillStyle = tileFillForChange(tile.changePercent, theme.colors);
  context.globalAlpha = 1;
  fillRoundedRect(context, band.x, band.y, band.width, band.height, theme.radii.band);
  context.globalAlpha = 1;

  // Industry name written inside the band when it is tall/wide enough to read.
  const minimumHeight = Math.ceil(TYPE_ROLE.caption.size * TYPE_ROLE.caption.lineHeight);
  if (band.height >= minimumHeight && band.width >= 26) {
    clipRect(context, band);
    applyCanvasTypography(context, "caption", theme.serif);
    context.fillStyle = tileTextForOpacity(opacity, theme.colors);
    context.textBaseline = "middle";
    fillFittedText(context, tile.label, band.x + 4, band.y + band.height / 2 + 0.5, band.width - 8);
  }
  context.restore();
}

function categoryBandForTopEdge(
  band: TreeMapRect | undefined,
  industryTile: TreeMapTile,
  symbolTiles: TreeMapTile[]
): TreeMapRect | undefined {
  if (!band) {
    return undefined;
  }
  const children = symbolTiles.filter((tile) => tile.parentId === industryTile.id);
  if (!children.length) {
    return band;
  }
  const top = Math.min(...children.map((tile) => tile.y));
  const topRow = children.filter((tile) => Math.abs(tile.y - top) <= 0.5);
  if (!topRow.length) {
    return band;
  }
  const left = Math.max(band.x, Math.min(...topRow.map((tile) => insetTile(tile, tileGap).x)));
  const right = Math.min(band.x + band.width, Math.max(...topRow.map((tile) => {
    const rect = insetTile(tile, tileGap);
    return rect.x + rect.width;
  })));
  if (right - left <= 2) {
    return band;
  }
  return {
    x: left,
    y: band.y,
    width: right - left,
    height: band.height
  };
}

function drawCategoryHighlight(
  context: CanvasRenderingContext2D,
  industryTile: TreeMapTile,
  symbolTiles: TreeMapTile[],
  highlightColor: string
) {
  if (!symbolTiles.length) {
    return;
  }

  const band = categoryBandForTopEdge(industryTile.band, industryTile, symbolTiles);
  const rect = categoryHighlightBounds(band, symbolTiles);
  if (!rect || rect.width <= 4 || rect.height <= 4) {
    return;
  }

  context.save();
  context.strokeStyle = highlightColor;
  context.lineCap = "butt";
  context.lineJoin = "miter";
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();

  // Raw symbol rectangles share the exact split coordinates. A line as wide as the
  // normal tile gap fills that gap without shifting either neighboring tile.
  context.lineWidth = categoryDividerLineWidth;
  symbolTiles.forEach((tile) => {
    context.strokeRect(tile.x, tile.y, tile.width, tile.height);
  });

  // Keep the outer edge inside the category's real painted bounds so it remains
  // aligned with the industry band and does not spill into adjacent categories.
  const outlineWidth = clamp(Math.min(rect.width, rect.height) * 0.016, 2.5, 4);
  const outlineInset = outlineWidth / 2;
  const outlineX = rect.x + outlineInset;
  const outlineY = rect.y + outlineInset;
  const outlineWidthPx = Math.max(0, rect.width - outlineWidth);
  const outlineHeightPx = Math.max(0, rect.height - outlineWidth);
  context.lineWidth = outlineWidth;
  context.strokeRect(outlineX, outlineY, outlineWidthPx, outlineHeightPx);
  context.restore();
}

function categoryHighlightBounds(
  band: TreeMapRect | undefined,
  symbolTiles: TreeMapTile[]
): TreeMapRect | null {
  if (!symbolTiles.length) {
    return null;
  }
  const left = Math.min(...symbolTiles.map((tile) => tile.x), band?.x ?? Number.POSITIVE_INFINITY);
  const top = Math.min(...symbolTiles.map((tile) => tile.y), band?.y ?? Number.POSITIVE_INFINITY);
  const right = Math.max(
    ...symbolTiles.map((tile) => tile.x + tile.width),
    band ? band.x + band.width : Number.NEGATIVE_INFINITY
  );
  const bottom = Math.max(
    ...symbolTiles.map((tile) => tile.y + tile.height),
    band ? band.y + band.height : Number.NEGATIVE_INFINITY
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function buildHoverPanelModel(
  hoverState: TreeMapHoverState | null,
  tiles: TreeMapTile[]
): TreeMapHoverPanelModel | null {
  if (!hoverState) {
    return null;
  }
  const panelSpace = {
    width: hoverState.panelWidth,
    height: hoverState.panelHeight
  };
  const availableWidth = panelSpace.width - hoverPanelMargin * 2;
  const availableHeight = panelSpace.height - hoverPanelMargin * 2;
  if (availableWidth < 180 || availableHeight < 140) {
    return null;
  }

  const symbolTiles = tiles.filter((tile) => tile.kind === "symbol");
  const industryTile = tiles.find((tile) => tile.kind === "industry" && tile.id === hoverState.tile.parentId);
  const categoryTiles = hoverCategorySymbolTiles(symbolTiles, industryTile, hoverState.tile);
  const maxRowsByHeight = Math.floor(
    (availableHeight - hoverPanelHeaderHeight - hoverPanelFeaturedHeight - hoverPanelVerticalPadding) / hoverPanelRowHeight
  );
  const maxRows = Math.max(2, Math.min(hoverPanelMaxRows, maxRowsByHeight));
  const rows = hoverRowsForCategory(categoryTiles, hoverState.tile, maxRows);
  const panelWidth = Math.min(clamp(panelSpace.width * 0.35, 320, 440), availableWidth);
  const panelHeight = hoverPanelHeaderHeight + hoverPanelFeaturedHeight + rows.length * hoverPanelRowHeight + hoverPanelVerticalPadding;
  const panel = positionHoverPanel(panelSpace, hoverState.panelX, hoverState.panelY, panelWidth, panelHeight);
  return { panel, rows };
}

function hoverCategorySymbolTiles(
  symbolTiles: TreeMapTile[],
  industryTile: TreeMapTile | undefined,
  hoveredTile: TreeMapTile
): TreeMapTile[] {
  const categoryTiles = industryTile ? symbolTiles.filter((tile) => tile.parentId === industryTile.id) : [];
  return categoryTiles.some((tile) => tile.id === hoveredTile.id) ? categoryTiles : [hoveredTile];
}

function hoverRowsForCategory(tiles: TreeMapTile[], hoveredTile: TreeMapTile, maxRows: number): TreeMapTile[] {
  const sorted = [...tiles].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  if (sorted.length <= maxRows) {
    return sorted;
  }
  const rows = sorted.slice(0, maxRows);
  if (!rows.some((tile) => tile.id === hoveredTile.id)) {
    rows[rows.length - 1] = hoveredTile;
  }
  return rows;
}

function positionHoverPanel(
  size: CanvasSize,
  pointerX: number,
  pointerY: number,
  width: number,
  height: number
): TreeMapRect {
  const maxX = Math.max(hoverPanelMargin, size.width - width - hoverPanelMargin);
  const maxY = Math.max(hoverPanelMargin, size.height - height - hoverPanelMargin);
  let x = pointerX + hoverPanelOffset;
  if (x + width > size.width - hoverPanelMargin) {
    x = pointerX - width - hoverPanelOffset;
  }
  let y = pointerY + hoverPanelOffset;
  if (y + height > size.height - hoverPanelMargin) {
    y = pointerY - height - hoverPanelOffset;
  }
  return {
    x: clamp(x, hoverPanelMargin, maxX),
    y: clamp(y, hoverPanelMargin, maxY),
    width,
    height
  };
}

function hoverCategoryTitle(tile: TreeMapTile): string {
  const sector = tile.sectorLabelKo || tile.sector || "Unknown";
  return `${sector} - ${tile.industry || "Unclassified"}`;
}

function hoverDetailText(tile: TreeMapTile): string {
  return [
    formatMarketCap(tile.marketCap),
    formatDollarLabel("거래대금", tile.sessionDollarVolume),
    formatNumberLabel("거래량", tile.volume)
  ].filter(Boolean).join(" · ");
}

function formatHoverQuote(tile: TreeMapTile): string {
  const price = formatPrice(tile.lastPrice);
  return `${price} ${formatChange(tile.changePercent)}`;
}

function formatPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return "-";
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatMarketCap(value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) {
    return null;
  }
  return `시총 ${formatCompactDollar(value)}`;
}

function formatDollarLabel(label: string, value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) {
    return null;
  }
  return `${label} ${formatCompactDollar(value)}`;
}

function formatNumberLabel(label: string, value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) {
    return null;
  }
  return `${label} ${formatCompactNumber(value)}`;
}

function formatCompactDollar(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (absolute >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.round(value).toLocaleString("en-US");
}

function drawSymbol(
  context: CanvasRenderingContext2D,
  tile: TreeMapTile,
  hoveredTileId: string | undefined,
  theme: TreeMapTheme,
  opacityScale: TreeMapOpacityScale,
  symbolBounds: TreeMapSymbolBounds | null,
  highlighted: boolean
) {
  const hovered = hoveredTileId === tile.id;
  const rect = insetTile(tile, tileGap);
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const tileOpacity = tileOpacityForChange(tile.changePercent, opacityScale);
  const fillColor = hovered ? theme.colors.text : tileFillForChange(tile.changePercent, theme.colors);
  const tileRadius = symbolBounds && isOuterSymbolTile(tile, symbolBounds) ? theme.radii.tile : 0;
  drawRaisedTile(
    context,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    tileRadius,
    fillColor,
    hovered ? 1 : tileOpacity,
    theme.colors.shadow
  );

  if (highlighted) {
    const lineWidth = clamp(Math.min(rect.width, rect.height) * 0.025, 2, 4);
    const inset = lineWidth / 2 + 1;
    context.save();
    context.strokeStyle = theme.colors.signal;
    context.lineWidth = lineWidth;
    roundedRectPath(
      context,
      rect.x + inset,
      rect.y + inset,
      Math.max(0, rect.width - inset * 2),
      Math.max(0, rect.height - inset * 2),
      Math.max(0, tileRadius - inset)
    );
    context.stroke();
    context.restore();
  }

  const labelSpace = rect.width - 10;
  if (rect.width < 38 || rect.height < 27 || labelSpace < 24) {
    return;
  }
  const symbolRole = nearestTypeRole(Math.min(rect.width / 5.8, rect.height / 3.4), "titleMd");
  const symbolSize = TYPE_ROLE[symbolRole].size;
  const textColor = hovered ? theme.colors.background : tileTextForOpacity(tileOpacity, theme.colors);
  context.save();
  clipRect(context, rect);
  applyCanvasTypography(context, symbolRole, theme.serif);
  context.fillStyle = textColor;
  context.textBaseline = "top";
  fillFittedText(context, tile.label, rect.x + 6, rect.y + 6, labelSpace);

  if (rect.height < 44) {
    context.restore();
    return;
  }
  applyCanvasTypography(context, nearestTypeRole(symbolSize * 0.72, "bodyMd"), theme.serif);
  context.fillStyle = hovered ? changeTextColor(tile.changePercent, theme) : textColor;
  fillFittedText(context, formatChange(tile.changePercent), rect.x + 6, rect.y + 8 + symbolSize, labelSpace);
  context.restore();
}

function boundsForSymbolTiles(tiles: TreeMapTile[]): TreeMapSymbolBounds | null {
  if (!tiles.length) {
    return null;
  }
  return {
    left: Math.min(...tiles.map((tile) => tile.x)),
    top: Math.min(...tiles.map((tile) => tile.y)),
    right: Math.max(...tiles.map((tile) => tile.x + tile.width)),
    bottom: Math.max(...tiles.map((tile) => tile.y + tile.height))
  };
}

function isOuterSymbolTile(tile: TreeMapTile, bounds: TreeMapSymbolBounds): boolean {
  const tolerance = 0.5;
  return Math.abs(tile.x - bounds.left) <= tolerance ||
    Math.abs(tile.y - bounds.top) <= tolerance ||
    Math.abs(tile.x + tile.width - bounds.right) <= tolerance ||
    Math.abs(tile.y + tile.height - bounds.bottom) <= tolerance;
}

function drawRaisedTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
  alpha: number,
  shadowColor: string
) {
  context.save();
  context.shadowColor = shadowColor;
  context.shadowBlur = 10;
  context.shadowOffsetX = 5;
  context.shadowOffsetY = 5;
  context.fillStyle = fillStyle;
  context.globalAlpha = alpha * 0.16;
  fillRoundedRect(context, x, y, width, height, radius);
  context.restore();

  context.save();
  context.fillStyle = fillStyle;
  context.globalAlpha = alpha;
  fillRoundedRect(context, x, y, width, height, radius);
  context.restore();
}

function changeTextColor(changePercent: number | undefined, theme: TreeMapTheme): string {
  return toneForChange(changePercent) === "down" ? theme.colors.down : theme.colors.up;
}

function fillFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  if (maxWidth <= 8) {
    return;
  }
  const fitted = fitText(context, text, maxWidth);
  if (fitted) {
    context.fillText(fitted, x, y);
  }
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  if (context.measureText(ellipsis).width > maxWidth) {
    return "";
  }
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("")}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("")}${ellipsis}`;
}

function clipRect(context: CanvasRenderingContext2D, rect: TreeMapRect): void {
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
}

function formatChange(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "0.00%";
  }
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

type TreeMapTheme = {
  serif: string;
  colors: ThemeColors;
  radii: {
    tile: number;
    band: number;
  };
};

function readTheme(): TreeMapTheme {
  const root = getComputedStyle(document.documentElement);
  const surfaceRadius = readCssPixelNumber(root, "--surface-radius", 16);
  return {
    serif: root.getPropertyValue("--font-ui-serif").trim() || CANVAS_FONT_FAMILY,
    colors: readThemeColors(),
    radii: {
      tile: readCssPixelNumber(root, "--heatmap-cell-radius", surfaceRadius),
      band: readCssPixelNumber(root, "--heatmap-band-radius", 7)
    }
  };
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = roundedRadius(width, height, radius);
  if (safeRadius <= 0.25) {
    context.fillRect(x, y, width, height);
    return;
  }
  roundedRectPath(context, x, y, width, height, safeRadius);
  context.fill();
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function roundedRadius(width: number, height: number, radius: number): number {
  return clamp(radius, 0, Math.min(width, height) * 0.32);
}

function readCssPixelNumber(root: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(root.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function insetTile(tile: TreeMapTile, gap: number) {
  const inset = Math.min(gap, tile.width / 3, tile.height / 3);
  return {
    x: tile.x + inset,
    y: tile.y + inset,
    width: Math.max(0, tile.width - inset * 2),
    height: Math.max(0, tile.height - inset * 2)
  };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
