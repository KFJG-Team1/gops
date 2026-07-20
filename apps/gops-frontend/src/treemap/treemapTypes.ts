export type TreeMapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeMapInputItem = {
  symbol: string;
  companyName: string;
  sector: string;
  sectorLabelKo?: string | null;
  industry: string;
  value: number;
  marketCap: number;
  indexWeight?: number;
  lastPrice?: number | null;
  volume?: number | null;
  sessionDollarVolume?: number | null;
  changePercent: number | null;
};

export type TreeMapTileKind = "sector" | "industry" | "symbol";

export type TreeMapTile = TreeMapRect & {
  id: string;
  kind: TreeMapTileKind;
  label: string;
  value: number;
  depth: number;
  parentId?: string;
  sector?: string;
  sectorLabelKo?: string;
  industry?: string;
  symbol?: string;
  companyName?: string;
  marketCap?: number;
  indexWeight?: number;
  lastPrice?: number | null;
  volume?: number | null;
  sessionDollarVolume?: number | null;
  changePercent?: number | null;
  band?: TreeMapRect;
};
