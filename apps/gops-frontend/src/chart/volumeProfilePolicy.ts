import type { ChartInterval, VolumeProfileResponseDto } from "./types";

export const volumeProfilePartialRetryDelaysMs = [500, 1_500] as const;

export type ExactVolumeProfileRequest = {
  symbol: string;
  interval: ChartInterval;
  from: string;
  to: string;
  targetBins: number;
  priceMin: number;
  priceMax: number;
  candleCount: number;
};

export function volumeProfileResponseMatchesRequest(
  response: VolumeProfileResponseDto,
  request: ExactVolumeProfileRequest
): boolean {
  return response.derived?.state !== "failed" &&
    response.dataStatus !== "partial" &&
    response.symbol.trim().toUpperCase() === request.symbol.trim().toUpperCase() &&
    (response.interval ?? response.sourceInterval) === request.interval &&
    response.from === request.from &&
    response.to === request.to &&
    response.targetBins === request.targetBins &&
    response.bucketCount === request.targetBins &&
    response.bins.length === request.targetBins &&
    response.requestedCandleCount === request.candleCount &&
    response.sourceCandleCount === request.candleCount &&
    nearlyEqual(response.priceRange.min, request.priceMin) &&
    nearlyEqual(response.priceRange.max, request.priceMax);
}

function nearlyEqual(value: number | null | undefined, expected: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  const tolerance = Math.max(1e-8, Math.max(Math.abs(value), Math.abs(expected)) * 1e-8);
  return Math.abs(value - expected) <= tolerance;
}
