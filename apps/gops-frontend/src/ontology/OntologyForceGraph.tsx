import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { nearestTypeRole, TYPE_ROLE, type TypeRoleName } from "../theme/typography";
import type { OntologyGraphData } from "./ontologyTypes";

/**
 * 관계의 의미를 공간과 색으로 함께 보여주는 온톨로지 force graph.
 *
 * - 중심 기업: 차콜, 그래프 중심에 고정
 * - 동일 산업 연관 기업: 청록 계열
 * - 다른 산업 연관 기업: 하늘색 계열
 * - 산업군: 구성 기업을 감싸는 반투명 유기형 hull
 * - 관련도: 중심까지의 거리와 노드 크기에 동시에 반영
 */

const LOGICAL_WIDTH = 520;
const LOGICAL_HEIGHT = 520;
const FOCAL_X = 260;
const FOCAL_Y = 250;
// 바깥으로 갈수록 간격이 넓어져 관계 밀도와 분포를 함께 읽을 수 있다.
const ORBIT_RADII = [72, 104, 144, 196, 260] as const;

const INK = "#171a1f";
const PAPER = "#f7fafc";
const FOCAL_CHARCOAL = "#20242a";
const FOCAL_CHARCOAL_STROKE = "#dce2e8";
const RELATED_TEAL = "#116c75";
const RELATED_TEAL_SOFT = "#78d0d8";
const EXTERNAL_BLUE = "#269ed5";
const EXTERNAL_BLUE_PALETTES = [
  { soft: "#b7dcf2", strong: "#269ed5", stroke: "#1d7daf" },
  { soft: "#c3d9f0", strong: "#4a91c5", stroke: "#3979a8" },
  { soft: "#b9e1ed", strong: "#2e9ab6", stroke: "#237a91" },
  { soft: "#c9dced", strong: "#6489b6", stroke: "#4d6f98" }
] as const;
const MUTED_TEAL = "#5eb9c2";
const MUTED_BLUE = "#84c5e6";
const CHANGE_UP = "#1b6a29";
const CHANGE_DOWN = "#b31a0f";

function externalBluePaletteForIndustry(industryKey: string, externalKeys: readonly string[]) {
  const index = Math.max(0, externalKeys.indexOf(industryKey));
  return EXTERNAL_BLUE_PALETTES[index % EXTERNAL_BLUE_PALETTES.length];
}

const INDUSTRY_LABELS_KO: Readonly<Record<string, string>> = {
  semiconductors: "반도체",
  "semiconductor equipment": "반도체 장비",
  "systems software": "시스템 소프트웨어",
  "broadline retail": "종합 유통",
  "interactive media & services": "인터랙티브 미디어",
  "internet content & information": "인터넷 콘텐츠"
};

function industryDisplayLabel(label: string): string {
  return INDUSTRY_LABELS_KO[label.trim().toLowerCase()] ?? label;
}

export type OntologyQuote = {
  changePercent?: number;
  lastPrice?: number;
  marketCap?: number;
  volume?: number;
  sessionDollarVolume?: number;
  issueCount?: number;
  issueScore?: number;
  companyName?: string;
  sector?: string;
  industry?: string;
};

type QuoteLookup = (ticker: string) => OntologyQuote | undefined;

type OntologyModel = {
  focal: string;
  stocks: readonly string[];
  themes: ReadonlyMap<string, readonly string[]>;
  themesOf: ReadonlyMap<string, readonly string[]>;
  companies: ReadonlyMap<string, string>;
  crossLinks: readonly { a: string; b: string; label?: string; relationScore: number }[];
  relationScores: ReadonlyMap<string, number>;
};

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  kind: "stock" | "chip" | "company";
  label: string;
  r: number;
  role: "focal" | "related" | "external";
  relevance: number;
  tradeHeat: number;
  issueScore: number;
  issueCount: number;
  industry?: string;
  count?: number;
  __wasPinned?: boolean;
  __moved?: boolean;
};

type SimLink = { source: string | SimNode; target: string | SimNode; kind: "related" | "industry" | "branch" | "chip" | "control" | "cross" };

function tickerTypeRole(node: SimNode): TypeRoleName {
  if (node.kind === "stock") return nearestTypeRole(node.r * 0.45, "bodyMd");
  if (node.kind === "company") return "caption";
  return "caption";
}

type HullDatum = {
  key: string;
  tone: "primary" | "external";
  members: SimNode[];
};

type MembraneLink = {
  key: string;
  source: SimNode;
  target: SimNode;
};

type GraphController = {
  refreshQuotes: () => void;
  destroy: () => void;
};

function isSubsidiaryRelationshipNote(label: string): boolean {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("following subsidiar") ||
    normalized.includes("partially own") ||
    normalized.includes("collectively own") ||
    normalized.includes(" owns ") ||
    normalized === "legal entity name"
  );
}

function subsidiaryDetailLabel(label: string): string {
  return label;
}

function subsidiaryTitle(label: string): string {
  return `자회사 · ${label} (비상장/관계 자회사)`;
}

function buildModel(graph: OntologyGraphData, preferredSymbol: string | null): OntologyModel | null {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const stockSet = new Set<string>();
  graph.nodes.forEach((node) => {
    if (node.kind === "symbol") {
      stockSet.add(node.label);
    }
  });
  if (stockSet.size === 0) {
    return null;
  }

  const themeMembers = new Map<string, Set<string>>();
  const themeScores = new Map<string, Map<string, number>>();
  const companies = new Map<string, string>();
  const crossLinks: { a: string; b: string; label?: string; relationScore: number }[] = [];

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    if (edge.kind === "theme" || edge.kind === "shared-theme") {
      const symbolNode = source.kind === "symbol" ? source : target.kind === "symbol" ? target : null;
      const themeNode = source.kind === "theme" ? source : target.kind === "theme" ? target : null;
      if (symbolNode && themeNode) {
        if (!themeMembers.has(themeNode.label)) {
          themeMembers.set(themeNode.label, new Set());
        }
        themeMembers.get(themeNode.label)?.add(symbolNode.label);
        if (!themeScores.has(themeNode.label)) {
          themeScores.set(themeNode.label, new Map());
        }
        const scores = themeScores.get(themeNode.label) as Map<string, number>;
        scores.set(symbolNode.label, Math.max(scores.get(symbolNode.label) ?? 0, edge.relationScore ?? 0.58));
      }
    } else if (edge.kind === "control") {
      if (source.kind === "symbol" && target.kind === "company" && !isSubsidiaryRelationshipNote(target.label)) {
        companies.set(target.label, source.label);
      }
    } else if (edge.kind === "cross-control") {
      if (source.kind === "symbol" && target.kind === "symbol") {
        crossLinks.push({ a: source.label, b: target.label, label: edge.label, relationScore: edge.relationScore ?? 0.95 });
      }
    }
  }

  const themes = new Map<string, readonly string[]>();
  themeMembers.forEach((members, theme) => themes.set(theme, Array.from(members)));

  const themesOf = new Map<string, string[]>();
  themes.forEach((members, theme) => {
    members.forEach((member) => {
      if (!themesOf.has(member)) {
        themesOf.set(member, []);
      }
      themesOf.get(member)?.push(theme);
    });
  });

  const focal =
    (preferredSymbol && stockSet.has(preferredSymbol) && preferredSymbol) ||
    (graph.symbol && stockSet.has(graph.symbol) && graph.symbol) ||
    Array.from(stockSet)[0];

  // GraphDB 관계 점수만 중심 반경에 사용한다. 값이 없는 테마 소속은
  // '관계 확인됨'이라는 최소 점수로만 처리하고 시세 지표를 섞지 않는다.
  const relationScores = new Map<string, number>([[focal, 1]]);
  themes.forEach((members, theme) => {
    if (!members.includes(focal)) return;
    const scores = themeScores.get(theme);
    const focalScore = scores?.get(focal) ?? 0.72;
    members.forEach((ticker) => {
      if (ticker === focal) return;
      const score = Math.sqrt(focalScore * (scores?.get(ticker) ?? 0.58));
      relationScores.set(ticker, Math.max(relationScores.get(ticker) ?? 0, score));
    });
  });
  crossLinks.forEach((link) => {
    if (link.a === focal) relationScores.set(link.b, Math.max(relationScores.get(link.b) ?? 0, link.relationScore));
    if (link.b === focal) relationScores.set(link.a, Math.max(relationScores.get(link.a) ?? 0, link.relationScore));
  });

  return { focal, stocks: Array.from(stockSet), themes, themesOf, companies, crossLinks, relationScores };
}

// 문자열 -> [0,1) 결정적 해시. 같은 id는 항상 같은 초기 위치를 갖는다.
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function createGraphController(
  svgElement: SVGSVGElement,
  model: OntologyModel,
  getQuote: QuoteLookup,
  onSelect: (ticker: string | null) => void
): GraphController {
  const themesOf = (ticker: string): readonly string[] => model.themesOf.get(ticker) ?? [];
  const childrenOf = (ticker: string): string[] => {
    const result: string[] = [];
    model.companies.forEach((parent, company) => {
      if (parent === ticker) {
        result.push(company);
      }
    });
    return result;
  };
  const crossPartnersOf = (ticker: string): string[] =>
    model.crossLinks.filter((link) => link.a === ticker || link.b === ticker).map((link) => (link.a === ticker ? link.b : link.a));
  const isDirectFocalRelation = (ticker: string): boolean =>
    ticker !== model.focal && crossPartnersOf(model.focal).includes(ticker);

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const normalizedIndustry = (ticker: string): string => getQuote(ticker)?.industry?.trim().toLowerCase() ?? "";
  const normalizedSector = (ticker: string): string => getQuote(ticker)?.sector?.trim().toLowerCase() ?? "";
  const focalIndustry = (): string => normalizedIndustry(model.focal);
  const industryGroupKey = (ticker: string): string =>
    normalizedIndustry(ticker) || normalizedSector(ticker) || "unclassified";
  const focalIndustryKey = (): string => industryGroupKey(model.focal);
  const externalIndustryKeys = (): string[] => Array.from(
    new Set(model.stocks.map(industryGroupKey).filter((key) => key !== focalIndustryKey()))
  ).sort();
  const externalBluePaletteOf = (ticker: string) =>
    externalBluePaletteForIndustry(industryGroupKey(ticker), externalIndustryKeys());

  const relationProfile = (ticker: string): Pick<SimNode, "role" | "relevance" | "industry"> => {
    if (ticker === model.focal) {
      return { role: "focal", relevance: 1, industry: getQuote(ticker)?.industry };
    }

    const industry = normalizedIndustry(ticker);
    const sameIndustry = Boolean(industry && focalIndustry() && industry === focalIndustry());
    const relevance = model.relationScores.get(ticker) ?? 0.5;
    const metadataAvailable = Boolean(industry && focalIndustry());
    return {
      role: metadataAvailable && !sameIndustry ? "external" : "related",
      relevance: Math.max(0.25, relevance),
      industry: getQuote(ticker)?.industry
    };
  };

  function percentileRank(ticker: string, selector: (quote: OntologyQuote) => number | undefined): number {
    const current = getQuote(ticker);
    const currentValue = current ? selector(current) : undefined;
    if (!(typeof currentValue === "number" && Number.isFinite(currentValue) && currentValue > 0)) return 0;
    const values = model.stocks
      .map((symbol) => {
        const quote = getQuote(symbol);
        return quote ? selector(quote) : undefined;
      })
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (values.length <= 1) return 0.62;
    const lower = values.filter((value) => value < currentValue).length;
    const equal = values.filter((value) => value === currentValue).length;
    return clamp01((lower + Math.max(1, equal) * 0.5) / values.length);
  }

  const dollarVolumeOf = (quote: OntologyQuote): number | undefined => {
    if (typeof quote.sessionDollarVolume === "number" && quote.sessionDollarVolume > 0) return quote.sessionDollarVolume;
    if (typeof quote.volume === "number" && quote.volume > 0 && typeof quote.lastPrice === "number" && quote.lastPrice > 0) {
      return quote.volume * quote.lastPrice;
    }
    return undefined;
  };

  const marketCapRank = (ticker: string): number => percentileRank(ticker, (quote) => quote.marketCap);
  const tradingHeat = (ticker: string): number => {
    const absoluteRank = percentileRank(ticker, dollarVolumeOf);
    const turnoverRank = percentileRank(ticker, (quote) => {
      const dollarVolume = dollarVolumeOf(quote);
      return dollarVolume && quote.marketCap ? dollarVolume / quote.marketCap : undefined;
    });
    if (absoluteRank === 0 && turnoverRank === 0) return 0;
    return clamp01(absoluteRank * 0.58 + turnoverRank * 0.42);
  };

  const issueSignal = (ticker: string): { count: number; score: number } => ({
    count: Math.max(0, Math.round(getQuote(ticker)?.issueCount ?? 0)),
    score: clamp01(getQuote(ticker)?.issueScore ?? 0)
  });

  const stockRadius = (ticker: string): number => {
    const profile = relationProfile(ticker);
    if (profile.role === "focal") {
      return 58;
    }
    // 원의 면적은 이 GraphDB 관련 기업군 안에서의 시가총액 순위로만 결정한다.
    return Math.min(50, 14 + Math.pow(marketCapRank(ticker), 0.72) * 34);
  };

  const membranePadding = (node: SimNode): number => {
    // 외곽 막의 두께는 거래대금 순위와 시총 대비 회전율만 반영한다.
    return 5 + node.tradeHeat * 15 + (node.role === "focal" ? 2 : 0);
  };

  const fillOfStock = (ticker: string): string => {
    const profile = relationProfile(ticker);
    if (profile.role === "focal") {
      return FOCAL_CHARCOAL;
    }
    const issue = issueSignal(ticker);
    const issueImpact = clamp01(issue.score * 0.76 + Math.min(issue.count, 5) / 5 * 0.24);
    // 색 진하기는 오늘 이슈 수와 중요도만 사용한다.
    // 이슈가 없어도 산업군의 청록/하늘색 계열은 읽혀야 하므로 최소 채도를 남긴다.
    const intensity = 0.4 + Math.pow(issueImpact, 0.72) * 0.6;
    if (profile.role === "external") {
      const palette = externalBluePaletteOf(ticker);
      return d3.interpolateRgb(palette.soft, palette.strong)(intensity);
    }
    return d3.interpolateRgb(RELATED_TEAL_SOFT, RELATED_TEAL)(intensity);
  };

  const textFillOfStock = (ticker: string): string => {
    const profile = relationProfile(ticker);
    const lightness = d3.lab(fillOfStock(ticker)).l;
    return profile.role === "focal" || lightness < 58 ? PAPER : INK;
  };

  const fillOfAuxiliaryNode = (node: SimNode): string =>
    node.role === "external" ? MUTED_BLUE : MUTED_TEAL;

  const membraneColor = (node: SimNode): string => {
    if (node.role === "focal") return "#303740";
    const base = d3.color(fillOfStock(node.label));
    return base?.brighter(0.34).formatHex() ?? fillOfStock(node.label);
  };

  const strokeOfNode = (node: SimNode): string => {
    if (node.role === "focal") return FOCAL_CHARCOAL_STROKE;
    if (node.role !== "external") return RELATED_TEAL;
    return node.kind === "stock" ? externalBluePaletteOf(node.label).stroke : EXTERNAL_BLUE;
  };

  const pctText = (ticker: string): string => {
    const change = getQuote(ticker)?.changePercent;
    if (typeof change !== "number") {
      return "";
    }
    const arrow = change >= 0.3 ? "▲" : change <= -0.3 ? "▼" : change >= 0 ? "+" : "-";
    return arrow + Math.abs(change).toFixed(1) + "%";
  };

  const targetDistance = (node: SimNode): number => {
    if (node.role === "focal") {
      return 0;
    }
    return relationshipOrbitRadius(node) + (node.kind === "company" ? 18 : node.kind === "chip" ? 28 : 0);
  };

  function industryAngle(key: string): number {
    const externalKeys = externalIndustryKeys();
    const index = externalKeys.indexOf(key);
    const count = Math.max(1, externalKeys.length);
    const progress = index < 0 || count === 1 ? 0.5 : index / (count - 1);
    return -Math.PI * 0.88 + progress * Math.PI * 1.76;
  }

  function nodeIndustryKey(node: SimNode): string {
    if (node.kind === "stock") return industryGroupKey(node.label);
    return node.industry?.trim().toLowerCase() || focalIndustryKey();
  }

  function relationshipOrbitRadius(node: SimNode): number {
    const directBoost = node.kind === "stock" && isDirectFocalRelation(node.label) ? 0.18 : 0;
    const affinity = clamp01(node.relevance + directBoost);
    const position = Math.pow(1 - affinity, 1.16) * (ORBIT_RADII.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(ORBIT_RADII.length - 1, lower + 1);
    const lowerRadius = ORBIT_RADII[lower] ?? ORBIT_RADII[0];
    const upperRadius = ORBIT_RADII[upper] ?? lowerRadius;
    return lowerRadius + (upperRadius - lowerRadius) * (position - lower);
  }

  function targetPoint(node: SimNode): { x: number; y: number } {
    if (node.role === "focal") {
      return { x: FOCAL_X, y: FOCAL_Y };
    }

    const groupKey = nodeIndustryKey(node);
    const localAngle = hash01(`${node.id}:angle`) * Math.PI * 2 - Math.PI / 2;
    const localOffset = (hash01(`${node.id}:industry-offset`) - 0.5) * (node.kind === "stock" ? 1.72 : 0.7);
    const angle = groupKey === focalIndustryKey() ? localAngle : industryAngle(groupKey) + localOffset;
    const distance = relationshipOrbitRadius(node) + (node.kind === "company" ? 18 : node.kind === "chip" ? 28 : 0);
    return {
      x: FOCAL_X + Math.cos(angle) * distance,
      y: FOCAL_Y + Math.sin(angle) * distance * 0.84
    };
  }

  // ---------- 상태 ----------
  const visibleStocks = new Set<string>([model.focal]);
  const expandedThemes = new Set<string>();
  const chips = new Map<string, string>();
  const visibleCompanies = new Set<string>();
  let selectedId: string | null = null;
  const nodeCache = new Map<string, SimNode>();

  // ---------- SVG ----------
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  const root = svg.append("g");
  let userAdjustedView = false;
  let fitTimer: number | undefined;
  const zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 2.5])
    .on("zoom", (event) => {
      if (event.sourceEvent) {
        userAdjustedView = true;
      }
      root.attr("transform", event.transform.toString());
    });
  svg.call(zoomBehavior);
  const orbitLayer = root.append("g").attr("class", "ofg-orbits");
  const relationMembraneLayer = root.append("g").attr("class", "ofg-cross-membrane");
  const hullLayer = root.append("g");
  const nodeLayer = root.append("g");

  orbitLayer
    .selectAll("circle")
    .data(ORBIT_RADII)
    .join("circle")
    .attr("class", "ofg-orbit")
    .attr("cx", FOCAL_X)
    .attr("cy", FOCAL_Y)
    .attr("r", (radius) => radius);

  // ---------- 시뮬레이션 ----------
  const simulation = d3
    .forceSimulation<SimNode>()
    .velocityDecay(0.58)
    .alphaDecay(0.048)
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.role === "focal" ? -115 : -44 - d.r * 0.65))
    .force(
      "collide",
      d3.forceCollide<SimNode>()
        .radius((d) => {
          if (d.kind === "company") return d.r + 22;
          if (d.kind === "stock") return d.r + membranePadding(d) + 3;
          return d.r + 4;
        })
        .strength(0.95)
    )
    .force("position", positionForce)
    .force("cluster", clusterForce)
    .on("tick", ticked);

  function positionForce(alpha: number): void {
    simulation.nodes().forEach((node) => {
      if (node.role === "focal") return;
      const target = targetPoint(node);
      const direct = node.kind === "stock" && isDirectFocalRelation(node.label);
      const strength = node.kind === "stock"
        ? (direct ? 0.07 : 0.11) + (1 - node.relevance) * 0.04
        : 0.14;
      node.vx = (node.vx ?? 0) + (target.x - (node.x ?? target.x)) * strength * alpha;
      node.vy = (node.vy ?? 0) + (target.y - (node.y ?? target.y)) * strength * alpha;
    });
  }

  // 내용물 경계에 맞춰 자동 줌 — 노드가 적을 땐 확대, 펼쳐지면 축소.
  // 사용자가 직접 줌/팬 하면 이후 자동 조정은 하지 않는다.
  let lastFitSignature = "";

  function fitView(immediate: boolean): void {
    const nodes = simulation.nodes();
    if (!nodes.length) {
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const extent = node.r + (node.kind === "stock" ? membranePadding(node) : 4);
      minX = Math.min(minX, (node.x ?? 0) - extent);
      maxX = Math.max(maxX, (node.x ?? 0) + extent);
      minY = Math.min(minY, (node.y ?? 0) - extent);
      maxY = Math.max(maxY, (node.y ?? 0) + extent);
    }
    const outerOrbit = ORBIT_RADII.at(-1) ?? 0;
    minX = Math.min(minX, FOCAL_X - outerOrbit);
    maxX = Math.max(maxX, FOCAL_X + outerOrbit);
    minY = Math.min(minY, FOCAL_Y - outerOrbit);
    maxY = Math.max(maxY, FOCAL_Y + outerOrbit);
    const pad = 8;
    const width = Math.max(1, maxX - minX + pad * 2);
    const height = Math.max(1, maxY - minY + pad * 2);
    const scale = Math.max(0.5, Math.min(1.12, Math.min(LOGICAL_WIDTH / width, LOGICAL_HEIGHT / height)));
    const tx = LOGICAL_WIDTH / 2 - (scale * (minX + maxX)) / 2;
    const ty = LOGICAL_HEIGHT / 2 - (scale * (minY + maxY)) / 2;
    svg.transition().duration(immediate ? 0 : 420).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function scheduleFit(immediate: boolean): void {
    if (fitTimer !== undefined) {
      window.clearTimeout(fitTimer);
    }
    fitTimer = window.setTimeout(() => {
      if (!userAdjustedView) {
        fitView(immediate);
      }
    }, immediate ? 80 : 650);
  }

  function clusterForce(alpha: number): void {
    const nodes = simulation.nodes();
    const groups = d3.group(nodes.filter((node) => node.role !== "focal"), nodeIndustryKey);
    groups.forEach((members) => {
      if (members.length < 2) return;
      const centroidX = d3.mean(members, (member) => member.x ?? FOCAL_X) ?? FOCAL_X;
      const centroidY = d3.mean(members, (member) => member.y ?? FOCAL_Y) ?? FOCAL_Y;
      const strength = Math.min(0.06, 0.024 + members.length * 0.009);
      members.forEach((member) => {
        member.vx = (member.vx ?? 0) + (centroidX - (member.x ?? centroidX)) * strength * alpha;
        member.vy = (member.vy ?? 0) + (centroidY - (member.y ?? centroidY)) * strength * alpha;
      });
    });
  }

  function getNode(id: string, init: Partial<SimNode>): SimNode {
    if (!nodeCache.has(id)) {
      nodeCache.set(id, {
        id,
        kind: "stock",
        label: "",
        r: 10,
        role: "related",
        relevance: 0.4,
        tradeHeat: 0,
        issueScore: 0,
        issueCount: 0,
        x: LOGICAL_WIDTH / 2 + Math.cos(hash01(id) * Math.PI * 2) * 24,
        y: LOGICAL_HEIGHT / 2 + Math.sin(hash01(id) * Math.PI * 2) * 24,
        ...init
      } as SimNode);
    }
    return Object.assign(nodeCache.get(id) as SimNode, init);
  }

  function revealInitialTheme(theme: string, themeIndex: number, themeCount: number): void {
    expandedThemes.add(theme);
    const members = Array.from(model.themes.get(theme) ?? []).sort(
      (a, b) => ((getQuote(b)?.marketCap ?? 0) - (getQuote(a)?.marketCap ?? 0)) || a.localeCompare(b)
    );
    const otherMembers = members.filter((ticker) => ticker !== model.focal);
    const focalNode = getNode("s:" + model.focal, {});
    if (themeCount === 1 && otherMembers.length > 0 && !focalNode.__moved && !focalNode.__wasPinned) {
      focalNode.x = FOCAL_X;
      focalNode.y = FOCAL_Y;
    }

    const clusterAngle = themeCount <= 1 ? -Math.PI / 2 : (themeIndex / themeCount) * Math.PI * 2 - Math.PI / 2;
    const originX = FOCAL_X + (themeCount <= 1 ? -12 : Math.cos(clusterAngle) * 72);
    const originY = FOCAL_Y + (themeCount <= 1 ? -48 : Math.sin(clusterAngle) * 62);
    otherMembers.forEach((ticker, index) => {
      visibleStocks.add(ticker);
      const node = getNode("s:" + ticker, {});
      if (!node.__moved && !node.__wasPinned) {
        const angle = (index / Math.max(1, otherMembers.length)) * Math.PI * 2 - Math.PI / 2;
        const radius = otherMembers.length <= 2 ? 42 : 62;
        node.x = originX + Math.cos(angle) * radius;
        node.y = originY + Math.sin(angle) * Math.max(42, radius * 0.76);
      }
    });
  }

  const initialThemes = themesOf(model.focal);
  initialThemes.forEach((theme, index) => revealInitialTheme(theme, index, initialThemes.length));
  crossPartnersOf(model.focal).forEach((ticker) => visibleStocks.add(ticker));
  childrenOf(model.focal).slice(0, 8).forEach((company) => visibleCompanies.add(company));

  function buildGraph(): { nodes: SimNode[]; links: SimLink[] } {
    const nodes: SimNode[] = [];
    const links: SimLink[] = [];
    const stockPairs = new Set<string>();
    const addStockLink = (source: string, target: string, kind: SimLink["kind"]): void => {
      if (source === target) return;
      const pair = [source, target].sort().join("|");
      if (stockPairs.has(pair)) return;
      stockPairs.add(pair);
      links.push({ source, target, kind });
    };
    for (const ticker of visibleStocks) {
      const profile = relationProfile(ticker);
      const issues = issueSignal(ticker);
      const node = getNode("s:" + ticker, {
        kind: "stock",
        label: ticker,
        r: stockRadius(ticker),
        role: profile.role,
        relevance: profile.relevance,
        tradeHeat: tradingHeat(ticker),
        issueScore: issues.score,
        issueCount: issues.count,
        industry: profile.industry
      });
      if (ticker === model.focal) {
        node.fx = FOCAL_X;
        node.fy = FOCAL_Y;
      } else if (!node.__moved && !node.__wasPinned) {
        node.fx = null;
        node.fy = null;
      }
      nodes.push(node);
    }

    // 직접 연관 기업은 산업군과 무관하게 중심 기업에 우선 연결한다.
    // 산업군 링크는 군집을 보조할 뿐, 서로 관련된 기업을 멀리 밀어내지 않는다.
    crossPartnersOf(model.focal)
      .filter((ticker) => visibleStocks.has(ticker))
      .forEach((ticker) => addStockLink(`s:${model.focal}`, `s:${ticker}`, "cross"));

    const visibleIndustryGroups = d3.group(
      Array.from(visibleStocks),
      industryGroupKey
    );
    visibleIndustryGroups.forEach((tickers, groupKey) => {
      if (!tickers.length) return;
      const sorted = tickers.slice().sort((a, b) => {
        if (a === model.focal) return -1;
        if (b === model.focal) return 1;
        return relationProfile(b).relevance - relationProfile(a).relevance;
      });
      const anchor = sorted[0];
      if (groupKey !== focalIndustryKey()) {
        addStockLink(`s:${model.focal}`, `s:${anchor}`, "branch");
      }
      sorted.slice(1).forEach((ticker) => {
        addStockLink(`s:${anchor}`, `s:${ticker}`, "industry");
      });
    });
    const chipsByAnchor = new Map<string, string[]>();
    for (const [theme, anchor] of chips) {
      if (!visibleStocks.has(anchor)) {
        continue;
      }
      if (!chipsByAnchor.has(anchor)) {
        chipsByAnchor.set(anchor, []);
      }
      chipsByAnchor.get(anchor)?.push(theme);
    }
    chipsByAnchor.forEach((chipThemes, anchor) => {
      chipThemes.sort();
      const anchorNode = nodeCache.get("s:" + anchor);
      chipThemes.forEach((theme, index) => {
        const isNew = !nodeCache.has("t:" + theme);
        const anchorProfile = relationProfile(anchor);
        const node = getNode("t:" + theme, {
          kind: "chip",
          label: theme,
          count: (model.themes.get(theme) ?? []).length,
          r: 22,
          role: anchorProfile.role === "external" ? "external" : "related",
          relevance: Math.max(0.34, anchorProfile.relevance * 0.78),
          tradeHeat: 0,
          issueScore: 0,
          issueCount: 0,
          industry: anchorProfile.industry
        });
        if (isNew && anchorNode) {
          // 칩은 항상 기준 종목의 "위쪽" 부채꼴에 이름순으로 생성
          const angle = -Math.PI / 2 + (index - (chipThemes.length - 1) / 2) * 0.55;
          node.x = (anchorNode.x ?? 0) + Math.cos(angle) * 115;
          node.y = (anchorNode.y ?? 0) + Math.sin(angle) * 115;
        }
        nodes.push(node);
        links.push({ source: "s:" + anchor, target: "t:" + theme, kind: "chip" });
      });
    });
    const companiesByParent = new Map<string, string[]>();
    for (const company of visibleCompanies) {
      const parent = model.companies.get(company);
      if (parent && visibleStocks.has(parent)) {
        if (!companiesByParent.has(parent)) {
          companiesByParent.set(parent, []);
        }
        companiesByParent.get(parent)?.push(company);
      }
    }
    companiesByParent.forEach((companyNames, parent) => {
      companyNames.sort();
      const parentNode = nodeCache.get("s:" + parent);
      companyNames.forEach((company, index) => {
        const isNew = !nodeCache.has("c:" + company);
        const parentProfile = relationProfile(parent);
        const node = getNode("c:" + company, {
          kind: "company",
          label: company,
          r: 10 + parentProfile.relevance * 5,
          role: parentProfile.role === "external" ? "external" : "related",
          relevance: Math.max(0.3, parentProfile.relevance * 0.72),
          tradeHeat: 0,
          issueScore: 0,
          issueCount: 0,
          industry: parentProfile.industry
        });
        if (isNew && parentNode) {
          // 자회사는 항상 모회사의 "아래쪽" 부채꼴에 이름순으로 생성
          const angle = Math.PI / 2 + (index - (companyNames.length - 1) / 2) * 0.5;
          node.x = (parentNode.x ?? 0) + Math.cos(angle) * 95;
          node.y = (parentNode.y ?? 0) + Math.sin(angle) * 95;
        }
        nodes.push(node);
        links.push({ source: "s:" + parent, target: "c:" + company, kind: "control" });
      });
    });
    for (const cross of model.crossLinks) {
      if (visibleStocks.has(cross.a) && visibleStocks.has(cross.b)) {
        addStockLink("s:" + cross.a, "s:" + cross.b, "cross");
      }
    }
    return { nodes, links };
  }

  // ---------- 인터랙션 ----------
  function expandTheme(theme: string, origin: SimNode): void {
    expandedThemes.add(theme);
    chips.delete(theme);
    const newcomers = (model.themes.get(theme) ?? []).filter((ticker) => !visibleStocks.has(ticker));
    // 시총 큰 순으로 12시부터 시계방향 링 배치 — 생성 방향이 항상 일정
    newcomers.sort((a, b) => ((getQuote(b)?.marketCap ?? 0) - (getQuote(a)?.marketCap ?? 0)) || a.localeCompare(b));
    newcomers.forEach((ticker, index) => {
      visibleStocks.add(ticker);
      const node = getNode("s:" + ticker, {});
      const angle = (index / Math.max(1, newcomers.length)) * Math.PI * 2 - Math.PI / 2;
      node.x = (origin.x ?? LOGICAL_WIDTH / 2) + Math.cos(angle) * 75;
      node.y = (origin.y ?? LOGICAL_HEIGHT / 2) + Math.sin(angle) * 75;
    });
    update(0.45);
  }

  function expandStock(id: string): void {
    const ticker = id.slice(2);
    let revealed = false;
    for (const theme of themesOf(ticker)) {
      if (!expandedThemes.has(theme) && !chips.has(theme)) {
        chips.set(theme, ticker);
        revealed = true;
      }
    }
    childrenOf(ticker).forEach((company) => {
      if (!visibleCompanies.has(company)) {
        visibleCompanies.add(company);
        revealed = true;
      }
    });
    crossPartnersOf(ticker).forEach((partner) => {
      if (!visibleStocks.has(partner)) {
        visibleStocks.add(partner);
        revealed = true;
      }
    });
    selectedId = id;
    onSelect(ticker);
    update(revealed ? 0.35 : 0.03);
  }

  // ---------- 렌더링 ----------
  function update(alpha: number): void {
    const { nodes, links } = buildGraph();
    simulation.nodes(nodes);
    simulation.force(
      "link",
      d3
        .forceLink<SimNode, d3.SimulationLinkDatum<SimNode>>(links as d3.SimulationLinkDatum<SimNode>[])
        .id((d) => (d as SimNode).id)
        .distance((link) => {
          const relation = link as unknown as SimLink;
          if (relation.kind === "chip") return 92;
          if (relation.kind === "control") return 86;
          const source = typeof relation.source === "string" ? nodeCache.get(relation.source) : relation.source;
          const target = typeof relation.target === "string" ? nodeCache.get(relation.target) : relation.target;
          if (relation.kind === "cross" && source && target) {
            return source.r + target.r + 10;
          }
          const outer = source?.role === "focal" ? target : target?.role === "focal" ? source : target;
          if (relation.kind === "industry" && source && target) {
            return source.r + membranePadding(source) + target.r + membranePadding(target) + 6;
          }
          return outer ? targetDistance(outer) : 92;
        })
        .strength((link) => {
          const relation = link as unknown as SimLink;
          const target = typeof relation.target === "string" ? nodeCache.get(relation.target) : relation.target;
          if (relation.kind === "cross") return 0.72;
          if (relation.kind === "industry") return 0.68;
          if (relation.kind === "branch") return 0.52;
          return 0.32 + (target?.relevance ?? 0.4) * 0.32;
        })
    );
    simulation.alpha(alpha).restart();
    // 노드 구성이 실제로 바뀐 경우에만 auto-fit — 선택/시세 갱신으로는 배율이 출렁이지 않게
    const signature = nodes.map((node) => node.id).sort().join(",");
    if (signature !== lastFitSignature) {
      const firstFit = lastFitSignature === "";
      lastFitSignature = signature;
      scheduleFit(firstFit);
    }

    const nodeGroups = nodeLayer
      .selectAll<SVGGElement, SimNode>("g.ofg-node")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const group = enter.append("g").attr("class", (d) => "ofg-node ofg-node-" + d.kind);
        const scaleGroup = group.append("g").attr("class", "ofg-node-scale");
        scaleGroup.append("circle").attr("class", "ofg-halo");
        scaleGroup.append("circle").attr("class", "ofg-body");
        scaleGroup.append("circle").attr("class", "ofg-selected-ring").attr("display", "none");
        scaleGroup.append("text").attr("class", "ofg-ticker");
        scaleGroup.append("text").attr("class", "ofg-pct");
        scaleGroup.append("text").attr("class", "ofg-count");
        scaleGroup.append("title");
        group.on("click", (event: MouseEvent, d) => {
          event.stopPropagation();
          if (d.kind === "chip") {
            expandTheme(d.label, d);
          } else if (d.kind === "stock") {
            expandStock(d.id);
          }
        });
        group.call(
          d3
            .drag<SVGGElement, SimNode>()
            .clickDistance(6)
            .on("start", (event, d) => {
              if (!event.active) {
                simulation.alphaTarget(0.2).restart();
              }
              d.__wasPinned = d.fx != null;
              d.__moved = false;
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", (event, d) => {
              d.__moved = true;
              d.fx = event.x;
              d.fy = event.y;
            })
            .on("end", (event, d) => {
              if (!event.active) {
                simulation.alphaTarget(0);
              }
              if (!d.__moved && !d.__wasPinned) {
                d.fx = null;
                d.fy = null;
              }
            })
        );
        return group;
      })
      .attr("class", (d) => `ofg-node ofg-node-${d.kind} ofg-node-role-${d.role}`)
      .attr("data-relevance", (d) => d.relevance.toFixed(2));

    nodeGroups
      .select<SVGCircleElement>("circle.ofg-halo")
      .attr("r", (d) => d.r + (d.role === "focal" ? 12 : 5))
      .attr("display", (d) => d.role === "focal" ? null : "none");

    nodeGroups
      .select<SVGCircleElement>("circle.ofg-body")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => d.kind === "stock" ? fillOfStock(d.label) : fillOfAuxiliaryNode(d))
      .attr("stroke", (d) => strokeOfNode(d))
      .attr("stroke-width", (d) => d.role === "focal" ? 2.4 : 1.4);
    nodeGroups
      .select<SVGCircleElement>("circle.ofg-selected-ring")
      .attr("r", (d) => d.r + 5)
      .attr("display", (d) => (d.id === selectedId ? null : "none"));
    nodeGroups
      .select<SVGTextElement>("text.ofg-ticker")
      .attr("y", (d) => (d.kind === "chip" ? -2 : d.kind === "company" ? 0 : 0))
      .attr("dy", (d) => (d.kind === "stock" ? "-0.15em" : d.kind === "company" ? "0.35em" : 0))
      .style("font-size", (d) => {
        const baseSize = TYPE_ROLE[tickerTypeRole(d)].size;
        if (d.kind !== "stock") return `${baseSize}px`;
        const fittedSize = (d.r * 2.2) / Math.max(3, d.label.length);
        return `${Math.max(7, Math.min(baseSize, fittedSize))}px`;
      })
      .style("font-weight", (d) => `${TYPE_ROLE[tickerTypeRole(d)].weight}`)
      .style("line-height", (d) => `${TYPE_ROLE[tickerTypeRole(d)].lineHeight}`)
      .style("letter-spacing", (d) => `${TYPE_ROLE[tickerTypeRole(d)].letterSpacing}px`)
      .style("text-transform", (d) => TYPE_ROLE[tickerTypeRole(d)].textTransform)
      .style("fill", (d) => d.kind === "stock" ? textFillOfStock(d.label) : INK)
      .text((d) => {
        if (d.kind === "company") return "계열";
        if (d.kind === "chip") return d.label.length > 5 ? d.label.slice(0, 4) + "…" : d.label;
        return d.label.length > 6 ? d.label.slice(0, 5) + "…" : d.label;
      });
    nodeGroups
      .select<SVGTextElement>("text.ofg-pct")
      .attr("y", 3)
      .attr("dy", "0.85em")
      .attr("fill", (d) =>
        d.kind === "stock" ? (textFillOfStock(d.label) === PAPER ? "rgba(255,249,243,.86)" : "rgba(26,26,14,.7)") : "rgba(26,26,14,.6)"
      )
      .text((d) => (d.kind === "stock" ? pctText(d.label) : ""));
    nodeGroups
      .select<SVGTextElement>("text.ofg-count")
      .attr("y", (d) => (d.kind === "company" ? d.r + 14 : 12))
      .attr("text-anchor", "middle")
      .style("font-size", (d) => `${TYPE_ROLE[d.kind === "company" ? "caption" : "caption"].size}px`)
      .style("font-weight", (d) => `${TYPE_ROLE[d.kind === "company" ? "caption" : "caption"].weight}`)
      .style("line-height", (d) => `${TYPE_ROLE[d.kind === "company" ? "caption" : "caption"].lineHeight}`)
      .style("letter-spacing", (d) => `${TYPE_ROLE[d.kind === "company" ? "caption" : "caption"].letterSpacing}px`)
      .style("text-transform", (d) => TYPE_ROLE[d.kind === "company" ? "caption" : "caption"].textTransform)
      .style("fill", INK)
      .each(function renderCountOrCompanyName(d) {
        const text = d3.select(this);
        text.selectAll("tspan").remove();
        if (d.kind === "chip") {
          text.text(`${d.count ?? 0}종목`);
          return;
        }
        if (d.kind === "company") {
          text.text("");
          return;
        }
        text.text("");
      });
    nodeGroups.select<SVGTitleElement>("title").text((d) => {
      if (d.kind === "stock") {
        const quote = getQuote(d.label);
        const price = typeof quote?.lastPrice === "number" ? ` · ${quote.lastPrice.toFixed(2)}` : "";
        const industry = quote?.industry ? ` · ${quote.industry}` : "";
        const issues = d.issueCount > 0 ? ` · 오늘 이슈 ${d.issueCount}건` : "";
        return `${d.label}${price}${industry} · 관련도 ${Math.round(d.relevance * 100)}% · 거래 열기 ${Math.round(d.tradeHeat * 100)}%${issues} · 테마: ${themesOf(d.label).join(", ") || "없음"}`;
      }
      if (d.kind === "chip") {
        return `테마 "${d.label}" 펼치기 (${d.count ?? 0}종목)`;
      }
      return subsidiaryTitle(d.label);
    });
  }

  function industryHulls(nodes: SimNode[]): HullDatum[] {
    const groups = new Map<string, { tone: "primary" | "external"; members: SimNode[] }>();
    nodes.filter((node) => node.kind === "stock").forEach((node) => {
      const industryKey = nodeIndustryKey(node);
      const tone = industryKey === focalIndustryKey() ? "primary" : "external";
      const key = `${tone}:${industryKey}`;
      if (!groups.has(key)) groups.set(key, { tone, members: [] });
      groups.get(key)?.members.push(node);
    });
    const result: HullDatum[] = [];
    groups.forEach((group, key) => {
      if (!group.members.length) return;
      result.push({
        key,
        tone: group.tone,
        members: group.members
      });
    });
    return result;
  }

  function membraneLinks(members: SimNode[]): MembraneLink[] {
    if (members.length < 2) return [];
    const connected = new Set<SimNode>([members[0]]);
    const remaining = new Set(members.slice(1));
    const links: MembraneLink[] = [];
    while (remaining.size) {
      let bestSource: SimNode | null = null;
      let bestTarget: SimNode | null = null;
      let bestDistance = Infinity;
      for (const source of connected) {
        for (const target of remaining) {
          const distance = Math.hypot((source.x ?? 0) - (target.x ?? 0), (source.y ?? 0) - (target.y ?? 0));
          if (distance < bestDistance) {
            bestSource = source;
            bestTarget = target;
            bestDistance = distance;
          }
        }
      }
      if (!bestSource || !bestTarget) break;
      const sourceOuterRadius = bestSource.r + membranePadding(bestSource);
      const targetOuterRadius = bestTarget.r + membranePadding(bestTarget);
      const tradeHeat = Math.max(bestSource.tradeHeat, bestTarget.tradeHeat);
      const maximumBridge = (sourceOuterRadius + targetOuterRadius) * (1.34 + tradeHeat * 0.2);
      if (bestDistance <= maximumBridge) {
        links.push({ key: `${bestSource.id}|${bestTarget.id}`, source: bestSource, target: bestTarget });
      }
      connected.add(bestTarget);
      remaining.delete(bestTarget);
    }
    return links;
  }

  function crossIndustryMembraneLinks(nodes: SimNode[]): MembraneLink[] {
    const stocksByTicker = new Map(nodes.filter((node) => node.kind === "stock").map((node) => [node.label, node]));
    const seen = new Set<string>();
    const links: MembraneLink[] = [];
    model.crossLinks.forEach((cross) => {
      const source = stocksByTicker.get(cross.a);
      const target = stocksByTicker.get(cross.b);
      if (!source || !target || nodeIndustryKey(source) === nodeIndustryKey(target)) return;
      const key = [source.id, target.id].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ key: `cross:${key}`, source, target });
    });
    return links;
  }

  type CircleGeometry = { x: number; y: number; r: number };

  function pointOnCircle(
    circle: { x: number; y: number; r?: number },
    angle: number,
    distance = circle.r ?? 0
  ): { x: number; y: number } {
    return {
      x: circle.x + Math.cos(angle) * distance,
      y: circle.y + Math.sin(angle) * distance
    };
  }

  function metaballBridgePath(
    first: CircleGeometry,
    second: CircleGeometry,
    curvature = 0.52,
    handleRate = 2.25
  ): string | null {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance <= Math.abs(first.r - second.r) + 0.1) return null;
    if (distance > (first.r + second.r) * 1.58) return null;

    const direction = Math.atan2(dy, dx);
    let overlapAngleFirst = 0;
    let overlapAngleSecond = 0;
    if (distance < first.r + second.r) {
      overlapAngleFirst = Math.acos(
        Math.max(-1, Math.min(1, (first.r * first.r + distance * distance - second.r * second.r) / (2 * first.r * distance)))
      );
      overlapAngleSecond = Math.acos(
        Math.max(-1, Math.min(1, (second.r * second.r + distance * distance - first.r * first.r) / (2 * second.r * distance)))
      );
    }

    const spread = Math.acos(Math.max(-1, Math.min(1, (first.r - second.r) / distance)));
    const angleFirstTop = direction + overlapAngleFirst + (spread - overlapAngleFirst) * curvature;
    const angleFirstBottom = direction - overlapAngleFirst - (spread - overlapAngleFirst) * curvature;
    const angleSecondTop = direction + Math.PI - overlapAngleSecond - (Math.PI - overlapAngleSecond - spread) * curvature;
    const angleSecondBottom = direction - Math.PI + overlapAngleSecond + (Math.PI - overlapAngleSecond - spread) * curvature;

    const firstTop = pointOnCircle(first, angleFirstTop);
    const firstBottom = pointOnCircle(first, angleFirstBottom);
    const secondTop = pointOnCircle(second, angleSecondTop);
    const secondBottom = pointOnCircle(second, angleSecondBottom);
    const bridgeLength = Math.hypot(firstTop.x - secondTop.x, firstTop.y - secondTop.y);
    const handleFactor = Math.min(curvature * handleRate, bridgeLength / Math.max(1, first.r + second.r));
    const firstHandle = first.r * handleFactor;
    const secondHandle = second.r * handleFactor;
    const firstTopControl = pointOnCircle(firstTop, angleFirstTop - Math.PI / 2, firstHandle);
    const secondTopControl = pointOnCircle(secondTop, angleSecondTop + Math.PI / 2, secondHandle);
    const secondBottomControl = pointOnCircle(secondBottom, angleSecondBottom - Math.PI / 2, secondHandle);
    const firstBottomControl = pointOnCircle(firstBottom, angleFirstBottom + Math.PI / 2, firstHandle);

    return [
      `M${firstTop.x},${firstTop.y}`,
      `C${firstTopControl.x},${firstTopControl.y} ${secondTopControl.x},${secondTopControl.y} ${secondTop.x},${secondTop.y}`,
      `A${second.r},${second.r} 0 0 1 ${secondBottom.x},${secondBottom.y}`,
      `C${secondBottomControl.x},${secondBottomControl.y} ${firstBottomControl.x},${firstBottomControl.y} ${firstBottom.x},${firstBottom.y}`,
      `A${first.r},${first.r} 0 0 1 ${firstTop.x},${firstTop.y}`,
      "Z"
    ].join(" ");
  }

  function outerCircle(node: SimNode): CircleGeometry {
    return {
      x: node.x ?? 0,
      y: node.y ?? 0,
      r: node.r + membranePadding(node)
    };
  }

  function ticked(): void {
    nodeLayer.selectAll<SVGGElement, SimNode>("g.ofg-node").attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

    const hulls = industryHulls(simulation.nodes());
    relationMembraneLayer
      .selectAll<SVGPathElement, MembraneLink>("path.ofg-cross-metaball-bridge")
      .data(crossIndustryMembraneLinks(simulation.nodes()), (link) => link.key)
      .join("path")
      .attr("class", "ofg-cross-metaball-bridge")
      .attr("fill", (link) => d3.interpolateRgb(membraneColor(link.source), membraneColor(link.target))(0.5))
      .attr("d", (link) => metaballBridgePath(outerCircle(link.source), outerCircle(link.target), 0.44, 1.9) ?? "");

    const hullGroups = hullLayer
      .selectAll<SVGGElement, HullDatum>("g.ofg-hull")
      .data(hulls, (d) => d.key)
      .join((enter) => {
        const group = enter.append("g").attr("class", "ofg-hull");
        group.append("g").attr("class", "ofg-membrane");
        return group;
      })
      .attr("class", (d) => `ofg-hull is-${d.tone}`);

    hullGroups
      .select<SVGGElement>("g.ofg-membrane")
      .each(function renderMembrane(datum) {
        const membrane = d3.select(this);
        membrane
          .selectAll<SVGPathElement, MembraneLink>("path.ofg-metaball-bridge")
          .data(membraneLinks(datum.members), (link) => link.key)
          .join("path")
          .attr("class", "ofg-metaball-bridge")
          .attr("fill", (link) => d3.interpolateRgb(membraneColor(link.source), membraneColor(link.target))(0.5))
          .attr("d", (link) => metaballBridgePath(outerCircle(link.source), outerCircle(link.target)) ?? "");
        membrane
          .selectAll<SVGCircleElement, SimNode>("circle.ofg-membrane-circle")
          .data(datum.members, (node) => node.id)
          .join("circle")
          .attr("class", (node) => `ofg-membrane-circle${node.tradeHeat >= 0.72 ? " is-hot" : ""}`)
          .attr("fill", membraneColor)
          .attr("cx", (node) => node.x ?? 0)
          .attr("cy", (node) => node.y ?? 0)
          .attr("r", (node) => node.r + membranePadding(node));
      });
  }

  svg.on("click", () => {
    selectedId = null;
    onSelect(null);
    update(0.05);
  });

  update(1);

  return {
    refreshQuotes(): void {
      update(0.2);
      scheduleFit(false);
    },
    destroy(): void {
      if (fitTimer !== undefined) {
        window.clearTimeout(fitTimer);
      }
      simulation.stop();
      svg.on("click", null);
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
    }
  };
}

export function OntologyForceGraph({
  graph,
  getQuote,
  onSelectSymbol
}: {
  graph: OntologyGraphData;
  getQuote: QuoteLookup;
  onSelectSymbol?: (symbol: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const getQuoteRef = useRef(getQuote);
  getQuoteRef.current = getQuote;

  const model = useMemo(() => buildModel(graph, graph.symbol || null), [graph]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!model || !svgElement) {
      return;
    }
    setSelectedTicker(null);
    const controller = createGraphController(svgElement, model, (ticker) => getQuoteRef.current(ticker), setSelectedTicker);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    controllerRef.current?.refreshQuotes();
  }, [getQuote]);

  if (!model) {
    return <div className="ontology-panel ontology-panel-empty">관계 분석 결과가 아직 없습니다</div>;
  }

  const selectedQuote = selectedTicker ? getQuote(selectedTicker) : undefined;
  const focalQuote = getQuote(model.focal);
  const focalIndustry = (focalQuote?.industry || focalQuote?.sector || "산업 미분류").trim();
  const industryGroups = new Map<string, { label: string; count: number; primary: boolean }>();
  model.stocks.forEach((ticker) => {
    const quote = getQuote(ticker);
    const rawLabel = (quote?.industry || quote?.sector || "산업 미분류").trim();
    const key = rawLabel.toLowerCase();
    const existing = industryGroups.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    industryGroups.set(key, {
      label: industryDisplayLabel(rawLabel),
      count: 1,
      primary: key === focalIndustry.toLowerCase()
    });
  });
  const industryLegend = Array.from(industryGroups.entries())
    .map(([key, group]) => ({ key, ...group }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || b.count - a.count || a.label.localeCompare(b.label));
  const legendExternalKeys = industryLegend.filter((industry) => !industry.primary).map((industry) => industry.key).sort();
  const selectedThemes = selectedTicker ? model.themesOf.get(selectedTicker) ?? [] : [];
  const selectedRoleLabel = selectedTicker === model.focal
    ? "중심 기업"
    : selectedQuote?.industry && focalQuote?.industry && selectedQuote.industry !== focalQuote.industry
      ? "타 산업 연관 기업"
      : "동일 산업 연관 기업";
  const selectedChildren: string[] = [];
  if (selectedTicker) {
    model.companies.forEach((parent, company) => {
      if (parent === selectedTicker) {
        selectedChildren.push(company);
      }
    });
  }

  return (
    <div className="ofg-root" aria-label={`${model.focal} 기업 관계 그래프`}>
      <svg ref={svgRef} viewBox={`0 0 ${LOGICAL_WIDTH} ${LOGICAL_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" />
      {selectedTicker && (
        <div className="ofg-detail">
          <strong>{selectedTicker}</strong>
          <span className="ofg-detail-role">{selectedRoleLabel}</span>
          {selectedQuote?.companyName && <span className="ofg-detail-name">{selectedQuote.companyName}</span>}
          {typeof selectedQuote?.changePercent === "number" && (
            <span
              className="ofg-detail-chg"
              style={{ color: selectedQuote.changePercent >= 0.3 ? CHANGE_UP : selectedQuote.changePercent <= -0.3 ? CHANGE_DOWN : undefined }}
            >
              {(selectedQuote.changePercent >= 0 ? "+" : "") + selectedQuote.changePercent.toFixed(2)}%
            </span>
          )}
          {typeof selectedQuote?.lastPrice === "number" && <span className="ofg-detail-price">{selectedQuote.lastPrice.toFixed(2)}</span>}
          {selectedQuote?.industry && <span className="ofg-detail-industry">{selectedQuote.industry}</span>}
          {typeof selectedQuote?.issueCount === "number" && selectedQuote.issueCount > 0 && (
            <span className="ofg-detail-industry">오늘 이슈 {selectedQuote.issueCount}건</span>
          )}
          {selectedThemes.length > 0 && <div className="ofg-detail-tags">{selectedThemes.map((theme) => <em key={theme}>{theme}</em>)}</div>}
          {selectedChildren.length > 0 && (
            <div className="ofg-detail-tags">
              {selectedChildren.map((company) => <em key={company}>{subsidiaryDetailLabel(company)}</em>)}
            </div>
          )}
          <button
            type="button"
            disabled={!onSelectSymbol}
            title={onSelectSymbol ? `${selectedTicker} 차트 열기` : "차트 연결 대기 중"}
            onClick={() => onSelectSymbol?.(selectedTicker)}
          >
            차트 열기
          </button>
        </div>
      )}
      <div className="ofg-industry-legend" aria-label="현재 온톨로지 산업군">
        {industryLegend.map((industry) => (
          <span key={industry.key} title={`${industry.label} · ${industry.count}개 기업`}>
            <i
              aria-hidden="true"
              style={{
                backgroundColor: industry.primary
                  ? RELATED_TEAL
                  : externalBluePaletteForIndustry(industry.key, legendExternalKeys).strong
              }}
            />
            <em>{industry.label}</em>
            <small>{industry.count}</small>
          </span>
        ))}
      </div>
      <div className="ofg-legend-hint" tabIndex={0} aria-label="범례">
        ⓘ
        <div className="ofg-legend-pop" role="tooltip">
          <div><b>차콜</b> 중심 기업</div>
          <div><b>청록</b> 동일 산업 연관 기업</div>
          <div><b>하늘색</b> 다른 산업의 연관 기업</div>
          <div>하늘색 색조 = 산업군, 진하기 = 관계 관련도</div>
          <div>동심원 = 중심 기업에서의 관계 반경</div>
          <div>연결된 외곽 막 = 동일 산업군</div>
          <div>종목 클릭 = 관계 확장</div>
        </div>
      </div>
    </div>
  );
}
