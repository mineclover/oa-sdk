import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import { useQuery } from '@tanstack/react-query'
import { api, type SpecGraph } from '../api/client.js'
import { Select } from '../components/Select.js'
import { Spinner } from '../components/Spinner.js'
import { useTranslation } from 'react-i18next'
import { formatRelativeTimeCompact } from '../i18n/index.js'

export const SCOPE_COLORS: Record<string, string> = {
  public:   '#58a6ff',
  shared:   '#3fb950',
  admin:    '#e3b341',
  internal: '#bc8cff',
  partner:  '#f0883e',
}

export function scopeColor(scope: string): string {
  return SCOPE_COLORS[scope] ?? '#8b949e'
}

export const KIND_RADIUS: Record<string, number> = {
  path: 10,
  operation: 8,
  schema: 6,
  response: 6,
  parameter: 5,
  requestBody: 5,
  securityScheme: 7,
}

export function nodeRadius(kind: string): number {
  return KIND_RADIUS[kind] ?? 5
}

export type NodeDatum = SpecGraph['nodes'][number] & d3.SimulationNodeDatum
export type LinkDatum = {
  source: NodeDatum | string
  target: NodeDatum | string
  refPointer: string
}

export interface BoundingBoxResult {
  minX: number
  maxX: number
  minY: number
  maxY: number
  boxWidth: number
  boxHeight: number
  midX: number
  midY: number
}

export interface ViewportTransformResult {
  scale: number
  tx: number
  ty: number
}

export interface NeighborhoodResult {
  neighborNodeIds: Set<string>
  incidentLinkIndices: Set<number>
}

export function computeBoundingBox(
  nodes: NodeDatum[],
  viewportWidth: number,
  viewportHeight: number,
): BoundingBoxResult {
  if (nodes.length === 0) {
    return {
      minX: 0,
      maxX: viewportWidth,
      minY: 0,
      maxY: viewportHeight,
      boxWidth: viewportWidth || 20,
      boxHeight: viewportHeight || 20,
      midX: viewportWidth / 2,
      midY: viewportHeight / 2,
    }
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    const x = n.x ?? viewportWidth / 2
    const y = n.y ?? viewportHeight / 2
    const r = nodeRadius(n.kind)
    const hw = Math.max(r + 4, 32)
    const hh = r + 16

    if (x - hw < minX) minX = x - hw
    if (x + hw > maxX) maxX = x + hw
    if (y - hh < minY) minY = y - hh
    if (y + hh > maxY) maxY = y + hh
  }

  const boxWidth = Math.max(maxX - minX, 20)
  const boxHeight = Math.max(maxY - minY, 20)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  return { minX, maxX, minY, maxY, boxWidth, boxHeight, midX, midY }
}

export function computeFitTransform(
  bbox: BoundingBoxResult,
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
): ViewportTransformResult {
  const availWidth = Math.max(viewportWidth - 2 * padding, 1)
  const availHeight = Math.max(viewportHeight - 2 * padding, 1)

  const rawScale = Math.min(availWidth / bbox.boxWidth, availHeight / bbox.boxHeight)
  const scale = Math.min(Math.max(rawScale, 0.2), 1.5)

  const tx = viewportWidth / 2 - bbox.midX * scale
  const ty = viewportHeight / 2 - bbox.midY * scale

  return { scale, tx, ty }
}

export function fitGraphToViewport(
  svgElement: SVGSVGElement,
  zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>,
  nodes: NodeDatum[],
  padding = 48,
  duration = 600,
): ViewportTransformResult | undefined {
  const rect = svgElement.getBoundingClientRect()
  const W = rect.width || (svgElement.clientWidth ?? 0)
  const H = rect.height || (svgElement.clientHeight ?? 0)
  if (W === 0 || H === 0) return undefined

  if (nodes.length === 0) {
    try {
      d3.select(svgElement)
        .transition()
        .duration(duration)
        .call(zoomBehavior.transform, d3.zoomIdentity)
    } catch {
      d3.select(svgElement).call(zoomBehavior.transform, d3.zoomIdentity)
    }
    return { scale: 1, tx: 0, ty: 0 }
  }

  const bbox = computeBoundingBox(nodes, W, H)
  const result = computeFitTransform(bbox, W, H, padding)
  const transform = d3.zoomIdentity.translate(result.tx, result.ty).scale(result.scale)

  try {
    d3.select(svgElement)
      .transition()
      .duration(duration)
      .ease(d3.easeCubicOut)
      .call(zoomBehavior.transform, transform)
  } catch {
    d3.select(svgElement).call(zoomBehavior.transform, transform)
  }

  return result
}

export function get1HopNeighborhood(
  focusedNodeId: string,
  links: Array<{ source: string | { id: string }; target: string | { id: string } }>,
): NeighborhoodResult {
  const neighborNodeIds = new Set<string>([focusedNodeId])
  const incidentLinkIndices = new Set<number>()

  links.forEach((link, idx) => {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target
    if (srcId === focusedNodeId || tgtId === focusedNodeId) {
      incidentLinkIndices.add(idx)
      neighborNodeIds.add(srcId)
      neighborNodeIds.add(tgtId)
    }
  })

  return { neighborNodeIds, incidentLinkIndices }
}

export function searchSymbols(
  nodes: SpecGraph['nodes'],
  query: string,
  limit = 8,
): SpecGraph['nodes'] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return nodes
    .filter(n => n.localName.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.localName.toLowerCase().startsWith(q)
      const bStarts = b.localName.toLowerCase().startsWith(q)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return a.localName.localeCompare(b.localName)
    })
    .slice(0, limit)
}

export function centerOnNode(
  svgElement: SVGSVGElement,
  zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>,
  node: NodeDatum,
  scale = 1.8,
  duration = 750,
): ViewportTransformResult | undefined {
  const rect = svgElement.getBoundingClientRect()
  const W = rect.width || (svgElement.clientWidth ?? 0)
  const H = rect.height || (svgElement.clientHeight ?? 0)
  if (W === 0 || H === 0) return undefined

  const nx = node.x ?? W / 2
  const ny = node.y ?? H / 2
  const tx = W / 2 - nx * scale
  const ty = H / 2 - ny * scale
  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale)

  try {
    d3.select(svgElement)
      .transition()
      .duration(duration)
      .ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, transform)
  } catch {
    d3.select(svgElement).call(zoomBehavior.transform, transform)
  }

  return { scale, tx, ty }
}

export function FragmentGraph() {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const simulationRef = useRef<d3.Simulation<NodeDatum, LinkDatum> | null>(null)
  const currentNodesRef = useRef<NodeDatum[]>([])
  const currentLinksRef = useRef<LinkDatum[]>([])
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const [selected, setSelected] = useState<NodeDatum | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('')
  const [scopeFilter, setScopeFilter] = useState<string>('')
  const { t } = useTranslation()
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('')

  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false)
  const [highlightIdx, setHighlightIdx] = useState<number>(0)

  const { data: timeline } = useQuery({
    queryKey: ['timeline', 100],
    queryFn: () => api.timeline(100),
    staleTime: 30_000,
  })

  const firstCachedRevisionId = timeline?.find(e => e.snapshotCached)?.revision.id
  const revisionId = selectedRevisionId || firstCachedRevisionId

  useEffect(() => {
    setSelected(null)
    setFocusedNodeId(null)
  }, [revisionId, kindFilter, scopeFilter])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setFocusedNodeId(null)
        setSelected(null)
        setIsSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const { data: graph, isLoading } = useQuery({
    queryKey: ['graph', revisionId ?? null],
    queryFn: () => api.graph(revisionId),
    enabled: !!revisionId,
  })

  useEffect(() => {
    if (!graph || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    const { width, height } = svgRef.current.getBoundingClientRect()
    if (width === 0 || height === 0) return

    svg.selectAll('*').remove()

    const filteredNodes: NodeDatum[] = (graph.nodes as NodeDatum[]).filter(n =>
      (kindFilter === '' || n.kind === kindFilter) &&
      (scopeFilter === '' || n.scope === scopeFilter),
    )
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    const filteredLinks: LinkDatum[] = graph.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ ...e }))

    currentNodesRef.current = filteredNodes
    currentLinksRef.current = filteredLinks

    const simulation = d3.forceSimulation<NodeDatum>(filteredNodes)
      .force('link', d3.forceLink<NodeDatum, LinkDatum>(filteredLinks).id(d => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<NodeDatum>().radius(d => nodeRadius(d.kind) + 4))

    simulationRef.current = simulation

    const g = svg.append('g')

    // Zoom setup
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', ev => g.attr('transform', ev.transform))

    zoomBehaviorRef.current = zoom
    svg.call(zoom)

    // Canvas background click resets focus and selection
    svg.on('click', (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target === svgRef.current || target?.tagName.toLowerCase() === 'svg') {
        setSelected(null)
        setFocusedNodeId(null)
      }
    })

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
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation()
        setSelected(d)
        setFocusedNodeId(d.id)
      })
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
      .attr('class', 'node-core')
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
      simulationRef.current = null
      zoomBehaviorRef.current = null
      svg.on('.zoom', null)
      svg.on('click', null)
    }
  }, [graph, kindFilter, scopeFilter, revisionId])

  // Focus mode update effect: updates opacity on nodes and edges
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    if (!focusedNodeId) {
      svg.selectAll('g.node')
        .classed('is-focused', false)
        .classed('is-dimmed', false)
      svg.selectAll('line')
        .classed('is-focused', false)
        .classed('is-dimmed', false)
        .attr('stroke', '#30363d')
        .attr('stroke-width', 1)
    } else {
      const { neighborNodeIds, incidentLinkIndices } = get1HopNeighborhood(
        focusedNodeId,
        currentLinksRef.current,
      )

      svg.selectAll<SVGGElement, NodeDatum>('g.node').each(function (d) {
        const isNeighbor = neighborNodeIds.has(d.id)
        d3.select(this)
          .classed('is-focused', isNeighbor)
          .classed('is-dimmed', !isNeighbor)
      })

      svg.selectAll<SVGLineElement, LinkDatum>('line').each(function (_, idx) {
        const isIncident = incidentLinkIndices.has(idx)
        d3.select(this)
          .classed('is-focused', isIncident)
          .classed('is-dimmed', !isIncident)
          .attr('stroke', isIncident ? 'var(--blue)' : '#30363d')
          .attr('stroke-width', isIncident ? 2 : 1)
      })
    }
  }, [focusedNodeId])

  // Selected pulse-ring halo effect
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('circle.pulse-ring').remove()
    svg.selectAll('g.node').classed('is-selected', false)

    if (selected) {
      const selectedG = svg.selectAll<SVGGElement, NodeDatum>('g.node')
        .filter(d => d.id === selected.id)

      selectedG.classed('is-selected', true)
      selectedG.append('circle')
        .attr('class', 'pulse-ring')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', d => nodeRadius(d.kind) + 4)
    }
  }, [selected])

  // Toolbar handlers
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = d3.select(svgRef.current)
    zoomBehaviorRef.current.scaleBy(svg.transition().duration(300) as any, 1.3)
  }, [])

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = d3.select(svgRef.current)
    zoomBehaviorRef.current.scaleBy(svg.transition().duration(300) as any, 1 / 1.3)
  }, [])

  const handleFitToViewport = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    fitGraphToViewport(svgRef.current, zoomBehaviorRef.current, currentNodesRef.current)
  }, [])

  const handleResetLayout = useCallback(() => {
    for (const n of currentNodesRef.current) {
      n.fx = null
      n.fy = null
    }
    simulationRef.current?.alpha(1).restart()
    setFocusedNodeId(null)
    setSelected(null)
    if (svgRef.current && zoomBehaviorRef.current) {
      fitGraphToViewport(svgRef.current, zoomBehaviorRef.current, currentNodesRef.current)
    }
  }, [])

  // Search autocomplete
  const searchResults = useMemo(() => {
    return searchSymbols(graph?.nodes ?? [], searchQuery)
  }, [graph?.nodes, searchQuery])

  const handleSelectSymbol = useCallback((item: SpecGraph['nodes'][number]) => {
    setIsSearchOpen(false)
    setSearchQuery('')
    const target = currentNodesRef.current.find(n => n.id === item.id)
    if (!target) {
      setKindFilter('')
      setScopeFilter('')
      setTimeout(() => {
        const refreshed = currentNodesRef.current.find(n => n.id === item.id)
        if (refreshed) {
          setSelected(refreshed)
          setFocusedNodeId(refreshed.id)
          if (svgRef.current && zoomBehaviorRef.current) {
            centerOnNode(svgRef.current, zoomBehaviorRef.current, refreshed)
          }
        }
      }, 50)
    } else {
      setSelected(target)
      setFocusedNodeId(target.id)
      if (svgRef.current && zoomBehaviorRef.current) {
        centerOnNode(svgRef.current, zoomBehaviorRef.current, target)
      }
    }
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSearchOpen || searchResults.length === 0) {
      if (e.key === 'Enter' && searchQuery.trim()) {
        setIsSearchOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => (prev + 1) % searchResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => (prev - 1 + searchResults.length) % searchResults.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = searchResults[highlightIdx]
      if (chosen) handleSelectSymbol(chosen)
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false)
    }
  }, [isSearchOpen, searchResults, highlightIdx, searchQuery, handleSelectSymbol])

  const allKinds = [...new Set(graph?.nodes.map(n => n.kind) ?? [])].sort()
  const allScopes = [...new Set(graph?.nodes.map(n => n.scope) ?? [])].sort()

  const focusedNode = graph?.nodes.find(n => n.id === focusedNodeId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <style>{`
        .canvas-toolbar {
          position: absolute;
          bottom: 16px;
          left: 16px;
          display: flex;
          align-items: center;
          gap: 2px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 3px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 10;
          backdrop-filter: blur(8px);
        }
        .canvas-toolbar-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: none;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 14px;
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
        }
        .canvas-toolbar-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .canvas-toolbar-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .canvas-toolbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border);
          margin: 0 2px;
        }
        .node {
          transition: opacity 0.25s ease;
        }
        .node.is-dimmed {
          opacity: 0.15;
        }
        .node.is-focused {
          opacity: 1;
        }
        .node.is-selected circle.node-core {
          stroke: #ffffff !important;
          stroke-width: 2.5px !important;
          filter: drop-shadow(0 0 6px rgba(88, 166, 255, 0.9));
        }
        line {
          transition: opacity 0.25s ease, stroke 0.25s ease, stroke-width 0.25s ease;
        }
        line.is-dimmed {
          opacity: 0.15;
        }
        line.is-focused {
          opacity: 1;
        }
        @keyframes pulse-ring {
          0% {
            r: 10px;
            stroke-opacity: 1;
            stroke-width: 3px;
          }
          50% {
            r: 22px;
            stroke-opacity: 0.6;
            stroke-width: 2px;
          }
          100% {
            r: 32px;
            stroke-opacity: 0;
            stroke-width: 0.5px;
          }
        }
        .pulse-ring {
          fill: none;
          stroke: var(--blue);
          animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
          pointer-events: none;
        }
      `}</style>

      {/* Header */}
      <div className="panel-hd">
        <span style={{ fontWeight: 600 }}>{t('graphTitle')}</span>
        {graph && (
          <span className="label">{t('graphNodeEdgeCount', { nodes: graph.nodes.length, edges: graph.edges.length })}</span>
        )}
        {/* Revision selector */}
        {timeline && timeline.length > 0 && (() => {
          const cached = timeline.filter(e => e.snapshotCached)
          if (cached.length === 0) {
            return <span className="label">{t('graphNoSnapshots')}</span>
          }
          return (
            <Select
              value={selectedRevisionId || (cached[0]?.revision.id ?? '')}
              onChange={e => setSelectedRevisionId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              {cached.map(e => (
                <option key={e.revision.id} value={e.revision.id}>
                  {e.revision.shortId} · {e.revision.message.slice(0, 40)}{e.revision.message.length > 40 ? '…' : ''} ({formatRelativeTimeCompact(e.revision.timestamp, t)})
                </option>
              ))}
            </Select>
          )
        })()}

        {/* Symbol search autocomplete */}
        <div ref={searchContainerRef} style={{ position: 'relative' }}>
          <input
            type="text"
            className="input"
            placeholder={t('graphSearchPlaceholder')}
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value)
              setIsSearchOpen(true)
              setHighlightIdx(0)
            }}
            onFocus={() => {
              if (searchQuery.trim()) setIsSearchOpen(true)
            }}
            onKeyDown={handleSearchKeyDown}
            style={{ width: 190, fontSize: 12, padding: '3px 8px' }}
            aria-label={t('graphSearchPlaceholder')}
          />
          {isSearchOpen && searchResults.length > 0 && (
            <div
              className="search-dropdown"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                width: 260,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 100,
                marginTop: 4,
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {searchResults.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => handleSelectSymbol(item)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    padding: '6px 10px',
                    cursor: 'pointer',
                    background: idx === highlightIdx ? 'var(--bg-hover)' : 'transparent',
                    borderBottom: '1px solid var(--border-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: scopeColor(item.scope),
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ overflow: 'hidden' }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                      }}
                    >
                      {item.localName}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {item.kind} · {item.domain}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="">{t('graphAllKinds')}</option>
            {allKinds.map(k => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}>
            <option value="">{t('graphAllScopes')}</option>
            {allScopes.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        {/* Scope legend */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(SCOPE_COLORS).map(([scope, color]) => (
            <span key={scope} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span className="label">{scope}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Graph + Detail panel + Canvas Overlay */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <Spinner size={28} />
          </div>
        ) : (
          <>
            <svg ref={svgRef} style={{ flex: 1, minWidth: 0, width: '100%', height: '100%' }} />

            {/* Floating Canvas Toolbar */}
            <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
              <button
                type="button"
                className="canvas-toolbar-btn"
                onClick={handleZoomIn}
                title={t('graphZoomIn')}
                aria-label={t('graphZoomIn')}
              >
                +
              </button>
              <button
                type="button"
                className="canvas-toolbar-btn"
                onClick={handleZoomOut}
                title={t('graphZoomOut')}
                aria-label={t('graphZoomOut')}
              >
                −
              </button>
              <button
                type="button"
                className="canvas-toolbar-btn"
                onClick={handleFitToViewport}
                title={t('graphFit')}
                aria-label={t('graphFit')}
              >
                ⛶
              </button>
              <div className="canvas-toolbar-divider" />
              <button
                type="button"
                className="canvas-toolbar-btn"
                onClick={handleResetLayout}
                title={t('graphReset')}
                aria-label={t('graphReset')}
              >
                ↻
              </button>
            </div>

            {/* Neighborhood focus indicator chip */}
            {focusedNodeId && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '4px 10px',
                  fontSize: 12,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  zIndex: 10,
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  {t('graphFocusActive', {
                    name: focusedNode?.localName ?? focusedNodeId,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFocusedNodeId(null)
                    setSelected(null)
                  }}
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 11, height: 'auto' }}
                >
                  {t('graphFocusReset')}
                </button>
              </div>
            )}
          </>
        )}

        {/* Detail panel */}
        {selected && graph && (
          <NodeDetailPanel
            node={selected}
            edges={graph.edges}
            nodes={graph.nodes}
            onClose={() => {
              setSelected(null)
              setFocusedNodeId(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

function NodeDetailPanel({
  node,
  edges,
  nodes,
  onClose,
}: {
  node: NodeDatum
  edges: SpecGraph['edges']
  nodes: SpecGraph['nodes']
  onClose: () => void
}) {
  const { t } = useTranslation()
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  const outEdges = edges.filter(e => e.source === node.id)
  const inEdges  = edges.filter(e => e.target === node.id)

  return (
    <div
      style={{
        width: 280,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        padding: 16,
        overflowY: 'auto',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t('graphDetailTitle')}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>

      <DetailRow label={t('graphDetailName')} value={node.localName} mono />
      <DetailRow label={t('graphDetailKind')} value={node.kind} />
      <DetailRow label={t('graphDetailScope')} value={node.scope} />
      <DetailRow label={t('graphDetailDomain')} value={node.domain} />
      <DetailRow label={t('graphDetailId')} value={node.id} mono small />
      <DetailRow label={t('graphDetailHash')} value={node.contentHash.slice(0, 12) + '…'} mono small />
      <div>
        <div className="label" style={{ marginBottom: 4 }}>{t('graphDetailSource')}</div>
        <code style={{ fontSize: 10, fontFamily: 'var(--font-mono)', wordBreak: 'break-all', color: 'var(--fg-muted)' }}>
          {node.sourcePath.split('/').slice(-3).join('/')}
        </code>
      </div>

      <EdgeList
        label={t('graphDetailRefs', { count: outEdges.length })}
        edgeIds={outEdges.map(e => e.target as string)}
        nodeById={nodeById}
      />
      <EdgeList
        label={t('graphDetailRefdBy', { count: inEdges.length })}
        edgeIds={inEdges.map(e => e.source as string)}
        nodeById={nodeById}
      />
    </div>
  )
}

function EdgeList({
  label,
  edgeIds,
  nodeById,
}: {
  label: string
  edgeIds: string[]
  nodeById: Map<string, SpecGraph['nodes'][number]>
}) {
  if (edgeIds.length === 0) return null
  const MAX = 6
  const visible = edgeIds.slice(0, MAX)
  const overflow = edgeIds.length - MAX

  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {visible.map(id => {
          const n = nodeById.get(id)
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: SCOPE_COLORS[n?.scope ?? ''] ?? '#8b949e',
                  flexShrink: 0,
                }}
              />
              <code style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n?.localName ?? id.split('/').pop() ?? id}
              </code>
            </div>
          )
        })}
        {overflow > 0 && (
          <span className="label">+{overflow} more</span>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontSize: small ? 'var(--text-xs)' : 'var(--text-sm)',
          color: 'var(--fg-primary)',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  )
}
