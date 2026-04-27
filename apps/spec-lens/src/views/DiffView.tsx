import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stringify as yamlStringify } from 'yaml'
import { api, type BreakingChange, type SpecSnapshot, type SpecTimelineDiff } from '../api/client.js'
import { Badge } from '../components/Badge.js'
import { Spinner } from '../components/Spinner.js'
import { SplitDiff } from '../components/SplitDiff.js'
import { useTranslation } from 'react-i18next'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })),
)

type Tab = 'changes' | 'yaml' | 'breaking' | 'fragments'

export function DiffView({
  baseId,
  headId,
  onBack,
}: {
  baseId: string
  headId: string
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('changes')

  useEffect(() => { setTab('changes') }, [baseId, headId])

  const needsSnapshots = tab === 'changes' || tab === 'yaml'

  const { data: diff, isLoading: diffLoading, error: diffError } = useQuery({
    queryKey: ['diff', baseId, headId],
    queryFn: () => api.diff(baseId, headId),
  })

  const { data: baseSnap, isLoading: baseLoading, error: baseError } = useQuery({
    queryKey: ['snapshot', baseId],
    queryFn: () => api.snapshot(baseId),
    enabled: needsSnapshots,
  })

  const { data: headSnap, isLoading: headLoading, error: headError } = useQuery({
    queryKey: ['snapshot', headId],
    queryFn: () => api.snapshot(headId),
    enabled: needsSnapshots,
  })

  const isLoading = diffLoading || (needsSnapshots && (baseLoading || headLoading))
  const fetchError = diffError ?? baseError ?? headError

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div style={{ padding: 32, color: 'var(--red)' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('diffLoadError')}</div>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {String(fetchError)}
        </code>
      </div>
    )
  }

  if (!diff) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: 48, color: 'var(--text-muted)' }}>
        {t('diffNoData')}
      </div>
    )
  }

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'changes',   label: t('diffTabChanges'),   count: diff?.normalizedDiff.length },
    { id: 'yaml',      label: t('diffTabYaml') },
    { id: 'breaking',  label: t('diffTabBreaking'),  count: diff?.breakingDiff.length },
    { id: 'fragments', label: t('diffTabFragments'), count: diff?.affectedFragments.length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="panel-hd" style={{ gap: 12 }}>
        <button onClick={onBack} style={backBtnStyle}>{t('diffBack')}</button>
        <CommitRange baseId={baseId} headId={headId} />
        {diff && <DiffStatLine stats={diff.stats} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        {TABS.map(t => (
          <TabButton
            key={t.id}
            label={t.label}
            count={t.count}
            active={tab === t.id}
            hasAlert={t.id === 'breaking' && (t.count ?? 0) > 0}
            onClick={() => setTab(t.id)}
          />
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'changes' && (
          <ChangesPanel diff={diff} baseSnap={baseSnap ?? null} headSnap={headSnap ?? null} />
        )}
        {tab === 'yaml' && (
          <YamlDiffPanel baseSnap={baseSnap ?? null} headSnap={headSnap ?? null} />
        )}
        {tab === 'breaking' && diff && (
          <BreakingPanel changes={diff.breakingDiff} />
        )}
        {tab === 'fragments' && diff && (
          <FragmentsPanel fragments={diff.affectedFragments} baseId={baseId} headId={headId} />
        )}
      </div>
    </div>
  )
}

// ─────────────────── Changes panel (main diff view) ───────────────────

function ChangesPanel({
  diff,
  baseSnap,
  headSnap,
}: {
  diff: SpecTimelineDiff | undefined
  baseSnap: SpecSnapshot | null
  headSnap: SpecSnapshot | null
}) {
  const { t } = useTranslation()
  if (!diff) return <CenteredSpinner />

  if (diff.normalizedDiff.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {t('diffNoSpecDiff')}
      </div>
    )
  }

  // Group by category
  const grouped = new Map<string, typeof diff.normalizedDiff>()
  for (const entry of diff.normalizedDiff) {
    const list = grouped.get(entry.category) ?? []
    list.push(entry)
    grouped.set(entry.category, list)
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {[...grouped.entries()].map(([category, entries]) => (
        <CategorySection
          key={category}
          category={category}
          entries={entries}
          baseSpec={baseSnap?.spec ?? null}
          headSpec={headSnap?.spec ?? null}
        />
      ))}
    </div>
  )
}

type DiffEntry = { category: string; kind: string; pointer: string; message: string }

function CategorySection({
  category,
  entries,
  baseSpec,
  headSpec,
}: {
  category: string
  entries: DiffEntry[]
  baseSpec: Record<string, unknown> | null
  headSpec: Record<string, unknown> | null
}) {
  const { t } = useTranslation()
  const categoryLabels: Record<string, string> = {
    path: t('diffCategoryPaths'),
    component: t('diffCategoryComponents'),
    root: t('diffCategoryRoot'),
    server: t('diffCategoryServers'),
    security: t('diffCategorySecurity'),
  }
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="section-hd">
        {categoryLabels[category] ?? category}
        <span className="label" style={{ marginLeft: 6, fontWeight: 400 }}>
          {entries.length}
        </span>
      </div>
      {entries.map((entry) => (
        <DiffEntryRow
          key={`${entry.pointer}::${entry.kind}`}
          entry={entry}
          baseSpec={baseSpec}
          headSpec={headSpec}
        />
      ))}
    </div>
  )
}


function DiffEntryRow({
  entry,
  baseSpec,
  headSpec,
}: {
  entry: DiffEntry
  baseSpec: Record<string, unknown> | null
  headSpec: Record<string, unknown> | null
}) {
  const [expanded, setExpanded] = useState(entry.kind === 'changed')

  const baseSection = baseSpec ? extractByPointer(baseSpec, entry.pointer) : undefined
  const headSection = headSpec ? extractByPointer(headSpec, entry.pointer) : undefined

  const baseYaml = baseSection !== undefined ? yamlStringify(baseSection).trimEnd() : ''
  const headYaml = headSection !== undefined ? yamlStringify(headSection).trimEnd() : ''

  const kindVariant = entry.kind === 'added' ? 'green' : entry.kind === 'removed' ? 'red' : 'amber'
  const kindLabel = entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '−' : '~'

  const hasContent = baseYaml.length > 0 || headYaml.length > 0

  return (
    <div style={{ borderBottom: '1px solid var(--border-muted)' }}>
      {/* Entry header — clickable */}
      <div
        className={hasContent ? 'hoverable' : undefined}
        onClick={() => hasContent && setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 20px',
          cursor: hasContent ? undefined : 'default',
          userSelect: 'none',
        }}
      >
        {/* Kind indicator */}
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            background: kindVariant === 'green' ? 'var(--green-bg)' : kindVariant === 'red' ? 'var(--red-bg)' : 'var(--amber-bg)',
            color: kindVariant === 'green' ? 'var(--green)' : kindVariant === 'red' ? 'var(--red)' : 'var(--amber)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 14,
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {kindLabel}
        </span>

        {/* Pointer */}
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.pointer}
        </code>

        {/* Message */}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
          {entry.message}
        </span>

        {/* Expand icon */}
        {hasContent && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </div>

      {/* Inline split diff */}
      {expanded && hasContent && (
        <div style={{ borderTop: '1px solid var(--border-muted)' }}>
          <SplitDiff
            original={baseYaml}
            modified={headYaml}
            kind={entry.kind as 'added' | 'removed' | 'changed'}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────── Full YAML panel ───────────────────

function YamlDiffPanel({
  baseSnap,
  headSnap,
}: {
  baseSnap: SpecSnapshot | null
  headSnap: SpecSnapshot | null
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'side-by-side' | 'inline'>('side-by-side')

  if (!baseSnap || !headSnap) return <CenteredSpinner />

  if (!baseSnap.spec || !headSnap.spec) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {t('diffSpecUnavailable')}
      </div>
    )
  }

  const baseYaml = yamlStringify(baseSnap.spec)
  const headYaml = yamlStringify(headSnap.spec)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px 12px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <ModeToggle
          label={t('diffSideBySide')}
          active={mode === 'side-by-side'}
          onClick={() => setMode('side-by-side')}
        />
        <ModeToggle
          label={t('diffInline')}
          active={mode === 'inline'}
          onClick={() => setMode('inline')}
        />
      </div>
      <Suspense fallback={<CenteredSpinner />}>
        <MonacoDiffEditor
          height="100%"
          language="yaml"
          theme="vs-dark"
          original={baseYaml}
          modified={headYaml}
          options={{
            readOnly: true,
            renderSideBySide: mode === 'side-by-side',
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            renderIndicators: true,
            ignoreTrimWhitespace: false,
            diffWordWrap: 'on',
          }}
        />
      </Suspense>
    </div>
  )
}

// ─────────────────── Breaking panel ───────────────────

type BreakingSeverityFilter = 'all' | 'breaking' | 'non-breaking'

function BreakingPanel({ changes }: { changes: BreakingChange[] }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<BreakingSeverityFilter>('all')

  if (changes.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--green)' }}>
        {t('diffNoBreaking')}
      </div>
    )
  }

  const breakingCount    = changes.filter(c => c.severity === 'breaking').length
  const nonBreakingCount = changes.filter(c => c.severity === 'non-breaking').length
  const visible = filter === 'all' ? changes : changes.filter(c => c.severity === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['all', 'breaking', 'non-breaking'] as BreakingSeverityFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: filter === f ? 'var(--bg-elevated)' : 'transparent',
              color: filter === f ? 'var(--fg-primary)' : 'var(--fg-muted)',
              fontSize: 'var(--text-xs)',
              fontWeight: filter === f ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {f === 'all'
              ? t('breakingFilterAll')
              : f === 'breaking'
              ? t('breakingFilterBreaking')
              : t('breakingFilterNonBreaking')}
          </button>
        ))}
        <span className="label" style={{ marginLeft: 4 }}>
          {t('breakingCountSummary', { breaking: breakingCount, nonBreaking: nonBreakingCount })}
        </span>
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {visible.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>
            {t('breakingFilterEmpty')}
          </div>
        ) : visible.map((c) => (
          <div
            key={`${c.endpoint}::${c.code}`}
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-muted)',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 12,
              alignItems: 'start',
            }}
          >
            <Badge variant={c.severity === 'breaking' ? 'red' : 'amber'}>{c.severity}</Badge>
            <div>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>
                {c.endpoint}
              </code>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{c.detail}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.code}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────── Fragments panel ───────────────────

function FragmentsPanel({
  fragments,
  baseId,
  headId,
}: {
  fragments: string[]
  baseId: string
  headId: string
}) {
  const { t } = useTranslation()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => { setSelectedFile(null) }, [baseId, headId])

  const { data: baseSnap } = useQuery({
    queryKey: ['snapshot', baseId, 'entries'],
    queryFn: () => api.snapshot(baseId, true),
    enabled: selectedFile !== null,
  })

  const { data: headSnap } = useQuery({
    queryKey: ['snapshot', headId, 'entries'],
    queryFn: () => api.snapshot(headId, true),
    enabled: selectedFile !== null,
  })

  const baseEntry = selectedFile ? baseSnap?.entries?.find(e => e.relativePath === selectedFile) : undefined
  const headEntry = selectedFile ? headSnap?.entries?.find(e => e.relativePath === selectedFile) : undefined

  if (fragments.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {t('diffNoFragments')}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* File list */}
      <div style={{ width: 280, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}>
        <div className="label" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-muted)' }}>
          {t('diffFragmentCount', { count: fragments.length })}
        </div>
        <ul style={{ listStyle: 'none' }}>
          {fragments.map(f => (
            <li
              key={f}
              onClick={() => setSelectedFile(f === selectedFile ? null : f)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '7px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-muted)',
                background: selectedFile === f ? 'var(--bg-hover)' : undefined,
                color: selectedFile === f ? 'var(--text-primary)' : 'var(--text-secondary)',
                wordBreak: 'break-all',
              }}
            >
              {f.split('/').pop()}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                {f.split('/').slice(0, -1).join('/')}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* File diff */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {selectedFile === null ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {t('diffSelectFile')}
          </div>
        ) : (!baseSnap || !headSnap) ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner size={20} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {selectedFile}
            </div>
            <SplitDiff
              original={baseEntry?.content ?? ''}
              modified={headEntry?.content ?? ''}
              kind={baseEntry === undefined ? 'added' : headEntry === undefined ? 'removed' : 'changed'}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────── Utility components ───────────────────

function CommitRange({ baseId, headId }: { baseId: string; headId: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
        {baseId.slice(0, 7)}
      </code>
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--blue)' }}>
        {headId.slice(0, 7)}
      </code>
    </div>
  )
}

function DiffStatLine({ stats }: { stats: SpecTimelineDiff['stats'] }) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {stats.pathsAdded > 0 && <Badge variant="green">{t('statPathsAdded', { count: stats.pathsAdded })}</Badge>}
      {stats.pathsRemoved > 0 && <Badge variant="red">{t('statPathsRemoved', { count: stats.pathsRemoved })}</Badge>}
      {stats.pathsChanged > 0 && <Badge variant="blue">{t('statPathsChanged', { count: stats.pathsChanged })}</Badge>}
      {stats.schemasAdded > 0 && <Badge variant="green">{t('statSchemasAdded', { count: stats.schemasAdded })}</Badge>}
      {stats.schemasRemoved > 0 && <Badge variant="red">{t('statSchemasRemoved', { count: stats.schemasRemoved })}</Badge>}
      {stats.schemasChanged > 0 && <Badge variant="blue">{t('statSchemasChanged', { count: stats.schemasChanged })}</Badge>}
      {stats.breakingChanges > 0 && <Badge variant="amber">{t('statBreaking', { count: stats.breakingChanges })}</Badge>}
    </div>
  )
}

function TabButton({
  label, count, active, hasAlert, onClick,
}: {
  label: string; count?: number; active: boolean; hasAlert?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          style={{
            background: hasAlert ? 'var(--red-bg)' : 'var(--bg-elevated)',
            color: hasAlert ? 'var(--red)' : 'var(--text-muted)',
            padding: '0 5px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function ModeToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        background: active ? 'var(--bg-hover)' : 'none',
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  )
}

function CenteredSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: 40 }}>
      <Spinner size={24} />
    </div>
  )
}

// ─────────────────── Helpers ───────────────────

function extractByPointer(obj: Record<string, unknown>, pointer: string): unknown {
  // pointer format: #/components/schemas/Error or /components/schemas/Error
  // RFC 6901: ~1 → '/', ~0 → '~' (decode ~1 first)
  const parts = pointer.replace(/^#?\//, '').split('/')
    .filter(Boolean)
    .map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current: unknown = obj
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-link)',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
  flexShrink: 0,
}
