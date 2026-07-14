import {
  createTiledPanelStateFromSpec,
  normalizeTiledPanelStateToWorkspace,
  panelContentTitle,
  restoreTiledPanelStateSnapshot,
  type PanelLayoutSpecItem,
  type PanelContentKind,
  type StoredTiledPanelState,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";
import type { AgentLayoutProposal } from "./agentLayoutTypes";

export type DefaultPresetId = "market" | "stock" | "chart" | "compare" | "asset";

// Both default and custom presets are per-user editable. Defaults keep their built-in
// arrangement unless the user saves an override `layout`; they can be renamed but not deleted.
export type LayoutPreset = {
  id: string;
  kind: "default" | "custom";
  name: string;
  layout?: StoredTiledPanelState;
};

export type AgentLayoutPresetSummary = {
  id: string;
  kind: "default" | "custom";
  name: string;
  aliases: string[];
};

export type LayoutLoadPresetResult =
  | { status: "applied"; presetId: string; presetName: string }
  | { status: "missing"; presetId: string }
  | { status: "none" };

type DefaultPresetDefinition = { name: string; spec: readonly PanelLayoutSpecItem[] };

const ASSET_PORTFOLIO_LAYOUT_VERSION = 4;
const PORTFOLIO_FLOW_PANEL_VERSION = 2;

// Sensible starting arrangements built from the existing panels (8 cols x 6 rows).
// These are provided defaults; the user can rearrange and save their own presets.
const DEFAULT_PRESET_DEFINITIONS: Record<DefaultPresetId, DefaultPresetDefinition> = {
  market: {
    name: "추천종목",
    spec: [
      { kind: "recommendationsList", gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 6 } },
      { kind: "indices", gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 2 } },
      { kind: "themeRadar", gridRect: { col: 5, row: 3, colSpan: 4, rowSpan: 2 } },
      { kind: "news", gridRect: { col: 5, row: 5, colSpan: 4, rowSpan: 2 } }
    ]
  },
  stock: {
    name: "기업분석",
    spec: [
      { kind: "chart", gridRect: { col: 1, row: 1, colSpan: 6, rowSpan: 3 } },
      { kind: "company", gridRect: { col: 7, row: 1, colSpan: 2, rowSpan: 3 } },
      { kind: "watchlistNews", gridRect: { col: 1, row: 4, colSpan: 8, rowSpan: 2 } }
    ]
  },
  chart: {
    name: "차트분석",
    spec: [
      { kind: "chart", gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 4 } },
      { kind: "news", gridRect: { col: 1, row: 5, colSpan: 8, rowSpan: 2 } }
    ]
  },
  compare: {
    name: "차트분석",
    spec: [
      { kind: "compare", gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 3 } },
      { kind: "indices", gridRect: { col: 1, row: 4, colSpan: 4, rowSpan: 2 } },
      { kind: "watchlistNews", gridRect: { col: 5, row: 4, colSpan: 4, rowSpan: 2 } }
    ]
  },
  asset: {
    name: "포트폴리오",
    spec: [
      {
        kind: "portfolioMulti",
        gridRect: { col: 1, row: 1, colSpan: 2, rowSpan: 3 },
        props: { portfolioLayoutVersion: ASSET_PORTFOLIO_LAYOUT_VERSION }
      },
      {
        kind: "portfolioHoldings",
        gridRect: { col: 3, row: 1, colSpan: 6, rowSpan: 3 }
      },
      {
        kind: "portfolioHeatmap",
        gridRect: { col: 1, row: 4, colSpan: 8, rowSpan: 3 }
      }
    ]
  }
};

export const DEFAULT_PRESET_IDS: readonly DefaultPresetId[] = ["market", "stock", "compare", "asset"];

export const DEFAULT_PRESETS: LayoutPreset[] = DEFAULT_PRESET_IDS.map((id): LayoutPreset => ({
  id,
  kind: "default",
  name: DEFAULT_PRESET_DEFINITIONS[id].name
}));

export function buildPresetLayout(
  preset: LayoutPreset,
  viewport: ViewportSize,
  options: { symbol?: string; layoutMetrics?: WorkspaceLayoutMetrics } = {}
): TiledPanelState | null {
  // A saved override layout (valid snapshot) wins; otherwise defaults rebuild from spec.
  if (preset.layout) {
    const layout = migratePortfolioInvestmentSnapshot(preset.layout);
    const shouldReplaceLegacyAssetLayout = preset.id === "asset"
      && isStoredTiledPanelStateShape(layout)
      && !hasCurrentAssetPortfolioLayout(layout);
    if (!shouldReplaceLegacyAssetLayout) {
      const restored = restoreTiledPanelStateSnapshot(layout, viewport, options.layoutMetrics);
      if (restored) {
        return restored;
      }
    }
  }
  if (preset.kind === "default") {
    const definition = DEFAULT_PRESET_DEFINITIONS[preset.id as DefaultPresetId];
    return definition ? createTiledPanelStateFromSpec(definition.spec, viewport, options) : null;
  }
  return null;
}

export function ensurePortfolioInvestedPanelState(
  state: TiledPanelState,
  viewport: ViewportSize,
  options: { layoutMetrics?: WorkspaceLayoutMetrics } = {}
): TiledPanelState {
  const flowSlots = state.slots
    .filter((slot) => {
      const kind = state.contents[slot.contentId]?.kind;
      return kind === "portfolioInvested" || kind === "portfolioDividend";
    })
    .sort((left, right) => left.gridRect.row - right.gridRect.row || left.gridRect.col - right.gridRect.col);

  if (flowSlots.length === 0) {
    return state;
  }

  const investedSlot = flowSlots.find((slot) => state.contents[slot.contentId]?.kind === "portfolioInvested");
  const primarySlot = investedSlot ?? flowSlots[0];
  const primaryContent = state.contents[primarySlot.contentId];
  if (!primaryContent) {
    return state;
  }

  const initialFlowView = investedSlot ? "invested" : "dividend";
  const mergedGridRect = flowSlots.reduce((gridRect, slot) => {
    const candidate = slot.gridRect;
    const sameGridBand = candidate.row === gridRect.row && candidate.rowSpan === gridRect.rowSpan;
    const gridRight = gridRect.col + gridRect.colSpan;
    const candidateRight = candidate.col + candidate.colSpan;
    const touching = candidate.col <= gridRight && gridRect.col <= candidateRight;
    if (!sameGridBand || !touching) {
      return gridRect;
    }
    const col = Math.min(gridRect.col, candidate.col);
    return {
      ...gridRect,
      col,
      colSpan: Math.max(gridRight, candidateRight) - col
    };
  }, primarySlot.gridRect);

  let canonicalFlowGridRect = mergedGridRect;
  let resizedPerformanceSlot: { id: string; gridRect: typeof mergedGridRect } | null = null;
  const performanceSlot = state.slots.find((slot) => {
    const content = state.contents[slot.contentId];
    return content?.kind === "portfolioPerformance"
      && slot.gridRect.row === mergedGridRect.row
      && slot.gridRect.rowSpan === mergedGridRect.rowSpan;
  });
  if (performanceSlot) {
    const occupiedBands = [performanceSlot.gridRect, ...flowSlots.map((slot) => slot.gridRect)]
      .sort((left, right) => left.col - right.col);
    const isContiguous = occupiedBands.every((gridRect, index) => (
      index === 0 || gridRect.col <= occupiedBands[index - 1].col + occupiedBands[index - 1].colSpan
    ));
    const left = Math.min(performanceSlot.gridRect.col, mergedGridRect.col);
    const right = Math.max(
      performanceSlot.gridRect.col + performanceSlot.gridRect.colSpan,
      mergedGridRect.col + mergedGridRect.colSpan
    );
    const totalSpan = right - left;
    if (isContiguous && totalSpan >= 4) {
      const leftSpan = Math.max(2, Math.floor(totalSpan / 2));
      const rightSpan = Math.max(2, totalSpan - leftSpan);
      if (performanceSlot.gridRect.col <= mergedGridRect.col) {
        resizedPerformanceSlot = {
          id: performanceSlot.id,
          gridRect: { ...performanceSlot.gridRect, col: left, colSpan: leftSpan }
        };
        canonicalFlowGridRect = { ...mergedGridRect, col: left + leftSpan, colSpan: rightSpan };
      } else {
        canonicalFlowGridRect = { ...mergedGridRect, col: left, colSpan: leftSpan };
        resizedPerformanceSlot = {
          id: performanceSlot.id,
          gridRect: { ...performanceSlot.gridRect, col: left + leftSpan, colSpan: rightSpan }
        };
      }
    }
  }

  const nextTitle = panelContentTitle("portfolioInvested");
  const currentVersion = primaryContent.props?.portfolioFlowVersion;
  const alreadyCanonical = flowSlots.length === 1
    && primaryContent.kind === "portfolioInvested"
    && primaryContent.title === nextTitle
    && currentVersion === PORTFOLIO_FLOW_PANEL_VERSION
    && primarySlot.gridRect.col === canonicalFlowGridRect.col
    && primarySlot.gridRect.colSpan === canonicalFlowGridRect.colSpan
    && (!resizedPerformanceSlot || state.slots.some((slot) => (
      slot.id === resizedPerformanceSlot.id
      && slot.gridRect.col === resizedPerformanceSlot.gridRect.col
      && slot.gridRect.colSpan === resizedPerformanceSlot.gridRect.colSpan
    )));
  if (alreadyCanonical) {
    return state;
  }

  const removedContentIds = new Set(
    flowSlots.filter((slot) => slot.id !== primarySlot.id).map((slot) => slot.contentId)
  );
  const contents = Object.fromEntries(
    Object.entries(state.contents)
      .filter(([contentId]) => !removedContentIds.has(contentId))
      .map(([contentId, content]) => contentId === primarySlot.contentId
        ? [contentId, {
          ...content,
          kind: "portfolioInvested" as const,
          title: nextTitle,
          props: {
            ...content.props,
            initialFlowView,
            portfolioFlowVersion: PORTFOLIO_FLOW_PANEL_VERSION
          }
        }]
        : [contentId, content])
  );
  const nextState: TiledPanelState = {
    ...state,
    slots: state.slots
      .filter((slot) => !removedContentIds.has(slot.contentId))
      .map((slot) => {
        if (slot.id === primarySlot.id) {
          return { ...slot, gridRect: canonicalFlowGridRect };
        }
        if (resizedPerformanceSlot && slot.id === resizedPerformanceSlot.id) {
          return { ...slot, gridRect: resizedPerformanceSlot.gridRect };
        }
        return slot;
      }),
    contents
  };

  return normalizeTiledPanelStateToWorkspace(nextState, viewport, options.layoutMetrics);
}

function resetLegacyPortfolioSnapshotIfNeeded(value: StoredTiledPanelState): StoredTiledPanelState {
  const contentKinds = Object.values(value.contents).map((content) => content.kind);
  if (hasCurrentAssetPortfolioLayout(value)) {
    return value;
  }
  if (contentKinds.length > 0 && contentKinds.every((kind) => portfolioWorkspaceKinds.includes(kind))) {
    return createStoredAssetPortfolioLayout();
  }
  if (shouldResetDefaultPortfolioWorkspace(contentKinds)) {
    return createStoredAssetPortfolioLayout();
  }
  return value;
}

function hasCurrentAssetPortfolioLayout(value: StoredTiledPanelState): boolean {
  return Object.values(value.contents).some((content) => (
    content.kind === "portfolioMulti"
    && content.props?.portfolioLayoutVersion === ASSET_PORTFOLIO_LAYOUT_VERSION
  ));
}

export function migratePortfolioInvestmentSnapshot(value: unknown): unknown {
  if (!isStoredTiledPanelStateShape(value)) {
    return value;
  }
  const layout = resetLegacyPortfolioSnapshotIfNeeded(value);
  const contentKinds = Object.values(layout.contents).map((content) => content.kind);
  const hasAnyPortfolioPanel = hasPortfolioPanelKind(contentKinds);
  if (!hasAnyPortfolioPanel) {
    return layout;
  }

  if (contentKinds.includes("portfolioInvestment")) {
    return layout;
  }

  const hasChartPanel = contentKinds.includes("chart");
  if (hasChartPanel) {
    return {
      ...layout,
      contents: Object.fromEntries(Object.entries(layout.contents).map(([id, content]) => {
        if (content.kind !== "portfolio") {
          return [id, content];
        }
        return [
          id,
          {
            ...content,
            kind: "portfolioHoldings",
            title: panelContentTitle("portfolioHoldings")
          }
        ];
      }))
    };
  }

  return layout;
}

const integratedPortfolioPanelKinds: readonly PanelContentKind[] = [
  "portfolioMulti",
  "portfolioInvestment",
  "portfolioInvested",
  "portfolioHeatmap",
  "portfolioHoldings",
  "portfolioHoldingsFlatCards"
];

const retiredSplitPortfolioPanelKinds: readonly PanelContentKind[] = [
  "portfolioPerformance",
  "portfolioDividend",
  "portfolioDiversification"
];

const portfolioWorkspaceKinds: readonly PanelContentKind[] = [
  "portfolio",
  ...integratedPortfolioPanelKinds,
  ...retiredSplitPortfolioPanelKinds
];

const legacyPortfolioWorkspaceAllowedKinds: readonly PanelContentKind[] = [
  "chart",
  ...portfolioWorkspaceKinds
];

function hasPortfolioPanelKind(kinds: readonly PanelContentKind[]): boolean {
  return kinds.some((kind) => portfolioWorkspaceKinds.includes(kind));
}

function shouldResetDefaultPortfolioWorkspace(kinds: readonly PanelContentKind[]): boolean {
  if (!kinds.every((kind) => legacyPortfolioWorkspaceAllowedKinds.includes(kind))) {
    return false;
  }
  if (kinds.includes("portfolioInvestment") && kinds.includes("chart")) {
    return kinds.every((kind) => kind === "portfolioInvestment" || kind === "chart");
  }
  if (kinds.includes("portfolioInvestment") && kinds.includes("portfolioHoldings")) {
    return kinds.every((kind) => integratedPortfolioPanelKinds.includes(kind));
  }
  if (kinds.includes("portfolio")) {
    return kinds.every((kind) => kind === "portfolio" || kind === "chart");
  }
  return false;
}

function createStoredAssetPortfolioLayout(): StoredTiledPanelState {
  const spec = DEFAULT_PRESET_DEFINITIONS.asset.spec;
  let instance = 1;
  const contents: StoredTiledPanelState["contents"] = {};
  const slots: StoredTiledPanelState["slots"] = [];
  for (const item of spec) {
    const contentId = `content-${item.kind}-${instance}`;
    contents[contentId] = {
      id: contentId,
      kind: item.kind,
      title: panelContentTitle(item.kind),
      instanceIndex: instance,
      ...(typeof item.layoutWeight === "number" ? { layoutWeight: item.layoutWeight } : {}),
      ...(item.props ? { props: item.props } : {})
    };
    slots.push({
      id: `slot-${item.kind}-${instance}`,
      contentId,
      gridRect: item.gridRect
    });
    instance += 1;
  }
  return {
    version: 1,
    nextInstance: instance,
    contents,
    slots
  };
}

function isStoredTiledPanelStateShape(value: unknown): value is StoredTiledPanelState {
  return Boolean(value)
    && typeof value === "object"
    && (value as { version?: unknown }).version === 1
    && typeof (value as { nextInstance?: unknown }).nextInstance === "number"
    && Array.isArray((value as { slots?: unknown }).slots)
    && Boolean((value as { contents?: unknown }).contents)
    && typeof (value as { contents?: unknown }).contents === "object";
}

const CUSTOM_PRESET_PLACEHOLDER = "사용자지정";

/** Next non-colliding placeholder name, e.g. 사용자지정1, 사용자지정2, ... */
export function nextCustomPresetName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((name) => name.trim()));
  let index = 1;
  while (taken.has(`${CUSTOM_PRESET_PLACEHOLDER}${index}`)) {
    index += 1;
  }
  return `${CUSTOM_PRESET_PLACEHOLDER}${index}`;
}

export function createCustomPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAgentLayoutPresetSummaries(presets: readonly LayoutPreset[]): AgentLayoutPresetSummary[] {
  return presets.map((preset) => ({
    id: preset.id,
    kind: preset.kind,
    name: preset.name,
    aliases: presetAliasesForAgent(preset)
  }));
}

const presetLoadPromptSignals = [
  "프리셋",
  "preset",
  "창",
  "화면",
  "모드",
  "레이아웃",
  "뷰",
  "대시보드",
  "페이지",
  "워크스페이스",
  "띄워",
  "띠워",
  "열어",
  "보여",
  "표시",
  "불러",
  "적용",
  "전환",
  "바꿔",
  "가줘",
  "넘겨",
  "이동",
  "window",
  "screen",
  "mode",
  "layout",
  "view",
  "dashboard",
  "page",
  "workspace",
  "open",
  "show",
  "load",
  "switch"
];

export function isLikelyPresetLoadPrompt(
  prompt: string,
  presets: readonly AgentLayoutPresetSummary[]
): boolean {
  const compactPrompt = compactPresetPrompt(prompt);
  if (!compactPrompt) {
    return false;
  }
  const hasLoadSignal = presetLoadPromptSignals.some((signal) => compactPrompt.includes(compactPresetPrompt(signal)));
  if (!hasLoadSignal) {
    return false;
  }
  return presets.some((preset) => {
    const aliases = [preset.name, ...preset.aliases];
    return aliases.some((alias) => {
      const compactAlias = compactPresetPrompt(alias);
      return Boolean(compactAlias) && compactPrompt.includes(compactAlias);
    });
  });
}

export function applyLayoutLoadProposalToPresets(
  proposal: AgentLayoutProposal,
  presets: readonly LayoutPreset[],
  applyPreset: (id: string) => void
): LayoutLoadPresetResult {
  const presetId = presetIdFromLayoutLoadProposal(proposal);
  if (!presetId) {
    return { status: "none" };
  }
  const preset = presets.find((item) => item.id === presetId);
  if (!preset) {
    return { status: "missing", presetId };
  }
  applyPreset(presetId);
  return { status: "applied", presetId, presetName: preset.name };
}

export function presetIdFromLayoutLoadProposal(proposal: AgentLayoutProposal): string | null {
  const command = proposal.commands.find((item) => item.type === "layout.load");
  if (!command) {
    return null;
  }
  return readPresetString(command.payload.presetId) ?? readPresetString(command.payload.id);
}

function presetAliasesForAgent(preset: LayoutPreset): string[] {
  const base = preset.name.trim();
  const suffixes = [
    "프리셋",
    "창",
    "화면",
    "모드",
    "레이아웃",
    "뷰",
    "대시보드",
    "페이지",
    "워크스페이스",
    "preset",
    "window",
    "screen",
    "mode",
    "layout",
    "view",
    "dashboard",
    "page",
    "workspace"
  ];
  const aliases = [
    base,
    base.replace(/\s+/g, ""),
    ...suffixes.flatMap((suffix) => [`${base} ${suffix}`, `${base}${suffix}`])
  ];
  if (preset.kind === "default") {
    aliases.push(...(DEFAULT_PRESET_LEGACY_ALIASES[preset.id as DefaultPresetId] ?? []));
    aliases.push(preset.id);
  }
  return Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)));
}

const DEFAULT_PRESET_LEGACY_ALIASES: Partial<Record<DefaultPresetId, readonly string[]>> = {
  market: ["추천 종목", "오늘의 추천 종목", "시장분석"],
  stock: ["기업 분석", "종목분석"],
  compare: ["차트 분석", "비교분석"],
  asset: ["자산현황"]
};

function readPresetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function compactPresetPrompt(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}
