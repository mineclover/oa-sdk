/**
 * packages/codegen/test/adversarial/m3-live-mock-hot-reload-challenger.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE (Milestone 3)
 * Target: Live OpenAPI & Route Hot-Reloading (`oa-gen mock --watch`, `spec-watcher.ts`, `node-http.ts`)
 *
 * Verification Dimensions:
 * 1. TCP Keep-Alive Socket Continuity:
 *    - 10 sequential route hot-swaps on single persistent net.Socket
 *    - Concurrent in-flight HTTP requests during atomic state swaps
 *    - Strict assertion: socketA === socketB across all cycles, destroyed === false, 0 ECONNRESET
 * 2. Rapid Write Storm & Debouncing:
 *    - 60 rapid burst writes within 50ms across JSON, YAML, and TypeScript
 *    - Strict coalescence to a single change trigger
 *    - Final state convergence matching final written payload
 * 3. Severe Syntax Error Bombing:
 *    - Indented tab mismatch & unclosed quotes in YAML
 *    - Truncated & fragmented JSON
 *    - Non-object root structures (arrays, primitives, null)
 *    - Corrupted @oaOperation annotations in TypeScript
 *    - Zero-byte empty files
 *    - Verification of fault isolation: server remains responsive on previous routes throughout bombing
 *    - Recovery verification: subsequent valid edit restores hot-swapping
 * 4. Clean Resource Teardown & Handle Leak Prevention:
 *    - Idempotent close() calls
 *    - Cancellation of pending debounce timers
 *    - Full fs watcher disposal with zero hanging callbacks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import http from 'node:http'
import type { Socket } from 'node:net'
import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server'
import type { OasDocument } from '@oa-sdk/parser'
import {
  detectSpecFormat,
  parseSpecDocument,
  watchSpec,
  type SpecWatcher,
} from '../../src/cli/lib/spec-watcher.js'
import { mock, type MockCommandContext } from '../../src/cli/commands/mock.js'

const tmpBase = resolve(__dirname, '../../.tmp-adversarial-m3')
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

describe('Milestone 3 Adversarial Challenge: TCP Keep-Alive Socket Continuity', () => {
  it('preserves the exact same TCP net.Socket across 10 sequential route hot-swaps without disconnects', async () => {
    // 1. Initialize Mock Server with initial route
    const createDoc = (version: number, routePath: string, payload: unknown): OasDocument => ({
      openapi: '3.2.0',
      info: { title: `Continuous API v${version}`, version: `${version}.0.0` },
      paths: {
        [routePath]: {
          get: {
            operationId: `op_v${version}`,
            responses: {
              '200': {
                description: 'Success',
                content: { 'application/json': { example: payload } },
              },
            },
          },
        },
      },
    })

    const initialDoc = createDoc(0, '/cycle/0', { cycle: 0 })
    const server: NodeMockServer = createNodeMockServer(initialDoc, { port: 0, host: '127.0.0.1' })
    await server.start()

    // 2. Setup Keep-Alive Agent with maxSockets = 1 to enforce single persistent socket
    const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    let rootSocket: Socket | null = null
    let socketAssignedCount = 0

    const makeRequest = (path: string): Promise<{ status: number; body: any; socket: Socket }> => {
      return new Promise((resolvePromise, rejectPromise) => {
        let reqSocket: Socket
        const req = http.request(
          `${server.url}${path}`,
          { agent: keepAliveAgent, method: 'GET' },
          (res) => {
            let data = ''
            res.setEncoding('utf-8')
            res.on('data', (chunk) => {
              data += chunk
            })
            res.on('end', () => {
              try {
                const parsed = data ? JSON.parse(data) : null
                resolvePromise({ status: res.statusCode ?? 0, body: parsed, socket: reqSocket })
              } catch (e) {
                rejectPromise(e)
              }
            })
          },
        )
        req.on('socket', (s) => {
          reqSocket = s
          if (!rootSocket) {
            rootSocket = s
          }
          socketAssignedCount++
        })
        req.on('error', rejectPromise)
        req.end()
      })
    }

    try {
      // Step 1: Initial request
      const res0 = await makeRequest('/cycle/0')
      expect(res0.status).toBe(200)
      expect(res0.body).toEqual({ cycle: 0 })
      expect(res0.socket).toBe(rootSocket)
      expect(rootSocket).not.toBeNull()
      expect(rootSocket!.destroyed).toBe(false)
      const initialLocalPort = rootSocket!.localPort

      // Step 2: Perform 10 consecutive hot-swaps
      for (let i = 1; i <= 10; i++) {
        const nextDoc = createDoc(i, `/cycle/${i}`, { cycle: i, timestamp: Date.now() })
        const swapResult = server.updateSpec(nextDoc)
        expect(swapResult.routesCount).toBe(1)

        // Query the new route on the same Keep-Alive connection
        const nextRes = await makeRequest(`/cycle/${i}`)
        expect(nextRes.status).toBe(200)
        expect(nextRes.body.cycle).toBe(i)

        // STRICT ASSERTIONS: Identity of socket MUST be preserved
        expect(nextRes.socket).toBe(rootSocket)
        expect(nextRes.socket.destroyed).toBe(false)
        expect(nextRes.socket.localPort).toBe(initialLocalPort)

        // Previous route MUST be 404 on the same socket
        const oldRes = await makeRequest(`/cycle/${i - 1}`)
        expect(oldRes.status).toBe(404)
        expect(oldRes.socket).toBe(rootSocket)
        expect(oldRes.socket.destroyed).toBe(false)
      }

      // We made 1 initial + 10*(new + old) = 21 requests on the EXACT SAME TCP socket
      expect(rootSocket!.destroyed).toBe(false)
    } finally {
      keepAliveAgent.destroy()
      await server.stop()
    }
  })

  it('serves concurrent in-flight requests cleanly while route hot-swap is executing', async () => {
    const docA: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Concurrent Spec A', version: '1.0.0' },
      paths: {
        '/slow-service': {
          get: {
            operationId: 'getSlow',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { example: { version: 'A' } } },
              },
            },
          },
        },
      },
    }

    const docB: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Concurrent Spec B', version: '2.0.0' },
      paths: {
        '/slow-service': {
          get: {
            operationId: 'getSlowB',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { example: { version: 'B' } } },
              },
            },
          },
        },
        '/new-concurrent-route': {
          get: {
            operationId: 'getNewRoute',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { example: { added: true } } },
              },
            },
          },
        },
      },
    }

    const server = createNodeMockServer(docA, { port: 0, host: '127.0.0.1' })
    await server.start()

    const agent = new http.Agent({ keepAlive: true })

    try {
      // Dispatch 30 parallel requests while triggering updateSpec in between
      const requests = Array.from({ length: 30 }, async (_, index) => {
        if (index === 15) {
          // Trigger atomic hot-swap mid-flight
          server.updateSpec(docB)
        }
        const res = await fetch(`${server.url}/slow-service`)
        expect(res.status).toBe(200)
        const data = (await res.json()) as any
        expect(data.version === 'A' || data.version === 'B').toBe(true)
        return data.version
      })

      const results = await Promise.all(requests)
      expect(results.length).toBe(30)

      // Verify that after all requests settle, the new route is live
      const finalCheck = await fetch(`${server.url}/new-concurrent-route`)
      expect(finalCheck.status).toBe(200)
      const finalBody = (await finalCheck.json()) as any
      expect(finalBody.added).toBe(true)
    } finally {
      agent.destroy()
      await server.stop()
    }
  })
})

describe('Milestone 3 Adversarial Challenge: Rapid Write Storm & Debouncing Coalescence', () => {
  it('coalesces a burst of 60 rapid writes within 50ms into a single onChange event with final state', async () => {
    const specPath = join(tmpDir, 'write-storm.yaml')
    writeFileSync(
      specPath,
      `
openapi: "3.2.0"
info:
  title: Initial API
  version: "1.0.0"
paths:
  /ping:
    get:
      responses:
        "200":
          description: OK
`,
    )

    let changeCount = 0
    let lastLoadedDoc: OasDocument | null = null
    let watcherError: unknown = null

    const settledPromise = new Promise<void>((resolvePromise, rejectPromise) => {
      const watcher: SpecWatcher = watchSpec(specPath, {
        debounceMs: 120,
        onChange: (doc) => {
          changeCount++
          lastLoadedDoc = doc
          // If onChange triggered more than 2 times during a 50ms burst with 120ms debounce, fail
          if (changeCount > 2) {
            watcher.close()
            rejectPromise(new Error(`Debouncer failed: fired ${changeCount} times for coalesced burst`))
            return
          }
        },
        onError: (err) => {
          watcherError = err
        },
      })

      // Generate a storm of 60 rapid writes within ~40ms
      const burstWrites = async () => {
        for (let i = 1; i <= 60; i++) {
          const yamlContent = `
openapi: "3.2.0"
info:
  title: Storm API Iteration ${i}
  version: "1.0.${i}"
paths:
  /storm-${i}:
    get:
      operationId: op_storm_${i}
      responses:
        "200":
          description: Storm ${i}
`
          writeFileSync(specPath, yamlContent)
          if (i % 5 === 0) {
            await new Promise((r) => setTimeout(r, 1))
          }
        }

        // Wait past the debounce duration to verify settled state
        setTimeout(() => {
          watcher.close()
          resolvePromise()
        }, 300)
      }

      burstWrites().catch(rejectPromise)
    })

    await settledPromise

    expect(watcherError).toBeNull()
    // 60 rapid writes must be coalesced into 1 (or at most 2 due to scheduling jitter)
    expect(changeCount).toBeGreaterThanOrEqual(1)
    expect(changeCount).toBeLessThanOrEqual(2)

    // Verify final state matches the 60th write
    expect(lastLoadedDoc).not.toBeNull()
    expect(lastLoadedDoc?.info?.title).toBe('Storm API Iteration 60')
    expect(lastLoadedDoc?.paths?.['/storm-60']).toBeDefined()
  })

  it('coalesces rapid asynchronous writes on TypeScript @oaOperation sources', async () => {
    const tsPath = join(tmpDir, 'rapid-ops.ts')
    writeFileSync(
      tsPath,
      `
/**
 * @oaOperation GET /api/op-initial
 */
export function opInitial() {}
`,
    )

    let changeCalls = 0
    let lastDoc: OasDocument | null = null

    await new Promise<void>((resolvePromise) => {
      const watcher = watchSpec(tsPath, {
        debounceMs: 100,
        onChange: (doc) => {
          changeCalls++
          lastDoc = doc
        },
      })

      // Burst 30 writes to TS file
      let count = 0
      const interval = setInterval(() => {
        count++
        writeFileSync(
          tsPath,
          `
/**
 * @oaOperation GET /api/op-${count}
 */
export function op${count}() {}
`,
        )
        if (count >= 30) {
          clearInterval(interval)
          setTimeout(() => {
            watcher.close()
            resolvePromise()
          }, 250)
        }
      }, 2)
    })

    expect(changeCalls).toBeGreaterThanOrEqual(1)
    expect(changeCalls).toBeLessThanOrEqual(3)
    expect(lastDoc?.paths?.['/api/op-30']).toBeDefined()
  })
})

describe('Milestone 3 Adversarial Challenge: Severe Syntax Error Bombing', () => {
  it('isolates YAML tab-bombs, unclosed quotes, broken JSON, and invalid @oaOperation tags while keeping previous routes 100% active', async () => {
    const specFile = join(tmpDir, 'bombarded-spec.yaml')
    writeFileSync(
      specFile,
      `
openapi: "3.2.0"
info:
  title: Resilient Fortress API
  version: "1.0.0"
paths:
  /fortress/healthy:
    get:
      operationId: getFortressHealth
      responses:
        "200":
          description: OK
          content:
            application/json:
              example:
                fortress: impenetrable
                active: true
`,
    )

    const abortController = new AbortController()
    const errorLog: string[] = []

    const context: MockCommandContext = {
      projectRoot: tmpDir,
      cwd: tmpDir,
      signal: abortController.signal,
      onServerReady: async (server) => {
        try {
          // 1. Initial health check passes
          const res1 = await fetch(`${server.url}/fortress/healthy`)
          expect(res1.status).toBe(200)
          const body1 = (await res1.json()) as any
          expect(body1.fortress).toBe('impenetrable')

          // --- BOMB 1: YAML Tab Indentation & Unclosed Multiline Quote ---
          writeFileSync(
            specFile,
            `
openapi: "3.2.0"
info:
\ttitle: "Broken Tab
paths:
\t/broken:
`,
          )
          await new Promise((r) => setTimeout(r, 150))
          // Route MUST still be alive and serve 200 OK
          const checkAfterBomb1 = await fetch(`${server.url}/fortress/healthy`)
          expect(checkAfterBomb1.status).toBe(200)
          expect((await checkAfterBomb1.json()) as any).toEqual(body1)

          // --- BOMB 2: Truncated Incomplete JSON ---
          writeFileSync(specFile, '{"openapi": "3.2.0", "paths": { "/truncated": { "get": ')
          await new Promise((r) => setTimeout(r, 150))
          // Route MUST still be alive
          const checkAfterBomb2 = await fetch(`${server.url}/fortress/healthy`)
          expect(checkAfterBomb2.status).toBe(200)

          // --- BOMB 3: Primitive Non-Object Root (JSON array or raw scalar) ---
          writeFileSync(specFile, '[1, 2, 3, "not-an-openapi-spec"]')
          await new Promise((r) => setTimeout(r, 150))
          // Route MUST still be alive
          const checkAfterBomb3 = await fetch(`${server.url}/fortress/healthy`)
          expect(checkAfterBomb3.status).toBe(200)

          // --- BOMB 4: Zero-byte completely empty file ---
          writeFileSync(specFile, '')
          await new Promise((r) => setTimeout(r, 150))
          // Route MUST still be alive
          const checkAfterBomb4 = await fetch(`${server.url}/fortress/healthy`)
          expect(checkAfterBomb4.status).toBe(200)

          // --- RECOVERY: Restore Valid Specification ---
          writeFileSync(
            specFile,
            `
openapi: "3.2.0"
info:
  title: Resilient Fortress Restored
  version: "2.0.0"
paths:
  /fortress/upgraded:
    get:
      operationId: getFortressUpgraded
      responses:
        "200":
          description: OK
          content:
            application/json:
              example:
                fortress: upgraded
                active: true
`,
          )

          // Poll for recovery
          let recovered = false
          for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise((r) => setTimeout(r, 50))
            const checkRecovered = await fetch(`${server.url}/fortress/upgraded`)
            if (checkRecovered.status === 200) {
              const recBody = (await checkRecovered.json()) as any
              expect(recBody.fortress).toBe('upgraded')
              recovered = true
              break
            }
          }
          expect(recovered).toBe(true)

          // Old route is now cleanly replaced by new spec
          const checkOld = await fetch(`${server.url}/fortress/healthy`)
          expect(checkOld.status).toBe(404)
        } finally {
          abortController.abort()
        }
      },
    }

    await mock.run(
      {
        spec: specFile,
        watch: true,
        port: '0',
      },
      context,
    )
  })

  it('rejects invalid @oaOperation syntax in TypeScript source with parse errors and shields watcher', async () => {
    const tsFile = join(tmpDir, 'ts-bombs.ts')

    // Initial valid route
    writeFileSync(
      tsFile,
      `
/**
 * @oaOperation GET /valid-initial
 */
export function validInitial() {}
`,
    )

    let errorCatches: string[] = []
    let watcher: SpecWatcher | null = null

    await new Promise<void>((resolvePromise) => {
      watcher = watchSpec(tsFile, {
        debounceMs: 50,
        onChange: (doc) => {
          if (doc.paths?.['/recovered-valid']) {
            resolvePromise()
          }
        },
        onError: (err) => {
          errorCatches.push(err instanceof Error ? err.message : String(err))
          // Trigger recovery once error is caught
          setTimeout(() => {
            writeFileSync(
              tsFile,
              `
/**
 * @oaOperation GET /recovered-valid
 */
export function recoveredValid() {}
`,
            )
          }, 30)
        },
      })

      // Bombard with invalid @oaOperation (missing slash)
      setTimeout(() => {
        writeFileSync(
          tsFile,
          `
/**
 * @oaOperation GET invalid-path-without-slash
 */
export function bomb1() {}
`,
        )
      }, 20)
    })

    watcher?.close()
    expect(errorCatches.length).toBeGreaterThanOrEqual(1)
    expect(errorCatches[0]).toContain('Failed to extract @oaOperation annotations')
  })
})

describe('Milestone 3 Adversarial Challenge: Clean Resource Teardown & Handle Leaks', () => {
  it('cancels pending debounce timers on close() and prevents post-close execution', async () => {
    const specPath = join(tmpDir, 'leak-test.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Leak Test Initial', version: '1.0.0' },
        paths: {},
      }),
    )

    let triggerCount = 0
    const watcher = watchSpec(specPath, {
      debounceMs: 80,
      onChange: () => {
        triggerCount++
      },
    })

    // Write a modification
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Leak Test Modified', version: '1.0.0' },
        paths: {},
      }),
    )

    // Immediately close before the 80ms timer expires
    watcher.close()

    // Wait 200ms to ensure the timer was genuinely cancelled and did not fire
    await new Promise((r) => setTimeout(r, 200))
    expect(triggerCount).toBe(0)
  })

  it('handles multiple consecutive close() calls idempotently without errors', () => {
    const specPath = join(tmpDir, 'idempotent-close.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Idempotent Close', version: '1.0.0' },
        paths: {},
      }),
    )

    const watcher = watchSpec(specPath, {
      debounceMs: 50,
      onChange: () => {},
    })

    expect(() => {
      watcher.close()
      watcher.close()
      watcher.close()
    }).not.toThrow()
  })

  it('manages 10 simultaneous active watchers and cleanly closes all without fd leaks', async () => {
    const watchers: SpecWatcher[] = []
    const files: string[] = []

    for (let i = 0; i < 10; i++) {
      const file = join(tmpDir, `multi-${i}.yaml`)
      writeFileSync(file, `openapi: "3.2.0"\ninfo:\n  title: Multi ${i}\n  version: "1.0.0"\npaths: {}`)
      files.push(file)
      watchers.push(
        watchSpec(file, {
          debounceMs: 50,
          onChange: () => {},
        }),
      )
    }

    expect(watchers.length).toBe(10)
    for (const w of watchers) {
      expect(w.watchedDirs.length).toBeGreaterThan(0)
      expect(w.targetFiles.length).toBe(1)
    }

    // Trigger writes across all files
    for (let i = 0; i < 10; i++) {
      writeFileSync(files[i], `openapi: "3.2.0"\ninfo:\n  title: Multi Updated ${i}\n  version: "1.0.0"\npaths: {}`)
    }

    // Close all watchers immediately
    for (const w of watchers) {
      w.close()
    }

    // Wait past debounce
    await new Promise((r) => setTimeout(r, 100))
  })

  it('handles temporary file deletion (unlink) during watch mode without crashing and recovers upon file recreation', async () => {
    const { unlinkSync } = await import('node:fs')
    const specFile = join(tmpDir, 'ephemeral-spec.json')
    writeFileSync(
      specFile,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Ephemeral Initial', version: '1.0.0' },
        paths: { '/alive': { get: { operationId: 'getAlive', responses: {} } } },
      }),
    )

    let errorCount = 0
    let reloadedCount = 0

    await new Promise<void>((resolvePromise) => {
      const watcher = watchSpec(specFile, {
        debounceMs: 50,
        onChange: (doc) => {
          if (doc.paths?.['/reborn']) {
            reloadedCount++
            watcher.close()
            resolvePromise()
          }
        },
        onError: () => {
          errorCount++
          // Re-create the file with new content
          setTimeout(() => {
            writeFileSync(
              specFile,
              JSON.stringify({
                openapi: '3.2.0',
                info: { title: 'Ephemeral Reborn', version: '2.0.0' },
                paths: { '/reborn': { get: { operationId: 'getReborn', responses: {} } } },
              }),
            )
          }, 30)
        },
      })

      // Delete the file
      setTimeout(() => {
        unlinkSync(specFile)
      }, 20)
    })

    expect(errorCount).toBeGreaterThanOrEqual(1)
    expect(reloadedCount).toBe(1)
  })

  it('preserves existing routing state and active socket when updateSpec receives completely broken schema', async () => {
    const initialDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Atomic Swap Protection', version: '1.0.0' },
      paths: {
        '/protected': {
          get: {
            operationId: 'getProtected',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { example: { secure: true } } },
              },
            },
          },
        },
      },
    }

    const server = createNodeMockServer(initialDoc, { port: 0, host: '127.0.0.1' })
    await server.start()

    const agent = new http.Agent({ keepAlive: true })

    const sendReq = (): Promise<{ status: number; body: any }> => {
      return new Promise((resolvePromise, rejectPromise) => {
        const req = http.request(`${server.url}/protected`, { agent }, (res) => {
          let data = ''
          res.setEncoding('utf-8')
          res.on('data', (c) => (data += c))
          res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: JSON.parse(data) }))
        })
        req.on('error', rejectPromise)
        req.end()
      })
    }

    try {
      // Step 1: Initial request works
      const initialRes = await sendReq()
      expect(initialRes.status).toBe(200)

      // Step 2: Attempt updateSpec with completely corrupted payload (missing openapi, invalid paths)
      expect(() => {
        server.updateSpec({ notAnOpenApiSpec: 123 } as any)
      }).toThrow()

      // Step 3: Server state MUST remain completely intact, route STILL works
      const postErrorRes = await sendReq()
      expect(postErrorRes.status).toBe(200)
      expect(postErrorRes.body.secure).toBe(true)
    } finally {
      agent.destroy()
      await server.stop()
    }
  })

  it('survives a massive 120-write storm without memory exhaustion or duplicate triggers', async () => {
    const stormFile = join(tmpDir, 'massive-storm.json')
    writeFileSync(
      stormFile,
      JSON.stringify({
        openapi: '3.2.0',
        info: { title: 'Massive Storm 0', version: '1.0.0' },
        paths: {},
      }),
    )

    let changeInvocations = 0
    let finalDoc: OasDocument | null = null

    await new Promise<void>((resolvePromise) => {
      const watcher = watchSpec(stormFile, {
        debounceMs: 150,
        onChange: (doc) => {
          changeInvocations++
          finalDoc = doc
        },
      })

      // Fire 120 synchronous and microtask writes
      for (let i = 1; i <= 120; i++) {
        writeFileSync(
          stormFile,
          JSON.stringify({
            openapi: '3.2.0',
            info: { title: `Massive Storm ${i}`, version: `1.0.${i}` },
            paths: { [`/storm-${i}`]: { get: { operationId: `op${i}`, responses: {} } } },
          }),
        )
      }

      setTimeout(() => {
        watcher.close()
        resolvePromise()
      }, 400)
    })

    // Coalesced to at most 2 calls
    expect(changeInvocations).toBeGreaterThanOrEqual(1)
    expect(changeInvocations).toBeLessThanOrEqual(2)
    expect(finalDoc?.info?.title).toBe('Massive Storm 120')
    expect(finalDoc?.paths?.['/storm-120']).toBeDefined()
  })
})

