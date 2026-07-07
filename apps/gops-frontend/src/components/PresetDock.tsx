import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { LayoutPreset } from "../layout/layoutPresets";
import type { LayoutPresetControls } from "../layout/useLayoutPresets";

type PresetDockProps = {
  controls: LayoutPresetControls;
  onShowHome: () => void;
};

export function PresetDock({ controls, onShowHome }: PresetDockProps) {
  const { presets, activePresetId, applyPreset, createCustomPreset, renamePreset, deleteCustomPreset, saveActivePresetLayout } = controls;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const defaults = presets.filter((preset) => preset.kind === "default");
  const customs = presets.filter((preset) => preset.kind === "custom");
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

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
  const handlePresetClick = (preset: LayoutPreset) => {
    if (activePresetId === preset.id) {
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
      <button
        key={preset.id}
        type="button"
        className={`layout-preset-button ${activePresetId === preset.id ? "is-active" : ""}`}
        aria-pressed={activePresetId === preset.id}
        title={activePresetId === preset.id ? "다시 눌러 이름 변경" : preset.name}
        onClick={() => handlePresetClick(preset)}
      >
        {preset.name}
      </button>
    )
  );

  return (
    <div className="layout-preset-dock" role="toolbar" aria-label="레이아웃 프리셋" onPointerDown={stopPointer}>
      <button type="button" className="layout-preset-button preset-home" onClick={onShowHome}>
        증시맵
      </button>
      <span className="toolbar-separator" aria-hidden="true" />
      {defaults.map(renderPreset)}
      <span className="toolbar-separator" aria-hidden="true" />
      {customs.map(renderPreset)}
      <button type="button" className="layout-preset-add" aria-label="현재 배치를 프리셋으로 추가" title="현재 배치를 프리셋으로 추가" onClick={handleAdd}>
        <Plus size={14} aria-hidden="true" />
      </button>
      {activePreset && (
        <>
          <span className="toolbar-separator" aria-hidden="true" />
          <button type="button" className="layout-preset-action" onClick={saveActivePresetLayout}>
            저장
          </button>
          {activePreset.kind === "custom" && (
            <button type="button" className="layout-preset-action danger" onClick={() => deleteCustomPreset(activePreset.id)}>
              삭제
            </button>
          )}
        </>
      )}
    </div>
  );
}
