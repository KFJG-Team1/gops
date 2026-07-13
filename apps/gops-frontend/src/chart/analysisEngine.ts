export type AnalysisEngine = "geometry" | "czardas" | "off";

// Release constant only. It is intentionally not backed by UI, localStorage,
// an environment variable, or a server-side preference.
export const analysisEngine: AnalysisEngine = "czardas";
