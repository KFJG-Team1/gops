export type GlossaryCategory = "indicator" | "structure" | "volume" | "pattern" | "candle" | "general";

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
  | "market_structure" | "impulse" | "pullback" | "fibonacci_retracement" | "week_52_high"
  | "week_52_low" | "reversal"
  | "volume" | "dollar_volume" | "volume_profile" | "poc" | "value_area" | "vah" | "val"
  | "hvn" | "lvn" | "volume_spike" | "relative_volume"
  | "double_bottom" | "double_top" | "head_and_shoulders" | "triangle" | "wedge" | "flag_pattern"
  | "candlestick" | "ohlc" | "closed_bar" | "daily" | "weekly" | "monthly" | "wick"
  | "bullish_candle" | "bearish_candle"
  | "long_bullish_candle" | "long_bearish_candle"
  | "volatility" | "regime" | "trend" | "uptrend" | "downtrend" | "invalidation"
  | "confidence" | "liquidity"
  | "touch_episode" | "consensus" | "current_relevance" | "failed_breakout"
  | "confirmation_condition" | "timeframe_alignment" | "counter_evidence" | "data_coverage";

const entry = (
  id: RequiredGlossaryId,
  term: string,
  aliases: string[],
  description: string,
  category: GlossaryCategory
): GlossaryEntry => ({ id, term, aliases, description, category });

export const stockGlossary: Record<RequiredGlossaryId, GlossaryEntry> = {
  moving_average: entry("moving_average", "이동평균선", ["이동평균선", "이동평균", "MA", "moving average"], "일정 기간 가격의 평균을 이은 선으로, 가격의 방향과 평균 회귀 여부를 살필 때 봅니다.", "indicator"),
  sma: entry("sma", "SMA", ["SMA", "단순이동평균", "simple moving average"], "기간 안의 가격에 같은 비중을 둔 이동평균으로, 기본 추세 기준을 비교할 때 사용합니다.", "indicator"),
  ema: entry("ema", "EMA", ["EMA", "지수이동평균", "exponential moving average"], "최근 가격에 더 큰 비중을 둔 이동평균으로, 변화에 빠르게 반응하는 추세를 봅니다.", "indicator"),
  wma: entry("wma", "WMA", ["WMA", "가중이동평균", "weighted moving average"], "시점별로 다른 비중을 적용한 이동평균으로, 최근 흐름을 강조해 볼 때 사용합니다.", "indicator"),
  golden_cross: entry("golden_cross", "골든크로스", ["골든크로스", "golden cross"], "단기 평균선이 장기 평균선을 위로 지나는 현상으로, 추세 변화 후보를 확인할 때 봅니다.", "indicator"),
  dead_cross: entry("dead_cross", "데드크로스", ["데드크로스", "데스크로스", "dead cross"], "단기 평균선이 장기 평균선을 아래로 지나는 현상으로, 약세 전환 후보를 확인할 때 봅니다.", "indicator"),
  rsi: entry("rsi", "RSI", ["RSI", "상대강도지수", "relative strength index"], "최근 상승·하락 폭을 비교한 0~100 지표로, 과열이나 침체 정도를 살필 때 봅니다.", "indicator"),
  macd: entry("macd", "MACD", ["MACD", "moving average convergence divergence"], "두 지수이동평균의 차이와 신호선을 비교해 추세와 모멘텀 변화를 살피는 지표입니다.", "indicator"),
  signal_line: entry("signal_line", "시그널선", ["시그널선", "신호선", "signal line"], "MACD 같은 지표를 다시 평균 낸 선으로, 교차를 통해 변화 시점을 보조 확인합니다.", "indicator"),
  stochastic: entry("stochastic", "스토캐스틱", ["스토캐스틱", "stochastic", "stochastic oscillator"], "최근 범위에서 종가 위치를 나타내는 지표로, 과매수·과매도와 반전 후보를 봅니다.", "indicator"),
  bollinger_bands: entry("bollinger_bands", "볼린저 밴드", ["볼린저 밴드", "볼린저밴드", "Bollinger Bands", "BB"], "이동평균 주위에 변동성 폭을 표시한 밴드로, 가격 범위와 수축·확장을 살필 때 봅니다.", "indicator"),
  band_walk: entry("band_walk", "밴드워크", ["밴드워크", "band walk"], "가격이 볼린저 밴드 한쪽 경계를 따라 움직이는 현상으로, 강한 추세 지속 여부를 봅니다.", "indicator"),
  squeeze: entry("squeeze", "스퀴즈", ["스퀴즈", "변동성 수축", "squeeze", "volatility contraction"], "가격 변동 폭이 좁아진 상태로, 이후 변동성 확대 가능성을 준비해 관찰할 때 봅니다.", "indicator"),
  vwap: entry("vwap", "VWAP", ["VWAP", "거래량가중평균가격", "volume weighted average price"], "가격을 거래량으로 가중한 평균으로, 시장 참여자의 평균 체결 가격을 가늠할 때 봅니다.", "indicator"),
  atr: entry("atr", "ATR", ["ATR", "평균진폭", "average true range"], "갭을 포함한 실제 가격 범위의 평균으로, 방향이 아닌 변동성 크기를 측정합니다.", "indicator"),
  divergence: entry("divergence", "다이버전스", ["다이버전스", "divergence"], "가격과 지표가 서로 다른 방향을 보이는 현상으로, 모멘텀 변화 가능성을 확인할 때 봅니다.", "indicator"),
  overbought: entry("overbought", "과매수", ["과매수", "overbought"], "최근 매수 강도가 상대적으로 높았던 상태로, 추세 지속과 되돌림 가능성을 함께 살핍니다.", "indicator"),
  oversold: entry("oversold", "과매도", ["과매도", "oversold"], "최근 매도 강도가 상대적으로 높았던 상태로, 추세 지속과 반등 가능성을 함께 살핍니다.", "indicator"),
  momentum: entry("momentum", "모멘텀", ["모멘텀", "momentum"], "가격 움직임의 속도와 힘을 뜻하며, 현재 흐름이 강해지는지 약해지는지 볼 때 씁니다.", "indicator"),

  support: entry("support", "지지선", ["지지선", "지지", "support", "support level"], "가격 하락이 반복해 멈춘 구간으로, 매수 반응과 하향 이탈 여부를 관찰할 때 봅니다.", "structure"),
  resistance: entry("resistance", "저항선", ["저항선", "저항", "resistance", "resistance level"], "가격 상승이 반복해 막힌 구간으로, 매도 반응과 상향 돌파 여부를 관찰할 때 봅니다.", "structure"),
  role_flip: entry("role_flip", "지지·저항 전환", ["지지·저항 전환", "지지 저항 전환", "role flip", "support resistance flip"], "돌파 뒤 저항이 지지로, 또는 지지가 저항으로 바뀌는 현상으로 리테스트에서 확인합니다.", "structure"),
  trendline: entry("trendline", "추세선", ["추세선", "trendline", "trend line"], "연속된 고점이나 저점을 이은 선으로, 추세 방향과 이탈 여부를 살필 때 봅니다.", "structure"),
  channel: entry("channel", "채널", ["채널", "channel", "price channel"], "대체로 평행한 두 경계 안에서 가격이 움직이는 구조로, 추세 범위와 경계 반응을 봅니다.", "structure"),
  range: entry("range", "횡보", ["횡보", "박스권", "range", "sideways"], "뚜렷한 방향 없이 일정 상·하단 사이를 오가는 국면으로, 경계 돌파 여부를 봅니다.", "structure"),
  breakout: entry("breakout", "돌파", ["돌파", "breakout"], "가격이 저항이나 범위 상단을 넘어선 움직임으로, 종가 확정과 거래량을 함께 확인합니다.", "structure"),
  breakdown: entry("breakdown", "하향 이탈", ["하향 이탈", "하방 이탈", "breakdown"], "가격이 지지나 범위 하단 아래로 내려간 움직임으로, 종가 확정과 후속 반응을 확인합니다.", "structure"),
  retest: entry("retest", "리테스트", ["리테스트", "retest"], "돌파한 가격대를 다시 확인하는 움직임으로, 이전 경계가 새 역할을 하는지 살필 때 봅니다.", "structure"),
  gap: entry("gap", "갭", ["갭", "gap", "price gap"], "이전 봉 범위와 다음 봉 범위 사이에 거래되지 않은 가격 구간이 생긴 현상입니다.", "structure"),
  swing_high: entry("swing_high", "스윙 고점", ["스윙 고점", "swing high"], "주변 봉보다 높은 국소 고점으로, 추세 구조와 저항 후보를 정할 때 사용합니다.", "structure"),
  swing_low: entry("swing_low", "스윙 저점", ["스윙 저점", "swing low"], "주변 봉보다 낮은 국소 저점으로, 추세 구조와 지지 후보를 정할 때 사용합니다.", "structure"),
  pivot: entry("pivot", "피벗", ["피벗", "pivot", "pivot point"], "가격 방향이 국소적으로 바뀐 기준점으로, 고점·저점 구조와 선의 앵커를 잡을 때 씁니다.", "structure"),
  market_structure: entry("market_structure", "고점·저점 갱신", ["고점·저점 갱신", "고점 저점 갱신", "HH", "HL", "LH", "LL", "market structure"], "고점과 저점의 상승·하락 순서를 비교해 추세 구조가 유지되는지 살피는 방법입니다.", "structure"),
  impulse: entry("impulse", "임펄스", ["임펄스", "impulse", "impulse move"], "한 방향으로 빠르고 강하게 진행된 가격 움직임으로, 이후 조정의 기준 구간을 잡을 때 봅니다.", "structure"),
  pullback: entry("pullback", "되돌림", ["되돌림", "조정", "pullback", "retracement"], "주된 추세와 반대 방향으로 잠시 움직이는 구간으로, 추세 재개 여부를 확인할 때 봅니다.", "structure"),
  fibonacci_retracement: entry("fibonacci_retracement", "피보나치 되돌림", ["피보나치 되돌림", "Fibonacci retracement", "fib retracement"], "주요 움직임을 비율로 나눈 되돌림 기준으로, 잠재 반응 구간을 비교할 때 사용합니다.", "structure"),
  week_52_high: entry("week_52_high", "52주 신고가", ["52주 신고가", "52-week high", "52 week high"], "최근 52주 중 가장 높은 가격을 새로 기록한 상태로, 장기 범위 돌파 여부를 봅니다.", "structure"),
  week_52_low: entry("week_52_low", "52주 신저가", ["52주 신저가", "52-week low", "52 week low"], "최근 52주 중 가장 낮은 가격을 새로 기록한 상태로, 장기 범위 이탈 여부를 봅니다.", "structure"),
  reversal: entry("reversal", "추세 전환", ["추세 전환", "반전", "reversal", "trend reversal"], "기존 가격 방향이 반대로 바뀌는 과정으로, 구조·거래량·확정봉을 함께 확인합니다.", "structure"),
  touch_episode: entry("touch_episode", "접점", ["접점", "touch episode"], "가격이 선이나 구간에 닿은 연속 구간을 한 번의 독립 반응으로 묶은 근거입니다.", "structure"),
  consensus: entry("consensus", "컨센서스", ["컨센서스", "consensus"], "서로 다른 여러 기준점이 같은 구조를 지지하는 정도입니다.", "structure"),
  current_relevance: entry("current_relevance", "현재 관련성", ["현재 관련성", "current relevance"], "과거 구조가 현재 가격이나 최근 사건과 충분히 가까워 지금도 관찰 가치가 있는지를 뜻합니다.", "structure"),
  failed_breakout: entry("failed_breakout", "실패한 돌파", ["실패한 돌파", "failed breakout"], "경계를 넘었지만 후속 종가가 유지되지 못하고 다시 구조 안으로 돌아온 상태입니다.", "structure"),
  confirmation_condition: entry("confirmation_condition", "확인 조건", ["확인 조건", "confirmation condition"], "현재 해석이 강화됐다고 판단하기 위해 다음 확정봉에서 관찰할 객관적 조건입니다.", "general"),
  timeframe_alignment: entry("timeframe_alignment", "상위 주기 정합", ["상위 주기 정합", "timeframe alignment"], "일봉·주봉·월봉처럼 서로 다른 주기의 구조가 같은 방향의 근거를 보이는 상태입니다.", "general"),
  counter_evidence: entry("counter_evidence", "반대 근거", ["반대 근거", "counter evidence"], "주요 해석과 반대되는 가격·모멘텀·거래 참여 증거입니다.", "general"),
  data_coverage: entry("data_coverage", "데이터 커버리지", ["데이터 커버리지", "data coverage"], "분석에 필요한 확정봉 중 실제로 연속 확보된 비율과 결측 정도입니다.", "general"),

  volume: entry("volume", "거래량", ["거래량", "volume", "trading volume"], "일정 기간 체결된 수량으로, 가격 움직임에 참여가 얼마나 실렸는지 살필 때 봅니다.", "volume"),
  dollar_volume: entry("dollar_volume", "거래대금", ["거래대금", "dollar volume", "traded value"], "체결 가격과 수량을 곱한 규모로, 실제 거래 활동과 유동성 수준을 비교할 때 봅니다.", "volume"),
  volume_profile: entry("volume_profile", "매물대", ["매물대", "거래량 프로파일", "volume profile"], "가격대별 누적 거래량 분포로, 거래가 집중된 지지·저항 후보를 살필 때 봅니다.", "volume"),
  poc: entry("poc", "POC", ["POC", "Point of Control"], "매물대에서 거래량이 가장 많이 쌓인 가격대로, 시장의 주요 합의 가격을 가늠합니다.", "volume"),
  value_area: entry("value_area", "밸류 에어리어", ["밸류 에어리어", "가치 영역", "Value Area"], "매물대 거래량의 대부분이 포함되는 가격 범위로, 중심 거래 구간을 보여줍니다.", "volume"),
  vah: entry("vah", "VAH", ["VAH", "Value Area High"], "밸류 에어리어의 상단 가격으로, 중심 거래 구간 위쪽 경계 반응을 볼 때 사용합니다.", "volume"),
  val: entry("val", "VAL", ["VAL", "Value Area Low"], "밸류 에어리어의 하단 가격으로, 중심 거래 구간 아래쪽 경계 반응을 볼 때 사용합니다.", "volume"),
  hvn: entry("hvn", "HVN", ["HVN", "High Volume Node"], "주변보다 거래량이 많이 쌓인 가격대로, 가격이 머물거나 반응할 가능성을 살핍니다.", "volume"),
  lvn: entry("lvn", "LVN", ["LVN", "Low Volume Node"], "주변보다 거래량이 적게 쌓인 가격대로, 가격이 빠르게 통과할 수 있는 구간을 살핍니다.", "volume"),
  volume_spike: entry("volume_spike", "거래량 급증", ["거래량 급증", "volume spike"], "평소보다 거래량이 크게 늘어난 현상으로, 돌파나 이벤트의 참여 강도를 확인할 때 봅니다.", "volume"),
  relative_volume: entry("relative_volume", "상대 거래량", ["상대 거래량", "RVOL", "relative volume"], "현재 거래량을 평소 같은 조건과 비교한 값으로, 거래 활동의 이례성을 살필 때 봅니다.", "volume"),

  double_bottom: entry("double_bottom", "이중 바닥", ["이중 바닥", "쌍바닥", "double bottom"], "비슷한 저점을 두 차례 확인한 형태로, 지지 확인과 반전 가능성을 살필 때 봅니다.", "pattern"),
  double_top: entry("double_top", "이중 천장", ["이중 천장", "쌍봉", "double top"], "비슷한 고점을 두 차례 확인한 형태로, 저항 확인과 반전 가능성을 살필 때 봅니다.", "pattern"),
  head_and_shoulders: entry("head_and_shoulders", "헤드앤숄더", ["헤드앤숄더", "머리어깨형", "head and shoulders"], "가운데 고점이 더 높은 세 봉우리 형태로, 목선 이탈과 추세 변화 후보를 살핍니다.", "pattern"),
  triangle: entry("triangle", "삼각 수렴", ["삼각 수렴", "삼각형", "triangle", "triangle pattern"], "고점과 저점 간격이 좁아지는 형태로, 수렴 뒤 어느 방향으로 이탈하는지 봅니다.", "pattern"),
  wedge: entry("wedge", "쐐기형", ["쐐기형", "쐐기", "wedge", "wedge pattern"], "두 경계가 같은 방향으로 기울며 좁아지는 형태로, 경계 이탈을 확인할 때 봅니다.", "pattern"),
  flag_pattern: entry("flag_pattern", "깃발형", ["깃발형", "플래그 패턴", "flag pattern"], "급한 움직임 뒤 짧은 평행 조정 형태입니다. 차트의 이벤트 Flag 마커와는 다른 패턴 개념입니다.", "pattern"),

  candlestick: entry("candlestick", "캔들", ["캔들", "candlestick", "candle"], "한 기간의 시가·고가·저가·종가를 몸통과 꼬리로 나타낸 가격 표시 방식입니다.", "candle"),
  ohlc: entry("ohlc", "OHLC", ["OHLC", "시가·고가·저가·종가", "open high low close"], "한 기간의 시가·고가·저가·종가 네 가격으로, 캔들의 범위와 방향을 구성합니다.", "candle"),
  closed_bar: entry("closed_bar", "확정봉", ["확정봉", "마감봉", "closed bar", "closed candle"], "해당 기간이 끝나 값이 더 바뀌지 않는 봉으로, 신호 확인은 보통 확정봉을 기준으로 합니다.", "candle"),
  daily: entry("daily", "일봉", ["일봉", "daily", "daily candle"], "하루의 가격 움직임을 한 봉으로 묶은 주기로, 중기 흐름과 일별 구조를 볼 때 씁니다.", "candle"),
  weekly: entry("weekly", "주봉", ["주봉", "weekly", "weekly candle"], "한 주의 가격 움직임을 한 봉으로 묶은 주기로, 더 큰 추세와 장기 레벨을 봅니다.", "candle"),
  monthly: entry("monthly", "월봉", ["월봉", "monthly", "monthly candle"], "한 달의 가격 움직임을 한 봉으로 묶은 주기로, 장기 구조와 거시 추세를 봅니다.", "candle"),
  wick: entry("wick", "꼬리", ["꼬리", "윗꼬리", "아랫꼬리", "wick", "shadow"], "캔들 몸통 밖의 고가·저가 구간으로, 장중 가격 거부나 변동 범위를 살필 때 봅니다.", "candle"),
  bullish_candle: entry("bullish_candle", "양봉", ["양봉", "bullish candle"], "종가가 시가보다 높은 캔들로, 해당 기간에 가격이 상승 마감했음을 나타냅니다.", "candle"),
  bearish_candle: entry("bearish_candle", "음봉", ["음봉", "bearish candle"], "종가가 시가보다 낮은 캔들로, 해당 기간에 가격이 하락 마감했음을 나타냅니다.", "candle"),
  long_bullish_candle: entry("long_bullish_candle", "장대양봉", ["장대양봉", "long bullish candle"], "몸통이 평소보다 큰 상승 캔들로, 강한 매수 움직임이 나온 구간을 표시합니다.", "candle"),
  long_bearish_candle: entry("long_bearish_candle", "장대음봉", ["장대음봉", "long bearish candle"], "몸통이 평소보다 큰 하락 캔들로, 강한 매도 움직임이 나온 구간을 표시합니다.", "candle"),

  volatility: entry("volatility", "변동성", ["변동성", "volatility"], "가격이 움직이는 폭과 속도의 정도로, 예상 범위와 위험 수준을 가늠할 때 봅니다.", "general"),
  regime: entry("regime", "국면", ["국면", "레짐", "regime", "market regime"], "추세·횡보·고변동성처럼 시장을 구분한 상태로, 같은 신호의 맥락을 해석할 때 씁니다.", "general"),
  trend: entry("trend", "추세", ["추세", "trend"], "가격이 일정 기간 대체로 향하는 방향으로, 고점·저점과 평균선 등을 함께 살펴 판단합니다.", "general"),
  uptrend: entry("uptrend", "상승 추세", ["상승 추세", "상승추세", "uptrend"], "고점과 저점이 대체로 높아지는 흐름으로, 구조 유지와 지지 반응을 확인합니다.", "general"),
  downtrend: entry("downtrend", "하락 추세", ["하락 추세", "하락추세", "downtrend"], "고점과 저점이 대체로 낮아지는 흐름으로, 구조 유지와 저항 반응을 확인합니다.", "general"),
  invalidation: entry("invalidation", "무효화 조건", ["무효화 조건", "무효화", "invalidation", "invalidation condition"], "현재 해석이 더는 유효하지 않다고 보는 가격·종가 조건으로, 시나리오 경계를 명확히 합니다.", "general"),
  confidence: entry("confidence", "신뢰도", ["신뢰도", "confidence"], "분석 근거의 일치 정도를 요약한 값으로, 결과의 확실성을 보장하지는 않습니다.", "general"),
  liquidity: entry("liquidity", "유동성", ["유동성", "liquidity"], "원하는 가격 근처에서 큰 가격 충격 없이 거래할 수 있는 정도로, 체결 여건을 가늠합니다.", "general")
};

export const extraGlossary: GlossaryEntry[] = [];

export const allGlossaryEntries: GlossaryEntry[] = [
  ...Object.values(stockGlossary),
  ...extraGlossary
];
