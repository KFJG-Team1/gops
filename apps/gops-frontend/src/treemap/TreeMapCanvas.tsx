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

type TreeMapCanvasProps = {
  items: Sp500UniverseItem[];
  onSelectSymbol?: (symbol: string) => void;
  onHoverTileChange?: (tile: TreeMapTile | null) => void;
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
  x: number;
  y: number;
};

const canvasPadding = 4;
const labelPadding = 8;
const tileGap = 0.85;
const hoverPanelMargin = 10;
const hoverPanelOffset = 16;
const hoverPanelHeaderHeight = 28;
const hoverPanelFeaturedHeight = 64;
const hoverPanelRowHeight = 24;
const hoverPanelVerticalPadding = 8;
const hoverPanelMaxRows = 12;

export function TreeMapCanvas({ items, onSelectSymbol, onHoverTileChange, style, className, interactive = true }: TreeMapCanvasProps) {
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
    drawTreeMap(context, size, tiles, hoverState, opacityScale);
  }, [hoverState, opacityScale, size, tiles]);

  const updateHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
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
      return { tile: next, x, y };
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

  const selectHoveredTile = () => {
    if (interactive && hoverState?.tile.symbol && onSelectSymbol) {
      onSelectSymbol(hoverState.tile.symbol);
    }
  };

  return (
    <section className={`treemap-panel${className ? ` ${className}` : ""}`} style={style} aria-label="S&P 500 TreeMap">
      <canvas
        ref={canvasRef}
        className="treemap-canvas"
        style={{ cursor: interactive && hoverState?.tile.symbol ? "pointer" : "default" }}
        aria-label="S&P 500 TreeMap canvas"
        onPointerMove={interactive ? updateHover : undefined}
        onPointerLeave={interactive ? clearHover : undefined}
        onClick={interactive ? selectHoveredTile : undefined}
      />
    </section>
  );
}

function drawTreeMap(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  tiles: TreeMapTile[],
  hoverState: TreeMapHoverState | null,
  opacityScale: TreeMapOpacityScale
) {
  const theme = readTheme();
  context.clearRect(0, 0, size.width, size.height);

  const symbolTiles = tiles.filter((tile) => tile.kind === "symbol");
  const industryTiles = tiles.filter((tile) => tile.kind === "industry");
  const sectorTiles = tiles.filter((tile) => tile.kind === "sector");
  const hoveredTile = hoverState?.tile ?? null;
  const highlightedIndustry = hoveredTile ? industryTiles.find((tile) => tile.id === hoveredTile.parentId) : undefined;
  const symbolBounds = boundsForSymbolTiles(symbolTiles);
  symbolTiles.forEach((tile) => drawSymbol(context, tile, hoveredTile?.id, theme, opacityScale, symbolBounds));
  industryTiles.forEach((tile) => drawIndustry(context, tile, theme, opacityScale, symbolTiles));
  sectorTiles.forEach((tile) => drawSector(context, tile, theme));
  if (highlightedIndustry) {
    drawCategoryHighlight(context, highlightedIndustry, theme);
  }
  if (hoverState) {
    drawHoverPanel(context, size, hoverState, highlightedIndustry, symbolTiles, theme);
  }
}

function drawSector(context: CanvasRenderingContext2D, tile: TreeMapTile, theme: TreeMapTheme) {
  if (tile.width < 92 || tile.height < 34) {
    return;
  }
  const nameFont = `500 14px ${theme.serif}`;
  const changeFont = `500 12px ${theme.serif}`;
  const changeText = formatChange(tile.changePercent);
  context.textBaseline = "top";
  context.font = changeFont;
  const changeWidth = context.measureText(changeText).width;
  const canShowChange = tile.width >= 146;
  const labelMaxWidth = tile.width - labelPadding * 2 - (canShowChange ? changeWidth + 12 : 0);
  context.font = nameFont;
  context.fillStyle = theme.colors.text;
  fillFittedText(context, tile.label, tile.x + labelPadding, tile.y + 7, labelMaxWidth);
  if (canShowChange) {
    context.font = changeFont;
    context.textAlign = "right";
    context.fillStyle = toneForChange(tile.changePercent) === "down" ? theme.colors.changeDown : theme.colors.changeUp;
    context.fillText(changeText, tile.x + tile.width - labelPadding, tile.y + 8);
    context.textAlign = "start";
  }
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
  if (band.height >= 8 && band.width >= 26) {
    const fontSize = clamp(band.height - 3, 7, 10);
    context.font = `500 ${fontSize}px ${theme.serif}`;
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

function drawCategoryHighlight(context: CanvasRenderingContext2D, tile: TreeMapTile, theme: TreeMapTheme) {
  const rect = insetRect(tile, 1.5);
  if (rect.width <= 4 || rect.height <= 4) {
    return;
  }
  context.save();
  context.shadowColor = "rgba(250, 204, 21, 0.55)";
  context.shadowBlur = 10;
  context.lineWidth = clamp(Math.min(rect.width, rect.height) * 0.016, 2.5, 4);
  context.strokeStyle = theme.colors.caution || "#facc15";
  strokeRoundedRect(context, rect.x, rect.y, rect.width, rect.height, Math.min(8, theme.radii.tile));
  context.restore();
}

function drawHoverPanel(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  hoverState: TreeMapHoverState,
  industryTile: TreeMapTile | undefined,
  symbolTiles: TreeMapTile[],
  theme: TreeMapTheme
) {
  const availableWidth = size.width - hoverPanelMargin * 2;
  const availableHeight = size.height - hoverPanelMargin * 2;
  if (availableWidth < 180 || availableHeight < 140) {
    return;
  }

  const categoryTiles = hoverCategorySymbolTiles(symbolTiles, industryTile, hoverState.tile);
  const maxRowsByHeight = Math.floor(
    (availableHeight - hoverPanelHeaderHeight - hoverPanelFeaturedHeight - hoverPanelVerticalPadding) / hoverPanelRowHeight
  );
  const maxRows = Math.max(2, Math.min(hoverPanelMaxRows, maxRowsByHeight));
  const rows = hoverRowsForCategory(categoryTiles, hoverState.tile, maxRows);
  const panelWidth = Math.min(clamp(size.width * 0.35, 286, 410), availableWidth);
  const panelHeight = hoverPanelHeaderHeight + hoverPanelFeaturedHeight + rows.length * hoverPanelRowHeight + hoverPanelVerticalPadding;
  const panel = positionHoverPanel(size, hoverState.x, hoverState.y, panelWidth, panelHeight);
  const featuredY = panel.y + hoverPanelHeaderHeight;
  const rowsY = featuredY + hoverPanelFeaturedHeight;

  context.save();
  context.shadowColor = "rgba(7, 12, 24, 0.34)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 5;
  context.fillStyle = "rgba(248, 250, 252, 0.98)";
  fillRoundedRect(context, panel.x, panel.y, panel.width, panel.height, 3);
  context.restore();

  context.save();
  roundedRectPath(context, panel.x, panel.y, panel.width, panel.height, 3);
  context.clip();
  context.fillStyle = "#ffffff";
  context.fillRect(panel.x, panel.y, panel.width, hoverPanelHeaderHeight);
  context.fillStyle = tileFillForChange(hoverState.tile.changePercent, theme.colors);
  context.fillRect(panel.x, featuredY, panel.width, hoverPanelFeaturedHeight);
  rows.forEach((tile, index) => {
    const rowY = rowsY + index * hoverPanelRowHeight;
    const isHovered = tile.id === hoverState.tile.id;
    context.fillStyle = isHovered
      ? "rgba(232, 239, 247, 0.96)"
      : index % 2 === 0
        ? "rgba(255, 255, 255, 0.98)"
        : "rgba(244, 246, 249, 0.98)";
    context.fillRect(panel.x, rowY, panel.width, hoverPanelRowHeight);
  });
  context.restore();

  context.save();
  context.textAlign = "start";
  context.textBaseline = "top";
  context.font = `700 12px ${theme.serif}`;
  context.fillStyle = "#1f2933";
  fillFittedText(context, hoverCategoryTitle(hoverState.tile).toUpperCase(), panel.x + 12, panel.y + 8, panel.width - 24);

  drawFeaturedHoverTile(context, panel, featuredY, hoverState.tile, theme);
  drawHoverRows(context, panel, rowsY, rows, hoverState.tile, theme);

  context.lineWidth = 1.5;
  context.strokeStyle = "#202733";
  strokeRoundedRect(context, panel.x + 0.75, panel.y + 0.75, panel.width - 1.5, panel.height - 1.5, 3);
  context.restore();
}

function drawFeaturedHoverTile(
  context: CanvasRenderingContext2D,
  panel: TreeMapRect,
  y: number,
  tile: TreeMapTile,
  theme: TreeMapTheme
) {
  const left = panel.x + 12;
  const right = panel.x + panel.width - 12;
  const quoteText = formatHoverQuote(tile);
  context.textBaseline = "top";
  context.font = `700 21px ${theme.serif}`;
  context.fillStyle = "#ffffff";
  fillFittedText(context, tile.symbol || tile.label, left, y + 10, Math.max(72, panel.width * 0.34));

  context.textAlign = "right";
  context.font = `700 19px ${theme.serif}`;
  fillRightFittedText(context, quoteText, right, y + 12, panel.width * 0.56);

  context.textAlign = "start";
  context.font = `600 11px ${theme.serif}`;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  fillFittedText(context, tile.companyName || "", left, y + 36, panel.width - 24);

  const detailText = hoverDetailText(tile);
  if (detailText) {
    context.font = `600 10px ${theme.serif}`;
    context.fillStyle = "rgba(255, 255, 255, 0.76)";
    fillFittedText(context, detailText, left, y + 50, panel.width - 24);
  }
}

function drawHoverRows(
  context: CanvasRenderingContext2D,
  panel: TreeMapRect,
  y: number,
  rows: TreeMapTile[],
  hoveredTile: TreeMapTile,
  theme: TreeMapTheme
) {
  rows.forEach((tile, index) => {
    const rowY = y + index * hoverPanelRowHeight;
    const textY = rowY + 6;
    context.strokeStyle = "rgba(31, 41, 55, 0.1)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(panel.x, rowY);
    context.lineTo(panel.x + panel.width, rowY);
    context.stroke();

    context.textBaseline = "top";
    context.textAlign = "start";
    context.font = `700 11px ${theme.serif}`;
    context.fillStyle = tile.id === hoveredTile.id ? "#111827" : "#202733";
    fillFittedText(context, tile.symbol || tile.label, panel.x + 12, textY, 54);

    if (panel.width >= 350) {
      context.font = `600 10px ${theme.serif}`;
      context.fillStyle = "rgba(31, 41, 55, 0.66)";
      fillFittedText(context, tile.companyName || "", panel.x + 66, textY + 0.5, panel.width - 214);
    }

    context.textAlign = "right";
    context.font = `700 11px ${theme.serif}`;
    context.fillStyle = "#202733";
    fillRightFittedText(context, formatPrice(tile.lastPrice), panel.x + panel.width - 82, textY, 78);
    context.fillStyle = hoverChangeColor(tile.changePercent, theme);
    fillRightFittedText(context, formatChange(tile.changePercent), panel.x + panel.width - 12, textY, 64);
  });
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
  let y = pointerY - height * 0.42;
  if (y + height > size.height - hoverPanelMargin) {
    y = size.height - height - hoverPanelMargin;
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

function hoverChangeColor(changePercent: number | undefined, theme: TreeMapTheme): string {
  const tone = toneForChange(changePercent);
  if (tone === "down") {
    return theme.colors.changeDown;
  }
  if (tone === "up") {
    return theme.colors.changeUp;
  }
  return "#4b5563";
}

function drawSymbol(
  context: CanvasRenderingContext2D,
  tile: TreeMapTile,
  hoveredTileId: string | undefined,
  theme: TreeMapTheme,
  opacityScale: TreeMapOpacityScale,
  symbolBounds: TreeMapSymbolBounds | null
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

  const labelSpace = rect.width - 10;
  if (rect.width < 38 || rect.height < 27 || labelSpace < 24) {
    return;
  }
  const symbolSize = clamp(Math.min(rect.width / 5.8, rect.height / 3.4), 11, 25);
  const textColor = hovered ? theme.colors.background : tileTextForOpacity(tileOpacity, theme.colors);
  context.font = `500 ${symbolSize}px ${theme.serif}`;
  context.fillStyle = textColor;
  context.textBaseline = "top";
  fillFittedText(context, tile.label, rect.x + 6, rect.y + 6, labelSpace);

  if (rect.height < 44) {
    return;
  }
  context.font = `500 ${Math.max(10, symbolSize * 0.72)}px ${theme.serif}`;
  context.fillStyle = hovered ? changeTextColor(tile.changePercent, theme) : textColor;
  fillFittedText(context, formatChange(tile.changePercent), rect.x + 6, rect.y + 8 + symbolSize, labelSpace);
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
  let fitted = text;
  while (fitted.length > 1 && context.measureText(fitted).width > maxWidth) {
    fitted = `${fitted.slice(0, Math.max(1, fitted.length - 4))}...`;
  }
  context.fillText(fitted, x, y);
}

function fillRightFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
  maxWidth: number
) {
  if (maxWidth <= 8) {
    return;
  }
  let fitted = text;
  while (fitted.length > 1 && context.measureText(fitted).width > maxWidth) {
    fitted = `${fitted.slice(0, Math.max(1, fitted.length - 4))}...`;
  }
  context.fillText(fitted, right, y);
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
    serif: root.getPropertyValue("--font-ui-serif").trim() || "\"Times New Roman\", Times, Georgia, serif",
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

function strokeRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = roundedRadius(width, height, radius);
  if (safeRadius <= 0.25) {
    context.strokeRect(x, y, width, height);
    return;
  }
  roundedRectPath(context, x, y, width, height, safeRadius);
  context.stroke();
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

function insetRect(rect: TreeMapRect, gap: number): TreeMapRect {
  const inset = Math.min(gap, rect.width / 3, rect.height / 3);
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - inset * 2),
    height: Math.max(0, rect.height - inset * 2)
  };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
