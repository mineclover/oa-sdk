import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as d3 from 'd3'

// Ensure localStorage and SVGElement exist before i18n config and d3 loads in Node
if (typeof localStorage === 'undefined') {
  ;(globalThis as any).localStorage = {
    getItem: () => 'en',
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  }
}
if (typeof (globalThis as any).SVGElement === 'undefined') {
  ;(globalThis as any).SVGElement = class MockSVGElement {}
}

import '../i18n/config.js'
import {
  computeBoundingBox,
  computeFitTransform,
  fitGraphToViewport,
  centerOnNode,
  get1HopNeighborhood,
  searchSymbols,
  nodeRadius,
  scopeColor,
  FragmentGraph,
  type NodeDatum,
  type LinkDatum,
} from './FragmentGraph.js'

describe('FragmentGraph Bounding Box Calculation', () => {
  it('returns default centered bounding box when node list is empty', () => {
    const bbox = computeBoundingBox([], 800, 600)
    expect(bbox.minX).toBe(0)
    expect(bbox.maxX).toBe(800)
    expect(bbox.minY).toBe(0)
    expect(bbox.maxY).toBe(600)
    expect(bbox.boxWidth).toBe(800)
    expect(bbox.boxHeight).toBe(600)
    expect(bbox.midX).toBe(400)
    expect(bbox.midY).toBe(300)
  })

  it('computes accurate bounding box for a single node ensuring label margin (hw >= 32)', () => {
    // schema node has radius 6
    const node: NodeDatum = {
      id: 'schema:public/users/User',
      kind: 'schema',
      scope: 'public',
      domain: 'users',
      localName: 'User',
      sourcePath: 'packages/schemas/users.yaml',
      contentHash: 'abc123456789',
      x: 300,
      y: 200,
    }

    const r = nodeRadius(node.kind) // 6
    expect(r).toBe(6)
    const expectedHw = Math.max(r + 4, 32) // 32
    const expectedHh = r + 16 // 22

    const bbox = computeBoundingBox([node], 800, 600)

    expect(bbox.minX).toBe(300 - expectedHw)
    expect(bbox.maxX).toBe(300 + expectedHw)
    expect(bbox.minY).toBe(200 - expectedHh)
    expect(bbox.maxY).toBe(200 + expectedHh)
    expect(bbox.boxWidth).toBe(64)
    expect(bbox.boxHeight).toBe(44)
    expect(bbox.midX).toBe(300)
    expect(bbox.midY).toBe(200)
  })

  it('guarantees hw is at least 32 for smaller nodes (e.g. parameter with r=5) to prevent label clipping', () => {
    const smallNode: NodeDatum = {
      id: 'parameter:public/users/userId',
      kind: 'parameter',
      scope: 'public',
      domain: 'users',
      localName: 'userId',
      sourcePath: 'packages/schemas/users.yaml',
      contentHash: 'hash1',
      x: 100,
      y: 100,
    }

    expect(nodeRadius(smallNode.kind)).toBe(5)
    const bbox = computeBoundingBox([smallNode], 800, 600)
    // hw should be 32, not 5 + 4 = 9
    expect(bbox.minX).toBe(100 - 32)
    expect(bbox.maxX).toBe(100 + 32)
    expect(bbox.boxWidth).toBe(64)
  })

  it('computes correct extrema across multi-node cluster with varying positions and kinds', () => {
    const nodes: NodeDatum[] = [
      {
        id: 'path:public/users/Users',
        kind: 'path', // r=10 -> hw=32, hh=26
        scope: 'public',
        domain: 'users',
        localName: 'Users',
        sourcePath: 'paths.yaml',
        contentHash: 'h1',
        x: 100,
        y: 150,
      },
      {
        id: 'operation:public/users/listUsers',
        kind: 'operation', // r=8 -> hw=32, hh=24
        scope: 'public',
        domain: 'users',
        localName: 'listUsers',
        sourcePath: 'paths.yaml',
        contentHash: 'h2',
        x: 500,
        y: 400,
      },
    ]

    const bbox = computeBoundingBox(nodes, 800, 600)

    // Node 1: minX = 100 - 32 = 68, minY = 150 - 26 = 124
    // Node 2: maxX = 500 + 32 = 532, maxY = 400 + 24 = 424
    expect(bbox.minX).toBe(68)
    expect(bbox.maxX).toBe(532)
    expect(bbox.minY).toBe(124)
    expect(bbox.maxY).toBe(424)
    expect(bbox.boxWidth).toBe(532 - 68)
    expect(bbox.boxHeight).toBe(424 - 124)
    expect(bbox.midX).toBe((68 + 532) / 2)
    expect(bbox.midY).toBe((124 + 424) / 2)
  })

  it('safely falls back to viewport center when node coordinates are uninitialized or undefined', () => {
    const uninitializedNode: NodeDatum = {
      id: 'schema:public/users/User',
      kind: 'schema',
      scope: 'public',
      domain: 'users',
      localName: 'User',
      sourcePath: 'users.yaml',
      contentHash: 'h1',
      x: undefined,
      y: undefined,
    }

    const bbox = computeBoundingBox([uninitializedNode], 1000, 800)
    expect(bbox.midX).toBe(500)
    expect(bbox.midY).toBe(400)
    expect(Number.isNaN(bbox.minX)).toBe(false)
    expect(Number.isNaN(bbox.boxWidth)).toBe(false)
  })
})

describe('FragmentGraph Viewport Fit Math & Scale Clamping', () => {
  it('clamps scale factor to upper bound 1.5 for tiny clusters or single nodes', () => {
    const bbox = {
      minX: 368,
      maxX: 432,
      minY: 278,
      maxY: 322,
      boxWidth: 64,
      boxHeight: 44,
      midX: 400,
      midY: 300,
    }

    const { scale, tx, ty } = computeFitTransform(bbox, 800, 600, 48)

    // Raw scale would be min((800 - 96) / 64, (600 - 96) / 44) = min(11, 11.45) = 11
    // Must be clamped to 1.5
    expect(scale).toBe(1.5)

    // Verify centering: midX * scale + tx === W / 2
    expect(bbox.midX * scale + tx).toBe(800 / 2)
    expect(bbox.midY * scale + ty).toBe(600 / 2)
  })

  it('clamps scale factor to lower bound 0.2 for massive dispersed clusters', () => {
    const bbox = {
      minX: -2000,
      maxX: 3000,
      minY: -1000,
      maxY: 3000,
      boxWidth: 5000,
      boxHeight: 4000,
      midX: 500,
      midY: 1000,
    }

    const { scale, tx, ty } = computeFitTransform(bbox, 800, 600, 48)

    // Raw scale = min(704 / 5000, 504 / 4000) ~= min(0.1408, 0.126) = 0.126
    // Must be clamped to 0.2
    expect(scale).toBe(0.2)
    expect(bbox.midX * scale + tx).toBe(800 / 2)
    expect(bbox.midY * scale + ty).toBe(600 / 2)
  })

  it('accurately centers a cluster without clamping when raw scale falls within [0.2, 1.5]', () => {
    // 800x600 viewport, padding 48 -> avail 704 x 504
    // boxWidth = 704, boxHeight = 504 -> rawScale = 1.0
    const bbox = {
      minX: 100,
      maxX: 804,
      minY: 50,
      maxY: 554,
      boxWidth: 704,
      boxHeight: 504,
      midX: 452,
      midY: 302,
    }

    const { scale, tx, ty } = computeFitTransform(bbox, 800, 600, 48)
    expect(scale).toBe(1.0)
    expect(tx).toBe(400 - 452)
    expect(ty).toBe(300 - 302)
    expect(bbox.midX * scale + tx).toBe(400)
    expect(bbox.midY * scale + ty).toBe(300)
  })

  it('fitGraphToViewport safely returns undefined when viewport dimension is zero', () => {
    const mockSvg = {
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      clientWidth: 0,
      clientHeight: 0,
    } as unknown as SVGSVGElement

    const mockZoom = d3.zoom<SVGSVGElement, unknown>()
    const result = fitGraphToViewport(mockSvg, mockZoom, [])
    expect(result).toBeUndefined()
  })

  it('fitGraphToViewport executes and returns identity transform on empty node array', () => {
    const mockSvg = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as SVGSVGElement

    const mockZoom = d3.zoom<SVGSVGElement, unknown>()
    const result = fitGraphToViewport(mockSvg, mockZoom, [])
    expect(result).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

describe('Neighborhood Adjacency Logic (1-Hop Focus Mode)', () => {
  const links: LinkDatum[] = [
    { source: 'hub', target: 'leaf1', refPointer: '#/1' },
    { source: 'hub', target: 'leaf2', refPointer: '#/2' },
    { source: 'leaf3', target: 'hub', refPointer: '#/3' },
    { source: 'unrelated1', target: 'unrelated2', refPointer: '#/4' },
  ]

  it('resolves star topology: selecting hub node returns hub and all 3 adjacent leaves and incident edges', () => {
    const { neighborNodeIds, incidentLinkIndices } = get1HopNeighborhood('hub', links)

    expect(neighborNodeIds.has('hub')).toBe(true)
    expect(neighborNodeIds.has('leaf1')).toBe(true)
    expect(neighborNodeIds.has('leaf2')).toBe(true)
    expect(neighborNodeIds.has('leaf3')).toBe(true)
    expect(neighborNodeIds.has('unrelated1')).toBe(false)
    expect(neighborNodeIds.has('unrelated2')).toBe(false)
    expect(neighborNodeIds.size).toBe(4)

    // Edges 0, 1, and 2 connect to 'hub'
    expect(incidentLinkIndices.has(0)).toBe(true)
    expect(incidentLinkIndices.has(1)).toBe(true)
    expect(incidentLinkIndices.has(2)).toBe(true)
    expect(incidentLinkIndices.has(3)).toBe(false)
    expect(incidentLinkIndices.size).toBe(3)
  })

  it('resolves leaf selection: returns only the leaf and the hub node with 1 incident edge', () => {
    const { neighborNodeIds, incidentLinkIndices } = get1HopNeighborhood('leaf1', links)

    expect(neighborNodeIds.has('leaf1')).toBe(true)
    expect(neighborNodeIds.has('hub')).toBe(true)
    expect(neighborNodeIds.has('leaf2')).toBe(false)
    expect(neighborNodeIds.size).toBe(2)

    expect(incidentLinkIndices.has(0)).toBe(true)
    expect(incidentLinkIndices.size).toBe(1)
  })

  it('handles isolated disconnected node: returns only the node itself and 0 incident edges', () => {
    const { neighborNodeIds, incidentLinkIndices } = get1HopNeighborhood('isolatedNode', links)

    expect(neighborNodeIds.has('isolatedNode')).toBe(true)
    expect(neighborNodeIds.size).toBe(1)
    expect(incidentLinkIndices.size).toBe(0)
  })

  it('correctly resolves links where source/target are objects (as mutated by D3 simulation)', () => {
    const objectLinks: LinkDatum[] = [
      {
        source: { id: 'nodeA' } as NodeDatum,
        target: { id: 'nodeB' } as NodeDatum,
        refPointer: '#/ref',
      },
      {
        source: 'nodeB',
        target: { id: 'nodeC' } as NodeDatum,
        refPointer: '#/ref2',
      },
    ]

    const { neighborNodeIds, incidentLinkIndices } = get1HopNeighborhood('nodeB', objectLinks)

    expect(neighborNodeIds.has('nodeA')).toBe(true)
    expect(neighborNodeIds.has('nodeB')).toBe(true)
    expect(neighborNodeIds.has('nodeC')).toBe(true)
    expect(neighborNodeIds.size).toBe(3)
    expect(incidentLinkIndices.size).toBe(2)
  })
})

describe('Symbol Search Autocomplete & Node Centering', () => {
  const sampleNodes = [
    { id: 'schema:public/books/Book', localName: 'Book', kind: 'schema', scope: 'public', domain: 'books', sourcePath: 'b.yaml', contentHash: '1' },
    { id: 'schema:public/books/BookAuthor', localName: 'BookAuthor', kind: 'schema', scope: 'public', domain: 'books', sourcePath: 'b.yaml', contentHash: '2' },
    { id: 'operation:public/books/listBooks', localName: 'listBooks', kind: 'operation', scope: 'public', domain: 'books', sourcePath: 'b.yaml', contentHash: '3' },
    { id: 'schema:public/users/User', localName: 'User', kind: 'schema', scope: 'public', domain: 'users', sourcePath: 'u.yaml', contentHash: '4' },
    { id: 'schema:admin/audit/AuditLog', localName: 'AuditLog', kind: 'schema', scope: 'admin', domain: 'audit', sourcePath: 'a.yaml', contentHash: '5' },
    { id: 'path:public/books/Books', localName: 'Books', kind: 'path', scope: 'public', domain: 'books', sourcePath: 'b.yaml', contentHash: '6' },
  ]

  it('filters nodes by localName case-insensitively', () => {
    const results = searchSymbols(sampleNodes, 'user')
    expect(results.length).toBe(1)
    expect(results[0]?.localName).toBe('User')
  })

  it('prioritizes prefix matches over substring matches', () => {
    const results = searchSymbols(sampleNodes, 'book')
    // 'Book', 'BookAuthor', 'Books' start with 'book'
    // 'listBooks' contains 'book' but does not start with it
    expect(results.length).toBe(4)
    const names = results.map(r => r.localName)
    expect(names.slice(0, 3)).toEqual(['Book', 'BookAuthor', 'Books'])
    expect(names[3]).toBe('listBooks')
  })

  it('matches canonical id substrings', () => {
    const results = searchSymbols(sampleNodes, 'admin/audit')
    expect(results.length).toBe(1)
    expect(results[0]?.id).toBe('schema:admin/audit/AuditLog')
  })

  it('returns empty array when query is blank or whitespace', () => {
    expect(searchSymbols(sampleNodes, '')).toEqual([])
    expect(searchSymbols(sampleNodes, '   ')).toEqual([])
  })

  it('caps search results at the specified limit', () => {
    const results = searchSymbols(sampleNodes, 'b', 2)
    expect(results.length).toBe(2)
  })

  it('centerOnNode computes 1.8x scale and centers node at viewport center', () => {
    const mockSvg = {
      getBoundingClientRect: () => ({ width: 1000, height: 800 }),
      clientWidth: 1000,
      clientHeight: 800,
    } as unknown as SVGSVGElement

    const mockZoom = d3.zoom<SVGSVGElement, unknown>()
    const targetNode: NodeDatum = {
      id: 'target',
      kind: 'schema',
      scope: 'public',
      domain: 'users',
      localName: 'Target',
      sourcePath: 't.yaml',
      contentHash: 'th',
      x: 350,
      y: 250,
    }

    const transform = centerOnNode(mockSvg, mockZoom, targetNode, 1.8)
    expect(transform).toBeDefined()
    expect(transform!.scale).toBe(1.8)
    // tx = W / 2 - x * scale = 500 - 350 * 1.8 = 500 - 630 = -130
    expect(transform!.tx).toBe(500 - 350 * 1.8)
    // ty = H / 2 - y * scale = 400 - 250 * 1.8 = 400 - 450 = -50
    expect(transform!.ty).toBe(400 - 250 * 1.8)
    // Transformed position matches center
    expect(350 * 1.8 + transform!.tx).toBe(500)
    expect(250 * 1.8 + transform!.ty).toBe(400)
  })
})

describe('FragmentGraph Component Static Markup & Accessibility', () => {
  it('renders floating canvas toolbar buttons and symbol search input with accessible labels', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <FragmentGraph />
      </QueryClientProvider>,
    )

    // Canvas toolbar
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Canvas controls"')
    expect(html).toContain('class="canvas-toolbar"')
    expect(html).toContain('class="canvas-toolbar-btn"')
    expect(html).toContain('+')
    expect(html).toContain('−')
    expect(html).toContain('⛶')
    expect(html).toContain('↻')

    // Symbol search input
    expect(html).toMatch(/placeholder="(Search symbol \/ node…|심볼 \/ 노드 검색…)"/)
    expect(html).toMatch(/aria-label="(Search symbol \/ node…|심볼 \/ 노드 검색…)"/)

    // Scope legend
    expect(html).toContain('public')
    expect(html).toContain('shared')
    expect(html).toContain('admin')
    expect(html).toContain('internal')
    expect(html).toContain('partner')
  })

  it('exports valid scope colors and node radii matching the design system', () => {
    expect(scopeColor('public')).toBe('#58a6ff')
    expect(scopeColor('shared')).toBe('#3fb950')
    expect(scopeColor('admin')).toBe('#e3b341')
    expect(scopeColor('internal')).toBe('#bc8cff')
    expect(scopeColor('partner')).toBe('#f0883e')
    expect(scopeColor('unknown')).toBe('#8b949e')

    expect(nodeRadius('path')).toBe(10)
    expect(nodeRadius('operation')).toBe(8)
    expect(nodeRadius('schema')).toBe(6)
    expect(nodeRadius('response')).toBe(6)
    expect(nodeRadius('parameter')).toBe(5)
    expect(nodeRadius('unknown')).toBe(5)
  })
})
