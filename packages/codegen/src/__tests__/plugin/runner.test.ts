import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  runTspPluginPipeline,
  defineTspConfig,
  TspConfigValidationError,
  type TspPlugin,
  type TspPluginContext,
} from '../../plugin/index.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient } from '../../plugin/plugins/client.js'
import { pluginRouter } from '../../plugin/plugins/router.js'
import { pluginWire } from '../../plugin/plugins/wire.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('TypeSpec SSOT Plugin Pipeline Runner (runTspPluginPipeline)', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')

  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tsp-runner-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('1. Configuration Validation', () => {
    it('throws TspConfigValidationError when configuration is null or invalid', async () => {
      await expect(runTspPluginPipeline(null)).rejects.toThrow(TspConfigValidationError)
      await expect(runTspPluginPipeline(undefined)).rejects.toThrow(TspConfigValidationError)
      await expect(runTspPluginPipeline('invalid')).rejects.toThrow(TspConfigValidationError)
      await expect(runTspPluginPipeline([])).rejects.toThrow(TspConfigValidationError)
    })

    it('throws TspConfigValidationError when input is missing or empty', async () => {
      await expect(runTspPluginPipeline({ input: '' })).rejects.toThrow(TspConfigValidationError)
      await expect(runTspPluginPipeline({ input: '   ' })).rejects.toThrow(TspConfigValidationError)
      await expect(runTspPluginPipeline({})).rejects.toThrow(TspConfigValidationError)
    })

    it('throws TspConfigValidationError when openApiVersion is unsupported', async () => {
      await expect(
        runTspPluginPipeline({
          input: petstoreFile,
          openApiVersion: '2.0.0' as any,
        }),
      ).rejects.toThrow(TspConfigValidationError)
    })

    it('throws TspConfigValidationError when plugins is not an array', async () => {
      await expect(
        runTspPluginPipeline({
          input: petstoreFile,
          plugins: 'not-an-array' as any,
        }),
      ).rejects.toThrow(TspConfigValidationError)
    })
  })

  describe('2. Lifecycle Phase Orchestration & Topological Order', () => {
    it('executes setup -> transform -> generate -> emit phases in topological order', async () => {
      const callTrace: string[] = []

      const pluginAlpha: TspPlugin = {
        name: 'alpha',
        setup: async () => {
          callTrace.push('alpha:setup')
        },
        transform: () => {
          callTrace.push('alpha:transform')
        },
        generate: (ctx: TspPluginContext) => {
          callTrace.push('alpha:generate')
          ctx.addFile({
            path: 'alpha.ts',
            content: 'export const alpha = 100;',
            sourcePlugin: 'alpha',
          })
        },
        emit: () => {
          callTrace.push('alpha:emit')
        },
      }

      const pluginBeta: TspPlugin = {
        name: 'beta',
        dependencies: ['alpha'],
        setup: () => {
          callTrace.push('beta:setup')
        },
        transform: async () => {
          callTrace.push('beta:transform')
        },
        generate: (ctx: TspPluginContext) => {
          callTrace.push('beta:generate')
          ctx.addFile({
            path: 'beta.ts',
            content: 'export const beta = 200;',
            sourcePlugin: 'beta',
          })
        },
        emit: async () => {
          callTrace.push('beta:emit')
        },
      }

      // Pass in reverse order to verify topological sort orders alpha before beta
      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [pluginBeta, pluginAlpha],
      })

      const result = await runTspPluginPipeline(config)

      expect(callTrace).toEqual([
        'alpha:setup',
        'beta:setup',
        'alpha:transform',
        'beta:transform',
        'alpha:generate',
        'beta:generate',
        'alpha:emit',
        'beta:emit',
      ])

      expect(result.success).toBe(true)
      expect(result.files).toHaveLength(2)
      expect(result.emittedFiles).toHaveLength(2)
    })

    it('respects enforce: "pre" and "post" ordering during execution', async () => {
      const executionOrder: string[] = []

      const postPlugin: TspPlugin = {
        name: 'post-plugin',
        enforce: 'post',
        setup: () => { executionOrder.push('post:setup') },
      }

      const normalPlugin: TspPlugin = {
        name: 'normal-plugin',
        setup: () => { executionOrder.push('normal:setup') },
      }

      const prePlugin: TspPlugin = {
        name: 'pre-plugin',
        enforce: 'pre',
        setup: () => { executionOrder.push('pre:setup') },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [postPlugin, normalPlugin, prePlugin],
      })

      const result = await runTspPluginPipeline(config)
      expect(result.success).toBe(true)
      expect(executionOrder).toEqual(['pre:setup', 'normal:setup', 'post:setup'])
    })
  })

  describe('3. In-Memory Compilation & Document Overrides', () => {
    it('compiles TypeSpec file directly in memory and counts routes', async () => {
      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(true)
      expect(result.entrypoint).toBe(petstoreFile)
      expect(result.routesCount).toBeGreaterThan(0)
      expect(result.context.document.openapi).toBe('3.2.0')
      expect(result.context.document.info.title).toBeDefined()
    })

    it('respects pre-compiled document and program overrides without disk compilation', async () => {
      const mockDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Overridden Mock Spec', version: '9.9.9' },
        paths: {
          '/status': {
            get: {
              operationId: 'getStatus',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }

      let capturedDocTitle: string | undefined

      const inspectorPlugin: TspPlugin = {
        name: 'inspector',
        setup: (ctx) => {
          capturedDocTitle = ctx.document.info.title
        },
      }

      const config = defineTspConfig({
        input: 'virtual-spec.tsp',
        outputDir: tempDir,
        plugins: [inspectorPlugin],
      })

      const result = await runTspPluginPipeline(config, {
        document: mockDoc,
        program: { virtual: true },
      })

      expect(result.success).toBe(true)
      expect(capturedDocTitle).toBe('Overridden Mock Spec')
      expect(result.routesCount).toBe(1)
    })
  })

  describe('4. Virtual File Flushing & Disk Operations', () => {
    it('flushes non-virtual files to disk and creates nested subdirectories', async () => {
      const fileEmitter: TspPlugin = {
        name: 'emitter',
        generate: (ctx) => {
          ctx.addFile({
            path: 'root-file.ts',
            content: 'export const root = true;\n',
            sourcePlugin: 'emitter',
          })
          ctx.addFile({
            path: 'nested/sub/deep-file.ts',
            content: 'export const deep = 42;\n',
            sourcePlugin: 'emitter',
            banner: '// Auto-generated banner comment',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [fileEmitter],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.emittedFiles).toHaveLength(2)

      const rootPath = resolve(tempDir, 'root-file.ts')
      const deepPath = resolve(tempDir, 'nested/sub/deep-file.ts')

      expect(existsSync(rootPath)).toBe(true)
      expect(existsSync(deepPath)).toBe(true)

      const deepContent = readFileSync(deepPath, 'utf8')
      expect(deepContent).toContain('// Auto-generated banner comment')
      expect(deepContent).toContain('export const deep = 42;')
    })

    it('does not emit virtual files (isVirtual: true) to disk', async () => {
      const virtualPlugin: TspPlugin = {
        name: 'virtual-producer',
        generate: (ctx) => {
          ctx.addFile({
            path: 'memory-only.ts',
            content: 'export const secret = "in-memory";\n',
            sourcePlugin: 'virtual-producer',
            isVirtual: true,
          })
          ctx.addFile({
            path: 'physical.ts',
            content: 'export const visible = true;\n',
            sourcePlugin: 'virtual-producer',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [virtualPlugin],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.files).toHaveLength(2)
      expect(result.emittedFiles).toHaveLength(1)
      expect(existsSync(resolve(tempDir, 'memory-only.ts'))).toBe(false)
      expect(existsSync(resolve(tempDir, 'physical.ts'))).toBe(true)
    })

    it('honors dryRun: true by retaining files in memory and writing nothing to disk', async () => {
      const writerPlugin: TspPlugin = {
        name: 'writer',
        generate: (ctx) => {
          ctx.addFile({
            path: 'generated.ts',
            content: 'export const generated = true;\n',
            sourcePlugin: 'writer',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        dryRun: true,
        plugins: [writerPlugin],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(true)
      expect(result.files).toHaveLength(1)
      expect(result.emittedFiles).toHaveLength(0)
      expect(existsSync(resolve(tempDir, 'generated.ts'))).toBe(false)
    })

    it('cleans output directory before emission when clean: true', async () => {
      // Pre-seed stale file in output directory
      const staleFile = resolve(tempDir, 'stale-file.txt')
      writeFileSync(staleFile, 'stale content', 'utf8')
      expect(existsSync(staleFile)).toBe(true)

      const freshPlugin: TspPlugin = {
        name: 'fresh',
        generate: (ctx) => {
          ctx.addFile({
            path: 'fresh.ts',
            content: 'export const fresh = true;\n',
            sourcePlugin: 'fresh',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        clean: true,
        plugins: [freshPlugin],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(true)
      expect(existsSync(staleFile)).toBe(false)
      expect(existsSync(resolve(tempDir, 'fresh.ts'))).toBe(true)
    })
  })

  describe('5. Diagnostics & Execution Status', () => {
    it('sets success: false when plugin reports an error diagnostic', async () => {
      const failingPlugin: TspPlugin = {
        name: 'diagnostician',
        generate: (ctx) => {
          ctx.reportDiagnostic({
            code: 'CUSTOM_ERR_01',
            message: 'Critical generation failure detected',
            severity: 'error',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [failingPlugin],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(false)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]?.code).toBe('CUSTOM_ERR_01')
      expect(result.diagnostics[0]?.severity).toBe('error')
    })

    it('preserves success: true when plugin reports only warnings or info', async () => {
      const warningPlugin: TspPlugin = {
        name: 'warner',
        generate: (ctx) => {
          ctx.reportDiagnostic({
            message: 'Non-fatal deprecation warning',
            severity: 'warning',
          })
          ctx.reportDiagnostic({
            message: 'Information notice',
            severity: 'info',
          })
        },
      }

      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [warningPlugin],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(true)
      expect(result.diagnostics).toHaveLength(2)
    })

    it('tracks elapsed execution durationMs', async () => {
      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        plugins: [],
      })

      const result = await runTspPluginPipeline(config)
      expect(typeof result.durationMs).toBe('number')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('6. Multi-Target Ecosystem Integration', () => {
    it('successfully runs full multi-target pipeline (Typescript + Client + Router + Wire)', async () => {
      const config = defineTspConfig({
        input: petstoreFile,
        outputDir: tempDir,
        dryRun: false,
        plugins: [
          pluginTypescript(),
          pluginClient(),
          pluginRouter({ target: 'hono' }),
          pluginWire({ codecs: ['protobuf', 'msgpack'] }),
        ],
      })

      const result = await runTspPluginPipeline(config)

      expect(result.success).toBe(true)
      expect(result.files.length).toBeGreaterThanOrEqual(4)

      // Verify files generated
      const paths = result.files.map(f => f.path)
      expect(paths).toContain('types.ts')
      expect(paths).toContain('client.ts')
      expect(paths).toContain('router.ts')
      expect(paths).toContain('api.contract.ts')
      expect(paths).toContain('wire.ts')

      // Verify disk files emitted
      expect(existsSync(resolve(tempDir, 'types.ts'))).toBe(true)
      expect(existsSync(resolve(tempDir, 'client.ts'))).toBe(true)
      expect(existsSync(resolve(tempDir, 'router.ts'))).toBe(true)
      expect(existsSync(resolve(tempDir, 'api.contract.ts'))).toBe(true)
      expect(existsSync(resolve(tempDir, 'wire.ts'))).toBe(true)
    })
  })
})
