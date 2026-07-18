import assert from "node:assert/strict";
import type { AnalysisAssetsResponse } from "../src/chart/analysisAssetsApi";
import {
  chartAnalysisAssetRuntimeIdentity,
  chartAnalysisAssetSceneContainsLoadedSnapshot,
  clearChartAnalysisAssetRuntime,
  getChartAnalysisAssetRuntimeSnapshot,
  patchChartAnalysisAssetRuntime,
  subscribeChartAnalysisAssetRuntime,
  updateChartAnalysisAssetRuntime
} from "../src/chart/chartAnalysisAssetRuntimeStore";

const documentId = "chart-document-runtime-test";
const identity = chartAnalysisAssetRuntimeIdentity(documentId, " nvda ", "1D");
assert.equal(identity, `${documentId}|NVDA|1D`);
const loadedSnapshot = {
  requestKey: "NVDA:1D",
  generation: 2,
  latestClosedTimestamp: "2026-07-16T04:00:00.000Z"
};
assert.equal(chartAnalysisAssetSceneContainsLoadedSnapshot(loadedSnapshot, "AAPL:1D", []), false);
assert.equal(chartAnalysisAssetSceneContainsLoadedSnapshot(loadedSnapshot, "NVDA:1D", [{
  timestamp: loadedSnapshot.latestClosedTimestamp,
  isClosed: false
}]), false);
assert.equal(chartAnalysisAssetSceneContainsLoadedSnapshot(loadedSnapshot, "NVDA:1D", [{
  timestamp: loadedSnapshot.latestClosedTimestamp,
  isClosed: true
}]), true);
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).phase, "waiting-for-chart");

let notifications = 0;
const unsubscribe = subscribeChartAnalysisAssetRuntime(documentId, () => { notifications += 1; });
updateChartAnalysisAssetRuntime(documentId, {
  identity,
  phase: "loading",
  response: null,
  error: null,
  commentaryPhase: "loading",
  commentaryAsset: null,
  commentaryError: null
});
assert.equal(notifications, 1);
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).phase, "loading");

const response = { symbol: "NVDA", assets: {} } as AnalysisAssetsResponse;
updateChartAnalysisAssetRuntime(documentId, {
  identity,
  phase: "ready",
  response,
  error: null,
  commentaryPhase: "ready",
  commentaryAsset: {
    assetVersion: "geometry",
    algorithmVersion: "v6",
    asOf: "2026-07-16T04:00:00.000Z",
    generatedAt: "2026-07-17T00:00:00.000Z",
    inputDigest: "sha256:test",
    drawingIds: [],
    commentary: null
  },
  commentaryError: null
});
assert.equal(notifications, 2);
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).response, response);
patchChartAnalysisAssetRuntime(documentId, identity, { phase: "error", error: "geometry unavailable" });
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).commentaryPhase, "ready");
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).commentaryAsset?.inputDigest, "sha256:test");
assert.equal(notifications, 3);

clearChartAnalysisAssetRuntime(documentId, "another-identity");
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).phase, "error");
clearChartAnalysisAssetRuntime(documentId, identity);
assert.equal(notifications, 4);
assert.equal(getChartAnalysisAssetRuntimeSnapshot(documentId).phase, "waiting-for-chart");
unsubscribe();
