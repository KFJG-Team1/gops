import type { AgentLayoutPanelType } from "./agentLayoutTypes";
import type { PanelContentKind, PanelGridRect } from "./panelLayout";

export type PanelRegistryEntry = {
  kind: PanelContentKind;
  title: string;
  agentPanelType: AgentLayoutPanelType;
  minSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  defaultSpan: Pick<PanelGridRect, "colSpan" | "rowSpan">;
  defaultLayoutWeight: number;
};

export const panelRegistry: readonly PanelRegistryEntry[] = [
  {
    kind: "chart",
    title: "차트",
    agentPanelType: "chart",
    minSpan: { colSpan: 2, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 100
  },
  {
    kind: "compare",
    title: "비교",
    agentPanelType: "compareChart",
    minSpan: { colSpan: 2, rowSpan: 2 },
    defaultSpan: { colSpan: 4, rowSpan: 2 },
    defaultLayoutWeight: 80
  },
  {
    kind: "news",
    title: "뉴스",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "watchlistNews",
    title: "관심종목 뉴스",
    agentPanelType: "newsFeed",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "ontology",
    title: "온톨로지",
    agentPanelType: "ontologyGraph",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "indices",
    title: "지수",
    agentPanelType: "marketIndices",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "popular",
    title: "인기종목",
    agentPanelType: "popularStocks",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "recommendations",
    title: "추천",
    agentPanelType: "stockRecommendations",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "company",
    title: "기업정보",
    agentPanelType: "companyProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 1 },
    defaultLayoutWeight: 50
  },
  {
    kind: "portfolio",
    title: "포트폴리오",
    agentPanelType: "portfolioHoldings",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 2, rowSpan: 2 },
    defaultLayoutWeight: 35
  },
  {
    kind: "orderFlow",
    title: "오더플로우",
    agentPanelType: "orderFlowProfile",
    minSpan: { colSpan: 1, rowSpan: 1 },
    defaultSpan: { colSpan: 1, rowSpan: 2 },
    defaultLayoutWeight: 45
  },
  {
    kind: "trade",
    title: "주문",
    agentPanelType: "orderTicket",
    minSpan: { colSpan: 1, rowSpan: 1 },
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
  return `${entry.title} (${entry.minSpan.rowSpan}x${entry.minSpan.colSpan})`;
}
