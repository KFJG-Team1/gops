import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chartCanvasSource = readFileSync(new URL("../src/chart/ChartCanvas.tsx", import.meta.url), "utf-8");

assert.match(
  chartCanvasSource,
  /if \(scene\.plot\.belowPanes\.length\) \{[\s\S]*context\.strokeStyle = colors\.axis;[\s\S]*context\.globalAlpha = 0\.36;[\s\S]*scene\.plot\.belowPanes\.slice\(1\)/
);
