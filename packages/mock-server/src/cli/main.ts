import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { validateDocument, type OasDocument } from '@oa-sdk/parser'
import { createNodeMockServer } from '../adapters/node-http.js'

const DEFAULT_PORT = 4010
const MAX_PORT = 65_535

export const CLI_HELP = `oa-mock — OpenAPI mock server

Usage:
  oa-mock --spec <openapi.json|openapi.yaml> [--port <port>]

Options:
  --spec, -s <path>  OpenAPI JSON/YAML file (required)
  --port, -p <port>  Listen port, 0-${MAX_PORT} (default: ${DEFAULT_PORT})
  --help, -h         Show this help
`

type Output = { write: (chunk: string) => unknown }
export type CliMockServer = Pick<ReturnType<typeof createNodeMockServer>, 'start' | 'stop' | 'url'>

export type CliDependencies = {
  cwd: () => string
  readTextFile: (path: string) => Promise<string>
  createServer: (spec: OasDocument, port: number) => CliMockServer
  stdout: Output
  stderr: Output
  onSignal: (signal: NodeJS.Signals, listener: () => void) => void
}

export type LoadedSpec = {
  path: string
  document: OasDocument
}

const defaultDependencies: CliDependencies = {
  cwd: () => process.cwd(),
  readTextFile: path => readFile(path, 'utf8'),
  createServer: (spec, port) => createNodeMockServer(spec, { port }),
  stdout: process.stdout,
  stderr: process.stderr,
  onSignal: (signal, listener) => process.once(signal, listener),
}

/** CLI entry point. Returns a process exit code and never terminates the process directly. */
export async function main(
  argv: string[],
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  const dependencies: CliDependencies = { ...defaultDependencies, ...overrides }

  let options: ReturnType<typeof parseCliArgs>
  try {
    options = parseCliArgs(argv)
  } catch (error) {
    writeLine(dependencies.stderr, `인자 오류: ${errorMessage(error)}`)
    writeLine(dependencies.stderr, '`oa-mock --help`로 사용법을 확인하세요.')
    return 2
  }

  if (options.help) {
    dependencies.stdout.write(CLI_HELP)
    return 0
  }

  if (!options.spec) {
    writeLine(dependencies.stderr, '인자 오류: --spec <path>가 필요합니다.')
    writeLine(dependencies.stderr, '`oa-mock --help`로 사용법을 확인하세요.')
    return 2
  }

  let loaded: LoadedSpec
  try {
    loaded = await loadAndValidateSpec(options.spec, dependencies)
  } catch (error) {
    writeLine(dependencies.stderr, errorMessage(error))
    return 1
  }

  let server: CliMockServer
  try {
    server = dependencies.createServer(loaded.document, options.port)
    await server.start()
  } catch (error) {
    writeLine(dependencies.stderr, `서버 시작 실패: ${errorMessage(error)}`)
    return 1
  }

  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    void server.stop().catch(error => {
      writeLine(dependencies.stderr, `서버 종료 실패: ${errorMessage(error)}`)
      process.exitCode = 1
    })
  }
  dependencies.onSignal('SIGINT', stop)
  dependencies.onSignal('SIGTERM', stop)

  writeLine(dependencies.stdout, `Mock server: ${server.url}`)
  writeLine(dependencies.stdout, `spec: ${loaded.path}`)
  return 0
}

export async function loadAndValidateSpec(
  inputPath: string,
  dependencies: Pick<CliDependencies, 'cwd' | 'readTextFile'> = defaultDependencies,
): Promise<LoadedSpec> {
  const specPath = resolve(dependencies.cwd(), inputPath)

  let source: string
  try {
    source = await dependencies.readTextFile(specPath)
  } catch (error) {
    throw new Error(`스키마 파일을 읽을 수 없습니다: ${specPath}\n${errorMessage(error)}`)
  }

  let parsed: unknown
  try {
    parsed = parseDocumentText(source, specPath)
  } catch (error) {
    throw new Error(`스키마 파일을 파싱할 수 없습니다: ${specPath}\n${errorMessage(error)}`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`스키마 검증 실패: ${specPath}\n  / [parse/type] 문서가 유효한 객체가 아닙니다`)
  }

  const validation = validateDocument(parsed, { basePath: specPath })
  if (!validation.valid) {
    const diagnostics = validation.errors
      .slice(0, 10)
      .map(error => `  ${error.path} [${error.rule}] ${error.message}`)
    const remaining = validation.errors.length - diagnostics.length
    if (remaining > 0) diagnostics.push(`  ...and ${remaining} more`)
    throw new Error(`스키마 검증 실패: ${specPath}\n${diagnostics.join('\n')}`)
  }

  return { path: specPath, document: parsed as OasDocument }
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT
  if (!/^\d+$/.test(value)) {
    throw new Error(`--port는 0-${MAX_PORT} 범위의 정수여야 합니다: ${value}`)
  }

  const port = Number(value)
  if (!Number.isSafeInteger(port) || port > MAX_PORT) {
    throw new Error(`--port는 0-${MAX_PORT} 범위의 정수여야 합니다: ${value}`)
  }
  return port
}

function parseCliArgs(argv: string[]): { help: boolean; spec: string | undefined; port: number } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      spec: { type: 'string', short: 's' },
      port: { type: 'string', short: 'p' },
    },
  })

  return {
    help: values.help === true,
    spec: values.spec,
    port: parsePort(values.port),
  }
}

function parseDocumentText(source: string, path: string): unknown {
  const extension = extname(path).toLowerCase()
  if (extension === '.yaml' || extension === '.yml') return parseYaml(source)
  if (extension === '.json') return JSON.parse(source) as unknown

  try {
    return JSON.parse(source) as unknown
  } catch {
    return parseYaml(source)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeLine(output: Output, message: string): void {
  output.write(`${message}\n`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
