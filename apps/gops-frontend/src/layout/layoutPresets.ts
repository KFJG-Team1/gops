import {
  createTiledPanelStateFromSpec,
  panelContentTitle,
  restoreTiledPanelStateSnapshot,
  type PanelLayoutSpecItem,
  type PanelContentKind,
  type StoredTiledPanelState,
  type TiledPanelState,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "./panelLayout";

export type DefaultPresetId = "market" | "stock" | "chart" | "compare" | "asset";

// Both default and custom presets are per-user editable. Defaults keep their built-in
// arrangement unless the user saves an override `layout`; they can be renamed but not deleted.
export type LayoutPreset = {
  id: string;
  kind: "default" | "custom";
  name: string;
  layout?: StoredTiledPanelState;
};

type DefaultPresetDefinition = { name: string; spec: readonly PanelLayoutSpecItem[] };

// Sensible starting arrangements built from the existing panels (8 cols x 6 rows).
// These are provided defaults; the user can rearrange and save their own presets.
const DEFAULT_PRESET_DEFINITIONS: Record<DefaultPresetId, DefaultPresetDefinition> = {
  market: {
    name: "시장분석",
    spec: [
      { kind: "indices", gridRect: { col: 1, row: 1, colSpan: 3, rowSpan: 2 } },
      { kind: "themeRadar", gridRect: { col: 4, row: 1, colSpan: 5, rowSpan: 2 } },
      { kind: "popular", gridRect: { col: 1, row: 3, colSpan: 3, rowSpan: 3 } },
      { kind: "news", gridRect: { col: 4, row: 3, colSpan: 3, rowSpan: 3 } },
      { kind: "ontology", gridRect: { col: 7, row: 3, colSpan: 2, rowSpan: 3 } }
    ]
  },
  stock: {
    name: "종목분석",
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
      { kind: "news", gridRect: { col: 1, row: 5, colSpan: 8, rowSpan: 1 } }
    ]
  },
  compare: {
    name: "비교분석",
    spec: [
      { kind: "compare", gridRect: { col: 1, row: 1, colSpan: 8, rowSpan: 3 } },
      { kind: "indices", gridRect: { col: 1, row: 4, colSpan: 4, rowSpan: 2 } },
      { kind: "watchlistNews", gridRect: { col: 5, row: 4, colSpan: 4, rowSpan: 2 } }
    ]
  },
  asset: {
    name: "자산현황",
    spec: [
      { kind: "portfolioInvestment", gridRect: { col: 1, row: 1, colSpan: 3, rowSpan: 5 } },
      { kind: "portfolioHoldings", gridRect: { col: 4, row: 1, colSpan: 5, rowSpan: 5 } }
    ]
  }
};

export const DEFAULT_PRESET_IDS: readonly DefaultPresetId[] = ["market", "stock", "compare", "chart", "asset"];

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
    const restored = restoreTiledPanelStateSnapshot(layout, viewport, options.layoutMetrics);
    if (restored) {
      return restored;
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
  const contentKinds = state.slots
    .map((slot) => state.contents[slot.contentId]?.kind)
    .filter((kind): kind is PanelContentKind => Boolean(kind));
  if (!shouldReplaceLegacyPortfolioWorkspace(contentKinds)) {
    return state;
  }
  return createAssetPortfolioPanelState(viewport, options);
}

export function migratePortfolioInvestmentSnapshot(value: unknown): unknown {
  if (!isStoredTiledPanelStateShape(value)) {
    return value;
  }
  const layout = value;
  const contentKinds = Object.values(layout.contents).map((content) => content.kind);
  const hasAnyPortfolioPanel = hasPortfolioPanelKind(contentKinds);
  if (!hasAnyPortfolioPanel) {
    return layout;
  }

  if (hasRetiredSplitPortfolioPanel(contentKinds)) {
    return createStoredAssetPortfolioLayout();
  }

  if (hasIntegratedPortfolioPanels(contentKinds)) {
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

  return createStoredAssetPortfolioLayout();
}

const integratedPortfolioPanelKinds: readonly PanelContentKind[] = [
  "portfolioInvestment",
  "portfolioHoldings"
];

const retiredSplitPortfolioPanelKinds: readonly PanelContentKind[] = [
  "portfolioPerformance",
  "portfolioInvested",
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

function hasIntegratedPortfolioPanels(kinds: readonly PanelContentKind[]): boolean {
  return integratedPortfolioPanelKinds.every((kind) => kinds.includes(kind))
    && !hasRetiredSplitPortfolioPanel(kinds);
}

function hasRetiredSplitPortfolioPanel(kinds: readonly PanelContentKind[]): boolean {
  return kinds.some((kind) => retiredSplitPortfolioPanelKinds.includes(kind));
}

function shouldReplaceLegacyPortfolioWorkspace(kinds: readonly PanelContentKind[]): boolean {
  if (!hasPortfolioPanelKind(kinds)) {
    return false;
  }
  if (hasRetiredSplitPortfolioPanel(kinds)) {
    return true;
  }
  if (hasIntegratedPortfolioPanels(kinds)) {
    return false;
  }
  if (!kinds.every((kind) => legacyPortfolioWorkspaceAllowedKinds.includes(kind))) {
    return false;
  }
  const portfolioCount = kinds.filter((kind) => portfolioWorkspaceKinds.includes(kind)).length;
  return portfolioCount >= 2 || kinds.some((kind) => kind === "portfolio" || kind === "portfolioInvestment");
}

function createAssetPortfolioPanelState(
  viewport: ViewportSize,
  options: { layoutMetrics?: WorkspaceLayoutMetrics } = {}
): TiledPanelState {
  return createTiledPanelStateFromSpec(DEFAULT_PRESET_DEFINITIONS.asset.spec, viewport, {
    layoutMetrics: options.layoutMetrics
  });
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
      ...(typeof item.layoutWeight === "number" ? { layoutWeight: item.layoutWeight } : {})
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
