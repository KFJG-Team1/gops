import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { OntologyGraphData } from "./ontologyTypes";

/**
 * 온톨로지 관계 force 그래프 (라이트 페이퍼 테마).
 *
 * - 테마 = 잉크 점선 컨테이너 원. 비멤버는 물리적으로 밖으로 밀려나 "원 안 = 진짜 소속"이 보장됨
 * - 등락 = 색 농도: 상승은 초록, 하락은 빨강, 폭이 클수록 진해짐 (시세 없으면 잉크 회색)
 * - 원 크기 = 시가총액 (히트맵 API), 없으면 관계 수 기반
 * - 점진 확장: 시작은 분석 종목 하나, 클릭할수록 테마 칩/자회사/교차지배가 펼쳐짐
 * - 외곽 점선 드래그 = 테마 그룹째 이동, 노드 드래그 = 해당 위치 고정
 */

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 420;

// 프론트 공통 팔레트 (styles.css :root 토큰과 동일 계열)
const INK = "#1a1a0e";
const PAPER = "#efefe8";
const UP_COLOR = "#1b6a29";
const DOWN_COLOR = "#b31a0f";
const NEUTRAL_FILL = "#d9d9d0";
const SUBSIDIARY_FILL = "#f1dfc8";
const SUBSIDIARY_STROKE = "#9b6b3d";
const SUBSIDIARY_TEXT = "#64411f";

export type OntologyQuote = {
  changePercent?: number;
  lastPrice?: number;
  marketCap?: number;
  companyName?: string;
};

type QuoteLookup = (ticker: string) => OntologyQuote | undefined;

type OntologyModel = {
  focal: string;
  stocks: readonly string[];
  themes: ReadonlyMap<string, readonly string[]>;
  themesOf: ReadonlyMap<string, readonly string[]>;
  companies: ReadonlyMap<string, string>;
  crossLinks: readonly { a: string; b: string; label?: string }[];
};

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  kind: "stock" | "chip" | "company";
  label: string;
  r: number;
  count?: number;
  __wasPinned?: boolean;
  __moved?: boolean;
  __sized?: boolean;
};

type SimLink = { source: string | SimNode; target: string | SimNode; kind: "chip" | "control" | "cross" };

type HullDatum = { theme: string; cx: number; cy: number; r: number };

type GraphController = {
  refreshQuotes: () => void;
  destroy: () => void;
};

function wrapSubsidiaryName(label: string, maxChars: number): string[] {
  const words = label.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maxChars) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.length ? lines : [label];
}

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

function subsidiaryDisplayLines(label: string): string[] {
  return wrapSubsidiaryName(label, 23);
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
  const companies = new Map<string, string>();
  const crossLinks: { a: string; b: string; label?: string }[] = [];

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
      }
    } else if (edge.kind === "control") {
      if (source.kind === "symbol" && target.kind === "company" && !isSubsidiaryRelationshipNote(target.label)) {
        companies.set(target.label, source.label);
      }
    } else if (edge.kind === "cross-control") {
      if (source.kind === "symbol" && target.kind === "symbol") {
        crossLinks.push({ a: source.label, b: target.label, label: edge.label });
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

  return { focal, stocks: Array.from(stockSet), themes, themesOf, companies, crossLinks };
}

function changeIntensity(change: number): number {
  return Math.min(1, Math.abs(change) / 3) * 0.75 + 0.25;
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

  const stockRadius = (ticker: string): number => {
    const cap = getQuote(ticker)?.marketCap;
    if (typeof cap === "number" && cap > 0) {
      return 13 + Math.min(20, Math.sqrt(cap) / 60000);
    }
    const degree = themesOf(ticker).length + childrenOf(ticker).length + crossPartnersOf(ticker).length;
    return (ticker === model.focal ? 19 : 15) + Math.min(9, degree * 2);
  };

  const fillOfStock = (ticker: string): string => {
    const change = getQuote(ticker)?.changePercent;
    if (typeof change !== "number" || Math.abs(change) < 0.3) {
      return NEUTRAL_FILL;
    }
    return d3.interpolateRgb(NEUTRAL_FILL, change > 0 ? UP_COLOR : DOWN_COLOR)(changeIntensity(change));
  };

  const isDeepFill = (ticker: string): boolean => {
    const change = getQuote(ticker)?.changePercent;
    return typeof change === "number" && Math.abs(change) >= 0.3 && changeIntensity(change) > 0.55;
  };

  const pctText = (ticker: string): string => {
    const change = getQuote(ticker)?.changePercent;
    if (typeof change !== "number") {
      return "";
    }
    const arrow = change >= 0.3 ? "▲" : change <= -0.3 ? "▼" : change >= 0 ? "+" : "-";
    return arrow + Math.abs(change).toFixed(1) + "%";
  };

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
  const hullLayer = root.append("g");
  const linkLayer = root.append("g");
  const nodeLayer = root.append("g");

  // ---------- 시뮬레이션 ----------
  const simulation = d3
    .forceSimulation<SimNode>()
    .velocityDecay(0.6)
    .alphaDecay(0.055)
    .force("charge", d3.forceManyBody<SimNode>().strength(-110))
    .force("collide", d3.forceCollide<SimNode>().radius((d) => (d.kind === "company" ? 82 : d.r + 14)).strength(0.9))
    .force("x", d3.forceX<SimNode>(LOGICAL_WIDTH / 2).strength(0.03))
    .force("y", d3.forceY<SimNode>(LOGICAL_HEIGHT / 2).strength(0.03))
    .force("cluster", clusterForce)
    .on("tick", ticked);

  function hullGeometry(theme: string, byId: Map<string, SimNode>): { cx: number; cy: number; r: number; members: SimNode[] } | null {
    const members = (model.themes.get(theme) ?? [])
      .filter((ticker) => byId.has("s:" + ticker))
      .map((ticker) => byId.get("s:" + ticker) as SimNode);
    if (!members.length) {
      return null;
    }
    const cx = d3.mean(members, (m) => m.x ?? 0) ?? 0;
    const cy = d3.mean(members, (m) => m.y ?? 0) ?? 0;
    const r = Math.max(36, (d3.max(members, (m) => Math.hypot((m.x ?? 0) - cx, (m.y ?? 0) - cy) + m.r) ?? 0) + 14);
    return { cx, cy, r, members };
  }

  // 내용물 경계에 맞춰 자동 줌 — 노드가 적을 땐 확대, 펼쳐지면 축소.
  // 사용자가 직접 줌/팬 하면 이후 자동 조정은 하지 않는다.
  let lastFitSignature = "";

  function fitView(immediate: boolean): void {
    const nodes = simulation.nodes();
    if (!nodes.length) {
      return;
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, (node.x ?? 0) - node.r);
      maxX = Math.max(maxX, (node.x ?? 0) + node.r);
      minY = Math.min(minY, (node.y ?? 0) - node.r);
      maxY = Math.max(maxY, (node.y ?? 0) + node.r);
    }
    for (const theme of expandedThemes) {
      const geom = hullGeometry(theme, byId);
      if (geom) {
        minX = Math.min(minX, geom.cx - geom.r);
        maxX = Math.max(maxX, geom.cx + geom.r);
        minY = Math.min(minY, geom.cy - geom.r - 20);
        maxY = Math.max(maxY, geom.cy + geom.r);
      }
    }
    const pad = 26;
    const width = Math.max(1, maxX - minX + pad * 2);
    const height = Math.max(1, maxY - minY + pad * 2);
    const scale = Math.max(0.4, Math.min(2.2, Math.min(LOGICAL_WIDTH / width, LOGICAL_HEIGHT / height)));
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

  function themeMemberNodes(theme: string): SimNode[] {
    const byId = new Map(simulation.nodes().map((node) => [node.id, node]));
    return (model.themes.get(theme) ?? [])
      .filter((ticker) => byId.has("s:" + ticker))
      .map((ticker) => byId.get("s:" + ticker) as SimNode);
  }

  function clusterForce(alpha: number): void {
    const nodes = simulation.nodes();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const theme of expandedThemes) {
      const geom = hullGeometry(theme, byId);
      if (!geom) {
        continue;
      }
      const memberSet = new Set(model.themes.get(theme) ?? []);
      if (geom.members.length >= 2) {
        for (const member of geom.members) {
          member.vx = (member.vx ?? 0) + (geom.cx - (member.x ?? 0)) * 0.14 * alpha;
          member.vy = (member.vy ?? 0) + (geom.cy - (member.y ?? 0)) * 0.14 * alpha;
        }
      }
      // 비멤버는 테마 원 밖으로 밀어냄 — "원 안에 있음 = 진짜 소속"을 보장
      for (const node of nodes) {
        if (node.kind === "stock" && memberSet.has(node.label)) {
          continue;
        }
        const dx = (node.x ?? 0) - geom.cx;
        const dy = (node.y ?? 0) - geom.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const wanted = geom.r + node.r + 12;
        if (dist < wanted) {
          const push = ((wanted - dist) / dist) * 0.35 * alpha;
          node.vx = (node.vx ?? 0) + dx * push;
          node.vy = (node.vy ?? 0) + dy * push;
        }
      }
    }
  }

  function getNode(id: string, init: Partial<SimNode>): SimNode {
    if (!nodeCache.has(id)) {
      nodeCache.set(id, {
        id,
        kind: "stock",
        label: "",
        r: 10,
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
      focalNode.x = LOGICAL_WIDTH / 2;
      focalNode.y = LOGICAL_HEIGHT / 2 + 74;
    }

    const clusterAngle = themeCount <= 1 ? -Math.PI / 2 : (themeIndex / themeCount) * Math.PI * 2 - Math.PI / 2;
    const originX = LOGICAL_WIDTH / 2 + (themeCount <= 1 ? 0 : Math.cos(clusterAngle) * 92);
    const originY = LOGICAL_HEIGHT / 2 + (themeCount <= 1 ? -58 : Math.sin(clusterAngle) * 70);
    otherMembers.forEach((ticker, index) => {
      visibleStocks.add(ticker);
      const node = getNode("s:" + ticker, {});
      if (!node.__moved && !node.__wasPinned) {
        const angle = (index / Math.max(1, otherMembers.length)) * Math.PI * 2 - Math.PI / 2;
        const radius = otherMembers.length <= 2 ? 46 : 72;
        node.x = originX + Math.cos(angle) * radius;
        node.y = originY + Math.sin(angle) * Math.max(42, radius * 0.76);
      }
    });
  }

  const initialThemes = themesOf(model.focal);
  initialThemes.forEach((theme, index) => revealInitialTheme(theme, index, initialThemes.length));

  function buildGraph(): { nodes: SimNode[]; links: SimLink[] } {
    const nodes: SimNode[] = [];
    const links: SimLink[] = [];
    for (const ticker of visibleStocks) {
      const node = getNode("s:" + ticker, { kind: "stock", label: ticker });
      if (!node.__sized) {
        node.r = stockRadius(ticker);
        node.__sized = true;
      }
      if (ticker === model.focal && visibleStocks.size === 1) {
        node.fx = LOGICAL_WIDTH / 2;
        node.fy = LOGICAL_HEIGHT / 2;
      } else if (!node.__moved && !node.__wasPinned) {
        node.fx = null;
        node.fy = null;
      }
      nodes.push(node);
    }
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
        const node = getNode("t:" + theme, { kind: "chip", label: theme, count: (model.themes.get(theme) ?? []).length, r: 26 });
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
        const node = getNode("c:" + company, { kind: "company", label: company, r: 12 });
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
        links.push({ source: "s:" + cross.a, target: "s:" + cross.b, kind: "cross" });
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

  function collapseTheme(theme: string): void {
    expandedThemes.delete(theme);
    const selectedTicker = selectedId?.startsWith("s:") ? selectedId.slice(2) : null;
    for (const ticker of model.themes.get(theme) ?? []) {
      if (ticker === model.focal || ticker === selectedTicker) {
        continue;
      }
      const stillNeeded = themesOf(ticker).some((other) => other !== theme && expandedThemes.has(other));
      if (!stillNeeded) {
        visibleStocks.delete(ticker);
        for (const [chipTheme, anchor] of chips) {
          if (anchor === ticker) {
            chips.delete(chipTheme);
          }
        }
        childrenOf(ticker).forEach((company) => visibleCompanies.delete(company));
      }
    }
    const anchor = (model.themes.get(theme) ?? []).find((ticker) => visibleStocks.has(ticker));
    if (anchor) {
      chips.set(theme, anchor);
    }
    update(0.4);
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
        .distance((link) => ((link as unknown as SimLink).kind === "chip" ? 95 : (link as unknown as SimLink).kind === "control" ? 118 : 70))
        .strength(0.5)
    );
    simulation.alpha(alpha).restart();
    // 노드 구성이 실제로 바뀐 경우에만 auto-fit — 선택/시세 갱신으로는 배율이 출렁이지 않게
    const signature = nodes.map((node) => node.id).sort().join(",");
    if (signature !== lastFitSignature) {
      const firstFit = lastFitSignature === "";
      lastFitSignature = signature;
      scheduleFit(firstFit);
    }

    linkLayer
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links, (d) => {
        const source = typeof d.source === "string" ? d.source : d.source.id;
        const target = typeof d.target === "string" ? d.target : d.target.id;
        return source + "|" + target;
      })
      .join("line")
      .attr("class", (d) => "ofg-link" + (d.kind === "chip" ? " ofg-link-chip" : d.kind === "cross" ? " ofg-link-cross" : ""));

    const nodeGroups = nodeLayer
      .selectAll<SVGGElement, SimNode>("g.ofg-node")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const group = enter.append("g").attr("class", (d) => "ofg-node ofg-node-" + d.kind);
        const scaleGroup = group.append("g").attr("class", "ofg-node-scale");
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
      });

    nodeGroups
      .select<SVGCircleElement>("circle.ofg-body")
      .attr("r", (d) => d.r)
      .attr("fill", (d) => (d.kind === "stock" ? fillOfStock(d.label) : d.kind === "company" ? SUBSIDIARY_FILL : null))
      .attr("stroke", (d) => (d.kind === "stock" ? "rgba(26,26,14,.4)" : d.kind === "company" ? SUBSIDIARY_STROKE : null))
      .attr("stroke-width", (d) => (d.kind === "company" ? 1.8 : null));
    nodeGroups
      .select<SVGCircleElement>("circle.ofg-selected-ring")
      .attr("r", (d) => d.r + 5)
      .attr("display", (d) => (d.id === selectedId ? null : "none"));
    nodeGroups
      .select<SVGTextElement>("text.ofg-ticker")
      .attr("y", (d) => (d.kind === "chip" ? -2 : d.kind === "company" ? 0 : 0))
      .attr("dy", (d) => (d.kind === "stock" ? "-0.15em" : d.kind === "company" ? "0.35em" : 0))
      .style("font-size", (d) => (d.kind === "stock" ? Math.max(10, d.r * 0.45) + "px" : d.kind === "company" ? "8px" : null))
      .style("fill", (d) => (d.kind === "stock" ? (isDeepFill(d.label) ? PAPER : INK) : d.kind === "company" ? SUBSIDIARY_TEXT : null))
      .style("font-weight", (d) => (d.kind === "company" ? "800" : null))
      .text((d) => (d.kind === "company" ? "자회사" : d.label.length > 11 ? d.label.slice(0, 10) + "…" : d.label));
    nodeGroups
      .select<SVGTextElement>("text.ofg-pct")
      .attr("y", 3)
      .attr("dy", "0.85em")
      .attr("fill", (d) =>
        d.kind === "stock" ? (isDeepFill(d.label) ? "rgba(239,239,232,.9)" : "rgba(26,26,14,.72)") : "rgba(26,26,14,.6)"
      )
      .text((d) => (d.kind === "stock" ? pctText(d.label) : ""));
    nodeGroups
      .select<SVGTextElement>("text.ofg-count")
      .attr("y", (d) => (d.kind === "company" ? d.r + 14 : 12))
      .attr("text-anchor", "middle")
      .style("font-size", (d) => (d.kind === "company" ? "8px" : null))
      .style("font-weight", (d) => (d.kind === "company" ? "700" : null))
      .style("fill", (d) => (d.kind === "company" ? SUBSIDIARY_TEXT : null))
      .each(function renderCountOrCompanyName(d) {
        const text = d3.select(this);
        text.selectAll("tspan").remove();
        if (d.kind === "chip") {
          text.text(`${d.count ?? 0}종목`);
          return;
        }
        if (d.kind === "company") {
          text.text(null);
          subsidiaryDisplayLines(d.label).forEach((line, index) => {
            text.append("tspan").attr("x", 0).attr("dy", index === 0 ? 0 : "1.12em").text(line);
          });
          return;
        }
        text.text("");
      });
    nodeGroups.select<SVGTitleElement>("title").text((d) => {
      if (d.kind === "stock") {
        const quote = getQuote(d.label);
        const price = typeof quote?.lastPrice === "number" ? ` · ${quote.lastPrice.toFixed(2)}` : "";
        return `${d.label}${price} · 테마: ${themesOf(d.label).join(", ") || "없음"}`;
      }
      if (d.kind === "chip") {
        return `테마 "${d.label}" 펼치기 (${d.count ?? 0}종목)`;
      }
      return subsidiaryTitle(d.label);
    });
  }

  function ticked(): void {
    linkLayer
      .selectAll<SVGLineElement, SimLink>("line")
      .attr("x1", (d) => (typeof d.source === "string" ? 0 : d.source.x ?? 0))
      .attr("y1", (d) => (typeof d.source === "string" ? 0 : d.source.y ?? 0))
      .attr("x2", (d) => (typeof d.target === "string" ? 0 : d.target.x ?? 0))
      .attr("y2", (d) => (typeof d.target === "string" ? 0 : d.target.y ?? 0));
    nodeLayer.selectAll<SVGGElement, SimNode>("g.ofg-node").attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

    const byId = new Map(simulation.nodes().map((node) => [node.id, node]));
    const hulls: HullDatum[] = [];
    for (const theme of expandedThemes) {
      const geom = hullGeometry(theme, byId);
      if (geom) {
        hulls.push({ theme, cx: geom.cx, cy: geom.cy, r: geom.r });
      }
    }

    const hullGroups = hullLayer
      .selectAll<SVGGElement, HullDatum>("g.ofg-hull")
      .data(hulls, (d) => d.theme)
      .join((enter) => {
        const group = enter.append("g").attr("class", "ofg-hull");
        group.append("circle").attr("class", "ofg-hull-circle");
        const grab = group.append("circle").attr("class", "ofg-hull-grab");
        grab.append("title").text("점선을 끌면 테마 전체가 이동");
        grab.call(
          d3
            .drag<SVGCircleElement, HullDatum>()
            .on("start", (_event, d) => {
              simulation.alphaTarget(0.15).restart();
              for (const member of themeMemberNodes(d.theme)) {
                member.__wasPinned = member.fx != null;
                member.fx = member.x;
                member.fy = member.y;
              }
            })
            .on("drag", (event, d) => {
              for (const member of themeMemberNodes(d.theme)) {
                member.fx = (member.fx ?? 0) + event.dx;
                member.fy = (member.fy ?? 0) + event.dy;
              }
            })
            .on("end", (_event, d) => {
              simulation.alphaTarget(0);
              for (const member of themeMemberNodes(d.theme)) {
                if (!member.__wasPinned) {
                  member.fx = null;
                  member.fy = null;
                }
              }
            })
        );
        const label = group.append("text").attr("class", "ofg-hull-label");
        label.append("tspan").attr("class", "ofg-hull-name");
        label.append("tspan").attr("class", "ofg-hull-close").attr("dx", 6).text("접기 ✕");
        label.on("click", (event: MouseEvent, d) => {
          event.stopPropagation();
          collapseTheme(d.theme);
        });
        return group;
      });

    hullGroups
      .select<SVGCircleElement>("circle.ofg-hull-circle")
      .attr("cx", (d) => d.cx)
      .attr("cy", (d) => d.cy)
      .attr("r", (d) => d.r);
    hullGroups
      .select<SVGCircleElement>("circle.ofg-hull-grab")
      .attr("cx", (d) => d.cx)
      .attr("cy", (d) => d.cy)
      .attr("r", (d) => d.r);
    hullGroups
      .select<SVGTextElement>("text.ofg-hull-label")
      .attr("x", (d) => d.cx)
      .attr("y", (d) => d.cy - d.r - 8)
      .attr("text-anchor", "middle");
    hullGroups.select<SVGTSpanElement>("tspan.ofg-hull-name").text((d) => d.theme);
  }

  svg.on("click", () => {
    selectedId = null;
    onSelect(null);
    update(0.05);
  });

  update(1);

  return {
    refreshQuotes(): void {
      const nodeGroups = nodeLayer.selectAll<SVGGElement, SimNode>("g.ofg-node");
      nodeGroups
        .select<SVGCircleElement>("circle.ofg-body")
        .attr("fill", (d) => (d.kind === "stock" ? fillOfStock(d.label) : d.kind === "company" ? SUBSIDIARY_FILL : null));
      nodeGroups
        .select<SVGTextElement>("text.ofg-ticker")
        .style("fill", (d) => (d.kind === "stock" ? (isDeepFill(d.label) ? PAPER : INK) : d.kind === "company" ? SUBSIDIARY_TEXT : null));
      nodeGroups
        .select<SVGTextElement>("text.ofg-pct")
        .attr("fill", (d) =>
          d.kind === "stock" ? (isDeepFill(d.label) ? "rgba(239,239,232,.9)" : "rgba(26,26,14,.72)") : "rgba(26,26,14,.6)"
        )
        .text((d) => (d.kind === "stock" ? pctText(d.label) : ""));
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
  const selectedThemes = selectedTicker ? model.themesOf.get(selectedTicker) ?? [] : [];
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
          {selectedQuote?.companyName && <span className="ofg-detail-name">{selectedQuote.companyName}</span>}
          {typeof selectedQuote?.changePercent === "number" && (
            <span
              className="ofg-detail-chg"
              style={{ color: selectedQuote.changePercent >= 0.3 ? UP_COLOR : selectedQuote.changePercent <= -0.3 ? DOWN_COLOR : undefined }}
            >
              {(selectedQuote.changePercent >= 0 ? "+" : "") + selectedQuote.changePercent.toFixed(2)}%
            </span>
          )}
          {typeof selectedQuote?.lastPrice === "number" && <span className="ofg-detail-price">{selectedQuote.lastPrice.toFixed(2)}</span>}
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
      <div className="ofg-legend-hint" tabIndex={0} aria-label="범례">
        ⓘ
        <div className="ofg-legend-pop" role="tooltip">
          <div>초록 = 상승 · 빨강 = 하락, 진할수록 등락 폭 큼</div>
          <div>원 크기 = 시가총액</div>
          <div>점선 원 = 테마, 점선을 드래그하면 그룹째 이동</div>
          <div>칩 클릭 = 테마 펼치기 · 종목 클릭 = 관계 확장</div>
        </div>
      </div>
    </div>
  );
}
