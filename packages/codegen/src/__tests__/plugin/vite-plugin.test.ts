import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { vitePluginTsp } from '../../plugin/vite.js'
import type { TspPipelineResult } from '../../plugin/runner.js'

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
    let capturedResult: any = undefined

    const plugin = vitePluginTsp({
      config: {
        input: petstoreFile,
        dryRun: true,
      },
      onBuildSuccess: (result) => {
        capturedResult = result
      },
    })

    await plugin.buildStart()

    expect(capturedResult).toBeDefined()
    expect(capturedResult?.success).toBe(true)
    expect(capturedResult?.routesCount).toBe(5)
  })

  it('configures dev server, executes initial build, and un-watches on closeBundle', async () => {
    let capturedResult: any = undefined

    const plugin = vitePluginTsp({
      config: {
        input: petstoreFile,
        dryRun: true,
      },
      watch: true,
      onBuildSuccess: (result) => {
        capturedResult = result
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

    expect(capturedResult).toBeDefined()
    expect(capturedResult?.success).toBe(true)

    // closeBundle stops watcher cleanly
    expect(() => plugin.closeBundle()).not.toThrow()
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
