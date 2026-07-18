export type ChartEventPopoverPlacementInput = {
  viewportWidth: number;
  viewportHeight: number;
  anchorX: number;
  anchorY: number;
  contentHeight: number;
  preferredWidth?: number;
};

export type ChartEventPopoverPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
  transformOrigin: string;
};

const viewportMargin = 12;
const defaultPreferredWidth = 432;
const aboveGap = 14;
const belowGap = 38;

export function chartEventPopoverPlacement({
  viewportWidth,
  viewportHeight,
  anchorX,
  anchorY,
  contentHeight,
  preferredWidth = defaultPreferredWidth
}: ChartEventPopoverPlacementInput): ChartEventPopoverPlacement {
  const maxHeight = Math.max(0, viewportHeight - viewportMargin * 2);
  const width = Math.max(0, Math.min(preferredWidth, viewportWidth - viewportMargin * 2));
  const height = Math.max(0, Math.min(contentHeight, maxHeight));
  const maxLeft = Math.max(viewportMargin, viewportWidth - width - viewportMargin);
  const left = clamp(anchorX - width / 2, viewportMargin, maxLeft);
  const spaceAbove = anchorY - viewportMargin - aboveGap;
  const spaceBelow = viewportHeight - anchorY - viewportMargin - belowGap;
  const placement = spaceAbove >= height || (spaceBelow < height && spaceAbove > spaceBelow)
    ? "above"
    : "below";
  const desiredTop = placement === "above"
    ? anchorY - aboveGap - height
    : anchorY + belowGap;
  const top = clamp(desiredTop, viewportMargin, Math.max(viewportMargin, viewportHeight - height - viewportMargin));
  const horizontalOrigin = anchorX <= left + width / 3
    ? "left"
    : anchorX >= left + width * 2 / 3
      ? "right"
      : "center";

  return {
    left,
    top,
    width,
    maxHeight,
    placement,
    transformOrigin: `${placement === "above" ? "bottom" : "top"} ${horizontalOrigin}`
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
