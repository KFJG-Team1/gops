import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "./stockGlossary";

type TooltipSnapshot = {
  entry: GlossaryEntry | null;
  x: number;
  y: number;
  pinned: boolean;
};

const hiddenSnapshot: TooltipSnapshot = { entry: null, x: 0, y: 0, pinned: false };
let snapshot = hiddenSnapshot;
let showTimer: number | null = null;
const listeners = new Set<(next: TooltipSnapshot) => void>();

export function scheduleGlossaryTooltip(entry: GlossaryEntry, x: number, y: number): void {
  if (snapshot.pinned) {
    return;
  }
  cancelShowTimer();
  showTimer = window.setTimeout(() => {
    showTimer = null;
    publish({ entry, x, y, pinned: false });
  }, 150);
}

export function toggleGlossaryTooltip(entry: GlossaryEntry, x: number, y: number): void {
  cancelShowTimer();
  if (snapshot.pinned && snapshot.entry?.id === entry.id) {
    publish(hiddenSnapshot);
    return;
  }
  publish({ entry, x, y, pinned: true });
}

export function hideGlossaryTooltip(force = false): void {
  cancelShowTimer();
  if (snapshot.entry && (force || !snapshot.pinned)) {
    publish(hiddenSnapshot);
  }
}

export function GlossaryTooltip() {
  const [current, setCurrent] = useState(snapshot);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listeners.add(setCurrent);
    const hideOnScroll = () => hideGlossaryTooltip(true);
    const hideOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".glossary-term")) {
        return;
      }
      hideGlossaryTooltip(true);
    };
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideGlossaryTooltip(true);
      }
    };
    window.addEventListener("scroll", hideOnScroll, true);
    document.addEventListener("pointerdown", hideOnOutsidePointer);
    document.addEventListener("keydown", hideOnEscape);
    return () => {
      listeners.delete(setCurrent);
      window.removeEventListener("scroll", hideOnScroll, true);
      document.removeEventListener("pointerdown", hideOnOutsidePointer);
      document.removeEventListener("keydown", hideOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!current.entry) {
      return;
    }
    const rect = tooltipRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 280;
    const height = rect?.height ?? 96;
    const left = current.x + 12 + width > window.innerWidth
      ? Math.max(8, current.x - width - 12)
      : current.x + 12;
    const top = current.y + 12 + height > window.innerHeight
      ? Math.max(8, current.y - height - 12)
      : current.y + 12;
    setPosition({ left, top });
  }, [current]);

  if (!current.entry || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      ref={tooltipRef}
      id="gops-glossary-tooltip"
      className="glossary-tooltip"
      role="tooltip"
      style={position}
    >
      <strong>{current.entry.term}</strong>
      <span>{current.entry.description}</span>
    </div>,
    document.body
  );
}

function publish(next: TooltipSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener(next));
}

function cancelShowTimer(): void {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}
