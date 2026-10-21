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
 * Tiers are cumulative: 'keys' emits the key factories, 'options' adds the option factories
 * (which reference the keys), and 'hooks' adds the hooks (which reference the option factories),
 * so every emitted module only imports modules that are emitted too.
 *
 * When pluginClient ran in the same pipeline (and `clientFile` is not set), the plugin also emits
 * an operation-method adapter (`api-client.ts`, see ./tanstack-client-adapter.ts): the TanStack
 * code calls `client.<operation>(...positional, { signal })`, which the adapter implements on top
 * of pluginClient's standalone functions. Create the client with `createApiClient(createClient(...))`.
 * A failed response rejects the query/mutation with the parsed error body when the operation declares
 * a JSON error model for its status (the `<Operation>Error` type the TanStack code declares), and with
 * an `ApiClientResponseError` (status, body, response) otherwise.
 *
 * @oa-sdk/codegen
 */

import type { TspPlugin, TspPluginContext } from '../types.js'
import type { TanstackQueryOutput } from '@oa-sdk/client'
import { readClientSdkManifest, type ClientSdkManifest } from './client.js'
import { renderTanstackClientAdapter } from './tanstack-client-adapter.js'

export type ClientModule = typeof import('@oa-sdk/client')

export interface PluginTanstackQueryOptions {
  /** Output file relative path when not split. Default: 'queries.ts' */
  output?: string | undefined
  /** Module specifier to import types from. If omitted, resolved via context.resolveImport or default './types.js' */
  typesFile?: string | undefined
  /**
   * Module specifier of a hand-written client module exporting `clientName` (an object with one method per
   * operation). Setting it disables the pluginClient adapter. If omitted, the adapter (when pluginClient ran),
   * the generated client file, or './client.js' is used.
   */
  clientFile?: string | undefined
  /**
   * Emit the operation-method adapter over pluginClient's SDK. Default: true when pluginClient ran in the
   * pipeline and `clientFile` is not set.
   */
  clientAdapter?: boolean | undefined
  /** Output path of the pluginClient adapter module. Default: 'api-client.ts' */
  adapterOutput?: string | undefined
  /**
   * Which tiers to generate: 'all' | 'keys' | 'options' | 'hooks'. Default: 'all'.
   * Tiers are cumulative: 'options' includes the keys and 'hooks' includes the keys and options.
   */
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
  /**
   * Type name of the client parameter. Defaults to 'ApiClient'. With the pluginClient adapter this is the
   * name of the generated interface (and of its factory, `create<clientName>`).
   */
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
 * Decides whether the pluginClient adapter is emitted and where. Reports a diagnostic when the
 * adapter is requested but cannot be built.
 */
function resolveAdapterPath(context: TspPluginContext, opts: PluginTanstackQueryOptions): string | undefined {
  if (opts.clientFile !== undefined || opts.clientAdapter === false) return undefined
  const sdk = readClientSdkManifest(context)
  if (!sdk) {
    if (opts.clientAdapter === true) {
      context.reportDiagnostic({
        plugin: 'tanstack-query',
        code: 'TANSTACK_CLIENT_ADAPTER_NO_SDK',
        severity: 'error',
        message: '[tanstack-query] clientAdapter: true requires pluginClient in the same pipeline.',
      })
    }
    return undefined
  }
  if (!sdk.standalone) {
    context.reportDiagnostic({
      plugin: 'tanstack-query',
      code: 'TANSTACK_CLIENT_ADAPTER_NO_STANDALONE',
      severity: 'error',
      message: '[tanstack-query] The TanStack options call one function per operation, but pluginClient({ standalone: false }) '
        + 'emits none. Enable pluginClient standalone functions or pass clientFile with an operation-method client.',
    })
    return undefined
  }
  return opts.adapterOutput ?? 'api-client.ts'
}

function emitClientAdapter(
  context: TspPluginContext,
  adapterPath: string,
  interfaceName: string,
  banner: boolean,
  typesImport: string,
): void {
  const sdk: ClientSdkManifest | undefined = readClientSdkManifest(context)
  if (!sdk) return
  const adapter = renderTanstackClientAdapter({
    parsed: context.parsed,
    sdk,
    clientImport: context.resolveImport(adapterPath, sdk.output),
    typesImport,
    interfaceName,
    banner,
  })

  for (const operationId of adapter.missing) {
    context.reportDiagnostic({
      plugin: 'tanstack-query',
      code: 'TANSTACK_CLIENT_ADAPTER_MISSING_OPERATION',
      severity: 'error',
      message: `[tanstack-query] pluginClient emitted no function for operation "${operationId}"; its ${interfaceName} method always rejects.`,
      file: adapterPath,
    })
  }
  for (const issue of adapter.unsupported) {
    context.reportDiagnostic({
      plugin: 'tanstack-query',
      code: 'TANSTACK_CLIENT_ADAPTER_UNSUPPORTED',
      severity: 'warning',
      message: issue.always
        ? `[tanstack-query] ${issue.reason}, which the operation requires; its ${interfaceName} method always rejects.`
        : `[tanstack-query] ${issue.reason}; its ${interfaceName} method rejects when that argument is passed.`,
      file: adapterPath,
    })
  }

  context.addFile({
    path: adapterPath,
    content: adapter.code,
    sourcePlugin: 'tanstack-query',
    kind: 'client-adapter',
    exports: adapter.exports,
  })
  context.setPluginData('tanstack-query:clientAdapter', {
    output: adapterPath,
    interfaceName,
    factoryName: adapter.factoryName,
    errorClassName: adapter.errorClassName,
  })
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
      const includeHooks = mergedOpts.includeHooks ?? (tier === 'all' || tier === 'hooks')
      // Option factories (and the hooks built on them) are the only code that calls the client.
      const needsClient = tier !== 'keys'

      const adapterPath = needsClient ? resolveAdapterPath(context, mergedOpts) : undefined
      const knownClientPath = adapterPath ?? findClientFilePath(context)
      const resolveTypesFor = (fromPath: string): string => mergedOpts.typesFile
        ?? (knownTypesPath ? context.resolveImport(fromPath, knownTypesPath) : './types.js')
      const resolveClientFor = (fromPath: string): string => mergedOpts.clientFile
        ?? (knownClientPath ? context.resolveImport(fromPath, knownClientPath) : './client.js')

      if (isSplit) {
        const keysPath = mergedOpts.keysOutput ?? 'keys.ts'
        const queriesPath = mergedOpts.optionsOutput ?? 'queries.ts'
        const hooksPath = mergedOpts.hooksOutput ?? 'hooks.ts'

        // Resolve relative imports between generated virtual files
        const typesForKeys = resolveTypesFor(keysPath)
        const typesForQueries = resolveTypesFor(queriesPath)
        const typesForHooks = resolveTypesFor(hooksPath)

        const clientForQueries = resolveClientFor(queriesPath)
        const clientForHooks = resolveClientFor(hooksPath)

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
          includeHooks,
          banner,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        // Every tier depends on the key factories, so keys.ts is always emitted.
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

        if (needsClient) {
          context.addFile({
            path: queriesPath,
            content: output.queriesCode,
            sourcePlugin: 'tanstack-query',
            kind: 'queries',
            exports: extractExportNames(output.queriesCode),
          })
        }

        if ((tier === 'all' || tier === 'hooks') && mergedOpts.includeHooks !== false && output.hooksCode) {
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
      } else {
        const outputPath = mergedOpts.output ?? 'queries.ts'

        const output: TanstackQueryOutput = generateTanstackQuery(parsedDoc, {
          typesImport: resolveTypesFor(outputPath),
          clientImport: resolveClientFor(outputPath),
          queryPackage,
          clientName,
          tier,
          includeHooks,
          banner,
          ...(mergedOpts.basePath !== undefined ? { basePath: mergedOpts.basePath } : {}),
        })

        // combinedCode is self-contained for every tier (it inlines the keys and, for 'hooks', the options).
        // keysCode, queriesCode and hooksCode are the split-mode modules that import each other.
        const content = tier === 'keys' ? output.keysCode : output.combinedCode

        context.addFile({
          path: outputPath,
          content,
          sourcePlugin: 'tanstack-query',
          kind: 'queries',
          exports: extractExportNames(content),
        })
      }

      if (adapterPath) {
        emitClientAdapter(context, adapterPath, clientName, banner, resolveTypesFor(adapterPath))
      }
    },
  }
}
