import type { TspPlugin, TspPluginContext } from '../types.js'
import {
  renderOpenApiTsClient,
  type RenderClientOptions,
} from '../client-renderer/openapi-ts-client.js'

export interface PluginClientOptions {
  /** Output file relative path. Default: 'client.ts' */
  output?: string | undefined
  /** Underlying HTTP transport engine: 'fetch' or 'axios'. Default: 'fetch' */
  httpClient?: 'fetch' | 'axios' | undefined
  /** Module specifier for importing types emitted by pluginTypescript. Default: './types.js' */
  typesFile?: string | undefined
  /** Base URL embedded in default client instance */
  baseUrl?: string | undefined
  /** Export standalone functions. Default: true */
  standalone?: boolean | undefined
  /** Export central Client class and createClient factory. Default: true */
  clientClass?: boolean | undefined
  /** Client class name. Default: 'Client' */
  clientName?: string | undefined
}

/**
 * Core plugin for generating openapi-ts style type-safe Client SDK with single-object calling convention
 * { path, query, body, headers } and discriminated union { data, error, response }.
 */
export function pluginClient(options: PluginClientOptions = {}): TspPlugin<PluginClientOptions> {
  return {
    name: 'client',
    dependencies: ['typescript'],
    generate: (context: TspPluginContext, hookOptions?: PluginClientOptions) => {
      const merged: PluginClientOptions = { ...options, ...hookOptions }
      const outputPath = merged.output ?? 'client.ts'

      let typesFile = merged.typesFile
      if (!typesFile) {
        // Look up virtual file registered by upstream pluginTypescript
        const registeredTypesFile = Array.from(context.files.values()).find(
          f => f.sourcePlugin === 'typescript' && f.kind === 'models',
        )
        const targetTypesPath = registeredTypesFile ? registeredTypesFile.path : 'types.ts'
        typesFile = context.resolveImport(outputPath, targetTypesPath)
      }

      const renderOpts: RenderClientOptions = {
        document: context.document,
        parsed: context.parsed,
        output: outputPath,
        httpClient: merged.httpClient ?? 'fetch',
        typesFile,
        baseUrl: merged.baseUrl,
        standalone: merged.standalone ?? true,
        clientClass: merged.clientClass ?? true,
        clientName: merged.clientName ?? 'Client',
      }

      const { code, exports } = renderOpenApiTsClient(renderOpts)

      context.addFile({
        path: outputPath,
        content: code,
        sourcePlugin: 'client',
        exports,
        kind: 'client',
      })

      context.setPluginData('client:output', outputPath)
      context.setPluginData('client:exports', exports)
    },
  }
}

/**
 * Alias for pluginClient matching standard naming conventions.
 */
export const pluginSdk = pluginClient
