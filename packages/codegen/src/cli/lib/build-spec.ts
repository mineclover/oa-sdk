import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  extname,
  join,
  resolve,
} from 'node:path'
import {
  createDefinitionNode,
  createDefinitionRegistry,
  createSourceLocationIndex,
  emitDefinitionOpenApiDocument,
  selectDefinitionTarget,
  toDefinitionOpenApiProjectionResult,
  type DefinitionNode,
  type DefinitionOpenApiEmitDiagnostic,
  type DefinitionOpenApiProjectionResult,
  type DefinitionOutputNameCollisionReportEntry,
  type DefinitionRegistryDiagnostic,
  type DefinitionTargetConfig,
  type OasDocument,
  type OasServer,
  type SourceLocation,
  type SourceLocationIndex,
} from '@oa-sdk/parser'
import type { SchemaDiagnostic } from '@oa-sdk/openapi-projection-contract'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  detectBuilderDirtyTargets,
  recordBuilderWorkspaceIndex,
  scanBuilderWorkspaceFiles,
  type BuilderDirtyTargetResult,
} from '../../builder-index.js'
import type { WorkspaceIndex } from '../../workspace-index.js'

export type BuildSpecOptions = {
  targetPath: string
  fragmentsDir?: string
  outputPath?: string
  diagnosticsPath?: string
  collisionReportPath?: string
  workspaceIndex?: WorkspaceIndex
  parserVersion?: string
  runId?: string
}

export type BuildSpecCliDiagnostic = {
  code: 'definition-fragment/invalid-fragment'
  severity: 'error'
  message: string
  sourcePath: string
  sourcePointer?: string
}

export type BuildSpecDiagnostic =
  | BuildSpecCliDiagnostic
  | DefinitionRegistryDiagnostic
  | DefinitionOpenApiEmitDiagnostic

export type BuildSpecSummary = {
  valid: boolean
  targetName: string
  targetPath: string
  fragmentsDir: string
  fragmentCount: number
  selectedNodeCount: number
  directPathIds: string[]
  dirtyTargetPaths?: string[]
  dirtyTargetNames?: string[]
  outputPath?: string
  diagnosticsPath?: string
  collisionReportPath?: string
  errors: number
  warnings: number
  infos: number
}

export type BuildSpecResult = {
  valid: boolean
  document: OasDocument
  projection: DefinitionOpenApiProjectionResult
  diagnostics: BuildSpecDiagnostic[]
  collisionReport: DefinitionOutputNameCollisionReportEntry[]
  summary: BuildSpecSummary
  dirty?: BuilderDirtyTargetResult
}

type LoadedFragments = {
  nodes: DefinitionNode[]
  diagnostics: BuildSpecCliDiagnostic[]
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>
  filePaths: string[]
}

export function buildSpec(options: BuildSpecOptions): BuildSpecResult {
  const targetPath = resolve(process.cwd(), options.targetPath)
  const fragmentsDir = resolve(
    process.cwd(),
    options.fragmentsDir ?? join(dirname(targetPath), '..', 'fragments'),
  )
  const target = loadTargetConfig(targetPath)
  const fragments = loadDefinitionFragments(fragmentsDir)
  const scannedFiles = options.workspaceIndex
    ? scanBuilderWorkspaceFiles({
      targetPaths: [targetPath],
      fragmentPaths: fragments.filePaths,
      ...(options.parserVersion ? { parserVersion: options.parserVersion } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    })
    : []
  const dirty = options.workspaceIndex
    ? detectBuilderDirtyTargets(options.workspaceIndex, scannedFiles, { targetPaths: [targetPath] })
    : undefined
  const registry = createDefinitionRegistry(fragments.nodes, {
    lookupSourceLocation(sourcePath, sourcePointer) {
      return lookupSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
    },
  })
  const selection = selectDefinitionTarget(registry, target)
  const emitted = emitDefinitionOpenApiDocument(selection)
  const baseProjection = toDefinitionOpenApiProjectionResult({ registry, selection, emitted }, {
    lookupSourceLocation(sourcePath, sourcePointer) {
      return lookupSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
    },
  })
  const projection: DefinitionOpenApiProjectionResult = fragments.diagnostics.length === 0
    ? baseProjection
    : {
        ...baseProjection,
        diagnostics: [
          ...fragments.diagnostics.map(diagnostic => toProjectionDiagnostic(
            diagnostic,
            fragments.sourceLocations,
          )),
          ...baseProjection.diagnostics,
        ],
      }
  const diagnostics: BuildSpecDiagnostic[] = [
    ...fragments.diagnostics,
    ...registry.diagnostics,
    ...emitted.diagnostics,
  ]
  const valid = diagnostics.every(diagnostic => diagnostic.severity !== 'error')
  const outputPath = options.outputPath ? resolve(process.cwd(), options.outputPath) : undefined
  const diagnosticsPath = options.diagnosticsPath ? resolve(process.cwd(), options.diagnosticsPath) : undefined
  const collisionReportPath = options.collisionReportPath
    ? resolve(process.cwd(), options.collisionReportPath)
    : undefined
  const summary: BuildSpecSummary = {
    valid,
    targetName: target.name,
    targetPath,
    fragmentsDir,
    fragmentCount: fragments.nodes.length,
    selectedNodeCount: selection.nodes.length,
    directPathIds: selection.directPathIds,
    errors: diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length,
    infos: diagnostics.filter(diagnostic => diagnostic.severity === 'info').length,
  }

  if (outputPath !== undefined) summary.outputPath = outputPath
  if (diagnosticsPath !== undefined) summary.diagnosticsPath = diagnosticsPath
  if (collisionReportPath !== undefined) summary.collisionReportPath = collisionReportPath
  if (dirty !== undefined) {
    summary.dirtyTargetPaths = dirty.dirtyTargetPaths
    summary.dirtyTargetNames = dirty.dirtyTargetNames
  }

  if (diagnosticsPath !== undefined) {
    writeJsonFile(diagnosticsPath, {
      valid,
      summary,
      diagnostics,
    })
  }

  if (collisionReportPath !== undefined) {
    writeJsonFile(collisionReportPath, emitted.report.collisionReport)
  }

  if (valid) {
    const yaml = stringifyYaml(emitted.document)
    if (outputPath !== undefined) {
      writeTextFile(outputPath, yaml)
    } else {
      process.stdout.write(yaml)
    }
  }

  if (options.workspaceIndex !== undefined) {
    recordBuilderWorkspaceIndex({
      index: options.workspaceIndex,
      files: scannedFiles,
      targetPath,
      target,
      registry,
      selection,
    })
  }

  return {
    valid,
    document: emitted.document,
    projection,
    diagnostics,
    collisionReport: emitted.report.collisionReport,
    summary,
    ...(dirty !== undefined ? { dirty } : {}),
  }
}

function toProjectionDiagnostic(
  diagnostic: BuildSpecCliDiagnostic,
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>,
): SchemaDiagnostic {
  const pointer = diagnostic.sourcePointer ?? '#'
  const location = lookupSourceLocation(sourceLocations, diagnostic.sourcePath, pointer)

  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    source: {
      kind: 'file',
      filePath: diagnostic.sourcePath,
      pointer,
      ...(location?.line !== undefined ? { line: location.line } : {}),
      ...(location?.column !== undefined ? { column: location.column } : {}),
    },
  }
}

function loadTargetConfig(targetPath: string): DefinitionTargetConfig {
  const raw = readFileSync(targetPath, 'utf8')
  const parsed = parseDocument(raw, targetPath)
  if (!isRecord(parsed)) {
    throw new Error(`Target config must be an object: ${targetPath}`)
  }

  const name = readRequiredString(parsed, 'name', targetPath)
  const scopes = readStringArray(parsed, 'scopes', targetPath)
  const domains = readStringArray(parsed, 'domains', targetPath)
  const servers = readServerArray(parsed, 'servers', targetPath)
  const includePaths = readStringArray(parsed, 'includePaths', targetPath)
  const config: DefinitionTargetConfig = {
    name,
    scopes,
    domains,
    servers,
    includePaths,
  }
  const aliases = readAliases(parsed)
  if (aliases !== undefined) {
    config.namingPolicy = { aliases }
  }

  return config
}

function loadDefinitionFragments(fragmentsDir: string): LoadedFragments {
  const nodes: DefinitionNode[] = []
  const diagnostics: BuildSpecCliDiagnostic[] = []
  const sourceLocations = new Map<string, SourceLocationIndex>()
  const filePaths = listDefinitionFiles(fragmentsDir)

  for (const filePath of filePaths) {
    const raw = readFileSync(filePath, 'utf8')
    sourceLocations.set(filePath, createSourceLocationIndex(raw, { filePath }))

    try {
      const parsed = parseDocument(raw, filePath)
      if (!isRecord(parsed)) {
        diagnostics.push(fragmentDiagnostic(filePath, 'Fragment file must contain an object.'))
        continue
      }

      const id = parsed.id
      if (typeof id !== 'string') {
        diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment must declare a string id.', '#/id'))
        continue
      }

      if (!Object.prototype.hasOwnProperty.call(parsed, 'content')) {
        diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment must declare content.', '#/content'))
        continue
      }

      const input = {
        id,
        sourcePath: filePath,
        sourcePointer: '#/content',
        contentHash: createContentHash(parsed.content),
        content: parsed.content,
      }
      nodes.push(createDefinitionNode(
        isRecord(parsed.metadata) ? { ...input, metadata: parsed.metadata } : input,
      ))
    } catch (error) {
      diagnostics.push(fragmentDiagnostic(filePath, error instanceof Error ? error.message : String(error)))
    }
  }

  return {
    nodes,
    diagnostics,
    sourceLocations,
    filePaths,
  }
}

function listDefinitionFiles(rootDir: string): string[] {
  const files: string[] = []

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      if (isDefinitionFile(path)) files.push(path)
    }
  }

  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`Fragments path must be a directory: ${rootDir}`)
  }

  visit(rootDir)
  return files.sort((a, b) => a.localeCompare(b))
}

function parseDocument(raw: string, filePath: string): unknown {
  if (filePath.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
}

function isDefinitionFile(filePath: string): boolean {
  const extension = extname(filePath)
  return extension === '.yaml' || extension === '.yml' || extension === '.json'
}

function readRequiredString(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Target config ${filePath} must declare a non-empty string ${key}.`)
  }
  return value
}

function readStringArray(record: Record<string, unknown>, key: string, filePath: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as a string array.`)
  }
  return value
}

function readServerArray(record: Record<string, unknown>, key: string, filePath: string): OasServer[] {
  const value = record[key]
  if (
    !Array.isArray(value)
    || value.some(item => !isRecord(item) || typeof item.url !== 'string' || item.url.length === 0)
  ) {
    throw new Error(`Target config ${filePath} must declare ${key} as an object array with string url fields.`)
  }
  return value as OasServer[]
}

function readAliases(record: Record<string, unknown>): Record<string, string> | undefined {
  const namingPolicy = record.namingPolicy
  if (!isRecord(namingPolicy)) return undefined
  const aliases = namingPolicy.aliases
  if (!isRecord(aliases)) return undefined

  const output: Record<string, string> = {}
  for (const [id, outputName] of Object.entries(aliases)) {
    if (typeof outputName === 'string') output[id] = outputName
  }
  return output
}

function lookupSourceLocation(
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>,
  sourcePath: string,
  sourcePointer: string,
): Pick<SourceLocation, 'line' | 'column'> | undefined {
  return sourceLocations.get(sourcePath)?.lookup(sourcePointer)
}

function fragmentDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer?: string,
): BuildSpecCliDiagnostic {
  const diagnostic: BuildSpecCliDiagnostic = {
    code: 'definition-fragment/invalid-fragment',
    severity: 'error',
    message,
    sourcePath,
  }
  if (sourcePointer !== undefined) diagnostic.sourcePointer = sourcePointer
  return diagnostic
}

function createContentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`

  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeTextFile(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, value, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
