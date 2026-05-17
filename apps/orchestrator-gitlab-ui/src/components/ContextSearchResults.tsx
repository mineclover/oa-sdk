import { searchCapabilityClass, type ContextSearchHit } from '../data/dashboard.js'

export interface ContextSearchProps {
  results: ContextSearchHit[]
  labels: {
    title: string
    project: string
    source: string
    confidence: string
    updated: string
    minutesAgo: (minutes: number) => string
    hoursMinutesAgo: (hours: number, minutes: number) => string
  }
}

function freshnessLabel(minutes: number, labels: ContextSearchProps['labels']) {
  if (minutes < 60) return labels.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return labels.hoursMinutesAgo(hours, mins)
}

export function ContextSearchResults({ labels, results }: ContextSearchProps) {
  return (
    <section className="panel context-search">
      <h2>{labels.title}</h2>
      <ul className="run-list context-search-list">
        {results.map(result => (
          <li className="run-card context-search-row" key={result.id}>
            <div className="run-title">
              <strong>{result.query}</strong>
              <span className={searchCapabilityClass(result.capability)}>{result.capability}</span>
            </div>
            <div className="run-meta">{labels.project}: {result.project}</div>
            <div className="run-meta">{labels.source}: {result.contextType} · {result.path}</div>
            <p className="run-meta context-search-snippet">{result.snippet}</p>
            <div className="run-meta context-search-bottom">
              <span>{labels.confidence}: {result.confidence}%</span>
              <span>{labels.updated}: {freshnessLabel(result.updatedMinutesAgo, labels)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
