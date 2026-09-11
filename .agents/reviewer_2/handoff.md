# Handoff Report — Reviewer 2: Mock Server HTTP Response Serialization & Static Header Preallocation (Milestone M2)

**Agent Identity**: `reviewer_2`  
**Working Directory**: `/Users/junwoobang/workflow/oa-sdk/.agents/reviewer_2`  
**Role**: Reviewer & Adversarial Critic  
**Review Target**: `packages/mock-server/src/adapters/node-http.ts`  
**Parent Agent**: `parent` (`6e9162db-e15b-42e5-9757-50c9b9433e62`)  
**Timestamp**: 2026-09-11T06:08:00Z  
**Verdict**: **APPROVE**  
**Type**: Hard Handoff (Task Complete)  

---

## 1. Observation

### 1.1 Source Code Verification in `packages/mock-server/src/adapters/node-http.ts`

Direct inspection of `packages/mock-server/src/adapters/node-http.ts` confirmed the following implementations:

1. **Precomputed Static Response Payloads & Headers (`compileRoutingState` & `ServerRoutingState.precomputed`)**:
   - Lines 59–65: `PrecomputedResponse` structure declared:
     ```typescript
     type PrecomputedResponse = {
       status: number
       contentType: string
       payload: string
       headers: Record<string, string | number>
       originalBody: unknown
     }
     ```
   - Lines 126–152: `precomputed` Map populated during routing state compilation:
     ```typescript
     const precomputed = new Map<OperationEntry, PrecomputedResponse>()
     for (const [, methodMap] of nextIndex) {
       for (const [, entry] of methodMap) {
         if (entry.responses) {
           const picked = pickResponse(entry.responses)
           if (picked && !isStreamingContentType(picked.contentType)) {
             const payload = serializeResponseBody(picked.contentType, picked.body, picked.schema)
             const contentLength = Buffer.byteLength(payload)
             const headers: Record<string, string | number> = {
               ...picked.headers,
               'Content-Type': picked.contentType,
               'Content-Length': contentLength,
             }
             precomputed.set(entry, {
               status: picked.status,
               contentType: picked.contentType,
               payload,
               headers,
               originalBody: picked.body,
             })
           }
         }
       }
     }
     ```
   - Lines 306–312: Fast-path execution in `handler`:
     ```typescript
     const precalc = currentState.precomputed.get(entry)
     if (precalc && picked.status === precalc.status && picked.body === precalc.originalBody) {
       res.writeHead(precalc.status, precalc.headers)
       res.end(precalc.payload)
       return
     }
     ```
     Identity guard `picked.status === precalc.status && picked.body === precalc.originalBody` ensures that any dynamic or schema-deviating response safely falls back to standard `writeBody`.

2. **Fast-Path Bodiless Request Bypass (`readBody`)**:
   - Lines 416–424:
     ```typescript
     const te = req.headers['transfer-encoding']
     const cl = req.headers['content-length']

     // Fast-path: bodiless requests (GET, HEAD, DELETE without body payload)
     if (te === undefined && (cl === undefined || cl === '0')) {
       req.resume()
       return { body: undefined }
     }
     ```
     Per RFC 9110 §8.6 and RFC 9112 §6.3, when neither `transfer-encoding` nor non-zero `content-length` is present, the message body is strictly empty. Invoking `req.resume()` drains stray stream events, and returning `{ body: undefined }` synchronously avoids Promise instantiation and `'data'`/`'end'`/`'error'` listener churn.

3. **Fast-Path URL & Query Parsing**:
   - Lines 181–215:
     ```typescript
     if (rawUrl.charCodeAt(0) === 47 /* '/' */) {
       const qIndex = rawUrl.indexOf('?')
       if (qIndex === -1) {
         const hIndex = rawUrl.indexOf('#')
         urlPath = stripBasePath(hIndex === -1 ? rawUrl : rawUrl.slice(0, hIndex), currentState.basePath)
       } else {
         urlPath = stripBasePath(rawUrl.slice(0, qIndex), currentState.basePath)
         const hIndex = rawUrl.indexOf('#', qIndex + 1)
         rawQueryString = rawUrl.slice(qIndex + 1, hIndex === -1 ? undefined : hIndex)
         const params = new URLSearchParams(rawQueryString)
         for (const [k, v] of params.entries()) {
           const existing = queryParams[k]
           if (existing !== undefined) {
             queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
           } else {
             queryParams[k] = v
           }
         }
       }
       requestUrl = `${requestOrigin}${rawUrl}`
     } else {
       // Fallback for full absolute URLs (e.g. forward proxy requests)
       const parsedUrl = new URL(rawUrl, requestOrigin)
       urlPath = stripBasePath(parsedUrl.pathname, currentState.basePath)
       rawQueryString = extractRawQueryString(rawUrl)
       for (const [k, v] of parsedUrl.searchParams.entries()) {
         const existing = queryParams[k]
         if (existing !== undefined) {
           queryParams[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
         } else {
           queryParams[k] = v
         }
       }
       requestUrl = parsedUrl.toString()
     }
     ```
     Avoids WHATWG Ada/C++ parser instantiation for standard relative paths while providing a safe fallback for full absolute URLs (forward proxy requests).

4. **Fast Header Extraction**:
   - Lines 258–265:
     ```typescript
     const reqHeaders = req.headers
     const headers: Record<string, string> = {}
     for (const k in reqHeaders) {
       const v = reqHeaders[k]
       if (typeof v === 'string') headers[k] = v
       else if (Array.isArray(v)) headers[k] = v[0] ?? ''
     }
     ```
     Replaced `Object.entries(req.headers)` with a fast `for..in` loop, eliminating array-of-tuples heap allocation per request.

5. **Streaming, Overrides & Error Handling Preservation**:
   - Streaming media types (`isStreamingContentType`, lines 292–304): Checked and streamed dynamically via `generateStreamChunks`, completely bypassing static precalc.
   - Dynamic overrides (`server.override`, lines 240–256): Evaluated at the top of the route handler; overrides execute immediately.
   - Validation & schema error handling (lines 285–287): `hr.type === 'validation-error'` (422) and `hr.type === 'schema-error'` (500) remain strictly preserved with redaction.
   - 500 Internal error preallocation: Lines 77–83 (`INTERNAL_ERROR_PAYLOAD`, `INTERNAL_ERROR_HEADERS`).
   - 405 Method Not Allowed header caching: Lines 227–231 (`currentState.allowedHeadersCache`).

### 1.2 Verbatim Verification Command Execution Outputs

The reviewer independently executed all verification commands required by the dispatch:

1. **Mock Server Test Suite**:
   ```bash
   corepack pnpm --filter @oa-sdk/mock-server test
   ```
   *Output*:
   ```
    Test Files  38 passed (38)
         Tests  656 passed (656)
      Duration  6.68s
   ```

2. **Downstream Test Suite**:
   ```bash
   corepack pnpm test:downstream
   ```
   *Output*:
   ```
   @oa-sdk/router: 2 test files, 47 passed (47)
   @oa-sdk/client: 3 test files, 73 passed (73)
   @oa-sdk/mock-server: 38 test files, 656 passed (656)
   Tasks: 6 successful, 6 total
   Time: 1.416s >>> FULL TURBO
   ```

3. **Parity Edge-Case Test**:
   ```bash
   node --expose-gc --import tsx .agents/explorer_m2_1/test-parity.ts
   ```
   *Output*:
   ```
   --- Running Optimized Node Mock Server Self-Test ---
   Running parity tests against edge cases...
   Optimized server listening at: http://127.0.0.1:61451
   /health check: 200 { status: 'ok', timestamp: '2026-04-04T00:00:00.000Z' }
   deepObject valid: 204
   deepObject invalid (422): 422
   override status: 200 { overridden: true } yes
   404: 404
   405: 405 Allow: GET
   updateSpec routesCount: 2
   /new-route status: 200 hello
   All parity tests passed!
   Optimized C=10: 5283.0 QPS (378.6ms, errors: 0)
   Optimized C=50: 5814.6 QPS (344.0ms, errors: 0)
   Optimized C=100: 9299.4 QPS (215.1ms, errors: 0)
   Self-test PASSED with 0 errors and 0 FD leaks!
   ```

4. **Monorepo Benchmark Suite**:
   ```bash
   node --expose-gc --import tsx scripts/bench/bench-zod-mock.ts
   ```
   *Output*:
   ```
   - Concurrency Tiers:
     * C=10:  2,341 QPS (mean 4.237ms, p50 3.309ms), errors: 0 (0.00% error rate)
     * C=50:  4,107 QPS (mean 12.093ms, p50 9.562ms), errors: 0 (0.00% error rate)
     * C=100: 4,618 QPS (mean 21.437ms, p50 15.383ms, p95 26.108ms vs baseline 82.245ms [-68.3% latency]), errors: 0 (0.00% error rate)
   - Atomic updateSpec:
     * Completed requests: 2000, spec updates: 10, errors: 0 (0.00% error rate)
     * Assertion PASS: Zero dropped connections and zero HTTP errors during active spec swaps.
   - Resource Invariants:
     * Heap Memory Delta (2,000 HTTP requests): 55.13 MB -> 55.00 MB (-0.14 MB net growth) [STABLE]
     * File Descriptors (20 Lifecycle Cycles): 14 FDs -> 14 FDs (0 leaked) [PASS (Zero Leak)]
   ```

5. **Governance Verification Gates**:
   - `pnpm check:docs`:
     ```
     Documentation OK: 234 Markdown files plus 24 OAS reference files; local links, oa-gen examples, agent governance, and command/package entrypoint coverage checked.
     ```
   - `pnpm check:cli-spec`:
     ```
     CLI spec OK: 2 manifests, 27 command entities.
     ```
   - `pnpm check:api-index`:
     ```
     API index is in sync with code exports.
     ```

### 1.3 Independent Adversarial Stress Test Results

The reviewer authored and ran comprehensive in-memory adversarial test suites directly against `createNodeMockServer` from `packages/mock-server/src/adapters/node-http.js`:

1. **Absolute Forward-Proxy URL Request Target**:
   - Request: `GET http://127.0.0.1:<port>/items/123?filter=active#section`
   - *Result*: Correctly routed via fallback branch to `new URL()`, returning 200 OK.
2. **Chunked Bodiless GET**:
   - Request: `GET /items/456` with `Transfer-Encoding: chunked` and payload `0\r\n\r\n`.
   - *Result*: Correctly bypassed bodiless fast-path into `readRaw()`, consumed chunks cleanly, returning 200 OK.
3. **Query Parameter Shape Validation**:
   - Passing `?filter=a&filter=b` to a scalar `type: 'string'` parameter triggers 422 Unprocessable Content (validation working as intended).
   - Passing `?filter=a&filter=b` to an array `type: 'array'` parameter parses into `['a', 'b']` and returns 200 OK.
4. **Bodiless HEAD Method**:
   - Request: `HEAD /ping`
   - *Result*: Returns 200 OK with `Content-Length: 4` and exact response headers, emitting 0 bytes of response body.
5. **Real-time SSE Streaming**:
   - Request: `GET /events`
   - *Result*: Returns `Content-Type: text/event-stream`, dynamically yielding chunks `data: {"msg":"hello"}\n\n`.
6. **Concurrent Keep-Alive HTTP Load with Live `updateSpec`**:
   - Executed 1,000 requests across 10 concurrent workers while actively triggering 5 consecutive `updateSpec` hot swaps.
   - *Result*: 1,000 completed requests, 0 HTTP errors, 0 dropped connections.

---

## 2. Logic Chain

1. **Integrity Verification**:
   - *Observation*: Code changes in `packages/mock-server/src/adapters/node-http.ts` were inspected for hardcoded test responses, dummy facade logic, task bypassing, and self-certifying mock outputs.
   - *Inference*: `precomputed` dynamically parses any valid OpenAPI specification at startup and `updateSpec` time, computing payloads via `serializeResponseBody` and `Buffer.byteLength`. No hardcoded strings or test bypasses exist. The implementation is genuine and free of integrity violations.
2. **Deterministic Response Acceleration**:
   - *Observation*: In mock environments, static example responses and schema folds are invariant for a given spec and operation entry.
   - *Inference*: Precomputing `payload` and static `headers` (`Content-Type`, `Content-Length`, declared spec headers) during `compileRoutingState` eliminates runtime stringification and buffer scanning on the hot path. The identity check `picked.status === precalc.status && picked.body === precalc.originalBody` guarantees complete semantic fidelity.
3. **RFC-Compliant Bodiless Bypass**:
   - *Observation*: RFC 9110 §8.6 and RFC 9112 §6.3 dictate that HTTP requests with no `Transfer-Encoding` and no `Content-Length` (or `Content-Length: 0`) have no body.
   - *Inference*: Returning `{ body: undefined }` synchronously and calling `req.resume()` avoids creating Promises and attaching event listeners to `IncomingMessage`, preventing event-loop tick delays and socket stalls under Keep-Alive reuse.
4. **URL Parser Allocation Elimination**:
   - *Observation*: In local mock servers, virtually all incoming HTTP request lines are relative paths starting with `/`.
   - *Inference*: String scanning via `indexOf('?')` and `indexOf('#')` with `new URLSearchParams` eliminates WHATWG C++ Ada parser allocations on the hot path while maintaining 100% semantic compatibility for parameter extraction and fallback support for forward-proxy URLs.
5. **Concurrency & Resource Stability**:
   - *Observation*: Benchmark and parity tests under C=10, C=50, and C=100 load demonstrate up to 9,299 QPS, 0.00% error rate, net-negative heap retention (-0.14 MB), and 0 file descriptor leaks across 20 start/stop/update cycles.
   - *Inference*: All socket writes remain within standard Node `http.ServerResponse` primitives (`writeHead` and `end`), ensuring clean socket descriptor state transitions and zero connection drops during active `updateSpec` swaps.

---

## 3. Caveats

- **Streaming Media Types**: Operations returning `text/event-stream` or `application/x-ndjson` are intentionally excluded from `precomputed` and continue to generate real-time asynchronous stream chunks.
- **Dynamic Overrides**: `server.override` retains highest precedence, executing before request body reading and validation.
- **Parameter Validation**: Scalar parameters receive strict validation; clients submitting duplicate query keys (e.g. `?filter=a&filter=b`) will receive HTTP 422 if the schema defines `type: 'string'`.

---

## 4. Conclusion

The code changes in `packages/mock-server/src/adapters/node-http.ts` fully satisfy all requirements specified in `ORIGINAL_REQUEST.md` (## 2026-09-11T05:20:05Z):
1. Precomputed static response payloads and headers in `ServerRoutingState.precomputed` operate cleanly with safe identity fallback.
2. Fast-path bodiless request bypass in `readBody` eliminates stream overhead for GET/HEAD requests.
3. Fast-path URL pathname and query parameter parsing eliminates WHATWG URL parser allocations while supporting forward proxy fallbacks.
4. `req.headers` extraction uses an allocation-free `for..in` loop.
5. Streaming responses, dynamic overrides, sensitive value redaction, and schema validation error handlers are completely preserved.
6. 0.00% error rate, 0 file descriptor leaks, and 68.3% p95 latency reduction verified under Keep-Alive load.
7. All 656 mock-server tests pass, downstream tests pass, and all governance gates (`check:docs`, `check:cli-spec`, `check:api-index`) pass with zero drift.

**Explicit Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce and verify this review:

```bash
# 1. Run mock-server test suite (656 tests)
corepack pnpm --filter @oa-sdk/mock-server test

# 2. Run downstream package test suite (router, client, mock-server)
corepack pnpm test:downstream

# 3. Run edge-case parity test suite
node --expose-gc --import tsx .agents/explorer_m2_1/test-parity.ts

# 4. Run official Milestone 3 benchmark suite
node --expose-gc --import tsx scripts/bench/bench-zod-mock.ts

# 5. Run monorepo documentation and governance checks
pnpm check:docs
pnpm check:cli-spec
pnpm check:api-index
```

### Invalidation Conditions
- Any test failure in the 656 unit/integration tests of `@oa-sdk/mock-server`.
- Any error rate $> 0.00\%$ under concurrent Keep-Alive HTTP load.
- Any open file descriptor leak (`assertZeroFdLeak` reporting leaked FDs $> 0$).
- Any documentation drift detected by `check:docs`, `check:cli-spec`, or `check:api-index`.
