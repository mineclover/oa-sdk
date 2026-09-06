import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ClearCacheResult, type SpecTimelineEntry } from '../api/client.js'
import { Badge, DiffBadges } from '../components/Badge.js'
import { Button } from '../components/Button.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'
import { useTranslation } from 'react-i18next'
import { formatRelativeTimeFull } from '../i18n/index.js'
import { useFeedback } from '../components/FeedbackContext.js'

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
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { confirm, toastSuccess, toastError } = useFeedback()

  const [limit, setLimit] = useState(100)
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  const [selectedHeadId, setSelectedHeadId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState<boolean>(false)
  const [filterBreaking, setFilterBreaking] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')

  const { data: entries, isLoading, error } = useQuery({
    queryKey: ['timeline', limit],
    queryFn: () => api.timeline(limit),
    refetchInterval: 30000,
  })

  const refresh = useMutation({
    mutationFn: api.refresh,
    onSuccess: () => void qc.invalidateQueries(),
    onError: (err) => console.error('[spec-lens] Refresh failed:', err),
  })

  const clearCache = useMutation({
    mutationFn: api.clearCache,
    onSuccess: (result: ClearCacheResult) => {
      toastSuccess(
        t('timelineClearCacheDone', {
          snapshots: result.deletedSnapshots,
          diffs: result.deletedDiffs,
        }),
      )
      void qc.invalidateQueries()
    },
    onError: (err) => {
      console.error('[spec-lens] Clear cache failed:', err)
      toastError(t('timelineClearCacheError'))
    },
  })

  async function handleClearCache() {
    const confirmed = await confirm({
      title: t('timelineClearCache'),
      message: t('timelineClearCacheConfirm'),
      danger: true,
    })
    if (confirmed) {
      clearCache.mutate()
    }
  }

  // Count commits with breaking changes in the full list
  const breakingCount = useMemo(() => {
    if (!entries) return 0
    return entries.filter((e) => e.diffStats.breakingChanges > 0).length
  }, [entries])

  // Filtered entries based on breaking chip and search input
  const filteredEntries = useMemo(() => {
    if (!entries) return []
    const q = searchQuery.trim().toLowerCase()

    return entries.filter((entry) => {
      if (filterBreaking && entry.diffStats.breakingChanges === 0) {
        return false
      }
      if (q) {
        const idMatch = entry.revision.id.toLowerCase().includes(q)
        const shortIdMatch = entry.revision.shortId.toLowerCase().includes(q)
        const msgMatch = (entry.revision.message ?? '').toLowerCase().includes(q)
        const authorMatch = (entry.revision.author ?? '').toLowerCase().includes(q)
        if (!idMatch && !shortIdMatch && !msgMatch && !authorMatch) {
          return false
        }
      }
      return true
    })
  }, [entries, filterBreaking, searchQuery])

  const isFiltered = filterBreaking || searchQuery.trim().length > 0

  // Quick lookup for base and head entries
  const baseEntry = useMemo(
    () => (selectedBaseId ? entries?.find((e) => e.revision.id === selectedBaseId) : null),
    [entries, selectedBaseId],
  )
  const headEntry = useMemo(
    () => (selectedHeadId ? entries?.find((e) => e.revision.id === selectedHeadId) : null),
    [entries, selectedHeadId],
  )

  const isSameCommit = Boolean(selectedBaseId && selectedHeadId && selectedBaseId === selectedHeadId)
  const canCompare = Boolean(selectedBaseId && selectedHeadId && !isSameCommit)
  const isSelecting = compareMode || Boolean(selectedBaseId || selectedHeadId)

  function handleSwap() {
    const prevBase = selectedBaseId
    const prevHead = selectedHeadId
    setSelectedBaseId(prevHead)
    setSelectedHeadId(prevBase)
  }

  function handleCompare() {
    if (canCompare && selectedBaseId && selectedHeadId) {
      onSelectDiff(selectedBaseId, selectedHeadId)
    }
  }

  function handleCancelSelection() {
    setSelectedBaseId(null)
    setSelectedHeadId(null)
    setCompareMode(false)
  }

  function toggleCompareMode() {
    if (compareMode) {
      handleCancelSelection()
    } else {
      setCompareMode(true)
      // Auto-populate head = latest (index 0) and base = previous (index 1) if not yet chosen
      if (!selectedBaseId && !selectedHeadId && entries && entries.length >= 2) {
        const head = entries[0]
        const base = entries[1]
        if (head && base) {
          setSelectedHeadId(head.revision.id)
          setSelectedBaseId(base.revision.id)
        }
      }
    }
  }

  function handleSelectBase(revisionId: string) {
    setSelectedBaseId(revisionId)
    if (!compareMode) setCompareMode(true)
  }

  function handleSelectHead(revisionId: string) {
    setSelectedHeadId(revisionId)
    if (!compareMode) setCompareMode(true)
  }

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
        {t('diffLoadError')}: {String(error)}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      {/* Panel Top Header */}
      <div
        className="panel-hd"
        style={{
          justifyContent: 'space-between',
          gap: 12,
          rowGap: 10,
        }}
      >
        {/* Left: Title & Counters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-lg)' }}>{t('timelineTitle')}</span>
          {entries && (
            <span className="label">
              {isFiltered
                ? t('timelineFilterCount', { count: filteredEntries.length })
                : t('timelineRevisionCount', { count: entries.length })}
            </span>
          )}
        </div>

        {/* Right: Controls & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>
                {t('timelineRecentN', { count: n })}
              </option>
            ))}
          </Select>
          <Button
            loading={clearCache.isPending}
            onClick={handleClearCache}
            style={{ fontSize: 'var(--text-xs)', padding: '4px 10px', opacity: 0.8 }}
          >
            {t('timelineClearCache')}
          </Button>
          <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
            {t('timelineRefresh')}
          </Button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div
        style={{
          padding: '8px 20px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          {/* Real-time search input */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 260 }}>
            <input
              type="text"
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('timelineSearchPlaceholder')}
              aria-label={t('timelineSearchPlaceholder')}
              style={{ width: '100%', paddingRight: searchQuery ? 26 : 8, fontSize: 'var(--text-xs)' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: 6,
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 2,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Breaking change filter chip */}
          <button
            type="button"
            className={`btn ${filterBreaking ? 'active' : ''}`}
            onClick={() => setFilterBreaking((prev) => !prev)}
            title={t('timelineFilterBreaking')}
            aria-label={t('timelineFilterBreaking')}
            aria-pressed={filterBreaking}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '4px 10px',
              background: filterBreaking ? 'var(--amber-bg)' : undefined,
              color: filterBreaking ? 'var(--amber)' : undefined,
              borderColor: filterBreaking ? 'var(--amber)' : undefined,
              fontWeight: filterBreaking ? 600 : 400,
            }}
          >
            ⚡ Breaking ({breakingCount})
          </button>

          {/* Filter result count indicator */}
          {isFiltered && (
            <span className="label" style={{ fontSize: 'var(--text-xs)' }}>
              {t('timelineFilterCount', { count: filteredEntries.length })}
            </span>
          )}
        </div>

        {/* Compare Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            onClick={toggleCompareMode}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '4px 12px',
              background: compareMode ? 'var(--blue-bg)' : undefined,
              color: compareMode ? 'var(--blue)' : undefined,
              borderColor: compareMode ? 'var(--blue)' : undefined,
            }}
          >
            {compareMode ? t('timelineCompareCancel') : t('timelineCompareMode')}
          </Button>
        </div>
      </div>

      {/* Sticky Compare Action Bar */}
      {isSelecting && (
        <div
          role="region"
          aria-label="Compare Selection Bar"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {/* Base & Head chips with swap */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('timelineCompareMode')}:
            </span>

            {/* Base chip */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: selectedBaseId ? 'var(--red-bg)' : 'var(--bg-surface)',
                border: `1px solid ${selectedBaseId ? 'var(--red)' : 'var(--border)'}`,
                color: selectedBaseId ? 'var(--red)' : 'var(--text-muted)',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
              }}
              title={baseEntry?.revision.message}
            >
              <span style={{ fontWeight: 600 }}>{t('timelineCompareBase')}:</span>
              <span>{baseEntry?.revision.shortId ?? (selectedBaseId ? selectedBaseId.slice(0, 7) : '—')}</span>
            </span>

            {/* Swap button */}
            <button
              type="button"
              className="btn"
              onClick={handleSwap}
              disabled={!selectedBaseId && !selectedHeadId}
              title={t('timelineSwapButton')}
              aria-label="Swap Base and Head"
              style={{
                padding: '3px 9px',
                fontSize: 14,
                lineHeight: 1,
                cursor: !selectedBaseId && !selectedHeadId ? 'not-allowed' : 'pointer',
              }}
            >
              ⇄
            </button>

            {/* Head chip */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: selectedHeadId ? 'var(--green-bg)' : 'var(--bg-surface)',
                border: `1px solid ${selectedHeadId ? 'var(--green)' : 'var(--border)'}`,
                color: selectedHeadId ? 'var(--green)' : 'var(--text-muted)',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
              }}
              title={headEntry?.revision.message}
            >
              <span style={{ fontWeight: 600 }}>{t('timelineCompareHead')}:</span>
              <span>{headEntry?.revision.shortId ?? (selectedHeadId ? selectedHeadId.slice(0, 7) : '—')}</span>
            </span>

            {/* Validation notice */}
            {isSameCommit && (
              <span
                role="alert"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--amber)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 500,
                }}
              >
                ⚠ {t('timelineDistinctError')}
              </span>
            )}
            {!isSameCommit && (!selectedBaseId || !selectedHeadId) && (
              <span className="label" style={{ fontSize: 'var(--text-xs)' }}>
                {t('timelineCompareBarPrompt')}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              disabled={!canCompare}
              onClick={handleCompare}
              style={{
                fontSize: 'var(--text-xs)',
                padding: '5px 14px',
                background: canCompare ? 'var(--blue)' : undefined,
                color: canCompare ? '#fff' : undefined,
                borderColor: canCompare ? 'var(--blue)' : undefined,
                fontWeight: 600,
              }}
            >
              {t('timelineCompareAction', {
                base: baseEntry?.revision.shortId ?? selectedBaseId?.slice(0, 7) ?? 'Base',
                head: headEntry?.revision.shortId ?? selectedHeadId?.slice(0, 7) ?? 'Head',
              })}
            </Button>
            <Button
              onClick={handleCancelSelection}
              style={{ fontSize: 'var(--text-xs)', padding: '5px 10px', opacity: 0.8 }}
            >
              {t('timelineCompareCancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Entry List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {entries?.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('timelineEmpty')}
          </div>
        )}

        {entries && entries.length > 0 && filteredEntries.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ marginBottom: 12 }}>
              {t('timelineNoMatch')}
            </p>
            <Button
              onClick={() => {
                setSearchQuery('')
                setFilterBreaking(false)
              }}
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {t('timelineClearFilters')}
            </Button>
          </div>
        )}

        {filteredEntries.map((entry) => {
          // Find original preceding entry in the chronological entries list
          const entryIndex = entries?.findIndex((e) => e.revision.id === entry.revision.id) ?? -1
          const prev = entryIndex >= 0 && entries ? entries[entryIndex + 1] : undefined

          return (
            <TimelineRow
              key={entry.revision.id}
              entry={entry}
              prev={prev}
              isBase={selectedBaseId === entry.revision.id}
              isHead={selectedHeadId === entry.revision.id}
              compareMode={compareMode}
              onSelectBase={handleSelectBase}
              onSelectHead={handleSelectHead}
              onSelectDiff={onSelectDiff}
            />
          )
        })}
      </div>
    </div>
  )
}

export function TimelineRow({
  entry,
  prev,
  isBase,
  isHead,
  compareMode,
  onSelectBase,
  onSelectHead,
  onSelectDiff,
}: {
  entry: SpecTimelineEntry
  prev: SpecTimelineEntry | undefined
  isBase: boolean
  isHead: boolean
  compareMode: boolean
  onSelectBase: (id: string) => void
  onSelectHead: (id: string) => void
  onSelectDiff: (baseId: string, headId: string) => void
}) {
  const { t } = useTranslation()
  const hasDiff = prev !== undefined
  const { diffStats } = entry
  const isSame = isBase && isHead

  let rowBackground = 'transparent'
  let borderLeft = '3px solid transparent'

  if (isSame) {
    rowBackground = 'rgba(227, 179, 65, 0.12)'
    borderLeft = '3px solid var(--amber)'
  } else if (isBase) {
    rowBackground = 'rgba(248, 81, 73, 0.10)'
    borderLeft = '3px solid var(--red)'
  } else if (isHead) {
    rowBackground = 'rgba(63, 185, 80, 0.10)'
    borderLeft = '3px solid var(--green)'
  }

  function handleRowClick() {
    if (compareMode) {
      // In compare mode: if neither base nor head, default click sets head
      if (!isBase && !isHead) {
        onSelectHead(entry.revision.id)
      }
    } else {
      if (hasDiff && prev) {
        onSelectDiff(prev.revision.id, entry.revision.id)
      }
    }
  }

  return (
    <div
      className={hasDiff || compareMode ? 'hoverable' : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'start',
        gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-muted)',
        borderLeft,
        background: rowBackground,
        cursor: hasDiff || compareMode ? 'pointer' : 'default',
        transition: 'background 0.1s, border-left 0.1s',
      }}
      onClick={handleRowClick}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {/* Row 1: Base/Head selectors + SHA + source badge + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Dual Base/Head radio selectors */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-muted)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: isBase ? 600 : 400,
                color: isBase ? 'var(--red)' : 'var(--text-muted)',
              }}
              title={t('timelineCompareBase')}
            >
              <input
                type="radio"
                name="diff-base-selection"
                value={entry.revision.id}
                checked={isBase}
                onChange={() => onSelectBase(entry.revision.id)}
                style={{ accentColor: 'var(--red)', cursor: 'pointer' }}
                aria-label={`Select ${entry.revision.shortId} as Base`}
              />
              <span>{t('timelineCompareBase')}</span>
            </label>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: isHead ? 600 : 400,
                color: isHead ? 'var(--green)' : 'var(--text-muted)',
              }}
              title={t('timelineCompareHead')}
            >
              <input
                type="radio"
                name="diff-head-selection"
                value={entry.revision.id}
                checked={isHead}
                onChange={() => onSelectHead(entry.revision.id)}
                style={{ accentColor: 'var(--green)', cursor: 'pointer' }}
                aria-label={`Select ${entry.revision.shortId} as Head`}
              />
              <span>{t('timelineCompareHead')}</span>
            </label>
          </div>

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
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entry.revision.message || t('timelineNoMessage')}
        </div>

        {/* Row 3: author */}
        {entry.revision.author && (
          <div className="label">{entry.revision.author}</div>
        )}

        {/* Row 4: affected files */}
        {entry.affectedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {entry.affectedFiles.slice(0, 5).map((f) => (
              <span key={f} className="code-tag">
                {f.split('/').pop()}
              </span>
            ))}
            {entry.affectedFiles.length > 5 && (
              <span className="label">
                {t('timelineMoreFiles', { count: entry.affectedFiles.length - 5 })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: diff badges & direct view diff link */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        {!entry.snapshotCached ? (
          <Badge variant="amber">{t('timelineBuildFailed')}</Badge>
        ) : (
          <DiffBadges
            added={diffStats.pathsAdded}
            removed={diffStats.pathsRemoved}
            changed={diffStats.pathsChanged}
            breaking={diffStats.breakingChanges}
          />
        )}
        {hasDiff && entry.snapshotCached && (
          <span
            className="label"
            style={{
              cursor: 'pointer',
              textDecoration: 'underline',
              color: 'var(--text-link)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (prev) onSelectDiff(prev.revision.id, entry.revision.id)
            }}
          >
            {t('timelineViewDiff')}
          </span>
        )}
      </div>
    </div>
  )
}
