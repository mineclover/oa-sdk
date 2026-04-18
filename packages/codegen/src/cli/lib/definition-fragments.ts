import { createHash } from 'node:crypto'
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import {
  extname,
  join,
} from 'node:path'
import {
  createDefinitionNode,
  createDefinitionRef,
  createSourceLocationIndex,
  parseDefinitionId,
  type CanonicalDefinitionId,
  type DefinitionNode,
  type DefinitionRef,
  type DefinitionTargetConfig,
  type OasInfo,
  type OasServer,
  type OasTag,
  type SourceLocation,
  type SourceLocationIndex,
} from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'

export type DefinitionFragmentLoadDiagnostic = {
  code: 'definition-fragment/invalid-fragment'
  severity: 'error'
  message: string
  sourcePath: string
  sourcePointer?: string
}

export type LoadedDefinitionFragments = {
  nodes: DefinitionNode[]
  diagnostics: DefinitionFragmentLoadDiagnostic[]
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>
  filePaths: string[]
}

export function loadDefinitionTargetConfig(targetPath: string): DefinitionTargetConfig {
  const raw = readFileSync(targetPath, 'utf8')
  const parsed = parseDocument(raw, targetPath)
  if (!isRecord(parsed)) {
    throw new Error(`Target config must be an object: ${targetPath}`)
  }

  const name = readRequiredString(parsed, 'name', targetPath)
  const info = readOptionalInfo(parsed, 'info', targetPath)
  const scopes = readStringArray(parsed, 'scopes', targetPath)
  const domains = readStringArray(parsed, 'domains', targetPath)
  const servers = readServerArray(parsed, 'servers', targetPath)
  const tags = readOptionalTags(parsed, 'tags', targetPath)
  const includePaths = readStringArray(parsed, 'includePaths', targetPath)
  const includeDefinitions = readOptionalDefinitionIdArray(parsed, 'includeDefinitions', targetPath)
  const config: DefinitionTargetConfig = {
    name,
    scopes,
    domains,
    servers,
    includePaths,
  }
  if (info !== undefined) config.info = info
  if (tags !== undefined) config.tags = tags
  if (includeDefinitions !== undefined) config.includeDefinitions = includeDefinitions
  const aliases = readAliases(parsed)
  if (aliases !== undefined) {
    config.namingPolicy = { aliases }
  }

  return config
}

export function loadDefinitionFragments(fragmentsDir: string): LoadedDefinitionFragments {
  const nodes: DefinitionNode[] = []
  const diagnostics: DefinitionFragmentLoadDiagnostic[] = []
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
        contentHash: createDefinitionContentHash(parsed.content),
        content: parsed.content,
      }
      const refs = readFragmentRefs(parsed.refs, filePath, diagnostics)
      if (refs === undefined) continue

      nodes.push(createDefinitionNode(
        isRecord(parsed.metadata) ? { ...input, metadata: parsed.metadata, refs } : { ...input, refs },
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

export function lookupDefinitionSourceLocation(
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>,
  sourcePath: string,
  sourcePointer: string,
): Pick<SourceLocation, 'line' | 'column'> | undefined {
  return sourceLocations.get(sourcePath)?.lookup(sourcePointer)
}

export function createDefinitionContentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function readFragmentRefs(
  refs: unknown,
  filePath: string,
  diagnostics: DefinitionFragmentLoadDiagnostic[],
): DefinitionRef[] | undefined {
  if (refs === undefined) return []
  if (!Array.isArray(refs)) {
    diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment refs must be an array.', '#/refs'))
    return undefined
  }

  const explicitRefs: DefinitionRef[] = []
  for (const [index, refEntry] of refs.entries()) {
    const pointer = `#/refs/${index}`
    if (!isRecord(refEntry)) {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain ref and sourcePointer strings.', pointer))
      return undefined
    }
    if (typeof refEntry.ref !== 'string') {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain a string ref.', `${pointer}/ref`))
      return undefined
    }
    if (typeof refEntry.sourcePointer !== 'string') {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain a string sourcePointer.', `${pointer}/sourcePointer`))
      return undefined
    }
    explicitRefs.push(createDefinitionRef({
      ref: refEntry.ref,
      sourcePath: filePath,
      sourcePointer: refEntry.sourcePointer,
      ...(isRecord(refEntry.metadata) ? { metadata: refEntry.metadata } : {}),
    }))
  }

  return explicitRefs
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

function readOptionalStringArray(record: Record<string, unknown>, key: string, filePath: string): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as a string array when present.`)
  }
  return value
}

function readOptionalDefinitionIdArray(
  record: Record<string, unknown>,
  key: string,
  filePath: string,
): CanonicalDefinitionId[] | undefined {
  const values = readOptionalStringArray(record, key, filePath)
  if (values === undefined) return undefined

  return values.map((value, index) => {
    try {
      return parseDefinitionId(value).id
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Target config ${filePath} has invalid ${key}[${index}]: ${message}`)
    }
  })
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

function readOptionalInfo(record: Record<string, unknown>, key: string, filePath: string): OasInfo | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.version !== 'string') {
    throw new Error(`Target config ${filePath} must declare ${key} with string title and version fields when present.`)
  }
  return value as OasInfo
}

function readOptionalTags(record: Record<string, unknown>, key: string, filePath: string): OasTag[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => !isRecord(item) || typeof item.name !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as an object array with string name fields when present.`)
  }
  return value as OasTag[]
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

function fragmentDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer?: string,
): DefinitionFragmentLoadDiagnostic {
  const diagnostic: DefinitionFragmentLoadDiagnostic = {
    code: 'definition-fragment/invalid-fragment',
    severity: 'error',
    message,
    sourcePath,
  }
  if (sourcePointer !== undefined) diagnostic.sourcePointer = sourcePointer
  return diagnostic
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
