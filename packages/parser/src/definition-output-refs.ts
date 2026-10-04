import {
  type CanonicalDefinitionId,
  type ComponentLikeDefinitionKind,
  type DefinitionKind,
} from './definition-id.js'
import type {
  DefinitionRegistry,
  DefinitionRegistryDiagnostic,
  DefinitionRegistryNode,
  DefinitionRegistryRefEdge,
} from './definition-registry.js'
import { escapeJsonPointerToken } from './json-pointer.js'

export const DEFINITION_OUTPUT_COMPONENT_PATHS = {
  schema: '#/components/schemas',
  response: '#/components/responses',
  parameter: '#/components/parameters',
  requestBody: '#/components/requestBodies',
  header: '#/components/headers',
  link: '#/components/links',
  callback: '#/components/callbacks',
  securityScheme: '#/components/securitySchemes',
} as const satisfies Record<ComponentLikeDefinitionKind, string>

export type DefinitionOutputNameMap =
  | ReadonlyMap<CanonicalDefinitionId, string>
  | Readonly<Partial<Record<CanonicalDefinitionId, string>>>

export type DefinitionOutputRefRewriteOptions = {
  outputNames?: DefinitionOutputNameMap
  resolveOutputName?: (node: DefinitionRegistryNode) => string | undefined
}

export type DefinitionOutputRefRewrite = {
  sourceId: CanonicalDefinitionId
  targetId: CanonicalDefinitionId
  originalRef: string
  outputRef: string
  sourcePath: string
  sourcePointer: string
  outputName: string
  componentPath: typeof DEFINITION_OUTPUT_COMPONENT_PATHS[ComponentLikeDefinitionKind]
}

export type DefinitionOutputRefRewriteResult = {
  valid: boolean
  nodes: DefinitionRegistryNode[]
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionRegistryNode>
  rewrites: DefinitionOutputRefRewrite[]
  diagnostics: DefinitionRegistryDiagnostic[]
}

export function rewriteDefinitionOutputRefs(
  registry: DefinitionRegistry,
  options: DefinitionOutputRefRewriteOptions = {},
): DefinitionOutputRefRewriteResult {
  const rewriteByEdgeKey = createOutputRefRewriteMap(registry, options)
  const nodes = registry.nodes.map(node => rewriteDefinitionNode(node, rewriteByEdgeKey))
  const nodeById = new Map<CanonicalDefinitionId, DefinitionRegistryNode>()

  for (const node of nodes) {
    nodeById.set(node.id, node)
  }

  return {
    valid: registry.valid,
    nodes,
    nodeById,
    rewrites: [...rewriteByEdgeKey.values()],
    diagnostics: registry.diagnostics,
  }
}

export function toOpenApiComponentRef(
  node: DefinitionRegistryNode,
  outputName = node.localName,
): string | undefined {
  const componentPath = getDefinitionOutputComponentPath(node.kind)
  if (!componentPath) return undefined
  return `${componentPath}/${escapeJsonPointerToken(outputName)}`
}

function createOutputRefRewriteMap(
  registry: DefinitionRegistry,
  options: DefinitionOutputRefRewriteOptions,
): Map<string, DefinitionOutputRefRewrite> {
  const rewrites = new Map<string, DefinitionOutputRefRewrite>()

  for (const edge of registry.refEdges) {
    if (!edge.targetId) continue
    const targetNode = registry.nodeById.get(edge.targetId)
    if (!targetNode) continue

    const componentPath = getDefinitionOutputComponentPath(targetNode.kind)
    if (!componentPath) continue

    const outputName = resolveOutputName(targetNode, options)
    rewrites.set(edgeKey(edge), {
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      originalRef: edge.ref,
      outputRef: `${componentPath}/${escapeJsonPointerToken(outputName)}`,
      sourcePath: edge.sourcePath,
      sourcePointer: edge.sourcePointer,
      outputName,
      componentPath,
    })
  }

  return rewrites
}

function rewriteDefinitionNode(
  node: DefinitionRegistryNode,
  rewrites: ReadonlyMap<string, DefinitionOutputRefRewrite>,
): DefinitionRegistryNode {
  return {
    ...node,
    content: rewriteContent(node.content, node.sourcePath, node.sourcePointer, rewrites),
    refs: node.refs.map(ref => {
      const rewrite = rewrites.get(edgeKey(ref))
      return rewrite ? { ...ref, ref: rewrite.outputRef } : ref
    }),
  }
}

function rewriteContent(
  value: unknown,
  sourcePath: string,
  pointer: string,
  rewrites: ReadonlyMap<string, DefinitionOutputRefRewrite>,
): unknown {
  if (!value || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map((item, index) => rewriteContent(item, sourcePath, `${pointer}/${index}`, rewrites))
  }

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`
    if (key === '$ref' && typeof child === 'string') {
      const rewrite = rewrites.get(edgeKey({ sourcePath, sourcePointer: childPointer, ref: child }))
      output[key] = rewrite?.outputRef ?? child
    } else {
      output[key] = rewriteContent(child, sourcePath, childPointer, rewrites)
    }
  }

  return output
}

function resolveOutputName(
  node: DefinitionRegistryNode,
  options: DefinitionOutputRefRewriteOptions,
): string {
  const mappedName = lookupOutputName(options.outputNames, node.id)
  if (mappedName !== undefined) return mappedName
  return options.resolveOutputName?.(node) ?? node.localName
}

function lookupOutputName(
  outputNames: DefinitionOutputNameMap | undefined,
  id: CanonicalDefinitionId,
): string | undefined {
  if (!outputNames) return undefined
  if (isReadonlyMap(outputNames)) return outputNames.get(id)
  return Object.prototype.hasOwnProperty.call(outputNames, id) ? outputNames[id] : undefined
}

function getDefinitionOutputComponentPath(
  kind: DefinitionKind,
): typeof DEFINITION_OUTPUT_COMPONENT_PATHS[ComponentLikeDefinitionKind] | undefined {
  return isComponentLikeDefinitionKind(kind) ? DEFINITION_OUTPUT_COMPONENT_PATHS[kind] : undefined
}

function isComponentLikeDefinitionKind(kind: DefinitionKind): kind is ComponentLikeDefinitionKind {
  return kind in DEFINITION_OUTPUT_COMPONENT_PATHS
}

function edgeKey(edge: Pick<DefinitionRegistryRefEdge, 'sourcePath' | 'sourcePointer' | 'ref'>): string {
  return `${edge.sourcePath}\0${edge.sourcePointer}\0${edge.ref}`
}

function isReadonlyMap(value: DefinitionOutputNameMap): value is ReadonlyMap<CanonicalDefinitionId, string> {
  return typeof (value as ReadonlyMap<CanonicalDefinitionId, string>).get === 'function'
}
