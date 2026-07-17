export type GlossaryCategory = "indicator" | "structure" | "volume" | "pattern" | "candle" | "fundamental" | "general";

export type GlossaryEntry = {
  id: string;
  term: string;
  aliases: string[];
  description: string;
  category: GlossaryCategory;
};

export type RequiredGlossaryId =
  | "moving_average" | "sma" | "ema" | "wma" | "golden_cross" | "dead_cross"
  | "rsi" | "macd" | "signal_line" | "stochastic" | "bollinger_bands" | "band_walk"
  | "squeeze" | "vwap" | "atr" | "divergence" | "overbought" | "oversold" | "momentum"
  | "support" | "resistance" | "role_flip" | "trendline" | "channel" | "range"
  | "breakout" | "breakdown" | "retest" | "gap" | "swing_high" | "swing_low" | "pivot"
  | "market_structure" | "impulse" | "pullback" | "fibonacci_retracement" | "reversal"
  | "dollar_volume" | "volume_profile" | "poc" | "value_area" | "vah" | "val"
  | "hvn" | "lvn" | "volume_spike" | "relative_volume"
  | "double_bottom" | "double_top" | "head_and_shoulders" | "triangle" | "wedge" | "flag_pattern"
  | "ohlc" | "closed_bar" | "wick"
  | "volatility" | "regime" | "invalidation" | "liquidity"
  | "touch_episode" | "failed_breakout"
  | "confirmation_condition" | "timeframe_alignment" | "counter_evidence" | "data_coverage";

const entry = (
  id: RequiredGlossaryId,
  term: string,
  aliases: string[],
  description: string,
  category: GlossaryCategory
): GlossaryEntry => ({ id, term, aliases, description, category });

export const stockGlossary: Record<RequiredGlossaryId, GlossaryEntry> = {
  moving_average: entry("moving_average", "이동평균선", ["이동평균선", "이동평균", "MA", "moving average"], "일정 기간의 평균 가격을 선으로 이어, 가격 흐름이 어느 방향인지 보여줍니다.", "indicator"),
  sma: entry("sma", "SMA", ["SMA", "단순이동평균", "simple moving average"], "정해진 기간의 모든 가격에 같은 비중을 적용해 계산한 평균선입니다.", "indicator"),
  ema: entry("ema", "EMA", ["EMA", "지수이동평균", "exponential moving average"], "최근 가격에 더 큰 비중을 적용해 가격 변화에 빠르게 반응하는 평균선입니다.", "indicator"),
  wma: entry("wma", "WMA", ["WMA", "가중이동평균", "weighted moving average"], "최근 시점일수록 더 큰 비중을 적용해 계산한 평균선입니다.", "indicator"),
  golden_cross: entry("golden_cross", "골든크로스", ["골든크로스", "golden cross"], "짧은 기간 평균선이 긴 기간 평균선을 아래에서 위로 통과한 상태입니다.", "indicator"),
  dead_cross: entry("dead_cross", "데드크로스", ["데드크로스", "데스크로스", "dead cross"], "짧은 기간 평균선이 긴 기간 평균선을 위에서 아래로 통과한 상태입니다.", "indicator"),
  rsi: entry("rsi", "RSI", ["RSI", "상대강도지수", "relative strength index"], "최근 상승 폭과 하락 폭을 0~100으로 나타내 가격 쏠림 정도를 보여주는 값입니다.", "indicator"),
  macd: entry("macd", "MACD", ["MACD", "moving average convergence divergence"], "빠른 평균선과 느린 평균선의 차이로 가격 움직임의 방향과 힘 변화를 보여줍니다.", "indicator"),
  signal_line: entry("signal_line", "시그널선", ["시그널선", "신호선", "signal line"], "MACD 값을 다시 평균 낸 선으로, MACD와 만나는 지점에서 흐름 변화를 확인합니다.", "indicator"),
  stochastic: entry("stochastic", "스토캐스틱", ["스토캐스틱", "stochastic", "stochastic oscillator"], "최근 고가와 저가 사이에서 현재 종가가 어디에 있는지 0~100으로 나타냅니다.", "indicator"),
  bollinger_bands: entry("bollinger_bands", "볼린저 밴드", ["볼린저 밴드", "볼린저밴드", "Bollinger Bands", "BB"], "평균 가격 위아래에 최근 가격 변동 폭을 표시해 현재 움직임의 범위를 보여줍니다.", "indicator"),
  band_walk: entry("band_walk", "밴드워크", ["밴드워크", "band walk"], "가격이 볼린저 밴드의 위쪽이나 아래쪽 경계를 따라 계속 움직이는 상태입니다.", "indicator"),
  squeeze: entry("squeeze", "스퀴즈", ["스퀴즈", "변동성 수축", "squeeze", "volatility contraction"], "가격 움직임의 폭이 평소보다 좁아져 다음 큰 움직임을 기다리는 상태입니다.", "indicator"),
  vwap: entry("vwap", "VWAP", ["VWAP", "거래량가중평균가격", "volume weighted average price"], "거래가 많이 이뤄진 가격에 더 큰 비중을 둔 평균 체결 가격입니다.", "indicator"),
  atr: entry("atr", "ATR", ["ATR", "평균진폭", "average true range"], "최근 봉이 움직인 실제 가격 폭의 평균으로, 방향이 아닌 움직임의 크기를 나타냅니다.", "indicator"),
  divergence: entry("divergence", "다이버전스", ["다이버전스", "divergence"], "가격과 보조지표가 서로 반대 방향으로 움직여 기존 흐름이 약해질 수 있는 상태입니다.", "indicator"),
  overbought: entry("overbought", "과매수", ["과매수", "overbought"], "최근 상승이 빠르게 이어져 매수세가 한쪽으로 많이 쏠린 상태입니다.", "indicator"),
  oversold: entry("oversold", "과매도", ["과매도", "oversold"], "최근 하락이 빠르게 이어져 매도세가 한쪽으로 많이 쏠린 상태입니다.", "indicator"),
  momentum: entry("momentum", "모멘텀", ["모멘텀", "momentum"], "가격 움직임이 얼마나 빠르고 강한지를 나타내는 말입니다.", "indicator"),

  support: entry("support", "지지선", ["지지선", "support", "support level"], "가격이 내려올 때 하락이 멈추거나 반등한 적이 있는 가격대입니다.", "structure"),
  resistance: entry("resistance", "저항선", ["저항선", "resistance", "resistance level"], "가격이 올라갈 때 상승이 막히거나 하락한 적이 있는 가격대입니다.", "structure"),
  role_flip: entry("role_flip", "지지·저항 전환", ["지지·저항 전환", "지지 저항 전환", "role flip", "support resistance flip"], "가격이 경계를 통과한 뒤 기존 저항선이 지지선으로, 또는 그 반대로 바뀐 상태입니다.", "structure"),
  trendline: entry("trendline", "추세선", ["추세선", "trendline", "trend line"], "여러 고점이나 저점을 이어 가격 움직임의 방향과 경계를 표시한 선입니다.", "structure"),
  channel: entry("channel", "가격 채널", ["가격 채널", "상승 채널", "하락 채널", "price channel"], "가격이 대체로 평행한 위아래 두 경계 안에서 움직이는 구간입니다.", "structure"),
  range: entry("range", "횡보", ["횡보", "박스권", "range", "sideways"], "가격이 뚜렷한 방향 없이 일정한 위아래 경계 사이를 오가는 상태입니다.", "structure"),
  breakout: entry("breakout", "돌파", ["돌파", "breakout"], "가격이 저항선이나 범위의 위쪽 경계를 넘어선 움직임입니다.", "structure"),
  breakdown: entry("breakdown", "하향 이탈", ["하향 이탈", "하방 이탈", "breakdown"], "가격이 지지선이나 범위의 아래쪽 경계 밑으로 내려간 움직임입니다.", "structure"),
  retest: entry("retest", "리테스트", ["리테스트", "retest"], "돌파한 가격대로 다시 돌아와 그 경계에서 가격이 버티는지 확인하는 움직임입니다.", "structure"),
  gap: entry("gap", "갭", ["갭", "gap", "price gap"], "앞선 봉과 다음 봉 사이에 거래 흔적이 없는 가격 구간이 생긴 상태입니다.", "structure"),
  swing_high: entry("swing_high", "스윙 고점", ["스윙 고점", "swing high"], "앞뒤 봉보다 높아 짧은 구간의 꼭짓점이 된 가격입니다.", "structure"),
  swing_low: entry("swing_low", "스윙 저점", ["스윙 저점", "swing low"], "앞뒤 봉보다 낮아 짧은 구간의 바닥이 된 가격입니다.", "structure"),
  pivot: entry("pivot", "피벗", ["피벗", "pivot", "pivot point"], "가격이 오르다가 내리거나 내리다가 오르기 시작한 방향 전환 지점입니다.", "structure"),
  market_structure: entry("market_structure", "고점·저점 갱신", ["고점·저점 갱신", "고점 저점 갱신", "HH", "HL", "LH", "LL", "market structure"], "새 고점과 새 저점이 이전보다 높아지는지 낮아지는지 비교한 가격 흐름입니다.", "structure"),
  impulse: entry("impulse", "임펄스", ["임펄스", "impulse", "impulse move"], "가격이 짧은 시간에 한 방향으로 빠르고 크게 움직인 구간입니다.", "structure"),
  pullback: entry("pullback", "되돌림", ["되돌림", "pullback", "retracement"], "한 방향으로 움직이던 가격이 잠시 반대 방향으로 돌아온 구간입니다.", "structure"),
  fibonacci_retracement: entry("fibonacci_retracement", "피보나치 되돌림", ["피보나치 되돌림", "Fibonacci retracement", "fib retracement"], "큰 가격 움직임을 정해진 비율로 나눠 되돌아올 수 있는 가격대를 표시합니다.", "structure"),
  reversal: entry("reversal", "추세 전환", ["추세 전환", "반전", "reversal", "trend reversal"], "오르던 가격이 내림세로, 또는 내리던 가격이 오름세로 방향을 바꾸는 과정입니다.", "structure"),
  touch_episode: entry("touch_episode", "접점", ["접점", "touch episode"], "가격이 같은 선이나 구간에 연속으로 닿은 움직임을 한 번의 반응으로 묶은 것입니다.", "structure"),
  failed_breakout: entry("failed_breakout", "실패한 돌파", ["실패한 돌파", "failed breakout"], "가격이 경계를 넘은 뒤 그 상태를 유지하지 못하고 다시 안쪽으로 돌아온 움직임입니다.", "structure"),
  confirmation_condition: entry("confirmation_condition", "확인 조건", ["확인 조건", "confirmation condition"], "분석이 맞다고 보기 전에 가격이나 거래량에서 추가로 확인해야 하는 조건입니다.", "general"),
  timeframe_alignment: entry("timeframe_alignment", "상위 주기 정합", ["상위 주기 정합", "timeframe alignment"], "짧은 기간 차트와 더 긴 기간 차트가 같은 상승 또는 하락 방향을 가리키는 상태입니다.", "general"),
  counter_evidence: entry("counter_evidence", "반대 근거", ["반대 근거", "counter evidence"], "현재 예상과 반대 방향을 가리키는 가격이나 거래 움직임입니다.", "general"),
  data_coverage: entry("data_coverage", "데이터 커버리지", ["데이터 커버리지", "data coverage"], "분석에 필요한 기간 중 실제 가격 데이터가 빠짐없이 확보된 정도입니다.", "general"),

  dollar_volume: entry("dollar_volume", "거래대금", ["거래대금", "dollar volume", "traded value"], "체결 가격에 거래 수량을 곱한 금액으로, 시장에서 실제로 오간 돈의 규모입니다.", "volume"),
  volume_profile: entry("volume_profile", "매물대", ["매물대", "거래량 프로파일", "volume profile"], "각 가격대에서 얼마나 많이 거래됐는지를 가로 막대 형태로 나타낸 분포입니다.", "volume"),
  poc: entry("poc", "POC", ["POC", "Point of Control"], "표시된 기간에 거래량이 가장 많이 쌓인 하나의 가격대입니다.", "volume"),
  value_area: entry("value_area", "밸류 에어리어", ["밸류 에어리어", "가치 영역", "Value Area"], "전체 거래량의 대부분이 집중된 가격 범위입니다.", "volume"),
  vah: entry("vah", "VAH", ["VAH", "Value Area High"], "거래량이 집중된 중심 가격 범위의 위쪽 경계입니다.", "volume"),
  val: entry("val", "VAL", ["VAL", "Value Area Low"], "거래량이 집중된 중심 가격 범위의 아래쪽 경계입니다.", "volume"),
  hvn: entry("hvn", "HVN", ["HVN", "High Volume Node"], "주변보다 거래량이 많이 쌓여 가격이 머문 흔적이 큰 가격대입니다.", "volume"),
  lvn: entry("lvn", "LVN", ["LVN", "Low Volume Node"], "주변보다 거래량이 적어 가격이 빠르게 지나간 흔적이 큰 가격대입니다.", "volume"),
  volume_spike: entry("volume_spike", "거래량 급증", ["거래량 급증", "volume spike"], "현재 거래량이 평소보다 갑자기 크게 늘어난 상태입니다.", "volume"),
  relative_volume: entry("relative_volume", "상대 거래량", ["상대 거래량", "RVOL", "relative volume"], "현재 거래량을 평소 같은 시간이나 기간의 거래량과 비교한 값입니다.", "volume"),

  double_bottom: entry("double_bottom", "이중 바닥", ["이중 바닥", "쌍바닥", "double bottom"], "비슷한 낮은 가격에서 두 번 반등해 W 모양이 만들어진 형태입니다.", "pattern"),
  double_top: entry("double_top", "이중 천장", ["이중 천장", "쌍봉", "double top"], "비슷한 높은 가격에서 두 번 하락해 M 모양이 만들어진 형태입니다.", "pattern"),
  head_and_shoulders: entry("head_and_shoulders", "헤드앤숄더", ["헤드앤숄더", "머리어깨형", "head and shoulders"], "가운데 봉우리가 가장 높고 양옆에 더 낮은 봉우리가 하나씩 있는 형태입니다.", "pattern"),
  triangle: entry("triangle", "삼각 수렴", ["삼각 수렴", "삼각형", "triangle", "triangle pattern"], "고점과 저점의 간격이 점차 좁아져 가격 움직임이 삼각형 안에 모이는 형태입니다.", "pattern"),
  wedge: entry("wedge", "쐐기형", ["쐐기형", "쐐기", "wedge", "wedge pattern"], "위아래 경계가 같은 방향으로 기울면서 서로 가까워지는 형태입니다.", "pattern"),
  flag_pattern: entry("flag_pattern", "깃발형", ["깃발형", "플래그 패턴", "flag pattern"], "가격이 크게 움직인 뒤 짧은 평행 구간에서 잠시 쉬어 가는 형태입니다.", "pattern"),

  ohlc: entry("ohlc", "OHLC", ["OHLC", "시가·고가·저가·종가", "open high low close"], "한 봉의 시작 가격, 최고 가격, 최저 가격, 마지막 가격을 묶어 부르는 말입니다.", "candle"),
  closed_bar: entry("closed_bar", "확정봉", ["확정봉", "마감봉", "closed bar", "closed candle"], "해당 시간 구간이 끝나 가격과 거래량이 더 이상 바뀌지 않는 봉입니다.", "candle"),
  wick: entry("wick", "꼬리", ["꼬리", "윗꼬리", "아랫꼬리", "wick", "shadow"], "봉의 몸통 밖으로 뻗은 선으로, 그 기간에 도달했던 최고가와 최저가를 보여줍니다.", "candle"),

  volatility: entry("volatility", "변동성", ["변동성", "volatility"], "가격이 일정 기간 동안 오르내리는 폭이 얼마나 큰지를 나타냅니다.", "general"),
  regime: entry("regime", "국면", ["국면", "레짐", "regime", "market regime"], "현재 시장을 상승, 하락, 횡보, 큰 가격 변동 같은 상태로 구분한 것입니다.", "general"),
  invalidation: entry("invalidation", "무효화 조건", ["무효화 조건", "무효화", "invalidation", "invalidation condition"], "가격이 이 기준을 벗어나면, 앞서 세운 매수·매도 예상이 틀렸다고 보고 계획을 다시 검토합니다.", "general"),
  liquidity: entry("liquidity", "유동성", ["유동성", "liquidity"], "원하는 가격과 수량으로 빠르게 사고팔 수 있는 정도입니다.", "general")
};

export const extraGlossary: GlossaryEntry[] = [
  {
    id: "risk_off",
    term: "리스크오프",
    aliases: ["리스크오프", "risk-off", "risk off"],
    description: "투자자들이 주식 같은 위험 자산을 줄이고 현금이나 채권처럼 비교적 안전한 자산을 찾는 분위기입니다.",
    category: "general"
  },
  {
    id: "sector_rotation",
    term: "순환매",
    aliases: ["순환매", "sector rotation"],
    description: "투자 자금이 한 업종에서 다른 업종으로 옮겨 가며 차례로 주가가 오르는 흐름입니다.",
    category: "general"
  },
  {
    id: "valuation",
    term: "밸류에이션",
    aliases: ["밸류에이션", "valuation", "기업가치 평가"],
    description: "기업의 실적과 성장 가능성에 비해 현재 주가가 비싼지 싼지 판단한 수준입니다.",
    category: "general"
  },
  {
    id: "resilient",
    term: "견조",
    aliases: ["견조", "견조한", "견조하게"],
    description: "시장 상황이 흔들려도 실적이나 수요가 비교적 안정적으로 유지되는 상태입니다.",
    category: "general"
  },
  {
    id: "wait_and_see",
    term: "관망",
    aliases: ["관망", "관망세", "관망 분위기"],
    description: "새 정보가 나올 때까지 적극적으로 사고팔지 않고 기다리는 시장 분위기입니다.",
    category: "general"
  },
  {
    id: "share_buyback",
    term: "자사주 매입",
    aliases: ["자사주 매입", "자사주매입", "share buyback", "stock buyback"],
    description: "회사가 시장에서 자기 회사 주식을 사들이는 것으로, 유통 주식 수를 줄이거나 주주 환원에 활용합니다.",
    category: "general"
  },
  {
    id: "antitrust",
    term: "반독점",
    aliases: ["반독점", "반독점 규제", "antitrust"],
    description: "한 기업이 시장 지배력을 남용해 경쟁을 막지 못하도록 정부가 조사하거나 제한하는 제도입니다.",
    category: "general"
  },
  {
    id: "rate_caution",
    term: "금리 경계감",
    aliases: ["금리 경계감", "금리 부담", "금리 우려"],
    description: "금리가 오르거나 높은 수준이 오래갈 가능성을 투자자들이 조심스럽게 보는 분위기입니다.",
    category: "general"
  },
  {
    id: "entry_price",
    term: "진입가",
    aliases: ["진입가", "진입 가격"],
    description: "매수나 매도를 시작할지 판단하는 기준 가격이며, 도달해도 주문이 자동 실행되지는 않습니다.",
    category: "general"
  },
  {
    id: "target_price",
    term: "목표가",
    aliases: ["목표가", "목표 가격"],
    description: "가격이 예상한 방향으로 움직였을 때 이익 실현을 검토하는 기준 가격입니다.",
    category: "general"
  },
  {
    id: "stop_loss",
    term: "손절",
    aliases: ["손절", "손절가", "손절 가격"],
    description: "가격이 예상과 반대로 움직였을 때 손실을 제한하기 위해 매도를 검토하는 기준 가격입니다.",
    category: "general"
  },
  {
    id: "reward_risk_ratio",
    term: "손익비",
    aliases: ["손익비", "보상 위험 비율", "reward risk ratio", "R:R"],
    description: "예상 손실과 기대 이익의 비율로, 1:2는 손실 1에 이익 2를 기대한다는 뜻입니다.",
    category: "general"
  },
  {
    id: "operating_margin",
    term: "영업이익률",
    aliases: ["영업이익률", "operating margin"],
    description: "매출에서 영업비용을 뺀 이익이 매출의 몇 %인지 나타냅니다. 본업에서 얼마나 남기는지를 보여줍니다.",
    category: "general"
  },
  {
    id: "net_margin",
    term: "순이익률",
    aliases: ["순이익률", "net margin"],
    description: "세금과 이자까지 모두 반영한 최종 이익이 매출의 몇 %인지 나타냅니다.",
    category: "general"
  },
  {
    id: "roe",
    term: "ROE",
    aliases: ["ROE", "자기자본이익률"],
    description: "주주가 투자한 자본으로 1년에 얼마의 이익을 냈는지 나타내는 비율입니다.",
    category: "general"
  },
  {
    id: "debt_to_equity",
    term: "부채/자본",
    aliases: ["부채/자본", "부채비율", "debt to equity", "D/E"],
    description: "자기자본 대비 빌린 돈의 비율입니다. 낮을수록 빚에 덜 의존하는 구조입니다.",
    category: "general"
  },
  {
    id: "consensus",
    term: "컨센서스",
    aliases: ["컨센서스", "consensus", "시장 예상치"],
    description: "여러 애널리스트가 예상한 실적 전망치의 평균입니다. 실제 실적과 비교하는 기준이 됩니다.",
    category: "general"
  },
  {
    id: "earnings_surprise",
    term: "어닝 서프라이즈",
    aliases: ["어닝 서프라이즈", "earnings surprise", "예상치 상회"],
    description: "실제 실적이 애널리스트 예상치보다 높게 나온 경우를 말합니다.",
    category: "general"
  },
  {
    id: "fabless",
    term: "팹리스",
    aliases: ["팹리스", "fabless"],
    description: "반도체를 설계만 하고 생산은 외부 공장에 맡기는 사업 방식입니다.",
    category: "general"
  },
  {
    id: "foundry",
    term: "파운드리",
    aliases: ["파운드리", "foundry"],
    description: "다른 회사가 설계한 반도체를 위탁 생산해 주는 사업 방식입니다.",
    category: "general"
  },
  {
    id: "market_cap",
    term: "시가총액",
    aliases: ["시가총액", "market cap", "market capitalization"],
    description: "현재 주가에 발행주식수를 곱한 값으로, 시장이 평가하는 기업 전체 가치입니다.",
    category: "fundamental"
  },
  {
    id: "shares_outstanding",
    term: "발행주식수",
    aliases: ["발행주식수", "발행 주식수", "shares outstanding"],
    description: "회사가 발행해 투자자가 보유하고 있는 전체 주식 수입니다.",
    category: "fundamental"
  },
  {
    id: "revenue",
    term: "매출",
    aliases: ["매출", "매출액", "revenue"],
    description: "회사가 제품이나 서비스를 판매해 벌어들인 총금액으로, 비용을 빼기 전 값입니다.",
    category: "fundamental"
  },
  {
    id: "operating_income",
    term: "영업이익",
    aliases: ["영업이익", "영업 이익", "operating income"],
    description: "회사의 주된 사업에서 매출과 영업비용을 반영하고 남은 이익입니다.",
    category: "fundamental"
  },
  {
    id: "net_income",
    term: "순이익",
    aliases: ["순이익", "순 이익", "net income"],
    description: "영업비용과 이자, 세금 등을 모두 반영하고 최종적으로 남은 이익입니다.",
    category: "fundamental"
  },
  {
    id: "operating_cash_flow",
    term: "영업현금흐름",
    aliases: ["영업현금흐름", "영업 현금흐름", "영업활동 현금흐름", "operating cash flow"],
    description: "회사의 주된 사업 활동에서 실제로 들어오고 나간 현금을 보여주는 값입니다.",
    category: "fundamental"
  },
  {
    id: "free_cash_flow",
    term: "잉여현금흐름",
    aliases: ["잉여현금흐름", "잉여 현금흐름", "FCF", "free cash flow"],
    description: "영업으로 번 현금에서 사업을 유지하고 늘리는 데 필요한 투자를 뺀 뒤 남은 현금입니다.",
    category: "fundamental"
  },
  {
    id: "gross_margin_percentile",
    term: "섹터 백분위",
    aliases: ["섹터 백분위", "백분위", "percentile"],
    description: "같은 섹터 기업들 사이에서 이 수치가 어느 위치인지 0~100으로 나타낸 값입니다. 상위 5%는 100개 중 5등 안이라는 뜻입니다.",
    category: "general"
  },
  {
    id: "debt_ratio",
    term: "부채비율",
    aliases: ["부채비율", "부채 비율", "debt ratio"],
    description: "부채를 자기자본과 비교한 값으로, 기업이 자본에 비해 어느 정도 부채를 사용하고 있는지 보여줍니다.",
    category: "fundamental"
  },
  {
    id: "eps",
    term: "EPS",
    aliases: ["EPS", "주당순이익", "earnings per share"],
    description: "기업의 순이익을 주식 수로 나눈 값으로, 주식 한 주가 벌어들인 이익을 뜻합니다.",
    category: "fundamental"
  },
  {
    id: "per",
    term: "PER",
    aliases: ["PER", "주가수익비율", "price earnings ratio"],
    description: "현재 주가가 주당순이익의 몇 배인지 보여주는 값으로, 이익에 비해 주가가 어느 수준인지 비교할 때 씁니다.",
    category: "fundamental"
  },
  {
    id: "pbr",
    term: "PBR",
    aliases: ["PBR", "주가순자산비율", "price to book ratio"],
    description: "현재 기업가치가 자기자본의 몇 배인지 보여주는 값입니다.",
    category: "fundamental"
  },
  {
    id: "psr",
    term: "PSR",
    aliases: ["PSR", "주가매출비율", "price to sales ratio"],
    description: "현재 기업가치가 연간 매출의 몇 배인지 보여주는 값입니다.",
    category: "fundamental"
  },
  {
    id: "fcf_yield",
    term: "FCF Yield",
    aliases: ["FCF Yield", "잉여현금흐름 수익률", "free cash flow yield"],
    description: "기업가치에 비해 잉여현금흐름이 얼마나 발생하는지 비율로 나타낸 값입니다.",
    category: "fundamental"
  },
  {
    id: "roa",
    term: "ROA",
    aliases: ["ROA", "총자산이익률", "return on assets"],
    description: "기업이 보유한 전체 자산을 사용해 얼마나 많은 이익을 냈는지 보여줍니다.",
    category: "fundamental"
  },
  {
    id: "roic",
    term: "ROIC",
    aliases: ["ROIC", "투하자본수익률", "return on invested capital"],
    description: "사업에 실제로 투입된 자본으로 얼마나 효율적으로 영업이익을 만들었는지 보여줍니다.",
    category: "fundamental"
  },
  {
    id: "sp500",
    term: "S&P 500",
    aliases: ["S&P 500", "S&P500"],
    description: "미국의 대표적인 대형 상장기업 500곳의 주가 흐름을 모아 보여주는 지수입니다.",
    category: "general"
  }
];

export const allGlossaryEntries: GlossaryEntry[] = [
  ...Object.values(stockGlossary),
  ...extraGlossary
];
