import type { ChartInterval } from "../chart/types";

export type AgentVisualOverlay =
  | {
      id: string;
      kind: "candleHighlight";
      anchors: Array<{
        symbol: string;
        interval: ChartInterval;
        timestamp: string;
      }>;
      styleToken: "signal" | "caution" | "preview";
      expiresAt?: string;
      label?: string;
    }
  | {
      id: string;
      kind: "rangeHighlight";
      anchors: Array<{
        symbol: string;
        interval: ChartInterval;
        from: string;
        to: string;
      }>;
      styleToken: "signal" | "caution" | "preview";
      expiresAt?: string;
      label?: string;
    };

export function overlayExpiry(seconds = 8): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
