import {
  type CzardasFieldDto,
  type CzardasMeaningChannel,
  type CzardasMeaningFactorKey,
  type CzardasMeaningUsage,
  type CzardasReasonCodeDto
} from "./types";

export type CzardasMeaningFactorView = {
  key: CzardasMeaningFactorKey;
  label: string;
  raw: number | null;
  normalized: number | null;
};

export type CzardasCandleMeaningView = {
  index: number;
  evaluationAsOf: string;
  candleKey: string;
  timestamp: string;
  summaries: { shared: number; hline: number; trend: number; compositePercentile: number };
  roles: { support: number; resistance: number; lower: number; upper: number };
  factors: CzardasMeaningFactorView[];
  factorGroups: ReadonlyArray<{
    channel: CzardasMeaningChannel;
    label: string;
    keys: readonly CzardasMeaningFactorKey[];
  }>;
  availability: string[];
  phases: string[];
  reasons: CzardasReasonCodeDto[];
};

const maskLabels: Record<string, string> = {
  atr: "ATR 준비됨",
  volumeBaseline: "거래량 기준선 준비됨",
  rightContext: "우측 문맥 확인됨",
  geometryInput: "geometry 입력",
  fit: "fit",
  integrity: "integrity 평가",
  response: "response 평가",
  visualizationOnly: "시각화 전용",
  confirmationPending: "확인 대기"
};

export const czardasChannelLabels: Record<CzardasMeaningChannel, string> = {
  shared: "공통",
  hline: "H-Line",
  trend: "Trend"
};

export const czardasUsageLabels: Record<CzardasMeaningUsage, string> = {
  geometry_input: "geometry 입력",
  fit: "fit",
  integrity: "integrity",
  response: "response",
  visualization_only: "시각화 전용"
};

export function candleMeaningAtTimestamp(
  field: CzardasFieldDto | null | undefined,
  timestamp: string | null | undefined
): CzardasCandleMeaningView | null {
  if (!field || !timestamp) return null;
  const meanings = field.candleMeanings;
  const index = meanings.timestamps.indexOf(timestamp);
  if (index < 0) return null;
  const reasonsByCode = new Map(meanings.reasonCodebook.map((reason) => [reason.code, reason]));
  return {
    index,
    evaluationAsOf: meanings.evaluationAsOf,
    candleKey: meanings.candleKeys[index],
    timestamp,
    summaries: {
      shared: meanings.summaries.shared[index] / meanings.scoreScale,
      hline: meanings.summaries.hline[index] / meanings.scoreScale,
      trend: meanings.summaries.trend[index] / meanings.scoreScale,
      compositePercentile: meanings.summaries.compositePercentile[index] / meanings.scoreScale
    },
    roles: {
      support: meanings.roles.support[index] / meanings.scoreScale,
      resistance: meanings.roles.resistance[index] / meanings.scoreScale,
      lower: meanings.roles.lower[index] / meanings.scoreScale,
      upper: meanings.roles.upper[index] / meanings.scoreScale
    },
    factors: meanings.factorCodebook.map((factor) => ({
      key: factor.key,
      label: factor.label,
      raw: transformedValue(
        decodedFactorValue(meanings.factors[factor.key], index),
        factor.scale,
        factor.transform
      ),
      normalized: scaledValue(decodedFactorValue(meanings.normalizedFactors[factor.key], index), meanings.normalizedFactorScale)
    })),
    factorGroups: (["shared", "hline", "trend"] as const).map((channel) => ({
      channel,
      label: channel === "shared" ? "Shared" : channel === "hline" ? "H-Line" : "Trend",
      keys: meanings.factorCodebook.filter((factor) => factor.channel === channel).map((factor) => factor.key)
    })).filter((group) => group.keys.length > 0),
    availability: decodeMask(meanings.availabilityMasks[index], meanings.availabilityCodebook),
    phases: decodeMask(meanings.phaseMasks[index], meanings.phaseCodebook),
    reasons: decodedReasonCodes(meanings.reasonMasks, index)
      .map((code) => reasonsByCode.get(code))
      .filter((reason): reason is CzardasReasonCodeDto => Boolean(reason))
  };
}

function scaledValue(value: number | null, scale: number): number | null {
  return value === null ? null : value / scale;
}

function transformedValue(value: number | null, scale: number, transform: "linear" | "log1p"): number | null {
  const scaled = scaledValue(value, scale);
  return scaled === null ? null : transform === "log1p" ? Math.expm1(scaled) : scaled;
}

const factorBinaryCache = new Map<string, string>();
const factorBinaryCacheLimit = 256;

export function decodedFactorValue(encoded: string, index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= 240) return null;
  let binary = factorBinaryCache.get(encoded);
  if (!binary) {
    try {
      binary = atob(encoded);
    } catch {
      return null;
    }
    if (binary.length !== 480) return null;
    if (factorBinaryCache.size >= factorBinaryCacheLimit) {
      const oldest = factorBinaryCache.keys().next().value;
      if (typeof oldest === "string") factorBinaryCache.delete(oldest);
    }
    factorBinaryCache.set(encoded, binary);
  }
  const offset = index * 2;
  const unsigned = (binary.charCodeAt(offset) << 8) | binary.charCodeAt(offset + 1);
  const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
  return signed === -32768 ? null : signed;
}

let reasonMaskCacheKey = "";
let reasonMaskCacheValue = "";

export function decodedReasonCodes(encoded: string, index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= 240) return [];
  if (reasonMaskCacheKey !== encoded) {
    try {
      const binary = atob(encoded);
      if (binary.length !== 960) return [];
      reasonMaskCacheKey = encoded;
      reasonMaskCacheValue = binary;
    } catch {
      return [];
    }
  }
  const offset = index * 4;
  const mask = (
    reasonMaskCacheValue.charCodeAt(offset) * 0x1000000
    + reasonMaskCacheValue.charCodeAt(offset + 1) * 0x10000
    + reasonMaskCacheValue.charCodeAt(offset + 2) * 0x100
    + reasonMaskCacheValue.charCodeAt(offset + 3)
  ) >>> 0;
  const codes: number[] = [];
  for (let code = 0; code < 32; code += 1) {
    if (((mask >>> code) & 1) === 1) codes.push(code);
  }
  return codes;
}

function decodeMask(mask: number, codebook: Record<string, number>): string[] {
  return Object.entries(codebook)
    .filter(([, bit]) => (mask & bit) === bit)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([key]) => maskLabels[key] ?? key);
}
