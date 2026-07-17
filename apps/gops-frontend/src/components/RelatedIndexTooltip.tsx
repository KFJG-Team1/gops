import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { GlossaryText } from "../glossary/GlossaryText";
import type { RelatedIndexCommentary } from "../market/relatedIndicesApi";

export type RelatedIndexTooltipEntry = {
  id: string;
  indexSymbol: string;
  commentary: RelatedIndexCommentary;
};

type AnchorSnapshot = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type TooltipSnapshot = {
  entry: RelatedIndexTooltipEntry | null;
  anchor: AnchorSnapshot | null;
  pinned: boolean;
};

const hiddenSnapshot: TooltipSnapshot = { entry: null, anchor: null, pinned: false };
let snapshot = hiddenSnapshot;
let showTimer: number | null = null;
let hideTimer: number | null = null;
const listeners = new Set<() => void>();

export function scheduleRelatedIndexTooltip(entry: RelatedIndexTooltipEntry, rect: DOMRect): void {
  if (snapshot.pinned) {
    return;
  }
  cancelRelatedIndexTooltipTimers();
  const anchor = snapshotRect(rect);
  const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150;
  showTimer = window.setTimeout(() => {
    showTimer = null;
    publish({ entry, anchor, pinned: false });
  }, delay);
}

export function toggleRelatedIndexTooltip(entry: RelatedIndexTooltipEntry, rect: DOMRect): void {
  cancelRelatedIndexTooltipTimers();
  if (snapshot.pinned && snapshot.entry?.id === entry.id) {
    publish(hiddenSnapshot);
    return;
  }
  publish({ entry, anchor: snapshotRect(rect), pinned: true });
}

export function hideRelatedIndexTooltip(force = false): void {
  cancelRelatedIndexTooltipTimers();
  if (snapshot.entry && (force || !snapshot.pinned)) {
    publish(hiddenSnapshot);
  }
}

export function scheduleHideRelatedIndexTooltip(): void {
  cancelShowTimer();
  cancelHideTimer();
  if (snapshot.pinned) {
    return;
  }
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    hideRelatedIndexTooltip();
  }, 90);
}

export function keepRelatedIndexTooltipOpen(): void {
  cancelHideTimer();
}

export function updateRelatedIndexTooltip(entry: RelatedIndexTooltipEntry): void {
  if (snapshot.entry?.id !== entry.id || !snapshot.anchor) {
    return;
  }
  publish({ ...snapshot, entry });
}

export function useRelatedIndexTooltipOpen(entryId: string): boolean {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return current.entry?.id === entryId;
}

export function relatedIndexTooltipState(): { entryId: string | null; pinned: boolean } {
  return {
    entryId: snapshot.entry?.id ?? null,
    pinned: snapshot.pinned
  };
}

export function RelatedIndexTooltip() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [position, setPosition] = useState({ left: 8, top: 8, placement: "above" as "above" | "below" });
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hideOnScroll = () => hideRelatedIndexTooltip(true);
    const hideOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".related-index-card-shell, .related-index-tooltip")) {
        return;
      }
      hideRelatedIndexTooltip(true);
    };
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideRelatedIndexTooltip(true);
      }
    };
    window.addEventListener("scroll", hideOnScroll, true);
    document.addEventListener("pointerdown", hideOnOutsidePointer);
    document.addEventListener("keydown", hideOnEscape);
    return () => {
      window.removeEventListener("scroll", hideOnScroll, true);
      document.removeEventListener("pointerdown", hideOnOutsidePointer);
      document.removeEventListener("keydown", hideOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!current.entry || !current.anchor) {
      return;
    }
    const bounds = tooltipRef.current?.getBoundingClientRect();
    const width = Math.min(bounds?.width ?? 250, 250);
    const height = bounds?.height ?? 150;
    const centered = current.anchor.left + current.anchor.width / 2 - width / 2;
    const left = Math.max(8, Math.min(centered, window.innerWidth - width - 8));
    const above = current.anchor.top - height - 10;
    const placement = above >= 8 ? "above" : "below";
    const top = placement === "above"
      ? above
      : Math.min(window.innerHeight - height - 8, current.anchor.bottom + 10);
    setPosition({ left, top: Math.max(8, top), placement });
  }, [current]);

  if (!current.entry || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      ref={tooltipRef}
      id="gops-related-index-tooltip"
      className={`related-index-tooltip is-${position.placement}${current.pinned ? " is-pinned" : ""}`}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
      onMouseEnter={keepRelatedIndexTooltipOpen}
      onMouseLeave={scheduleHideRelatedIndexTooltip}
    >
      <strong>{current.entry.commentary.title}</strong>
      <p><GlossaryText text={current.entry.commentary.body} /></p>
      {current.entry.commentary.evidence.length > 0 && (
        <div className="related-index-tooltip-evidence" aria-label="선정 근거">
          {current.entry.commentary.evidence.map((item) => (
            <span key={`${item.label}-${item.value}`}><b>{item.label}</b>{item.value}</span>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TooltipSnapshot {
  return snapshot;
}

function getServerSnapshot(): TooltipSnapshot {
  return hiddenSnapshot;
}

function publish(next: TooltipSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function snapshotRect(rect: DOMRect): AnchorSnapshot {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function cancelRelatedIndexTooltipTimers(): void {
  cancelShowTimer();
  cancelHideTimer();
}

function cancelShowTimer(): void {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function cancelHideTimer(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}
