import type { ChartCapability } from "./types";

export const chartCapabilities: ChartCapability[] = [
  {
    id: "chart-symbol",
    label: "Set symbol",
    description: "Change the active chart symbol and request a fresh candle snapshot.",
    commandTypes: ["chart.symbol.set"],
    payloadSchema: { type: "object", required: ["symbol"], properties: { symbol: { type: "string" } } },
    requiredContext: ["chartDocumentId"],
    previewable: true,
    autoApplyEligible: false,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-timeframe", "chart-viewport"],
    validationRules: ["symbol must be supported by the active market data provider"]
  },
  {
    id: "chart-timeframe",
    label: "Set timeframe",
    description: "Change the active candle interval.",
    commandTypes: ["chart.timeframe.set"],
    payloadSchema: { type: "object", required: ["timeframe"], properties: { timeframe: { enum: ["1m", "5m", "10m", "1h", "4h", "1D", "1W", "1M"] } } },
    requiredContext: ["chartDocumentId"],
    previewable: true,
    autoApplyEligible: true,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-symbol", "chart-viewport"],
    validationRules: ["timeframe must be one of 1m, 5m, 10m, 1h, 4h, 1D, 1W, 1M"]
  },
  {
    id: "chart-type",
    label: "Chart type",
    description: "Switch the base price renderer without changing the candle source interval.",
    commandTypes: ["chart.type.set"],
    payloadSchema: { type: "object", required: ["chartType"], properties: { chartType: { enum: ["candle", "line", "ohlc", "bidask"] } } },
    requiredContext: ["chartDocumentId"],
    previewable: true,
    autoApplyEligible: true,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-timeframe", "chart-layer-visibility"],
    validationRules: ["chartType must be candle, line, ohlc, or bidask"]
  },
  {
    id: "chart-viewport",
    label: "Set viewport",
    description: "Pan, zoom, or reset the visible candle range without changing market data.",
    commandTypes: ["chart.viewport.set"],
    payloadSchema: {
      type: "object",
      properties: {
        visibleCount: { type: "number", minimum: 6, maximum: 525600 },
        rightOffset: { type: "number" }
      }
    },
    requiredContext: ["visibleRange", "chartDocumentId"],
    previewable: true,
    autoApplyEligible: true,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-layer-visibility"],
    validationRules: ["visibleCount and rightOffset are clamped to safe numeric bounds; rightOffset may be negative for future empty space"]
  },
  {
    id: "chart-pane-ratio",
    label: "Pane ratio",
    description: "Resize chart panes while keeping their ratios in the chart document.",
    commandTypes: ["chart.pane.ratio.set"],
    payloadSchema: {
      type: "object",
      required: ["paneId", "heightRatio"],
      properties: {
        paneId: { type: "string" },
        heightRatio: { type: "number", minimum: 0.08, maximum: 0.82 }
      }
    },
    requiredContext: ["chartDocumentId"],
    previewable: true,
    autoApplyEligible: true,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-layer-visibility"],
    validationRules: ["heightRatio is clamped to safe pane bounds"]
  },
  {
    id: "chart-layer-visibility",
    label: "Layer visibility",
    description: "Show or hide chart layers such as MA lines or volume.",
    commandTypes: ["chart.layer.visibility.set"],
    payloadSchema: {
      type: "object",
      required: ["layer", "visible"],
      properties: {
        layer: {
          enum: [
            "candles",
            "volume",
            "ma5",
            "ma20",
            "ma60",
            "sma:5",
            "sma:20",
            "sma:60",
            "ema:20",
            "wma:20",
            "bollinger:20:2",
            "rsi:14",
            "stochastic:14:3:3",
            "macd:12:26:9",
            "volume-profile"
          ]
        },
        visible: { type: "boolean" }
      }
    },
    requiredContext: ["activeLayers", "chartDocumentId"],
    previewable: true,
    autoApplyEligible: true,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-viewport"],
    validationRules: ["layer must exist and visible must be boolean"]
  },
  {
    id: "chart-drawing",
    label: "Drawing annotations",
    description: "Add, update, select, or remove editable data-coordinate chart drawings.",
    commandTypes: [
      "chart.drawing.add",
      "chart.drawing.update",
      "chart.drawing.remove",
      "chart.drawing.select",
      "chart.drawing.clearSelection"
    ],
    payloadSchema: {
      type: "object",
      properties: {
        drawingType: {
          type: "string",
          enum: [
            "horizontalLine",
            "horizontalParallelLines",
            "trendLine",
            "trendParallelLines",
            "verticalMarker",
            "verticalParallelLines",
            "textLabel",
            "flagMarker",
            "rangeBox",
            "riskRewardBox",
            "fibonacciRetracement"
          ]
        },
        anchors: { type: "array" },
        sourceInterval: { type: "string" },
        parallelLineCount: { type: "integer", minimum: 2, maximum: 10 },
        label: { type: "string" },
        style: { type: "object" }
      }
    },
    requiredContext: ["chartDocumentId", "visibleRange", "coordinateTransform"],
    previewable: true,
    autoApplyEligible: false,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-preview", "chart-comparison"],
    validationRules: [
      "drawing anchors must use canonical timestamp/price/pane/symbol data coordinates",
      "trendParallelLines requires three anchors and parallelLineCount from 2 through 10",
      "horizontalParallelLines and verticalParallelLines require two anchors",
      "riskRewardBox requires entry, stop, and target anchors in that order",
      "fibonacciRetracement requires two anchors",
      "pixel coordinates are rejected"
    ]
  },
  {
    id: "chart-preview",
    label: "Proposal preview",
    description: "Show, hide, apply, or clear the single pending LLM drawing/comparison preview.",
    commandTypes: ["chart.preview.set", "chart.preview.toggle", "chart.preview.apply", "chart.preview.clear"],
    payloadSchema: { type: "object", properties: { preview: { type: "object" }, previewVisible: { type: "boolean" } } },
    requiredContext: ["chartDocumentId"],
    previewable: true,
    autoApplyEligible: false,
    undoScope: "none",
    conflictsWith: [],
    recommendedWith: ["chart-drawing", "chart-comparison"],
    validationRules: ["pendingPreview does not mutate ChartDocument.drawings", "apply preview creates one grouped chart history entry"]
  },
  {
    id: "chart-comparison",
    label: "Comparison overlay",
    description: "Compare another symbol on a percent scale without distorting the main price scale.",
    commandTypes: ["chart.comparison.add", "chart.comparison.remove", "chart.comparison.update"],
    payloadSchema: { type: "object", properties: { comparison: { type: "object" }, comparisonId: { type: "string" } } },
    requiredContext: ["chartDocumentId", "visibleRange", "marketDataAvailability"],
    previewable: true,
    autoApplyEligible: false,
    undoScope: "chart",
    conflictsWith: [],
    recommendedWith: ["chart-viewport", "chart-drawing"],
    validationRules: ["comparison uses percent scale", "comparison line must not mutate main price scale"]
  }
];
