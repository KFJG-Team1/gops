import {
  createTiledPanelStateFromSpec,
  restoreTiledPanelStateSnapshot,
  type PanelLayoutSpecItem,
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

// Sensible starting arrangements built from the existing panels (8 cols x 5 rows).
// These are provided defaults; the user can rearrange and save their own presets.
const DEFAULT_PRESET_DEFINITIONS: Record<DefaultPresetId, DefaultPresetDefinition> = {
  market: {
    name: "시장분석",
    spec: [
      { kind: "indices", gridRect: { col: 1, row: 1, colSpan: 4, rowSpan: 2 } },
      { kind: "popular", gridRect: { col: 5, row: 1, colSpan: 4, rowSpan: 2 } },
      { kind: "news", gridRect: { col: 1, row: 3, colSpan: 4, rowSpan: 3 } },
      { kind: "ontology", gridRect: { col: 5, row: 3, colSpan: 4, rowSpan: 3 } }
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
      { kind: "portfolio", gridRect: { col: 1, row: 1, colSpan: 3, rowSpan: 5 } },
      { kind: "trade", gridRect: { col: 4, row: 1, colSpan: 2, rowSpan: 5 } },
      { kind: "recommendations", gridRect: { col: 6, row: 1, colSpan: 3, rowSpan: 5 } }
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
    const restored = restoreTiledPanelStateSnapshot(preset.layout, viewport, options.layoutMetrics);
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
