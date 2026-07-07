import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PanelContentInstance, PanelSlot } from "../layout/panelLayout";

type WorkspacePanelFrameProps = {
  slot: PanelSlot;
  content: PanelContentInstance;
  style: CSSProperties;
  className?: string;
  isBoundaryActive?: boolean;
  isChartHovered?: boolean;
  showNav?: boolean;
  onFramePointerDown?: (slotId: string) => (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  editControls?: ReactNode;
  children: ReactNode;
};

export function WorkspacePanelFrame({
  slot,
  content,
  style,
  className = "",
  isBoundaryActive = false,
  isChartHovered = false,
  showNav = true,
  onFramePointerDown,
  onPointerEnter,
  onPointerLeave,
  editControls,
  children
}: WorkspacePanelFrameProps) {
  return (
    <section
      className={[
        "workspace-panel-frame",
        "workspace-panel-surface",
        showNav ? "has-panel-nav" : "has-no-panel-nav",
        content.kind === "chart" ? "chart-lane-frame" : "content-panel-frame",
        isBoundaryActive ? "is-boundary-active" : "",
        isChartHovered ? "is-chart-hovered" : "",
        className
      ].filter(Boolean).join(" ")}
      style={style}
      data-panel-slot-id={slot.id}
      data-panel-kind={content.kind}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onFramePointerDown?.(slot.id)}
    >
      {showNav && (
        <header
          className="workspace-panel-nav"
          aria-label={`${content.title} panel navigation`}
        >
          <span className="workspace-panel-title">{content.title}</span>
        </header>
      )}
      <div className={content.kind === "chart" ? "workspace-panel-body chart-panel-body" : "workspace-panel-body"}>
        {children}
      </div>
      {editControls}
    </section>
  );
}
