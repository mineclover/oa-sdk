/**
 * TanStack Query v5 Multi-Target Plugin Adapter for TypeSpec SSOT
 *
 * Connects to @oa-sdk/client's TanStack Query v5 generator, producing:
 * - Tier 1: Query Key Factories (tuple-based query keys)
 * - Tier 2: Pure Options (queryOptions, mutationOptions, infiniteQueryOptions)
 * - Tier 3: React Hooks (use*Query, use*Mutation, createApiHooks)
 *
 * Supports both unified single-file emission (queries.ts) and modular split emission
 * (keys.ts, queries.ts, hooks.ts), resolving relative imports between virtual files.
 *
 * @oa-sdk/codegen
 */

import type { TspGeneratedFile, TspPlugin, TspPluginContext } from '../types.js'
import type { TanstackQueryOptions, TanstackQueryOutput } from '@oa-sdk/client'

export type ClientModule = typeof import('@oa-sdk/client')

export interface PluginTanstackQueryOptions {
  /** Output file relative path when not split. Default: 'queries.ts' */
  output?: string | undefined
  /** Module specifier to import types from. If omitted, resolved via context.resolveImport or default './types.js' */
  typesFile?: string | undefined
  /** Module specifier to import client from. If omitted, resolved via context.resolveImport or default './client.js' */
  clientFile?: string | undefined
  /** Which tiers to generate: 'all' | 'keys' | 'options' | 'hooks'. Default: 'all' */
  tier?: 'all' | 'keys' | 'options' | 'hooks' | undefined
  /** Whether to split artifacts into three files (keys.ts, queries.ts, hooks.ts). Default: false */
  split?: boolean | undefined
  /** Output path for Tier 1 Keys when split: true. Default: 'keys.ts' */
  keysOutput?: string | undefined
  /** Output path for Tier 2 Options when split: true. Default: 'queries.ts' */
  optionsOutput?: string | undefined
  /** Output path for Tier 3 React Hooks when split: true. Default: 'hooks.ts' */
  hooksOutput?: string | undefined
  /** Target query framework package. Defaults to '@tanstack/react-query' */
  queryPackage?: string | undefined
  /** Client type name to use for client parameter. Defaults to 'ApiClient' */
  clientName?: string | undefined
  /** Whether to include Tier 3 React hooks. Defaults to true */
  includeHooks?: boolean | undefined
  /** Whether to add auto-generated comment banner. Defaults to true */
  banner?: boolean | undefined
  /** Base path for resolving relative external $refs */
  basePath?: string | undefined
  /** Custom client module for testing or dependency injection */
  clientModule?: ClientModule | undefined
}

/**
 * Loads @oa-sdk/client dynamically or uses injected override.
 */
async function resolveClientModule(override?: ClientModule): Promise<ClientModule> {
  if (override) return override
  try {
    return await import('@oa-sdk/client')
  } catch (err) {
    throw new Error(
      `Failed to load @oa-sdk/client for pluginTanstackQuery: ${err instanceof Error ? err.message : String(err)}`,
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
 * Finds the virtual path of generated client in context if available.
 */
function findClientFilePath(context: TspPluginContext): string | undefined {
  if (context.hasFile('client.ts')) return 'client.ts'
  const match = context.getFiles().find(f => f.path.endsWith('client.ts') || f.kind === 'client')
  return match?.path
}

/**
 * TanStack Query v5 Plugin for TypeSpec SSOT Code Generation.
 *
 * Declares dependencies: ['typescript', 'client'].
 */
export function pluginTanstackQuery(
  options: PluginTanstackQueryOptions = {},
): TspPlugin<PluginTanstackQueryOptions> {
  return {
    name: 'tanstack-query',
    dependencies: ['typescript', 'client'],

    async generate(context: TspPluginContext, opts?: PluginTanstackQueryOptions): Promise<void> {
      const mergedOpts: PluginTanstackQueryOptions = { ...options, ...opts }
      const client = await resolveClientModule(mergedOpts.clientModule)
      const { generateTanstackQuery } = client

      const parsedDoc = context.parsed
      if (!parsedDoc) {
        context.log('warn', '[tanstack-query] No document found in context.')
        return
      }

      const isSplit = Boolean(mergedOpts.split)
      const tier = mergedOpts.tier ?? 'all'
      const banner = mergedOpts.banner ?? true
      const queryPackage = mergedOpts.queryPackage ?? '@tanstack/react-query'
      const clientName = mergedOpts.clientName ?? 'ApiClient'
      const knownTypesPath = findTypesFilePath(context)
      const knownClientPath = findClientFilePath(context)

      if (isSplit) {
        const keysPath = mergedOpts.keysOutput ?? 'keys.ts'
        const queriesPath = mergedOpts.optionsOutput ?? 'queries.ts'
        const hooksPath = mergedOpts.hooksOutput ?? 'hooks.ts'

        // Resolve relative imports between generated virtual files
        const typesForKeys = mergedOpts.typesFile
          ?? (knownTypesPath ? context.resolveImport(keysPath, knownTypesPath) : './types.js')
        const typesForQueries = mergedOpts.typesFile
          ?? (knownTypesPath ? context.resolveImport(queriesPath, knownTypesPath) : './types.js')
        const typesForHooks = mergedOpts.typesFile
          ?? (knownTypesPath ? context.resolveImport(hooksPath, knownTypesPath) : './types.js')

        const clientForQueries = mergedOpts.clientFile
          ?? (knownClientPath ? context.resolveImport(queriesPath, knownClientPath) : './client.js')
        const clientForHooks = mergedOpts.clientFile
          ?? (knownClientPath ? context.resolveImport(hooksPath, knownClientPath) : './client.js')

        const keysImportForQueries = context.resolveImport(queriesPath, keysPath)
        const keysImportForHooks = context.resolveImport(hooksPath, keysPath)
        const queriesImportForHooks = context.resolveImport(hooksPath, queriesPath)

        const output: TanstackQueryOutput = generateTanstackQuery(parsedDoc, {
          typesImport: typesForQueries,
          clientImport: clientForQueries,
          keysImport: keysImportForQueries,
          queriesImport: queriesImportForHooks,
          queryPackage,
          clientName,
          tier,
          includeHooks: mergedOpts.includeHooks ?? (tier === 'all' || tier === 'hooks'),
          banner,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        if (tier === 'all' || tier === 'keys') {
          // If typesImport differs for keysPath, re-generate keys with typesForKeys
          const keysCode = typesForKeys !== typesForQueries
            ? client.generateKeyFactory(parsedDoc, { typesImport: typesForKeys, banner })
            : output.keysCode

          context.addFile({
            path: keysPath,
            content: keysCode,
            sourcePlugin: 'tanstack-query',
            kind: 'keys',
            exports: extractExportNames(keysCode),
          })
        }

        if (tier === 'all' || tier === 'options') {
          context.addFile({
            path: queriesPath,
            content: output.queriesCode,
            sourcePlugin: 'tanstack-query',
            kind: 'queries',
            exports: extractExportNames(output.queriesCode),
          })
        }

        if (tier === 'all' || tier === 'hooks') {
          if (mergedOpts.includeHooks !== false && output.hooksCode) {
            // Re-generate hooks if hooks-specific imports differ
            let hooksCode = output.hooksCode
            if (
              typesForHooks !== typesForQueries ||
              clientForHooks !== clientForQueries ||
              keysImportForHooks !== keysImportForQueries
            ) {
              hooksCode = client.generateHookFactory(parsedDoc, {
                queryPackage,
                typesImport: typesForHooks,
                clientImport: clientForHooks,
                clientName,
                keysImport: keysImportForHooks,
                queriesImport: queriesImportForHooks,
                banner,
              })
            }

            context.addFile({
              path: hooksPath,
              content: hooksCode,
              sourcePlugin: 'tanstack-query',
              kind: 'hooks',
              exports: extractExportNames(hooksCode),
            })
          }
        }
      } else {
        const outputPath = mergedOpts.output ?? 'queries.ts'
        const typesFile = mergedOpts.typesFile
          ?? (knownTypesPath ? context.resolveImport(outputPath, knownTypesPath) : './types.js')
        const clientFile = mergedOpts.clientFile
          ?? (knownClientPath ? context.resolveImport(outputPath, knownClientPath) : './client.js')

        const output: TanstackQueryOutput = generateTanstackQuery(parsedDoc, {
          typesImport: typesFile,
          clientImport: clientFile,
          queryPackage,
          clientName,
          tier,
          includeHooks: mergedOpts.includeHooks ?? (tier === 'all' || tier === 'hooks'),
          banner,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        let content = output.combinedCode
        if (tier === 'keys') content = output.keysCode
        else if (tier === 'options') content = output.queriesCode
        else if (tier === 'hooks') content = output.hooksCode

        context.addFile({
          path: outputPath,
          content,
          sourcePlugin: 'tanstack-query',
          kind: 'queries',
          exports: extractExportNames(content),
        })
      }
    },
  }
}
