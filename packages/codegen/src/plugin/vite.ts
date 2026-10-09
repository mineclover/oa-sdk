import type { TspConfig } from './types.js'
import { createTspBuilder, type TspProjectBuilder, type TspWatcherHandle } from './builder.js'
import type { TspPipelineResult } from './runner.js'

/**
 * Configuration options for the Vite TypeSpec Builder plugin.
 */
export interface VitePluginTspOptions {
  /** Path to .tsp entrypoint, project folder, or full TspConfig */
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
 * Structural interface representing a Vite-compatible plugin.
 */
export interface VitePluginTspResult {
  name: string
  buildStart(): Promise<void>
  configureServer(server: any): Promise<void>
  closeBundle(): void
}

/**
 * Vite plugin for transparent TypeSpec builder integration.
 * Triggers zero-disk in-memory build on start and automatic hot reload on .tsp edits.
 */
export function vitePluginTsp(options?: VitePluginTspOptions): VitePluginTspResult {
  let builder: TspProjectBuilder | undefined
  let watcherHandle: TspWatcherHandle | undefined

  const configInput = options?.config ?? './api/main.tsp'

  return {
    name: 'oa-sdk:vite-plugin-tsp',
    async buildStart() {
      if (options?.runOnBuild === false) return
      builder = createTspBuilder(configInput)
      const result = await builder.build()
      options?.onBuildSuccess?.(result)
    },
    async configureServer(server: any) {
      if (options?.runOnDev === false) return
      if (!builder) {
        builder = createTspBuilder(configInput)
      }
      const initialResult = await builder.build()
      options?.onBuildSuccess?.(initialResult)

      if (options?.watch !== false) {
        watcherHandle = builder.watch(async ({ filePath, result }) => {
          if (result) {
            options?.onBuildSuccess?.(result)
          }
          if (server?.config?.logger?.info) {
            server.config.logger.info(`[oa-sdk:tsp] Rebuilt due to change in ${filePath}`, { timestamp: true })
          }
          if (server?.ws?.send) {
            server.ws.send({ type: 'full-reload' })
          }
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
