import { Fragment, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type SpecPathEntry } from '../api/client.js'
import { Badge } from '../components/Badge.js'
import { CopyButton } from '../components/CopyButton.js'
import { Input } from '../components/Input.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'
import { useTranslation } from 'react-i18next'
import { formatRelativeTimeCompact } from '../i18n/utils.js'
import { PathAvailabilityNotice } from '../components/PathAvailabilityNotice.js'

export type SortField =
  | 'path'
  | 'methods'
  | 'canonicalId'
  | 'scope'
  | 'domain'
  | 'sourceFile'
  | 'lastChanged'

export type SortDirection = 'asc' | 'desc'

export function sortPathEntries(
  entries: SpecPathEntry[],
  field: SortField,
  direction: SortDirection,
): SpecPathEntry[] {
  const modifier = direction === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    switch (field) {
      case 'path':
        return modifier * a.path.localeCompare(b.path)
      case 'methods': {
        const diff = a.methods.length - b.methods.length
        if (diff !== 0) return modifier * diff
        const aM = a.methods.slice().sort().join(',')
        const bM = b.methods.slice().sort().join(',')
        return modifier * aM.localeCompare(bM)
      }
      case 'canonicalId':
        return modifier * a.canonicalId.localeCompare(b.canonicalId)
      case 'scope':
        return modifier * a.scope.localeCompare(b.scope)
      case 'domain':
        return modifier * a.domain.localeCompare(b.domain)
      case 'sourceFile':
        return modifier * a.sourceFile.localeCompare(b.sourceFile)
      case 'lastChanged': {
        const tsA =
          typeof a.lastChangedTimestamp === 'number' && !isNaN(a.lastChangedTimestamp)
            ? a.lastChangedTimestamp
            : new Date(a.lastChangedTimestamp || 0).getTime() || 0
        const tsB =
          typeof b.lastChangedTimestamp === 'number' && !isNaN(b.lastChangedTimestamp)
            ? b.lastChangedTimestamp
            : new Date(b.lastChangedTimestamp || 0).getTime() || 0
        return modifier * (tsA - tsB)
      }
      default:
        return 0
    }
  })
}

const METHOD_COLORS: Record<string, string> = {
  get: 'var(--blue)',
  post: 'var(--green)',
  put: 'var(--amber)',
  patch: 'var(--amber)',
  delete: 'var(--red)',
  head: 'var(--text-muted)',
  options: 'var(--text-muted)',
}

function MethodBadge({ method }: { method: string }) {
  const color = METHOD_COLORS[method.toLowerCase()] ?? 'var(--text-muted)'
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `${color}22`,
        padding: '1px 5px',
        borderRadius: 3,
        textTransform: 'uppercase',
      }}
    >
      {method}
    </span>
  )
}

interface ColumnDefinition {
  field: SortField
  label: string
}

export interface PathProvenanceProps {
  /** Initial endpoint search (e.g. the path pattern a scenario step inspected). */
  initialSearch?: string | undefined
  /** Called with the endpoint row the user opens, or `null` when it is closed. */
  onSelectEntry?: ((entry: SpecPathEntry | null) => void) | undefined
}

export function PathProvenance({ initialSearch, onSelectEntry }: PathProvenanceProps = {}) {
  const { t } = useTranslation()
  const [scopeFilter, setScopeFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [search, setSearch] = useState(initialSearch ?? '')
  const [sortField, setSortField] = useState<SortField>('path')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const { data: pathsResult, isLoading } = useQuery({
    queryKey: ['paths', scopeFilter, domainFilter],
    queryFn: () => api.paths(scopeFilter || undefined, domainFilter || undefined),
  })
  const paths = pathsResult?.status === 'available' ? pathsResult.entries : undefined

  const allScopes = [...new Set(paths?.map(p => p.scope) ?? [])].sort()
  const allDomains = [...new Set(paths?.map(p => p.domain) ?? [])].sort()

  const sortedAndFiltered = useMemo(() => {
    const filtered =
      paths?.filter(
        p => search === '' || p.path.toLowerCase().includes(search.toLowerCase()),
      ) ?? []
    return sortPathEntries(filtered, sortField, sortDirection)
  }, [paths, search, sortField, sortDirection])

  const handleHeaderClick = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection(field === 'lastChanged' ? 'desc' : 'asc')
    }
  }

  const columns: ColumnDefinition[] = [
    { field: 'path', label: t('pathsColPath') },
    { field: 'methods', label: t('pathsColMethods') },
    { field: 'canonicalId', label: t('pathsColCanonicalId') },
    { field: 'scope', label: t('pathsColScope') },
    { field: 'domain', label: t('pathsColDomain') },
    { field: 'sourceFile', label: t('pathsColSourceFile') },
    { field: 'lastChanged', label: t('pathsColLastChanged') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="panel-hd" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{t('pathsTitle')}</span>
          {paths && (
            <span className="label">
              {t('pathsCount', { filtered: sortedAndFiltered.length, total: paths.length })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            placeholder={t('pathsSearch')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ minWidth: 160 }}
          />
          <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
            <option value="">{t('pathsAllScopes')}</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={domainFilter} onChange={e => setDomainFilter(e.target.value)}>
            <option value="">{t('pathsAllDomains')}</option>
            {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size={24} />
        </div>
      ) : pathsResult?.status === 'unavailable' ? (
        <PathAvailabilityNotice message={t('pathsUnavailableTypeSpec')} />
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 2 }}>
                {columns.map(col => {
                  const isActive = sortField === col.field
                  return (
                    <th
                      key={col.field}
                      onClick={() => handleHeaderClick(col.field)}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                      aria-sort={
                        isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      data-sort-field={col.field}
                      data-sort-direction={isActive ? sortDirection : undefined}
                      title={
                        col.field === 'path'
                          ? t('pathsSortPath', 'Sort by path')
                          : col.field === 'methods'
                            ? t('pathsSortMethods', 'Sort by method count')
                            : col.field === 'lastChanged'
                              ? t('pathsSortLastChanged', 'Sort by last changed')
                              : undefined
                      }
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span>{col.label}</span>
                        <span
                          style={{
                            fontSize: 10,
                            color: isActive ? 'var(--blue)' : 'var(--text-muted)',
                            opacity: isActive ? 1 : 0.4,
                          }}
                          aria-hidden="true"
                        >
                          {isActive ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedAndFiltered.map(p => (
                <PathRow key={p.path} entry={p} onToggle={onSelectEntry} />
              ))}
              {sortedAndFiltered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {t('pathsEmpty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function PathRow({
  entry,
  onToggle,
}: {
  entry: SpecPathEntry
  onToggle?: ((entry: SpecPathEntry | null) => void) | undefined
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const pathParts = entry.canonicalId.split(':')
  const kindPart = pathParts[0] ?? ''
  const pathPart = pathParts[1] ?? ''

  return (
    <Fragment>
      <tr
        className="hoverable"
        style={{ borderBottom: open ? undefined : '1px solid var(--border-muted)', cursor: 'pointer' }}
        onClick={() => {
          const next = !open
          setOpen(next)
          onToggle?.(next ? entry : null)
        }}
        data-expanded={open}
      >
        <td style={{ padding: '8px 12px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {entry.path}
            </code>
            <CopyButton
              text={entry.path}
              label={t('pathsCopyPath', 'Copy path')}
              title={t('pathsCopyPath', 'Copy path')}
            />
          </div>
        </td>
        <td style={{ padding: '8px 12px' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {entry.methods.map(m => <MethodBadge key={m} method={m} />)}
          </div>
        </td>
        <td style={{ padding: '8px 12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                {pathPart}
              </code>
              <CopyButton
                text={entry.canonicalId}
                label={t('pathsCopyCanonicalId', 'Copy Canonical ID')}
                title={t('pathsCopyCanonicalId', 'Copy Canonical ID')}
              />
            </div>
            {kindPart && <Badge variant="muted">{kindPart}</Badge>}
          </div>
        </td>
        <td style={{ padding: '8px 12px' }}>
          <Badge variant="blue">{entry.scope}</Badge>
        </td>
        <td style={{ padding: '8px 12px' }}>
          <Badge variant="purple">{entry.domain}</Badge>
        </td>
        <td style={{ padding: '8px 12px' }}>
          <code
            className="subtle"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              maxWidth: 200,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'middle',
            }}
            title={entry.sourceFile}
          >
            {entry.sourceFile.split('/').slice(-2).join('/')}
          </code>
        </td>
        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
            {entry.lastChangedRevisionId.slice(0, 7)}
          </code>
          <span className="label" style={{ marginLeft: 6 }}>
            {formatRelativeTimeCompact(entry.lastChangedTimestamp, t)}
          </span>
        </td>
      </tr>
      {open && (
        <tr
          className="path-detail-row"
          style={{ borderBottom: '1px solid var(--border-muted)', background: 'var(--bg-elevated)' }}
        >
          <td colSpan={7} style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <DetailField label={t('pathsColPath', 'Path')}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <code className="code-tag" style={{ fontSize: 11 }}>{entry.path}</code>
                  <CopyButton
                    text={entry.path}
                    label={t('pathsCopyPath', 'Copy path')}
                    title={t('pathsCopyPath', 'Copy path')}
                  />
                </div>
              </DetailField>
              <DetailField label={t('pathsDetailCanonicalId', 'Canonical ID')}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <code className="code-tag" style={{ fontSize: 11 }}>{entry.canonicalId}</code>
                  <CopyButton
                    text={entry.canonicalId}
                    label={t('pathsCopyCanonicalId', 'Copy Canonical ID')}
                    title={t('pathsCopyCanonicalId', 'Copy Canonical ID')}
                  />
                </div>
              </DetailField>
              <DetailField label={t('pathsDetailSourceFile', 'Source File')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.sourceFile}</code>
              </DetailField>
              <DetailField label={t('pathsDetailContentHash', 'Content Hash')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.contentHash.slice(0, 16)}…</code>
              </DetailField>
              <DetailField label={t('pathsDetailLastRevision', 'Last Changed Revision')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.lastChangedRevisionId}</code>
              </DetailField>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="label">{label}</span>
      {children}
    </div>
  )
}
