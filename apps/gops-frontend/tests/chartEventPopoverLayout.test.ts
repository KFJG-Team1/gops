import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chartEventPopoverPlacement } from "../src/chart/chartEventPopoverLayout";

const aboveAnchor = chartEventPopoverPlacement({
  viewportWidth: 1200,
  viewportHeight: 800,
  anchorX: 600,
  anchorY: 700,
  contentHeight: 380
});
assert.deepEqual(aboveAnchor, {
  left: 384,
  top: 306,
  width: 432,
  maxHeight: 776,
  placement: "above",
  transformOrigin: "bottom center"
});

const belowAnchor = chartEventPopoverPlacement({
  viewportWidth: 360,
  viewportHeight: 640,
  anchorX: 24,
  anchorY: 90,
  contentHeight: 320
});
assert.deepEqual(belowAnchor, {
  left: 12,
  top: 128,
  width: 336,
  maxHeight: 616,
  placement: "below",
  transformOrigin: "top left"
});

const constrainedViewport = chartEventPopoverPlacement({
  viewportWidth: 900,
  viewportHeight: 320,
  anchorX: 450,
  anchorY: 160,
  contentHeight: 600
});
assert.deepEqual(constrainedViewport, {
  left: 234,
  top: 12,
  width: 432,
  maxHeight: 296,
  placement: "above",
  transformOrigin: "bottom center"
});

const compactNewsPopover = chartEventPopoverPlacement({
  viewportWidth: 1200,
  viewportHeight: 800,
  anchorX: 600,
  anchorY: 700,
  contentHeight: 380,
  preferredWidth: 360
});
assert.deepEqual(compactNewsPopover, {
  left: 420,
  top: 306,
  width: 360,
  maxHeight: 776,
  placement: "above",
  transformOrigin: "bottom center"
});

const overlaySource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartEventOverlay.tsx", import.meta.url)),
  "utf-8"
);
assert.match(overlaySource, /chart-event-popover-badge/);
assert.match(overlaySource, /chart-event-context-strip/);
assert.match(overlaySource, /chart-event-highlight/);
assert.match(overlaySource, /chart-event-detail-list/);
assert.match(overlaySource, /chart-event-section-label/);
assert.match(overlaySource, /chart-event-source-footer/);
assert.match(overlaySource, /chart-event-news-meta/);
assert.match(overlaySource, /chart-event-news-impact/);
assert.match(overlaySource, /preferredWidth: selected\.event\.type === "news" \? 360/);
assert.doesNotMatch(overlaySource, /chart-event-metrics/);

const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8"
);
assert.match(stylesSource, /\.chart-event-popover-badge\s*\{[\s\S]*clip-path: polygon/);
assert.match(stylesSource, /\.chart-event-highlight\s*\{[\s\S]*font-variant-numeric: tabular-nums/);
assert.match(stylesSource, /\.chart-event-detail-list\s*\{[\s\S]*grid-template-columns/);
assert.match(stylesSource, /\.chart-event-source-footer\s*\{[\s\S]*border-top/);
assert.match(stylesSource, /\.chart-event-popover\.is-news > header\s*\{[\s\S]*border-bottom: 0/);
assert.match(stylesSource, /\.chart-event-news-meta\s*\{[\s\S]*grid/);
