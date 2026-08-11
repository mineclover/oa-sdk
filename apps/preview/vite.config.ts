import { defineConfig, type Plugin } from 'vite'

const requiredBrowserEntrypoints = new Set([
  '@oa-sdk/core/browser',
  '@oa-sdk/parser/browser',
  '@oa-sdk/codegen/typegen/browser',
  '@oa-sdk/router/browser',
  '@oa-sdk/client/browser',
  '@oa-sdk/mock-server/browser',
])

const nodeOnlyPackageRoots = new Set([
  '@oa-sdk/core',
  '@oa-sdk/parser',
  '@oa-sdk/codegen',
  '@oa-sdk/router',
  '@oa-sdk/client',
  '@oa-sdk/mock-server',
])

const nodeBuiltinRoots = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return specifier.startsWith('node:') || nodeBuiltinRoots.has(bare.split('/')[0]!)
}

function browserRuntimeBoundaryPlugin(): Plugin {
  const seenBrowserEntrypoints = new Set<string>()
  return {
    name: 'oa-sdk-browser-runtime-boundary',
    apply: 'build' as const,
    enforce: 'pre' as const,
    buildStart() {
      seenBrowserEntrypoints.clear()
    },
    resolveId(source: string, importer: string | undefined) {
      if (isNodeBuiltin(source)) {
        this.error(`Browser bundle imports Node builtin ${source} from ${importer ?? '<entry>'}`)
      }
      if (nodeOnlyPackageRoots.has(source)) {
        this.error(`Browser bundle imports Node-only package root ${source} from ${importer ?? '<entry>'}`)
      }
      if (requiredBrowserEntrypoints.has(source)) seenBrowserEntrypoints.add(source)
    },
    buildEnd(error: Error | undefined) {
      if (error) return
      const missing = [...requiredBrowserEntrypoints].filter(entrypoint => !seenBrowserEntrypoints.has(entrypoint))
      if (missing.length > 0) {
        this.error(`Preview did not consume required browser entrypoints: ${missing.join(', ')}`)
      }
    },
  }
}

export default defineConfig({
  root: '.',
  plugins: [browserRuntimeBoundaryPlugin()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
})
