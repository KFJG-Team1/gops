import assert from "node:assert/strict";
import {
  czardasCompletedSnapshotIdentity,
  fetchCzardasAssets,
  fetchCzardasAssetsSnapshot,
  invalidateCzardasAssets,
  isCzardasAssetsGenerationCurrent,
  subscribeCzardasAssetsInvalidation
} from "../src/chart/czardasAssetsApi";

const correctionFixture = Array.from({ length: 241 }, (_, index) => ({
  timestamp: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100.5 + index,
  volume: 1000 + index,
  isClosed: index < 240
}));
const originalIdentity = czardasCompletedSnapshotIdentity(correctionFixture);
const correctedIdentity = czardasCompletedSnapshotIdentity(correctionFixture.map((candle, index) => (
  index === 80 ? { ...candle, close: candle.close + .01 } : candle
)));
const liveOnlyChangeIdentity = czardasCompletedSnapshotIdentity(correctionFixture.map((candle, index) => (
  index === 240 ? { ...candle, close: candle.close + 10 } : candle
)));
assert.notEqual(originalIdentity, correctedIdentity);
assert.equal(originalIdentity, liveOnlyChangeIdentity);

const originalFetch = globalThis.fetch;
type ResolveResponse = (response: Response) => void;
const responseResolvers: ResolveResponse[] = [];
const requestedUrls: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
  requestedUrls.push(String(input));
  return new Promise<Response>((resolve) => responseResolvers.push(resolve));
}) as typeof fetch;

try {
  const staleRequest = fetchCzardasAssets("cache-race");
  invalidateCzardasAssets("CACHE-RACE");
  const freshRequest = fetchCzardasAssets("CACHE-RACE");
  responseResolvers[1](fakeResponse("fresh"));
  const fresh = await freshRequest;
  responseResolvers[0](fakeResponse("stale"));
  await staleRequest;

  const cached = await fetchCzardasAssets("CACHE-RACE");
  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls.every((url) => url.startsWith("/api/charts/czardas-assets?symbol=CACHE-RACE")));
  assert.equal(cached.meta?.servedAt, "fresh");
  assert.equal(fresh.meta?.servedAt, "fresh");

  const observed = fetchCzardasAssetsSnapshot("CACHE-RACE", {
    interval: "1D",
    completedCandleIdentity: "2026-07-10T20:00:00.000Z"
  });
  responseResolvers[2](fakeResponse("observed-1"));
  const observedSnapshot = await observed;
  assert.equal(isCzardasAssetsGenerationCurrent("CACHE-RACE", observedSnapshot.generation), true);
  assert.equal(observedSnapshot.response.meta?.servedAt, "observed-1");
  const sameObservation = await fetchCzardasAssetsSnapshot("CACHE-RACE", {
    interval: "1D",
    completedCandleIdentity: "2026-07-10T20:00:00.000Z"
  });
  assert.equal(requestedUrls.length, 3);
  assert.equal(sameObservation.generation, observedSnapshot.generation);

  const superseded = fetchCzardasAssetsSnapshot("CACHE-RACE", {
    interval: "1D",
    completedCandleIdentity: "2026-07-11T20:00:00.000Z"
  });
  const newest = fetchCzardasAssetsSnapshot("CACHE-RACE", {
    interval: "1D",
    completedCandleIdentity: "2026-07-12T20:00:00.000Z"
  });
  responseResolvers[4](fakeResponse("observed-3"));
  const newestSnapshot = await newest;
  responseResolvers[3](fakeResponse("observed-2-late"));
  const supersededSnapshot = await superseded;
  assert.equal(isCzardasAssetsGenerationCurrent("CACHE-RACE", supersededSnapshot.generation), false);
  assert.equal(isCzardasAssetsGenerationCurrent("CACHE-RACE", newestSnapshot.generation), true);
  const newestCached = await fetchCzardasAssetsSnapshot("CACHE-RACE", {
    interval: "1D",
    completedCandleIdentity: "2026-07-12T20:00:00.000Z"
  });
  assert.equal(requestedUrls.length, 5);
  assert.equal(newestCached.response.meta?.servedAt, "observed-3");

  const invalidations: Array<string | undefined> = [];
  const unsubscribe = subscribeCzardasAssetsInvalidation((symbol) => invalidations.push(symbol));
  invalidateCzardasAssets("NVDA");
  invalidateCzardasAssets();
  unsubscribe();
  assert.deepEqual(invalidations, ["NVDA", undefined]);
} finally {
  invalidateCzardasAssets("CACHE-RACE");
  globalThis.fetch = originalFetch;
}

function fakeResponse(servedAt: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ symbol: "CACHE-RACE", assets: {}, meta: { servedAt } })
  } as Response;
}
