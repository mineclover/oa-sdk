import {
  COMPONENT_LIKE_DEFINITION_KINDS,
  type CanonicalDefinitionId,
  type ComponentLikeDefinitionKind,
  type DefinitionKind,
} from './definition-id.js'
import type { DefinitionRegistryNode } from './definition-registry.js'
import type { DefinitionOutputNameMap } from './definition-output-refs.js'

export type DefinitionOutputNamePolicyReason =
  | 'preserve-if-unique'
  | 'domain-prefix'
  | 'explicit-alias'

export type DefinitionOutputAliasMetadata = {
  id: CanonicalDefinitionId
  kind: ComponentLikeDefinitionKind
  scope: string
  domain: string
  localName: string
  outputName: string
  reason: DefinitionOutputNamePolicyReason
}

export type DefinitionOutputNameReportReason =
  | DefinitionOutputNamePolicyReason
  | 'output-name-collision'

export type DefinitionOutputNameReportSeverity = 'info' | 'warning' | 'error'

export type DefinitionOutputNameCollisionReportEntry = {
  canonicalId: CanonicalDefinitionId
  targetName: string
  kind: ComponentLikeDefinitionKind
  scope: string
  domain: string
  localName: string
  outputName: string
  reason: DefinitionOutputNameReportReason
  severity: DefinitionOutputNameReportSeverity
}

export type DefinitionOutputNameDiagnosticCode = 'definition-output-name/collision'

export type DefinitionOutputNameDiagnostic = {
  code: DefinitionOutputNameDiagnosticCode
  severity: 'error'
  message: string
  kind: ComponentLikeDefinitionKind
  outputName: string
  ids: CanonicalDefinitionId[]
}

export type DefinitionOutputNameAllocationOptions = {
  aliases?: DefinitionOutputNameMap
  targetName?: string
}

export type DefinitionOutputNameAllocationResult = {
  valid: boolean
  outputNames: ReadonlyMap<CanonicalDefinitionId, string>
  aliases: DefinitionOutputAliasMetadata[]
  aliasById: ReadonlyMap<CanonicalDefinitionId, DefinitionOutputAliasMetadata>
  collisionReport: DefinitionOutputNameCollisionReportEntry[]
  diagnostics: DefinitionOutputNameDiagnostic[]
}

type OutputNameNode = Pick<DefinitionRegistryNode, 'id' | 'kind' | 'scope' | 'domain' | 'localName'>

const COMPONENT_LIKE_KIND_SET = new Set<DefinitionKind>(COMPONENT_LIKE_DEFINITION_KINDS)

export function allocateDefinitionOutputNames(
  nodes: readonly OutputNameNode[],
  options: DefinitionOutputNameAllocationOptions = {},
): DefinitionOutputNameAllocationResult {
  const targetName = options.targetName ?? 'default'
  const targetNodes = nodes.filter(isComponentLikeNode)
  const unaliasedGroups = groupUnaliasedNodesByLocalName(targetNodes, options.aliases)
  const outputNames = new Map<CanonicalDefinitionId, string>()
  const aliases: DefinitionOutputAliasMetadata[] = []
  const aliasById = new Map<CanonicalDefinitionId, DefinitionOutputAliasMetadata>()

  for (const node of targetNodes) {
    const explicitAlias = lookupOutputName(options.aliases, node.id)
    const reason: DefinitionOutputNamePolicyReason = explicitAlias !== undefined
      ? 'explicit-alias'
      : (unaliasedGroups.get(localNameKey(node))?.length ?? 0) > 1
        ? 'domain-prefix'
        : 'preserve-if-unique'
    const outputName = explicitAlias ?? (
      reason === 'domain-prefix' ? `${toPascalCase(node.domain)}${node.localName}` : node.localName
    )

    const metadata: DefinitionOutputAliasMetadata = {
      id: node.id,
      kind: node.kind,
      scope: node.scope,
      domain: node.domain,
      localName: node.localName,
      outputName,
      reason,
    }

    outputNames.set(node.id, outputName)
    aliases.push(metadata)
    aliasById.set(node.id, metadata)
  }

  const diagnostics = collectOutputNameCollisions(aliases)
  const collisionReport = createCollisionReport(aliases, diagnostics, targetName)

  return {
    valid: diagnostics.length === 0,
    outputNames,
    aliases,
    aliasById,
    collisionReport,
    diagnostics,
  }
}

function groupUnaliasedNodesByLocalName(
  nodes: readonly (OutputNameNode & { kind: ComponentLikeDefinitionKind })[],
  explicitAliases: DefinitionOutputNameMap | undefined,
): ReadonlyMap<string, readonly OutputNameNode[]> {
  const groups = new Map<string, OutputNameNode[]>()

  for (const node of nodes) {
    if (lookupOutputName(explicitAliases, node.id) !== undefined) continue

    const key = localNameKey(node)
    const group = groups.get(key)
    if (group) {
      group.push(node)
    } else {
      groups.set(key, [node])
    }
  }

  return groups
}

function collectOutputNameCollisions(
  aliases: readonly DefinitionOutputAliasMetadata[],
): DefinitionOutputNameDiagnostic[] {
  const groups = new Map<string, DefinitionOutputAliasMetadata[]>()

  for (const alias of aliases) {
    const key = `${alias.kind}\0${alias.outputName}`
    const group = groups.get(key)
    if (group) {
      group.push(alias)
    } else {
      groups.set(key, [alias])
    }
  }

  const diagnostics: DefinitionOutputNameDiagnostic[] = []
  for (const group of groups.values()) {
    const ids = [...new Set(group.map(alias => alias.id))]
    if (ids.length <= 1) continue

    const first = group[0]
    if (!first) continue
    diagnostics.push({
      code: 'definition-output-name/collision',
      severity: 'error',
      kind: first.kind,
      outputName: first.outputName,
      ids,
      message: `Output component name "${first.outputName}" for ${first.kind} collides between canonical ids: ${ids.join(', ')}.`,
    })
  }

  return diagnostics
}

function createCollisionReport(
  aliases: readonly DefinitionOutputAliasMetadata[],
  diagnostics: readonly DefinitionOutputNameDiagnostic[],
  targetName: string,
): DefinitionOutputNameCollisionReportEntry[] {
  const collisionIds = new Set(diagnostics.flatMap(diagnostic => diagnostic.ids))

  return aliases.map(alias => {
    const collides = collisionIds.has(alias.id)

    return {
      canonicalId: alias.id,
      targetName,
      kind: alias.kind,
      scope: alias.scope,
      domain: alias.domain,
      localName: alias.localName,
      outputName: alias.outputName,
      reason: collides ? 'output-name-collision' : alias.reason,
      severity: collides ? 'error' : severityForAlias(alias),
    }
  })
}

function severityForAlias(alias: DefinitionOutputAliasMetadata): DefinitionOutputNameReportSeverity {
  if (alias.reason === 'domain-prefix') return 'warning'
  if (alias.reason === 'explicit-alias' && alias.outputName !== alias.localName) return 'warning'
  return 'info'
}

function localNameKey(node: Pick<OutputNameNode, 'kind' | 'localName'>): string {
  return `${node.kind}\0${node.localName}`
}

function lookupOutputName(
  outputNames: DefinitionOutputNameMap | undefined,
  id: CanonicalDefinitionId,
): string | undefined {
  if (!outputNames) return undefined
  if (isReadonlyMap(outputNames)) return outputNames.get(id)
  return Object.prototype.hasOwnProperty.call(outputNames, id) ? outputNames[id] : undefined
}

function toPascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(segment => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join('')
}

function isComponentLikeNode(
  node: OutputNameNode,
): node is OutputNameNode & { kind: ComponentLikeDefinitionKind } {
  return COMPONENT_LIKE_KIND_SET.has(node.kind)
}

function isReadonlyMap(value: DefinitionOutputNameMap): value is ReadonlyMap<CanonicalDefinitionId, string> {
  return typeof (value as ReadonlyMap<CanonicalDefinitionId, string>).get === 'function'
}
