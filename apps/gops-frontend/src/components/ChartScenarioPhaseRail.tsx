import type { TradeScenarioPresentation } from "../chart/tradeScenarioPresentation";

const steps = ["형성", "돌파 확인", "리테스트", "분할 대응"] as const;

export function ChartScenarioPhaseRail({ scenario }: { scenario: TradeScenarioPresentation | null }) {
  if (!scenario?.available || !scenario.phase) return null;
  const currentIndex = scenario.phaseIndex;
  return (
    <nav className="chart-scenario-phase-rail" aria-label="작도 대응 단계">
      <ol>
        {steps.map((step, index) => (
          <li
            key={step}
            className={index < currentIndex ? "is-complete" : index === currentIndex ? "is-current" : "is-pending"}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>
    </nav>
  );
}
