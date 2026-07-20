import assert from "node:assert/strict";
import { resolveWatchlistAgentCommand } from "../src/agent/watchlistAgentCommand";

assert.deepEqual(resolveWatchlistAgentCommand("이 종목을 관심종목에 추가해줘", "AMD"), {
  status: "add",
  symbol: "AMD"
});
assert.deepEqual(resolveWatchlistAgentCommand("관심 기업에 넣어줘", "oke"), {
  status: "add",
  symbol: "OKE"
});
assert.deepEqual(resolveWatchlistAgentCommand("관심종목에 추가해줘", ""), {
  status: "clarify"
});
assert.deepEqual(resolveWatchlistAgentCommand("AMD 차트 분석해줘", "AMD"), {
  status: "not_matched"
});
