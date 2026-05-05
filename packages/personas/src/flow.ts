/**
 * v0.9 — persona dependency graph rendering.
 *
 * Reads `links` from each persona, builds the directed graph, and emits:
 *   - markdown table (linkType × source → target × reason)
 *   - mermaid flowchart (depends_on chains)
 *
 * Pure: no I/O. Caller decides what to do with the output.
 *
 * Vocabulary borrowed from qa-sdk/definition-catalog (LinkType subset):
 *   depends_on  — temporal precedence
 *   refines     — perspective variant
 *   supersedes  — replaces previous persona
 */

import type { DomainMatrix, Persona, PersonaLinkType } from './types.js'

export interface FlowEdge {
  source: string                 // persona id
  target: string                 // persona id
  linkType: PersonaLinkType
  reason?: string
  /** Domain that owns the source persona. */
  sourceDomain: string
}

export function collectEdges(domains: DomainMatrix[]): FlowEdge[] {
  const edges: FlowEdge[] = []
  for (const matrix of domains) {
    for (const p of matrix.personas) {
      for (const link of p.links ?? []) {
        const edge: FlowEdge = {
          source: p.id,
          target: link.target,
          linkType: link.linkType,
          sourceDomain: matrix.domain,
        }
        if (link.reason) edge.reason = link.reason
        edges.push(edge)
      }
    }
  }
  return edges.sort((a, b) =>
    a.linkType.localeCompare(b.linkType) ||
    a.source.localeCompare(b.source) ||
    a.target.localeCompare(b.target),
  )
}

/** Group edges by linkType for tabular rendering. */
export function groupEdgesByLinkType(edges: FlowEdge[]): Map<PersonaLinkType, FlowEdge[]> {
  const out = new Map<PersonaLinkType, FlowEdge[]>()
  for (const e of edges) {
    let bucket = out.get(e.linkType)
    if (!bucket) {
      bucket = []
      out.set(e.linkType, bucket)
    }
    bucket.push(e)
  }
  return out
}

/**
 * Topological layers of personas based on depends_on edges.
 * Layer 0 = no depends_on prerequisites; layer N = depends on someone in layer N-1.
 * Personas not in the depends_on graph are placed in layer 0.
 * Cycles are not handled here (validate.ts catches them) — if a cycle exists,
 * the involved nodes will be omitted from this output.
 */
export function topologicalLayers(domains: DomainMatrix[]): string[][] {
  const allPersonas = domains.flatMap(m => m.personas)
  const ids = new Set(allPersonas.map(p => p.id))
  const dependsOn = new Map<string, Set<string>>()
  for (const p of allPersonas) {
    const deps = (p.links ?? [])
      .filter(l => l.linkType === 'depends_on' && ids.has(l.target))
      .map(l => l.target)
    dependsOn.set(p.id, new Set(deps))
  }

  const layers: string[][] = []
  const placed = new Set<string>()

  while (placed.size < ids.size) {
    const ready = [...ids]
      .filter(id => !placed.has(id))
      .filter(id => [...(dependsOn.get(id) ?? [])].every(d => placed.has(d)))
    if (ready.length === 0) break          // cycle — bail
    ready.sort()
    layers.push(ready)
    for (const id of ready) placed.add(id)
  }
  return layers
}

// ─── markdown rendering ────────────────────────────────────────────────────

export function renderFlowMarkdown(domains: DomainMatrix[]): string {
  const edges = collectEdges(domains)
  const grouped = groupEdgesByLinkType(edges)
  const lines: string[] = []

  lines.push('# Persona Dependency Graph')
  lines.push('')
  lines.push(`- total edges: **${edges.length}**`)
  for (const [lt, list] of grouped.entries()) lines.push(`- ${lt}: ${list.length}`)
  lines.push('')

  for (const linkType of ['depends_on', 'refines', 'supersedes'] as PersonaLinkType[]) {
    const list = grouped.get(linkType) ?? []
    if (list.length === 0) continue
    lines.push(`## ${linkType}`)
    lines.push('')
    lines.push('| source | target | reason |')
    lines.push('|---|---|---|')
    for (const e of list) {
      const reason = (e.reason ?? '').replace(/\|/g, '\\|')
      lines.push(`| \`${e.source}\` | \`${e.target}\` | ${reason} |`)
    }
    lines.push('')
  }

  // Mermaid flowchart for depends_on chains (most useful for sequence design)
  const dependsOnEdges = grouped.get('depends_on') ?? []
  if (dependsOnEdges.length > 0) {
    lines.push('## depends_on flowchart')
    lines.push('')
    lines.push('```mermaid')
    lines.push('flowchart LR')
    const seenNodes = new Set<string>()
    for (const e of dependsOnEdges) {
      seenNodes.add(e.source)
      seenNodes.add(e.target)
    }
    for (const n of [...seenNodes].sort()) {
      lines.push(`  ${nodeId(n)}["${n}"]`)
    }
    for (const e of dependsOnEdges) {
      lines.push(`  ${nodeId(e.target)} --> ${nodeId(e.source)}`)
    }
    lines.push('```')
    lines.push('')
  }

  // Topological layers — useful for "execution order"
  const layers = topologicalLayers(domains)
  if (layers.length > 1) {
    lines.push('## Execution layers (topological)')
    lines.push('')
    lines.push('Layer 0 = no `depends_on` prerequisites. Higher layers depend on personas in lower layers.')
    lines.push('')
    layers.forEach((layer, i) => {
      const dependent = layer.filter(id => {
        const persona = domains.flatMap(m => m.personas).find(p => p.id === id)
        return (persona?.links ?? []).some(l => l.linkType === 'depends_on')
      })
      if (i === 0) {
        lines.push(`- **Layer 0** — ${layer.length} personas (no prerequisites)`)
      } else {
        lines.push(`- **Layer ${i}** — ${dependent.length} personas with prerequisites: ${dependent.map(id => `\`${id}\``).join(', ')}`)
      }
    })
    lines.push('')
  }

  return lines.join('\n')
}

function nodeId(personaId: string): string {
  // mermaid-safe id (alphanumeric only)
  return personaId.replace(/[^a-zA-Z0-9]/g, '_')
}
