import type { AgentLayoutPanelType } from "./agentLayoutTypes";
import type { PanelContentKind, PanelGridRect } from "./panelLayout";

export type PanelRegistryEntry = {
  kind: PanelContentKind;
  title: string;
  agentPanelType: AgentLayoutPanelType;
  /** Lowest span accepted by the persisted grid contract. */
  minSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  /** Lowest span that still keeps the actual panel UI readable. */
  readableMinSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  /** Rendered size target before the panel switches to its compact presentation. */
  minSizePx: { width: number; height: number };
  defaultSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  maxSpan?: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  defaultLayoutWeight: number;
  insertable?: boolean;
};

export const panelRegistry: readonly PanelRegistryEntry[] = [
  {
    kind: "chart",
    title: "차트",
    agentPanelType: "chart",
    minSpan: { colSpan: 2, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 100
  },
  {
    kind: "chartCommentary",
    title: "차트 해설",
    agentPanelType: "chartCommentary",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 48,
    insertable: true
  },
  {
    kind: "chartAssetOps",
    title: "작도 자산(개발)",
    agentPanelType: "chartAssetOps",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35,
    insertable: true
  },
  {
    kind: "compare",
    title: "비교",
    agentPanelType: "compareChart",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 80
  },
  {
    kind: "news",
    title: "뉴스 카드",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 190 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "newsList",
    title: "뉴스 목록",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "watchlistNews",
    title: "관심종목 뉴스 카드",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "watchlistNewsList",
    title: "관심종목 뉴스 목록",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "ontology",
    title: "온톨로지",
    agentPanelType: "ontologyGraph",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "indices",
    title: "지수",
    agentPanelType: "marketIndices",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 1, rowSpan: 1 },
    minSizePx: { width: 150, height: 100 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "popular",
    title: "인기종목",
    agentPanelType: "popularStocks",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "recommendations",
    title: "추천",
    agentPanelType: "stockRecommendations",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "themeRadar",
    title: "분야추천",
    agentPanelType: "themeRadar",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 58
  },
  {
    kind: "company",
    title: "기업정보",
    agentPanelType: "companyProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 50
  },
  {
    kind: "companyMulti",
    title: "기업 멀티",
    agentPanelType: "companyMulti",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 72
  },
  {
    kind: "companyValuation",
    title: "가치평가",
    agentPanelType: "companyValuation",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "companyProfitability",
    title: "수익성",
    agentPanelType: "companyProfitability",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "companyStability",
    title: "안정성",
    agentPanelType: "companyStability",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 3 },
    defaultLayoutWeight: 58
  },
  {
    kind: "portfolio",
    title: "Portfolio Legacy",
    agentPanelType: "portfolioDashboard",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35,
    insertable: false
  },
  {
    kind: "portfolioMulti",
    title: "Dual Portfolio",
    agentPanelType: "portfolioMulti",
    minSpan: { colSpan: 2, rowSpan: 3 },
    readableMinSpan: { colSpan: 2, rowSpan: 3 },
    minSizePx: { width: 320, height: 330 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    maxSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 90
  },
  {
    kind: "portfolioInvestment",
    title: "US Portfolio",
    agentPanelType: "portfolioInvestment",
    minSpan: { colSpan: 2, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 210 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 38
  },
  {
    kind: "portfolioPerformance",
    title: "Performance",
    agentPanelType: "portfolioPerformance",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 42
  },
  {
    kind: "portfolioInvested",
    title: "Invested",
    agentPanelType: "portfolioInvested",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 3 },
    defaultLayoutWeight: 36
  },
  {
    kind: "portfolioDividend",
    title: "Dividend",
    agentPanelType: "portfolioDividend",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 3, rowSpan: 2 },
    defaultLayoutWeight: 34
  },
  {
    kind: "portfolioDiversification",
    title: "Diversification",
    agentPanelType: "portfolioDiversification",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 36
  },
  {
    kind: "portfolioHoldings",
    title: "Holdings 표",
    agentPanelType: "portfolioHoldings",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 5, rowSpan: 3 },
    defaultLayoutWeight: 40
  },
  {
    kind: "portfolioHoldingsCards",
    title: "Holdings 카드",
    agentPanelType: "portfolioHoldingsCards",
    minSpan: { colSpan: 2, rowSpan: 2 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 320, height: 220 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 39
  },
  {
    kind: "orderFlow",
    title: "오더플로우",
    agentPanelType: "orderFlowProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 300, height: 200 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "trade",
    title: "주문",
    agentPanelType: "orderTicket",
    minSpan: { colSpan: 1, rowSpan: 1 },
    readableMinSpan: { colSpan: 2, rowSpan: 2 },
    minSizePx: { width: 280, height: 220 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35
  }
];

export function panelRegistryEntry(kind: PanelContentKind): PanelRegistryEntry {
  return panelRegistry.find((entry) => entry.kind === kind) ?? panelRegistry[0]!;
}

export function panelKindForAgentType(panelType: AgentLayoutPanelType | string | undefined): PanelContentKind | null {
  if (!panelType) {
    return null;
  }
  return panelRegistry.find((entry) => entry.agentPanelType === panelType)?.kind ?? null;
}

export function panelPaletteLabel(entry: PanelRegistryEntry): string {
  return entry.title;
}
