import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf-8");

assert.match(appSource, /const appUiScale = 1\.4;/);
assert.match(appSource, /window\.innerWidth \/ appUiScale/);
assert.match(appSource, /window\.innerHeight \/ appUiScale/);
