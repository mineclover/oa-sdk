/**
 * v0.9 flow — smoke tests for persona dependency graph.
 */

import { describe, expect, it } from 'vitest'

import { collectEdges, groupEdgesByLinkType, renderFlowMarkdown, topologicalLayers } from './flow.js'
import { loadAllDomains } from './load.js'
import type { DomainMatrix } from './types.js'

describe('flow — bundled matrices', () => {
  const domains = loadAllDomains()

  it('collects all link edges from bundled personas', () => {
    const edges = collectEdges(domains)
    expect(edges.length).toBeGreaterThan(0)
    // The bundled annotations include depends_on chains for /me + /auth post-login flows
    expect(edges.some(e => e.linkType === 'depends_on' && e.target === 'guest-login')).toBe(true)
    // and refines for perspective variants
    expect(edges.some(e => e.linkType === 'refines' && e.target === 'admin-monitor')).toBe(true)
  })

  it('groups edges by linkType', () => {
    const grouped = groupEdgesByLinkType(collectEdges(domains))
    expect(grouped.has('depends_on')).toBe(true)
    expect(grouped.has('refines')).toBe(true)
  })

  it('produces stable topological layers for depends_on', () => {
    const layers = topologicalLayers(domains)
    expect(layers.length).toBeGreaterThanOrEqual(2)        // at least one prereq chain
    // guest-login must be in layer 0; user-self-read must be deeper
    const layerOf = (id: string): number => layers.findIndex(l => l.includes(id))
    expect(layerOf('guest-login')).toBe(0)
    expect(layerOf('user-self-read')).toBeGreaterThan(0)
    expect(layerOf('user-self-read')).toBeGreaterThan(layerOf('guest-login'))
  })

  it('renderFlowMarkdown emits expected sections', () => {
    const md = renderFlowMarkdown(domains)
    expect(md).toContain('# Persona Dependency Graph')
    expect(md).toContain('## depends_on')
    expect(md).toContain('## refines')
    expect(md).toContain('## depends_on flowchart')
    expect(md).toContain('flowchart LR')
    expect(md).toContain('## Execution layers')
  })
})

describe('flow — synthetic graphs', () => {
  it('handles empty matrices gracefully', () => {
    expect(collectEdges([])).toEqual([])
    expect(topologicalLayers([])).toEqual([])
  })

  it('orders edges by linkType / source / target', () => {
    const synth: DomainMatrix[] = [{
      domain: 'x',
      personas: [
        { id: 'a', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'refines', target: 'b' }] },
        { id: 'b', status: 'implemented', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'depends_on', target: 'c' }] },
        { id: 'c', status: 'implemented', identity: { actor: 'guest', data: 'X', intent: 'list', trigger: 'ops-monitoring' } },
      ],
    }]
    const edges = collectEdges(synth)
    expect(edges.map(e => e.linkType)).toEqual(['depends_on', 'refines'])
  })

  it('topologicalLayers omits members of a depends_on cycle', () => {
    const synth: DomainMatrix[] = [{
      domain: 'x',
      personas: [
        { id: 'a', status: 'proposed', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'depends_on', target: 'b' }] },
        { id: 'b', status: 'proposed', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'depends_on', target: 'a' }] },
      ],
    }]
    const layers = topologicalLayers(synth)
    const flat = layers.flat()
    expect(flat).not.toContain('a')
    expect(flat).not.toContain('b')
  })
})
