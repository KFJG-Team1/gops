import assert from "node:assert/strict";
import {
  cancelCzardasBuild,
  deleteCzardasAsset,
  fetchCzardasBuildStatus,
  invalidateCzardasAssets,
  submitCzardasBuild
} from "../src/chart/czardasAssetsApi";

const originalFetch = globalThis.fetch;
const calls: Array<{ path: string; init?: RequestInit }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  calls.push({ path, init });
  if (path === "/api/charts/czardas-assets/build" && init?.method === "POST") {
    return response({ jobId: "cza-contract-test", status: "queued", status_url: "/api/charts/czardas-assets/build/cza-contract-test" }, 202);
  }
  if (path === "/api/charts/czardas-assets/build/cza-contract-test/cancel") {
    return response(statusPayload("canceled"));
  }
  if (path === "/api/charts/czardas-assets/build/cza-contract-test") {
    return response(statusPayload("running"));
  }
  if (path === "/api/charts/czardas-assets?symbol=NVDA&interval=1D" && init?.method === "DELETE") {
    return response({ symbol: "NVDA", interval: "1D", deleted: 1 });
  }
  return response({ detail: "unexpected request" }, 500);
}) as typeof fetch;

try {
  const accepted = await submitCzardasBuild({ symbol: "nvda", interval: "1D" });
  assert.equal(accepted.jobId, "cza-contract-test");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { symbol: "NVDA", interval: "1D", force: false });

  const status = await fetchCzardasBuildStatus(accepted.status_url);
  assert.equal(status.requested.symbol, "NVDA");
  assert.equal(status.requested.interval, "1D");
  assert.equal((await cancelCzardasBuild(accepted.jobId)).status, "canceled");
  assert.equal((await deleteCzardasAsset("nvda", "1D")).deleted, 1);
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/charts/czardas-assets/build",
    "/api/charts/czardas-assets/build/cza-contract-test",
    "/api/charts/czardas-assets/build/cza-contract-test/cancel",
    "/api/charts/czardas-assets?symbol=NVDA&interval=1D"
  ]);
} finally {
  invalidateCzardasAssets("NVDA");
  globalThis.fetch = originalFetch;
}

function statusPayload(status: "running" | "canceled") {
  return {
    jobId: "cza-contract-test",
    status,
    requested: { symbol: "NVDA", interval: "1D", force: false },
    progress: { total: 1, done: status === "canceled" ? 1 : 0, failed: 0, skipped: status === "canceled" ? 1 : 0, warnings: 0, current: null },
    repair: { checkedSymbols: 0, attemptedSymbols: 0, repairedSymbols: 0, unavailableSymbols: 0, missingBarsBefore: 0, missingBarsAfter: 0, materializedRows: 0, reasonCodes: {} },
    recentItems: [],
    failedItems: [],
    cancelRequested: status === "canceled",
    createdEntities: 0,
    startedAt: null,
    finishedAt: null
  };
}

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}
