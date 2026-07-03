import type { AgentEvidenceItem } from "./agentAnalysis";

export type OntologyGraphNodeKind = "symbol" | "theme" | "company";
export type OntologyGraphEdgeKind = "theme" | "control" | "shared-theme" | "cross-control";

export type OntologyGraphNode = {
  id: string;
  label: string;
  kind: OntologyGraphNodeKind;
};

export type OntologyGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: OntologyGraphEdgeKind;
  label?: string;
};

export type OntologyGraphData = {
  symbol: string;
  nodes: OntologyGraphNode[];
  edges: OntologyGraphEdge[];
  generatedAt: string;
};

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Builds a lightweight node/edge graph from ontology evidence already present in an
 * agent analysis report. No backend contract change is required: evidence.raw already
 * carries relationType/themeName/controlledName/companyName/symbols for every
 * relation type the GraphDB ontology provider emits.
 */
export function buildOntologyGraphFromEvidence(
  evidence: readonly AgentEvidenceItem[],
  primarySymbol: string
): OntologyGraphData | null {
  const nodes = new Map<string, OntologyGraphNode>();
  const edges = new Map<string, OntologyGraphEdge>();
  let matched = false;

  const ensureNode = (id: string, label: string, kind: OntologyGraphNodeKind) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, label, kind });
    }
    return id;
  };
  const ensureSymbolNode = (symbol: string) => ensureNode(`symbol:${symbol}`, symbol, "symbol");
  const ensureThemeNode = (theme: string) => ensureNode(`theme:${theme}`, theme, "theme");
  const ensureCompanyNode = (name: string) => ensureNode(`company:${name}`, name, "company");
  const addEdge = (source: string, target: string, kind: OntologyGraphEdgeKind, label?: string) => {
    const id = `${kind}:${source}->${target}`;
    if (!edges.has(id)) {
      edges.set(id, { id, source, target, kind, label });
    }
  };

  for (const item of evidence) {
    if (item.provider !== "ontology" || item.status !== "available") {
      continue;
    }
    const raw = item.raw ?? {};
    const relationType = readNonEmptyString(raw.relationType);

    if (relationType === "theme" || relationType === "theme-company") {
      const ticker = readNonEmptyString(raw.ticker) ?? primarySymbol;
      const theme = readNonEmptyString(raw.themeName);
      if (theme) {
        addEdge(ensureSymbolNode(ticker), ensureThemeNode(theme), "theme");
        matched = true;
      }
    } else if (relationType === "control" || relationType === "theme-control") {
      const ticker = readNonEmptyString(raw.ticker) ?? primarySymbol;
      const controlled = readNonEmptyString(raw.controlledName);
      if (controlled) {
        addEdge(ensureSymbolNode(ticker), ensureCompanyNode(controlled), "control");
        matched = true;
      }
    } else if (relationType === "shared-theme") {
      const symbols = Array.isArray(raw.symbols)
        ? raw.symbols.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const theme = readNonEmptyString(raw.themeName);
      if (theme && symbols.length >= 2) {
        const themeId = ensureThemeNode(theme);
        symbols.forEach((symbol) => addEdge(ensureSymbolNode(symbol), themeId, "shared-theme"));
        matched = true;
      }
    } else if (relationType === "cross-control") {
      const controller = readNonEmptyString(raw.controllerTicker);
      const controlled = readNonEmptyString(raw.controlledTicker);
      if (controller && controlled) {
        addEdge(ensureSymbolNode(controller), ensureSymbolNode(controlled), "cross-control", readNonEmptyString(raw.controlledName));
        matched = true;
      }
    }
  }

  if (!matched) {
    return null;
  }

  ensureSymbolNode(primarySymbol);

  return {
    symbol: primarySymbol,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    generatedAt: new Date().toISOString()
  };
}
