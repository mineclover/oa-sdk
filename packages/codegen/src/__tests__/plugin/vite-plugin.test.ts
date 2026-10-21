import { describe, it, expect, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { vitePluginTsp } from '../../plugin/vite.js'
import type { TspPipelineResult } from '../../plugin/runner.js'
import { typecheckGeneratedFiles } from './helpers/typecheck-generated.js'

async function waitFor(check: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the watcher')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
}

describe('TypeSpec Builder Platform: vitePluginTsp', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')

  it('exposes Vite plugin hooks with correct plugin name', () => {
    const plugin = vitePluginTsp({ config: petstoreFile })
    expect(plugin.name).toBe('oa-sdk:vite-plugin-tsp')
    expect(typeof plugin.buildStart).toBe('function')
    expect(typeof plugin.configureServer).toBe('function')
    expect(typeof plugin.closeBundle).toBe('function')
  })

  it('executes buildStart and triggers onBuildSuccess callback', async () => {
    const captured: TspPipelineResult[] = []

    const plugin = vitePluginTsp({
      config: {
        input: petstoreFile,
        dryRun: true,
      },
      onBuildSuccess: (result) => {
        captured.push(result)
      },
    })

    await plugin.buildStart()

    expect(captured).toHaveLength(1)
    expect(captured[0]?.success).toBe(true)
    expect(captured[0]?.routesCount).toBe(5)
  })

  it('configures dev server, executes initial build, and un-watches on closeBundle', async () => {
    const captured: TspPipelineResult[] = []

    const plugin = vitePluginTsp({
      config: {
        input: petstoreFile,
        dryRun: true,
      },
      watch: true,
      onBuildSuccess: (result) => {
        captured.push(result)
      },
    })

    const mockServer = {
      config: {
        logger: {
          info: vi.fn(),
        },
      },
      ws: {
        send: vi.fn(),
      },
    }

    await plugin.configureServer(mockServer)

    expect(captured).toHaveLength(1)
    expect(captured[0]?.success).toBe(true)

    // closeBundle stops watcher cleanly
    expect(() => plugin.closeBundle()).not.toThrow()
  })

  it('builds exactly once on dev server startup (configureServer owns it, buildStart is skipped)', async () => {
    const onBuild = vi.fn()
    const plugin = vitePluginTsp({ config: { input: petstoreFile, dryRun: true }, watch: false, onBuildSuccess: onBuild })

    // Vite's serve order: configResolved -> configureServer -> buildStart
    plugin.configResolved({ command: 'serve' })
    await plugin.configureServer({})
    await plugin.buildStart()
    expect(onBuild).toHaveBeenCalledTimes(1)
  })

  it('does not generate on dev server startup with runOnDev: false (even when runOnBuild is on)', async () => {
    const onBuild = vi.fn()
    const plugin = vitePluginTsp({ config: { input: petstoreFile, dryRun: true }, runOnDev: false, onBuildSuccess: onBuild })

    plugin.configResolved({ command: 'serve' })
    await plugin.configureServer({})
    await plugin.buildStart()
    expect(onBuild).not.toHaveBeenCalled()
  })

  it('builds in buildStart for vite build and resolves relative config against the Vite root', async () => {
    const onBuild = vi.fn()
    const plugin = vitePluginTsp({ config: { input: 'petstore/main.tsp', dryRun: true }, onBuildSuccess: onBuild })

    plugin.configResolved({ command: 'build', root: resolve(petstoreFile, '../..') })
    await plugin.buildStart()
    expect(onBuild).toHaveBeenCalledTimes(1)
    expect((onBuild.mock.calls[0]![0] as TspPipelineResult).entrypoint).toBe(petstoreFile)
  })

  it('reports a failed rebuild as an error (logger + overlay) instead of a full reload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-tsp-watch-'))
    try {
      symlinkSync(resolve(__dirname, '../../../node_modules'), join(root, 'node_modules'), 'junction')
      const project = join(root, 'project')
      const main = join(project, 'main.tsp')
      mkdirSync(project)
      copyFileSync(petstoreFile, main)

      const plugin = vitePluginTsp({ config: { input: main, dryRun: true }, debounceMs: 50 })
      const server = {
        config: { logger: { info: vi.fn(), error: vi.fn() } },
        ws: { send: vi.fn() },
      }
      plugin.configResolved({ command: 'serve' })
      await plugin.configureServer(server)
      try {
        writeFileSync(main, 'this is not typespec {{{')
        await waitFor(() => server.config.logger.error.mock.calls.length > 0)

        expect(String(server.config.logger.error.mock.calls[0]![0])).toContain('Rebuild failed')
        expect(server.ws.send).toHaveBeenCalledWith(expect.objectContaining({
          type: 'error',
          err: expect.objectContaining({ message: expect.stringContaining('TypeSpec compilation failed') }),
        }))
        expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' })
        expect(server.config.logger.info).not.toHaveBeenCalled()
      } finally {
        plugin.closeBundle()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("is assignable to Vite's Plugin type and accepts a real ViteDevServer", () => {
    // The structural hook signatures (configResolved, configureServer) must stay compatible with Vite's own types.
    const viteModule = resolve(__dirname, '../../plugin/vite.js')
    const diagnostics = typecheckGeneratedFiles({
      files: {
        'vite.config.ts': [
          "import { defineConfig, type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'",
          `import { vitePluginTsp } from ${JSON.stringify(viteModule)}`,
          "const plugin: Plugin = vitePluginTsp({ config: './api/main.tsp' })",
          'declare const server: ViteDevServer',
          'declare const resolved: ResolvedConfig',
          'const typed = vitePluginTsp()',
          'typed.configResolved(resolved)',
          'export const started: Promise<void> = typed.configureServer(server)',
          'export default defineConfig({ plugins: [plugin, vitePluginTsp()] })',
        ].join('\n'),
      },
      packages: ['vite'],
    })
    expect(diagnostics).toEqual([])
  })

  it('respects runOnBuild: false and runOnDev: false toggles', async () => {
    const onBuild = vi.fn()
    const plugin = vitePluginTsp({
      config: petstoreFile,
      runOnBuild: false,
      runOnDev: false,
      onBuildSuccess: onBuild,
    })

    await plugin.buildStart()
    expect(onBuild).not.toHaveBeenCalled()

    await plugin.configureServer({})
    expect(onBuild).not.toHaveBeenCalled()
  })
})
