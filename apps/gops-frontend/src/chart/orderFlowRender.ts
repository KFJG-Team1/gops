import type { ThemeColors } from "../theme/colors";
import { applyCanvasTypography, CANVAS_FONT_FAMILY } from "../theme/typography";
import type { OrderFlowLadder, OrderFlowLadderLevel } from "./orderFlow";

export type OrderFlowLadderRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OrderFlowChartCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type OrderFlowChartRow = {
  y: number;
  bidVolume: number;
  askVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  askImbalance: boolean;
  bidImbalance: boolean;
  isPoc: boolean;
};

export type OrderFlowChartColumnOptions = {
  scaleMax: number;
  priceToY: (price: number) => number;
  candle: OrderFlowChartCandle;
  rows?: OrderFlowChartRow[];
  selected?: boolean;
};

export type OrderFlowPanelRenderOptions = {
  quote?: {
    bidPrice?: number;
    askPrice?: number;
    bidSize?: number;
    askSize?: number;
  } | null;
  lastPrice?: number | null;
  clippedHint?: boolean;
};

const minChartRowHeight = 2;
const chartFooterHeight = 13;
const panelFooterHeight = 16;
const canvasFontFamily = CANVAS_FONT_FAMILY;

export function drawOrderFlowChartColumn(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  ladder: OrderFlowLadder | null,
  theme: ThemeColors,
  options: OrderFlowChartColumnOptions
): void {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const drawHeight = Math.max(1, rect.height - chartFooterHeight);
  const rows = options.rows ?? (ladder
    ? projectOrderFlowChartRows(ladder, options.priceToY, rect.y, rect.y + drawHeight)
    : []);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  if (options.selected) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = theme.caution;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  if (ladder && rows.length) {
    drawTwoSidedColumn(ctx, rect, drawHeight, rows, theme, options);
  }
  drawChartCandle(ctx, rect, drawHeight, options.candle, theme, options.priceToY, options.selected);
  drawColumnFooter(ctx, rect, ladder, theme);
  if (options.selected) {
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = theme.caution;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), Math.max(1, rect.height - 1));
  }
  ctx.restore();
}

export function projectOrderFlowChartRows(
  ladder: OrderFlowLadder,
  priceToY: (price: number) => number,
  top: number,
  bottom: number
): OrderFlowChartRow[] {
  const rows = new Map<number, OrderFlowChartRow>();
  ladder.levels.forEach((level) => {
    const nativeY = priceToY(level.priceBin);
    if (!Number.isFinite(nativeY) || nativeY < top - 2 || nativeY > bottom + 2) {
      return;
    }
    const pixelY = Math.round(nativeY);
    const current = rows.get(pixelY) ?? {
      y: pixelY + 0.5,
      bidVolume: 0,
      askVolume: 0,
      unknownVolume: 0,
      totalVolume: 0,
      delta: 0,
      askImbalance: false,
      bidImbalance: false,
      isPoc: false
    };
    current.bidVolume += Math.max(0, level.bidVolume);
    current.askVolume += Math.max(0, level.askVolume);
    current.unknownVolume += Math.max(0, level.unknownVolume);
    current.totalVolume += Math.max(0, level.totalVolume);
    current.delta += level.delta;
    current.askImbalance ||= level.askImbalance;
    current.bidImbalance ||= level.bidImbalance;
    current.isPoc ||= ladder.pocPriceBin === level.priceBin;
    rows.set(pixelY, current);
  });
  return Array.from(rows.values()).sort((left, right) => left.y - right.y);
}

export function orderFlowChartRowScaleMax(rowSets: OrderFlowChartRow[][]): number {
  return Math.max(
    1,
    ...rowSets.flatMap((rows) => rows.map((row) => Math.max(row.bidVolume, row.askVolume, row.unknownVolume)))
  );
}

export function drawOrderFlowPanelLadder(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  ladder: OrderFlowLadder,
  theme: ThemeColors,
  options: OrderFlowPanelRenderOptions = {}
): void {
  if (!ladder.levels.length || rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const micro = rect.width < 132 || rect.height < 92;
  const compact = micro || rect.width < 190 || rect.height < 132;
  const footerHeight = micro ? 12 : panelFooterHeight;
  const drawHeight = Math.max(24, rect.height - footerHeight);
  const rowHeight = Math.max(3, drawHeight / ladder.levels.length);
  const priceLabel = ladder.maxPrice >= 100 ? ladder.maxPrice.toFixed(2) : ladder.maxPrice.toFixed(2);
  ctx.save();
  applyCanvasTypography(ctx, "caption", canvasFontFamily);
  const measuredGutter = Math.ceil(ctx.measureText(priceLabel).width) + 18;
  const gutterWidth = clamp(measuredGutter, compact ? 34 : 46, Math.min(compact ? 58 : 78, rect.width * 0.32));
  const centerX = rect.x + rect.width / 2;
  const gutterLeft = centerX - gutterWidth / 2;
  const gutterRight = centerX + gutterWidth / 2;
  const leftWidth = Math.max(8, gutterLeft - rect.x - 5);
  const rightWidth = Math.max(8, rect.x + rect.width - gutterRight - 5);
  const maxSideVolume = Math.max(
    1,
    ...ladder.levels.map((level) => Math.max(level.askVolume, level.bidVolume, level.unknownVolume))
  );
  const quoteBidIndex = nearestLevelIndex(ladder.levels, options.quote?.bidPrice);
  const quoteAskIndex = nearestLevelIndex(ladder.levels, options.quote?.askPrice);
  const lastPriceIndex = nearestLevelIndex(ladder.levels, options.lastPrice);
  const labelEvery = micro ? Number.POSITIVE_INFINITY : rowHeight >= 13 ? 1 : Math.ceil(13 / rowHeight);

  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillStyle = theme.surface;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  ladder.levels.forEach((level, index) => {
    const y = rect.y + index * rowHeight;
    const h = Math.max(1, rowHeight - 1);
    drawPanelRowBackground(ctx, rect, y, h, level, ladder, theme, index === lastPriceIndex);
    drawPanelBars(ctx, level, {
      y,
      h,
      leftX: gutterLeft,
      rightX: gutterRight,
      leftWidth,
      rightWidth,
      maxSideVolume,
      showText: !compact && rowHeight >= 12 && rect.width >= 220
    }, theme);
    if (!micro && index === quoteBidIndex) {
      drawQuoteWedge(ctx, gutterLeft - 3, y + h / 2, "left", theme.down, compact ? "-" : formatSize(options.quote?.bidSize));
    }
    if (!micro && index === quoteAskIndex) {
      drawQuoteWedge(ctx, gutterRight + 3, y + h / 2, "right", theme.up, compact ? "-" : formatSize(options.quote?.askSize));
    }
    const showLabel = index % labelEvery === 0 ||
      level.priceBin === ladder.pocPriceBin ||
      index === lastPriceIndex;
    if (showLabel) {
      ctx.globalAlpha = level.priceBin === ladder.pocPriceBin ? 0.96 : 0.78;
      ctx.fillStyle = level.priceBin === ladder.pocPriceBin ? theme.caution : theme.text;
      applyCanvasTypography(ctx, "caption", canvasFontFamily);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(level.priceBin), centerX, y + h / 2, gutterWidth - 4);
    }
  });

  drawPanelCenterGuide(ctx, rect, gutterLeft, gutterRight, theme);
  if (quoteBidIndex !== null && quoteAskIndex !== null) {
    const bidY = rect.y + quoteBidIndex * rowHeight + rowHeight / 2;
    const askY = rect.y + quoteAskIndex * rowHeight + rowHeight / 2;
    ctx.globalAlpha = 0.46;
    ctx.strokeStyle = theme.axis;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gutterLeft, (bidY + askY) / 2);
    ctx.lineTo(gutterRight, (bidY + askY) / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawPanelFooter(ctx, rect, ladder, theme, options.clippedHint, micro);
  ctx.restore();
}

export function drawEstimatedBadge(ctx: CanvasRenderingContext2D, x: number, y: number, theme: ThemeColors): void {
  const label = "estimated";
  ctx.save();
  applyCanvasTypography(ctx, "caption", canvasFontFamily);
  const width = Math.ceil(ctx.measureText(label).width) + 14;
  const height = 16;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = theme.surface;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.38;
  ctx.stroke();
  ctx.globalAlpha = 0.84;
  ctx.fillStyle = theme.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
  ctx.restore();
}

function drawTwoSidedColumn(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  drawHeight: number,
  rows: OrderFlowChartRow[],
  theme: ThemeColors,
  options: OrderFlowChartColumnOptions
): void {
  const centerX = rect.x + rect.width / 2;
  const candleGutter = clamp(rect.width * 0.14, 1, 8);
  const gutterLeft = centerX - candleGutter / 2;
  const gutterRight = centerX + candleGutter / 2;
  const leftWidth = Math.max(0, gutterLeft - rect.x - 1);
  const rightWidth = Math.max(0, rect.x + rect.width - gutterRight - 1);
  const rowHeight = chartRowHeightForRows(rows, 12);
  const showText = rowHeight >= 10.5 && rect.width >= 72;
  rows.forEach((row) => {
    const y = row.y - rowHeight / 2;
    if (y > rect.y + drawHeight || y + rowHeight < rect.y) {
      return;
    }
    const h = Math.max(minChartRowHeight, rowHeight - 1);
    const bidWidth = sideWidth(row.bidVolume, options.scaleMax, leftWidth);
    const askWidth = sideWidth(row.askVolume, options.scaleMax, rightWidth);
    const unknownWidth = sideWidth(row.unknownVolume, options.scaleMax, Math.max(0, rect.width - candleGutter - 2));
    const tone = orderFlowRowTone(row);
    if (unknownWidth > 0.5) {
      ctx.globalAlpha = tone === "unknown" ? 0.48 : 0.28;
      ctx.fillStyle = theme.axis;
      ctx.fillRect(centerX - unknownWidth / 2, y + h / 2 - 0.5, unknownWidth, 1);
    }
    ctx.globalAlpha = 0.68;
    ctx.fillStyle = theme.downSoft;
    ctx.fillRect(gutterLeft - bidWidth, y, bidWidth, h);
    ctx.fillStyle = theme.upSoft;
    ctx.fillRect(gutterRight, y, askWidth, h);
    if (rect.width >= 20) {
      drawImbalanceOutlines(ctx, gutterLeft, gutterRight, y, h, bidWidth, askWidth, row, theme);
    }
    if (showText) {
      drawLevelText(ctx, gutterLeft, gutterRight, y + h / 2, Math.min(leftWidth, rightWidth), row, theme);
    }
  });
  const pocRow = rows.find((row) => row.isPoc);
  if (pocRow) {
    drawPocLine(ctx, rect, pocRow.y, drawHeight, theme);
  }
}

function drawChartCandle(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  drawHeight: number,
  candle: OrderFlowChartCandle,
  theme: ThemeColors,
  priceToY: (price: number) => number,
  selected = false
): void {
  const centerX = rect.x + rect.width / 2;
  const top = rect.y;
  const bottom = rect.y + drawHeight;
  const open = clamp(priceToY(candle.open), top, bottom);
  const close = clamp(priceToY(candle.close), top, bottom);
  const high = clamp(priceToY(candle.high), top, bottom);
  const low = clamp(priceToY(candle.low), top, bottom);
  const up = candle.close >= candle.open;
  const color = selected ? theme.caution : up ? theme.upSoft : theme.downSoft;
  const bodyWidth = Math.max(1, Math.min(7, rect.width * 0.16));
  const bodyTop = Math.min(open, close);
  const bodyHeight = Math.max(2, Math.abs(close - open));
  const bodyBottom = Math.min(bottom, bodyTop + bodyHeight);
  ctx.globalAlpha = 0.96;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = selected ? 1.8 : 1.15;
  ctx.beginPath();
  ctx.moveTo(centerX, high);
  ctx.lineTo(centerX, bodyTop);
  ctx.moveTo(centerX, bodyBottom);
  ctx.lineTo(centerX, low);
  ctx.stroke();
  ctx.fillRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, bodyBottom - bodyTop));
}

function drawColumnFooter(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  ladder: OrderFlowLadder | null,
  theme: ThemeColors
): void {
  const delta = ladder?.totals.delta;
  ctx.globalAlpha = 0.84;
  ctx.fillStyle = !ladder ? theme.muted : ladderTone(ladder) === "unknown" ? theme.axis : (delta ?? 0) >= 0 ? theme.upSoft : theme.downSoft;
  applyCanvasTypography(ctx, "caption", canvasFontFamily);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const fallback = !ladder ? "—" : (delta ?? 0) >= 0 ? "+" : "-";
  const preferred = !ladder ? "Δ—" : `Δ${shortSignedNumber(delta ?? 0)}`;
  const label = ctx.measureText(preferred).width <= rect.width - 4 ? preferred : fallback;
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height - 3);
}

function orderFlowRowTone(row: OrderFlowChartRow): "ask" | "bid" | "unknown" {
  const directional = Math.max(0, row.askVolume) + Math.max(0, row.bidVolume);
  if (row.unknownVolume > 0 && row.unknownVolume >= directional) {
    return "unknown";
  }
  return row.delta >= 0 ? "ask" : "bid";
}

function ladderTone(ladder: OrderFlowLadder): "ask" | "bid" | "unknown" {
  const unknown = Math.max(0, ladder.totals.unknownVolume);
  const directional = Math.max(0, ladder.totals.askVolume) + Math.max(0, ladder.totals.bidVolume);
  if (unknown > 0 && unknown >= directional) {
    return "unknown";
  }
  return ladder.totals.delta >= 0 ? "ask" : "bid";
}

function drawPanelRowBackground(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  y: number,
  h: number,
  level: OrderFlowLadderLevel,
  ladder: OrderFlowLadder,
  theme: ThemeColors,
  isLastPrice: boolean
): void {
  const intensity = clamp(Math.abs(level.delta) / Math.max(1, ladder.maxLevelVolume), 0.06, 0.35);
  ctx.globalAlpha = level.priceBin === ladder.pocPriceBin ? 0.28 : intensity;
  ctx.fillStyle = level.delta >= 0 ? theme.upSoft : theme.downSoft;
  ctx.fillRect(rect.x + 1, y, rect.width - 2, h);
  if (isLastPrice) {
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = theme.signal;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 2, y + 0.5, rect.width - 4, Math.max(1, h - 1));
  }
}

function drawPanelBars(
  ctx: CanvasRenderingContext2D,
  level: OrderFlowLadderLevel,
  geometry: {
    y: number;
    h: number;
    leftX: number;
    rightX: number;
    leftWidth: number;
    rightWidth: number;
    maxSideVolume: number;
    showText: boolean;
  },
  theme: ThemeColors
): void {
  const bidWidth = sideWidth(level.bidVolume, geometry.maxSideVolume, geometry.leftWidth);
  const askWidth = sideWidth(level.askVolume, geometry.maxSideVolume, geometry.rightWidth);
  const unknownWidth = sideWidth(level.unknownVolume, geometry.maxSideVolume, geometry.leftWidth + geometry.rightWidth);
  ctx.globalAlpha = 0.76;
  ctx.fillStyle = theme.downSoft;
  ctx.fillRect(geometry.leftX - bidWidth, geometry.y + 1, bidWidth, Math.max(1, geometry.h - 2));
  ctx.fillStyle = theme.upSoft;
  ctx.fillRect(geometry.rightX, geometry.y + 1, askWidth, Math.max(1, geometry.h - 2));
  if (unknownWidth > 1) {
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = theme.axis;
    ctx.fillRect(geometry.leftX - unknownWidth / 2, geometry.y + geometry.h / 2 - 0.75, unknownWidth, 1.5);
  }
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  if (level.bidImbalance && bidWidth > 0.5) {
    ctx.strokeStyle = theme.down;
    ctx.strokeRect(geometry.leftX - bidWidth, geometry.y + 0.5, bidWidth, Math.max(1, geometry.h - 1));
  }
  if (level.askImbalance && askWidth > 0.5) {
    ctx.strokeStyle = theme.up;
    ctx.strokeRect(geometry.rightX, geometry.y + 0.5, askWidth, Math.max(1, geometry.h - 1));
  }
  if (geometry.showText) {
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = theme.text;
    applyCanvasTypography(ctx, "caption", canvasFontFamily);
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(shortNumber(level.bidVolume), geometry.leftX - 3, geometry.y + geometry.h / 2, geometry.leftWidth - 5);
    ctx.textAlign = "left";
    ctx.fillText(shortNumber(level.askVolume), geometry.rightX + 3, geometry.y + geometry.h / 2, geometry.rightWidth - 5);
  }
}

function drawPanelCenterGuide(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  gutterLeft: number,
  gutterRight: number,
  theme: ThemeColors
): void {
  ctx.globalAlpha = 0.36;
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gutterLeft, rect.y);
  ctx.lineTo(gutterLeft, rect.y + rect.height - panelFooterHeight);
  ctx.moveTo(gutterRight, rect.y);
  ctx.lineTo(gutterRight, rect.y + rect.height - panelFooterHeight);
  ctx.stroke();
}

function drawPanelFooter(
  ctx: CanvasRenderingContext2D,
  rect: OrderFlowLadderRect,
  ladder: OrderFlowLadder,
  theme: ThemeColors,
  clippedHint: boolean | undefined,
  micro: boolean
): void {
  const y = rect.y + rect.height - 2;
  const footerHeight = micro ? 12 : panelFooterHeight;
  ctx.globalAlpha = micro ? 0.52 : 0.68;
  ctx.fillStyle = theme.surface;
  ctx.fillRect(rect.x, rect.y + rect.height - footerHeight, rect.width, footerHeight);
  if (micro) {
    return;
  }
  applyCanvasTypography(ctx, "caption", canvasFontFamily);
  ctx.textBaseline = "bottom";
  ctx.textAlign = "right";
  const poc = ladder.pocPriceBin === null ? "POC -" : `POC ${formatPrice(ladder.pocPriceBin)}`;
  const label = clippedHint ? `${poc} · clipped` : poc;
  if (clippedHint) {
    const pillWidth = Math.min(rect.width * 0.62, ctx.measureText(label).width + 12);
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = theme.surfaceStrong;
    roundRect(ctx, rect.x + rect.width - pillWidth - 1, y - 13, pillWidth, 14, 4);
    ctx.fill();
    ctx.globalAlpha = 0.9;
  }
  ctx.fillStyle = theme.muted;
  ctx.fillText(label, rect.x + rect.width - 4, y, rect.width * 0.6);
}

function drawPocLine(ctx: CanvasRenderingContext2D, rect: OrderFlowLadderRect, y: number, drawHeight: number, theme: ThemeColors): void {
  if (y < rect.y || y > rect.y + drawHeight) {
    return;
  }
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = theme.caution;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + 1, y);
  ctx.lineTo(rect.x + rect.width - 1, y);
  ctx.stroke();
}

function drawQuoteWedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: "left" | "right",
  color: string,
  label: string
): void {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === "left") {
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6, y - 4);
    ctx.lineTo(x - 6, y + 4);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y - 4);
    ctx.lineTo(x + 6, y + 4);
  }
  ctx.closePath();
  ctx.fill();
  if (label !== "-") {
    ctx.globalAlpha = 0.75;
    applyCanvasTypography(ctx, "caption", canvasFontFamily);
    ctx.textAlign = direction === "left" ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, direction === "left" ? x - 8 : x + 8, y, 38);
  }
  ctx.restore();
}

function drawImbalanceOutlines(
  ctx: CanvasRenderingContext2D,
  gutterLeft: number,
  gutterRight: number,
  y: number,
  h: number,
  bidWidth: number,
  askWidth: number,
  level: Pick<OrderFlowChartRow, "askImbalance" | "bidImbalance">,
  theme: ThemeColors
): void {
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  if (level.bidImbalance && bidWidth > 0.5) {
    ctx.strokeStyle = theme.down;
    ctx.strokeRect(gutterLeft - bidWidth, y + 0.5, bidWidth, Math.max(1, h - 1));
  }
  if (level.askImbalance && askWidth > 0.5) {
    ctx.strokeStyle = theme.up;
    ctx.strokeRect(gutterRight, y + 0.5, askWidth, Math.max(1, h - 1));
  }
}

function drawLevelText(
  ctx: CanvasRenderingContext2D,
  gutterLeft: number,
  gutterRight: number,
  y: number,
  halfWidth: number,
  level: Pick<OrderFlowChartRow, "askVolume" | "bidVolume">,
  theme: ThemeColors
): void {
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = theme.text;
  applyCanvasTypography(ctx, "caption", canvasFontFamily);
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(shortNumber(level.bidVolume), gutterLeft - 3, y, halfWidth - 5);
  ctx.textAlign = "left";
  ctx.fillText(shortNumber(level.askVolume), gutterRight + 3, y, halfWidth - 5);
}

function chartRowHeightForRows(rows: OrderFlowChartRow[], cap: number): number {
  if (rows.length <= 1) {
    return Math.max(minChartRowHeight, Math.min(cap, cap * 0.8));
  }
  const distances = rows
    .map((row) => row.y)
    .slice(1)
    .map((y, index) => Math.abs(y - rows[index].y))
    .filter((distance) => Number.isFinite(distance) && distance > 0);
  const stepY = distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : minChartRowHeight;
  return Math.max(minChartRowHeight, Math.min(cap, stepY * 0.86));
}

function sideWidth(volume: number, maxVolume: number, maxWidth: number): number {
  return Math.max(0, maxWidth * Math.sqrt(clamp(Math.max(0, volume) / Math.max(1, maxVolume), 0, 1)));
}

function nearestLevelIndex(levels: OrderFlowLadderLevel[], price: number | undefined | null): number | null {
  if (typeof price !== "number" || !Number.isFinite(price) || !levels.length) {
    return null;
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  levels.forEach((level, index) => {
    const distance = Math.abs(level.priceBin - price);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

function formatSize(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return shortNumber(value);
}

function shortNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return String(Math.round(value));
}

function shortSignedNumber(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
