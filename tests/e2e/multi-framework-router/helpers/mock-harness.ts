import * as http from 'node:http'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  createNodeMockServer,
  type NodeMockServer,
} from '@oa-sdk/mock-server'
import {
  parseDocument,
  type OasDocument,
  extractOperationsFromSource,
  type ExtractedOperation,
} from '@oa-sdk/parser'

export type SpecFileFormat = 'yaml' | 'json' | 'typescript' | 'typespec'

export interface SpecWatcherOptions {
  debounceMs?: number
  onChange: (doc: OasDocument, context: { filePath: string; format: SpecFileFormat }) => Promise<void> | void
  onError?: (error: unknown, filePath: string) => void
}

export interface SpecWatcher {
  close(): void
  readonly watchedDirs: readonly string[]
  readonly targetFiles: readonly string[]
}

export function detectSpecFormat(filePath: string): SpecFileFormat {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  if (ext === '.json') return 'json'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.tsp') return 'typespec'
  throw new Error(`Unsupported specification file extension: ${ext} (${filePath})`)
}

export function buildDocumentFromOperations(
  operations: readonly ExtractedOperation[],
  sourceFile = 'source.ts',
): OasDocument {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const op of operations) {
    if (!paths[op.path]) {
      paths[op.path] = {}
    }
    const verb = op.method.toLowerCase()
    paths[op.path][verb] = {
      operationId: op.operationEntry.operationId ?? op.declarationName,
      summary: op.summary ?? `Extracted ${op.declarationName}`,
      description: op.description,
      deprecated: op.deprecated,
      tags: op.operationEntry.tags,
      parameters: op.operationEntry.parameters,
      responses: Object.keys(op.operationEntry.responses).length > 0
        ? op.operationEntry.responses
        : {
            '200': {
              description: 'Auto-synthesized response for @oaOperation',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                  example: {
                    status: 'ok',
                    operationId: op.operationEntry.operationId ?? op.declarationName,
                    method: op.method.toUpperCase(),
                    path: op.path,
                  },
                },
              },
            },
          },
    }
  }

  return {
    openapi: '3.2.0',
    info: {
      title: `Synthesized API from ${path.basename(sourceFile)}`,
      version: '1.0.0',
      description: 'Extracted via @oaOperation JSDoc annotations',
    },
    servers: [{ url: '/' }],
    paths,
  }
}

export async function parseSpecDocument(
  filePath: string,
): Promise<{ document: OasDocument; format: SpecFileFormat }> {
  const format = detectSpecFormat(filePath)
  const content = await fsp.readFile(filePath, 'utf-8')

  if (format === 'yaml') {
    const doc = parseYaml(content) as OasDocument
    return { document: doc, format }
  }

  if (format === 'json') {
    const doc = JSON.parse(content) as OasDocument
    return { document: doc, format }
  }

  if (format === 'typescript') {
    const extracted = extractOperationsFromSource(content, filePath)
    if (extracted.diagnostics.length > 0) {
      const errors = extracted.diagnostics.filter(d => d.severity === 'error')
      if (errors.length > 0) {
        throw new Error(`Syntax/validation error in @oaOperation: ${errors.map(e => e.message).join('; ')}`)
      }
    }
    const doc = buildDocumentFromOperations(extracted.operations, filePath)
    return { document: doc, format }
  }

  throw new Error(`Unsupported format for direct parse: ${format}`)
}

export function watchSpec(targetPath: string, options: SpecWatcherOptions): SpecWatcher {
  const { debounceMs = 100, onChange, onError } = options
  const resolvedTarget = path.resolve(targetPath)
  let timer: NodeJS.Timeout | null = null
  let isClosed = false

  const handleFileChange = async (filePath: string) => {
    if (isClosed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const { document, format } = await parseSpecDocument(filePath)
        await onChange(document, { filePath, format })
      } catch (err) {
        if (onError) {
          onError(err, filePath)
        }
      }
    }, debounceMs)
  }

  let watcher: fs.FSWatcher | null = null
  try {
    watcher = fs.watch(resolvedTarget, (eventType, filename) => {
      const changedFile = filename ? path.resolve(path.dirname(resolvedTarget), filename) : resolvedTarget
      handleFileChange(changedFile)
    })
  } catch (err) {
    if (onError) onError(err, resolvedTarget)
  }

  return {
    close() {
      isClosed = true
      if (timer) clearTimeout(timer)
      if (watcher) watcher.close()
    },
    watchedDirs: [path.dirname(resolvedTarget)],
    targetFiles: [resolvedTarget],
  }
}

export interface ActiveMockInstance {
  server: NodeMockServer
  port: number
  url: string
  stop: () => Promise<void>
  updateSpec: (newDoc: OasDocument) => { routesCount: number }
}

/**
 * Starts an in-memory mock server using @oa-sdk/mock-server
 */
export async function startMockServer(
  initialDoc: OasDocument,
  options: { port?: number; host?: string } = {},
): Promise<ActiveMockInstance> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 0

  const server = createNodeMockServer(initialDoc, { port, host })
  await server.start()

  const actualUrl = server.url
  const parsed = new URL(actualUrl)
  const actualPort = Number(parsed.port)

  return {
    server,
    port: actualPort,
    url: actualUrl,
    stop: async () => {
      await server.stop()
    },
    updateSpec: (newDoc: OasDocument) => {
      return server.updateSpec(newDoc)
    },
  }
}

/**
 * Sends HTTP request via native http.Agent supporting Keep-Alive
 */
export async function sendHttpRequest(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    agent?: http.Agent
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const req = http.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: options.agent,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk.toString('utf8')
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 200,
            headers: res.headers,
            body,
          })
        })
      },
    )

    req.on('error', reject)

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}
