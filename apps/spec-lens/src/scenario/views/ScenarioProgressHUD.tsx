import { useScenario } from '../contexts/ScenarioContext.js'
import { Badge } from '../../components/Badge.js'

export function ScenarioProgressHUD() {
  const {
    activeScenario,
    machineState,
    canStepBack,
    stepBack,
    availableGoals,
    completeGoal,
    openFlowModal,
    resetScenario,
  } = useScenario()

  if (!activeScenario) return null

  const currentStep = machineState.breadcrumbs.length
  const isGoalCompleted = activeScenario.terminalGoals.some((g) =>
    machineState.completedGoals.includes(g.id),
  )

  return (
    <aside
      aria-label="Scenario Progress Rail"
      style={{
        background: 'linear-gradient(90deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexShrink: 0,
        zIndex: 50,
      }}
    >
      {/* Left: Persona, Title, Current Step */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Badge variant="blue">{activeScenario.persona}</Badge>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
          {activeScenario.title}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>|</span>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Step {currentStep}: <strong style={{ color: 'var(--text-primary)' }}>{machineState.currentView}</strong>
        </span>

        {isGoalCompleted && (
          <Badge variant="green">✓ 완료 목표 달성</Badge>
        )}
      </div>

      {/* Center/Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Terminal Goal Completion CTA if available and not yet completed */}
        {availableGoals.map((goal) => {
          const completed = machineState.completedGoals.includes(goal.id)
          return (
            <button
              key={goal.id}
              type="button"
              onClick={() => completeGoal(goal.id)}
              disabled={completed}
              className={`btn ${completed ? 'btn-secondary' : 'btn-primary'}`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: completed ? 'default' : 'pointer',
              }}
            >
              <span>{completed ? '✓' : '🎯'}</span>
              <span>{goal.description}</span>
            </button>
          )
        })}

        {/* Step Back button */}
        <button
          type="button"
          onClick={stepBack}
          disabled={!canStepBack}
          className="btn btn-secondary"
          title="이전 시나리오 단계로 되돌아갑니다"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            opacity: canStepBack ? 1 : 0.5,
            cursor: canStepBack ? 'pointer' : 'not-allowed',
          }}
        >
          ← 이전 단계
        </button>

        {/* View Flow Chart modal button */}
        <button
          type="button"
          onClick={openFlowModal}
          className="btn btn-secondary"
          title="시나리오 전체 FSM 흐름도 및 전이 행렬 확인"
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          흐름도 보기
        </button>

        {/* Exit Scenario button */}
        <button
          type="button"
          onClick={resetScenario}
          className="btn btn-ghost"
          title="시나리오 모드를 종료하고 자유 탐색으로 복귀합니다"
          style={{
            padding: '4px 8px',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          ✕ 종료
        </button>
      </div>
    </aside>
  )
}
