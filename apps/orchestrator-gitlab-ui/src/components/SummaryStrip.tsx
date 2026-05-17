import type { PipelineState, PipelineRun } from '../data/dashboard.js'

export interface SummaryStripMetric {
  id: string
  label: string
  value: string | number
  detail: string
}

export interface SummaryStripProps {
  metrics: SummaryStripMetric[]
  pipelines: PipelineRun[]
  pipelineStatesLabel: string
}

function statusCount(runs: PipelineRun[], match: PipelineState) {
  return runs.filter(run => run.state === match).length
}

function statusLabel(state: PipelineState): string {
  if (state === 'running') return 'running'
  if (state === 'scheduled') return 'scheduled'
  if (state === 'failed') return 'failed'
  if (state === 'blocked') return 'blocked'
  return 'success'
}

function statusClass(state: PipelineState): string {
  if (state === 'running') return 'status status-running'
  if (state === 'scheduled') return 'status status-scheduled'
  if (state === 'failed') return 'status status-failed'
  if (state === 'blocked') return 'status status-blocked'
  return 'status status-success'
}

const allPipelineStates: PipelineState[] = ['running', 'scheduled', 'failed', 'blocked', 'success']

export function SummaryStrip({ metrics, pipelineStatesLabel, pipelines }: SummaryStripProps) {
  return (
    <section className="summary-strip" aria-label="summary-strip">
      {metrics.map(metric => (
        <article className="summary-strip-item" key={metric.id}>
          <p className="summary-strip-label">{metric.label}</p>
          <p className="summary-strip-value">{metric.value}</p>
          <p className="summary-strip-sub">{metric.detail}</p>
        </article>
      ))}
      <article className="summary-strip-item summary-strip-status">
        <p className="summary-strip-label">{pipelineStatesLabel}</p>
        <div className="summary-strip-bands">
          {allPipelineStates.map(state => (
            <span className={statusClass(state)} key={state}>
              {statusLabel(state)} {statusCount(pipelines, state)}
            </span>
          ))}
        </div>
      </article>
    </section>
  )
}
