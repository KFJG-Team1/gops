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

const canvasPadding = 4;
const labelPadding = 8;
const tileGap = 0.85;

export function TreeMapCanvas({ items, onSelectSymbol, style, className, interactive = true }: TreeMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesRef = useRef<TreeMapTile[]>([]);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1 });
  const [hoveredTile, setHoveredTile] = useState<TreeMapTile | null>(null);

  const inputItems = useMemo((): TreeMapInputItem[] => items.map((item) => ({
    symbol: item.symbol,
    companyName: item.companyName,
    sector: item.sector,
    sectorLabelKo: item.sectorLabelKo,
    industry: item.industry,
    value: sp500WeightValue(item),
    marketCap: item.layoutMarketCap ?? item.marketCap,
    indexWeight: item.indexWeight,
    changePercent: item.changePercent
  })), [items]);

  const tiles = useMemo(() => layoutSp500TreeMap(inputItems, {
    x: canvasPadding,
    y: canvasPadding,
    width: Math.max(1, size.width - canvasPadding * 2),
    height: Math.max(1, size.height - canvasPadding * 2)
  }), [inputItems, size.height, size.width]);
  const opacityScale = useMemo(() => createTreeMapOpacityScale(inputItems.map((item) => item.changePercent)), [inputItems]);

  const hoverMetaLeft = useMemo(() => {
    const symbolTiles = tiles.filter((tile) => tile.kind === "symbol");
    if (!symbolTiles.length) {
      return canvasPadding;
    }
    return Math.min(...symbolTiles.map((tile) => insetTile(tile, tileGap).x));
  }, [tiles]);

  const panelStyle = {
    ...style,
    "--treemap-hover-meta-left": `${Math.round(hoverMetaLeft)}px`
  } as CSSProperties;

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
    drawTreeMap(context, size, tiles, hoveredTile, opacityScale);
  }, [hoveredTile, opacityScale, size, tiles]);

  const updateHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const next = hitTestTreeMapTile(tilesRef.current, x, y) ?? null;
    setHoveredTile((current) => current?.id === next?.id ? current : next);
  };

  const selectHoveredTile = () => {
    if (interactive && hoveredTile?.symbol && onSelectSymbol) {
      onSelectSymbol(hoveredTile.symbol);
    }
  };

  return (
    <section className={`treemap-panel${className ? ` ${className}` : ""}`} style={panelStyle} aria-label="S&P 500 TreeMap">
      <canvas
        ref={canvasRef}
        className="treemap-canvas"
        style={{ cursor: interactive && hoveredTile?.symbol ? "pointer" : "default" }}
        aria-label="S&P 500 TreeMap canvas"
        onPointerMove={interactive ? updateHover : undefined}
        onPointerLeave={interactive ? () => setHoveredTile(null) : undefined}
        onClick={interactive ? selectHoveredTile : undefined}
      />
      {interactive && hoveredTile?.symbol && (
        <div className="treemap-hover-meta" aria-live="polite">
          <strong>{hoveredTile.symbol}</strong>
          <span>{hoveredTile.companyName}</span>
          <em>{formatChange(hoveredTile.changePercent)}</em>
          <small>{hoveredTile.sectorLabelKo || hoveredTile.sector} / {hoveredTile.industry}</small>
        </div>
      )}
    </section>
  );
}

function drawTreeMap(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  tiles: TreeMapTile[],
  hoveredTile: TreeMapTile | null,
  opacityScale: TreeMapOpacityScale
) {
  const theme = readTheme();
  context.clearRect(0, 0, size.width, size.height);

  const symbolTiles = tiles.filter((tile) => tile.kind === "symbol");
  const industryTiles = tiles.filter((tile) => tile.kind === "industry");
  const symbolBounds = boundsForSymbolTiles(symbolTiles);
  symbolTiles.forEach((tile) => drawSymbol(context, tile, hoveredTile?.id, theme, opacityScale, symbolBounds));
  industryTiles.forEach((tile) => drawIndustry(context, tile, theme, opacityScale, symbolTiles));
  tiles.filter((tile) => tile.kind === "sector").forEach((tile) => drawSector(context, tile, theme));
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
