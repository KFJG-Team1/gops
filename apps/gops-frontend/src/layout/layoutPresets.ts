import {
  createTiledPanelStateFromSpec,
  normalizeTiledPanelStateToWorkspace,
  panelContentTitle,
  restoreTiledPanelStateSnapshot,
  synchronizeChartAnalysisSymbol,
  synchronizeCompanyAnalysisSymbol,
  type PanelLayoutSpecItem,
  type PanelContentKind,
  type StoredTiledPanelState,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";
import type { AgentLayoutProposal } from "./agentLayoutTypes";

export type DefaultPresetId = "market" | "stock" | "chart" | "compare" | "regular" | "asset";
export type LayoutPresetRole = "incident-response";

// Both default and custom presets are per-user editable. Defaults keep their built-in
// arrangement unless the user saves an override `layout`; they can be renamed but not deleted.
export type LayoutPreset = {
  id: string;
  kind: "default" | "custom";
  name: string;
  layout?: StoredTiledPanelState;
  role?: LayoutPresetRole;
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
const STOCK_COMPANY_LAYOUT_VERSION = 2;
const COMPANY_COMPARE_LAYOUT_VERSION = 2;
const CHART_ANALYSIS_DEFAULT_SYMBOL = "NVDA";

// Sensible starting arrangements built from the existing panels (8 cols x 6 rows).
// These are provided defaults; the user can rearrange and save their own presets.
const DEFAULT_PRESET_DEFINITIONS: Record<DefaultPresetId, DefaultPresetDefinition> = {
  market: {
    name: "추천종목",
    spec: [
      { kind: "recommendationsList", gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 6 } },
      { kind: "chart", gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 6 } }
    ]
  },
  stock: {
    name: "기업분석",
    spec: [
      { kind: "company", gridRect: { col: 1, row: 1, colSpan: 2, rowSpan: 6 } },
      {
        kind: "companyJournal",
        gridRect: { col: 3, row: 1, colSpan: 4, rowSpan: 6 },
        props: { companyLayoutVersion: STOCK_COMPANY_LAYOUT_VERSION }
      },
      { kind: "newsKeyword", gridRect: { col: 7, row: 1, colSpan: 2, rowSpan: 6 } }
    ]
  },
  chart: {
    name: "차트분석",
    spec: [
      { kind: "chart", gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 4 } },
      { kind: "chartCommentary", gridRect: { col: 1, row: 5, colSpan: 4, rowSpan: 2 } },
      { kind: "news", gridRect: { col: 5, row: 5, colSpan: 4, rowSpan: 2 } }
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
  regular: {
    name: "추천분석",
    spec: [
      {
        kind: "recommendationsList",
        gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 6 }
      },
      { kind: "chart", gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 6 } }
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

export const DEFAULT_PRESET_IDS: readonly DefaultPresetId[] = ["market", "stock", "compare", "regular", "asset"];

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
    const presetLayout = preset.kind === "default" && preset.id === "market"
      ? migrateRecommendationNewsKeywordSnapshot(preset.layout)
      : preset.layout;
    const layout = migrateCompanyComparePanelSnapshot(
      migratePortfolioInvestmentSnapshot(presetLayout)
    );
    const shouldReplaceLegacyAssetLayout = preset.id === "asset"
      && isStoredTiledPanelStateShape(layout)
      && !hasCurrentAssetPortfolioLayout(layout);
    const shouldReplaceLegacyStockLayout = preset.kind === "default"
      && preset.id === "stock"
      && isStoredTiledPanelStateShape(layout)
      && (
        isLegacyDefaultStockLayout(layout)
        || isRetiredStockCompanyLayout(layout)
        || storedLayoutHasPanelKind(layout, "companyCompare")
      )
      && !hasCurrentStockCompanyLayout(layout);
    const shouldReplaceLegacyRecommendationLayout = preset.kind === "default"
      && (preset.id === "market" || preset.id === "regular")
      && isStoredTiledPanelStateShape(layout)
      && isLegacyDefaultRecommendationLayout(layout);
    if (!shouldReplaceLegacyAssetLayout && !shouldReplaceLegacyStockLayout && !shouldReplaceLegacyRecommendationLayout) {
      const restored = restoreTiledPanelStateSnapshot(layout, viewport, options.layoutMetrics);
      if (restored) {
        if (preset.kind === "default" && preset.id === "compare") {
          return synchronizeChartAnalysisSymbol(restored, options.symbol ?? CHART_ANALYSIS_DEFAULT_SYMBOL);
        }
        if (preset.kind === "default" && preset.id === "stock" && options.symbol) {
          return synchronizeCompanyAnalysisSymbol(restored, options.symbol);
        }
        return restored;
      }
    }
  }
  if (preset.kind === "default") {
    const definition = DEFAULT_PRESET_DEFINITIONS[preset.id as DefaultPresetId];
    if (!definition) {
      return null;
    }
    const symbol = preset.id === "compare"
      ? options.symbol ?? CHART_ANALYSIS_DEFAULT_SYMBOL
      : options.symbol;
    const created = createTiledPanelStateFromSpec(definition.spec, viewport, { ...options, symbol });
    return preset.id === "stock" && symbol
      ? synchronizeCompanyAnalysisSymbol(created, symbol)
      : created;
  }
  return null;
}

export function resetChartAnalysisDefaultSymbol(state: TiledPanelState): TiledPanelState {
  return synchronizeChartAnalysisSymbol(state, CHART_ANALYSIS_DEFAULT_SYMBOL);
}

export function migrateRecommendationNewsKeywordSnapshot(value: unknown): unknown {
  if (!isStoredTiledPanelStateShape(value)) {
    return value;
  }
  const contents = Object.values(value.contents);
  const hasRecommendations = contents.some((content) => content.kind === "recommendationsList");
  const hasNewsKeyword = contents.some((content) => content.kind === "newsKeyword");
  const newsEntries = Object.entries(value.contents)
    .filter(([, content]) => content.kind === "news");
  if (!hasRecommendations || hasNewsKeyword || newsEntries.length !== 1) {
    return value;
  }
  const [newsContentId, newsContent] = newsEntries[0];
  return {
    ...value,
    contents: {
      ...value.contents,
      [newsContentId]: {
        ...newsContent,
        kind: "newsKeyword",
        title: panelContentTitle("newsKeyword")
      }
    }
  };
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

function hasCurrentStockCompanyLayout(value: StoredTiledPanelState): boolean {
  return Object.values(value.contents).some((content) => (
    content.kind === "companyJournal"
    && content.props?.companyLayoutVersion === STOCK_COMPANY_LAYOUT_VERSION
  ));
}

function isRetiredStockCompanyLayout(value: StoredTiledPanelState): boolean {
  const slotsByKind = new Map<PanelContentKind, StoredTiledPanelState["slots"][number]>();
  value.slots.forEach((slot) => {
    const kind = value.contents[slot.contentId]?.kind;
    if (kind) slotsByKind.set(kind, slot);
  });
  if (slotsByKind.size !== 3 || !slotsByKind.has("company") || !slotsByKind.has("companyMulti") || !slotsByKind.has("newsList")) {
    return false;
  }
  const company = slotsByKind.get("company")?.gridRect;
  const journal = slotsByKind.get("companyMulti")?.gridRect;
  const news = slotsByKind.get("newsList")?.gridRect;
  return Boolean(
    company && company.col === 1 && company.row === 1 && company.colSpan === 2 && company.rowSpan === 6
    && journal && journal.col === 3 && journal.row === 1 && journal.colSpan === 4 && journal.rowSpan === 6
    && news && news.col === 7 && news.row === 1 && news.colSpan === 2 && news.rowSpan === 6
  );
}

function isLegacyDefaultStockLayout(value: StoredTiledPanelState): boolean {
  const slotsByKind = new Map<PanelContentKind, StoredTiledPanelState["slots"][number]>();
  value.slots.forEach((slot) => {
    const kind = value.contents[slot.contentId]?.kind;
    if (kind) slotsByKind.set(kind, slot);
  });
  if (slotsByKind.size !== 3 || !slotsByKind.has("chart") || !slotsByKind.has("company") || !slotsByKind.has("watchlistNews")) {
    return false;
  }
  const chart = slotsByKind.get("chart")?.gridRect;
  const company = slotsByKind.get("company")?.gridRect;
  const news = slotsByKind.get("watchlistNews")?.gridRect;
  return Boolean(
    chart && chart.col === 1 && chart.row === 1 && chart.colSpan === 6 && chart.rowSpan === 3
    && company && company.col === 7 && company.row === 1 && company.colSpan === 2 && company.rowSpan === 3
    && news && news.col === 1 && news.row === 4 && news.colSpan === 8 && news.rowSpan === 2
  );
}

function isLegacyDefaultRecommendationLayout(value: StoredTiledPanelState): boolean {
  if (value.slots.length !== 4) return false;
  const entries = value.slots.map((slot) => ({
    kind: value.contents[slot.contentId]?.kind,
    gridRect: slot.gridRect
  }));
  const matches = (kinds: PanelContentKind[], col: number, row: number, colSpan: number, rowSpan: number) => (
    entries.some((entry) => (
      Boolean(entry.kind && kinds.includes(entry.kind))
      && entry.gridRect.col === col
      && entry.gridRect.row === row
      && entry.gridRect.colSpan === colSpan
      && entry.gridRect.rowSpan === rowSpan
    ))
  );
  return matches(["recommendationsList"], 1, 1, 5, 6)
    && matches(["indexCommentary", "indices"], 6, 1, 3, 1)
    && matches(["themeRadar"], 6, 2, 3, 2)
    && matches(["news", "newsKeyword"], 6, 4, 3, 3);
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

export function migrateCompanyComparePanelSnapshot(value: unknown): unknown {
  if (!isStoredTiledPanelStateShape(value)) {
    return value;
  }
  const migratedContentIds = new Set<string>();
  const contents = Object.fromEntries(Object.entries(value.contents).map(([id, content]) => {
    if (
      content.kind !== "companyCompare"
      || content.props?.companyCompareLayoutVersion === COMPANY_COMPARE_LAYOUT_VERSION
    ) {
      return [id, content];
    }
    migratedContentIds.add(id);
    return [
      id,
      {
        ...content,
        props: {
          ...(content.props ?? {}),
          companyCompareLayoutVersion: COMPANY_COMPARE_LAYOUT_VERSION
        }
      }
    ];
  }));
  if (migratedContentIds.size === 0) {
    return value;
  }
  return {
    ...value,
    contents,
    slots: value.slots.map((slot) => {
      if (!migratedContentIds.has(slot.contentId) || !isLegacyCompanyCompareDefaultRect(slot.gridRect)) {
        return slot;
      }
      return {
        ...slot,
        gridRect: {
          ...slot.gridRect,
          colSpan: 3,
          rowSpan: 2
        }
      };
    })
  };
}

function isLegacyCompanyCompareDefaultRect(gridRect: {
  colSpan: number;
  rowSpan: number;
}): boolean {
  return gridRect.colSpan === 8 && (gridRect.rowSpan === 4 || gridRect.rowSpan === 5);
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

function storedLayoutHasPanelKind(layout: StoredTiledPanelState, kind: PanelContentKind): boolean {
  return Object.values(layout.contents).some((content) => content.kind === kind);
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
  return visibleLayoutPresets(presets).map((preset) => ({
    id: preset.id,
    kind: preset.kind,
    name: preset.name,
    aliases: presetAliasesForAgent(preset)
  }));
}

export function visibleLayoutPresets(presets: readonly LayoutPreset[]): LayoutPreset[] {
  return presets.filter((preset) => preset.role !== "incident-response");
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
