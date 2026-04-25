import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type SpecTimelineEntry } from '../api/client.js'
import { Badge, DiffBadges } from '../components/Badge.js'
import { Button } from '../components/Button.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'
import { useLocale, formatRelativeTimeFull } from '../i18n/index.js'

function sourceIcon(source: string): string {
  switch (source) {
    case 'github': return '⬡'
    case 'local-git': return '◉'
    case 'gitlab': return '◈'
    default: return '◇'
  }
}

export function Timeline({
  onSelectDiff,
}: {
  onSelectDiff: (baseId: string, headId: string) => void
}) {
  const { t } = useLocale()
  const qc = useQueryClient()
  const [limit, setLimit] = useState(100)

  const { data: entries, isLoading, error } = useQuery({
    queryKey: ['timeline', limit],
    queryFn: () => api.timeline(limit),
    refetchInterval: 30000,
  })

  const refresh = useMutation({
    mutationFn: api.refresh,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline'] }),
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--red)' }}>
        {t.diffLoadError}: {String(error)}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="panel-hd" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{t.timelineTitle}</span>
          {entries && (
            <span className="label">{t.timelineRevisionCount(entries.length)}</span>
          )}
        </div>
        <Select value={limit} onChange={e => setLimit(Number(e.target.value))}>
          {[50, 100, 200, 500].map(n => (
            <option key={n} value={n}>{t.timelineRecentN(n)}</option>
          ))}
        </Select>
        <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
          {t.timelineRefresh}
        </Button>
      </div>

      {/* Entry list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {entries?.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t.timelineEmpty}
          </div>
        )}
        {entries?.map((entry, i) => (
          <TimelineRow
            key={entry.revision.id}
            entry={entry}
            prev={entries[i + 1]}
            onSelectDiff={onSelectDiff}
          />
        ))}
      </div>
    </div>
  )
}

function TimelineRow({
  entry,
  prev,
  onSelectDiff,
}: {
  entry: SpecTimelineEntry
  prev: SpecTimelineEntry | undefined
  onSelectDiff: (baseId: string, headId: string) => void
}) {
  const { t } = useLocale()
  const hasDiff = prev !== undefined
  const { diffStats } = entry

  return (
    <div
      className={hasDiff ? 'hoverable' : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'start',
        gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-muted)',
        cursor: hasDiff ? undefined : 'default',
      }}
      onClick={() => {
        if (hasDiff && prev) onSelectDiff(prev.revision.id, entry.revision.id)
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {/* Row 1: sha + source badge + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {entry.revision.shortId}
          </code>
          <Badge variant="muted">
            {sourceIcon(entry.revision.source)} {entry.revision.source}
          </Badge>
          {entry.revision.sourceRef && (
            <Badge variant="purple">{entry.revision.sourceRef}</Badge>
          )}
          <span className="label" style={{ marginLeft: 'auto' }}>
            {formatRelativeTimeFull(entry.revision.timestamp, t)}
          </span>
        </div>

        {/* Row 2: commit message */}
        <div style={{ color: 'var(--text-primary)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entry.revision.message || t.timelineNoMessage}
        </div>

        {/* Row 3: author */}
        {entry.revision.author && (
          <div className="label">{entry.revision.author}</div>
        )}

        {/* Row 4: affected files */}
        {entry.affectedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {entry.affectedFiles.slice(0, 5).map(f => (
              <span key={f} className="code-tag">{f.split('/').pop()}</span>
            ))}
            {entry.affectedFiles.length > 5 && (
              <span className="label">{t.timelineMoreFiles(entry.affectedFiles.length - 5)}</span>
            )}
          </div>
        )}
      </div>

      {/* Right: diff badges */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        {!entry.snapshotCached
          ? <Badge variant="amber">{t.timelineBuildFailed}</Badge>
          : <DiffBadges
              added={diffStats.pathsAdded}
              removed={diffStats.pathsRemoved}
              changed={diffStats.pathsChanged}
              breaking={diffStats.breakingChanges}
            />
        }
        {hasDiff && entry.snapshotCached && (
          <span className="label">{t.timelineViewDiff}</span>
        )}
      </div>
    </div>
  )
}
