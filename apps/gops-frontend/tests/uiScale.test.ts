import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf-8");
const bottomCommandBarSource = readFileSync(
  fileURLToPath(new URL("../src/components/BottomCommandBar.tsx", import.meta.url)),
  "utf-8"
);
const panelWorkspaceSource = readFileSync(
  fileURLToPath(new URL("../src/components/PanelWorkspace.tsx", import.meta.url)),
  "utf-8"
);

assert.match(appSource, /const appUiScale = 0\.8;/);
assert.match(appSource, /width \/ appUiScale/);
assert.match(appSource, /height \/ appUiScale/);
assert.match(appSource, /onExitLayoutEdit=\{toggleLayoutEditMode\}/);
assert.doesNotMatch(appSource, /onToggleLayoutEditMode=/);
assert.match(bottomCommandBarSource, /\{!layoutEditMode && <nav className="workspace-bottom-nav"/);
assert.match(panelWorkspaceSource, /\{layoutEditMode && \([\s\S]*\{onExitLayoutEdit && \(/);
