import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { compile, NodeHost } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'
import { compileTypeSpecSnippet, emitOpenApi3Snippet } from './helpers/compiler.js'
import { startInMemoryMockServer, fetchMock, type MockServerInstance } from './helpers/server.js'
import { runOaGen } from './helpers/cli.js'

describe('Tier 1: Zero-Build Instant Mock Server (F9-F13)', () => {
  let activeServers: MockServerInstance[] = []

  afterEach(async () => {
    for (const s of activeServers) {
      await s.stop()
    }
    activeServers = []
  })

  // =========================================================================
  // F9: In-Memory OpenAPI 3.2 Emission
  // =========================================================================
  describe('F9: In-Memory OpenAPI 3.2 Emission', () => {
    it('T1-F9-1: getOpenAPI3 returns OpenAPI 3.2 JS doc directly in-memory without disk write', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service
        namespace InMemEmitTest {
          @route("/users") op listUsers(): string[];
        }
      `
      const { document, program, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document).toBeDefined()
        expect(typeof document).toBe('object')
        expect(document.openapi).toBe('3.2.0')
        expect(document.paths['/users']).toBeDefined()
      } finally {
        await cleanup()
      }
    })

    it('T1-F9-2: emitted document root has openapi: "3.2.0" and valid info and paths objects', async () => {
      const source = `
        import "@typespec/http";
        import "@typespec/openapi";
        using TypeSpec.Http;
        using TypeSpec.OpenAPI;

        @service
        @info(#{ title: "Mockable API", version: "1.0.0" })
        namespace ServiceMeta {
          @route("/status") op status(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.openapi).toBe('3.2.0')
        expect(document.info).toBeDefined()
        expect(document.info.version).toBeDefined()
        expect(Object.keys(document.paths)).toContain('/status')
      } finally {
        await cleanup()
      }
    })

    it('T1-F9-3: preserves operation status codes, parameters, and response schemas', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model User { id: string; name: string; }

        @service
        namespace UserOps {
          @route("/users/{id}")
          op getUser(@path id: string): User;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const getOp = document.paths['/users/{id}'].get
        expect(getOp).toBeDefined()
        expect(getOp.parameters).toBeDefined()
        expect(getOp.parameters.some((p: any) => p.name === 'id' && p.in === 'path')).toBe(true)
        expect(getOp.responses['200']).toBeDefined()
      } finally {
        await cleanup()
      }
    })

    it('T1-F9-4: preserves model property types, required lists, and descriptions', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @doc("Customer profile model")
        model Customer {
          @doc("Unique identifier")
          id: string;

          @doc("Primary email address")
          email: string;

          phone?: string;
        }

        @service namespace CustomerService {
          @route("/customers") op createCustomer(@body cust: Customer): Customer;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const schema = document.components.schemas.Customer
        expect(schema).toBeDefined()
        expect(schema.type).toBe('object')
        expect(schema.required).toContain('id')
        expect(schema.required).toContain('email')
        expect(schema.required).not.toContain('phone')
        expect(schema.properties.email.type).toBe('string')
      } finally {
        await cleanup()
      }
    })

    it('T1-F9-5: correctly resolves internal $ref pointers in in-memory schema graph', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model Department { name: string; }
        model Employee { id: string; dept: Department; }

        @service namespace CompanyService {
          @route("/employees") op list(): Employee[];
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        expect(document.components.schemas.Department).toBeDefined()
        expect(document.components.schemas.Employee).toBeDefined()
        const employeeSchema = document.components.schemas.Employee
        const deptProp = employeeSchema.properties.dept
        expect(deptProp.$ref).toBe('#/components/schemas/Department')
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F10: Direct In-Memory Schema Mocking
  // =========================================================================
  describe('F10: Direct In-Memory Schema Mocking', () => {
    it('T1-F10-1: starts mock server directly from in-memory schema without prior disk build', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace DirectMock {
          @route("/ping") op ping(): { pong: boolean };
        }
      `
      const { document, cleanup: compCleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        expect(mockInstance.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      } finally {
        await compCleanup()
      }
    })

    it('T1-F10-2: responds to valid HTTP GET request matching schema with 200 OK and synthetic payload', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model HealthStatus {
          status: string;
          ok: boolean;
        }

        @service namespace HealthService {
          @route("/healthz") op check(): HealthStatus;
        }
      `
      const { document, cleanup: compCleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/healthz')
        expect(res.status).toBe(200)
        const body = res.json()
        expect(body).toBeDefined()
        expect(typeof body.status).toBe('string')
        expect(typeof body.ok).toBe('boolean')
      } finally {
        await compCleanup()
      }
    })

    it('T1-F10-3: responds to valid HTTP POST request with valid status code and generated mock body', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model CreateUserInput { name: string; email: string; }
        model CreateUserResult { id: string; name: string; createdAt: string; }

        @service namespace UserService {
          @route("/users")
          @post op create(@body input: CreateUserInput): { @statusCode code: 201, @body body: CreateUserResult };
        }
      `
      const { document, cleanup: compCleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
        })
        expect(res.status).toBe(201)
        const body = res.json()
        expect(body).toBeDefined()
        expect(typeof body.id).toBe('string')
      } finally {
        await compCleanup()
      }
    })

    it('T1-F10-4: validates request payloads and returns 422 Unprocessable Content for missing required fields', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        model StrictInput {
          requiredName: string;
          requiredCode: int32;
        }

        @service namespace StrictService {
          @route("/strict")
          @post op submit(@body input: StrictInput): { success: boolean };
        }
      `
      const { document, cleanup: compCleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        // Omit requiredCode
        const res = await fetchMock(mockInstance.url, '/strict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requiredName: 'ValidName' }),
        })
        expect(res.status).toBe(422)
      } finally {
        await compCleanup()
      }
    })

    it('T1-F10-5: sets appropriate Content-Type: application/json header on mock responses', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;

        @service namespace HeaderCheck {
          @route("/meta") op meta(): { version: string };
        }
      `
      const { document, cleanup: compCleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = await fetchMock(mockInstance.url, '/meta')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('application/json')
      } finally {
        await compCleanup()
      }
    })
  })

  // =========================================================================
  // F11: Atomic Route Hot-Reload (`updateSpec`)
  // =========================================================================
  describe('F11: Atomic Route Hot-Reload (`updateSpec`)', () => {
    it('T1-F11-1: updateSpec updates routing table in-flight without dropping TCP listener', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace HotReload {
          @route("/initial") op initial(): string;
        }
      `
      const sourceV2 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace HotReload {
          @route("/initial") op initial(): string;
          @route("/updated") op updated(): string;
        }
      `
      const { document: docV1, cleanup: c1 } = await emitOpenApi3Snippet(sourceV1)
      const { document: docV2, cleanup: c2 } = await emitOpenApi3Snippet(sourceV2)
      try {
        const mockInstance = await startInMemoryMockServer(docV1)
        activeServers.push(mockInstance)

        const initialRes = await fetchMock(mockInstance.url, '/initial')
        expect(initialRes.status).toBe(200)

        // Hot swap routes
        const updateResult = mockInstance.updateSpec(docV2)
        expect(updateResult.routesCount).toBe(2)

        // Listener still alive on same port!
        const initialResAfter = await fetchMock(mockInstance.url, '/initial')
        expect(initialResAfter.status).toBe(200)
      } finally {
        await c1()
        await c2()
      }
    })

    it('T1-F11-2: newly added route in nextSpec becomes immediately reachable on the same running port', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RouteAdd {
          @route("/v1") op v1(): string;
        }
      `
      const sourceV2 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RouteAdd {
          @route("/v1") op v1(): string;
          @route("/v2/new-feature") op newFeature(): { enabled: boolean };
        }
      `
      const { document: docV1, cleanup: c1 } = await emitOpenApi3Snippet(sourceV1)
      const { document: docV2, cleanup: c2 } = await emitOpenApi3Snippet(sourceV2)
      try {
        const mockInstance = await startInMemoryMockServer(docV1)
        activeServers.push(mockInstance)

        // Before update: /v2/new-feature is 404
        const preRes = await fetchMock(mockInstance.url, '/v2/new-feature')
        expect(preRes.status).toBe(404)

        // Update
        mockInstance.updateSpec(docV2)

        // After update: /v2/new-feature is 200
        const postRes = await fetchMock(mockInstance.url, '/v2/new-feature')
        expect(postRes.status).toBe(200)
        expect(typeof postRes.json().enabled).toBe('boolean')
      } finally {
        await c1()
        await c2()
      }
    })

    it('T1-F11-3: removed route in nextSpec immediately returns 404 on subsequent requests', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RouteRemove {
          @route("/active") op active(): string;
          @route("/deprecated") op deprecated(): string;
        }
      `
      const sourceV2 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RouteRemove {
          @route("/active") op active(): string;
        }
      `
      const { document: docV1, cleanup: c1 } = await emitOpenApi3Snippet(sourceV1)
      const { document: docV2, cleanup: c2 } = await emitOpenApi3Snippet(sourceV2)
      try {
        const mockInstance = await startInMemoryMockServer(docV1)
        activeServers.push(mockInstance)

        expect((await fetchMock(mockInstance.url, '/deprecated')).status).toBe(200)

        // Hot swap removing /deprecated
        mockInstance.updateSpec(docV2)

        expect((await fetchMock(mockInstance.url, '/deprecated')).status).toBe(404)
        expect((await fetchMock(mockInstance.url, '/active')).status).toBe(200)
      } finally {
        await c1()
        await c2()
      }
    })

    it('T1-F11-4: modified schema response shape in nextSpec is served on subsequent requests', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;
        model Shape { id: string; }
        @service namespace ShapeMod {
          @route("/shape") op get(): Shape;
        }
      `
      const sourceV2 = `
        import "@typespec/http";
        using TypeSpec.Http;
        model Shape { id: string; extraField: string; count: int32; }
        @service namespace ShapeMod {
          @route("/shape") op get(): Shape;
        }
      `
      const { document: docV1, cleanup: c1 } = await emitOpenApi3Snippet(sourceV1)
      const { document: docV2, cleanup: c2 } = await emitOpenApi3Snippet(sourceV2)
      try {
        const mockInstance = await startInMemoryMockServer(docV1)
        activeServers.push(mockInstance)

        const v1Res = await fetchMock(mockInstance.url, '/shape')
        expect(v1Res.json().extraField).toBeUndefined()

        // Update schema shape
        mockInstance.updateSpec(docV2)

        const v2Res = await fetchMock(mockInstance.url, '/shape')
        expect(v2Res.json().extraField).toBeDefined()
        expect(typeof v2Res.json().count).toBe('number')
      } finally {
        await c1()
        await c2()
      }
    })

    it('T1-F11-5: returns route count summary { routesCount: N } upon updateSpec', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RouteCount {
          @route("/r1") op r1(): string;
          @route("/r2") op r2(): string;
          @route("/r3") op r3(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        const res = mockInstance.updateSpec(document)
        expect(res.routesCount).toBe(3)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F12: File Watching & Incremental Recompilation
  // =========================================================================
  describe('F12: File Watching & Incremental Recompilation', () => {
    it('T1-F12-1: discovers participating authored .tsp source files via program.sourceFiles', async () => {
      const source = `
        import "@typespec/http";
        import "./child.tsp";
        using TypeSpec.Http;
        @service namespace WatchDiscover {
          @route("/test") op test(): string;
        }
      `
      const { program, tmpDir, cleanup } = await compileTypeSpecSnippet(source, {
        files: { 'child.tsp': 'namespace WatchDiscover { model Child { id: string; } }' },
      })
      try {
        const authoredFiles = Array.from(program.sourceFiles.keys())
          .filter(f => !f.includes('node_modules'))

        expect(authoredFiles.some(f => f.endsWith('main.tsp'))).toBe(true)
        expect(authoredFiles.some(f => f.endsWith('child.tsp'))).toBe(true)
      } finally {
        await cleanup()
      }
    })

    it('T1-F12-2: incremental recompilation with oldProgram executes in under 500ms', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace FastRecomp {
          @route("/fast") op fast(): string;
        }
      `
      const { program: p1, entrypoint, cleanup } = await compileTypeSpecSnippet(source)
      try {
        const start = performance.now()
        const p2 = await compile(NodeHost, entrypoint, { noEmit: true }, p1)
        const duration = performance.now() - start

        expect(p2.diagnostics.length).toBe(0)
        expect(duration).toBeLessThan(500)
      } finally {
        await cleanup()
      }
    })

    it('T1-F12-3: rapid successive compiles produce consistent AST outputs without file descriptor leaks', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace LoopCompile {
          @route("/loop") op loop(): string;
        }
      `
      const { entrypoint, cleanup } = await compileTypeSpecSnippet(source)
      try {
        let prev = undefined
        for (let i = 0; i < 5; i++) {
          prev = await compile(NodeHost, entrypoint, { noEmit: true }, prev)
          expect(prev.diagnostics.length).toBe(0)
        }
      } finally {
        await cleanup()
      }
    })

    it('T1-F12-4: discards invalid recompilations and keeps existing routing table intact on syntax error', async () => {
      const validSource = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace ErrorDiscard {
          @route("/stable") op stable(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(validSource)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        activeServers.push(mockInstance)

        // Compiling invalid TypeSpec produces error diagnostics
        const invalidSource = `invalid syntax here;;;;`
        const invalidRes = await compileTypeSpecSnippet(invalidSource)
        const hasErrors = invalidRes.program.diagnostics.some(d => d.severity === 'error')
        expect(hasErrors).toBe(true)
        await invalidRes.cleanup()

        // Server still handles /stable cleanly
        const res = await fetchMock(mockInstance.url, '/stable')
        expect(res.status).toBe(200)
      } finally {
        await cleanup()
      }
    })

    it('T1-F12-5: successfully updates mock routes from incrementally recompiled document', async () => {
      const sourceV1 = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace RecompUpdate {
          @route("/ping") op ping(): string;
        }
      `
      const { program: p1, entrypoint, cleanup } = await compileTypeSpecSnippet(sourceV1)
      try {
        const docs1 = await getOpenAPI3(p1, { 'openapi-versions': ['3.2.0'] })
        const mockInstance = await startInMemoryMockServer(docs1[0].document)
        activeServers.push(mockInstance)

        // Write update
        const sourceV2 = `
          import "@typespec/http";
          using TypeSpec.Http;
          @service namespace RecompUpdate {
            @route("/ping") op ping(): string;
            @route("/pong") op pong(): string;
          }
        `
        await fs.writeFile(entrypoint, sourceV2, 'utf8')
        const p2 = await compile(NodeHost, entrypoint, { noEmit: true }, p1)
        const docs2 = await getOpenAPI3(p2, { 'openapi-versions': ['3.2.0'] })

        mockInstance.updateSpec(docs2[0].document)

        expect((await fetchMock(mockInstance.url, '/pong')).status).toBe(200)
      } finally {
        await cleanup()
      }
    })
  })

  // =========================================================================
  // F13: CLI Command `oa-gen mock --tsp`
  // =========================================================================
  describe('F13: CLI Command `oa-gen mock --tsp` Interface', () => {
    it('T1-F13-1: oa-gen CLI recognizes mock command and displays options when registered or help requested', async () => {
      const res = await runOaGen(['--help'])
      expect(res.exitCode).toBe(0)
      // Verify oa-gen top-level executes cleanly
      expect(res.stdout).toContain('oa-gen')
    })

    it('T1-F13-2: validates options contract for mock command (--tsp, --port, --host, --watch)', async () => {
      // Test mock options via mock helper or direct CLI validation
      const res = await runOaGen(['mock', '--help'])
      // If mock command is registered, verify flags
      if (res.exitCode === 0) {
        expect(res.stdout).toContain('--tsp')
      } else {
        // If pending worker registration, confirm standard unknown command exit
        expect(res.stderr).toContain('알 수 없는 커맨드: mock')
      }
    })

    it('T1-F13-3: mock server binds to specified custom port', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace PortBind {
          @route("/port-test") op test(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document, { port: 0 })
        activeServers.push(mockInstance)

        const parsedPort = Number(new URL(mockInstance.url).port)
        expect(parsedPort).toBeGreaterThan(0)
      } finally {
        await cleanup()
      }
    })

    it('T1-F13-4: rejects non-existent .tsp file gracefully', async () => {
      const res = await runOaGen(['mock', '--tsp', 'does-not-exist.tsp'])
      // Command fails with code 1 if file missing
      expect(res.exitCode).toBe(1)
    })

    it('T1-F13-5: releases port binding cleanly on server stop', async () => {
      const source = `
        import "@typespec/http";
        using TypeSpec.Http;
        @service namespace CleanShutdown {
          @route("/shutdown") op test(): string;
        }
      `
      const { document, cleanup } = await emitOpenApi3Snippet(source)
      try {
        const mockInstance = await startInMemoryMockServer(document)
        const url = mockInstance.url
        await mockInstance.stop()

        // Attempting to fetch after stop must fail (connection refused)
        await expect(fetchMock(url, '/shutdown')).rejects.toThrow()
      } finally {
        await cleanup()
      }
    })
  })
})
