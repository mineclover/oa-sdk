import type { TspConfig } from './types.js'
import { createTspBuilder, type TspProjectBuilder, type TspWatcherHandle } from './builder.js'
import type { TspPipelineResult } from './runner.js'

/**
 * Configuration options for the Vite TypeSpec Builder plugin.
 */
export interface VitePluginTspOptions {
  /** Path to .tsp entrypoint, project folder, or full TspConfig. Relative paths resolve against Vite's `root`. */
  config?: string | TspConfig | undefined
  /** Whether to run code generation during Vite dev server startup. Default: true */
  runOnDev?: boolean | undefined
  /** Whether to run code generation during Vite production build. Default: true */
  runOnBuild?: boolean | undefined
  /** Whether to watch .tsp files in dev mode and re-run. Default: true */
  watch?: boolean | undefined
  /** Debounce delay for watch in milliseconds. Default: 150 */
  debounceMs?: number | undefined
  /** Callback fired after build succeeds in dev/watch mode */
  onBuildSuccess?: ((result: TspPipelineResult) => void) | undefined
}

/**
 * The subset of Vite's resolved config the plugin reads.
 */
export interface VitePluginTspResolvedConfig {
  /** 'serve' for the dev server, 'build' for `vite build` */
  command: 'build' | 'serve'
  /** Project root; relative TypeSpec paths resolve against it */
  root?: string | undefined
}

/** Vite's error-overlay payload (`ErrorPayload`). */
export interface VitePluginTspErrorPayload {
  type: 'error'
  err: { message: string; stack: string; plugin?: string | undefined }
}

/**
 * The subset of Vite's dev server the plugin uses. Every member is optional so the plugin also
 * works with partial test doubles.
 */
export interface VitePluginTspDevServer {
  config?: {
    logger?: {
      info?: ((message: string, options?: { timestamp?: boolean }) => void) | undefined
      error?: ((message: string, options?: { timestamp?: boolean }) => void) | undefined
    } | undefined
  } | undefined
  ws?: {
    send?: ((payload: { type: 'full-reload' } | VitePluginTspErrorPayload) => void) | undefined
  } | undefined
}

/**
 * Structural interface representing a Vite-compatible plugin.
 */
export interface VitePluginTspResult {
  name: string
  configResolved(config: VitePluginTspResolvedConfig): void
  buildStart(): Promise<void>
  configureServer(server: VitePluginTspDevServer): Promise<void>
  closeBundle(): void
}

const PLUGIN_NAME = 'oa-sdk:vite-plugin-tsp'

/**
 * Message for a failed rebuild: a thrown error (e.g. TypeSpec compilation failure) or error
 * diagnostics reported by plugins. Undefined when the rebuild succeeded.
 */
function describeRebuildFailure(result: TspPipelineResult | undefined, error: unknown): string | undefined {
  if (error !== undefined) return error instanceof Error ? error.message : String(error)
  if (result && !result.success) {
    return result.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => `${diagnostic.plugin ? `[${diagnostic.plugin}] ` : ''}${diagnostic.message}`)
      .join('\n')
  }
  return undefined
}

/**
 * Vite plugin for transparent TypeSpec builder integration.
 * Triggers zero-disk in-memory build on start and automatic hot reload on .tsp edits.
 *
 * Dev server (`command: 'serve'`): `configureServer` runs the initial build (unless `runOnDev: false`)
 * and starts the watcher; `buildStart` does nothing, so generation runs once per start.
 * `vite build`: `buildStart` runs the build (unless `runOnBuild: false`).
 */
export function vitePluginTsp(options?: VitePluginTspOptions): VitePluginTspResult {
  let builder: TspProjectBuilder | undefined
  let watcherHandle: TspWatcherHandle | undefined
  let command: 'build' | 'serve' | undefined
  let root: string | undefined

  const configInput = options?.config ?? './api/main.tsp'
  const getBuilder = (): TspProjectBuilder => {
    builder ??= createTspBuilder(configInput, root !== undefined ? { cwd: root } : undefined)
    return builder
  }

  return {
    name: PLUGIN_NAME,
    configResolved(config: VitePluginTspResolvedConfig) {
      command = config.command
      root = config.root
    },
    async buildStart() {
      // In dev, configureServer owns the startup build and the watcher (and honors runOnDev).
      if (command === 'serve') return
      if (options?.runOnBuild === false) return
      const result = await getBuilder().build()
      const failure = describeRebuildFailure(result, undefined)
      if (failure !== undefined) throw new Error(failure)
      options?.onBuildSuccess?.(result)
    },
    async configureServer(server: VitePluginTspDevServer) {
      if (options?.runOnDev === false) return
      const devBuilder = getBuilder()
      const initialResult = await devBuilder.build()
      const initialFailure = describeRebuildFailure(initialResult, undefined)
      if (initialFailure !== undefined) throw new Error(initialFailure)
      options?.onBuildSuccess?.(initialResult)

      if (options?.watch !== false) {
        watcherHandle = devBuilder.watch(async ({ filePath, result, error }) => {
          const failure = describeRebuildFailure(result, error)
          if (failure !== undefined || !result) {
            const message = failure ?? 'rebuild produced no result'
            server.config?.logger?.error?.(`[oa-sdk:tsp] Rebuild failed for ${filePath}:\n${message}`, { timestamp: true })
            server.ws?.send?.({
              type: 'error',
              err: {
                message: `[oa-sdk:tsp] ${message}`,
                stack: error instanceof Error ? error.stack ?? '' : '',
                plugin: PLUGIN_NAME,
              },
            })
            return
          }
          options?.onBuildSuccess?.(result)
          server.config?.logger?.info?.(`[oa-sdk:tsp] Rebuilt due to change in ${filePath}`, { timestamp: true })
          server.ws?.send?.({ type: 'full-reload' })
        }, {
          buildOnChange: true,
          debounceMs: options?.debounceMs,
        })
      }
    },
    closeBundle() {
      watcherHandle?.unwatch()
    },
  }
}
