import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, LayoutPanelTop, Plus, Save, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
import { createLayoutEditControl } from "../layout/layoutEditControl";
import { visibleLayoutPresets, type LayoutPreset } from "../layout/layoutPresets";
import { incidentResponsePresetRole } from "../layout/incidentResponsePreset";
import type { LayoutPresetControls } from "../layout/useLayoutPresets";

type PresetDockProps = {
  controls: LayoutPresetControls;
  onShowHome: () => void;
  layoutEditMode: boolean;
  onEnterLayoutEdit: () => void;
  onExitLayoutEdit: () => void;
  layoutEditDisabled?: boolean;
  isHome?: boolean;
};

export function PresetDock({
  controls,
  onShowHome,
  layoutEditMode,
  onEnterLayoutEdit,
  onExitLayoutEdit,
  layoutEditDisabled = false,
  isHome = false
}: PresetDockProps) {
  const {
    presets,
    activePresetId,
    applyPreset,
    createCustomPreset,
    createIncidentResponsePreset,
    renamePreset,
    deleteCustomPreset,
    saveActivePresetLayout,
    setIncidentResponsePreset
  } = controls;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerMessage, setManagerMessage] = useState<string | null>(null);
  const [overflowEdges, setOverflowEdges] = useState({ left: false, right: false });
  const [activeIndicator, setActiveIndicator] = useState({ left: 0, width: 0, visible: false });
  const dockRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const presetButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const dockPresets = visibleLayoutPresets(presets);
  const defaults = dockPresets.filter((preset) => preset.kind === "default");
  const customs = dockPresets.filter((preset) => preset.kind === "custom");
  const allCustoms = presets.filter((preset) => preset.kind === "custom");
  const activePreset = dockPresets.find((preset) => preset.id === activePresetId) ?? null;
  const incidentPreset = allCustoms.find((preset) => preset.role === incidentResponsePresetRole) ?? null;
  const activePresetKey = isHome ? "__home__" : activePreset?.id ?? null;
  const layoutEditControl = createLayoutEditControl(layoutEditMode, onEnterLayoutEdit, onExitLayoutEdit);

  const updateActiveIndicator = useCallback(() => {
    const button = activePresetKey ? presetButtonRefs.current.get(activePresetKey) : null;
    if (!button) {
      setActiveIndicator((current) => current.visible ? { ...current, visible: false } : current);
      return;
    }
    const next = { left: button.offsetLeft, width: button.offsetWidth, visible: true };
    setActiveIndicator((current) => (
      current.left === next.left && current.width === next.width && current.visible
        ? current
        : next
    ));
  }, [activePresetKey]);

  const setPresetButtonRef = (key: string, node: HTMLButtonElement | null) => {
    if (node) {
      presetButtonRefs.current.set(key, node);
    } else {
      presetButtonRefs.current.delete(key);
    }
  };

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

  useEffect(() => {
    if (!managerOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setManagerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [managerOpen]);

  useLayoutEffect(() => {
    updateActiveIndicator();
  }, [editingId, presets.length, updateActiveIndicator]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) {
      return undefined;
    }
    const updateOverflowEdges = () => {
      const maxScrollLeft = Math.max(0, dock.scrollWidth - dock.clientWidth);
      const left = dock.scrollLeft > 1;
      const right = dock.scrollLeft < maxScrollLeft - 1;
      setOverflowEdges((current) => (
        current.left === left && current.right === right
          ? current
          : { left, right }
      ));
    };
    const updateDockMetrics = () => {
      updateOverflowEdges();
      updateActiveIndicator();
    };
    updateDockMetrics();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateDockMetrics);
    resizeObserver?.observe(dock);
    const activeButton = activePresetKey ? presetButtonRefs.current.get(activePresetKey) : null;
    if (activeButton) {
      resizeObserver?.observe(activeButton);
    }
    dock.addEventListener("scroll", updateOverflowEdges, { passive: true });
    window.addEventListener("resize", updateDockMetrics);
    return () => {
      resizeObserver?.disconnect();
      dock.removeEventListener("scroll", updateOverflowEdges);
      window.removeEventListener("resize", updateDockMetrics);
    };
  }, [activePresetId, activePresetKey, customs.length, defaults.length, editingId, updateActiveIndicator]);

  const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const scrollDockBy = useCallback((direction: -1 | 1) => {
    const dock = dockRef.current;
    if (!dock) {
      return;
    }
    dock.scrollBy({
      left: direction * Math.max(160, dock.clientWidth * 0.7),
      behavior: "smooth"
    });
  }, []);

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

  const enterIncidentPresetEditor = (presetId: string) => {
    applyPreset(presetId);
    setManagerOpen(false);
    window.requestAnimationFrame(onEnterLayoutEdit);
  };

  const createAndEditIncidentPreset = () => {
    const presetId = createIncidentResponsePreset();
    if (!presetId) {
      setManagerMessage("대응 프리셋을 만들지 못했습니다.");
      return;
    }
    setManagerOpen(false);
    window.requestAnimationFrame(onEnterLayoutEdit);
  };

  const handleIncidentRole = (preset: LayoutPreset, enabled: boolean) => {
    const result = setIncidentResponsePreset(preset.id, enabled);
    if (result.status === "invalid") {
      setManagerMessage(result.message);
      return;
    }
    if (result.status === "missing") {
      setManagerMessage("프리셋을 찾지 못했습니다.");
      return;
    }
    setManagerMessage(enabled
      ? "대응 프리셋으로 지정했습니다. 편집 화면으로 이동합니다."
      : "대응 프리셋 지정을 해제했습니다.");
    if (enabled) {
      enterIncidentPresetEditor(preset.id);
    }
  };

  const presetManager = managerOpen && typeof document !== "undefined"
    ? createPortal(
      <div
        className="preset-manager-backdrop"
        role="presentation"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setManagerOpen(false);
          }
        }}
      >
        <section className="preset-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-manager-title" onPointerDown={stopPointer}>
          <header className="preset-manager-header">
            <div>
              <span className="preset-manager-eyebrow">발표 준비용</span>
              <h2 id="preset-manager-title">대응 프리셋 지정하기</h2>
            </div>
            <button type="button" className="preset-manager-icon" aria-label="닫기" onClick={() => setManagerOpen(false)}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <p className="preset-manager-copy">
            발표 전에 원하는 패널 배치를 한 번 저장해 두세요. 이 프리셋은 상단 Dock에 노출되지 않고, “대응 어떻게 해야 해?” 같은 채팅에만 반응합니다.
          </p>
          <section className="preset-manager-response-card" aria-label="현재 대응 프리셋">
            <div className="preset-manager-row-copy">
              <strong>{incidentPreset?.name ?? "아직 지정된 대응 프리셋이 없습니다"}</strong>
              <span>{incidentPreset
                ? "패널을 자유롭게 추가·삭제·이동한 뒤 완료를 누르면 자동 저장됩니다."
                : "현재 보고 있는 화면을 시작점으로 복제한 뒤 원하는 패널만 구성할 수 있습니다."}</span>
            </div>
            <button
              type="button"
              className="preset-manager-primary"
              disabled={layoutEditDisabled}
              onClick={() => incidentPreset
                ? enterIncidentPresetEditor(incidentPreset.id)
                : createAndEditIncidentPreset()}
            >
              <LayoutPanelTop size={15} aria-hidden="true" />
              {incidentPreset ? "대응 프리셋 편집하기" : "현재 화면으로 대응 프리셋 만들기"}
            </button>
          </section>
          <div className="preset-manager-section-heading">
            <strong>기존 커스텀 프리셋에서 지정</strong>
            <span>기존 배치를 대응 프리셋으로 바꿀 수도 있습니다.</span>
          </div>
          <div className="preset-manager-list">
            {allCustoms.length === 0 ? (
              <p className="preset-manager-empty">저장된 커스텀 프리셋이 없습니다.</p>
            ) : allCustoms.map((preset) => {
              const isIncident = preset.role === incidentResponsePresetRole;
              return (
                <article key={preset.id} className={`preset-manager-row ${isIncident ? "is-incident" : ""}`}>
                  <div className="preset-manager-row-copy">
                    <strong>{preset.name}</strong>
                    <span>{isIncident ? "비공개 · Agent 채팅 전용" : "일반 커스텀 프리셋"}</span>
                  </div>
                  <div className="preset-manager-actions">
                    <button
                      type="button"
                      className="preset-manager-button"
                      onClick={() => isIncident
                        ? enterIncidentPresetEditor(preset.id)
                        : handleIncidentRole(preset, true)}
                    >
                      {isIncident ? "편집하기" : "대응 프리셋으로 지정하고 편집"}
                    </button>
                    {isIncident && (
                      <button
                        type="button"
                        className="preset-manager-button role is-active"
                        aria-pressed="true"
                        onClick={() => handleIncidentRole(preset, false)}
                      >
                        <ShieldCheck size={14} aria-hidden="true" />
                        지정 해제
                      </button>
                    )}
                    <button
                      type="button"
                      className="preset-manager-icon danger"
                      aria-label={`${preset.name} 삭제`}
                      title="프리셋 삭제"
                      onClick={() => deleteCustomPreset(preset.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {managerMessage && <p className="preset-manager-message">{managerMessage}</p>}
        </section>
      </div>,
      document.body
    )
    : null;

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
            ref={(node) => setPresetButtonRef(preset.id, node)}
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

  const hasDockOverflow = overflowEdges.left || overflowEdges.right;

  return (
    <div className="layout-preset-dock-wrap" onPointerDown={stopPointer}>
      {hasDockOverflow && (
        <button
          type="button"
          className="layout-preset-arrow"
          aria-label="이전 프리셋 보기"
          disabled={!overflowEdges.left}
          onClick={() => scrollDockBy(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      )}
    <div
      ref={dockRef}
      className={[
        "layout-preset-dock",
        overflowEdges.left ? "has-overflow-left" : "",
        overflowEdges.right ? "has-overflow-right" : ""
      ].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label="레이아웃 프리셋"
    >
      <span
        className={`layout-preset-active-indicator ${activeIndicator.visible ? "is-visible" : ""}`}
        style={{ width: `${activeIndicator.width}px`, transform: `translateX(${activeIndicator.left}px)` }}
        aria-hidden="true"
      />
      <button
        ref={(node) => setPresetButtonRef("__home__", node)}
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
        <button
          type="button"
          className={`layout-preset-edit ${layoutEditMode ? "is-active" : ""}`}
          aria-label={layoutEditControl.label}
          title={layoutEditControl.label}
          aria-pressed={layoutEditControl.pressed}
          disabled={layoutEditDisabled}
          onClick={layoutEditControl.onClick}
        >
          {layoutEditMode
            ? <Check size={15} aria-hidden="true" />
            : <LayoutPanelTop size={15} aria-hidden="true" />}
        </button>
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
          className="layout-preset-action"
          aria-label="대응 프리셋 지정하기"
          title="대응 프리셋 지정하기"
          onClick={() => {
            setManagerMessage(null);
            setManagerOpen(true);
          }}
        >
          <Settings2 size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
      {hasDockOverflow && (
        <button
          type="button"
          className="layout-preset-arrow"
          aria-label="다음 프리셋 보기"
          disabled={!overflowEdges.right}
          onClick={() => scrollDockBy(1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}
      {presetManager}
    </div>
  );
}
