import { createCoordinateTransform } from "./scales";
import {
  buildHorizontalParallelLines,
  buildFibonacciLevelGeometry,
  buildRiskRewardGeometry,
  buildTrendParallelLines,
  buildVerticalParallelLines,
  fibonacciBandPolygons,
  normalizeLineExtension,
  normalizeParallelLineCount,
  parallelBandPolygons,
  projectTrendLine,
  riskRewardDirection,
  trendParallelBaseLineIndex,
  type DrawingLine,
  type DrawingPoint
} from "./drawingGeometry";
import type { CandleData, DrawingEntity, RenderScene } from "./types";
import { resolveChartStyleColor } from "./theme";

const chartCandleRadius = 3;
const canvasFontFamily = '"Asta Sans", Arial, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const canvasTypeSize = {
  micro: 10,
  compact: 12,
  body: 14,
  title: 18,
  display: 32
} as const;

function nearestCanvasTypeSize(value: number): number {
  return Object.values(canvasTypeSize).reduce((nearest, size) => (
    Math.abs(size - value) <= Math.abs(nearest - value) ? size : nearest
  ), canvasTypeSize.micro);
}

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
  drawDrawingFills(ctx, scene, scene.document.drawings, false);
  if (scene.pendingPreview?.visible) {
    drawDrawingFills(ctx, scene, scene.pendingPreview.drawings, true);
  }
  drawVolume(ctx, scene);
  drawCandles(ctx, scene);
  drawComparisons(ctx, scene);
  drawMovingAverage(ctx, scene, "ma60", scene.document.style.ma60);
  drawMovingAverage(ctx, scene, "ma20", scene.document.style.ma20);
  drawMovingAverage(ctx, scene, "ma5", scene.document.style.ma5);
  drawDrawingForeground(ctx, scene, scene.document.drawings, false);
  if (scene.pendingPreview?.visible) {
    drawDrawingForeground(ctx, scene, scene.pendingPreview.drawings, true);
    drawPreviewComparisons(ctx, scene);
  }
  drawDrawingSelectionHandles(ctx, scene);
  drawCrosshair(ctx, scene);
  drawAxes(ctx, scene);
}

function drawState(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  ctx.fillStyle = scene.document.style.text;
  ctx.font = `${canvasTypeSize.compact}px ${canvasFontFamily}`;
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

    ctx.fillStyle = candle.close >= candle.open
      ? scene.document.style.bullish
      : scene.document.style.bearish;
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
      ctx.font = `${canvasTypeSize.compact}px ${canvasFontFamily}`;
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
  ctx.font = `${canvasTypeSize.compact}px ${canvasFontFamily}`;
  ctx.textAlign = "left";
  previewComparisons.forEach((comparison, index) => {
    ctx.fillText(`비교 미리보기: ${comparison.label ?? comparison.symbol}`, scene.plot.left, scene.plot.top + 16 + index * 15);
  });
  ctx.restore();
}

function drawDrawingFills(ctx: CanvasRenderingContext2D, scene: RenderScene, drawings: DrawingEntity[], preview: boolean) {
  const transform = createCoordinateTransform(scene);
  drawings.filter((drawing) => drawing.visible !== false).forEach((drawing) => {
    const style = drawing.style ?? {};
    const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is { x: number; y: number } => Boolean(point));
    if (drawing.type === "riskRewardBox" && points.length === 2) {
      ctx.save();
      clipToPricePlot(ctx, scene);
      ctx.globalAlpha = clampOpacity(style.opacity, 1) * (preview ? 0.72 : 1) * Math.min(clampOpacity(style.fillOpacity, 0.075), 0.045);
      ctx.fillStyle = resolveDrawingColor(scene, style, "fillToken", "fillColor", preview ? "preview" : "drawing");
      ctx.fillRect(
        Math.min(points[0].x, points[1].x),
        Math.min(points[0].y, points[1].y),
        Math.abs(points[1].x - points[0].x),
        Math.abs(points[1].y - points[0].y)
      );
      ctx.restore();
      return;
    }
    if (drawing.type === "riskRewardBox" && points.length >= 3) {
      const direction = riskRewardDirection(
        drawing.anchors[0].price ?? drawing.anchors[0].value ?? Number.NaN,
        drawing.anchors[1].price ?? drawing.anchors[1].value ?? Number.NaN,
        drawing.anchors[2].price ?? drawing.anchors[2].value ?? Number.NaN
      );
      if (direction) {
        const geometry = buildRiskRewardGeometry(points[0], points[1], points[2], direction);
        ctx.save();
        clipToPricePlot(ctx, scene);
        ctx.globalAlpha = clampOpacity(style.opacity, 1) * (preview ? 0.72 : 1) * clampOpacity(style.fillOpacity, 0.075);
        ctx.fillStyle = scene.document.style.bullish;
        fillPolygon(ctx, geometry.rewardPolygon);
        ctx.fillStyle = scene.document.style.bearish;
        fillPolygon(ctx, geometry.riskPolygon);
        ctx.restore();
      }
      return;
    }
    if (drawing.type === "fibonacciRetracement" && points.length >= 2) {
      const levels = buildFibonacciLevelGeometry(points[0], points[1]);
      ctx.save();
      clipToPricePlot(ctx, scene);
      ctx.fillStyle = resolveDrawingColor(scene, style, "fillToken", "fillColor", preview ? "preview" : "drawing");
      fibonacciBandPolygons(levels).forEach((polygon, index) => {
        ctx.globalAlpha = clampOpacity(style.opacity, 1) * (preview ? 0.72 : 1) * clampOpacity(style.fillOpacity, 0.035) * (index % 2 === 0 ? 1 : 0.55);
        fillPolygon(ctx, polygon);
      });
      ctx.restore();
      return;
    }
    const polygons = drawingFillPolygons(drawing, points, scene);
    if (polygons.length === 0) {
      return;
    }

    const defaultFillOpacity = drawing.type === "rangeBox" ? 0.045 : 0.04;
    const fillOpacity = clampOpacity(style.fillOpacity, defaultFillOpacity);
    const drawingOpacity = clampOpacity(style.opacity, 1);
    const previewOpacity = preview ? 0.72 : 1;
    ctx.save();
    clipToPricePlot(ctx, scene);
    ctx.fillStyle = resolveDrawingColor(scene, style, "fillToken", "fillColor", preview ? "preview" : "drawing");
    polygons.forEach((polygon, index) => {
      // A tiny alternating alpha keeps adjacent channels legible without obscuring price bars.
      const bandStep = index % 2 === 0 ? 1 : 0.68;
      ctx.globalAlpha = drawingOpacity * previewOpacity * fillOpacity * bandStep;
      fillPolygon(ctx, polygon);
    });
    ctx.restore();
  });
}

function drawDrawingForeground(ctx: CanvasRenderingContext2D, scene: RenderScene, drawings: DrawingEntity[], preview: boolean) {
  const transform = createCoordinateTransform(scene);
  drawings.filter((drawing) => drawing.visible !== false).forEach((drawing) => {
    const selected = !preview && scene.document.selectedDrawingId === drawing.id;
    const style = drawing.style ?? {};
    const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is DrawingPoint => Boolean(point));
    const strokeColor = resolveDrawingColor(scene, style, "colorToken", "color", preview ? "preview" : "drawing");

    ctx.save();
    ctx.globalAlpha = preview ? 0.58 : clampOpacity(style.opacity, 1);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = selected ? Math.max(1.8, style.lineWidth ?? 1.0) : style.lineWidth ?? 1.0;
    ctx.setLineDash(preview ? [6, 4] : style.lineDash ?? []);

    if (drawing.type === "horizontalLine" && points[0]) {
      line(ctx, scene.plot.left, points[0].y, scene.plot.right, points[0].y);
      drawDrawingLabel(ctx, scene, drawing.label, scene.plot.right - 4, points[0].y - 8, drawing);
    } else if (drawing.type === "horizontalParallelLines" && points.length >= 2) {
      const lines = buildHorizontalParallelLines(points[0], points[1], scene.plot);
      drawParallelLineStrokes(ctx, scene, lines);
      const upper = Math.min(points[0].y, points[1].y);
      const lower = Math.max(points[0].y, points[1].y);
      drawDrawingLabel(
        ctx,
        scene,
        drawing.label,
        scene.plot.left + 8,
        lower - upper >= 30 ? upper + 14 : (upper + lower) / 2,
        drawing
      );
    } else if (drawing.type === "verticalMarker" && points[0]) {
      line(ctx, points[0].x, scene.plot.top, points[0].x, scene.plot.priceBottom);
      drawDrawingLabel(ctx, scene, drawing.label, points[0].x + 5, scene.plot.top + 12, drawing);
    } else if (drawing.type === "verticalParallelLines" && points.length >= 2) {
      const lines = buildVerticalParallelLines(points[0], points[1], scene.plot);
      drawParallelLineStrokes(ctx, scene, lines);
      drawDrawingTag(
        ctx,
        scene,
        drawing.label ?? "시간 구간",
        (points[0].x + points[1].x) / 2,
        scene.plot.priceBottom - 14,
        drawing
      );
    } else if (drawing.type === "polyline" && points.length >= 3) {
      withPricePlotClip(ctx, scene, () => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.stroke();
      });
      const middle = points[Math.floor(points.length / 2)];
      drawDrawingLabel(ctx, scene, drawing.label, middle.x + 5, middle.y - 8, drawing);
    } else if (drawing.type === "trendLine" && points.length >= 2) {
      const [start, end] = projectTrendLine(points[0], points[1], scene.plot, normalizeLineExtension(style.extension));
      line(ctx, start.x, start.y, end.x, end.y);
      drawDrawingLabel(ctx, scene, drawing.label ?? lineMetricLabel(drawing, scene), (start.x + end.x) / 2, (start.y + end.y) / 2 - 8, drawing);
    } else if (drawing.type === "trendParallelLines" && points.length >= 3) {
      const lines = buildTrendParallelLines(
        points[0],
        points[1],
        points[2],
        scene.plot,
        normalizeParallelLineCount(drawing.parallelLineCount)
      );
      drawParallelLineStrokes(ctx, scene, lines);
      const labelLine = lines[trendParallelBaseLineIndex(drawing.parallelLineCount ?? 3)];
      if (labelLine) {
        drawDrawingLabel(
          ctx,
          scene,
          drawing.label,
          (labelLine[0].x + labelLine[1].x) / 2 + 5,
          (labelLine[0].y + labelLine[1].y) / 2 - 8,
          drawing
        );
      }
    } else if (drawing.type === "rangeBox" && points.length >= 2) {
      const x = Math.min(points[0].x, points[1].x);
      const y = Math.min(points[0].y, points[1].y);
      const width = Math.abs(points[1].x - points[0].x);
      const height = Math.abs(points[1].y - points[0].y);
      withPricePlotClip(ctx, scene, () => ctx.strokeRect(x, y, width, height));
      drawDrawingLabel(ctx, scene, drawing.label, x + 5, y + 13, drawing);
    } else if (drawing.type === "riskRewardBox" && points.length >= 2) {
      drawRiskRewardForeground(ctx, scene, drawing, points);
    } else if (drawing.type === "fibonacciRetracement" && points.length >= 2) {
      drawFibonacciForeground(ctx, scene, drawing, points);
    } else if (drawing.type === "flagMarker" && points[0]) {
      drawFlagMarker(ctx, scene, drawing, points[0], strokeColor, preview);
    } else if (drawing.type === "textLabel" && points[0]) {
      circle(ctx, points[0].x, points[0].y, 3);
      ctx.fill();
      drawDrawingLabel(ctx, scene, drawing.label ?? "메모", points[0].x + 7, points[0].y - 7, drawing);
    }
    ctx.restore();
  });
}

function drawingFillPolygons(drawing: DrawingEntity, points: DrawingPoint[], scene: RenderScene): DrawingPoint[][] {
  if (drawing.type === "rangeBox" && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x);
    const right = Math.max(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const bottom = Math.max(points[0].y, points[1].y);
    return [[
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]];
  }
  return parallelBandPolygons(parallelLinesForDrawing(drawing, points, scene), scene.plot);
}

function parallelLinesForDrawing(drawing: DrawingEntity, points: DrawingPoint[], scene: RenderScene): DrawingLine[] {
  if (drawing.type === "horizontalParallelLines" && points.length >= 2) {
    return buildHorizontalParallelLines(points[0], points[1], scene.plot);
  }
  if (drawing.type === "verticalParallelLines" && points.length >= 2) {
    return buildVerticalParallelLines(points[0], points[1], scene.plot);
  }
  if (drawing.type === "trendParallelLines" && points.length >= 3) {
    return buildTrendParallelLines(
      points[0],
      points[1],
      points[2],
      scene.plot,
      normalizeParallelLineCount(drawing.parallelLineCount)
    );
  }
  return [];
}

function drawParallelLineStrokes(ctx: CanvasRenderingContext2D, scene: RenderScene, lines: DrawingLine[]) {
  withPricePlotClip(ctx, scene, () => {
    lines.forEach(([start, end]) => line(ctx, start.x, start.y, end.x, end.y));
  });
}

function drawDrawingSelectionHandles(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  const drawing = scene.document.drawings.find((item) => item.id === scene.document.selectedDrawingId && item.visible !== false);
  if (!drawing) {
    return;
  }
  const transform = createCoordinateTransform(scene);
  const points = drawing.anchors.map((anchor) => transform.anchorToPoint(anchor)).filter((point): point is DrawingPoint => Boolean(point));
  const handles = drawing.type === "rangeBox" && points.length >= 2 ? rangeHandlePoints(points[0], points[1]) : points;
  if (handles.length === 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = scene.document.style.surface;
  ctx.strokeStyle = scene.document.style.drawing;
  ctx.lineWidth = 1;
  handles.forEach((point) => {
    circle(ctx, point.x, point.y, 4);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function rangeHandlePoints(first: DrawingPoint, second: DrawingPoint): DrawingPoint[] {
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const points = [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: right, y: centerY },
    { x: right, y: bottom },
    { x: centerX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: centerY }
  ];
  return points.filter((point, index) => (
    points.findIndex((candidate) => Math.abs(candidate.x - point.x) < 0.01 && Math.abs(candidate.y - point.y) < 0.01) === index
  ));
}

function drawFlagMarker(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  drawing: DrawingEntity,
  point: DrawingPoint,
  strokeColor: string,
  preview: boolean
) {
  if (point.x < scene.plot.left || point.x > scene.plot.right) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.min(1.2, drawing.style.lineWidth ?? 1);
  ctx.setLineDash(drawing.style.lineDash?.length ? drawing.style.lineDash : [2, 4]);
  withPricePlotClip(ctx, scene, () => line(ctx, point.x, point.y, point.x, scene.plot.top + 5));
  ctx.restore();

  const label = drawing.label?.trim() || "이벤트";
  const fontSize = nearestCanvasTypeSize(drawing.style.fontSize ?? canvasTypeSize.compact);
  ctx.save();
  ctx.font = `${fontSize}px ${canvasFontFamily}`;
  const tagHeight = 20;
  const tagWidth = Math.min(150, Math.max(38, ctx.measureText(label).width + 14));
  const preferredLeft = point.x + 7;
  const tagLeft = preferredLeft + tagWidth <= scene.plot.right
    ? preferredLeft
    : Math.max(scene.plot.left, point.x - tagWidth - 7);
  const tagTop = scene.plot.top + 4;
  ctx.fillStyle = colorWithAlpha(scene.document.style.surfaceStrong, preview ? 0.88 : 0.96);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  roundedRect(ctx, tagLeft, tagTop, tagWidth, tagHeight, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = resolveDrawingColor(scene, drawing.style, "textToken", "textColor", "drawing");
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, tagLeft + 7, tagTop + tagHeight / 2 + 0.5, tagWidth - 14);
  ctx.restore();
}

function fillPolygon(ctx: CanvasRenderingContext2D, polygon: DrawingPoint[]) {
  if (polygon.length < 3) {
    return;
  }
  ctx.beginPath();
  polygon.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.fill();
}

function clipToPricePlot(ctx: CanvasRenderingContext2D, scene: RenderScene) {
  ctx.beginPath();
  ctx.rect(
    scene.plot.left,
    scene.plot.top,
    Math.max(1, scene.plot.right - scene.plot.left),
    Math.max(1, scene.plot.priceBottom - scene.plot.top)
  );
  ctx.clip();
}

function withPricePlotClip(ctx: CanvasRenderingContext2D, scene: RenderScene, draw: () => void) {
  ctx.save();
  clipToPricePlot(ctx, scene);
  draw();
  ctx.restore();
}

function clampOpacity(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, typeof value === "number" && Number.isFinite(value) ? value : fallback));
}

function drawRiskRewardForeground(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  drawing: DrawingEntity,
  points: DrawingPoint[]
) {
  if (points.length === 2) {
    const left = Math.min(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const width = Math.abs(points[1].x - points[0].x);
    const height = Math.abs(points[1].y - points[0].y);
    withPricePlotClip(ctx, scene, () => ctx.strokeRect(left, top, width, height));
    return;
  }
  const prices = drawing.anchors.slice(0, 3).map((anchor) => anchor.price ?? anchor.value);
  if (!prices.every((price): price is number => typeof price === "number")) {
    return;
  }
  const direction = riskRewardDirection(prices[0], prices[1], prices[2]);
  if (!direction) {
    const left = Math.min(points[0].x, points[1].x);
    const right = Math.max(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y, points[2].y);
    const bottom = Math.max(points[0].y, points[1].y, points[2].y);
    withPricePlotClip(ctx, scene, () => {
      points.forEach((point) => line(ctx, left, point.y, right, point.y));
      line(ctx, left, top, left, bottom);
      line(ctx, right, top, right, bottom);
    });
    return;
  }
  const geometry = buildRiskRewardGeometry(points[0], points[1], points[2], direction);
  withPricePlotClip(ctx, scene, () => {
    line(ctx, geometry.left, geometry.entryY, geometry.right, geometry.entryY);
    line(ctx, geometry.left, geometry.stopY, geometry.right, geometry.stopY);
    line(ctx, geometry.left, geometry.targetY, geometry.right, geometry.targetY);
    line(ctx, geometry.left, Math.min(geometry.stopY, geometry.targetY), geometry.left, Math.max(geometry.stopY, geometry.targetY));
    line(ctx, geometry.right, Math.min(geometry.stopY, geometry.targetY), geometry.right, Math.max(geometry.stopY, geometry.targetY));
  });
  const targetPercent = ((prices[2] - prices[0]) / Math.max(0.0000001, Math.abs(prices[0]))) * 100;
  const stopPercent = ((prices[1] - prices[0]) / Math.max(0.0000001, Math.abs(prices[0]))) * 100;
  const ratio = Math.abs(prices[2] - prices[0]) / Math.max(0.0000001, Math.abs(prices[0] - prices[1]));
  drawDrawingLabel(ctx, scene, `Entry ${prices[0].toFixed(2)}`, geometry.left + 5, geometry.entryY - 9, drawing);
  drawDrawingLabel(ctx, scene, `Target ${targetPercent >= 0 ? "+" : ""}${targetPercent.toFixed(2)}%`, geometry.left + 5, geometry.targetY - 9, drawing);
  drawDrawingLabel(ctx, scene, `Stop ${stopPercent >= 0 ? "+" : ""}${stopPercent.toFixed(2)}%`, geometry.left + 5, geometry.stopY + 9, drawing);
  drawDrawingLabel(ctx, scene, `R:R 1:${ratio.toFixed(2)}`, geometry.right - 72, geometry.entryY + 9, drawing);
}

function drawFibonacciForeground(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  drawing: DrawingEntity,
  points: DrawingPoint[]
) {
  const firstPrice = drawing.anchors[0]?.price ?? drawing.anchors[0]?.value;
  const secondPrice = drawing.anchors[1]?.price ?? drawing.anchors[1]?.value;
  if (typeof firstPrice !== "number" || typeof secondPrice !== "number") {
    return;
  }
  const levels = buildFibonacciLevelGeometry(points[0], points[1]);
  withPricePlotClip(ctx, scene, () => {
    line(ctx, points[0].x, points[0].y, points[1].x, points[1].y);
    levels.forEach(({ line: [start, end] }) => line(ctx, start.x, start.y, end.x, end.y));
  });
  ctx.save();
  ctx.fillStyle = resolveDrawingColor(scene, drawing.style, "textToken", "textColor", "drawing");
  ctx.font = `${canvasTypeSize.micro}px ${canvasFontFamily}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  levels.forEach(({ level, y, line: [, end] }) => {
    const price = firstPrice + (secondPrice - firstPrice) * level;
    const percentage = Number.isInteger(level * 100) ? (level * 100).toFixed(0) : (level * 100).toFixed(1);
    ctx.fillText(`${percentage}% · ${price.toFixed(2)}`, Math.min(scene.plot.right - 4, end.x - 3), y - 3);
  });
  ctx.restore();
}

function drawDrawingLabel(ctx: CanvasRenderingContext2D, scene: RenderScene, label: string | undefined, x: number, y: number, drawing: DrawingEntity) {
  if (!label) {
    return;
  }
  const style = drawing.style ?? {};
  ctx.fillStyle = resolveDrawingColor(scene, style, "textToken", "textColor", "drawing");
  ctx.font = `${nearestCanvasTypeSize(style.fontSize ?? canvasTypeSize.compact)}px ${canvasFontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}

function drawDrawingTag(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
  label: string,
  centerX: number,
  centerY: number,
  drawing: DrawingEntity
) {
  const fontSize = nearestCanvasTypeSize(drawing.style.fontSize ?? canvasTypeSize.compact);
  ctx.save();
  ctx.font = `700 ${fontSize}px ${canvasFontFamily}`;
  const width = Math.max(44, Math.min(150, ctx.measureText(label).width + 18));
  const height = 22;
  const left = Math.max(scene.plot.left + 3, Math.min(scene.plot.right - width - 3, centerX - width / 2));
  const top = Math.max(scene.plot.top + 3, Math.min(scene.plot.priceBottom - height - 3, centerY - height / 2));
  ctx.fillStyle = scene.document.style.surfaceStrong;
  ctx.strokeStyle = resolveDrawingColor(scene, drawing.style, "colorToken", "color", "drawing");
  ctx.setLineDash([]);
  roundedRect(ctx, left, top, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = resolveDrawingColor(scene, drawing.style, "textToken", "textColor", "drawing");
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, left + 9, top + height / 2 + 0.5, width - 14);
  ctx.restore();
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
  ctx.font = `${canvasTypeSize.micro}px ${canvasFontFamily}`;
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
  ctx.font = `${canvasTypeSize.micro}px ${canvasFontFamily}`;
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
