import {
  type ContextSearchHit,
  contextSearchResults,
  searchCapabilityClass,
} from '../data/dashboard.js'
import { ContextSearchResults } from '../components/ContextSearchResults.js'
import { translate, type Locale } from '../i18n/index.js'
import { commonContextLabels } from './OverviewPage.js'

interface ContextCount {
  projects: Record<string, number>
  averageConfidence: number
}

function computeContextCount(results: readonly ContextSearchHit[]): ContextCount {
  const projects: Record<string, number> = {}
  if (results.length === 0) {
    return { projects, averageConfidence: 0 }
  }

  for (const result of results) {
    projects[result.project] = (projects[result.project] ?? 0) + 1
  }

  const averageConfidence = results.reduce((acc, result) => acc + result.confidence, 0) / results.length
  return { projects, averageConfidence }
}

function projectCountEntries(projects: Record<string, number>): Array<{ project: string; total: number }> {
  return Object.entries(projects)
    .map(([project, total]) => ({ project, total }))
    .sort((left, right) => right.total - left.total)
}

const { projects, averageConfidence } = computeContextCount(contextSearchResults)
const projectContextSummary = projectCountEntries(projects)

export function ContextPage({ locale }: { locale: Locale }) {
  const contextLabels = commonContextLabels(locale)

  return (
    <>
      <section className="panel-grid">
        <section className="panel">
          <h2>{translate(locale, 'context.searchTitle')}</h2>
          <p className="run-meta">{translate(locale, 'context.searchDescription')}</p>
          <label htmlFor="context-query" className="run-meta">
            {translate(locale, 'context.query')}
          </label>
          <input id="context-query" className="run-meta" placeholder={translate(locale, 'context.placeholder')} />
          <div className="issue-queue-bottom" style={{ marginTop: '10px' }}>
            <span>{translate(locale, 'context.confidenceBaseline')}: {Math.round(averageConfidence)}%</span>
            <span className={searchCapabilityClass(averageConfidence >= 80 ? 'available' : 'degraded')}>
              {averageConfidence >= 80
                ? translate(locale, 'context.healthyIndex')
                : translate(locale, 'context.degradedIndex')}
            </span>
          </div>
        </section>

        <section className="panel">
          <h2>{translate(locale, 'context.coverage')}</h2>
          <ul className="run-list">
            {projectContextSummary.map(project => (
              <li className="run-card" key={project.project}>
                <div className="run-title">
                  <strong>{project.project}</strong>
                  <span className="badge badge-info">{project.total} hits</span>
                </div>
                <p className="run-meta">{translate(locale, 'context.coverageDescription')}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <ContextSearchResults results={contextSearchResults} labels={contextLabels} />
    </>
  )
}
