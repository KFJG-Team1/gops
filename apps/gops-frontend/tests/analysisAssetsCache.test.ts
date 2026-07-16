import assert from "node:assert/strict";
import {
  AnalysisAssetsRequestError,
  analysisAssetsLoadErrorMessage,
  fetchAnalysisAssets,
  invalidateAnalysisAssets,
  subscribeAnalysisAssetsInvalidation
} from "../src/chart/analysisAssetsApi";


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

  invalidateAnalysisAssets("CACHE-RACE");
  const failedRequest = fetchAnalysisAssets("CACHE-RACE");
  responseResolvers[2](fakeErrorResponse(503, "Chart analysis asset storage is unavailable."));
  await assert.rejects(failedRequest, (reason) => (
    reason instanceof AnalysisAssetsRequestError
    && reason.status === 503
    && analysisAssetsLoadErrorMessage(reason) === "작도 자산 저장소에 접근할 수 없습니다."
  ));
  const retriedRequest = fetchAnalysisAssets("CACHE-RACE");
  responseResolvers[3](fakeResponse("retried"));
  assert.equal((await retriedRequest).meta?.servedAt, "retried", "failed responses are not cached");
  assert.equal(fetchCalls, 4);

  assert.equal(
    analysisAssetsLoadErrorMessage(new AnalysisAssetsRequestError(409, "simulation_data_unavailable")),
    "시뮬레이션 중에는 작도 자산을 불러올 수 없습니다."
  );

  const invalidations: Array<string | undefined> = [];
  const unsubscribe = subscribeAnalysisAssetsInvalidation((symbol) => invalidations.push(symbol));
  invalidateAnalysisAssets("NVDA");
  invalidateAnalysisAssets();
  unsubscribe();
  assert.deepEqual(invalidations, ["NVDA", undefined]);
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

function fakeErrorResponse(status: number, detail: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ detail })
  } as Response;
}
