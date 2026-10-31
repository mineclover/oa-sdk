import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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

  describe('4b. Output directory clean safety', () => {
    const emptyDoc: OasDocument = { openapi: '3.2.0', info: { title: 'Clean', version: '1.0.0' }, paths: {} }
    const writer: TspPlugin = {
      name: 'writer',
      generate: (ctx) => {
        ctx.addFile({ path: 'out.ts', content: 'export const out = 1\n', sourcePlugin: 'writer' })
      },
    }

    it('never removes a directory outside cwd and the temp dir, whatever its name contains', async () => {
      // A tree outside os.tmpdir() (git-ignored node_modules cache, or ~/.cache when the worktree itself resides inside os.tmpdir())
      // whose path contains "tmp", "dist" and "generated".
      const resolvedTmpDir = realpathSync(tmpdir())
      const resolvedRepoRoot = realpathSync(monorepoRoot)
      const repoInsideTmpDir = resolvedRepoRoot === resolvedTmpDir || resolvedRepoRoot.startsWith(resolvedTmpDir + sep)
      const cacheDir = repoInsideTmpDir
        ? join(homedir(), '.cache', 'oa-sdk-clean-safety-tests')
        : join(monorepoRoot, 'node_modules', '.cache')
      mkdirSync(cacheDir, { recursive: true })
      const scratch = mkdtempSync(join(cacheDir, 'oa-clean-safety-tmp-'))
      try {
        const project = join(scratch, 'project')
        const outside = join(scratch, 'user-data-dist-generated-temp')
        mkdirSync(project, { recursive: true })
        mkdirSync(outside, { recursive: true })
        writeFileSync(join(outside, 'keep.txt'), 'precious')

        const result = await runTspPluginPipeline(
          { input: 'main.tsp', output: outside, plugins: [writer] },
          { cwd: project, document: emptyDoc },
        )

        expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious')
        expect(existsSync(join(outside, 'out.ts'))).toBe(true)
        expect(result.success).toBe(true)
        expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'TSP_CLEAN_SKIPPED', severity: 'warning' }))
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    })

    it('never removes the working directory, its ancestors, or a directory holding the TypeSpec sources', async () => {
      const root = mkdtempSync(join(tmpdir(), 'tsp-clean-ancestor-'))
      try {
        const project = join(root, 'project')
        mkdirSync(join(project, 'src'), { recursive: true })
        writeFileSync(join(project, 'main.tsp'), 'namespace X;')
        writeFileSync(join(root, 'sibling.txt'), 'keep')

        for (const output of ['..', '.', 'src/..']) {
          const result = await runTspPluginPipeline(
            { input: 'main.tsp', output, plugins: [writer] },
            { cwd: project, document: emptyDoc },
          )
          expect(result.diagnostics.map(d => d.code), output).toContain('TSP_CLEAN_SKIPPED')
        }
        expect(existsSync(join(project, 'main.tsp'))).toBe(true)
        expect(existsSync(join(root, 'sibling.txt'))).toBe(true)

        // A TypeSpec project directory given as the input is not cleaned when it is also the output.
        mkdirSync(join(project, 'spec'))
        writeFileSync(join(project, 'spec', 'main.tsp'), 'namespace Spec;')
        const sameDir = await runTspPluginPipeline(
          { input: 'spec', output: 'spec', plugins: [writer] },
          { cwd: project, document: emptyDoc },
        )
        expect(sameDir.diagnostics.map(d => d.code)).toContain('TSP_CLEAN_SKIPPED')
        expect(existsSync(join(project, 'spec', 'main.tsp'))).toBe(true)

        // Even when the TypeSpec sources live elsewhere, the working directory itself is never wiped.
        writeFileSync(join(project, 'keep.txt'), 'keep')
        const external = await runTspPluginPipeline(
          { input: petstoreFile, output: '.', plugins: [writer] },
          { cwd: project, document: emptyDoc },
        )
        expect(external.diagnostics.map(d => d.code)).toContain('TSP_CLEAN_SKIPPED')
        expect(existsSync(join(project, 'keep.txt'))).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('cleans an output directory strictly inside the working directory', async () => {
      const project = mkdtempSync(join(tmpdir(), 'tsp-clean-inside-'))
      try {
        const out = join(project, 'src', 'generated')
        mkdirSync(out, { recursive: true })
        writeFileSync(join(out, 'stale.ts'), 'stale')

        const result = await runTspPluginPipeline(
          { input: 'main.tsp', output: 'src/generated', plugins: [writer] },
          { cwd: project, document: emptyDoc },
        )
        expect(result.diagnostics).toEqual([])
        expect(existsSync(join(out, 'stale.ts'))).toBe(false)
        expect(existsSync(join(out, 'out.ts'))).toBe(true)
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    })

    it('writes non-comment file types without the default // banner', async () => {
      const project = mkdtempSync(join(tmpdir(), 'tsp-json-banner-'))
      try {
        const jsonPlugin: TspPlugin = {
          name: 'json',
          generate: (ctx) => {
            ctx.addFile({ path: 'meta.json', content: '{"ok":true}', sourcePlugin: 'json' })
            ctx.addFile({ path: 'meta.ts', content: 'export const ok = true\n', sourcePlugin: 'json' })
          },
        }
        await runTspPluginPipeline(
          { input: 'main.tsp', output: 'out', format: false, plugins: [jsonPlugin] },
          { cwd: project, document: emptyDoc },
        )
        expect(JSON.parse(readFileSync(join(project, 'out', 'meta.json'), 'utf8'))).toEqual({ ok: true })
        expect(readFileSync(join(project, 'out', 'meta.ts'), 'utf8')).toMatch(/^\/\/ @generated by @oa-sdk\/codegen/)
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    })
  })

  describe('5. Diagnostics & Execution Status', () => {
    it('preserves the last good output when a plugin reports an error', async () => {
      writeFileSync(join(tempDir, 'previous.ts'), 'export const previous = true\n')
      const result = await runTspPluginPipeline({
        input: petstoreFile,
        output: tempDir,
        plugins: [{
          name: 'invalid',
          generate(context: TspPluginContext) {
            context.addFile({
              path: 'next.ts',
              content: 'export const next = true',
              sourcePlugin: 'invalid',
            })
            context.reportDiagnostic({ severity: 'error', message: 'invalid contract' })
          },
        }],
      }, {
        document: { openapi: '3.2.0', info: { title: 'Invalid', version: '1' }, paths: {} },
      })
      expect(result.success).toBe(false)
      expect(result.emittedFiles).toEqual([])
      expect(readFileSync(join(tempDir, 'previous.ts'), 'utf8')).toBe('export const previous = true\n')
      expect(existsSync(join(tempDir, 'next.ts'))).toBe(false)
    })

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
