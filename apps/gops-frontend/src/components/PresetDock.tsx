import { useEffect, useRef, useState } from "react";
import { Check, LayoutPanelTop, Plus, Save, Trash2 } from "lucide-react";
import type { LayoutPreset } from "../layout/layoutPresets";
import type { LayoutPresetControls } from "../layout/useLayoutPresets";

type PresetDockProps = {
  controls: LayoutPresetControls;
  onShowHome: () => void;
  onEnterLayoutEdit: () => void;
  layoutEditDisabled?: boolean;
  isHome?: boolean;
};

export function PresetDock({ controls, onShowHome, onEnterLayoutEdit, layoutEditDisabled = false, isHome = false }: PresetDockProps) {
  const { presets, activePresetId, applyPreset, createCustomPreset, renamePreset, deleteCustomPreset, saveActivePresetLayout } = controls;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const savedTimerRef = useRef<number | null>(null);

  const defaults = presets.filter((preset) => preset.kind === "default");
  const customs = presets.filter((preset) => preset.kind === "custom");
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => () => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
  }, []);

  const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const commitEditing = () => {
    if (editingId) {
      renamePreset(editingId, draftName);
    }
    setEditingId(null);
    setDraftName("");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraftName("");
  };

  // First click applies the preset; clicking the already-active one switches to rename.
  // On the home (증시지도) view no preset is active, so a click always applies/navigates.
  const handlePresetClick = (preset: LayoutPreset) => {
    if (!isHome && activePresetId === preset.id) {
      setEditingId(preset.id);
      setDraftName(preset.name);
      return;
    }
    applyPreset(preset.id);
  };

  const handleAdd = () => {
    const id = createCustomPreset();
    if (id) {
      setEditingId(id);
      setDraftName("");
    }
  };

  const handleSave = () => {
    saveActivePresetLayout();
    setSavedFlash(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setSavedFlash(false);
      savedTimerRef.current = null;
    }, 1000);
  };

  const renderPreset = (preset: LayoutPreset) => (
    editingId === preset.id ? (
      <input
        key={preset.id}
        ref={inputRef}
        className="layout-preset-input"
        value={draftName}
        placeholder={preset.name}
        aria-label="프리셋 이름"
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitEditing}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitEditing();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
        }}
      />
    ) : (
      (() => {
        const isActive = !isHome && activePresetId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            className={`layout-preset-button ${isActive ? "is-active" : ""}`}
            aria-pressed={isActive}
            title={isActive ? "다시 눌러 이름 변경" : preset.name}
            onClick={() => handlePresetClick(preset)}
          >
            {preset.name}
          </button>
        );
      })()
    )
  );

  return (
    <div className="layout-preset-dock" role="toolbar" aria-label="레이아웃 프리셋" onPointerDown={stopPointer}>
      <button
        type="button"
        className={`layout-preset-button preset-home ${isHome ? "is-active" : ""}`}
        aria-pressed={isHome}
        onClick={onShowHome}
      >
        증시지도
      </button>
      <span className="toolbar-separator" aria-hidden="true" />
      {defaults.map(renderPreset)}
      <span className="toolbar-separator" aria-hidden="true" />
      {customs.map(renderPreset)}
      <button type="button" className="layout-preset-add" aria-label="현재 배치를 프리셋으로 추가" title="현재 배치를 프리셋으로 추가" disabled={layoutEditDisabled} onClick={handleAdd}>
        <Plus size={14} aria-hidden="true" />
      </button>
      <span className="toolbar-separator" aria-hidden="true" />
      <div className="layout-preset-dock-tail">
        {activePreset && (
          <button type="button" className="layout-preset-action" aria-label="프리셋 저장" title="프리셋 저장" onClick={handleSave}>
            {savedFlash ? <Check size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
          </button>
        )}
        {activePreset?.kind === "custom" && (
          <button type="button" className="layout-preset-action danger" aria-label="프리셋 삭제" title="프리셋 삭제" onClick={() => deleteCustomPreset(activePreset.id)}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="layout-preset-edit"
          aria-label="레이아웃 수정모드 시작"
          title="레이아웃 수정모드 시작"
          disabled={layoutEditDisabled}
          onClick={onEnterLayoutEdit}
        >
          <LayoutPanelTop size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
