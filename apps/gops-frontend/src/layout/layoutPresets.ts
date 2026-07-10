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

const ASSET_PORTFOLIO_LAYOUT_VERSION = 3;

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
      { kind: "news", gridRect: { col: 1, row: 5, colSpan: 8, rowSpan: 2 } }
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
      {
        kind: "portfolioMulti",
        gridRect: { col: 1, row: 1, colSpan: 2, rowSpan: 5 },
        props: { portfolioLayoutVersion: ASSET_PORTFOLIO_LAYOUT_VERSION }
      },
      { kind: "portfolioHoldings", gridRect: { col: 3, row: 1, colSpan: 4, rowSpan: 5 } },
      { kind: "trade", gridRect: { col: 7, row: 1, colSpan: 2, rowSpan: 5 } }
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
  void viewport;
  void options;
  return state;
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
  "portfolioHoldings",
  "portfolioHoldingsCards"
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
    aliases.push(preset.id);
  }
  return Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)));
}

function readPresetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function compactPresetPrompt(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}
