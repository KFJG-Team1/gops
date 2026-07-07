import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthUser } from "../auth/AuthProvider";
import {
  DEFAULT_PRESETS,
  DEFAULT_PRESET_IDS,
  createCustomPresetId,
  nextCustomPresetName,
  type DefaultPresetId,
  type LayoutPreset
} from "./layoutPresets";
import type { StoredTiledPanelState, TiledPanelState } from "./panelLayout";

const PRESETS_STORAGE_KEY = "gops:layout-presets:v1";
const ACTIVE_PRESET_STORAGE_KEY = "gops:layout-active-preset:v1";
const PRESETS_ENDPOINT = "/api/charts/presets";

type StoredPreset = { id: string; name: string; layout: Record<string, unknown> };
type DefaultOverride = { name?: string; layout?: StoredTiledPanelState };
type DefaultOverrides = Partial<Record<DefaultPresetId, DefaultOverride>>;
type CustomPreset = { id: string; kind: "custom"; name: string; layout: StoredTiledPanelState };

export type LayoutPresetControls = {
  presets: LayoutPreset[];
  activePresetId: string | null;
  applyPreset: (id: string) => void;
  createCustomPreset: () => string | null;
  renamePreset: (id: string, name: string) => void;
  deleteCustomPreset: (id: string) => void;
  saveActivePresetLayout: () => void;
};

const DEFAULT_ID_SET = new Set<string>(DEFAULT_PRESET_IDS);

function isDefaultId(id: string): id is DefaultPresetId {
  return DEFAULT_ID_SET.has(id);
}

function isStoredSnapshot(value: unknown): value is StoredTiledPanelState {
  return Boolean(value) && typeof value === "object" && (value as { version?: unknown }).version === 1;
}

function defaultName(id: DefaultPresetId): string {
  return DEFAULT_PRESETS.find((preset) => preset.id === id)?.name ?? id;
}

function splitStoredPresets(list: unknown): { overrides: DefaultOverrides; customs: CustomPreset[] } {
  const overrides: DefaultOverrides = {};
  const customs: CustomPreset[] = [];
  if (!Array.isArray(list)) {
    return { overrides, customs };
  }
  list.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!id || !name) {
      return;
    }
    const layout = isStoredSnapshot(record.layout) ? (record.layout as StoredTiledPanelState) : undefined;
    if (isDefaultId(id)) {
      overrides[id] = { name, layout };
    } else if (layout) {
      customs.push({ id, kind: "custom", name, layout });
    }
  });
  return { overrides, customs };
}

function serializePresets(overrides: DefaultOverrides, customs: CustomPreset[]): StoredPreset[] {
  const stored: StoredPreset[] = [];
  DEFAULT_PRESET_IDS.forEach((id) => {
    const override = overrides[id];
    if (override) {
      stored.push({ id, name: override.name ?? defaultName(id), layout: override.layout ?? {} });
    }
  });
  customs.forEach((preset) => {
    stored.push({ id: preset.id, name: preset.name, layout: preset.layout });
  });
  return stored;
}

function loadStoredPresets(): StoredPreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalPresets(list: StoredPreset[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Presets stay in memory if browser storage is unavailable.
  }
}

function loadActivePresetId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveActivePresetId(id: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_PRESET_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function fetchServerPresets(signal?: AbortSignal): Promise<StoredPreset[] | null> {
  try {
    const response = await fetch(PRESETS_ENDPOINT, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return Array.isArray(payload?.presets) ? payload.presets : [];
  } catch {
    return null;
  }
}

async function saveServerPresets(list: StoredPreset[]): Promise<void> {
  try {
    await fetch(PRESETS_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presets: list })
    });
  } catch {
    // Server sync is best-effort; the local copy already holds the change.
  }
}

type UseLayoutPresetsArgs = {
  authUser: AuthUser | null;
  authLoading: boolean;
  serializeCurrentLayout: () => StoredTiledPanelState;
  applyLayout: (state: TiledPanelState) => void;
  buildLayout: (preset: LayoutPreset) => TiledPanelState | null;
};

export function useLayoutPresets({
  authUser,
  authLoading,
  serializeCurrentLayout,
  applyLayout,
  buildLayout
}: UseLayoutPresetsArgs): LayoutPresetControls {
  const [initialPresets] = useState(() => splitStoredPresets(loadStoredPresets()));
  const [overrides, setOverrides] = useState<DefaultOverrides>(initialPresets.overrides);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(initialPresets.customs);
  const [activePresetId, setActivePresetId] = useState<string | null>(() => loadActivePresetId());
  const authUserRef = useRef<AuthUser | null>(authUser);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  // Load presets from the account (server) when signed in, else from local storage.
  useEffect(() => {
    if (authLoading) {
      return undefined;
    }
    const applyList = (list: unknown) => {
      const split = splitStoredPresets(list);
      setOverrides(split.overrides);
      setCustomPresets(split.customs);
    };
    if (!authUser) {
      applyList(loadStoredPresets());
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    void fetchServerPresets(controller.signal).then((server) => {
      if (cancelled) {
        return;
      }
      if (server && server.length) {
        applyList(server);
        return;
      }
      const local = loadStoredPresets();
      applyList(local);
      if (local.length) {
        void saveServerPresets(local);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authUser, authLoading]);

  const persist = useCallback((nextOverrides: DefaultOverrides, nextCustoms: CustomPreset[]) => {
    const list = serializePresets(nextOverrides, nextCustoms);
    saveLocalPresets(list);
    if (authUserRef.current) {
      void saveServerPresets(list);
    }
  }, []);

  const commitActivePresetId = useCallback((id: string | null) => {
    setActivePresetId(id);
    saveActivePresetId(id);
  }, []);

  const presets = useMemo<LayoutPreset[]>(() => [
    ...DEFAULT_PRESETS.map((preset): LayoutPreset => {
      const override = overrides[preset.id as DefaultPresetId];
      return { id: preset.id, kind: "default", name: override?.name ?? preset.name, layout: override?.layout };
    }),
    ...customPresets
  ], [overrides, customPresets]);

  const applyPreset = useCallback((id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) {
      return;
    }
    const layout = buildLayout(preset);
    if (layout) {
      applyLayout(layout);
    }
    commitActivePresetId(id);
  }, [applyLayout, buildLayout, commitActivePresetId, presets]);

  const createCustomPreset = useCallback((): string | null => {
    const layout = serializeCurrentLayout();
    const name = nextCustomPresetName([
      ...DEFAULT_PRESETS.map((preset) => overrides[preset.id as DefaultPresetId]?.name ?? preset.name),
      ...customPresets.map((preset) => preset.name)
    ]);
    const preset: CustomPreset = { id: createCustomPresetId(), kind: "custom", name, layout };
    const nextCustoms = [...customPresets, preset];
    setCustomPresets(nextCustoms);
    persist(overrides, nextCustoms);
    commitActivePresetId(preset.id);
    return preset.id;
  }, [commitActivePresetId, customPresets, overrides, persist, serializeCurrentLayout]);

  const renamePreset = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (isDefaultId(id)) {
      const nextOverrides: DefaultOverrides = { ...overrides, [id]: { ...overrides[id], name: trimmed } };
      setOverrides(nextOverrides);
      persist(nextOverrides, customPresets);
      return;
    }
    const nextCustoms = customPresets.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset));
    setCustomPresets(nextCustoms);
    persist(overrides, nextCustoms);
  }, [customPresets, overrides, persist]);

  const deleteCustomPreset = useCallback((id: string) => {
    if (isDefaultId(id)) {
      return;
    }
    const nextCustoms = customPresets.filter((preset) => preset.id !== id);
    setCustomPresets(nextCustoms);
    persist(overrides, nextCustoms);
    if (activePresetId === id) {
      commitActivePresetId(null);
    }
  }, [activePresetId, commitActivePresetId, customPresets, overrides, persist]);

  const saveActivePresetLayout = useCallback(() => {
    if (!activePresetId) {
      return;
    }
    const layout = serializeCurrentLayout();
    if (isDefaultId(activePresetId)) {
      const nextOverrides: DefaultOverrides = { ...overrides, [activePresetId]: { ...overrides[activePresetId], layout } };
      setOverrides(nextOverrides);
      persist(nextOverrides, customPresets);
      return;
    }
    const nextCustoms = customPresets.map((preset) => (preset.id === activePresetId ? { ...preset, layout } : preset));
    setCustomPresets(nextCustoms);
    persist(overrides, nextCustoms);
  }, [activePresetId, customPresets, overrides, persist, serializeCurrentLayout]);

  return {
    presets,
    activePresetId,
    applyPreset,
    createCustomPreset,
    renamePreset,
    deleteCustomPreset,
    saveActivePresetLayout
  };
}
