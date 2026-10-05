import { extname, relative } from 'node:path'
import type { NodeMockServer } from '@oa-sdk/mock-server'
import type { OasDocument } from '@oa-sdk/parser'
import { resolveConfigWithDefaults } from '../../config.js'
import type { Command, CommandArgValue, CommandContext } from '../lib/types.js'
import { optStr, bool, resolveArgPath } from '../lib/args.js'
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import { CliExitError } from '../lib/errors.js'
import type { TypeSpecCompilationResult, TypeSpecWatcher } from '../lib/typespec-mock-compiler.js'
import { companionImporterFrom, requireCompanion, type CompanionCommandContext } from '../lib/companion-packages.js'
import { parseSpecDocument, watchSpec, type SpecWatcher } from '../lib/spec-watcher.js'

export interface MockCommandContext extends CompanionCommandContext {
  signal?: AbortSignal
  onServerReady?: (server: NodeMockServer) => void | Promise<void>
}

/** What `oa-gen mock` serves: a TypeSpec entry point, or an OpenAPI document or TypeScript source. */
export interface MockSource {
  kind: 'tsp' | 'spec'
  /** Absolute path. */
  path: string
}

/**
 * The source `oa-gen mock` serves.
 *
 * `--tsp` and `--spec` name it, and `--tsp` wins when both are given. Without
 * either, the command serves the spec target of the project configuration
 * (`oa.config.ts` and the other config files), as `oa-gen validate` and
 * `oa-gen generate` read it, so the `mock` script that `oa-gen init` writes
 * needs no path. A `.tsp` schema entry is compiled like `--tsp`; any other is
 * read like `--spec`. A configuration with no spec target, or with several,
 * does not say what to serve, and the command fails.
 */
export async function resolveMockSource(
  args: Record<string, CommandArgValue>,
  context?: CommandContext,
): Promise<MockSource> {
  if (optStr(args, 'tsp')) return { kind: 'tsp', path: resolveArgPath(args, 'tsp', context?.projectRoot) }
  if (optStr(args, 'spec')) return { kind: 'spec', path: resolveArgPath(args, 'spec', context?.projectRoot) }

  const loaded = await loadOaConfig({
    ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
    ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
  })
  if (!loaded) {
    console.error('오류: --tsp <경로> 또는 --spec <경로> 옵션이 필요합니다. 옵션 없이 실행하려면 spec target이 하나인 oa.config.ts 설정 파일이 있어야 합니다.')
    throw new CliExitError(1)
  }

  const configName = relative(context?.cwd ?? process.cwd(), loaded.configPath) || loaded.configPath
  const specs = resolveConfigWithDefaults(loaded.config).specs ?? []
  if (specs.length !== 1) {
    console.error(specs.length === 0
      ? `오류: ${configName}에 spec target이 없습니다. --tsp <경로> 또는 --spec <경로> 옵션으로 서빙할 스펙을 지정하세요.`
      : `오류: ${configName}에 spec target이 ${specs.length}개(${specs.map(spec => spec.id).join(', ')}) 있어 서빙할 스펙을 정할 수 없습니다. --tsp <경로> 또는 --spec <경로> 옵션으로 지정하세요.`)
    throw new CliExitError(1)
  }

  const target = resolveProfileTarget(specs[0]!, loaded.rootDir)
  console.log(`[oa-gen mock] Serving spec target "${target.id}" of ${configName}: ${target.schemaEntry}`)
  return {
    kind: extname(target.resolvedSchemaEntry).toLowerCase() === '.tsp' ? 'tsp' : 'spec',
    path: target.resolvedSchemaEntry,
  }
}

export const mock: Command = {
  name: 'mock',
  description: 'Zero-build instant mock server from TypeSpec or OpenAPI specifications',
  options: {
    tsp: {
      type: 'string',
      short: 't',
      description: 'Path to TypeSpec entrypoint file (.tsp). Without --tsp and --spec, the spec target of oa.config is served',
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
    const isWatch = bool(args, 'watch')
    const isStateful = bool(args, 'stateful')
    const rawPort = optStr(args, 'port')
    const host = optStr(args, 'host') ?? '127.0.0.1'
    const port = rawPort !== undefined ? parseInt(rawPort, 10) : 4010

    const source = await resolveMockSource(args, context)

    const { createNodeMockServer } = await requireCompanion('mock', {
      output: 'the mock server',
      importer: companionImporterFrom(context),
    })

    if (source.kind === 'tsp') {
      const resolvedTsp = source.path
      console.log(`[oa-gen mock] Compiling TypeSpec in-memory: ${resolvedTsp}...`)
      // TypeSpec 컴파일러(@typespec/*)는 --tsp 경로에서만 쓰므로 실행할 때 불러온다(oa-gen 전체 기동 비용 절감).
      const { compileTypeSpecInMemory, watchTypeSpec } = await import('../lib/typespec-mock-compiler.js')
      let initial: TypeSpecCompilationResult
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

    const resolvedSpec = source.path
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
  },
}

export default mock
