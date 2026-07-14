import type {
  AnalysisAssetInterval,
  AnalysisAssetsResponse,
  ChartAnalysisAsset
} from "../chart/analysisAssetsApi";
import type { DrawingEntity } from "../chart/types";
import { sectorLabelKo } from "../market/sectors";
import type { AnalysisReport } from "../ontology/ontologyTypes";
import type {
  StockRecommendationItem,
  StockRecommendationPayload
} from "../recommendations/recommendationApi";
import type { SimulatorStatus } from "./simulatorApi";

export function saturdayDemoAnalysisAssets(symbol: string): AnalysisAssetsResponse {
  const intervals: AnalysisAssetInterval[] = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"];
  return {
    symbol,
    assets: Object.fromEntries(
      intervals.map((interval) => [interval, saturdayDemoAnalysisAsset(interval)])
    ) as Record<AnalysisAssetInterval, ChartAnalysisAsset>,
    meta: { servedAt: new Date().toISOString() }
  };
}

function saturdayDemoAnalysisAsset(interval: AnalysisAssetInterval): ChartAnalysisAsset {
  const generatedAt = new Date().toISOString();
  const asOf = new Date(Date.now() + 6 * 60_000).toISOString();
  const pattern = {
    kind: "symmetrical_triangle" as const,
    state: "forming" as const,
    bias: "bullish" as const,
    breakoutDirection: null,
    score: 0.91,
    touches: 6,
    geometryHash: "sim-triangle",
    apexBarsFromAsOf: 4
  };
  const drawing = (
    id: string,
    type: DrawingEntity["type"],
    anchors: DrawingEntity["anchors"],
    label: string,
    color: string
  ): ChartAnalysisAsset["geometry"]["drawings"][number] => ({
    id,
    type,
    anchors,
    symbol: "IFF",
    interval,
    sourceInterval: interval,
    style: {
      color,
      lineWidth: 2,
      opacity: 0.92,
      extension: type === "horizontalLine" ? "line" : "segment"
    },
    label,
    locked: true,
    visible: true,
    createdBy: "system",
    sourceProposalId: "saturday-demo-chart-analysis",
    createdAt: generatedAt,
    updatedAt: generatedAt
  });
  const supportId = `chart-asset:IFF:${interval}:sim-support`;
  const resistanceId = `chart-asset:IFF:${interval}:sim-resistance`;
  const drawings = [
    drawing(supportId, "horizontalLine", [{ price: 81.4, paneId: "price" }], "지지선 81.40", "#16a34a"),
    drawing(resistanceId, "horizontalLine", [{ price: 82.6, paneId: "price" }], "저항선 82.60", "#dc2626"),
    drawing(
      `chart-asset:IFF:${interval}:sim-triangle:upper`,
      "trendLine",
      [{ logicalIndex: 0, price: 83.1 }, { logicalIndex: 120, price: 82.6 }],
      "삼각 수렴 상단",
      "#f59e0b"
    ),
    drawing(
      `chart-asset:IFF:${interval}:sim-triangle:lower`,
      "trendLine",
      [{ logicalIndex: 0, price: 80.7 }, { logicalIndex: 120, price: 82.2 }],
      "삼각 수렴 하단",
      "#f59e0b"
    )
  ];
  return {
    assetVersion: "geometry",
    algorithmVersion: "saturday-demo-v1",
    symbol: "IFF",
    interval,
    sourceInterval: interval,
    asOf,
    generatedAt,
    status: "ready",
    inputDigest: `saturday-demo-IFF-${interval}`,
    coverage: {
      state: "full",
      targetBars: 300,
      actualBars: 300,
      contiguousBars: 300,
      missingBars: 0
    },
    geometry: {
      drawings,
      supports: [{
        id: supportId,
        role: "support",
        price: 81.4,
        score: 0.9,
        touches: 3,
        anchors: [{ timestamp: asOf, price: 81.4 }]
      }],
      resistances: [{
        id: resistanceId,
        role: "resistance",
        price: 82.6,
        score: 0.92,
        touches: 3,
        anchors: [{ timestamp: asOf, price: 82.6 }]
      }],
      patterns: [pattern],
      primaryPattern: pattern,
      primaryTriangle: pattern,
      historicalTriangle: null,
      tradePlan: {
        version: "pattern-trade-timing-v1",
        symbol: "IFF",
        interval,
        patternId: "sim-triangle",
        patternKind: "symmetrical_triangle",
        patternState: "forming",
        action: "buy_candidate",
        direction: "long",
        signalAt: null,
        entryTrigger: 82.6,
        entryPrice: 82.7,
        stopPrice: 81.1,
        targetPrice: 87.5,
        riskPerShare: 1.6,
        rewardPerShare: 4.8,
        rewardRiskRatio: 3,
        minimumRewardRisk: 2,
        projectionBars: 12,
        reasons: ["82.60 저항 돌파 확인", "81.10 하향 이탈 시 무효화"]
      }
    },
    indicators: {
      sma60: 82.18,
      sma120: 81.92,
      cross: { status: "none", direction: null }
    }
  };
}

export function saturdayDemoRecommendationPayload(status: SimulatorStatus): StockRecommendationPayload {
  return {
    status: "ready",
    runId: status.runId ?? "saturday-demo",
    generatedAt: new Date().toISOString(),
    items: [
      demoRecommendation(
        "IFF", 1, 92, 0.86, 1.4, "Materials",
        ["삼각 수렴 상단 접근", "포트폴리오 업종 분산"],
        ["이벤트 발생 시 변동성 확대 가능"]
      ),
      demoRecommendation(
        "AMD", 2, 84, 0.79, 0.6, "Information Technology",
        ["거래량 회복", "지지 구간 재확인"],
        ["반도체 집중 위험"]
      ),
      demoRecommendation(
        "OKE", 3, 78, 0.74, 0.2, "Energy",
        ["에너지 업종 분산", "이벤트 헤지 후보"],
        ["뉴스 민감도 높음"]
      )
    ],
    profile: null,
    summary: { source: "gops-simulator", synthetic: true, sessionMode: "regular" }
  };
}

function demoRecommendation(
  symbol: string,
  rank: number,
  score: number,
  confidence: number,
  changePercent: number,
  sector: string,
  reasons: string[],
  riskWarnings: string[]
): StockRecommendationItem {
  return {
    symbol,
    action: "buy",
    rank,
    score,
    confidence,
    changePercent,
    sector,
    sectorLabelKo: sectorLabelKo(sector),
    reasons: reasons.map((text) => ({ type: "simulation", text })),
    riskWarnings,
    metricsSnapshot: { source: "gops-simulator", synthetic: true }
  };
}

export function saturdayDemoOntologyReport(symbol: string): AnalysisReport {
  const ticker = symbol.trim().toUpperCase();
  const relationships: Record<string, Array<Record<string, unknown>>> = {
    IFF: [
      { relationType: "theme", ticker: "IFF", themeName: "Specialty Chemicals", relationScore: 0.94 },
      { relationType: "theme", ticker: "IFF", themeName: "Food & Fragrance Ingredients", relationScore: 0.91 },
      { relationType: "shared-theme", themeName: "Specialty Chemicals", symbols: ["IFF", "LIN", "SHW"], relationScore: 0.78 },
      { relationType: "control", ticker: "IFF", controlledName: "IFF Nutrition & Biosciences", relationScore: 0.96 }
    ],
    AMD: [
      { relationType: "theme", ticker: "AMD", themeName: "AI Accelerators", relationScore: 0.93 },
      { relationType: "shared-theme", themeName: "Semiconductors", symbols: ["AMD", "NVDA", "AVGO"], relationScore: 0.88 }
    ],
    OKE: [
      { relationType: "theme", ticker: "OKE", themeName: "Energy Midstream", relationScore: 0.95 },
      { relationType: "shared-theme", themeName: "Pipeline Infrastructure", symbols: ["OKE", "KMI", "WMB"], relationScore: 0.84 }
    ]
  };
  const rawItems = relationships[ticker] ?? relationships.IFF;
  return {
    symbol: ticker,
    generatedAt: new Date().toISOString(),
    providerEvidence: rawItems.map((raw, index) => ({
      provider: "ontology",
      status: "available",
      title: `${ticker} 시뮬레이션 관계 ${index + 1}`,
      summary: "토요일 시연을 위해 고정한 온톨로지 관계입니다.",
      observedAt: new Date().toISOString(),
      raw: { ...raw, simulation: true }
    }))
  };
}
