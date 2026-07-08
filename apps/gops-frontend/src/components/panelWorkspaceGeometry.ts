import type { CSSProperties } from "react";
import type { PanelBoundary } from "../layout/panelLayout";

export function boundaryStyle(boundary: PanelBoundary): CSSProperties {
  if (boundary.orientation === "vertical") {
    return {
      left: boundary.position - 7,
      top: boundary.rangeStart,
      width: 14,
      height: boundary.rangeEnd - boundary.rangeStart
    };
  }
  return {
    left: boundary.rangeStart,
    top: boundary.position - 7,
    width: boundary.rangeEnd - boundary.rangeStart,
    height: 14
  };
}
