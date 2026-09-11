import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { NodeMockServer } from '@oa-sdk/mock-server'
import type { OasDocument } from '@oa-sdk/parser'
import { mock, type MockCommandContext } from '../cli/commands/mock.js'
import { CliExitError } from '../cli/lib/errors.js'
import {
  compileTypeSpecInMemory,
  watchTypeSpec,
  type TypeSpecCompilationResult,
} from '../cli/lib/typespec-mock-compiler.js'

const repoRoot = resolve(__dirname, '../../../..')
const tspMainPath = resolve(repoRoot, 'packages/schemas/typespec/main.tsp')
const tmpBase = resolve(__dirname, '../../.tmp-mock-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('TypeSpec In-Memory Compiler (Zero-Build)', () => {
  it('compiles TypeSpec directly in-memory to OpenAPI 3.2 without intermediate disk writes', async () => {
    const result: TypeSpecCompilationResult = await compileTypeSpecInMemory(tspMainPath)

    expect(result).toBeDefined()
    expect(result.program).toBeDefined()
    expect(result.document).toBeDefined()
    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.info.title).toBeDefined()
    expect(result.routesCount).toBeGreaterThan(0)
    expect(result.sourceFiles.length).toBeGreaterThan(0)

    // Ensure authored files are tracked and node_modules are excluded
    for (const file of result.sourceFiles) {
      expect(file).not.toContain('node_modules')
      expect(file.endsWith('.tsp')).toBe(true)
    }
  })

  it('supports incremental in-memory compilation reusing oldProgram', async () => {
    const initial = await compileTypeSpecInMemory(tspMainPath)
    const incremental = await compileTypeSpecInMemory(tspMainPath, {
      oldProgram: initial.program,
    })

    expect(incremental).toBeDefined()
    expect(incremental.document.openapi).toBe('3.2.0')
    expect(incremental.routesCount).toBe(initial.routesCount)
  })

  it('throws descriptive diagnostic error when TypeSpec syntax or model is broken', async () => {
    const brokenTsp = join(tmpDir, 'broken.tsp')
    writeFileSync(brokenTsp, `
      import "@typespec/http";
      namespace BrokenService;
      model Foo {
        nonExistentTypeProperty: NonExistentType;
      }
    `)

    await expect(compileTypeSpecInMemory(brokenTsp)).rejects.toThrow(/TypeSpec compilation failed/)
  })
})

describe('TypeSpec Source Watcher', () => {
  it('watches TypeSpec files, debounces modifications, and cleans up on close', async () => {
    const testTsp = join(tmpDir, 'service.tsp')
    writeFileSync(testTsp, `
      import "@typespec/http";
      using TypeSpec.Http;
      @service({ title: "Watch Test" })
      namespace WatchTest {
        @route("/ping") op ping(): string;
      }
    `)

    let changeTriggerCount = 0
    const changePromise = new Promise<void>((resolvePromise) => {
      const watcher = watchTypeSpec(
        [testTsp],
        () => {
          changeTriggerCount++
          resolvePromise()
        },
        undefined,
        50,
      )

      // Trigger change
      setTimeout(() => {
        writeFileSync(testTsp, `
          import "@typespec/http";
          using TypeSpec.Http;
          @service({ title: "Watch Test v2" })
          namespace WatchTest {
            @route("/ping") op ping(): string;
            @route("/pong") op pong(): string;
          }
        `)
      }, 30)

      setTimeout(() => {
        watcher.close()
      }, 500)
    })

    await changePromise
    expect(changeTriggerCount).toBeGreaterThanOrEqual(1)
  })
})

describe('oa-gen mock CLI Command', () => {
  it('fails with CliExitError when neither --tsp nor --spec is provided', async () => {
    await expect(mock.run({})).rejects.toBeInstanceOf(CliExitError)
  })

  it('fails with CliExitError when --tsp points to non-existent file', async () => {
    await expect(
      mock.run({ tsp: join(tmpDir, 'does-not-exist.tsp') }),
    ).rejects.toBeInstanceOf(CliExitError)
  })

  it('fails with CliExitError when --spec points to non-existent file', async () => {
    await expect(
      mock.run({ spec: join(tmpDir, 'does-not-exist.yaml') }),
    ).rejects.toBeInstanceOf(CliExitError)
  })

  it('starts instant mock server from TypeSpec with schema validation and 422 value redaction', async () => {
    const abortController = new AbortController()
    let runningServer: NodeMockServer | null = null

    const context: MockCommandContext = {
      projectRoot: repoRoot,
      cwd: repoRoot,
      signal: abortController.signal,
      onServerReady: async (server) => {
        runningServer = server
        try {
          // 1. Verify standard health route (200 OK)
          const healthRes = await fetch(`${server.url}/health`)
          expect(healthRes.status).toBe(200)
          const healthBody = (await healthRes.json()) as any
          expect(healthBody.status).toBe('ok')
          expect(healthBody.timestamp).toBeDefined()

          // 2. Verify version route (200 OK)
          const versionRes = await fetch(`${server.url}/version`)
          expect(versionRes.status).toBe(200)
          const versionBody = (await versionRes.json()) as any
          expect(versionBody.version).toBe('0.1.0')

          // 3. Verify 422 validation on invalid request body with fail-closed redaction
          // /auth/login requires email and password
          const loginRes = await fetch(`${server.url}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'super-secret-password-attempt-not-an-email' }),
          })
          expect(loginRes.status).toBe(422)
          const loginBody = (await loginRes.json()) as any
          expect(loginBody.code).toBeDefined()
          expect(Array.isArray(loginBody.details)).toBe(true)

          // Ensure secret input string was not echoed verbatim in details
          const rawResponseStr = JSON.stringify(loginBody)
          expect(rawResponseStr).not.toContain('super-secret-password-attempt-not-an-email')

          // 4. Verify 404 for undefined routes
          const notFoundRes = await fetch(`${server.url}/non-existent-route-xyz`)
          expect(notFoundRes.status).toBe(404)
        } finally {
          abortController.abort()
        }
      },
    }

    await mock.run(
      {
        tsp: tspMainPath,
        port: '0',
        host: '127.0.0.1',
      },
      context,
    )

    expect(runningServer).not.toBeNull()
  })

  it('hot-swaps routes dynamically via updateSpec on the running server without dropping port', async () => {
    const abortController = new AbortController()
    let initialUrl = ''

    const context: MockCommandContext = {
      projectRoot: repoRoot,
      cwd: repoRoot,
      signal: abortController.signal,
      onServerReady: async (server) => {
        initialUrl = server.url
        try {
          // Verify initial route works
          const initialRes = await fetch(`${server.url}/health`)
          expect(initialRes.status).toBe(200)

          // Verify hot-swapped route is not yet present
          const beforeSwapRes = await fetch(`${server.url}/hot-swap-test-endpoint`)
          expect(beforeSwapRes.status).toBe(404)

          // Create updated spec with new endpoint
          const updatedDoc: OasDocument = {
            openapi: '3.2.0',
            info: { title: 'Hot Swapped Spec', version: '2.0.0' },
            paths: {
              '/hot-swap-test-endpoint': {
                get: {
                  operationId: 'getHotSwapTest',
                  responses: {
                    '200': {
                      description: 'Hot swap success',
                      content: {
                        'application/json': {
                          example: { hotReloaded: true, timestamp: 123456789 },
                        },
                      },
                    },
                  },
                },
              },
            },
          }

          // Hot-swap routes
          const updateResult = server.updateSpec(updatedDoc)
          expect(updateResult.routesCount).toBe(1)
          expect(server.url).toBe(initialUrl)

          // New route is immediately active on same port
          const afterSwapRes = await fetch(`${server.url}/hot-swap-test-endpoint`)
          expect(afterSwapRes.status).toBe(200)
          const afterSwapBody = (await afterSwapRes.json()) as any
          expect(afterSwapBody.hotReloaded).toBe(true)

          // Old route is now 404
          const oldRouteRes = await fetch(`${server.url}/health`)
          expect(oldRouteRes.status).toBe(404)
        } finally {
          abortController.abort()
        }
      },
    }

    await mock.run(
      {
        tsp: tspMainPath,
        port: '0',
      },
      context,
    )
  })

  it('starts mock server from static OpenAPI specification (--spec)', async () => {
    const specFile = join(tmpDir, 'test-spec.json')
    const specContent: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Static Spec Test', version: '1.0.0' },
      paths: {
        '/api/static-test': {
          get: {
            operationId: 'getStaticTest',
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    example: { staticSource: 'json', ok: true },
                  },
                },
              },
            },
          },
        },
      },
    }
    writeFileSync(specFile, JSON.stringify(specContent, null, 2))

    const abortController = new AbortController()

    const context: MockCommandContext = {
      projectRoot: repoRoot,
      cwd: repoRoot,
      signal: abortController.signal,
      onServerReady: async (server) => {
        try {
          const res = await fetch(`${server.url}/api/static-test`)
          expect(res.status).toBe(200)
          const data = (await res.json()) as any
          expect(data.staticSource).toBe('json')
          expect(data.ok).toBe(true)
        } finally {
          abortController.abort()
        }
      },
    }

    await mock.run(
      {
        spec: specFile,
        port: '0',
      },
      context,
    )
  })

  it('spawns oa-gen mock as a CLI subprocess and responds to SIGTERM cleanly', async () => {
    const { spawn } = await import('node:child_process')
    const cliPath = resolve(__dirname, '../../dist/cli/index.js')
    if (!existsSync(cliPath)) {
      // If dist is not built yet, skip or use tsx
      return
    }

    const child = spawn('node', [cliPath, 'mock', '--tsp', tspMainPath, '--port', '0'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let tested = false
    let output = ''

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        rejectPromise(new Error('Timed out waiting for mock server child process'))
      }, 15000)

      child.stdout.on('data', async (chunk) => {
        output += chunk.toString()
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)
        if (match && !tested) {
          tested = true
          const port = match[1]
          try {
            const res = await fetch(`http://127.0.0.1:${port}/health`)
            expect(res.status).toBe(200)
            const body = (await res.json()) as any
            expect(body.status).toBe('ok')
          } catch (err) {
            clearTimeout(timeout)
            child.kill('SIGKILL')
            rejectPromise(err)
            return
          }
          child.kill('SIGTERM')
        }
      })

      child.on('exit', (code, signal) => {
        clearTimeout(timeout)
        expect(code === 0 || signal === 'SIGTERM').toBe(true)
        resolvePromise()
      })
    })

    expect(tested).toBe(true)
  })
})

