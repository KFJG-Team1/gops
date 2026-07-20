/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOGO_DEV_PUBLISHABLE_KEY?: string;
  readonly VITE_LOGO_DEV_ATTRIBUTION?: string;
}

declare module "virtual:gops-ai-coach-replay-candles" {
  export type ReplayCandleTuple = readonly [
    timestamp: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ];
  export const replayCandlesBySymbol: Readonly<Record<"AAPL" | "AMZN" | "WMT", readonly ReplayCandleTuple[]>>;
}
