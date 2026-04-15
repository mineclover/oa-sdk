import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { resolve } from 'node:path'
import type {
  CanonicalDefinitionId,
  DefinitionRegistry,
  DefinitionRegistryNode,
  DefinitionTargetConfig,
  DefinitionTargetSelectionResult,
} from '@oa-sdk/parser'
import {
  detectWorkspaceDirtyFiles,
  type WorkspaceComponentRecord,
  type WorkspaceDirtyDetectionResult,
  type WorkspaceFileRecord,
  type WorkspaceIndex,
  type WorkspaceRefRecord,
} from './workspace-index.js'

export const BUILDER_FRAGMENT_COMPONENT_SECTION = 'definition-fragment'
export const BUILDER_TARGET_COMPONENT_SECTION = 'definition-target'
export const BUILDER_TARGET_REF_POINTER_PREFIX = '#/x-oa-sdk-builder-index/directPathIds'
export const BUILDER_INDEX_OWNER = 'definition-builder'

export type BuilderWorkspaceScanOptions = {
  baseDir?: string
  targetPaths: readonly string[]
  fragmentPaths: readonly string[]
  parserVersion?: string
  runId?: string
}

export type BuilderWorkspaceIndexRecordOptions = {
  index: WorkspaceIndex
  files: readonly WorkspaceFileRecord[]
  targetPath: string
  target: DefinitionTargetConfig
  registry: DefinitionRegistry
  selection: DefinitionTargetSelectionResult
}

export type BuilderDirtyTargetOptions = {
  targetPaths?: readonly string[]
}

export type BuilderDirtyTargetResult = {
  workspaceDirty: WorkspaceDirtyDetectionResult
  dirtyTargetPaths: string[]
  dirtyTargetNames: string[]
  dirtyFragmentPaths: string[]
}

export function scanBuilderWorkspaceFiles(options: BuilderWorkspaceScanOptions): WorkspaceFileRecord[] {
  const baseDir = options.baseDir ?? process.cwd()
  const seen = new Set<string>()
  const files: WorkspaceFileRecord[] = []

  for (const filePath of [...options.targetPaths, ...options.fragmentPaths]) {
    const resolvedPath = resolve(baseDir, filePath)
    if (seen.has(resolvedPath) || !existsSync(resolvedPath)) continue
    seen.add(resolvedPath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) continue

    const content = readFileSync(resolvedPath)
    files.push({
      filePath: resolvedPath,
      realPath: realpathSync.native(resolvedPath),
      contentHash: createHash('sha256').update(content).digest('hex'),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ...(options.parserVersion ? { parserVersion: options.parserVersion } : {}),
      ...(options.runId ? { lastSeenRun: options.runId } : {}),
    })
  }

  return files.sort((a, b) => a.filePath.localeCompare(b.filePath))
}

export function recordBuilderWorkspaceIndex(options: BuilderWorkspaceIndexRecordOptions): void {
  const filesByPath = new Map(options.files.map(file => [file.filePath, file]))

  for (const file of options.files) {
    options.index.upsertFile(file)
  }

  for (const [filePath, nodes] of groupNodesByFile(options.registry.nodes)) {
    options.index.replaceFileIndex(filePath, {
      components: nodes.map(createFragmentComponentRecord),
      refs: createFragmentRefRecords(nodes, options.registry),
    })
  }

  const indexedFragmentPaths = new Set(options.registry.nodes.map(node => node.sourcePath))
  for (const file of options.files) {
    if (file.filePath === options.targetPath || indexedFragmentPaths.has(file.filePath)) continue
    options.index.replaceFileIndex(file.filePath, {})
  }

  options.index.replaceFileIndex(options.targetPath, {
    components: [
      createTargetComponentRecord(
        options.targetPath,
        options.target,
        filesByPath.get(options.targetPath)?.contentHash,
      ),
    ],
    refs: createTargetRefRecords(options.targetPath, options.selection),
  })
}

export function detectBuilderDirtyTargets(
  index: WorkspaceIndex,
  files: readonly WorkspaceFileRecord[],
  options: BuilderDirtyTargetOptions = {},
): BuilderDirtyTargetResult {
  const workspaceDirty = detectWorkspaceDirtyFiles(index, files)
  const dirtyPathSet = new Set(workspaceDirty.dirtyFilePaths)
  const targetNamesByPath = new Map<string, string>()
  const scopedTargetPaths = options.targetPaths ? new Set(options.targetPaths) : undefined

  for (const component of index.listComponents({ section: BUILDER_TARGET_COMPONENT_SECTION })) {
    if (scopedTargetPaths && !scopedTargetPaths.has(component.filePath)) continue
    targetNamesByPath.set(component.filePath, component.name)
  }

  for (const targetPath of options.targetPaths ?? []) {
    if (!targetNamesByPath.has(targetPath)) targetNamesByPath.set(targetPath, targetPath)
  }

  const dirtyTargetPaths = sortedUnique(
    [...targetNamesByPath.keys()].filter(filePath => dirtyPathSet.has(filePath)),
  )
  const dirtyTargetNames = dirtyTargetPaths.map(filePath => targetNamesByPath.get(filePath) ?? filePath)
  const dirtyFragmentPaths = sortedUnique(
    index.listComponents({ section: BUILDER_FRAGMENT_COMPONENT_SECTION })
      .map(component => component.filePath)
      .filter(filePath => dirtyPathSet.has(filePath)),
  )

  return {
    workspaceDirty,
    dirtyTargetPaths,
    dirtyTargetNames,
    dirtyFragmentPaths,
  }
}

function groupNodesByFile(
  nodes: readonly DefinitionRegistryNode[],
): ReadonlyMap<string, DefinitionRegistryNode[]> {
  const byFile = new Map<string, DefinitionRegistryNode[]>()
  for (const node of nodes) {
    const fileNodes = byFile.get(node.sourcePath)
    if (fileNodes) {
      fileNodes.push(node)
    } else {
      byFile.set(node.sourcePath, [node])
    }
  }
  return byFile
}

function createFragmentComponentRecord(node: DefinitionRegistryNode): WorkspaceComponentRecord {
  return {
    filePath: node.sourcePath,
    section: BUILDER_FRAGMENT_COMPONENT_SECTION,
    name: node.id,
    pointer: node.sourcePointer,
    contentHash: node.contentHash,
    owner: BUILDER_INDEX_OWNER,
  }
}

function createTargetComponentRecord(
  targetPath: string,
  target: DefinitionTargetConfig,
  contentHash: string | undefined,
): WorkspaceComponentRecord {
  return {
    filePath: targetPath,
    section: BUILDER_TARGET_COMPONENT_SECTION,
    name: target.name,
    pointer: '#',
    contentHash: contentHash ?? '',
    owner: BUILDER_INDEX_OWNER,
  }
}

function createFragmentRefRecords(
  nodes: readonly DefinitionRegistryNode[],
  registry: DefinitionRegistry,
): WorkspaceRefRecord[] {
  const sourceIds = new Set(nodes.map(node => node.id))
  const records: WorkspaceRefRecord[] = []

  for (const edge of registry.refEdges) {
    if (!sourceIds.has(edge.sourceId)) continue
    const targetNode = edge.targetId ? registry.nodeById.get(edge.targetId) : undefined
    const record: WorkspaceRefRecord = {
      fromFile: edge.sourcePath,
      fromPointer: edge.sourcePointer,
      refText: edge.ref,
      kind: targetNode ? 'external' : 'unsupported',
      resolved: targetNode !== undefined,
    }
    if (targetNode) {
      record.toFile = targetNode.sourcePath
      record.toPointer = targetNode.sourcePointer
    } else {
      record.diagnosticCode = edge.targetId
        ? 'definition-registry/missing-ref'
        : 'definition-registry/unsupported-ref'
    }
    records.push(record)
  }

  return records
}

function createTargetRefRecords(
  targetPath: string,
  selection: DefinitionTargetSelectionResult,
): WorkspaceRefRecord[] {
  const records: WorkspaceRefRecord[] = []

  selection.directPathIds.forEach((id, index) => {
    const node = selection.nodeById.get(id)
    if (!node) return
    records.push(createTargetRefRecord(targetPath, id, node, index))
  })

  return records
}

function createTargetRefRecord(
  targetPath: string,
  id: CanonicalDefinitionId,
  node: DefinitionRegistryNode,
  index: number,
): WorkspaceRefRecord {
  return {
    fromFile: targetPath,
    fromPointer: `${BUILDER_TARGET_REF_POINTER_PREFIX}/${index}`,
    refText: id,
    kind: 'external',
    resolved: true,
    toFile: node.sourcePath,
    toPointer: node.sourcePointer,
  }
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
