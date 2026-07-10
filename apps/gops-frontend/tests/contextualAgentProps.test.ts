import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const newsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/NewsPanel.tsx", import.meta.url)), "utf-8");
const watchlistNewsPanelSource = readFileSync(fileURLToPath(new URL("../src/components/WatchlistNewsPanel.tsx", import.meta.url)), "utf-8");
const chartPanelSource = readFileSync(fileURLToPath(new URL("../src/components/ChartPanel.tsx", import.meta.url)), "utf-8");

assert.match(newsPanelSource, /onAgentAsk\?: \(\) => void/);
assert.match(watchlistNewsPanelSource, /onAgentAsk\?: \(\) => void/);
assert.match(chartPanelSource, /onAgentAsk\?: \(\) => void/);
