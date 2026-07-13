import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

type DecisionTab = "entry" | "exit" | "portfolio";

const PAGE_COUNT = 6;

export function AiInvestmentCoachPanel() {
  const [pageIndex, setPageIndex] = useState(0);
  const [decisionTab, setDecisionTab] = useState<DecisionTab>("entry");
  const [alerts, setAlerts] = useState<Record<string, boolean>>({
    chase: true,
    earnings: true,
    pullback: true,
    candidate: false
  });

  const setAlert = (id: string, enabled: boolean) => {
    setAlerts((current) => ({ ...current, [id]: enabled }));
  };

  const movePage = (delta: number) => {
    setPageIndex((current) => (current + delta + PAGE_COUNT) % PAGE_COUNT);
  };

  return (
    <section className="ai-coach-panel" aria-label="장후 AI 투자 코치">
      <header className="ai-coach-header">
        <div>
          <span>POST MARKET</span>
          <strong>AI 투자 코치</strong>
        </div>
        <b>{pageIndex + 1} / {PAGE_COUNT}</b>
      </header>

      <div className="ai-coach-page" key={pageIndex}>
        {pageIndex === 0 && <TodayTradeCoachPage onSetAlert={setAlert} />}
        {pageIndex === 1 && (
          <DecisionReportPage
            tab={decisionTab}
            onTabChange={setDecisionTab}
            onSetAlert={setAlert}
          />
        )}
        {pageIndex === 2 && <EffectiveConditionPage />}
        {pageIndex === 3 && <ImprovementConditionPage />}
        {pageIndex === 4 && (
          <RecommendedAlertPage
            active={alerts.candidate}
            onToggle={() => setAlert("candidate", !alerts.candidate)}
          />
        )}
        {pageIndex === 5 && (
          <WatchingAlertsPage alerts={alerts} onSetAlert={setAlert} />
        )}
      </div>

      <footer className="ai-coach-footer">
        <button type="button" onClick={() => movePage(-1)} title="이전 코칭" aria-label="이전 코칭">
          <ChevronLeft size={18} />
        </button>
        <div aria-label={`${pageIndex + 1}번째 코칭`}>
          {Array.from({ length: PAGE_COUNT }, (_, index) => (
            <button
              type="button"
              key={index}
              className={index === pageIndex ? "active" : ""}
              onClick={() => setPageIndex(index)}
              aria-label={`${index + 1}번째 코칭 보기`}
            />
          ))}
        </div>
        <button type="button" onClick={() => movePage(1)} title="다음 코칭" aria-label="다음 코칭">
          <ChevronRight size={18} />
        </button>
      </footer>
    </section>
  );
}

function PageTitle({ number, title, description }: { number: string; title: string; description?: string }) {
  return (
    <div className="ai-coach-page-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function TodayTradeCoachPage({ onSetAlert }: { onSetAlert: (id: string, enabled: boolean) => void }) {
  return (
    <>
      <PageTitle number="01" title="오늘 거래 코칭" />

      <section className="ai-coach-trade-row">
        <span className="ai-coach-symbol-avatar">NV</span>
        <div>
          <strong>NVDA 추가 매수</strong>
        </div>
        <b>+1.2%</b>
      </section>

      <div className="ai-coach-tags" aria-label="진입 당시 조건">
        <span>상승 추세 후반</span>
        <span>5일 +9.4%</span>
        <span>RSI 72</span>
        <span>실적 D-3</span>
      </div>

      <section className="ai-coach-similarity">
        <div className="ai-coach-similarity-head">
          <div>
            <strong>유사 거래 7건</strong>
            <p>수익 3 · 손실 4 · 현재 조건과 84% 유사</p>
          </div>
          <button type="button">차트 보기</button>
        </div>
        <SimilarTradeChart />
        <div className="ai-coach-chart-legend">
          <span className="today">오늘</span>
          <span className="past">과거 평균</span>
          <strong>진입 후 2일 평균 -3.1%</strong>
        </div>
      </section>

      <section className="ai-coach-outcome-review">
        <OutcomeReview
          tone="loss"
          title="손실 4건에서 반복한 실수"
          description="진입 직후 +2% 안팎의 반등이 있었지만 거래량 둔화를 무시했고, 지지 이탈 뒤에도 평균 2.6일 더 보유했습니다."
          result="평균 MAE -5.1%"
        />
        <OutcomeReview
          tone="profit"
          title="수익 3건에서 효과가 있었던 조건"
          description="시장과 반도체 업종이 함께 상승했고, 조정 뒤 상대 거래량이 회복된 구간에서는 목표 저항까지 분할 보유했습니다."
          result="평균 MFE +6.8%"
        />
      </section>

      <section className="ai-coach-impact">
        <h3>오늘 거래의 영향</h3>
        <div>
          <ImpactCell label="NVDA" value="12 → 18%" />
          <ImpactCell label="반도체" value="54 → 61%" />
          <ImpactCell label="현금" value="14 → 9%" />
        </div>
      </section>

      <section className="ai-coach-coaching-grid">
        <CoachFinding label="오늘 놓친 점" value="RSI 72와 실적 D-3는 확인했지만, 고점 부근 상대 거래량 둔화와 반도체 합산 비중 61%를 함께 보지 않았습니다." />
        <CoachFinding label="항상 가져갈 기준" value="시장·업종 동행, 상대 거래량 유지, 진입 무효화 가격을 한 세트로 확인합니다." />
        <CoachFinding label="현재 시장 추세" value="시장과 반도체 업종은 상승 중이지만 NVDA는 추세 후반이며 모멘텀 과열 구간에 가깝습니다." />
        <CoachFinding label="투자 후 볼 차트" value="일봉 EMA20, 상대 거래량, 실적 일정, 반도체 상관종목 합산 비중을 함께 봅니다." />
      </section>

      <section className="ai-coach-review-section">
        <h3>보유 판단 재검토</h3>
        <p>지금 팔라는 뜻이 아니라, 보유 판단이 달라지는 조건입니다.</p>
        <ReviewCondition title="추세 훼손" detail="$190.80 아래 일봉 마감" onClick={() => onSetAlert("trend-break", true)} />
        <ReviewCondition title="목표 구간" detail="다음 저항 $203~206 접근" onClick={() => onSetAlert("target-zone", true)} />
        <ReviewCondition title="이벤트" detail="실적 발표 전날까지 보유 결정" onClick={() => onSetAlert("event", true)} />
      </section>
    </>
  );
}

function SimilarTradeChart() {
  return (
    <svg className="ai-coach-mini-chart" viewBox="0 0 360 124" role="img" aria-label="오늘 거래와 과거 유사 거래 평균 비교">
      <g className="grid">
        <line x1="8" y1="24" x2="352" y2="24" />
        <line x1="8" y1="62" x2="352" y2="62" />
        <line x1="8" y1="100" x2="352" y2="100" />
      </g>
      <path className="today" d="M8 91 L40 82 L72 67 L104 48 L136 36 L168 49 L200 35 L232 41 L264 28 L296 34 L352 18" />
      <path className="past" d="M8 91 L40 81 L72 61 L104 43 L136 31 L168 45 L200 68 L232 87 L264 79 L296 95 L352 99" />
      <line className="entry" x1="168" y1="10" x2="168" y2="112" />
      <circle className="entry-point" cx="168" cy="49" r="5" />
      <text x="177" y="18">진입</text>
    </svg>
  );
}

function OutcomeReview({
  tone,
  title,
  description,
  result
}: {
  tone: "profit" | "loss";
  title: string;
  description: string;
  result: string;
}) {
  return (
    <article className={`ai-coach-outcome ${tone}`}>
      <div><strong>{title}</strong><em>{result}</em></div>
      <p>{description}</p>
    </article>
  );
}

function CoachFinding({ label, value }: { label: string; value: string }) {
  return <article><strong>{label}</strong><p>{value}</p></article>;
}

function ReviewCondition({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  const [added, setAdded] = useState(false);
  const handleClick = () => {
    setAdded(true);
    onClick();
  };
  return (
    <div className="ai-coach-review-row">
      <div><strong>{title}</strong><span>{detail}</span></div>
      <button type="button" className={added ? "active" : ""} onClick={handleClick}>
        {added ? <><Check size={14} /> 추가됨</> : "알람 추가"}
      </button>
    </div>
  );
}

function ImpactCell({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DecisionReportPage({
  tab,
  onTabChange,
  onSetAlert
}: {
  tab: DecisionTab;
  onTabChange: (tab: DecisionTab) => void;
  onSetAlert: (id: string, enabled: boolean) => void;
}) {
  return (
    <>
      <PageTitle number="02" title="판단 체크 리포트" description="무엇을 보고 결정했고, 무엇을 놓쳤는지 정리합니다." />
      <div className="ai-coach-tabs" role="tablist" aria-label="판단 영역">
        <button type="button" className={tab === "entry" ? "active" : ""} onClick={() => onTabChange("entry")}>진입</button>
        <button type="button" className={tab === "exit" ? "active" : ""} onClick={() => onTabChange("exit")}>청산</button>
        <button type="button" className={tab === "portfolio" ? "active" : ""} onClick={() => onTabChange("portfolio")}>포트폴리오</button>
      </div>
      {tab === "entry" && <EntryDecisionContent onSetAlert={onSetAlert} />}
      {tab === "exit" && <ExitDecisionContent onSetAlert={onSetAlert} />}
      {tab === "portfolio" && <PortfolioDecisionContent onSetAlert={onSetAlert} />}
    </>
  );
}

function EntryDecisionContent({ onSetAlert }: { onSetAlert: (id: string, enabled: boolean) => void }) {
  return (
    <DecisionBody
      period="최근 90일 · 24건"
      summary="상승을 확인한 뒤 진입하는 편입니다."
      detail="24회 매수 중 10회가 최근 5일 8% 이상 상승한 뒤 이루어졌습니다."
      behaviorTitle="반복한 행동"
      bars={[
        ["급등 후 진입", 43, "10회 · 43%"],
        ["조정 구간 진입", 31, "7회 · 31%"],
        ["횡보 돌파 진입", 18, "4회 · 18%"]
      ]}
      checked={[["추세·이동평균선", "19 / 24회"], ["지지·저항과 돌파", "17 / 24회"]]}
      missed={[
        ["실적 발표 일정", "24회 중 5회만 주문 전 확인", "미확인 거래 MAE -4.8%"],
        ["고점 부근 거래량 둔화", "추격 진입 10회 중 7회에서 발생", "평균 5일 -2.6%"]
      ]}
      alert="실적 D-3 + 거래량 둔화"
      chart="일봉 · EMA20 · 상대 거래량 · 실적 일정"
      onAdd={() => onSetAlert("earnings", true)}
    />
  );
}

function ExitDecisionContent({ onSetAlert }: { onSetAlert: (id: string, enabled: boolean) => void }) {
  return (
    <DecisionBody
      period="최근 90일 · 22건"
      summary="이익 거래는 빠르게, 손실 거래는 오래 보유했습니다."
      detail="수익 거래의 평균 보유 기간은 3.2일, 손실 거래는 11.4일이었습니다."
      behaviorTitle="반복한 행동"
      bars={[
        ["수익 3일 내 매도", 64, "9회 · 64%"],
        ["손실 10일 이상 보유", 63, "5회 · 63%"],
        ["분할 매도", 18, "4회 · 18%"]
      ]}
      checked={[["현재 손익률", "20 / 22회"], ["목표 가격", "10 / 22회"]]}
      missed={[
        ["추세 훼손 여부", "지지 이탈 후 평균 2.8일 추가 보유", "추가 손실 평균 -3.4%"],
        ["남아 있던 상승 여력", "수익 거래에서 MFE의 42%만 실현", "매도 후 평균 +4.6%"]
      ]}
      alert="지지 이탈 + 손실 보유 지속"
      chart="4시간봉 · EMA20/60 · 이전 저점 · 거래량"
      onAdd={() => onSetAlert("exit-loss", true)}
    />
  );
}

function PortfolioDecisionContent({ onSetAlert }: { onSetAlert: (id: string, enabled: boolean) => void }) {
  return (
    <DecisionBody
      period="최근 90일 · 31회"
      summary="개별 비중은 보지만 함께 움직이는 위험은 덜 확인했습니다."
      detail="31번의 비중 변경 중 17번에서 상위 두 종목의 합산 비중이 50%를 넘었습니다."
      behaviorTitle="반복한 행동"
      bars={[
        ["상위 2종목 50% 초과", 55, "17회 · 55%"],
        ["한 섹터 60% 초과", 39, "12회 · 39%"],
        ["현금 10% 미만", 26, "8회 · 26%"]
      ]}
      checked={[["개별 종목 비중", "23 / 31회"], ["섹터별 비중", "19 / 31회"]]}
      missed={[
        ["종목 간 상관관계", "31회 중 4회만 함께 확인", "변동성 평균 1.7배"],
        ["실적 일정 중첩", "같은 주에 실적 종목 3개 이상 6회", "일간 변동성 +38%"]
      ]}
      alert="상관 종목 합산 비중 45% 초과"
      chart="포트폴리오 상관행렬 · 섹터 비중 · 이벤트 캘린더"
      onAdd={() => onSetAlert("correlation", true)}
    />
  );
}

type DecisionBodyProps = {
  period: string;
  summary: string;
  detail: string;
  behaviorTitle: string;
  bars: [string, number, string][];
  checked: [string, string][];
  missed: [string, string, string][];
  alert: string;
  chart: string;
  onAdd: () => void;
};

function DecisionBody({ period, summary, detail, behaviorTitle, bars, checked, missed, alert, chart, onAdd }: DecisionBodyProps) {
  const [added, setAdded] = useState(false);
  return (
    <div className="ai-coach-decision-body">
      <p className="ai-coach-period">{period}</p>
      <strong className="ai-coach-summary">{summary}</strong>
      <p className="ai-coach-detail">{detail}</p>

      <section className="ai-coach-bar-list">
        <h3>{behaviorTitle}</h3>
        {bars.map(([label, value, count]) => <MetricBar key={label} label={label} value={value} count={count} />)}
      </section>

      <section className="ai-coach-data-section">
        <h3>실제로 확인한 기준</h3>
        {checked.map(([label, value]) => <DataLine key={label} label={label} value={value} />)}
      </section>

      <section className="ai-coach-data-section missed">
        <h3>놓쳤을 가능성이 높은 기준</h3>
        {missed.map(([title, description, result]) => (
          <div className="ai-coach-missed-row" key={title}>
            <div><strong>{title}</strong><span>{description}</span></div>
            <em>{result}</em>
          </div>
        ))}
      </section>

      <div className="ai-coach-alert-action">
        <div><span>보완할 알람</span><strong>{alert}</strong></div>
        <button
          type="button"
          className={added ? "active" : ""}
          onClick={() => { setAdded(true); onAdd(); }}
        >
          {added ? <><Check size={14} /> 추가됨</> : "알람 추가"}
        </button>
      </div>
      <div className="ai-coach-next-condition"><span>다음에 볼 차트 조건</span><strong>{chart}</strong></div>
    </div>
  );
}

function EffectiveConditionPage() {
  return (
    <>
      <PageTitle number="03" title="효과가 있었던 조건" description="앞으로 다시 참고할 수 있는 판단 조합입니다." />
      <EffectiveConditionChart />
      <section className="ai-coach-condition-table">
        <DataLine label="유사 거래" value="8회" />
        <DataLine label="평균 MAE" value="-1.1%" />
        <DataLine label="10일 평균" value="+6.4%" />
        <DataLine label="조건" value="EMA 조정 + 거래량 회복" />
      </section>
      <aside className="ai-coach-note">추세가 유지되는 조정 구간에서 거래량 회복을 확인한 진입이 가장 안정적이었습니다.</aside>
    </>
  );
}

function EffectiveConditionChart() {
  return (
    <svg className="ai-coach-effect-chart" viewBox="0 0 360 196" role="img" aria-label="효과가 있었던 거래 조건">
      <g className="grid"><line x1="14" y1="36" x2="348" y2="36" /><line x1="14" y1="93" x2="348" y2="93" /><line x1="14" y1="150" x2="348" y2="150" /></g>
      <path className="actual" d="M14 164 L54 143 L86 154 L124 106 L158 79 L192 98 L224 73 L258 88 L292 45 L324 55 L348 30" />
      <path className="trend" d="M14 147 C86 137 123 119 190 96 S286 69 348 50" />
      <circle cx="192" cy="98" r="7" />
    </svg>
  );
}

function ImprovementConditionPage() {
  return (
    <>
      <PageTitle number="04" title="보완할 판단 조건" description="결과와 별개로 다음 거래에서 추가 확인할 항목입니다." />
      <section className="ai-coach-observation">
        <span>반복 관찰</span>
        <strong>급등 후 거래량 둔화</strong>
        <em>유사 거래 6회 중 4회 손실</em>
      </section>
      <section className="ai-coach-condition-table">
        <DataLine label="최근 3거래일 상승률" value="+8% 이상" />
        <DataLine label="RSI" value="70 이상" />
        <DataLine label="상대 거래량" value="고점 대비 감소" />
        <DataLine label="평균 MAE" value="-5.2%" />
      </section>
      <aside className="ai-coach-note">추세를 확인하는 기준에 거래량 둔화와 진입 전 상승 폭을 함께 추가하는 편이 좋습니다.</aside>
    </>
  );
}

function RecommendedAlertPage({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <>
      <PageTitle number="05" title="추천 알람" description="발견한 판단 기준을 사용자가 승인하면 실제 감시 규칙이 됩니다." />
      <section className="ai-coach-alert-candidate">
        <div className="ai-coach-alert-kicker"><span>주문 전</span><strong>추격 매수 확인</strong></div>
        <p>단기 급등과 거래량 둔화가 함께 나타난 상태에서 매수를 준비하면 알려줍니다.</p>
        <ul><li>3일 상승률 8% 이상</li><li>RSI 70 이상</li><li>상대 거래량 감소</li></ul>
      </section>
      <div className="ai-coach-candidate-actions">
        <button type="button">조건 수정</button>
        <button type="button" className="primary" onClick={onToggle}>{active ? "추가됨" : "알람 추가"}</button>
      </div>
      <p className="ai-coach-registration-state">{active ? "감시 규칙에 등록되었습니다." : "아직 등록되지 않았습니다."}</p>
    </>
  );
}

function WatchingAlertsPage({ alerts, onSetAlert }: { alerts: Record<string, boolean>; onSetAlert: (id: string, enabled: boolean) => void }) {
  const rules = [
    { id: "chase", title: "추격 매수 확인", detail: "주문 전 · 종목별 하루 1회" },
    { id: "earnings", title: "실적 전 비중 확대", detail: "체결 직후 · 3거래일 이내" },
    { id: "pullback", title: "EMA 조정 + 거래량 회복", detail: "보유·관심종목 · 장중" }
  ];
  return (
    <>
      <PageTitle number="06" title="주시 중인 알람" description="승인한 규칙과 최근 발생 여부를 확인합니다." />
      <section className="ai-coach-active-rules">
        {rules.map((rule) => (
          <button type="button" key={rule.id} onClick={() => onSetAlert(rule.id, !alerts[rule.id])}>
            <i className={alerts[rule.id] ? "active" : ""} />
            <span><strong>{rule.title}</strong><em>{rule.detail}</em></span>
            <b>{alerts[rule.id] ? "ON" : "OFF"}</b>
          </button>
        ))}
      </section>
      <aside className="ai-coach-recent-alert">
        <span>최근 알림</span>
        <strong>반도체 비중이 61%에 도달했습니다.</strong>
        <p>오늘 15:42 · 체결 직후</p>
      </aside>
      <aside className="ai-coach-note">동일 종목과 동일 조건은 cooldown 동안 다시 알리지 않습니다.</aside>
    </>
  );
}

function MetricBar({ label, value, count }: { label: string; value: number; count: string }) {
  return (
    <div className="ai-coach-metric-bar">
      <span>{label}</span>
      <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
      <em>{count}</em>
    </div>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return <div className="ai-coach-data-line"><span>{label}</span><strong>{value}</strong></div>;
}
