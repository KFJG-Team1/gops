export const TYPE_SIZE = {
  micro: 10,
  compact: 12,
  body: 14,
  title: 18,
  display: 32
} as const;

export const CANVAS_FONT_FAMILY = '"Asta Sans", Arial, ui-sans-serif, system-ui, sans-serif';

const typeSizeValues = Object.values(TYPE_SIZE);

export function nearestTypeSize(value: number, maxSize: number = TYPE_SIZE.display): number {
  const candidates = typeSizeValues.filter((size) => size <= maxSize);
  return candidates.reduce((nearest, size) => (
    Math.abs(size - value) <= Math.abs(nearest - value) ? size : nearest
  ), candidates[0] ?? TYPE_SIZE.micro);
}
