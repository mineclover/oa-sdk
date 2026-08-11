/**
 * Regenerate the sidecar-less canonical authored TypeSpec fixture from the
 * production merged OpenAPI schema.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import {
  convertTypeSpecSidecarToExtensions,
  createTypeSpecCompatibilitySidecarFromEntries,
  loadSpecWithPath,
  parseTypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecarEntry,
  type TypeSpecParameterExamplesSidecarEntry,
  type TypeSpecRoundtripReport,
} from '../packages/codegen/src/schema-governance.js'

type Args = {
  fixtureDir: string
  keepWorkspace: boolean
}

type HttpMethod = NonNullable<TypeSpecParameterExamplesSidecarEntry['target']['method']>
type RecordValue = Record<string, unknown>

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']
const DEFAULT_FIXTURE_DIR = 'docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle'
const root = resolve(process.cwd())

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const fixtureDir = resolve(root, args.fixtureDir)
  const tempDir = mkdtempSync(join(tmpdir(), 'oa-sdk-authored-canonical-fixture-'))
  const reportPath = join(tempDir, 'roundtrip-report.json')
  let roundtripWorkspace: string | undefined

  try {
    await execa('pnpm', [
      'typespec:roundtrip',
      '--',
      '--keep',
      '--report',
      reportPath,
    ], {
      cwd: root,
      stdio: 'inherit',
    })

    const report = readJson<TypeSpecRoundtripReport>(reportPath)
    roundtripWorkspace = report.paths.workspace
    const sourceDocument = loadSpecWithPath(report.paths.sourceOpenapi).document as RecordValue
    const sourceSidecar = parseTypeSpecCompatibilitySidecar(readJson(requiredReportPath(report.paths.compatibilitySidecar, 'compatibility sidecar')))
    const authoredSidecar = expandPathLevelParameterExamples(sourceSidecar, sourceDocument)
    const conversion = convertTypeSpecSidecarToExtensions(authoredSidecar, {
      extensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    })

    if (conversion.remainingSidecar.entries.length > 0) {
      throw new Error(`canonical fixture generation left ${conversion.remainingSidecar.entries.length} residual sidecar entries`)
    }

    const generatedSource = readFileSync(report.paths.tspSource, 'utf8')
    const authoredSource = insertExtensionSnippets(generatedSource, conversion.snippets)
    writeFixture(fixtureDir, authoredSource, report)

    console.log('')
    console.log('Canonical authored TypeSpec fixture regenerated')
    console.log(`  fixture: ${relative(root, fixtureDir)}`)
    console.log(`  source sidecar entries: ${sourceSidecar.counts.entries}`)
    console.log(`  authored extension entries: ${authoredSidecar.counts.entries}`)
    console.log(`  operation extension groups: ${conversion.report.counts.operationExtensionGroups}`)
  } finally {
    if (!args.keepWorkspace && roundtripWorkspace) rmSync(roundtripWorkspace, { recursive: true, force: true })
    if (!args.keepWorkspace) rmSync(tempDir, { recursive: true, force: true })
  }
}

function expandPathLevelParameterExamples(
  sidecar: TypeSpecCompatibilitySidecar,
  document: RecordValue,
): TypeSpecCompatibilitySidecar {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []

  for (const entry of sidecar.entries) {
    if (entry.kind !== 'parameter-examples' || entry.target.method) {
      entries.push(entry)
      continue
    }

    const methods = findOperationsWithParameter(document, entry.target.path, entry.target.name, entry.target.in)
    if (methods.length === 0) {
      entries.push(entry)
      continue
    }

    for (const method of methods) {
      entries.push({
        ...entry,
        pointer: parameterOperationPointer(entry.target.path, method, document, entry.target.name, entry.target.in),
        sourcePointer: entry.sourcePointer ?? entry.pointer,
        target: {
          ...entry.target,
          method,
        },
      })
    }
  }

  return createTypeSpecCompatibilitySidecarFromEntries(entries)
}

function findOperationsWithParameter(
  document: RecordValue,
  path: string,
  parameterName: string,
  parameterLocation: string,
): HttpMethod[] {
  const pathItem = readRecord(readRecord(document.paths)[path])
  return HTTP_METHODS.filter(method => {
    const operation = readRecord(pathItem[method])
    if (Object.keys(operation).length === 0) return false
    return operationHasParameter(document, pathItem, operation, parameterName, parameterLocation)
  })
}

function operationHasParameter(
  document: RecordValue,
  pathItem: RecordValue,
  operation: RecordValue,
  parameterName: string,
  parameterLocation: string,
): boolean {
  return [
    ...readArray(pathItem.parameters),
    ...readArray(operation.parameters),
  ].some(parameter => {
    const resolved = resolveLocalRef(document, parameter)
    return isRecord(resolved)
      && resolved.name === parameterName
      && resolved.in === parameterLocation
  })
}

function parameterOperationPointer(
  path: string,
  method: HttpMethod,
  document: RecordValue,
  parameterName: string,
  parameterLocation: string,
): string {
  const pathItem = readRecord(readRecord(document.paths)[path])
  const operation = readRecord(pathItem[method])
  const parameters = [
    ...readArray(pathItem.parameters),
    ...readArray(operation.parameters),
  ]
  const index = parameters.findIndex(parameter => {
    const resolved = resolveLocalRef(document, parameter)
    return isRecord(resolved)
      && resolved.name === parameterName
      && resolved.in === parameterLocation
  })
  return `#/paths/${escapeJsonPointer(path)}/${method}/parameters/${Math.max(index, 0)}`
}

function insertExtensionSnippets(source: string, snippets: string): string {
  const parsed = parseExtensionSnippets(snippets)
  const withSecurity = insertSecurityExtension(source, parsed.security)
  const withOperations = insertOperationExtensions(withSecurity, parsed.operations)
  return withOperations.endsWith('\n') ? withOperations : `${withOperations}\n`
}

function parseExtensionSnippets(snippets: string): {
  security: string
  operations: Map<string, string>
} {
  const operations = new Map<string, string>()
  let security = ''
  const blocks = snippets.trimEnd().split(/\n\n(?=\/\/ )/)

  for (const block of blocks) {
    if (!block.includes('@extension(')) continue
    const extension = extractExtensionDecorator(block)
    if (block.includes('x-oa-sdk-security-schemes')) {
      security = extension
      continue
    }
    const operationMatch = block.match(/^\/\/ ([A-Z]+) (.+)$/m)
    if (!operationMatch) continue
    operations.set(`${operationMatch[1].toLowerCase()} ${operationMatch[2]}`, extension)
  }

  if (!security) throw new Error('sidecar-to-extension output did not contain a security schemes extension')
  if (operations.size === 0) throw new Error('sidecar-to-extension output did not contain operation extensions')
  return { security, operations }
}

function extractExtensionDecorator(block: string): string {
  const lines = block.split('\n')
  const start = lines.findIndex(line => line.startsWith('@extension('))
  if (start === -1) throw new Error('snippet block does not contain an @extension decorator')
  return lines.slice(start).join('\n')
}

function insertSecurityExtension(source: string, securitySnippet: string): string {
  const index = source.indexOf('@server(')
  if (index === -1) throw new Error('generated TypeSpec source does not contain an @server decorator')
  return `${source.slice(0, index)}${securitySnippet}\n${source.slice(index)}`
}

function insertOperationExtensions(source: string, operationSnippets: Map<string, string>): string {
  const lines = source.split('\n')
  const remaining = new Set(operationSnippets.keys())

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('op ')) continue
    const blockStart = findOperationDecoratorBlockStart(lines, index)
    const decoratorBlock = lines.slice(blockStart, index).join('\n')
    const route = readRoute(decoratorBlock)
    const method = readMethod(decoratorBlock)
    if (!route || !method) continue
    const key = `${method} ${route}`
    const snippet = operationSnippets.get(key)
    if (!snippet) continue
    const snippetLines = snippet.split('\n')
    lines.splice(index, 0, ...snippetLines)
    index += snippetLines.length
    remaining.delete(key)
  }

  if (remaining.size > 0) {
    throw new Error(`could not place ${remaining.size} operation extension snippet(s): ${[...remaining].join(', ')}`)
  }

  return lines.join('\n')
}

function findOperationDecoratorBlockStart(lines: string[], operationIndex: number): number {
  let index = operationIndex - 1
  while (index >= 0 && lines[index].trim() !== '') index -= 1
  return index + 1
}

function readRoute(decoratorBlock: string): string | undefined {
  const match = decoratorBlock.match(/@route\("((?:\\.|[^"\\])*)"\)/)
  if (!match) return undefined
  return JSON.parse(`"${match[1]}"`) as string
}

function readMethod(decoratorBlock: string): HttpMethod | undefined {
  const match = decoratorBlock.match(/^@(get|put|post|delete|options|head|patch|trace|query)\b/m)
  return match?.[1] as HttpMethod | undefined
}

function writeFixture(fixtureDir: string, source: string, report: TypeSpecRoundtripReport): void {
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(join(fixtureDir, 'main.tsp'), source)
  copyFileSync(requiredReportPath(report.paths.bundleExpectedOpenapi, 'expected OpenAPI'), join(fixtureDir, 'expected.openapi.yaml'))
  copyFileSync(join(dirname(report.paths.tspSource), 'tspconfig.yaml'), join(fixtureDir, 'tspconfig.yaml'))
  writeFileSync(join(fixtureDir, 'oa-sdk.typespec-bundle.json'), `${JSON.stringify({
    schemaVersion: 'oa-sdk.typespec-bundle.v1',
    entrypoint: 'main.tsp',
    expectedOpenapi: 'expected.openapi.yaml',
    compatibility: {
      openapiVersion: '3.2.0',
      oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    },
  }, null, 2)}\n`)
}

function readJson<T>(path: string): T {
  if (!path || !existsSync(path)) throw new Error(`file does not exist: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function requiredReportPath(path: string | undefined, label: string): string {
  if (!path) throw new Error(`roundtrip report did not include ${label} path`)
  return path
}

function resolveLocalRef(document: RecordValue, value: unknown): unknown {
  if (!isRecord(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value
  return readJsonPointer(document, value.$ref)
}

function readJsonPointer(document: RecordValue, pointer: string): unknown {
  return pointer
    .slice(2)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, part) => (isRecord(current) ? current[part] : undefined), document)
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function readRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {}
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArgs(rawArgs: string[]): Args {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  const fixtureDir = readOption(rawArgs, '--fixture-dir') ?? DEFAULT_FIXTURE_DIR
  return {
    fixtureDir,
    keepWorkspace: rawArgs.includes('--keep-workspace'),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function printUsage(): void {
  console.error(`Usage:
  pnpm typespec:create-canonical-fixture [-- --fixture-dir <path>] [--keep-workspace]

Options:
  --fixture-dir <path>  Fixture directory to rewrite. Defaults to ${DEFAULT_FIXTURE_DIR}.
  --keep-workspace     Keep temporary roundtrip workspace and report files for debugging.
`)
}

await main()
