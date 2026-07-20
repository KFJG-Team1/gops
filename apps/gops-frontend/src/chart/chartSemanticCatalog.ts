import catalog from "../../../../shared/chart-contract/chart-semantics.ko.json";

type SemanticSection = Record<string, string>;

export const chartSemanticCatalog = catalog as {
  version: string;
  patterns: SemanticSection;
  states: SemanticSection;
  actions: SemanticSection;
  reasons: SemanticSection;
};

export function chartSemanticLabel(section: keyof Omit<typeof chartSemanticCatalog, "version">, code: string): string {
  return chartSemanticCatalog[section][code] ?? code.replaceAll("_", " ");
}
