import assert from "node:assert/strict";
import { fetchAnalysisAssets, invalidateAnalysisAssets } from "../src/chart/analysisAssetsApi";


const originalFetch = globalThis.fetch;
type ResolveResponse = (response: Response) => void;
const responseResolvers: ResolveResponse[] = [];
let fetchCalls = 0;
globalThis.fetch = (() => {
  fetchCalls += 1;
  return new Promise<Response>((resolve) => responseResolvers.push(resolve));
}) as typeof fetch;

try {
  const staleRequest = fetchAnalysisAssets("CACHE-RACE");
  invalidateAnalysisAssets("CACHE-RACE");
  const freshRequest = fetchAnalysisAssets("CACHE-RACE");
  responseResolvers[1](fakeResponse("fresh"));
  const fresh = await freshRequest;
  responseResolvers[0](fakeResponse("stale"));
  await staleRequest;

  const cached = await fetchAnalysisAssets("CACHE-RACE");
  assert.equal(fetchCalls, 2);
  assert.equal(cached.meta?.servedAt, "fresh");
  assert.equal(fresh.meta?.servedAt, "fresh");
} finally {
  invalidateAnalysisAssets("CACHE-RACE");
  globalThis.fetch = originalFetch;
}

function fakeResponse(servedAt: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      symbol: "CACHE-RACE",
      assets: { "1D": null, "1W": null, "1M": null },
      meta: { servedAt }
    })
  } as Response;
}
