export const canonicalSectorOptions = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities"
] as const;

const unclassifiedSector = "Unclassified";

const sectorLabelsKo: Record<string, string> = {
  "Communication Services": "커뮤니케이션 서비스",
  "Consumer Discretionary": "경기소비재",
  "Consumer Staples": "필수소비재",
  Energy: "에너지",
  Financials: "금융",
  "Health Care": "헬스케어",
  Industrials: "산업재",
  "Information Technology": "정보기술",
  Materials: "소재",
  "Real Estate": "부동산",
  Utilities: "유틸리티",
  [unclassifiedSector]: "미분류"
};

const sectorAliases: Record<string, string> = {
  "basic materials": "Materials",
  "communication services": "Communication Services",
  communications: "Communication Services",
  "consumer cyclical": "Consumer Discretionary",
  "consumer discretionary": "Consumer Discretionary",
  "consumer defensive": "Consumer Staples",
  "consumer staples": "Consumer Staples",
  energy: "Energy",
  "energy and utilities": "Energy",
  "financial services": "Financials",
  "financial technology": "Financials",
  financials: "Financials",
  "health care": "Health Care",
  healthcare: "Health Care",
  industrials: "Industrials",
  "information technology": "Information Technology",
  technology: "Information Technology",
  materials: "Materials",
  "real estate": "Real Estate",
  utilities: "Utilities",
  unclassified: unclassifiedSector
};

export function normalizeSector(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) {
    return unclassifiedSector;
  }
  return sectorAliases[sectorKey(text)] ?? (canonicalSectorOptions.includes(text as typeof canonicalSectorOptions[number]) ? text : unclassifiedSector);
}

export function sectorLabelKo(value: string | null | undefined): string {
  const sector = normalizeSector(value);
  return sectorLabelsKo[sector] ?? sector;
}

export function normalizeSectorList(values: readonly string[]): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    const sector = normalizeSector(value);
    if (sector !== unclassifiedSector && !result.includes(sector)) {
      result.push(sector);
    }
  });
  return result;
}

function sectorKey(value: string): string {
  return value.replace(/&/g, "and").replace(/\s+/g, " ").trim().toLowerCase();
}
