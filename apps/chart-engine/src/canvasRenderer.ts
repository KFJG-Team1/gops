import { createCoordinateTransform } from "./scales";
import { normalizeLineExtension, projectTrendLine } from "./drawingGeometry";
import type { CandleData, DrawingEntity, RenderScene } from "./types";
import { resolveChartStyleColor } from "./theme";

const chartCandleRadius = 3;

export function drawChartScene(
  canvas: HTMLCanvasElement,
  scene: RenderScene,
  dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = Math.max(1, Math.floor(scene.width * dpr));
  canvas.height = Math.max(1, Math.floor(scene.height * dpr));
  canvas.style.width = `${scene.width}px`;
  canvas.style.height = `${scene.height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.fillStyle = scene.document.style.background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  if (scene.state !== "ready") {
    drawState(ctx, scene);
    return;
  }

  drawGrid(ctx, scene);
  drawVolume(ctx, scene);
  drawCandles(ctx, scene);
  drawComparisons(ctx, scene);
  drawMovingAverage(ctx, scene, "ma60", scene.document.style.ma60);
  drawMovingAverage(ctx, scene, "ma20", scene.document.style.ma20);
  drawMovingAverage(ctx, scene, "ma5", scene.document.style.ma5);
  drawDrawings(ctx, scene, scene.document.drawings, false);
  if (scene.pendingPreview?.visible) {
    drawDrawings(ctx, scene, scene.pendingPreview.drawings, true);
    drawPreviewComparisons(ctx, scene);
  }
  drawCrosshair(ctx, scene);
  drawAxes(ctx, scene);
}

function drawState(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  ctx.fillStyle = scene.document.style.text;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapCanvasText(ctx, scene.message ?? scene.state, Math.max(120, scene.width - 72));
  const lineHeight = 18;
  const startY = scene.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, scene.width / 2, startY + index * lineHeight);
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = word;
      return;
    }
    lines.push(word);
  });
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [text];
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  const { left, right, top, priceBottom, volumeTop, bottom } = scene.plot;
  ctx.strokeStyle = scene.document.style.grid;
  ctx.lineWidth = 1;

  for (let index = 0; index <= 5; index += 1) {
    const y = top + ((priceBottom - top) * index) / 5;
    line(ctx, left, y, right, y);
  }

  for (let index = 0; index <= 5; index += 1) {
    const x = left + ((right - left) * index) / 5;
    line(ctx, x, top, x, bottom);
  }

  line(ctx, left, volumeTop, right, volumeTop);
}

function drawCandles(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  if (!scene.document.layers.candles) {
    return;
  }

  scene.candles.forEach((candle, index) => {
    const x = candleCenter(scene, index);
    const openY = priceY(scene, candle.open);
    const closeY = priceY(scene, candle.close);
    const highY = priceY(scene, candle.high);
    const lowY = priceY(scene, candle.low);
    const isUp = candle.close >= candle.open;
    const color = isUp ? scene.document.style.bullish : scene.document.style.bearish;
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
    const bodyWidth = scene.scales.candleWidth;
    const bodyX = x - bodyWidth / 2;

    ctx.save();
    if (candle.displayOnly || candle.synthetic) {
      ctx.globalAlpha = 0.42;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    line(ctx, x, highY, x, lowY);
    roundedRect(ctx, bodyX, bodyTop, bodyWidth, bodyHeight, candleBodyRadius(bodyWidth, bodyHeight));
    ctx.fill();
    ctx.restore();
  });
}

function drawVolume(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  if (!scene.document.layers.volume) {
    return;
  }

  const volumeHeight = scene.plot.bottom - scene.plot.volumeTop;
  scene.candles.forEach((candle, index) => {
    if (candle.volume <= 0) {
      return;
    }
    const x = candleCenter(scene, index);
    const height = Math.max(1, (candle.volume / scene.scales.maxVolume) * volumeHeight);
    const y = scene.plot.bottom - height;

    ctx.fillStyle = scene.document.style.volume;
    ctx.fillRect(x - scene.scales.candleWidth / 2, y, scene.scales.candleWidth, height);
  });
}

function drawMovingAverage(ctx: CanvasRenderingContext2D, scene: RenderScene, key: "ma5" | "ma20" | "ma60", color: string) {
  if (!scene.document.layers[key]) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;

  scene.candles.forEach((candle, index) => {
    const value = candle[key];
    if (typeof value !== "number") {
      return;
    }
    const x = candleCenter(scene, index);
    const y = priceY(scene, value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });

  if (started) {
    ctx.stroke();
  }
}

function drawComparisons(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  scene.comparisonSeries.forEach((series, index) => {
    if (series.points.length < 2) {
      return;
    }
    const defaultToken = comparisonDefaultColorToken(index);
    ctx.save();
    ctx.globalAlpha = series.comparison.style.opacity ?? 1;
    ctx.strokeStyle = resolveDrawingColor(scene, series.comparison.style, "colorToken", "color", defaultToken);
    ctx.lineWidth = series.comparison.style.lineWidth ?? 1.4;
    ctx.setLineDash(series.comparison.style.lineDash ?? []);
    ctx.beginPath();
    series.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    const last = series.points[series.points.length - 1];
    if (last) {
      ctx.fillStyle = resolveDrawingColor(scene, series.comparison.style, "textToken", "textColor", defaultToken);
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${series.comparison.label ?? series.comparison.symbol} ${last.percent >= 0 ? "+" : ""}${last.percent.toFixed(2)}%`, scene.plot.right, last.y - 8);
    }
    ctx.restore();
  });
}

function comparisonDefaultColorToken(index: number): keyof RenderScene["document"]["style"] {
  if (index === 0) {
    return "signal";
  }
  if (index === 1) {
    return "caution";
  }
  if (index === 2) {
    return "purple";
  }
  return "drawing";
}

function drawPreviewComparisons(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  const previewComparisons = scene.pendingPreview?.comparisons ?? [];
  if (previewComparisons.length === 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = colorWithAlpha(scene.document.style.text, 0.74);
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  previewComparisons.forEach((comparison, index) => {
    ctx.fillText(`비교 미리보기: ${comparison.label ?? comparison.symbol}`, scene.plot.left, scene.plot.top + 16 + index * 15);
  });
  ctx.restore();
}

function drawDrawings(ctx: CanvasRenderingContext2D, scene: RenderScene, drawings: DrawingEntity[], preview: boolean) {
  const transform = createCoordinateTransform(scene);
  drawings.filter((drawing) => drawing.visible !== false).forEach((drawing) => {
    const selected = !preview && scene.document.selectedDrawingId === drawing.id;
    const style = drawing.style ?? {};
    ctx.save();
    ctx.globalAlpha = preview ? 0.58 : style.opacity ?? 1;
    ctx.strokeStyle = resolveDrawingColor(scene, style, "colorToken", "color", preview ? "preview" : "drawing");
    ctx.fillStyle = style.fillColor ?? colorWithAlpha(
      resolveDrawingColor(scene, style, "fillToken", "fillColor", preview ? "preview" : "drawing"),
      preview ? 0.08 : 0.08
    );
    ctx.lineWidth = selected ? Math.max(1.8, style.lineWidth ?? 1.0) : style.lineWidth ?? 1.0;
    ctx.setLineDash(preview ? [6, 4] : style.lineDash ?? []);
    const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is { x: number; y: number } => Boolean(point));

    if (drawing.type === "horizontalLine" && points[0]) {
      line(ctx, scene.plot.left, points[0].y, scene.plot.right, points[0].y);
      drawDrawingLabel(ctx, scene, drawing.label, scene.plot.right - 4, points[0].y - 8, drawing);
    } else if (drawing.type === "verticalMarker" && points[0]) {
      line(ctx, points[0].x, scene.plot.top, points[0].x, scene.plot.priceBottom);
      drawDrawingLabel(ctx, scene, drawing.label, points[0].x + 5, scene.plot.top + 12, drawing);
    } else if (drawing.type === "trendLine" && points.length >= 2) {
      const [start, end] = projectTrendLine(points[0], points[1], scene.plot, normalizeLineExtension(style.extension));
      line(ctx, start.x, start.y, end.x, end.y);
      drawDrawingLabel(ctx, scene, drawing.label ?? lineMetricLabel(drawing, scene), (start.x + end.x) / 2, (start.y + end.y) / 2 - 8, drawing);
    } else if (drawing.type === "rangeBox" && points.length >= 2) {
      const x = Math.min(points[0].x, points[1].x);
      const y = Math.min(points[0].y, points[1].y);
      const width = Math.abs(points[1].x - points[0].x);
      const height = Math.abs(points[1].y - points[0].y);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      drawDrawingLabel(ctx, scene, drawing.label, x + 5, y + 13, drawing);
    } else if ((drawing.type === "pointMarker" || drawing.type === "textLabel") && points[0]) {
      circle(ctx, points[0].x, points[0].y, drawing.type === "pointMarker" ? 4 : 3);
      ctx.fill();
      drawDrawingLabel(ctx, scene, drawing.label ?? (drawing.type === "textLabel" ? "메모" : ""), points[0].x + 7, points[0].y - 7, drawing);
    }

    if (selected && points.length > 0) {
      ctx.setLineDash([]);
      ctx.fillStyle = scene.document.style.surface;
      ctx.strokeStyle = scene.document.style.drawing;
      points.forEach((point) => {
        circle(ctx, point.x, point.y, 4);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  });
}

function drawDrawingLabel(ctx: CanvasRenderingContext2D, scene: RenderScene, label: string | undefined, x: number, y: number, drawing: DrawingEntity) {
  if (!label) {
    return;
  }
  const style = drawing.style ?? {};
  ctx.fillStyle = resolveDrawingColor(scene, style, "textToken", "textColor", "drawing");
  ctx.font = `${style.fontSize ?? 12}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}

function lineMetricLabel(drawing: DrawingEntity, scene: RenderScene): string | undefined {
  if (drawing.type !== "trendLine") {
    return undefined;
  }
  const [start, end] = drawing.anchors;
  if (typeof start?.price !== "number" || typeof end?.price !== "number") {
    return undefined;
  }
  const delta = end.price - start.price;
  const percent = (delta / Math.max(0.0001, start.price)) * 100;
  const startIndex = scene.allCandles.findIndex((candle) => candle.timestamp === start.timestamp);
  const endIndex = scene.allCandles.findIndex((candle) => candle.timestamp === end.timestamp);
  const bars = startIndex >= 0 && endIndex >= 0
    ? Math.abs(endIndex - startIndex)
    : typeof start.logicalIndex === "number" && typeof end.logicalIndex === "number"
      ? Math.abs(end.logicalIndex - start.logicalIndex)
      : 0;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} / ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}% / ${bars}봉`;
}

function resolveDrawingColor(
  scene: RenderScene,
  style: DrawingEntity["style"],
  tokenKey: "colorToken" | "fillToken" | "textToken",
  rawKey: "color" | "fillColor" | "textColor",
  fallback: keyof RenderScene["document"]["style"]
): string {
  const raw = style[rawKey];
  if (raw) {
    return raw;
  }
  return resolveChartStyleColor(scene.document.style, style[tokenKey], fallback);
}

function drawAxes(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  const { top, priceBottom, bottom } = scene.plot;
  const priceLabelX = scene.width - 6;
  ctx.fillStyle = scene.document.style.text;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  ctx.textAlign = "right";
  for (let index = 0; index <= 5; index += 1) {
    const ratio = index / 5;
    const value = scene.scales.maxPrice - (scene.scales.maxPrice - scene.scales.minPrice) * ratio;
    const y = top + (priceBottom - top) * ratio;
    ctx.fillText(value.toFixed(2), priceLabelX, y);
  }

  const ticks = buildTimeTicks(scene, 6);
  ticks.forEach((tick, index) => {
    ctx.textAlign = index === 0 ? "left" : index === ticks.length - 1 ? "right" : "center";
    ctx.fillText(formatTime(tick.candle, scene.document.timeframe), tick.x, bottom + 13);
  });
}

function drawCrosshair(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  const crosshair = scene.crosshair;
  if (!crosshair) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = colorWithAlpha(scene.document.style.crosshair, 0.42);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  line(ctx, crosshair.x, scene.plot.top, crosshair.x, scene.plot.bottom);
  line(ctx, scene.plot.left, crosshair.y, scene.plot.right, crosshair.y);
  ctx.setLineDash([]);

  const candle = crosshair.candle;
  const isUp = candle.close >= candle.open;
  const text = `${formatTime(candle, scene.document.timeframe)} O ${candle.open.toFixed(2)} H ${candle.high.toFixed(2)} L ${candle.low.toFixed(2)} C ${candle.close.toFixed(2)}`;
  ctx.font = "11px Inter, system-ui, sans-serif";
  const textWidth = Math.min(scene.plot.right - scene.plot.left - 12, ctx.measureText(text).width + 12);
  const boxX = Math.min(scene.plot.right - textWidth, Math.max(scene.plot.left, crosshair.x + 8));
  const boxY = scene.plot.top + 8;
  ctx.fillStyle = colorWithAlpha(scene.document.style.surfaceStrong, 0.92);
  ctx.strokeStyle = colorWithAlpha(scene.document.style.drawing, 0.72);
  roundedRect(ctx, boxX, boxY, textWidth, 25, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = isUp ? scene.document.style.bullish : scene.document.style.bearish;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, boxX + 6, boxY + 13, textWidth - 12);
  ctx.restore();
}

function priceY(scene: RenderScene, value: number): number {
  const range = Math.max(0.0001, scene.scales.maxPrice - scene.scales.minPrice);
  const ratio = (scene.scales.maxPrice - value) / range;
  return scene.plot.top + ratio * (scene.plot.priceBottom - scene.plot.top);
}

function candleCenter(scene: RenderScene, index: number): number {
  const slot = (scene.plot.right - scene.plot.left) / Math.max(1, scene.candles.length);
  return scene.plot.left + slot * index + slot / 2;
}

function candleBodyRadius(width: number, height: number): number {
  return Math.min(chartCandleRadius, width * 0.34, height / 2);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function formatTime(candle: CandleData, timeframe = "1m"): string {
  const date = new Date(candle.timestamp);
  if (!Number.isFinite(date.getTime())) {
    return candle.timestamp;
  }
  if (timeframe === "1M") {
    return `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}`;
  }
  if (timeframe === "1W" || timeframe === "1D") {
    return `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`;
  }
  const parts = new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}.${read("month")}.${read("day")} ${read("hour")}:${read("minute")}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildTimeTicks(scene: RenderScene, targetCount: number): Array<{ candle: CandleData; x: number }> {
  if (scene.candles.length === 0) {
    return [];
  }
  const count = Math.min(targetCount, scene.candles.length);
  if (count === 1) {
    return [{ candle: scene.candles[0], x: scene.plot.left }];
  }
  const seen = new Set<number>();
  return Array.from({ length: count }, (_, index) => {
    const candleIndex = Math.round((index * (scene.candles.length - 1)) / (count - 1));
    const uniqueIndex = seen.has(candleIndex)
      ? Math.min(scene.candles.length - 1, Math.max(0, candleIndex + index - seen.size))
      : candleIndex;
    seen.add(uniqueIndex);
    const x = index === 0
      ? scene.plot.left
      : index === count - 1
        ? scene.plot.right
        : candleCenter(scene, uniqueIndex);
    return { candle: scene.candles[uniqueIndex], x };
  }).filter((tick): tick is { candle: CandleData; x: number } => Boolean(tick.candle));
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = parseRgb(color);
  if (!rgb) {
    return color;
  }
  const { red, green, blue } = rgb;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function parseRgb(color: string): { red: number; green: number; blue: number } | null {
  const value = color.trim();
  const hex = value.replace(/^#/, "");
  if (/^[\da-fA-F]{6}$/.test(hex)) {
    const parsed = Number.parseInt(hex, 16);
    return {
      red: (parsed >> 16) & 255,
      green: (parsed >> 8) & 255,
      blue: parsed & 255
    };
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) {
    return null;
  }
  return {
    red: clampColor(Number.parseFloat(rgb[1] ?? "0")),
    green: clampColor(Number.parseFloat(rgb[2] ?? "0")),
    blue: clampColor(Number.parseFloat(rgb[3] ?? "0"))
  };
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}
