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

const overlaySource = readFileSync(
  fileURLToPath(new URL("../src/components/ChartEventOverlay.tsx", import.meta.url)),
  "utf-8"
);
assert.match(overlaySource, /chart-event-popover-badge/);
assert.match(overlaySource, /chart-event-popover-help/);
assert.match(overlaySource, /chart-event-meta-grid/);
assert.match(overlaySource, /chart-event-metric-group/);
assert.match(overlaySource, /chart-event-metric-row/);
assert.match(overlaySource, /chart-event-disclosure/);
assert.match(overlaySource, /chart-event-source-footer/);
assert.doesNotMatch(overlaySource, /chart-event-metrics/);
assert.doesNotMatch(overlaySource, /chart-event-context-strip/);
assert.doesNotMatch(overlaySource, /chart-event-highlight/);
assert.doesNotMatch(overlaySource, /chart-event-section-label/);

const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf-8"
);
assert.match(stylesSource, /\.chart-event-popover-badge\s*\{[\s\S]*clip-path: polygon/);
assert.match(stylesSource, /\.chart-event-popover::after\s*\{[\s\S]*width: 6px/);
assert.match(stylesSource, /\.chart-event-meta-grid\s*\{[\s\S]*grid-template-columns/);
assert.match(stylesSource, /\.chart-event-metric-row\s*\{[\s\S]*grid-template-columns/);
assert.match(stylesSource, /\.chart-event-metric-row\.is-accent/);
assert.match(stylesSource, /\.chart-event-disclosure > summary\s*\{[\s\S]*border:/);
