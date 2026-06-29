import type {
  GridZone,
  PanelDefinition,
  PanelInstance,
  PanelPlacement,
  PanelSizeVariant,
  PanelType
} from "./types";

const layoutCommands = [
  "layout.panel.add",
  "layout.panel.remove",
  "layout.panel.move",
  "layout.boundary.resize",
  "layout.panel.replace",
  "layout.panel.pin",
  "layout.panel.unpin",
  "layout.panel.select"
];

const variantDefinitions = {
  micro: { label: "미니", minArea: 1, description: "아이콘과 상태만 표시합니다." },
  compact: { label: "컴팩트", minArea: 2, description: "작은 요약 패널입니다." },
  standard: { label: "기본", minArea: 3, description: "기본 패널 UI입니다." },
  wide: { label: "와이드", minArea: 6, description: "가로형 작업 패널입니다." },
  large: { label: "대형", minArea: 9, description: "주요 작업 패널입니다." }
};

const workspaceZones: GridZone[] = ["main", "context", "mainContext"];

const workspacePlacement = (
  zone: GridZone,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number
): PanelPlacement => ({
  group: "workspace",
  zone,
  col,
  row,
  colSpan,
  rowSpan
});

const agentPlacement = (row: number, rowSpan = 1): PanelPlacement => ({
  group: "agentRail",
  zone: "agentRail",
  col: 1,
  row,
  colSpan: 1,
  rowSpan
});

export const panelRegistry: Record<PanelType, PanelDefinition> = {
  chart: {
    type: "chart",
    title: "차트",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("mainContext", 1, 1, 4, 3),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 9,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  watchlist: {
    type: "watchlist",
    title: "관심 종목",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("main", 1, 4, 1, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 4,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  newsFeed: {
    type: "newsFeed",
    title: "시장 뉴스",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("main", 2, 4, 2, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 5,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  proposalReview: {
    type: "proposalReview",
    title: "제안 검토",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("context", 4, 1, 1, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 6,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  agentStatus: {
    type: "agentStatus",
    title: "AI 상태",
    allowedZones: ["agentRail"],
    defaultPlacement: agentPlacement(1),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 1, rowSpan: 2 },
    defaultWeight: 3,
    variants: variantDefinitions,
    commands: layoutCommands,
    iconUrl: "/assets/agent-icons/agent-01.svg"
  },
  agentChat: {
    type: "agentChat",
    title: "AI 채팅",
    allowedZones: ["agentRail", "context"],
    defaultPlacement: agentPlacement(2, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 1, rowSpan: 3 },
    defaultWeight: 5,
    variants: variantDefinitions,
    commands: layoutCommands,
    iconUrl: "/assets/agent-icons/agent-02.svg"
  },
  symbolSummary: {
    type: "symbolSummary",
    title: "종목 요약",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("context", 4, 3, 1, 1),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 5,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  indicatorCompare: {
    type: "indicatorCompare",
    title: "지표 비교",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("main", 1, 4, 2, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 6,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  orderTicket: {
    type: "orderTicket",
    title: "주문",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("context", 4, 4, 1, 2),
    minSpan: { colSpan: 1, rowSpan: 2 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 7,
    variants: variantDefinitions,
    commands: layoutCommands
  },
  aiSummary: {
    type: "aiSummary",
    title: "AI 요약",
    allowedZones: [...workspaceZones, "agentRail"],
    defaultPlacement: workspacePlacement("context", 4, 4, 1, 2),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 6,
    variants: variantDefinitions,
    commands: layoutCommands,
    iconUrl: "/assets/agent-icons/agent-03.svg"
  },
  notifications: {
    type: "notifications",
    title: "알림",
    allowedZones: workspaceZones,
    defaultPlacement: workspacePlacement("context", 4, 1, 1, 1),
    minSpan: { colSpan: 1, rowSpan: 1 },
    maxSpan: { colSpan: 4, rowSpan: 5 },
    defaultWeight: 7,
    variants: variantDefinitions,
    commands: layoutCommands
  }
};

export const panelTypes = Object.keys(panelRegistry) as PanelType[];

export function resolvePanelVariant(panel: Pick<PanelInstance, "placement">): PanelSizeVariant {
  const area = panel.placement.colSpan * panel.placement.rowSpan;

  if (panel.placement.group === "agentRail" && area <= 1) {
    return "micro";
  }

  if (area <= 1) {
    return "compact";
  }

  if (area <= 3) {
    return "standard";
  }

  if (panel.placement.colSpan >= 3 || area <= 7) {
    return "wide";
  }

  return "large";
}

export function getPanelDefinition(type: PanelType): PanelDefinition {
  return panelRegistry[type];
}
