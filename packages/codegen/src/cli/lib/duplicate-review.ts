import { resolve } from 'node:path'
import {
  allocateDefinitionOutputNames,
  createDefinitionRegistry,
  selectDefinitionTarget,
  type CanonicalDefinitionId,
  type DefinitionKind,
  type DefinitionNode,
  type DefinitionOutputNameCollisionReportEntry,
  type DefinitionOutputNameDiagnostic,
  type DefinitionRegistryDiagnostic,
  type DefinitionSemanticAlias,
  type DefinitionTargetConfig,
  type DefinitionTargetDiagnostic,
} from '@oa-sdk/parser'
import {
  loadDefinitionFragments,
  loadDefinitionTargetConfig,
  lookupDefinitionSourceLocation,
  type DefinitionFragmentLoadDiagnostic,
} from './definition-fragments.js'

export const DEFINITION_DUPLICATE_REVIEW_SCHEMA_VERSION = 'oa-gen.duplicate-review.v1'

export type DefinitionDuplicateReviewOptions = {
  fragmentsDir: string
  targetPaths?: readonly string[]
  targets?: readonly DefinitionDuplicateReviewTargetInput[]
}

export type DefinitionDuplicateReviewTargetInput = {
  target: DefinitionTargetConfig
  targetPath?: string
}

export type DefinitionDuplicateReviewSeverity = 'error' | 'warning' | 'info'

export type DefinitionDuplicateReviewFindingCode =
  | 'definition-duplicate-review/duplicate-canonical-id'
  | 'definition-duplicate-review/same-content-hash'
  | 'definition-duplicate-review/same-local-name-different-shape'
  | 'definition-duplicate-review/output-name-collision'
  | 'definition-duplicate-review/semantic-alias'

export type DefinitionDuplicateReviewSource = {
  canonicalId: CanonicalDefinitionId
  kind: DefinitionKind
  scope: string
  domain: string
  localName: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
}

export type DefinitionDuplicateReviewFinding = {
  code: DefinitionDuplicateReviewFindingCode
  severity: DefinitionDuplicateReviewSeverity
  message: string
  canonicalIds: CanonicalDefinitionId[]
  sources: DefinitionDuplicateReviewSource[]
  kind?: DefinitionKind
  localName?: string
  contentHash?: string
  contentHashes?: string[]
  targetName?: string
  targetPath?: string
  outputName?: string
  outputNameReport?: DefinitionOutputNameCollisionReportEntry[]
  semanticAlias?: DefinitionDuplicateReviewSemanticAlias
}

export type DefinitionDuplicateReviewSemanticAlias = {
  sourceId: CanonicalDefinitionId
  targetId: CanonicalDefinitionId
  sourcePath: string
  sourcePointer: string
  sourceContentHash: string
  targetSourcePath: string
  targetSourcePointer: string
  targetContentHash: string
}

export type DefinitionDuplicateReviewDiagnostic =
  | DefinitionFragmentLoadDiagnostic
  | DefinitionRegistryDiagnostic
  | DefinitionTargetDiagnostic
  | DefinitionOutputNameDiagnostic

export type DefinitionDuplicateReviewSummary = {
  fragmentCount: number
  targetCount: number
  findingCount: number
  diagnosticCount: number
  errors: number
  warnings: number
  infos: number
  findingsByCode: Record<DefinitionDuplicateReviewFindingCode, number>
}

export type DefinitionDuplicateReviewResult = {
  schemaVersion: typeof DEFINITION_DUPLICATE_REVIEW_SCHEMA_VERSION
  valid: boolean
  fragmentsDir: string
  targets: Array<{ name: string; targetPath?: string }>
  diagnostics: DefinitionDuplicateReviewDiagnostic[]
  findings: DefinitionDuplicateReviewFinding[]
  summary: DefinitionDuplicateReviewSummary
}

type OutputNameContext = {
  targetName: string
  targetPath?: string
  synthetic?: boolean
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionNode>
  diagnostics: DefinitionDuplicateReviewDiagnostic[]
  collisionReport: DefinitionOutputNameCollisionReportEntry[]
}

export function analyzeDefinitionDuplicateReview(
  options: DefinitionDuplicateReviewOptions,
): DefinitionDuplicateReviewResult {
  const fragmentsDir = resolve(process.cwd(), options.fragmentsDir)
  const fragments = loadDefinitionFragments(fragmentsDir)
  const registry = createDefinitionRegistry(fragments.nodes, {
    structuralDuplicateSeverity: 'off',
    lookupSourceLocation(sourcePath, sourcePointer) {
      return lookupDefinitionSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
    },
  })
  const targetInputs = loadTargetInputs(options)
  const outputNameContexts = createOutputNameContexts(registry.nodes, targetInputs)
  const diagnostics: DefinitionDuplicateReviewDiagnostic[] = [
    ...fragments.diagnostics,
    ...registry.diagnostics,
    ...outputNameContexts.flatMap(context => context.diagnostics),
  ]
  const findings = [
    ...collectDuplicateCanonicalIdFindings(fragments.nodes),
    ...collectSameContentHashFindings(fragments.nodes, registry.semanticAliases),
    ...collectSameLocalNameDifferentShapeFindings(fragments.nodes),
    ...collectOutputNameCollisionFindings(outputNameContexts),
    ...collectSemanticAliasFindings(registry.semanticAliases, registry.nodeById),
  ].sort(compareFindings)
  const summary = createSummary(fragments.nodes.length, targetInputs.length, findings, diagnostics)
  const valid = summary.errors === 0

  return {
    schemaVersion: DEFINITION_DUPLICATE_REVIEW_SCHEMA_VERSION,
    valid,
    fragmentsDir,
    targets: outputNameContexts
      .filter(context => context.targetName !== 'all-fragments')
      .map(context => ({
        name: context.targetName,
        ...(context.targetPath !== undefined ? { targetPath: context.targetPath } : {}),
      })),
    diagnostics,
    findings,
    summary,
  }
}

function loadTargetInputs(options: DefinitionDuplicateReviewOptions): DefinitionDuplicateReviewTargetInput[] {
  const targets: DefinitionDuplicateReviewTargetInput[] = []
  for (const target of options.targets ?? []) {
    targets.push(target)
  }

  for (const targetPathInput of options.targetPaths ?? []) {
    const targetPath = resolve(process.cwd(), targetPathInput)
    targets.push({
      targetPath,
      target: loadDefinitionTargetConfig(targetPath),
    })
  }

  return targets
}

function createOutputNameContexts(
  nodes: readonly DefinitionNode[],
  targetInputs: readonly DefinitionDuplicateReviewTargetInput[],
): OutputNameContext[] {
  if (targetInputs.length === 0) {
    const allocation = allocateDefinitionOutputNames(nodes, { targetName: 'all-fragments' })
    return [{
      targetName: 'all-fragments',
      synthetic: true,
      nodeById: nodeMap(nodes),
      diagnostics: [...allocation.diagnostics],
      collisionReport: [...allocation.collisionReport],
    }]
  }

  return targetInputs.map(input => {
    const registry = createDefinitionRegistry(nodes, { structuralDuplicateSeverity: 'off' })
    const selection = selectDefinitionTarget(registry, input.target)
    return {
      targetName: input.target.name,
      ...(input.targetPath !== undefined ? { targetPath: input.targetPath } : {}),
      nodeById: selection.nodeById,
      diagnostics: [
        ...selection.diagnostics,
        ...selection.outputNameAllocation.diagnostics,
      ],
      collisionReport: [...selection.outputNameAllocation.collisionReport],
    }
  })
}

function collectDuplicateCanonicalIdFindings(
  nodes: readonly DefinitionNode[],
): DefinitionDuplicateReviewFinding[] {
  const groups = groupNodes(nodes, node => node.id)
  const findings: DefinitionDuplicateReviewFinding[] = []

  for (const [canonicalId, group] of groups) {
    if (group.length <= 1) continue
    const sources = sourceEntries(group)
    findings.push({
      code: 'definition-duplicate-review/duplicate-canonical-id',
      severity: 'error',
      canonicalIds: [canonicalId as CanonicalDefinitionId],
      sources,
      message: `Duplicate canonical id "${canonicalId}" appears in ${sources.length} fragment sources.`,
    })
  }

  return findings
}

function collectSameContentHashFindings(
  nodes: readonly DefinitionNode[],
  semanticAliases: readonly DefinitionSemanticAlias[],
): DefinitionDuplicateReviewFinding[] {
  const groups = groupNodes(nodes, node => node.contentHash)
  const findings: DefinitionDuplicateReviewFinding[] = []
  const intentionallyAliasedSourceIds = collectIntentionallyAliasedSourceIds(groups, semanticAliases)

  for (const [contentHash, group] of groups) {
    const unaliasedGroup = group.filter(node => !intentionallyAliasedSourceIds.has(node.id))
    const canonicalIds = distinctCanonicalIds(unaliasedGroup)
    if (canonicalIds.length <= 1) continue
    const sources = sourceEntries(unaliasedGroup)
    findings.push({
      code: 'definition-duplicate-review/same-content-hash',
      severity: 'info',
      canonicalIds,
      sources,
      contentHash,
      message: `Content hash "${contentHash}" is shared by ${canonicalIds.length} canonical ids.`,
    })
  }

  return findings
}

function collectIntentionallyAliasedSourceIds(
  groups: ReadonlyMap<string, readonly DefinitionNode[]>,
  semanticAliases: readonly DefinitionSemanticAlias[],
): Set<CanonicalDefinitionId> {
  const aliasedSourceIds = new Set<CanonicalDefinitionId>()

  for (const group of groups.values()) {
    const groupIds = new Set(group.map(node => node.id))
    for (const alias of semanticAliases) {
      if (groupIds.has(alias.sourceId) && groupIds.has(alias.targetId)) {
        aliasedSourceIds.add(alias.sourceId)
      }
    }
  }

  return aliasedSourceIds
}

function collectSameLocalNameDifferentShapeFindings(
  nodes: readonly DefinitionNode[],
): DefinitionDuplicateReviewFinding[] {
  const groups = groupNodes(nodes, node => `${node.kind}\0${node.localName}`)
  const findings: DefinitionDuplicateReviewFinding[] = []

  for (const group of groups.values()) {
    const canonicalIds = distinctCanonicalIds(group)
    const contentHashes = [...new Set(group.map(node => node.contentHash))].sort()
    if (canonicalIds.length <= 1 || contentHashes.length <= 1) continue

    const first = group[0]
    if (!first) continue
    const sources = sourceEntries(group)
    findings.push({
      code: 'definition-duplicate-review/same-local-name-different-shape',
      severity: 'warning',
      canonicalIds,
      sources,
      kind: first.kind,
      localName: first.localName,
      contentHashes,
      message: `${first.kind} local name "${first.localName}" is used by ${canonicalIds.length} canonical ids with ${contentHashes.length} different content hashes.`,
    })
  }

  return findings
}

function collectOutputNameCollisionFindings(
  contexts: readonly OutputNameContext[],
): DefinitionDuplicateReviewFinding[] {
  const findings: DefinitionDuplicateReviewFinding[] = []

  for (const context of contexts) {
    const collisionEntries = context.collisionReport
      .filter(entry => entry.reason === 'output-name-collision')
    const collisionGroups = groupValues(collisionEntries, entry => `${entry.kind}\0${entry.outputName}`)

    for (const group of collisionGroups.values()) {
      const first = group[0]
      if (!first) continue
      const canonicalIds = [...new Set(group.map(entry => entry.canonicalId))].sort()
      if (canonicalIds.length <= 1) continue

      const sources = sourceEntries(canonicalIds
        .map(id => context.nodeById.get(id))
        .filter(isDefinitionNode))
      const severity = context.synthetic ? 'warning' : 'error'
      const finding: DefinitionDuplicateReviewFinding = {
        code: 'definition-duplicate-review/output-name-collision',
        severity,
        canonicalIds,
        sources,
        kind: first.kind,
        localName: first.localName,
        targetName: context.targetName,
        outputName: first.outputName,
        outputNameReport: group,
        message: context.synthetic
          ? `Synthetic "${context.targetName}" output name "${first.outputName}" for ${first.kind} collides between ${canonicalIds.length} canonical ids.`
          : `Target "${context.targetName}" output name "${first.outputName}" for ${first.kind} collides between ${canonicalIds.length} canonical ids.`,
      }
      if (context.targetPath !== undefined) finding.targetPath = context.targetPath
      findings.push(finding)
    }
  }

  return findings
}

function collectSemanticAliasFindings(
  aliases: readonly DefinitionSemanticAlias[],
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionNode>,
): DefinitionDuplicateReviewFinding[] {
  return aliases.map(alias => {
    const sources = sourceEntries([
      nodeById.get(alias.sourceId),
      nodeById.get(alias.targetId),
    ].filter(isDefinitionNode))
    const semanticAlias: DefinitionDuplicateReviewSemanticAlias = {
      sourceId: alias.sourceId,
      targetId: alias.targetId,
      sourcePath: alias.sourcePath,
      sourcePointer: alias.sourcePointer,
      sourceContentHash: alias.sourceContentHash,
      targetSourcePath: alias.targetSourcePath,
      targetSourcePointer: alias.targetSourcePointer,
      targetContentHash: alias.targetContentHash,
    }

    return {
      code: 'definition-duplicate-review/semantic-alias',
      severity: 'info',
      canonicalIds: [alias.sourceId, alias.targetId].sort(),
      sources,
      semanticAlias,
      message: `Definition "${alias.sourceId}" declares semanticAliasOf "${alias.targetId}".`,
    }
  })
}

function createSummary(
  fragmentCount: number,
  targetCount: number,
  findings: readonly DefinitionDuplicateReviewFinding[],
  diagnostics: readonly DefinitionDuplicateReviewDiagnostic[],
): DefinitionDuplicateReviewSummary {
  const severities = [...findings, ...diagnostics].map(item => item.severity)
  return {
    fragmentCount,
    targetCount,
    findingCount: findings.length,
    diagnosticCount: diagnostics.length,
    errors: severities.filter(severity => severity === 'error').length,
    warnings: severities.filter(severity => severity === 'warning').length,
    infos: severities.filter(severity => severity === 'info').length,
    findingsByCode: countFindingsByCode(findings),
  }
}

function countFindingsByCode(
  findings: readonly DefinitionDuplicateReviewFinding[],
): Record<DefinitionDuplicateReviewFindingCode, number> {
  return {
    'definition-duplicate-review/duplicate-canonical-id': countFindings(findings, 'definition-duplicate-review/duplicate-canonical-id'),
    'definition-duplicate-review/same-content-hash': countFindings(findings, 'definition-duplicate-review/same-content-hash'),
    'definition-duplicate-review/same-local-name-different-shape': countFindings(findings, 'definition-duplicate-review/same-local-name-different-shape'),
    'definition-duplicate-review/output-name-collision': countFindings(findings, 'definition-duplicate-review/output-name-collision'),
    'definition-duplicate-review/semantic-alias': countFindings(findings, 'definition-duplicate-review/semantic-alias'),
  }
}

function countFindings(
  findings: readonly DefinitionDuplicateReviewFinding[],
  code: DefinitionDuplicateReviewFindingCode,
): number {
  return findings.filter(finding => finding.code === code).length
}

function sourceEntries(nodes: readonly DefinitionNode[]): DefinitionDuplicateReviewSource[] {
  return nodes
    .map(node => ({
      canonicalId: node.id,
      kind: node.kind,
      scope: node.scope,
      domain: node.domain,
      localName: node.localName,
      sourcePath: node.sourcePath,
      sourcePointer: node.sourcePointer,
      contentHash: node.contentHash,
    }))
    .sort(compareSources)
}

function distinctCanonicalIds(nodes: readonly DefinitionNode[]): CanonicalDefinitionId[] {
  return [...new Set(nodes.map(node => node.id))].sort()
}

function nodeMap(nodes: readonly DefinitionNode[]): ReadonlyMap<CanonicalDefinitionId, DefinitionNode> {
  const output = new Map<CanonicalDefinitionId, DefinitionNode>()
  for (const node of nodes) {
    if (!output.has(node.id)) output.set(node.id, node)
  }
  return output
}

function groupNodes(
  nodes: readonly DefinitionNode[],
  keyFor: (node: DefinitionNode) => string,
): Map<string, DefinitionNode[]> {
  return groupValues(nodes, keyFor)
}

function groupValues<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = keyFor(value)
    const group = groups.get(key)
    if (group) {
      group.push(value)
    } else {
      groups.set(key, [value])
    }
  }
  return groups
}

function compareFindings(
  left: DefinitionDuplicateReviewFinding,
  right: DefinitionDuplicateReviewFinding,
): number {
  return left.code.localeCompare(right.code)
    || compareOptional(left.targetName, right.targetName)
    || compareOptional(left.kind, right.kind)
    || compareOptional(left.localName, right.localName)
    || compareOptional(left.outputName, right.outputName)
    || compareOptional(left.contentHash, right.contentHash)
    || left.canonicalIds.join('\0').localeCompare(right.canonicalIds.join('\0'))
}

function compareSources(
  left: DefinitionDuplicateReviewSource,
  right: DefinitionDuplicateReviewSource,
): number {
  return left.canonicalId.localeCompare(right.canonicalId)
    || left.sourcePath.localeCompare(right.sourcePath)
    || left.sourcePointer.localeCompare(right.sourcePointer)
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  return (left ?? '').localeCompare(right ?? '')
}

function isDefinitionNode(value: DefinitionNode | undefined): value is DefinitionNode {
  return value !== undefined
}

export function formatDefinitionDuplicateReviewMarkdown(
  report: DefinitionDuplicateReviewResult,
): string {
  const lines = [
    '## Definition Duplicate Review',
    '',
    `Fragments: \`${markdownCode(report.fragmentsDir)}\``,
    targetLine(report),
    `Summary: ${report.summary.findingCount} findings, ${report.summary.diagnosticCount} diagnostics, ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos.`,
    '',
    '### Findings',
    ...findingLines(report.findings),
  ]

  if (report.diagnostics.length > 0) {
    lines.push(
      '',
      '### Diagnostics',
      ...diagnosticLines(report.diagnostics),
    )
  }

  return lines.join('\n')
}

function targetLine(report: DefinitionDuplicateReviewResult): string {
  if (report.targets.length === 0) return 'Targets: all fragments (synthetic naming review)'
  return `Targets: ${report.targets.map(target => target.targetPath
    ? `${target.name} (${target.targetPath})`
    : target.name).map(markdownText).join(', ')}`
}

function findingLines(findings: readonly DefinitionDuplicateReviewFinding[]): string[] {
  if (findings.length === 0) return ['None.']
  return [
    '| Severity | Finding | Detail | Sources |',
    '| --- | --- | --- | --- |',
    ...findings.map(finding => [
      markdownText(finding.severity),
      `\`${markdownCode(shortFindingCode(finding.code))}\``,
      markdownText(findingDetail(finding)),
      finding.sources.length === 0
        ? '-'
        : finding.sources.map(source => (
          `\`${markdownCode(source.canonicalId)}\`<br>${markdownText(source.sourcePath)}${markdownText(source.sourcePointer)}`
        )).join('<br>'),
    ].join(' | ')).map(row => `| ${row} |`),
  ]
}

function diagnosticLines(diagnostics: readonly DefinitionDuplicateReviewDiagnostic[]): string[] {
  return [
    '| Severity | Code | Source | Message |',
    '| --- | --- | --- | --- |',
    ...diagnostics.map(diagnostic => [
      markdownText(diagnostic.severity),
      `\`${markdownCode(shortDiagnosticCode(diagnostic.code))}\``,
      markdownText(diagnosticSource(diagnostic) ?? '-'),
      markdownText(diagnostic.message),
    ].join(' | ')).map(row => `| ${row} |`),
  ]
}

function findingDetail(finding: DefinitionDuplicateReviewFinding): string {
  if (finding.semanticAlias) {
    return `${finding.semanticAlias.sourceId} -> ${finding.semanticAlias.targetId}`
  }
  if (finding.outputName) {
    return `${finding.targetName ?? 'all-fragments'} ${finding.kind ?? 'definition'} output "${finding.outputName}": ${finding.canonicalIds.join(', ')}`
  }
  if (finding.contentHash) {
    return `${finding.contentHash}: ${finding.canonicalIds.join(', ')}`
  }
  if (finding.kind && finding.localName) {
    return `${finding.kind} "${finding.localName}": ${finding.canonicalIds.join(', ')}`
  }
  return finding.canonicalIds.join(', ')
}

function diagnosticSource(diagnostic: DefinitionDuplicateReviewDiagnostic): string | undefined {
  if ('sourcePath' in diagnostic && typeof diagnostic.sourcePath === 'string') {
    return `${diagnostic.sourcePath}${diagnostic.sourcePointer ?? ''}`
  }
  if ('path' in diagnostic && typeof diagnostic.path === 'string') return diagnostic.path
  if ('pointer' in diagnostic && typeof diagnostic.pointer === 'string') return diagnostic.pointer
  return undefined
}

function shortFindingCode(code: DefinitionDuplicateReviewFindingCode): string {
  return code.replace('definition-duplicate-review/', '')
}

function shortDiagnosticCode(code: string): string {
  return code.replace(/^definition-[^/]+\//, '')
}

function markdownText(value: unknown): string {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function markdownCode(value: unknown): string {
  return markdownText(value).replace(/`/g, '\\`')
}
