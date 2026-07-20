import type { AgentReference } from "../agent/agentReferences";
import type { StockRecommendationItem, StockRecommendationPayload } from "./recommendationApi";

/** Selection contract shared by the unified recommendation panel and Agent references. */
export type StockRecommendationSelection = {
  item: StockRecommendationItem;
  payload: StockRecommendationPayload;
  reference: AgentReference;
};
