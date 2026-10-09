import { useScenario } from '../contexts/ScenarioContext.js'
import type { ScenarioTopicId } from '@oa-sdk/spec-lens-contract'

export function ScenarioSelector() {
  const { registry, activeScenario, startScenario, resetScenario } = useScenario()
  const allScenarios = registry.getAll()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <label
        htmlFor="scenario-select"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        시나리오:
      </label>
      <select
        id="scenario-select"
        value={activeScenario?.id ?? ''}
        onChange={(e) => {
          const val = e.target.value
          if (!val) {
            resetScenario()
          } else {
            startScenario(val as ScenarioTopicId)
          }
        }}
        style={{
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: 'var(--text-xs)',
          outline: 'none',
          cursor: 'pointer',
          maxWidth: '100%',
        }}
      >
        <option value="">🌐 자유 탐색 (Free Mode)</option>
        {allScenarios.map((s) => (
          <option key={s.id} value={s.id}>
            🎯 {s.title} ({s.persona})
          </option>
        ))}
      </select>
    </div>
  )
}
