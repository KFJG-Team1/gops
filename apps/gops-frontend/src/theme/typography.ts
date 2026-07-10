export const TYPE_ROLE = {
  displayXl: { size: 48, weight: 500, lineHeight: 1.1, letterSpacing: 0, textTransform: "none" },
  displayLg: { size: 40, weight: 400, lineHeight: 1.2, letterSpacing: 0, textTransform: "none" },
  displayMd: { size: 32, weight: 400, lineHeight: 1.2, letterSpacing: 0, textTransform: "none" },
  titleLg: { size: 24, weight: 400, lineHeight: 1.35, letterSpacing: 0.12, textTransform: "none" },
  titleMd: { size: 20, weight: 400, lineHeight: 1.5, letterSpacing: 0, textTransform: "none" },
  titleSm: { size: 18, weight: 500, lineHeight: 1.4, letterSpacing: 0, textTransform: "none" },
  labelMd: { size: 16, weight: 500, lineHeight: 1.4, letterSpacing: 0, textTransform: "none" },
  button: { size: 16, weight: 500, lineHeight: 1.4, letterSpacing: 0, textTransform: "none" },
  bodyMd: { size: 14, weight: 400, lineHeight: 1.25, letterSpacing: 0, textTransform: "none" },
  caption: { size: 14, weight: 500, lineHeight: 1.35, letterSpacing: 0.16, textTransform: "none" },
  legal: { size: 13.12, weight: 600, lineHeight: 1.2, letterSpacing: 0, textTransform: "none" },
  pricingDisplay: { size: 44.8, weight: 475, lineHeight: 1.1, letterSpacing: 0, textTransform: "none" },
  pricingSection: { size: 28, weight: 475, lineHeight: 1.2, letterSpacing: 0, textTransform: "none" },
  pricingCardTitle: { size: 20, weight: 475, lineHeight: 1.3, letterSpacing: 0, textTransform: "none" }
} as const;

export type TypeRoleName = keyof typeof TYPE_ROLE;

export const TYPE_SIZE = {
  micro: 10,
  compact: 12,
  body: 14,
  title: 18,
  display: 32
} as const;

export const CANVAS_FONT_FAMILY = '"Asta Sans", Arial, ui-sans-serif, system-ui, sans-serif';

const typeSizeValues = Object.values(TYPE_SIZE);

const fittedRoleOrder: TypeRoleName[] = [
  "bodyMd",
  "caption",
  "labelMd",
  "titleSm",
  "titleMd",
  "titleLg",
  "displayMd",
  "displayLg",
  "displayXl"
];

export function nearestTypeRole(value: number, maxRole: TypeRoleName = "displayXl"): TypeRoleName {
  const maxSize = TYPE_ROLE[maxRole].size;
  const candidates = fittedRoleOrder.filter((role) => TYPE_ROLE[role].size <= maxSize);
  return candidates.reduce((nearest, role) => (
    Math.abs(TYPE_ROLE[role].size - value) <= Math.abs(TYPE_ROLE[nearest].size - value) ? role : nearest
  ), candidates[0] ?? "bodyMd");
}

export function nearestTypeSize(value: number, maxSize: number = TYPE_SIZE.display): number {
  const candidates = typeSizeValues.filter((size) => size <= maxSize);
  return candidates.reduce((nearest, size) => (
    Math.abs(size - value) <= Math.abs(nearest - value) ? size : nearest
  ), candidates[0] ?? TYPE_SIZE.micro);
}

export function applyCanvasTypography(
  context: CanvasRenderingContext2D,
  role: TypeRoleName,
  family: string = CANVAS_FONT_FAMILY
): void {
  const token = TYPE_ROLE[role];
  context.font = `${token.weight} ${token.size}px/${token.lineHeight} ${family}`;
  context.letterSpacing = `${token.letterSpacing}px`;
}
