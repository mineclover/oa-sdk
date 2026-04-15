import { resolve } from 'node:path'
import type { OasDocument, RefGraphDiagnostic, RefGraphNode } from '@oa-sdk/parser'
import { createCliSourceLocationResolver, type CliSourceLocationResolver } from './source-locations.js'
import {
  createWorkspaceIndex,
  detectWorkspaceDirtyFiles,
  invalidateWorkspaceDirtyFiles,
  listWorkspaceExternalRefFiles,
  scanWorkspaceFiles,
  type WorkspaceDiagnosticRecord,
  type WorkspaceDirtyDetectionResult,
  type WorkspaceFileRecord,
  type WorkspaceIndex,
  type WorkspaceIndexCompatibilityMetadata,
  type WorkspaceRefRecord,
  type WorkspaceTypeAliasRecord,
} from '../../workspace-index.js'

const CLI_WORKSPACE_INDEX_VERSION = 'oa-gen-cli-incremental-v1'

export type CliIncrementalRunOptions = {
  enabled: boolean
  specPath: string
  cacheDir?: string
  compatibility?: WorkspaceIndexCompatibilityMetadata
}

export type CliIncrementalRun = {
  enabled: boolean
  resolvedSpecPath: string
  runId: string
  index: WorkspaceIndex
  scannedFiles: WorkspaceFileRecord[]
  dirty: WorkspaceDirtyDetectionResult
}

export type RecordCliIncrementalIndexOptions = {
  diagnostics?: readonly WorkspaceDiagnosticRecord[]
  typeAliases?: readonly WorkspaceTypeAliasRecord[]
}

export function createCliIncrementalRun(options: CliIncrementalRunOptions): CliIncrementalRun {
  const resolvedSpecPath = resolve(process.cwd(), options.specPath)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const index = createWorkspaceIndex(options.enabled ? {
    mode: 'sqlite',
    ...(options.cacheDir ? { cacheDir: resolve(process.cwd(), options.cacheDir) } : {}),
    ...(options.compatibility ? { compatibility: options.compatibility } : {}),
  } : { mode: 'noop' })
  const fallbackReason = workspaceIndexFallbackReason(index)
  if (options.enabled && fallbackReason) {
    console.warn(`⚠️  SQLite workspace index unavailable; falling back to full rebuild: ${fallbackReason}`)
  }
  const externalRefFiles = options.enabled ? listWorkspaceExternalRefFiles(index) : []
  const scannedFiles = scanWorkspaceFiles({
    entrySpecs: [resolvedSpecPath],
    externalRefFiles,
    parserVersion: CLI_WORKSPACE_INDEX_VERSION,
    runId,
  })
  const dirty = detectWorkspaceDirtyFiles(index, scannedFiles)
  if (options.enabled) invalidateWorkspaceDirtyFiles(index, dirty)

  return {
    enabled: options.enabled,
    resolvedSpecPath,
    runId,
    index,
    scannedFiles,
    dirty,
  }
}

export async function recordCliIncrementalIndex(
  run: CliIncrementalRun,
  doc: OasDocument,
  options: RecordCliIncrementalIndexOptions = {},
): Promise<WorkspaceFileRecord[]> {
  if (!run.enabled) return run.scannedFiles

  const { resolveRefGraph } = await import('@oa-sdk/parser')
  const graph = resolveRefGraph(doc, { basePath: run.resolvedSpecPath })
  const discoveredFiles = scanWorkspaceFiles({
    entrySpecs: [run.resolvedSpecPath],
    externalRefFiles: collectGraphFilePaths(graph.nodes, graph.diagnostics),
    parserVersion: CLI_WORKSPACE_INDEX_VERSION,
    runId: run.runId,
  })
  const discoveredFilePaths = new Set(discoveredFiles.map(file => file.filePath))
  const sourceLocations = createCliSourceLocationResolver()

  for (const file of discoveredFiles) run.index.upsertFile(file)

  const diagnosticsByNode = mapDiagnosticsByNode(graph.diagnostics)
  const refsByFile = new Map<string, WorkspaceRefRecord[]>()
  for (const node of graph.nodes) {
    const fromFile = node.sourceFilePath ?? run.resolvedSpecPath
    if (!discoveredFilePaths.has(fromFile)) continue

    appendByFile(refsByFile, fromFile, toWorkspaceRefRecord(
      node,
      fromFile,
      diagnosticsByNode.get(nodeKey(node)),
    ))
  }

  const diagnosticsByOwner = new Map<string, WorkspaceDiagnosticRecord[]>()
  for (const diagnostic of graph.diagnostics) {
    const ownerFile = diagnostic.sourceFilePath ?? run.resolvedSpecPath
    if (!discoveredFilePaths.has(ownerFile)) continue
    appendByFile(diagnosticsByOwner, ownerFile, toWorkspaceDiagnosticRecord('ref-graph', diagnostic, sourceLocations))
  }
  for (const diagnostic of options.diagnostics ?? []) {
    const ownerFile = diagnostic.filePath ?? run.resolvedSpecPath
    if (!discoveredFilePaths.has(ownerFile)) continue
    appendByFile(diagnosticsByOwner, ownerFile, { ...diagnostic })
  }
  const typeAliasesByOwner = new Map<string, WorkspaceTypeAliasRecord[]>()
  for (const alias of options.typeAliases ?? []) {
    if (!discoveredFilePaths.has(alias.sourceFile)) continue
    appendByFile(typeAliasesByOwner, alias.sourceFile, { ...alias })
  }

  for (const file of discoveredFiles) {
    run.index.replaceFileIndex(file.filePath, {
      refs: refsByFile.get(file.filePath) ?? [],
      sourceLocations: sourceLocations.list(file.filePath),
      diagnostics: diagnosticsByOwner.get(file.filePath) ?? [],
      typeAliases: typeAliasesByOwner.get(file.filePath) ?? [],
    })
  }

  return discoveredFiles
}

export function closeCliIncrementalRun(run: CliIncrementalRun): void {
  const maybeClosable = run.index as WorkspaceIndex & { close?: () => void }
  maybeClosable.close?.()
}

function collectGraphFilePaths(
  nodes: readonly RefGraphNode[],
  diagnostics: readonly RefGraphDiagnostic[],
): string[] {
  const paths = new Set<string>()
  for (const node of nodes) {
    if (node.sourceFilePath) paths.add(node.sourceFilePath)
    if (node.filePath) paths.add(node.filePath)
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.sourceFilePath) paths.add(diagnostic.sourceFilePath)
    if (diagnostic.filePath) paths.add(diagnostic.filePath)
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

function mapDiagnosticsByNode(diagnostics: readonly RefGraphDiagnostic[]): Map<string, RefGraphDiagnostic> {
  const byNode = new Map<string, RefGraphDiagnostic>()
  for (const diagnostic of diagnostics) {
    const keyInput: { ref: string; sourcePointer: string; sourceFilePath?: string } = {
      ref: diagnostic.ref,
      sourcePointer: diagnostic.sourcePointer ?? '',
    }
    if (diagnostic.sourceFilePath) keyInput.sourceFilePath = diagnostic.sourceFilePath
    byNode.set(nodeKey(keyInput), diagnostic)
  }
  return byNode
}

function toWorkspaceRefRecord(
  node: RefGraphNode,
  fromFile: string,
  diagnostic: RefGraphDiagnostic | undefined,
): WorkspaceRefRecord {
  const toFile = node.filePath ?? (node.kind === 'internal' ? fromFile : undefined)
  const record: WorkspaceRefRecord = {
    fromFile,
    fromPointer: node.sourcePointer,
    refText: node.ref,
    kind: node.kind,
    resolved: node.resolved,
  }
  if (toFile) record.toFile = toFile
  if (node.pointer) record.toPointer = node.pointer
  if (diagnostic) record.diagnosticCode = diagnostic.code
  return record
}

function toWorkspaceDiagnosticRecord(
  producer: string,
  diagnostic: RefGraphDiagnostic,
  sourceLocations: CliSourceLocationResolver,
): WorkspaceDiagnosticRecord {
  const record: WorkspaceDiagnosticRecord = {
    producer,
    severity: 'error',
    code: diagnostic.code,
    message: diagnostic.message,
  }
  if (diagnostic.sourceFilePath) record.filePath = diagnostic.sourceFilePath
  if (diagnostic.sourcePointer) record.pointer = diagnostic.sourcePointer
  if (diagnostic.line !== undefined && diagnostic.column !== undefined) {
    record.line = diagnostic.line
    record.column = diagnostic.column
  } else if (diagnostic.sourceFilePath && diagnostic.sourcePointer) {
    const location = sourceLocations.lookup(diagnostic.sourceFilePath, diagnostic.sourcePointer)
    if (location) {
      record.line = location.line
      record.column = location.column
    }
  }
  return record
}

function appendByFile<T extends object>(map: Map<string, T[]>, filePath: string, record: T): void {
  const records = map.get(filePath) ?? []
  records.push(record)
  map.set(filePath, records)
}

function nodeKey(node: { ref: string; sourcePointer: string; sourceFilePath?: string }): string {
  return `${node.sourceFilePath ?? ''}|${node.sourcePointer}|${node.ref}`
}

function workspaceIndexFallbackReason(index: WorkspaceIndex): string | undefined {
  const maybeFallback = index as WorkspaceIndex & { fallbackReason?: unknown }
  return typeof maybeFallback.fallbackReason === 'string' && maybeFallback.fallbackReason
    ? maybeFallback.fallbackReason
    : undefined
}
