import type { TspPlugin, TspPluginContext } from '../types.js'
import {
  clientNameIssue,
  renderOpenApiTsClient,
  type RenderClientOptions,
  type RenderedClientOperation,
} from '../client-renderer/openapi-ts-client.js'

export type { RenderedClientOperation } from '../client-renderer/openapi-ts-client.js'

export interface PluginClientOptions {
  /** Output file relative path. Default: 'client.ts' */
  output?: string | undefined
  /**
   * Underlying HTTP transport engine: 'fetch' or 'axios'. Default: 'fetch'.
   * Both read a response body as text and parse it the same way (empty: undefined, JSON: the parsed
   * value, other text: the string); 'axios' requests `responseType: 'text'` for that.
   */
  httpClient?: 'fetch' | 'axios' | undefined
  /** Module specifier for importing types emitted by pluginTypescript. Default: './types.js' */
  typesFile?: string | undefined
  /** Base URL embedded in default client instance */
  baseUrl?: string | undefined
  /** Export standalone functions. Default: true */
  standalone?: boolean | undefined
  /**
   * Export the central Client class, the createClient factory and the default-client accessors. Default: true.
   * With `false` only the standalone functions (and types) are exported; they keep using a module-private
   * transport configured from `baseUrl`.
   */
  clientClass?: boolean | undefined
  /**
   * Client class name. Default: 'Client'.
   * It must be an identifier that is not a reserved word, a TypeScript predefined type name, another name the
   * client module declares (`createClient`, `ClientConfig`, ...) or a global it refers to (`fetch`, `Response`, ...);
   * otherwise the plugin reports a `CLIENT_INVALID_CLIENT_NAME` error diagnostic and emits no client module.
   */
  clientName?: string | undefined
}

/**
 * Description of the SDK emitted by pluginClient, published as plugin data under
 * {@link CLIENT_SDK_MANIFEST_KEY} so downstream plugins can call the SDK without re-deriving its names.
 */
export interface ClientSdkManifest {
  /** Virtual path of the emitted client module (e.g. 'client.ts') */
  output: string
  /** Name of the transport class (exported only when `clientClass` is true) */
  clientName: string
  /** Whether the Client class, createClient and the default-client accessors are exported */
  clientClass: boolean
  /** Whether per-operation standalone functions are exported */
  standalone: boolean
  /** Operations with an emitted standalone function */
  operations: readonly RenderedClientOperation[]
}

/** Plugin-data key under which pluginClient publishes its {@link ClientSdkManifest}. */
export const CLIENT_SDK_MANIFEST_KEY = 'client:sdk'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRenderedClientOperation(value: unknown): value is RenderedClientOperation {
  return isRecord(value)
    && (value.operationId === undefined || typeof value.operationId === 'string')
    && typeof value.method === 'string'
    && typeof value.path === 'string'
    && typeof value.baseName === 'string'
    && typeof value.functionName === 'string'
    && typeof value.primaryFunctionName === 'string'
    && typeof value.hasPathParams === 'boolean'
    && typeof value.hasQueryParams === 'boolean'
    && typeof value.hasHeaderParams === 'boolean'
    && typeof value.hasBody === 'boolean'
    && typeof value.hasSuccessResponse === 'boolean'
}

/**
 * Reads the {@link ClientSdkManifest} published by pluginClient in this pipeline run.
 * Returns undefined when pluginClient did not run (or the plugin data has another shape).
 */
export function readClientSdkManifest(context: TspPluginContext): ClientSdkManifest | undefined {
  const value: unknown = context.sharedData.get(CLIENT_SDK_MANIFEST_KEY)
  if (!isRecord(value)) return undefined
  const { output, clientName, clientClass, standalone, operations } = value
  if (
    typeof output !== 'string'
    || typeof clientName !== 'string'
    || typeof clientClass !== 'boolean'
    || typeof standalone !== 'boolean'
    || !Array.isArray(operations)
    || !operations.every(isRenderedClientOperation)
  ) {
    return undefined
  }
  return { output, clientName, clientClass, standalone, operations }
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

      const clientName = merged.clientName ?? 'Client'
      const clientNameError = clientNameIssue(clientName)
      if (clientNameError) {
        context.reportDiagnostic({
          plugin: 'client',
          code: 'CLIENT_INVALID_CLIENT_NAME',
          severity: 'error',
          message: `[client] ${clientNameError}; choose another clientName for the client class.`,
        })
        return
      }
      const standalone = merged.standalone ?? true
      const clientClass = merged.clientClass ?? true

      const renderOpts: RenderClientOptions = {
        document: context.document,
        parsed: context.parsed,
        output: outputPath,
        httpClient: merged.httpClient ?? 'fetch',
        typesFile,
        baseUrl: merged.baseUrl,
        standalone,
        clientClass,
        clientName,
      }

      const { code, exports, operations } = renderOpenApiTsClient(renderOpts)

      context.addFile({
        path: outputPath,
        content: code,
        sourcePlugin: 'client',
        exports,
        kind: 'client',
      })

      const manifest: ClientSdkManifest = {
        output: outputPath,
        clientName,
        clientClass,
        standalone,
        operations,
      }
      context.setPluginData('client:output', outputPath)
      context.setPluginData('client:exports', exports)
      context.setPluginData(CLIENT_SDK_MANIFEST_KEY, manifest)
    },
  }
}

/**
 * Alias for pluginClient matching standard naming conventions.
 */
export const pluginSdk = pluginClient
