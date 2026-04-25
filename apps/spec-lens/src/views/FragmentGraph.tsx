import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useQuery } from '@tanstack/react-query'
import { api, type SpecGraph } from '../api/client.js'
import { Badge } from '../components/Badge.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

const SCOPE_COLORS: Record<string, string> = {
  public:   '#58a6ff',
  shared:   '#3fb950',
  admin:    '#e3b341',
  internal: '#bc8cff',
  partner:  '#f0883e',
}

function scopeColor(scope: string): string {
  return SCOPE_COLORS[scope] ?? '#8b949e'
}

const KIND_RADIUS: Record<string, number> = {
  path: 10,
  operation: 8,
  schema: 6,
  response: 6,
  parameter: 5,
  requestBody: 5,
  securityScheme: 7,
}

function nodeRadius(kind: string): number {
  return KIND_RADIUS[kind] ?? 5
}

type NodeDatum = SpecGraph['nodes'][number] & d3.SimulationNodeDatum
type LinkDatum = {
  source: NodeDatum | string
  target: NodeDatum | string
  refPointer: string
}

export function FragmentGraph() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selected, setSelected] = useState<NodeDatum | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('')
  const [scopeFilter, setScopeFilter] = useState<string>('')
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('')

  const { data: timeline } = useQuery({
    queryKey: ['timeline', 100],
    queryFn: () => api.timeline(100),
    staleTime: 30_000,
  })

  const firstCachedRevisionId = timeline?.find(e => e.snapshotCached)?.revision.id
  const revisionId = selectedRevisionId || firstCachedRevisionId

  useEffect(() => { setSelected(null) }, [revisionId])

  const { data: graph, isLoading } = useQuery({
    queryKey: ['graph', revisionId ?? null],
    queryFn: () => api.graph(revisionId!),
    enabled: !!revisionId,
  })

  useEffect(() => {
    if (!graph || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    const { width, height } = svgRef.current.getBoundingClientRect()

    svg.selectAll('*').remove()

    const filteredNodes: NodeDatum[] = (graph.nodes as NodeDatum[]).filter(n =>
      (kindFilter === '' || n.kind === kindFilter) &&
      (scopeFilter === '' || n.scope === scopeFilter),
    )
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    const filteredLinks: LinkDatum[] = graph.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ ...e }))

    const simulation = d3.forceSimulation<NodeDatum>(filteredNodes)
      .force('link', d3.forceLink<NodeDatum, LinkDatum>(filteredLinks).id(d => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<NodeDatum>().radius(d => nodeRadius(d.kind) + 4))

    const g = svg.append('g')

    // Zoom
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', ev => g.attr('transform', ev.transform)),
    )

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 14)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#30363d')

    const link = g.selectAll('line')
      .data(filteredLinks)
      .join('line')
      .attr('stroke', '#30363d')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arrow)')

    const node = g.selectAll<SVGGElement, NodeDatum>('g.node')
      .data(filteredNodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .on('click', (_, d) => setSelected(d))
      .call(
        d3.drag<SVGGElement, NodeDatum>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }),
      )

    node.append('circle')
      .attr('r', d => nodeRadius(d.kind))
      .attr('fill', d => scopeColor(d.scope))
      .attr('fill-opacity', 0.85)
      .attr('stroke', d => scopeColor(d.scope))
      .attr('stroke-width', 1.5)

    node.append('text')
      .attr('dy', d => nodeRadius(d.kind) + 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .attr('font-size', 9)
      .attr('font-family', 'var(--font-mono)')
      .text(d => d.localName.length > 14 ? d.localName.slice(0, 13) + '…' : d.localName)

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as NodeDatum).x ?? 0)
        .attr('y1', d => (d.source as NodeDatum).y ?? 0)
        .attr('x2', d => (d.target as NodeDatum).x ?? 0)
        .attr('y2', d => (d.target as NodeDatum).y ?? 0)

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      simulation.stop()
      svg.on('.zoom', null)
    }
  }, [graph, kindFilter, scopeFilter, revisionId])

  const allKinds = [...new Set(graph?.nodes.map(n => n.kind) ?? [])].sort()
  const allScopes = [...new Set(graph?.nodes.map(n => n.scope) ?? [])].sort()

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
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>Fragment Graph</span>
        {graph && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
        )}
        {/* Revision selector */}
        {timeline && timeline.length > 0 && (() => {
          const cached = timeline.filter(e => e.snapshotCached)
          if (cached.length === 0) {
            return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No snapshots available</span>
          }
          return (
            <Select
              value={selectedRevisionId || (cached[0]?.revision.id ?? '')}
              onChange={e => setSelectedRevisionId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              {cached.map(e => (
                <option key={e.revision.id} value={e.revision.id}>
                  {e.revision.shortId} · {e.revision.message.slice(0, 40)}{e.revision.message.length > 40 ? '…' : ''} ({formatRelativeTime(e.revision.timestamp)})
                </option>
              ))}
            </Select>
          )
        })()}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="">All kinds</option>
            {allKinds.map(k => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
            <option value="">All scopes</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        {/* Scope legend */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(SCOPE_COLORS).map(([scope, color]) => (
            <span key={scope} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span style={{ color: 'var(--text-muted)' }}>{scope}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Graph + Detail panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <Spinner size={28} />
          </div>
        ) : (
          <svg ref={svgRef} style={{ flex: 1, minWidth: 0 }} />
        )}

        {/* Detail panel */}
        {selected && (
          <div
            style={{
              width: 260,
              borderLeft: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              padding: 16,
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Fragment</span>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
              >
                ×
              </button>
            </div>
            <DetailRow label="Name" value={selected.localName} mono />
            <DetailRow label="Kind" value={selected.kind} />
            <DetailRow label="Scope" value={selected.scope} />
            <DetailRow label="Domain" value={selected.domain} />
            <DetailRow label="ID" value={selected.id} mono small />
            <DetailRow label="Hash" value={selected.contentHash.slice(0, 12) + '…'} mono small />
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Source</div>
              <code style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                {selected.sourcePath.split('/').slice(-3).join('/')}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: small ? 11 : 13,
          color: 'var(--text-primary)',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  )
}

