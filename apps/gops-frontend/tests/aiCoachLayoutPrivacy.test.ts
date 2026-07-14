import assert from "node:assert/strict";

import {
  restoreTiledPanelStateSnapshot,
  serializeTiledPanelState,
  type TiledPanelState
} from "../src/layout/panelLayout";

const viewport = { width: 1440, height: 900 };
const state: TiledPanelState = {
  nextInstance: 2,
  contents: {
    "content-aiCoach-1": {
      id: "content-aiCoach-1",
      kind: "aiCoach",
      title: "AI 투자 코치",
      instanceIndex: 1,
      props: {
        coachReport: {
          analysisId: "sensitive-analysis-id",
          snapshotRef: "s3://private-bucket/private-user/snapshot.json",
          page1: { trades: [{ symbol: "NVDA", quantity: 12 }] }
        },
        displayMode: "compact"
      }
    }
  },
  slots: [{
    id: "slot-aiCoach-1",
    contentId: "content-aiCoach-1",
    gridRect: { col: 1, row: 1, colSpan: 6, rowSpan: 6 },
    rect: { left: 0, top: 0, width: 900, height: 700 },
    minWidth: 1,
    minHeight: 1
  }]
};

const serialized = serializeTiledPanelState(state);
assert.deepEqual(serialized.contents["content-aiCoach-1"].props, { displayMode: "compact" });
assert.doesNotMatch(JSON.stringify(serialized), /sensitive-analysis-id|private-user|NVDA/);

const legacySnapshot = structuredClone(serialized);
legacySnapshot.contents["content-aiCoach-1"].props = {
  displayMode: "compact",
  coachReport: { analysisId: "legacy-sensitive-analysis-id" }
};
const restored = restoreTiledPanelStateSnapshot(legacySnapshot, viewport);
assert.ok(restored);
assert.deepEqual(restored.contents["content-aiCoach-1"].props, { displayMode: "compact" });
assert.doesNotMatch(JSON.stringify(restored), /legacy-sensitive-analysis-id/);

console.log("AI coach layout privacy tests passed");
