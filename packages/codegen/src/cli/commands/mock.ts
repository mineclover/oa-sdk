import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server'
import type { OasDocument } from '@oa-sdk/parser'
import type { Command, CommandArgValue, CommandContext } from '../lib/types.js'
import { optStr, bool, resolveArgPath } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { compileTypeSpecInMemory, watchTypeSpec, type TypeSpecWatcher } from '../lib/typespec-mock-compiler.js'
import { parseSpecDocument, watchSpec, type SpecWatcher } from '../lib/spec-watcher.js'

export interface MockCommandContext extends CommandContext {
  signal?: AbortSignal
  onServerReady?: (server: NodeMockServer) => void | Promise<void>
}

export const mock: Command = {
  name: 'mock',
  description: 'Zero-build instant mock server from TypeSpec or OpenAPI specifications',
  options: {
    tsp: {
      type: 'string',
      short: 't',
      description: 'Path to TypeSpec entrypoint file (.tsp)',
    },
    spec: {
      type: 'string',
      short: 's',
      description: 'Path to OpenAPI JSON/YAML file or TypeScript source file with @oaOperation (alternative to --tsp)',
    },
    port: {
      type: 'string',
      short: 'p',
      description: 'Port to listen on (default: 4010)',
    },
    host: {
      type: 'string',
      description: 'Host to bind on (default: 127.0.0.1)',
    },
    watch: {
      type: 'boolean',
      short: 'w',
      description: 'Watch specification files (.yaml, .json, .tsp, .ts) and hot-reload routes without restarting the server',
    },
    stateful: {
      type: 'boolean',
      description: 'Enable in-memory stateful store for CRUD operations (POST creates, GET finds, PUT/PATCH updates, DELETE removes)',
    },
  },
  async run(args: Record<string, CommandArgValue>, context?: CommandContext) {
    const mockContext = context as MockCommandContext | undefined
    const tspPath = optStr(args, 'tsp')
    const specPath = optStr(args, 'spec')
    const isWatch = bool(args, 'watch')
    const isStateful = bool(args, 'stateful')
    const rawPort = optStr(args, 'port')
    const host = optStr(args, 'host') ?? '127.0.0.1'
    const port = rawPort !== undefined ? parseInt(rawPort, 10) : 4010

    if (!tspPath && !specPath) {
      console.error('오류: --tsp <경로> 또는 --spec <경로> 옵션이 필요합니다.')
      throw new CliExitError(1)
    }

    if (tspPath) {
      const resolvedTsp = resolveArgPath(args, 'tsp', context?.projectRoot)
      console.log(`[oa-gen mock] Compiling TypeSpec in-memory: ${resolvedTsp}...`)
      let initial: Awaited<ReturnType<typeof compileTypeSpecInMemory>>
      try {
        initial = await compileTypeSpecInMemory(resolvedTsp)
      } catch (err: any) {
        console.error(`[oa-gen mock] TypeSpec compilation failed: ${err.message}`)
        throw new CliExitError(1)
      }

      console.log(`[oa-gen mock] Compiled successfully (${initial.routesCount} operations detected). Starting mock server...`)
      const server = createNodeMockServer(initial.document, { port, host, stateful: isStateful })
      await server.start()
      console.log(`🚀 Zero-Build Instant Mock Server running at: ${server.url}`)
      console.log(`📄 Specification: ${resolvedTsp} (OAS ${initial.document.openapi})`)

      let currentProgram = initial.program
      let watcher: TypeSpecWatcher | null = null

      if (isWatch) {
        console.log(`👀 Watch mode enabled: monitoring ${initial.sourceFiles.length} TypeSpec files for changes...`)
        watcher = watchTypeSpec(
          initial.sourceFiles,
          async () => {
            console.log(`[oa-gen mock:watch] Change detected, recompiling in-memory...`)
            try {
              const recompiled = await compileTypeSpecInMemory(resolvedTsp, { oldProgram: currentProgram })
              currentProgram = recompiled.program
              const { routesCount } = server.updateSpec(recompiled.document)
              console.log(`🔄 [oa-gen mock:watch] Hot-reloaded routes successfully (${routesCount} operations active)`)
            } catch (err: any) {
              console.error(`❌ [oa-gen mock:watch] Compilation error, keeping previous routes active:`)
              console.error(err.message)
            }
          },
          (err) => {
            console.error(`[oa-gen mock:watch] Watcher error: ${String(err)}`)
          },
        )
      }

      if (mockContext?.onServerReady) {
        await mockContext.onServerReady(server)
      }

      await new Promise<void>((resolvePromise) => {
        let stopped = false
        const shutdown = () => {
          if (stopped) return
          stopped = true
          process.off('SIGINT', shutdown)
          process.off('SIGTERM', shutdown)
          if (mockContext?.signal) {
            mockContext.signal.removeEventListener('abort', shutdown)
          }
          console.log('\n[oa-gen mock] Shutting down mock server...')
          if (watcher) watcher.close()
          void server.stop().finally(() => {
            console.log('[oa-gen mock] Server stopped cleanly.')
            resolvePromise()
          })
        }

        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)

        if (mockContext?.signal) {
          if (mockContext.signal.aborted) {
            shutdown()
            return
          }
          mockContext.signal.addEventListener('abort', shutdown, { once: true })
        }
      })
      return
    }

    if (specPath) {
      const resolvedSpec = resolveArgPath(args, 'spec', context?.projectRoot)
      console.log(`[oa-gen mock] Loading specification: ${resolvedSpec}...`)
      let doc: OasDocument
      try {
        const parsed = await parseSpecDocument(resolvedSpec)
        doc = parsed.document
      } catch (err: any) {
        console.error(`[oa-gen mock] Failed to read/parse specification: ${err.message}`)
        throw new CliExitError(1)
      }

      const server = createNodeMockServer(doc, { port, host, stateful: isStateful })
      await server.start()
      console.log(`🚀 Zero-Build Mock Server running at: ${server.url}`)
      console.log(`📄 Specification: ${resolvedSpec}`)

      let watcher: SpecWatcher | null = null

      if (isWatch) {
        console.log(`👀 Watch mode enabled: monitoring ${resolvedSpec} for changes...`)
        watcher = watchSpec(resolvedSpec, {
          onChange: async (newDoc) => {
            console.log(`[oa-gen mock:watch] Change detected, reloading specification...`)
            try {
              const { routesCount } = server.updateSpec(newDoc)
              console.log(`🔄 [oa-gen mock:watch] Hot-reloaded routes successfully (${routesCount} operations active)`)
            } catch (err: any) {
              console.error(`❌ [oa-gen mock:watch] Routing error, keeping previous routes active:`)
              console.error(err.message)
            }
          },
          onError: (err) => {
            console.error(`❌ [oa-gen mock:watch] Specification parse error, keeping previous routes active:`)
            console.error(err instanceof Error ? err.message : String(err))
          },
        })
      }

      if (mockContext?.onServerReady) {
        await mockContext.onServerReady(server)
      }

      await new Promise<void>((resolvePromise) => {
        let stopped = false
        const shutdown = () => {
          if (stopped) return
          stopped = true
          process.off('SIGINT', shutdown)
          process.off('SIGTERM', shutdown)
          if (mockContext?.signal) {
            mockContext.signal.removeEventListener('abort', shutdown)
          }
          console.log('\n[oa-gen mock] Shutting down mock server...')
          if (watcher) watcher.close()
          void server.stop().finally(() => {
            console.log('[oa-gen mock] Server stopped cleanly.')
            resolvePromise()
          })
        }

        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)

        if (mockContext?.signal) {
          if (mockContext.signal.aborted) {
            shutdown()
            return
          }
          mockContext.signal.addEventListener('abort', shutdown, { once: true })
        }
      })
      return
    }
  },
}

export default mock
