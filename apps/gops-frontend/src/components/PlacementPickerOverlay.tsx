import { useEffect, useMemo, useState } from "react";
import {
  panelRectForGridRect,
  type PanelGridRect,
  type ViewportSize,
  type WorkspaceLayoutMetrics
} from "../layout/panelLayout";
import type { PendingPlacementPick, PlacementPickCandidate } from "../layout/tiledAgentLayout";

type PlacementPickerOverlayProps = {
  pick: PendingPlacementPick;
  viewportSize: ViewportSize;
  layoutMetrics: WorkspaceLayoutMetrics;
  onSelect: (candidate: PlacementPickCandidate) => void;
  onCancel: () => void;
};

export function PlacementPickerOverlay({
  pick,
  viewportSize,
  layoutMetrics,
  onSelect,
  onCancel
}: PlacementPickerOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(pick.candidates[0]?.id ?? null);
  const hoveredCandidate = useMemo(
    () => pick.candidates.find((candidate) => candidate.id === hoveredId) ?? pick.candidates[0],
    [hoveredId, pick.candidates]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="placement-picker-overlay" role="dialog" aria-modal="true" onPointerDown={onCancel}>
      <div className="placement-picker-ghosts" aria-hidden="true">
        {hoveredCandidate?.arrangement.flatMap((item, index) => {
          const rect = placementFromArrangementItem(item);
          if (!rect) {
            return [];
          }
          return (
            <div
              key={`${hoveredCandidate.id}-ghost-${index}`}
              className="placement-picker-ghost"
              style={panelRectForGridRect(rect, viewportSize, layoutMetrics)}
            />
          );
        })}
      </div>
      {pick.candidates.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          className={`placement-picker-target${candidate.id === hoveredCandidate?.id ? " is-active" : ""}`}
          style={panelRectForGridRect(candidate.placement, viewportSize, layoutMetrics)}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => setHoveredId(candidate.id)}
          onFocus={() => setHoveredId(candidate.id)}
          onClick={() => onSelect(candidate)}
        >
          <span>{candidate.label}</span>
        </button>
      ))}
    </div>
  );
}

function placementFromArrangementItem(item: unknown): PanelGridRect | null {
  if (!isRecord(item) || !isRecord(item.placement)) {
    return null;
  }
  return placementToGridRect(item.placement);
}

function placementToGridRect(placement: unknown): PanelGridRect | null {
  if (!isRecord(placement)) {
    return null;
  }
  if (!isNumber(placement.col) || !isNumber(placement.row) || !isNumber(placement.colSpan) || !isNumber(placement.rowSpan)) {
    return null;
  }
  return {
    col: placement.col,
    row: placement.row,
    colSpan: placement.colSpan,
    rowSpan: placement.rowSpan
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
