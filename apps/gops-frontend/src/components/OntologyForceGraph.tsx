import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { WatchlistSymbol } from "@gops/chart-engine/symbols";
import type {
  OntologyGraphData,
  OntologyGraphEdge,
  OntologyGraphEdgeKind,
  OntologyGraphNodeKind
} from "../agents/ontologyGraph";

/**
 * 온톨로지 관계 force 그래프 패널.
 *
 * - 테마 = 점선 컨테이너 원 (비멤버는 물리적으로 밖으로 밀려나 "원 안 = 진짜 소속" 보장)
 * - 등락 = 명암 (밝음 = 상승, 어두움 = 하락, 강도 = 등락 폭) — knownSymbols 시세를 렌더 시점에 join
 * - 점진 확장: 시작은 분석 종목 하나, 클릭할수록 테마 칩/자회사/교차지배가 펼쳐짐
 * - 외곽 점선 드래그 = 테마 그룹째 이동, 노드 드래그 = 해당 위치에 고정
 */

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 480;

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
};

type SimLink = { source: string | SimNode; target: string | SimNode; kind: "chip" | "control" | "cross" };

type HullDatum = { theme: string; cx: number; cy: number; r: number };

type GraphController = {
  refreshQuotes: () => void;
  destroy: () => void;
};

type QuoteLookup = (ticker: string) => WatchlistSymbol | undefined;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function readOntologyGraph(value: unknown): OntologyGraphData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const nodeKinds: OntologyGraphNodeKind[] = ["symbol", "theme", "company"];
  const edgeKinds: OntologyGraphEdgeKind[] = ["theme", "control", "shared-theme", "cross-control"];

  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const node = item as Record<string, unknown>;
      const id = readString(node.id);
      const label = readString(node.label);
      const kind = readString(node.kind);
      if (!id || !label || !kind || !nodeKinds.includes(kind as OntologyGraphNodeKind)) {
        return null;
      }
      return { id, label, kind: kind as OntologyGraphNodeKind };
    })
    .filter((node): node is { id: string; label: string; kind: OntologyGraphNodeKind } => Boolean(node));

  const edges = (Array.isArray(source.edges) ? source.edges : [])
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const edge = item as Record<string, unknown>;
      const id = readString(edge.id);
      const edgeSource = readString(edge.source);
      const edgeTarget = readString(edge.target);
      const kind = readString(edge.kind);
      if (!id || !edgeSource || !edgeTarget || !kind || !edgeKinds.includes(kind as OntologyGraphEdgeKind)) {
        return null;
      }
      const label = readString(edge.label);
      const built: OntologyGraphEdge = { id, source: edgeSource, target: edgeTarget, kind: kind as OntologyGraphEdgeKind };
      if (label) {
        built.label = label;
      }
      return built;
    })
    .filter((edge): edge is OntologyGraphEdge => Boolean(edge));

  if (nodes.length === 0) {
    return null;
  }

  return {
    symbol: readString(source.symbol) ?? "",
    nodes,
    edges,
    generatedAt: readString(source.generatedAt) ?? ""
  };
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
      if (source.kind === "symbol" && target.kind === "company") {
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
    const degree = themesOf(ticker).length + childrenOf(ticker).length + crossPartnersOf(ticker).length;
    return (ticker === model.focal ? 20 : 15) + Math.min(10, degree * 2);
  };

  const fillOfStock = (ticker: string): string => {
    const change = getQuote(ticker)?.changePercent;
    if (typeof change !== "number" || Math.abs(change) < 0.3) {
      return "#566072";
    }
    const intensity = Math.min(1, Math.abs(change) / 3) * 0.75 + 0.25;
    return change > 0
      ? d3.interpolateRgb("#707a90", "#f4f6fa")(intensity)
      : d3.interpolateRgb("#39404f", "#101319")(intensity);
  };

  const isLightNode = (ticker: string): boolean => {
    const change = getQuote(ticker)?.changePercent;
    return typeof change === "number" && change >= 0.3;
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
  themesOf(model.focal).forEach((theme) => chips.set(theme, model.focal));

  // ---------- SVG ----------
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  const root = svg.append("g");
  const zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 2.5])
    .on("zoom", (event) => root.attr("transform", event.transform.toString()));
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
    .force("collide", d3.forceCollide<SimNode>().radius((d) => d.r + 14).strength(0.9))
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
    const r = Math.max(50, (d3.max(members, (m) => Math.hypot((m.x ?? 0) - cx, (m.y ?? 0) - cy) + m.r) ?? 0) + 24);
    return { cx, cy, r, members };
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
        x: LOGICAL_WIDTH / 2 + (Math.random() - 0.5) * 40,
        y: LOGICAL_HEIGHT / 2 + (Math.random() - 0.5) * 40,
        ...init
      } as SimNode);
    }
    return Object.assign(nodeCache.get(id) as SimNode, init);
  }

  function buildGraph(): { nodes: SimNode[]; links: SimLink[] } {
    const nodes: SimNode[] = [];
    const links: SimLink[] = [];
    for (const ticker of visibleStocks) {
      const node = getNode("s:" + ticker, { kind: "stock", label: ticker, r: stockRadius(ticker) });
      if (ticker === model.focal && visibleStocks.size === 1) {
        node.fx = LOGICAL_WIDTH / 2;
        node.fy = LOGICAL_HEIGHT / 2;
      } else if (!node.__moved && !node.__wasPinned) {
        node.fx = null;
        node.fy = null;
      }
      nodes.push(node);
    }
    for (const [theme, anchor] of chips) {
      if (!visibleStocks.has(anchor)) {
        continue;
      }
      nodes.push(getNode("t:" + theme, { kind: "chip", label: theme, count: (model.themes.get(theme) ?? []).length, r: 26 }));
      links.push({ source: "s:" + anchor, target: "t:" + theme, kind: "chip" });
    }
    for (const company of visibleCompanies) {
      const parent = model.companies.get(company);
      if (!parent || !visibleStocks.has(parent)) {
        continue;
      }
      nodes.push(getNode("c:" + company, { kind: "company", label: company, r: 12 }));
      links.push({ source: "s:" + parent, target: "c:" + company, kind: "control" });
    }
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
    for (const ticker of model.themes.get(theme) ?? []) {
      if (!visibleStocks.has(ticker)) {
        visibleStocks.add(ticker);
        const node = getNode("s:" + ticker, {});
        node.x = (origin.x ?? LOGICAL_WIDTH / 2) + (Math.random() - 0.5) * 50;
        node.y = (origin.y ?? LOGICAL_HEIGHT / 2) + (Math.random() - 0.5) * 50;
      }
    }
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
    for (const theme of themesOf(ticker)) {
      if (!expandedThemes.has(theme) && !chips.has(theme)) {
        chips.set(theme, ticker);
      }
    }
    childrenOf(ticker).forEach((company) => visibleCompanies.add(company));
    crossPartnersOf(ticker).forEach((partner) => visibleStocks.add(partner));
    selectedId = id;
    onSelect(ticker);
    update(0.35);
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
        .distance((link) => ((link as unknown as SimLink).kind === "chip" ? 95 : 70))
        .strength(0.5)
    );
    simulation.alpha(alpha).restart();

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
        group.append("circle").attr("class", "ofg-body");
        group.append("circle").attr("class", "ofg-selected-ring").attr("display", "none");
        group.append("text").attr("class", "ofg-ticker");
        group.append("text").attr("class", "ofg-pct");
        group.append("text").attr("class", "ofg-count");
        group.append("title");
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
      .attr("fill", (d) => (d.kind === "stock" ? fillOfStock(d.label) : null))
      .attr("stroke", (d) => (d.kind === "stock" ? "rgba(255,255,255,.35)" : null));
    nodeGroups
      .select<SVGCircleElement>("circle.ofg-selected-ring")
      .attr("r", (d) => d.r + 5)
      .attr("display", (d) => (d.id === selectedId ? null : "none"));
    nodeGroups
      .select<SVGTextElement>("text.ofg-ticker")
      .attr("y", (d) => (d.kind === "chip" ? -2 : d.kind === "company" ? d.r + 12 : 0))
      .attr("dy", (d) => (d.kind === "stock" ? "-0.15em" : 0))
      .style("font-size", (d) => (d.kind === "stock" ? Math.max(10, d.r * 0.45) + "px" : null))
      .style("fill", (d) => (d.kind === "stock" && isLightNode(d.label) ? "#12151b" : null))
      .text((d) => (d.label.length > 11 ? d.label.slice(0, 10) + "…" : d.label));
    nodeGroups
      .select<SVGTextElement>("text.ofg-pct")
      .attr("y", 3)
      .attr("dy", "0.85em")
      .attr("fill", (d) => (d.kind === "stock" ? (isLightNode(d.label) ? "rgba(15,18,24,.8)" : "rgba(255,255,255,.85)") : "#8b93a7"))
      .text((d) => (d.kind === "stock" ? pctText(d.label) : ""));
    nodeGroups.select<SVGTextElement>("text.ofg-count").attr("y", 12).text((d) => (d.kind === "chip" ? `${d.count ?? 0}종목` : ""));
    nodeGroups.select<SVGTitleElement>("title").text((d) => {
      if (d.kind === "stock") {
        const quote = getQuote(d.label);
        const price = typeof quote?.lastPrice === "number" ? ` · ${quote.lastPrice.toFixed(2)}` : "";
        return `${d.label}${price} · 테마: ${themesOf(d.label).join(", ") || "없음"}`;
      }
      if (d.kind === "chip") {
        return `테마 "${d.label}" 펼치기 (${d.count ?? 0}종목)`;
      }
      return `${d.label} (비상장 자회사)`;
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
            .on("start", (event, d) => {
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
            .on("end", (event, d) => {
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
        .attr("fill", (d) => (d.kind === "stock" ? fillOfStock(d.label) : null));
      nodeGroups
        .select<SVGTextElement>("text.ofg-ticker")
        .style("fill", (d) => (d.kind === "stock" && isLightNode(d.label) ? "#12151b" : null));
      nodeGroups
        .select<SVGTextElement>("text.ofg-pct")
        .attr("fill", (d) => (d.kind === "stock" ? (isLightNode(d.label) ? "rgba(15,18,24,.8)" : "rgba(255,255,255,.85)") : "#8b93a7"))
        .text((d) => (d.kind === "stock" ? pctText(d.label) : ""));
    },
    destroy(): void {
      simulation.stop();
      svg.on("click", null);
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
    }
  };
}

export function OntologyForceGraph({
  rawGraph,
  symbol,
  knownSymbols,
  onSelectSymbol
}: {
  rawGraph: unknown;
  symbol: string | null;
  knownSymbols: readonly WatchlistSymbol[];
  onSelectSymbol?: (symbol: string) => boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const quotes = useMemo(() => {
    const map = new Map<string, WatchlistSymbol>();
    knownSymbols.forEach((item) => map.set(item.symbol.toUpperCase(), item));
    return map;
  }, [knownSymbols]);
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  const graph = useMemo(() => readOntologyGraph(rawGraph), [rawGraph]);
  const model = useMemo(() => (graph ? buildModel(graph, symbol) : null), [graph, symbol]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!model || !svgElement) {
      return;
    }
    setSelectedTicker(null);
    const controller = createGraphController(
      svgElement,
      model,
      (ticker) => quotesRef.current.get(ticker.toUpperCase()),
      setSelectedTicker
    );
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    controllerRef.current?.refreshQuotes();
  }, [quotes]);

  if (!model) {
    return (
      <div className="panel-placeholder panel-placeholder-muted">
        <small>{symbol ? `${symbol} 관계 데이터가 아직 없습니다` : "관계 분석 결과가 아직 없습니다"}</small>
      </div>
    );
  }

  const selectedQuote = selectedTicker ? quotes.get(selectedTicker.toUpperCase()) : undefined;
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
          {typeof selectedQuote?.changePercent === "number" && (
            <span className="ofg-detail-chg">
              {(selectedQuote.changePercent >= 0 ? "+" : "") + selectedQuote.changePercent.toFixed(2)}%
            </span>
          )}
          {typeof selectedQuote?.lastPrice === "number" && <span className="ofg-detail-price">{selectedQuote.lastPrice.toFixed(2)}</span>}
          {selectedThemes.length > 0 && <div className="ofg-detail-tags">{selectedThemes.map((theme) => <em key={theme}>{theme}</em>)}</div>}
          {selectedChildren.length > 0 && <div className="ofg-detail-tags">{selectedChildren.map((company) => <em key={company}>{company}</em>)}</div>}
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
      <div className="ofg-legend">밝음=상승 · 어두움=하락 · 점선 원=테마(점선 드래그=이동) · 칩 클릭=펼치기</div>
    </div>
  );
}
