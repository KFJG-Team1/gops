import assert from "node:assert/strict";
import {
  AnalysisAssetsRequestError,
  analysisAssetsLoadErrorMessage,
  fetchAnalysisAssets,
  fetchChartCommentaryAsset,
  invalidateAnalysisAssets,
  subscribeAnalysisAssetsInvalidation
} from "../src/chart/analysisAssetsApi";


const originalFetch = globalThis.fetch;
type ResolveResponse = (response: Response) => void;
const responseResolvers: ResolveResponse[] = [];
const requestUrls: string[] = [];
let fetchCalls = 0;
globalThis.fetch = ((input) => {
  fetchCalls += 1;
  requestUrls.push(String(input));
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

  invalidateAnalysisAssets("CACHE-RACE");
  const minuteRequest = fetchAnalysisAssets("CACHE-RACE", "1m");
  responseResolvers[4](fakeResponse("minute"));
  await minuteRequest;
  const dailyRequest = fetchAnalysisAssets("CACHE-RACE", "1D");
  responseResolvers[5](fakeResponse("daily"));
  await dailyRequest;
  assert.equal(fetchCalls, 6, "each requested simulation interval has an independent cache entry");
  assert.match(requestUrls[4], /symbol=CACHE-RACE&interval=1m/);
  assert.match(requestUrls[5], /symbol=CACHE-RACE&interval=1D/);

  invalidateAnalysisAssets("CACHE-RACE");
  const commentaryRequest = fetchChartCommentaryAsset("CACHE-RACE", "1D");
  responseResolvers[6](fakeCommentaryResponse("commentary-first"));
  assert.equal((await commentaryRequest).meta?.servedAt, "commentary-first");
  await fetchChartCommentaryAsset("CACHE-RACE", "1D");
  assert.equal(fetchCalls, 7, "the lightweight commentary response has its own cache");
  invalidateAnalysisAssets("CACHE-RACE");
  const refreshedCommentary = fetchChartCommentaryAsset("CACHE-RACE", "1D");
  responseResolvers[7](fakeCommentaryResponse("commentary-refreshed"));
  assert.equal((await refreshedCommentary).meta?.servedAt, "commentary-refreshed");
  assert.match(requestUrls[6], /\/api\/charts\/analysis-assets\/commentary\?symbol=CACHE-RACE&interval=1D/);

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

function fakeCommentaryResponse(servedAt: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      symbol: "CACHE-RACE",
      interval: "1D",
      asset: null,
      meta: { servedAt }
    })
  } as Response;
}
