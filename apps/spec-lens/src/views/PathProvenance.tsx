import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type SpecPathEntry } from '../api/client.js'
import { Badge } from '../components/Badge.js'
import { Input } from '../components/Input.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'
import { useTranslation } from 'react-i18next'
import { formatRelativeTimeCompact } from '../i18n/index.js'
import { PathAvailabilityNotice } from '../components/PathAvailabilityNotice.js'

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

export function PathProvenance() {
  const { t } = useTranslation()
  const [scopeFilter, setScopeFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: pathsResult, isLoading } = useQuery({
    queryKey: ['paths', scopeFilter, domainFilter],
    queryFn: () => api.paths(scopeFilter || undefined, domainFilter || undefined),
  })
  const paths = pathsResult?.status === 'available' ? pathsResult.entries : undefined

  const allScopes = [...new Set(paths?.map(p => p.scope) ?? [])].sort()
  const allDomains = [...new Set(paths?.map(p => p.domain) ?? [])].sort()

  const filtered = paths?.filter(p =>
    search === '' || p.path.toLowerCase().includes(search.toLowerCase()),
  ) ?? []

  const TABLE_HEADERS = [
    t('pathsColPath'),
    t('pathsColMethods'),
    t('pathsColCanonicalId'),
    t('pathsColScope'),
    t('pathsColDomain'),
    t('pathsColSourceFile'),
    t('pathsColLastChanged'),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="panel-hd" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{t('pathsTitle')}</span>
          {paths && (
            <span className="label">{t('pathsCount', { filtered: filtered.length, total: paths.length })}</span>
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
              <tr style={{ background: 'var(--bg-surface)', position: 'sticky', top: 0 }}>
                {TABLE_HEADERS.map(h => (
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

function PathRow({ entry }: { entry: SpecPathEntry }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const pathParts = entry.canonicalId.split(':')
  const kindPart = pathParts[0] ?? ''
  const pathPart = pathParts[1] ?? ''

  return (
    <Fragment>
      <tr
        className="hoverable"
        style={{ borderBottom: open ? undefined : '1px solid var(--border-muted)' }}
        onClick={() => setOpen(o => !o)}
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
        <tr style={{ borderBottom: '1px solid var(--border-muted)', background: 'var(--bg-elevated)' }}>
          <td colSpan={7} style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <DetailField label={t('pathsDetailCanonicalId')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.canonicalId}</code>
              </DetailField>
              <DetailField label={t('pathsDetailSourceFile')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.sourceFile}</code>
              </DetailField>
              <DetailField label={t('pathsDetailContentHash')}>
                <code className="code-tag" style={{ fontSize: 11 }}>{entry.contentHash.slice(0, 16)}…</code>
              </DetailField>
              <DetailField label={t('pathsDetailLastRevision')}>
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
