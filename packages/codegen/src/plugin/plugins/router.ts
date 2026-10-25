/**
 * Server Router & Handler Contract Plugin for TypeSpec SSOT
 *
 * Connects to @oa-sdk/router's generators, producing:
 * - Pure TypeScript Handler Contracts (api.contract.ts) featuring:
 *   - HandlerResponse<TSuccess, TErrorMap, THeaders> multi-status error union
 *   - Zero framework runtime dependencies
 * - Target Framework Router Bindings:
 *   - Hono, Express, Fastify (JIT inline schema accelerated), Bun Elysia (zero-copy destructuring)
 *   - Strict 3-part response envelope collision defense heuristic
 *
 * @oa-sdk/codegen
 */

import type { TspGeneratedFile, TspPlugin, TspPluginContext } from '../types.js'
import type {
  generateRouter,
  generateHandlerContract,
  RouterTarget,
  RouterMode,
  RouterOptions,
  HandlerContractOptions,
} from '@oa-sdk/router'

export type RouterModule = typeof import('@oa-sdk/router')

export interface PluginRouterOptions {
  /** Output path for framework router binding. Default: 'router.ts' */
  output?: string | undefined
  /** Output path for pure handler contract interface. Default: 'api.contract.ts' */
  contractOutput?: string | undefined
  /** Target server framework: 'hono' | 'express' | 'fastify' | 'elysia'. Default: 'hono' */
  target?: 'hono' | 'express' | 'fastify' | 'elysia' | undefined
  /** Router generation mode: 'contract' (pure bindings) or 'stub'. Default: 'contract' */
  mode?: 'contract' | 'stub' | undefined
  /** Module specifier to import types from. Default: auto-resolved or './types.js' */
  typesFile?: string | undefined
  /** Name of the handler contract interface. Default: 'ApiHandlers' */
  contractName?: string | undefined
  /** Enable context injection (e.g. AppContext). Default: false */
  contextInjection?: boolean | undefined
  /** Type name of the injected context */
  contextTypeName?: string | undefined
  /** Import specifier for the injected context type */
  contextImport?: string | undefined
  /** Whether to add auto-generated comment banner. Default: true */
  banner?: boolean | undefined
  /** Base path for resolving relative external $refs */
  basePath?: string | undefined
  /** Custom router module for testing or dependency injection */
  routerModule?: RouterModule | undefined
}

/**
 * Loads @oa-sdk/router dynamically or uses injected override.
 */
async function resolveRouterModule(override?: RouterModule): Promise<RouterModule> {
  if (override) return override
  try {
    return await import('@oa-sdk/router')
  } catch (err) {
    throw new Error(
      `Failed to load @oa-sdk/router for pluginRouter: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Scans generated TypeScript code for top-level exported symbol names.
 */
function extractExportNames(code: string): string[] {
  const exports: string[] = []
  const matches = code.matchAll(/export\s+(?:const|function|class|type|interface)\s+([A-Za-z0-9_$]+)/g)
  for (const m of matches) {
    if (m[1]) exports.push(m[1])
  }
  return exports
}

/**
 * Finds the virtual path of generated types in context if available.
 */
function findTypesFilePath(context: TspPluginContext): string | undefined {
  if (context.hasFile('types.ts')) return 'types.ts'
  const match = context.getFiles().find(f => f.path.endsWith('types.ts') || f.kind === 'models')
  return match?.path
}

/**
 * Router & Handler Contract Plugin for TypeSpec SSOT Code Generation.
 *
 * Declares dependencies: ['typescript'].
 */
export function pluginRouter(
  options: PluginRouterOptions = {},
): TspPlugin<PluginRouterOptions> {
  return {
    name: 'router',
    purposes: ['api', 'interface'],
    dependencies: ['typescript'],

    async generate(context: TspPluginContext, opts?: PluginRouterOptions): Promise<void> {
      const mergedOpts: PluginRouterOptions = { ...options, ...opts }
      const router = await resolveRouterModule(mergedOpts.routerModule)
      const { generateRouter, generateHandlerContract } = router

      const doc = context.document
      if (!doc) {
        context.log('warn', '[router] No OpenAPI document found in context.')
        return
      }

      const routerPath = mergedOpts.output ?? 'router.ts'
      const contractPath = mergedOpts.contractOutput ?? 'api.contract.ts'
      const target: RouterTarget = mergedOpts.target ?? 'hono'
      const mode: RouterMode = mergedOpts.mode ?? 'contract'
      const contractName = mergedOpts.contractName ?? 'ApiHandlers'
      const banner = mergedOpts.banner ?? true
      const knownTypesPath = findTypesFilePath(context)

      // Resolve types imports relative to output paths
      const typesForContract = mergedOpts.typesFile
        ?? (knownTypesPath ? context.resolveImport(contractPath, knownTypesPath) : './types.js')
      const typesForRouter = mergedOpts.typesFile
        ?? (knownTypesPath ? context.resolveImport(routerPath, knownTypesPath) : './types.js')

      if (mode === 'contract') {
        // 1. Generate decoupled Pure Handler Contract (api.contract.ts)
        const contractOptions: HandlerContractOptions & { basePath?: string } = {
          typesImport: typesForContract,
          contractName,
          banner,
          ...(mergedOpts.contextImport !== undefined ? { contextImport: mergedOpts.contextImport } : {}),
          ...(mergedOpts.contextTypeName !== undefined ? { contextTypeName: mergedOpts.contextTypeName } : {}),
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        }
        const contractCode = generateHandlerContract(doc, contractOptions)

        const contractExports = Array.from(
          new Set([contractName, 'HandlerResponse', ...extractExportNames(contractCode)]),
        )

        context.addFile({
          path: contractPath,
          content: contractCode,
          sourcePlugin: 'router',
          kind: 'contract',
          exports: contractExports,
        })

        // 2. Generate Router bound to Handler Contract
        const contractImport = context.resolveImport(routerPath, contractPath)
        const routerCode = generateRouter(doc, {
          target,
          mode: 'contract',
          typesImport: typesForRouter,
          contractImport,
          contractName,
          banner,
          contextInjection: mergedOpts.contextInjection,
          contextTypeName: mergedOpts.contextTypeName,
          contextImport: mergedOpts.contextImport,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        context.addFile({
          path: routerPath,
          content: routerCode,
          sourcePlugin: 'router',
          kind: 'router',
          exports: extractExportNames(routerCode),
        })
      } else {
        // mode === 'stub'
        const routerCode = generateRouter(doc, {
          target,
          mode: 'stub',
          typesImport: typesForRouter,
          banner,
          contextInjection: mergedOpts.contextInjection,
          contextTypeName: mergedOpts.contextTypeName,
          contextImport: mergedOpts.contextImport,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        context.addFile({
          path: routerPath,
          content: routerCode,
          sourcePlugin: 'router',
          kind: 'router',
          exports: extractExportNames(routerCode),
        })
      }
    },
  }
}
