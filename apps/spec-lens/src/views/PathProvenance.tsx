import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type SpecPathEntry } from '../api/client.js'
import { Badge } from '../components/Badge.js'
import { Input } from '../components/Input.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'

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

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function PathProvenance() {
  const [scopeFilter, setScopeFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: paths, isLoading } = useQuery({
    queryKey: ['paths', scopeFilter, domainFilter],
    queryFn: () => api.paths(scopeFilter || undefined, domainFilter || undefined),
  })

  const allScopes = [...new Set(paths?.map(p => p.scope) ?? [])].sort()
  const allDomains = [...new Set(paths?.map(p => p.domain) ?? [])].sort()

  const filtered = paths?.filter(p =>
    search === '' || p.path.toLowerCase().includes(search.toLowerCase()),
  ) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Path Provenance</span>
          {paths && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {filtered.length} / {paths.length} paths
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            placeholder="Search paths…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ minWidth: 160 }}
          />
          <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
            <option value="">All scopes</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={domainFilter} onChange={e => setDomainFilter(e.target.value)}>
            <option value="">All domains</option>
            {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size={24} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0 }}>
                {['Path', 'Methods', 'Canonical ID', 'Scope', 'Domain', 'Source File', 'Last Changed'].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <PathRow key={p.path} entry={p} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No paths found. Run a Refresh to build snapshots.
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

function PathRow({ entry }: { entry: SpecPathEntry }) {
  const pathParts = entry.canonicalId.split(':')
  const kindPart = pathParts[0] ?? ''
  const pathPart = pathParts[1] ?? ''

  return (
    <tr
      style={{ borderBottom: '1px solid var(--border-muted)' }}
    >
      <td style={{ padding: '8px 12px' }}>
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          {entry.path}
        </code>
      </td>
      <td style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {entry.methods.map(m => <MethodBadge key={m} method={m} />)}
        </div>
      </td>
      <td style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
            {pathPart}
          </code>
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
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
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
      <td style={{ padding: '8px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
          {entry.lastChangedRevisionId.slice(0, 7)}
        </code>
        <span style={{ marginLeft: 6, fontSize: 11 }}>
          {formatRelativeTime(entry.lastChangedTimestamp)}
        </span>
      </td>
    </tr>
  )
}

