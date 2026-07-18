import { applyCanvasTypography, CANVAS_FONT_FAMILY } from "../theme/typography";

export const axisPillHorizontalPadding = 5;
export const axisPillHeight = 17;
export const rightAxisOuterInset = 4;

export type AxisPillAlign = "center" | "left" | "right";

export type AxisPillBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function measureAxisPillTextWidth(context: CanvasRenderingContext2D, text: string): number {
  context.save();
  applyCanvasTypography(context, "caption", CANVAS_FONT_FAMILY);
  const width = context.measureText(text).width;
  context.restore();
  return width;
}

export function axisPillBounds(
  textWidth: number,
  x: number,
  y: number,
  align: AxisPillAlign
): AxisPillBounds {
  const width = Math.max(0, textWidth) + axisPillHorizontalPadding * 2;
  const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;
  return {
    left,
    top: y - axisPillHeight / 2,
    width,
    height: axisPillHeight
  };
}

export function axisPillTextX(x: number, bounds: AxisPillBounds, align: AxisPillAlign): number {
  if (align === "right") return x - axisPillHorizontalPadding;
  if (align === "left") return x + axisPillHorizontalPadding;
  return bounds.left + bounds.width / 2;
}
