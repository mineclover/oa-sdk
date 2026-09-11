# Survey & Architectural Handoff Report: Zod 4 Codegen Engine & Mock Server HTTP Throughput

**Component Scope**: Component 3 (Zod 4 / Codegen Engine) & Component 4 (Mock Server HTTP Throughput & Routing Latency)  
**Author**: Survey Explorer 2 (`teamwork_preview_explorer`)  
**Workspace Root**: `/Users/junwoobang/workflow/oa-sdk`  
**Target File**: `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md`  
**Date**: 2026-09-11  

---

## 1. Observation

### 1.1 Component 3: Zod 4 / Codegen Engine Architecture

#### Exact File Locations & Export Signatures
- **Entry point**: `packages/codegen/src/zodgen/index.ts` re-exports the public API:
  - `generateZodFromSpec(doc: OasDocument, options?: GenerateZodOptions): string` (defined in `packages/codegen/src/zodgen/generate-zod.ts:91`)
  - `createZod4Algebra(options?: Zod4AlgebraOptions): SchemaAlgebra<string>` (defined in `packages/codegen/src/zodgen/schema-to-zod.ts:41`)
  - `prepareSchemaForZod(schema: OasSchema, defaultValues: WeakMap<OasSchema, unknown>): OasSchema` (defined in `packages/codegen/src/zodgen/schema-to-zod.ts:385`)
  - `schemaToZod(schema: OasSchema, options?: Zod4AlgebraOptions): string` (defined in `packages/codegen/src/zodgen/schema-to-zod.ts:475`)
  - `findCircularSchemas(schemas: Record<string, OasSchema>): Set<string>` (defined in `packages/codegen/src/zodgen/generate-zod.ts:32`)
  - `createRuntimeZodValidators(doc: OasDocument): Record<string, z.ZodTypeAny>` (defined in `packages/codegen/src/zodgen/runtime-adapter.ts:18`)
  - `createDynamicZodValidator(schema: OasSchema, doc?: OasDocument): z.ZodTypeAny` (defined in `packages/codegen/src/zodgen/runtime-adapter.ts:47`)
- **Schema Traversal Engine**:
  - `foldSchema<T>(node: unknown, algebra: SchemaAlgebra<T>): T` (defined in `packages/parser/src/fold.ts:63`)
  - `SchemaAlgebra<T>` (defined in `packages/parser/src/fold.ts:15`)
  - `SchemaFolder` (defined in `packages/parser/src/folder.ts:17`)
- **TypeScript Code Formatter**:
  - `formatGeneratedTs(code: string, indent?: string): string` (defined in `packages/core/src/format.ts:8`)

#### OpenAPI 3.2 Specs in the Monorepo
The authoritative OpenAPI 3.2 specifications available for benchmarking and reference are:
1. `packages/schemas/typespec/approved.openapi.yaml`: 2,599 lines, 80.7 KB. Fully approved OAS 3.2 specification containing 49 component schemas (`UserProfile`, `UserRole`, `StimulusIngressRequest`, `WorldModelEvent`, etc.), complete endpoint definitions, discriminators, and error schemas.
2. `packages/schemas/src/openapi.yaml`: 18 lines (stub/seed for domain assembly).
3. `packages/codegen/test/fixtures/zodgen/circular-components.yaml`: 55 lines. Models self-referencing tree nodes (`Node` with `parent` and `children: Node[]`) and mutual cycles (`User` $\leftrightarrow$ `Role`).
4. `packages/codegen/test/fixtures/zodgen/filesystem-tree.yaml`: 83 lines. Polymorphic recursive file system tree utilizing OAS 3.2 discriminator (`nodeType`, `mapping`, `defaultMapping`) with circular child references (`FSNode` $\leftrightarrow$ `DirectoryNode`).
5. `packages/codegen/test/fixtures/zodgen/ecommerce-lifecycle.yaml`: Complex nested schemas.
6. `packages/codegen/test/fixtures/zodgen/boundary-cases.yaml`: Numeric bounds, exclusive minimums, tuples (`prefixItems`).

#### Circular Reference Detection & Traversal Mechanism
In `packages/codegen/src/zodgen/generate-zod.ts:32-81`:
```typescript
export function findCircularSchemas(schemas: Record<string, OasSchema>): Set<string> {
  const graph = new Map<string, Set<string>>()
  // 1. Recursive extraction of #/components/schemas/* references into adjacency list
  function extractRefs(node: unknown, refs: Set<string>): void { ... }
  for (const [name, s] of Object.entries(schemas)) {
    const refs = new Set<string>()
    extractRefs(s, refs)
    graph.set(name, refs)
  }
  // 2. DFS cycle detection running from every schema key
  const circular = new Set<string>()
  for (const startNode of Object.keys(schemas)) {
    const visited = new Set<string>()
    let hasCycle = false
    function dfs(current: string, isFirst: boolean): void {
      if (!isFirst && current === startNode) { hasCycle = true; return }
      if (!isFirst && visited.has(current)) return
      if (!isFirst) visited.add(current)
      const neighbors = graph.get(current)
      if (!neighbors) return
      for (const next of neighbors) {
        if (!hasCycle) dfs(next, false)
      }
    }
    dfs(startNode, true)
    if (hasCycle) circular.add(startNode)
  }
  return circular
}
```

In `generateZodFromSpec` (`packages/codegen/src/zodgen/generate-zod.ts:105-148`):
1. **Lazy Reference Resolution**: Every component schema reference `#/components/schemas/<Name>` is systematically registered in `refNameOverrides` as `z.lazy(() => <Name>Schema)`:
   ```typescript
   refNameOverrides[`#/components/schemas/${name}`] = `z.lazy(() => ${schemaConstName})`
   ```
2. **Selective Type Annotation**: Circular schemas detected by `findCircularSchemas` receive an explicit `: z.ZodTypeAny` type annotation:
   ```typescript
   const typeAnnotation = circularSchemas.has(name) ? ': z.ZodTypeAny' : ''
   lines.push(`export const ${schemaConstName}${typeAnnotation} = ${zodExpr}`)
   ```
   This circumvents TypeScript `TS7022` ("implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer") while preserving full static inference (`z.infer<typeof Schema>`) for all non-cyclic schemas.

---

### 1.2 Component 4: Mock Server HTTP Throughput & Routing Architecture

#### Exact File Locations & Export Signatures
- **Node HTTP Adapter**: `packages/mock-server/src/adapters/node-http.ts`:
  - `createNodeMockServer(spec: OasDocument | Record<string, unknown>, options?: NodeMockServerOptions): NodeMockServer`
  - `NodeMockServer` interface:
    ```typescript
    export type NodeMockServer = {
      start(): Promise<void>
      stop(): Promise<void>
      readonly url: string
      override(operationId: string, response: OverrideResponse): void
      clearOverride(operationId: string): void
      clearOverrides(): void
      updateSpec(spec: OasDocument | Record<string, unknown>): { routesCount: number }
    }
    ```
- **Core Request Handler**: `packages/mock-server/src/core/handler.ts:25`:
  - `handleRequest(parts: RequestParts, entry: OperationEntry, securitySchemes: Record<string, OasSecurityScheme>): HandlerResult`
- **Response Synthesis & Validation**:
  - `pickResponse(responses: Record<string, OasResponse>): PickedResponse | null` (`packages/mock-server/src/core/response-picker.ts:36`)
  - `validatePickedResponse(picked: PickedResponse): MockValidationResult` (`packages/mock-server/src/core/response-picker.ts:77`)
  - `generateAlgebra: SchemaAlgebra<unknown>` (`packages/mock-server/src/core/generate.ts:37`)
  - `runSchemaValidation(...)` (`packages/mock-server/src/core/request-validation/schema-compiler.ts:23`)
- **Route Matching & Specificity Engine**:
  - `matchRoute(index: RouteIndex, method: HttpMethod, urlPath: string): MatchResult` (`packages/parser/src/route-match.ts:62`)
  - `compareRouteSpecificity(left: CompiledRoute, right: CompiledRoute): number` (`packages/parser/src/route-match.ts:100`)
  - `getOrCompileRoute(index: RouteIndex, pattern: string): CompiledRoute` (`packages/parser/src/route-match.ts:23`)
- **Downstream Router Generator**:
  - `generateRouter(spec: OasDocument | ParsedDocument, options?: RouterOptions): string` (`packages/router/src/generate-router.ts:18`)

#### HTTP Server Concurrency & Architecture
- `NodeMockServer` directly wraps Node.js standard library `node:http` via `createServer((req, res) => { handler(req, res)... })`. No Express or Fastify overhead exists.
- Concurrency is managed natively by the asynchronous Node.js libuv event loop. Multiple requests in-flight share the event loop while I/O and socket writes execute asynchronously.
- Keep-Alive connections are supported out-of-the-box.
- `server.stop()` calls `httpServer.closeAllConnections()` followed by `httpServer.close()`, cleanly releasing open sockets.

#### Route Registration & Specificity Resolution
1. **Compilation**: `compileRoutingState(currentSpec)` invokes `parseDocument` to construct `parsed.routes: RouteIndex` (`Map<string, Map<HttpMethod, OperationEntry>>`).
2. **Lookup Pattern**: On each request, `matchRoute(currentState.index, method, urlPath)` performs a **full linear iteration** over all routes in the `RouteIndex`:
   ```typescript
   for (const [openApiPath, methodMap] of index) {
     const params = matchPath(index, openApiPath, urlPath)
     if (params === null) continue
     const candidate: MatchedRoute = {
       methodMap,
       params,
       compiled: getOrCompileRoute(index, openApiPath),
     }
     if (!best || compareRouteSpecificity(candidate.compiled, best.compiled) > 0) best = candidate
   }
   ```
3. **Regex Compilation & Cache**: Patterns are compiled into `RegExp` with captured parameter names and cached lazily in `WeakMap<RouteIndex, Map<string, CompiledRoute>>`.
4. **Specificity Tiers (`compareRouteSpecificity`)**:
   - Tier 1: Segment comparison left-to-right (`literal = 1`, `template = 0`). The first difference where `left[i] - right[i] > 0` wins.
   - Tier 2: Fewer template parameters wins (`right.templateCount - left.templateCount`).
   - Tier 3: Longer literal character count wins (`left.literalCharacterCount - right.literalCharacterCount`).

#### Atomic Route Updating (`updateSpec`)
In `packages/mock-server/src/adapters/node-http.ts:242-250`:
```typescript
updateSpec(nextSpec: OasDocument | Record<string, unknown>): { routesCount: number } {
  const nextState = compileRoutingState(nextSpec, '@oa-sdk/mock-server updateSpec')
  state = nextState
  let routesCount = 0
  for (const methodMap of state.index.values()) {
    routesCount += methodMap.size
  }
  return { routesCount }
}
```
- In Node.js single-threaded execution, reference assignment `state = nextState` is atomic.
- Ongoing requests have already captured `const currentState = state` at the entry point of `handler(req, res)` (line 106).
- New requests immediately execute against `nextState`.
- The listening TCP socket (`httpServer.listen`) is never closed or rebound, ensuring zero connection drops during hot reload.

---

### 1.3 Empirical Test & V8 Profiling Observations

During prototype execution on this machine (macOS arm64, Node v24.20.0):

#### Codegen Scaling & Hotspots
| Workload | Model Count | Total Lines | `findCircularSchemas` Time | Total `generateZodFromSpec` Time | Ratio (Cycle Detection) |
|---|---|---|---|---|---|
| `approved.openapi.yaml` | 49 | 348 | ~1.2 ms | 15.84 ms | ~7.6% |
| Synthetic Circular Swarm | 200 | 2,000 | 13.42 ms | 36.56 ms | 36.7% |
| Synthetic Circular Swarm | 500 | 5,000 | 56.91 ms | 111.11 ms | 51.2% |

- **V8 CPU Profiler Call Frames for `generateZodFromSpec`** (`node:inspector`):
  1. `countStructuralDelimiters` & `formatGeneratedTs` (`format.ts`): Highest tick count during string splitting and delimiter matching.
  2. `findCircularSchemas` / nested `dfs`: High recursion and `new Set()` allocation count.
  3. `(garbage collector)`: Frequent minor GC sweeps triggered by intermediate object allocations.
  4. `visit` / `decodeJsonPointerFragment` (`@oa-sdk/core`).

#### Mock Server HTTP Concurrency & Throughput
| Concurrency ($C$) | Route Type | Total Requests | Measured QPS | p50 Latency | p95 Latency | p99 Latency | Error Rate |
|---|---|---|---|---|---|---|---|
| 10 | `/users/me` (Literal) | 2,000 | **3,108 QPS** | 2.54 ms | 7.38 ms | 19.74 ms | **0.00%** |
| 50 | `/users/me` (Literal) | 2,000 | **2,289 QPS** | 17.22 ms | 39.15 ms | 117.79 ms | **0.00%** |
| 100 | `/users/me` (Literal) | 2,000 | **3,207 QPS** | 21.74 ms | 59.49 ms | 316.48 ms | **0.00%** |
| 50 | `/users/12345` (Param) | 2,000 | **3,876 QPS** | 10.90 ms | 27.60 ms | 32.31 ms | **0.00%** |

#### Concurrent `updateSpec` Stress Under Load
- Tested with 3,000 requests at $C = 50$ with `server.updateSpec` triggered every 50 ms.
- **Results**:
  - Total requests: 3,000
  - Errors: **0 (0.00%)**
  - QPS: 1,567
  - p50: 14.32 ms
  - p95: 142.77 ms (tail latency spike due to synchronous `compileRoutingState` on event loop)
  - p99: 392.41 ms

#### Route Match Scaling
| Registered Routes in Spec | `matchRoute` Time per Op | Lookup Throughput |
|---|---|---|
| 10 routes | 5.91 µs/op | 169,252 ops/sec |
| 50 routes | 9.14 µs/op | 109,429 ops/sec |
| 100 routes | 26.03 µs/op | 38,411 ops/sec |
| 250 routes | 40.15 µs/op | 24,905 ops/sec |

- `matchRoute` scales linearly $O(N)$ with the total number of routes in the spec.
- In V8 profiling under HTTP load, `matchPath` and `matchRoute` appear as top JavaScript CPU consumers directly beneath Node native socket writes (`writeLatin1String`, `writev`).

---

## 2. Logic Chain

1. **Codegen Scalability Logic**:
   - *Observation*: `findCircularSchemas` executes a DFS starting from each model $v \in V$, allocating `new Set<string>()` on every start node and scanning the graph.
   - *Deduction*: The time complexity is $O(V \cdot (V + E))$. For $V = 49$, it is negligible (1.2 ms). For $V = 500$, it increases to 56.91 ms and accounts for $>51\%$ of the entire codegen execution time.
   - *Impact*: In large-scale benchmarks (100+ to 500+ models), cycle detection and `formatGeneratedTs` dominate over the core `foldSchema` AST traversal.
   - *Mitigation/Optimization Target*: Cycle detection can be restructured using a single-pass 3-color DFS (WHITE, GRAY, BLACK) or Tarjan's Strongly Connected Components (SCC) in $O(V + E)$ time with reusable bitsets or Uint8Arrays.

2. **Mock Server Event Loop & Concurrency Logic**:
   - *Observation*: `NodeMockServer` uses Node's native `http.createServer`. It registers handlers asynchronously without blocking worker threads.
   - *Observation*: Under concurrent requests up to $C = 100$, error rate remained strictly 0.00% ($< 0.1\%$ acceptance threshold).
   - *Observation*: `updateSpec` synchronously executes `compileRoutingState` (which runs `parseDocument`, `filterRouteIndex`, `assertValidRequestSchemas`, and Ajv schema compilation).
   - *Deduction*: Because JavaScript execution in Node is cooperative single-threaded, `updateSpec` blocks the event loop for the duration of compilation (~5-20 ms depending on spec size). While socket connections remain open and zero requests fail, any request arriving during this interval experiences queued latency, explaining the jump in p95 latency from 39 ms to 142 ms.

3. **Route Matching Bottleneck Logic**:
   - *Observation*: `matchRoute` loops over all entries in `index: RouteIndex` and calls `actual.match(regex)`.
   - *Deduction*: Route lookup does not use a Radix tree, prefix trie, or URL pathname bucket map. As route count increases from 10 to 250, lookup duration jumps from 5.91 µs to 40.15 µs ($6.8\times$ slower).
   - *Impact*: For large OpenAPI specs (e.g. 200+ operations), route matching will consume up to 40% of the available main thread budget at high QPS. This should be explicitly flagged in the profiling report as a primary optimization candidate.

4. **Response Synthesis vs Static Override Logic**:
   - *Observation*: In `handleRequest`, an operation with no override triggers `pickResponse` $\to$ `foldSchema(schema, generateAlgebra)` $\to$ `validatePickedResponse` $\to$ `runSchemaValidation(body, schema)` with Ajv.
   - *Deduction*: When an override is present (`overrides.get(operationId)`), `node-http.ts` bypasses all request validation, schema synthesis, and response validation, writing the payload immediately. Comparing these two paths quantifies the exact runtime overhead of schema synthesis and Ajv validation.

---

## 3. Caveats

1. **Network Hardware vs Local Loopback**:
   The HTTP throughput measurements above were conducted over local loopback (`127.0.0.1`). In real-world distributed networks, latency will include network interface card (NIC) latency, TCP handshakes, and packet transit times. However, loopback testing is the authoritative method for isolating Node.js process CPU, event loop, and memory bottlenecks.
2. **Client-Side Bottlenecking**:
   When using Node's `fetch()` to generate benchmark load at high concurrency ($C \ge 100$), the client process itself can saturate CPU due to `fetch` Promise allocations and undici connection handling. To measure server throughput accurately without client skew, a dedicated `node:http.Agent` with `keepAlive: true` and pre-allocated socket pools must be used.
3. **Pre-warmed JIT State**:
   V8 optimizes functions after thousands of iterations (TurboFan Tier 2). First-request latency includes V8 deoptimization/optimization ticks, Ajv schema compilation, and regex compilation. Benchmarks must report both cold-start metrics and warm steady-state metrics.

---

## 4. Conclusion & Actionable Recommendations

### 4.1 Concrete Benchmark Scenario Designs

#### Component 3: Zod 4 Codegen Engine
We recommend 4 distinct workload tiers:
1. **Workload C1: Enterprise Baseline (`approved.openapi.yaml`)**:
   - 49 schemas, 2,599 lines.
   - Tests mixed schema constructs, discriminators, security schemes, and real-world domain structures.
2. **Workload C2: Deep Hierarchy (`DeepNesting`)**:
   - Deeply nested object hierarchies at depths $D \in \{10, 25, 50\}$.
   - Measures recursion stack depth and nested object expression generation.
3. **Workload C3: Circular Graph Matrix (`CycleMatrix`)**:
   - Mutual cycle clusters with model counts $N \in \{10, 50, 100, 200\}$.
   - Models mutual circular references ($M_1 \to M_2 \to \dots \to M_N \to M_1$) and self-referencing tree nodes.
   - Directly benchmarks `findCircularSchemas` scaling and `z.lazy` emission.
4. **Workload C4: Wide Model Swarm (`WideSwarm`)**:
   - 100, 250, and 500 distinct schema models.
   - Measures overall codegen throughput (models/sec, lines/sec, execution ms, and memory delta).

#### Component 4: Mock Server HTTP Throughput & Routing
We recommend 4 distinct benchmark scenarios:
1. **Scenario M1: Concurrency Saturation**:
   - Concurrency levels: $C \in \{10, 50, 100\}$ using HTTP Keep-Alive.
   - Sustained load: 5,000 requests per tier.
   - Measures: QPS, p50, p95, p99 latency distributions, memory heap delta, and verifies error rate $< 0.1\%$.
2. **Scenario M2: Route Specificity & Lookup Scaling**:
   - Varying route counts: $N \in \{10, 50, 100, 250\}$ routes.
   - Target route classes:
     - Exact literal (`/api/v1/users/me/profile`)
     - Parameterized (`/api/v1/users/{userId}/profile`)
     - Deep templated (`/api/v1/{orgId}/teams/{teamId}/members/{memberId}`)
     - Ambiguous catch-all (`/{entity}/{id}/{action}`)
   - Measures `matchRoute` execution duration and compares specific route vs parameterized route resolution overhead.
3. **Scenario M3: Atomic Hot-Swap (`updateSpec`) Under Concurrent Traffic**:
   - Sustained 50-concurrency load (3,000+ requests).
   - Trigger `server.updateSpec(newSpec)` every 100 ms during active traffic.
   - Verifies zero dropped connections, zero socket errors, and captures tail latency jitter (p95/p99 spikes).
4. **Scenario M4: Synthesis vs Override Differential**:
   - Measures throughput difference between schema-generated responses (`foldSchema` + Ajv response validation) vs static `server.override()`.

---

### 4.2 Recommended Tooling & Profiling Strategy

1. **Load Generation Engine**:
   - **Recommendation**: Native Node.js `node:http.request` with persistent `http.Agent({ keepAlive: true, maxSockets: concurrency })` arranged in a promise-based worker pool (as proven in our empirical prototype).
   - **Rationale**: Completely self-contained within the monorepo, zero external dependencies required, eliminates client-side `fetch` allocation overhead, and provides sub-millisecond precision latency measurements via `performance.now()`.
2. **Micro-Benchmarking Framework**:
   - **Recommendation**: Native micro-benchmark runner following the exact patterns established in `packages/codegen/scripts/bench-validation-engines.ts` (warmup phase, batch execution, typed `Float64Array` sample sorting for p50/p95/p99).
3. **V8 CPU Profiling & Hotspot Extraction**:
   - **Recommendation**: Programmatic profiling via Node.js `node:inspector` Session (`Profiler.enable`, `Profiler.start`, `Profiler.stop`).
   - **Outputs**:
     - Emits `.cpuprofile` files compatible with Chrome DevTools and VS Code Profiler.
     - Automatically aggregates samples by function ID to output top CPU hotspots, tick counts, and file/line locations.

---

### 4.3 Primary V8 Profiling Targets Summary

| Pipeline / Component | Function Name | File Location | Root Cause / Bottleneck Mechanism |
|---|---|---|---|
| **Codegen** | `findCircularSchemas` | `packages/codegen/src/zodgen/generate-zod.ts:32` | $O(V \cdot (V + E))$ DFS traversal with per-node `new Set()` allocation; dominates codegen at $\ge 200$ models. |
| **Codegen** | `formatGeneratedTs` | `packages/core/src/format.ts:8` | Line-by-line delimiter scanning, string splitting, and regex replacements (`replace(/\(\s*\{/g, '{')`). |
| **Codegen** | `prepareSchemaForZod` | `packages/codegen/src/zodgen/schema-to-zod.ts:385` | Deep cloning (`{ ...rest }`) and object mutation across all schema nodes prior to folding. |
| **Mock Server** | `matchRoute` / `matchPath` | `packages/parser/src/route-match.ts:62` | Linear $O(N)$ regex scanning across all routes in `RouteIndex` on every incoming HTTP request. |
| **Mock Server** | `compareRouteSpecificity` | `packages/parser/src/route-match.ts:100` | Multi-tier segment kind loop executed for every candidate route match. |
| **Mock Server** | `updateSpec` | `packages/mock-server/src/adapters/node-http.ts:242` | Synchronous execution of `parseDocument`, `filterRouteIndex`, and schema pre-compilation on the main event loop thread. |
| **Mock Server** | `validatePickedResponse` | `packages/mock-server/src/core/response-picker.ts:77` | Runs full Ajv validation on every generated mock response before sending. |

---

## 5. Verification Method

### Independent Reproduction Commands

1. **Verify Codegen on Real-World OAS 3.2 Spec**:
   ```bash
   node --import tsx -e "
   import fs from 'node:fs';
   import { parse } from 'yaml';
   import { performance } from 'node:perf_hooks';
   import { generateZodFromSpec } from './packages/codegen/src/zodgen/index.ts';

   const doc = parse(fs.readFileSync('./packages/schemas/typespec/approved.openapi.yaml', 'utf8'));
   const t0 = performance.now();
   const code = generateZodFromSpec(doc);
   const t1 = performance.now();
   console.log('Schemas:', Object.keys(doc.components.schemas).length, 'Time:', (t1 - t0).toFixed(2), 'ms', 'Lines:', code.split('\n').length);
   "
   ```

2. **Verify Mock Server Concurrency & Error Rate (< 0.1%)**:
   ```bash
   node --import tsx -e "
   import http from 'node:http';
   import { performance } from 'node:perf_hooks';
   import { createNodeMockServer } from './packages/mock-server/src/adapters/node-http.ts';

   const spec = {
     openapi: '3.2.0',
     info: { title: 'Test', version: '1.0.0' },
     paths: { '/test': { get: { operationId: 't', responses: { '200': { description: 'ok' } } } } }
   };
   const server = createNodeMockServer(spec, { port: 0 });
   await server.start();
   const url = new URL(server.url);
   const agent = new http.Agent({ keepAlive: true, maxSockets: 50 });
   let errors = 0;
   const requests = Array.from({ length: 1000 }, () => new Promise(res => {
     http.request({ host: url.hostname, port: Number(url.port), path: '/test', method: 'GET', agent }, r => {
       r.on('data', () => {});
       r.on('end', () => { if (r.statusCode !== 200) errors++; res(); });
     }).on('error', () => { errors++; res(); }).end();
   }));
   await Promise.all(requests);
   await server.stop();
   agent.destroy();
   console.log('Errors:', errors, 'Error rate:', (errors / 1000 * 100).toFixed(2) + '%');
   "
   ```

3. **Verify Route Matching Specificity Benchmark**:
   ```bash
   node --import tsx -e "
   import { parseDocument, matchRoute } from './packages/parser/src/index.ts';
   const doc = {
     openapi: '3.2.0',
     info: { title: 'T', version: '1.0.0' },
     paths: {
       '/users/me': { get: { operationId: 'me', responses: { '200': { description: 'ok' } } } },
       '/users/{id}': { get: { operationId: 'byId', responses: { '200': { description: 'ok' } } } }
     }
   };
   const parsed = parseDocument(doc);
   const match = matchRoute(parsed.routes, 'get', '/users/me');
   console.log('Matched operationId (expected \"me\"):', match.entry?.operationId);
   "
   ```

### Invalidation Conditions
- If `findCircularSchemas` does not identify mutually recursive schema pairs (e.g. `User` $\leftrightarrow$ `Role`).
- If `generateZodFromSpec` fails to emit `: z.ZodTypeAny` on recursive schemas, causing TypeScript `TS7022` compiler failure.
- If `updateSpec` terminates existing TCP connections or throws uncaught socket exceptions during in-flight traffic.
- If `matchRoute` resolves a parameterized route `/users/{id}` ahead of an exact literal route `/users/me`.
