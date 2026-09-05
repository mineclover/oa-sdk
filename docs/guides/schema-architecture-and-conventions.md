# 스키마 아키텍처 및 작성 규칙 (Zod SSOT)

> **Canonical Authority**: Browser Studio Core Architecture & Schema Governance  
> **Target Monorepo**: `@browser-studio/*`  
> **Schema Governance Engine**: `@oa-sdk/*` (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `@oa-sdk/mock-server`, `@oa-sdk/codegen`)  
> **Specification Version**: 1.1.0 (Approved Standard)  
> **Status**: Normative Standard  
> **Target Environments**: Chrome Extension (Manifest V3), Node.js Session Host, MCP Stdio Daemons, DevTools Panel, Headless CI  

---

## 1. Executive Summary & Architectural Scope

### 1.1 Mission & Core Tenet
The **Browser Studio Schema Architecture** establishes a strictly decoupled, deterministic, high-throughput schema pipeline that bridges TypeScript/Zod master schemas with `@oa-sdk/*` specification governance, zero-runtime-weight browser extensions (Manifest V3), and headless CI protocol mock testing.

The fundamental tenet of this architecture is:
> **Single Source of Truth (SSOT)**: Domain schemas are authored once in TypeScript using Zod within domain packages. All downstream artifacts—JSON Schema Draft 2020-12, OpenAPI 3.1 specifications, pre-compiled standalone AJV type guards, and protocol mock endpoints—are projected deterministically at **build time**.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: MASTER ZOD SCHEMAS (SSOT)                                                      │
│   • packages/devlink-contracts (Native RPC, MCP Stdio, Timeline, Journal, Leases)       │
│   • packages/surface-engine (SurfaceBlock, SurfaceParam, PatchOp, DriftCheck)            │
│   • packages/inspector-controls (10 Controller parameter serializers & configs)         │
│   • packages/visual-ir (UniversalDocument, VisualNode, Geometry, Paints, Effects)       │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                                            ▼ [oa.config.ts / oa-gen generate]
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: BUILD-TIME PROJECTION TO JSON SCHEMA DRAFT 2020-12 & OPENAPI 3.1               │
│   • JSON Schema Draft 2020-12 ($defs, strict numeric exclusiveMinimum: 0)               │
│   • OpenAPI 3.1 'operation-contract' profile (DevLink Native RPC & MCP stdio)           │
│   • OpenAPI 3.1 'component-bundle' profile (SurfaceEngine, Visual-IR, Inspector)        │
│   • Canonical Metadata: x-schema-engine-profile, version-hash, sources, refs            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
                           ┌────────────────┴────────────────┐
                           ▼                                 ▼
┌──────────────────────────────────────────────┐┌──────────────────────────────────────────┐
│ STAGE 3: SPEC GOVERNANCE & HEADLESS CI MOCK  ││ STAGE 4: STANDALONE AJV TYPE GUARDS      │
│ • @oa-sdk/parser (validateDocument & lint)   ││ • Build-time compilation via AJV 2020    │
│ • @oa-sdk/openapi-projection-contract        ││ • Pre-compiled static ESM guards + .d.ts │
│ • @oa-sdk/mock-server for CI integration     ││ • ZERO @oa-sdk / Zod / AJV runtime weight│
│ • Native Messaging & MCP stdio simulation    ││ • 100% Chrome MV3 CSP safe (no eval)     │
└──────────────────────────────────────────────┘└──────────────────────────────────────────┘
```

### 1.2 Architectural Boundaries & Environment Matrix

| Execution Environment | Permitted Schema Artifacts | Strict Prohibitions | Performance Requirement |
|---|---|---|---|
| **Chrome Extension (MV3)**: Content Scripts, Side Panel, DevTools Panel | Standalone ESM Type Guards (`dist/guards/*.js`), Static TypeScript interfaces | ❌ `@oa-sdk/*`<br>❌ Runtime `zod`<br>❌ Runtime `ajv` compiler<br>❌ Dynamic `eval()` / `new Function()` | 60fps animation budget ($<0.5\text{ms}$ validation latency) |
| **Node.js Session Host**: `packages/devlink-session-host` | Native RPC Zod schemas, Standalone Type Guards, JSON Schema 2020-12 | ❌ `@oa-sdk/*` in runtime dependencies | $<2\text{ms}$ IPC message deserialization |
| **MCP Stdio Daemon**: `packages/devlink-mcp` | MCP Zod schemas, JSON Schema 2020-12 | ❌ Heavy build-time spec generators | $<5\text{ms}$ tool call response |
| **Build Tools & CI**: `oa.config.ts` / `oa-gen` CLI | `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `@oa-sdk/mock-server`, `@oa-sdk/codegen`, `ajv/dist/standalone` | None (Full Node.js build-time toolchain) | Deterministic output, 100% schema validation |

---

## 2. The 4-Stage Schema Pipeline

### 2.1 Stage 1: Master Zod Schemas (SSOT)
Master schemas are defined in pure TypeScript using Zod (`zod@^4.4.3`). They serve as the single authoritative contract for domain logic, runtime validation in backend daemons, and static TypeScript type inference via `z.infer<typeof Schema>`.

```typescript
// Example: packages/surface-engine/src/types/schemas.ts
import { z } from 'zod';

export const CharRangeSchema = z.object({
  start: z.number().int().nonnegative().describe('0-based UTF-16 start offset'),
  end: z.number().int().nonnegative().describe('0-based UTF-16 end offset (exclusive)'),
  length: z.number().int().nonnegative().describe('Character span length'),
});

export const SurfaceParamSchema = z.object({
  id: z.string().min(1).describe('Unique parameter identifier'),
  name: z.string().min(1).describe('CSS property name or JS property key'),
  value: z.string().describe('Formatted code representation of parameter value'),
  range: CharRangeSchema.describe('Exact source range of parameter value in document'),
  inferredType: z.enum(['color', 'dimension', 'typography', 'shadow', 'spacing', 'flex', 'keyword', 'raw']),
  uiEditor: z.enum(['color-picker', 'scrubber', 'select', 'toggle', 'box-model', 'text-input']),
});

export type SurfaceParam = z.infer<typeof SurfaceParamSchema>;
```

### 2.2 Stage 2: JSON Schema Draft 2020-12 Projection
JSON Schema Draft 2020-12 is the universal intermediate representation used for storage, cataloging, and pre-compilation.

#### Strict Dialect Rules:
1. **Target Dialect**: The generator must explicitly target `draft-2020-12` (`$schema: "https://json-schema.org/draft/2020-12/schema"`).
2. **Numeric Exclusive Bounds**: JSON Schema Draft 2020-12 and OpenAPI 3.1 mandate that `exclusiveMinimum` and `exclusiveMaximum` must be numeric values (e.g. `exclusiveMinimum: 0`), **never** boolean values (e.g. `minimum: 0, exclusiveMinimum: true` from Draft 04 / OpenAPI 3.0).
3. **Definition Indexing**: All shared schema definitions must reside under `$defs` (e.g. `#/$defs/SurfaceParam`) rather than legacy `definitions`.
4. **Deterministic Key Ordering**: Object properties, required arrays, and enum elements must be sorted deterministically to ensure bitwise-identical builds.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/surface-param.json",
  "title": "SurfaceParam",
  "type": "object",
  "properties": {
    "id": { "type": "string", "minLength": 1, "description": "Unique parameter identifier" },
    "name": { "type": "string", "minLength": 1, "description": "CSS property name or JS property key" },
    "value": { "type": "string", "description": "Formatted code representation of parameter value" },
    "range": { "$ref": "#/$defs/CharRange" },
    "inferredType": {
      "type": "string",
      "enum": ["color", "dimension", "typography", "shadow", "spacing", "flex", "keyword", "raw"]
    },
    "uiEditor": {
      "type": "string",
      "enum": ["color-picker", "scrubber", "select", "toggle", "box-model", "text-input"]
    }
  },
  "required": ["id", "name", "value", "range", "inferredType", "uiEditor"],
  "additionalProperties": false,
  "$defs": {
    "CharRange": {
      "type": "object",
      "properties": {
        "start": { "type": "integer", "minimum": 0 },
        "end": { "type": "integer", "minimum": 0 },
        "length": { "type": "integer", "minimum": 0 }
      },
      "required": ["start", "end", "length"],
      "additionalProperties": false
    }
  }
}
```

### 2.3 Stage 3: OpenAPI 3.1 Specification Projections (`@oa-sdk`)
OpenAPI 3.1 projections wrap schemas into standardized governance envelopes defined by `@oa-sdk/openapi-projection-contract`.

#### Profile Semantics:
- **`component-bundle` Profile**:
  - Used for standalone domain entity schemas (`SurfaceBlock`, `ResourceManifestV1`, `UniversalDocument`, `VisualNode`).
  - `paths: {}` (empty object or omitted).
  - `components.schemas` is **required** and contains all domain models with internal `$defs` remapped to `#/components/schemas/<Name>`.
  - Relaxed path validation; strict JSON Schema 2020-12 meta-validation.
- **`operation-contract` Profile**:
  - Used for DevLink Native RPC methods (`/rpc/{method}`) and MCP stdio operations (`/mcp/{operation}`).
  - `paths` is **required** and must declare at least one HTTP operation method (POST).
  - Every operation must declare a `requestBody` (referencing param schemas) and a `responses` object with `200` (success), `409` (conflict/lease error), `422` (validation error), and `500` (internal error) conforming to RFC 9457 `application/problem+json`.
- **`full-api-document` Profile**:
  - Complete REST/RPC API documentation including info, servers, paths, operations, security requirements, and components.

#### Required Extension Metadata (`x-schema-engine-*`):
Every projected OpenAPI 3.1 document must attach canonical `@oa-sdk` metadata:
- `x-schema-engine-profile`: `'component-bundle' | 'operation-contract' | 'full-api-document'`
- `x-schema-engine-version-hash`: Deterministic SHA-256 hash of the schema content.
- `x-schema-engine-sources`: Array of source coordinates mapping schemas to TypeScript source files (`kind: 'file'`, `filePath`, `pointer`).
- `x-schema-engine-refs`: Reference graph edges tracking inter-schema dependencies.

```yaml
openapi: 3.1.0
info:
  title: DevLink Native RPC Operation Contract
  version: 1.0.0
  description: Canonical OpenAPI 3.1 contract for DevLink Native Messaging RPC methods.
x-schema-engine-profile: operation-contract
x-schema-engine-version-hash: sha256:8f9a2b...
paths:
  /rpc/session.hello:
    post:
      summary: Session Discovery & Extension Handshake
      operationId: sessionHello
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SessionHelloParams'
      responses:
        '200':
          description: Session handshake established successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionHelloResult'
        '422':
          description: Invalid handshake parameters
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '500':
          description: Internal host error
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
components:
  schemas:
    SessionHelloParams: { ... }
    SessionHelloResult: { ... }
    ProblemDetails: { ... }
```

### 2.4 Stage 4: Standalone AJV Type Guards
For high-frequency runtime validation in browser extension contexts (Content Scripts, DevTools Panel, Side Panel), JSON Schema Draft 2020-12 files are compiled at build time into pure JavaScript standalone functions using `ajv/dist/2020` and `ajv/dist/standalone` via `@oa-sdk/codegen --target standalone-guards`.

#### Properties of Standalone Guards:
- **Zero Runtime Dependencies**: The generated `.js` files contain static verification logic with no runtime dependency on `ajv`, `zod`, or `@oa-sdk`.
- **Zero Dynamic Code Generation**: **100% CSP-safe**; does not use `eval()` or `new Function()`.
- **TypeScript Type Narrowing**: Emits accompanying `.d.ts` files containing custom type guard signatures:
  ```typescript
  export function isSurfaceBlock(data: unknown): data is SurfaceBlock;
  export function isPatchOp(data: unknown): data is PatchOp;
  export function isDevLinkMcpControlRequest(data: unknown): data is DevLinkMcpControlRequestV1;
  export function isProblemDetails(data: unknown): data is ProblemDetails;
  ```

---

## 3. Strict Separation of Concerns & Bundle Decoupling

### 3.1 Manifest V3 CSP & Bundle Decoupling Invariant
Chrome Extensions under Manifest V3 enforce a strict Content Security Policy:
```
script-src 'self'; object-src 'self';
```
Under this policy, any attempt to invoke `eval()`, `new Function(...)`, `setTimeout(string)`, or dynamic WebAssembly compilation causes immediate script termination and extension failure.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ BUILD TIME (Node.js / CI) — Heavy Tooling & Specification Governance                     │
│                                                                                         │
│   • @oa-sdk/openapi-projection-contract (Profile verification)                          │
│   • @oa-sdk/parser (OAS 3.1 / JSON Schema 2020-12 meta-validator)                      │
│   • @oa-sdk/mock-server (Headless CI protocol endpoints)                                │
│   • @oa-sdk/codegen (Standalone guards generation & CSP audit)                          │
│   • ajv v8 + ajv-formats + ajv/dist/standalone (Guard compiler)                        │
│   • zod v4 (Master schema definition & static type inference)                           │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Static Code Generation)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ RUNTIME BUNDLE (Browser Extension Manifest V3 & Content Scripts)                        │
│                                                                                         │
│   ✅ 0 KB @oa-sdk runtime footprint                                                     │
│   ✅ 0 KB AJV compiler engine or JSON Schema AST                                        │
│   ✅ 0 calls to eval() or new Function()                                                │
│   ✅ Sub-millisecond execution for 60fps DevTools slider scrubbing                      │
│   ✅ Pure ESM standalone type guards (dist/guards/*.js)                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 60fps Live-Scrubbing Performance
During interactive inspector manipulation (e.g. dragging a color picker or scrubbing dimension values at 60fps), style mutation payloads must be validated in $<0.5\text{ms}$. Pre-compiled standalone type guards execute direct property type checks and boundary comparisons ($O(1)$ algorithmic complexity), avoiding the multi-millisecond overhead of runtime AST parsing or dynamic schema compilation.

### 3.3 Automated CI Bundle Audit Gate (`oa-gen audit:csp`)
To ensure decoupling is never accidentally broken by developer imports, CI enforces an automated bundle audit command (`oa-gen audit:csp --bundle <dir>`):

```bash
# Scan extension production bundle output directory
pnpm exec oa-gen audit:csp --bundle dist/extension
```

The scanner analyzes bundle ASTs and verifies:
1. **Zero Unsafe Dynamic Execution**: Rejects `eval(`, `new Function(`, and string arguments in `setTimeout` / `setInterval`.
2. **Zero Heavy Runtime Engine Dependencies**: Rejects runtime imports or bundled modules from `ajv`, `zod`, or `@oa-sdk`.
3. **Structured Diagnostics**: Emits violation locations, problematic source tokens, and exits with code 1 upon failure.

---

## 4. DevLink Protocol, RFC 9457 Problem Details & Operation Contract Formalization

### 4.1 Native RPC Methods (17 Operations)
DevLink Native RPC communicates over Chrome Native Messaging using 4-byte little-endian length-prefixed JSON envelopes (`NativeRpcRequestSchema` and `NativeRpcResponseSchema`).

In the OpenAPI 3.1 `operation-contract` profile, each method is formalized as `POST /rpc/{method}`:

| # | RPC Method Name | OpenAPI Path & Operation ID | Summary & Scope | Request Schema | Response Schema |
|---|---|---|---|---|---|
| 1 | `session.hello` | `POST /rpc/session.hello`<br>`sessionHello` | Native host discovery, protocol version handshake, and extension authentication. | `SessionHelloParamsSchema` | `SessionHelloResultSchema` |
| 2 | `workspace.list` | `POST /rpc/workspace.list`<br>`workspaceList` | Enumerate registered, authorized local workspace roots. | `{}` | `WorkspaceListResultSchema` |
| 3 | `workspace.approve` | `POST /rpc/workspace.approve`<br>`workspaceApprove` | Authorize and register a local workspace directory for live editing. | `WorkspaceApproveParamsSchema` | `WorkspaceApproveResultSchema` |
| 4 | `workspace.snapshot.save` | `POST /rpc/workspace.snapshot.save`<br>`workspaceSnapshotSave` | Persist baseline HTML/CSS snapshot and resource manifest to workspace disk. | `WorkspaceSnapshotSaveParamsSchema` | `WorkspaceSnapshotSaveResultSchema` |
| 5 | `binding.resolve` | `POST /rpc/binding.resolve`<br>`bindingResolve` | Resolve live DOM element evidence to local file binding and base revision. | `BindingResolveParamsSchema` | `BindingResolveResultSchema` |
| 6 | `binding.verify-style` | `POST /rpc/binding.verify-style`<br>`bindingVerifyStyle` | Verify and authorize style mutation persistence for a resolved binding. | `BindingVerifyStyleParamsSchema` | `BindingVerifyStyleResultSchema` |
| 7 | `source.inspect` | `POST /rpc/source.inspect`<br>`sourceInspect` | Inspect local stylesheet candidates matching selector, property, and source maps. | `SourceInspectParamsSchema` | `SourceInspectResultSchema` |
| 8 | `materialize.css` | `POST /rpc/materialize.css`<br>`materializeCss` | Direct character-level CSS materialization to workspace source files on disk. | `EditCommitRequestV1Schema` | `EditMaterializationResultV1Schema` |
| 9 | `materialize.rollback` | `POST /rpc/materialize.rollback`<br>`materializeRollback` | Atomic rollback of single or multi-file materialization transactions. | `MaterializeRollbackParamsSchema` | `MaterializeRollbackResultSchema` |
| 10 | `mcp.control` | `POST /rpc/mcp.control`<br>`mcpControl` | Multiplexed MCP control request tunneling between Native Host and Extension. | `McpControlParamsSchema` | `DevLinkMcpControlResultV1Schema` |
| 11 | `journal.get` | `POST /rpc/journal.get`<br>`journalGet` | Query append-only commit, rollback, and lease journal records. | `DevLinkHistoryQueryOptionsSchema` | `DevLinkHistoryResultV1Schema` |
| 12 | `diff.preview` | `POST /rpc/diff.preview`<br>`diffPreview` | Unified diff preview and predicted SHA-256 fingerprint computation before commit. | `DevLinkDiffPreviewParamsSchema` | `DevLinkDiffPreviewResultV1Schema` |
| 13 | `lease.acquire` | `POST /rpc/lease.acquire`<br>`leaseAcquire` | Acquire optimistic workspace or file-level concurrency lease locks. | `LeaseAcquireParamsSchema` | `LeaseAcquireResultSchema` |
| 14 | `lease.renew` | `POST /rpc/lease.renew`<br>`leaseRenew` | Extend TTL on an active concurrency lease lock token. | `LeaseRenewParamsSchema` | `LeaseRenewResultSchema` |
| 15 | `lease.release` | `POST /rpc/lease.release`<br>`leaseRelease` | Explicitly surrender and release an active lease lock token. | `LeaseReleaseParamsSchema` | `LeaseReleaseResultSchema` |
| 16 | `lease.inspect` | `POST /rpc/lease.inspect`<br>`leaseInspect` | Inspect active concurrency leases across workspace and file scopes. | `LeaseInspectParamsSchema` | `LeaseInspectResultSchema` |
| 17 | `utility.patch` | `POST /rpc/utility.patch`<br>`utilityPatch` | Perform AST/regex class surgery on Tailwind and utility classes in source code. | `UtilityClassPatchOptionsSchema` | `UtilityClassPatchResultSchema` |

### 4.2 DevLink MCP Stdio Operations (14 Operations)
The DevLink MCP Stdio interface allows external AI agents and automation tools to control browser inspection, live preview, and style commits via standard Model Context Protocol (MCP) JSON-RPC 2.0.

In the OpenAPI 3.1 `operation-contract` profile, each MCP operation is formalized as `POST /mcp/{operation}`:

| # | MCP Operation Name | OpenAPI Path & Operation ID | Summary & Description |
|---|---|---|---|
| 1 | `session.status` | `POST /mcp/session.status`<br>`mcpSessionStatus` | Query active DevLink extension connection, tabs, and workspace binding status. |
| 2 | `tabs.list` | `POST /mcp/tabs.list`<br>`mcpTabsList` | Enumerate inspectable browser tabs with URL, title, and DevLink readiness. |
| 3 | `targets.list` | `POST /mcp/targets.list`<br>`mcpTargetsList` | List available live DOM inspection targets and element address sets. |
| 4 | `selection.select` | `POST /mcp/selection.select`<br>`mcpSelectionSelect` | Programmatically select DOM element by selector, XPath, or component address. |
| 5 | `style.inspect` | `POST /mcp/style.inspect`<br>`mcpStyleInspect` | Retrieve computed styles, matched CSS rules, and surface parameters for target. |
| 6 | `preview.style` | `POST /mcp/preview.style`<br>`mcpPreviewStyle` | Apply ephemeral, non-destructive 60fps style mutation preview in browser. |
| 7 | `commit.style` | `POST /mcp/commit.style`<br>`mcpCommitStyle` | Commit previewed style mutations to disk via non-AST range patcher. |
| 8 | `rollback` | `POST /mcp/rollback`<br>`mcpRollback` | Revert applied mutations using atomic journal transaction history. |
| 9 | `history.get` | `POST /mcp/history.get`<br>`mcpHistoryGet` | Retrieve commit journal records and revision snapshots for active session. |
| 10 | `diff.preview` | `POST /mcp/diff.preview`<br>`mcpDiffPreview` | Generate character-level visual diff between baseline and mutated style rules. |
| 11 | `lease.acquire` | `POST /mcp/lease.acquire`<br>`mcpLeaseAcquire` | Acquire optimistic editing lease lock before executing agent mutations. |
| 12 | `lease.renew` | `POST /mcp/lease.renew`<br>`mcpLeaseRenew` | Heartbeat renew active editing lease lock during multi-step reasoning. |
| 13 | `lease.release` | `POST /mcp/lease.release`<br>`mcpLeaseRelease` | Explicitly release editing lease lock upon task completion. |
| 14 | `lease.inspect` | `POST /mcp/lease.inspect`<br>`mcpLeaseInspect` | Inspect existing active leases to avoid agent concurrency collisions. |

### 4.3 Domain Entity Component Bundles
Domain models that represent shared data interchange structures are projected under the `component-bundle` profile:
- **`SurfaceBlock` & `SurfaceParam`**: Non-AST editable code blocks, character spans, quote styles, and parameters.
- **`PatchOp`**: Discriminated union of atomic range patch operations (`UpdateParamOp`, `InsertParamOp`, `DeleteParamOp`, `RawReplaceOp`).
- **`ResourceManifestV1`**: Snapshot manifest containing baseline HTML/CSS hashes and file paths.
- **`UniversalDocument` & `VisualNode`**: Canonical visual intermediate representation tree.
- **`TimelineStepV1` & `DevLinkJournalRecordV1`**: Undo/redo timeline frames and commit journal entries.

---

### 4.4 RFC 9457 Problem Details Error Payload Convention

All error responses across HTTP/RPC endpoints, DevLink operation contracts, and `@oa-sdk/mock-server` simulations must strictly conform to **RFC 9457: Problem Details for HTTP APIs** (`application/problem+json`).

#### Standard RFC 9457 Fields:
1. `type` (`string`, format `uri`): A URI reference that identifies the problem type. When dereferenced, it should provide human-readable documentation. Defaults to `"about:blank"` if unspecified.
2. `title` (`string`): A short, human-readable summary of the problem type (e.g. `"Unprocessable Content"`, `"Lease Conflict"`, `"Internal Server Error"`).
3. `status` (`integer`, bounds $100 \le \text{status} \le 599$): The HTTP status code generated by the origin server for this occurrence of the problem.
4. `detail` (`string`, optional): A human-readable explanation specific to this occurrence of the problem.
5. `instance` (`string`, format `uri-reference`, optional): A URI reference that identifies the specific occurrence of the problem (e.g. `"/rpc/materialize.css#tx-9a8b"`).

#### Standard Extension Members:
To support rich automated error recovery and agentic reasoning without breaking RFC 9457 conformance, the following standard extension members are defined:
- `code` (`string`): Machine-readable error identifier (e.g. `"VALIDATION_ERROR"`, `"LEASE_CONFLICT"`, `"RESOURCE_UNAVAILABLE"`).
- `invalidParams` (`array` of objects): Array of granular parameter validation failures containing:
  - `name` (`string`): Name of the invalid field or parameter.
  - `reason` (`string`): Explanation of why validation failed.
  - `path` (`string`, optional): JSON pointer or dot-separated path to the invalid property.
  - `code` (`string`, optional): Machine-readable failure sub-code (e.g. `"MINIMUM_VIOLATION"`).
- `details` (`record` or `unknown`, optional): Structured contextual metadata specific to the error condition (e.g. `{ lockedUntil: 1725300000, currentOwner: "agent-session-42" }`).

#### Complete Master Schema Definition (TypeScript & Zod):

```typescript
// packages/devlink-contracts/src/problem-details.ts
import { z } from 'zod';

/**
 * Individual field validation error member in RFC 9457 extension.
 */
export const InvalidParamSchema = z.object({
  name: z.string().min(1).describe('Name of the invalid parameter or property'),
  reason: z.string().min(1).describe('Human-readable description of the constraint violation'),
  path: z.string().optional().describe('JSON pointer or path to the invalid property (e.g. "/range/start")'),
  code: z.string().optional().describe('Machine-readable validation code (e.g. "MINIMUM_VIOLATION")'),
});
export type InvalidParam = z.infer<typeof InvalidParamSchema>;

/**
 * RFC 9457 Problem Details Schema for standardized HTTP/RPC error payloads.
 * Content-Type: application/problem+json
 */
export const ProblemDetailsSchema = z.object({
  type: z
    .string()
    .url()
    .default('about:blank')
    .describe('URI reference identifying the problem type specification'),
  title: z
    .string()
    .min(1)
    .describe('Short, human-readable summary of the problem type'),
  status: z
    .number()
    .int()
    .min(100)
    .max(599)
    .describe('HTTP status code associated with this problem occurrence'),
  detail: z
    .string()
    .optional()
    .describe('Human-readable explanation specific to this occurrence of the problem'),
  instance: z
    .string()
    .optional()
    .describe('URI reference identifying the specific occurrence of the problem'),
  // Extension members
  code: z
    .string()
    .min(1)
    .optional()
    .describe('Machine-readable domain error code (e.g. "LEASE_CONFLICT", "VALIDATION_ERROR")'),
  invalidParams: z
    .array(InvalidParamSchema)
    .optional()
    .describe('List of invalid parameter errors for 422 Unprocessable Content responses'),
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arbitrary contextual metadata associated with the error condition'),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Helper factory function for constructing typed RFC 9457 error instances.
 */
export function createProblemDetails(options: {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  instance?: string;
  code?: string;
  invalidParams?: InvalidParam[];
  details?: Record<string, unknown>;
}): ProblemDetails {
  return ProblemDetailsSchema.parse({
    type: options.type ?? 'about:blank',
    title: options.title,
    status: options.status,
    detail: options.detail,
    instance: options.instance,
    code: options.code,
    invalidParams: options.invalidParams,
    details: options.details,
  });
}
```

#### JSON Schema Draft 2020-12 Representation:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/problem-details.json",
  "title": "ProblemDetails",
  "description": "RFC 9457 Problem Details for HTTP APIs (application/problem+json)",
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "format": "uri",
      "default": "about:blank",
      "description": "URI reference identifying the problem type specification"
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "description": "Short, human-readable summary of the problem type"
    },
    "status": {
      "type": "integer",
      "minimum": 100,
      "maximum": 599,
      "description": "HTTP status code associated with this problem occurrence"
    },
    "detail": {
      "type": "string",
      "description": "Human-readable explanation specific to this occurrence of the problem"
    },
    "instance": {
      "type": "string",
      "description": "URI reference identifying the specific occurrence of the problem"
    },
    "code": {
      "type": "string",
      "minLength": 1,
      "description": "Machine-readable domain error code"
    },
    "invalidParams": {
      "type": "array",
      "items": { "$ref": "#/$defs/InvalidParam" },
      "description": "List of invalid parameter errors for 422 Unprocessable Content responses"
    },
    "details": {
      "type": "object",
      "additionalProperties": true,
      "description": "Arbitrary contextual metadata associated with the error condition"
    }
  },
  "required": ["title", "status"],
  "additionalProperties": false,
  "$defs": {
    "InvalidParam": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "reason": { "type": "string", "minLength": 1 },
        "path": { "type": "string" },
        "code": { "type": "string" }
      },
      "required": ["name", "reason"],
      "additionalProperties": false
    }
  }
}
```

---

### 4.5 Multi-Status Error Response Mapping in OpenAPI 3.1

In the `operation-contract` profile, every API/RPC operation must declare standard RFC 9457 error response mappings under `responses` for:
- **`422` (Unprocessable Content)**: Syntactic or semantic parameter validation failure (`invalidParams` populated).
- **`409` (Conflict)**: Optimistic concurrency lock collision, lease contention, or baseline file drift.
- **`500` (Internal Server Error)**: Unexpected daemon crash, unhandled exception, or I/O failure.

#### Normative OpenAPI 3.1 Operation Specification:

```yaml
openapi: 3.1.0
info:
  title: DevLink Materialization Service Contract
  version: 1.0.0
x-schema-engine-profile: operation-contract
paths:
  /rpc/materialize.css:
    post:
      summary: Materialize CSS mutations to disk
      operationId: materializeCss
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EditCommitRequestV1'
      responses:
        '200':
          description: Materialization committed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EditMaterializationResultV1'
        '409':
          description: Concurrency lease conflict or baseline source drift detected
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/lease-conflict'
                title: 'Lease Conflict'
                status: 409
                detail: 'Target file is locked under lease by agent-session-42 until TTL expiry.'
                instance: '/rpc/materialize.css#lease-check'
                code: 'LEASE_CONFLICT'
                details:
                  lockedUntil: 1725300045000
                  leaseHolder: 'agent-session-42'
                  targetPath: '/src/components/Header.tsx'
        '422':
          description: Request body validation failed (schema constraint violation)
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/validation-error'
                title: 'Unprocessable Content'
                status: 422
                detail: 'The submitted patch operations failed schema validation.'
                instance: '/rpc/materialize.css#validation'
                code: 'INVALID_REQUEST'
                invalidParams:
                  - name: 'range.start'
                    reason: 'Value must be greater than or equal to 0'
                    path: '/patches/0/range/start'
                    code: 'MINIMUM_VIOLATION'
        '500':
          description: Internal server error or disk I/O failure
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
              example:
                type: 'https://browser-studio.dev/errors/internal-error'
                title: 'Internal Server Error'
                status: 500
                detail: 'Disk write permission denied on target stylesheet.'
                code: 'WRITE_FAILED'
components:
  schemas:
    EditCommitRequestV1: { ... }
    EditMaterializationResultV1: { ... }
    ProblemDetails: { ... }
```

---

## 5. V3 Unified Architecture & TypeScript AST Bidirectional Synchronization

### 5.1 The EntitySpec Intermediate Representation
The **V3 Unified Architecture** eliminates impedance mismatch between schema representations, TypeScript code, and visual editing interfaces through `EntitySpec`—a lossless, AST-agnostic intermediate specification.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                ENTITYSPEC (Canonical SSOT)                              │
│  • id, name, kind ('schema' | 'interface' | 'type-alias' | 'node')                      │
│  • properties: Record<string, EntityPropertySpec>                                       │
│  • constraints: PropertyConstraint[] (min, max, length, regex, format, int, positive)   │
│  • discriminator: { propertyName: string, value?: string, mapping?: Record }            │
│  • docComment: JSDoc description & metadata tags                                        │
└───────────────────▲─────────────────────────────────────────────────┬───────────────────┘
                    │                                                 │
          CodeToSpec│                                       SpecToCode│
                    │                                                 ▼
┌───────────────────┴─────────────────┐             ┌─────────────────────────────────────┐
│ PLUGGABLE TYPE ADAPTERS             │             │ GRANULAR AST DIFF & TEXT EDITS      │
│  • ZodAdapter: z.object({...})      │             │  • DiffEngine: computeDiff(old, new)│
│  • TsAstAdapter: interface / type   │             │  • Reverse-Offset Patch Application │
│  • TypiaAdapter: T & tags.Type<...> │             │  • Zero-loss formatting retention   │
└─────────────────────────────────────┘             └─────────────────────────────────────┘
```

### 5.2 Pluggable Type Adapter Pattern
The `TypeAdapter` interface allows arbitrary schema and code representations to seamlessly roundtrip into `EntitySpec`:

```typescript
export interface TypeAdapter<TInput = string, TOutput = string> {
  readonly name: string; // 'zod' | 'ts-ast' | 'typia'
  readonly supportedDialects: string[];

  read(source: TInput): EntitySpec;
  write(spec: EntitySpec): TOutput;
}
```

1. **Zod Adapter (`packages/codegen/src/ast-sync/adapters/zod.ts`)**:
   - Parses `z.object()`, `z.discriminatedUnion()`, `.min()`, `.max()`, `.describe()`.
   - Generates idiomatic Zod schema code with method chaining.
2. **TypeScript AST Adapter (`packages/codegen/src/ast-sync/adapters/ts-ast.ts`)**:
   - Uses `typescript` compiler API to parse `interface` and `type` declarations.
   - Extracts JSDoc validation and documentation tags into `EntityPropertySpec`.
3. **Typia Adapter (`packages/codegen/src/ast-sync/adapters/typia.ts`)**:
   - Parses Typia comment validation tags (`@minimum`, `@format`).
   - Generates ultra-fast Typia validation interfaces.

### 5.3 Granular AST Diff Engine & Bitwise Invariance
When an `EntitySpec` is modified in memory (e.g. adding a property or updating a constraint), the `ASTDiffEngine` computes granular diff operations (`ASTDiff`):
- `add-property`, `remove-property`, `update-property`, `update-entity`, `add-extends`, `remove-extends`, `update-doc-comment`, `update-discriminator`.

Instead of regenerating the entire file from scratch (which wipes out comments, whitespace, and formatting), the diff engine produces precise `TextEdit` spans applied in **reverse-offset bottom-up order** ($s_i \ge s_{i+1}$), guaranteeing **100% bitwise invariance** across all unedited regions of the source file.

---

### 5.4 Normative JSDoc Validation Tag Parsing Specification

In the V3 Unified Architecture, TypeScript interfaces and type aliases can be annotated with standard JSDoc validation tags. The AST sync engine (`ts-ast` and `typia` adapters) parses these tags into normalized `PropertyConstraint` records.

#### Canonical JSDoc Tag Mapping Table:

| JSDoc Tag Syntax | Target `PropertyConstraint` Field | Zod Master Schema Equivalent | JSON Schema 2020-12 / OAS 3.1 Keyword |
|---|---|---|---|
| `@minimum <n>` or `@min <n>` | `constraints.minimum = n`<br>`constraints.min = n` | `z.number().min(n)` or `.nonnegative()` (for 0) | `"minimum": n` |
| `@maximum <n>` or `@max <n>` | `constraints.maximum = n`<br>`constraints.max = n` | `z.number().max(n)` or `.nonpositive()` (for 0) | `"maximum": n` |
| `@exclusiveMinimum <n>` | `constraints.exclusiveMinimum = n` | `z.number().gt(n)` or `.positive()` (for 0) | `"exclusiveMinimum": n` |
| `@exclusiveMaximum <n>` | `constraints.exclusiveMaximum = n` | `z.number().lt(n)` or `.negative()` (for 0) | `"exclusiveMaximum": n` |
| `@minLength <n>` | `constraints.minLength = n` | `z.string().min(n)` | `"minLength": n` |
| `@maxLength <n>` | `constraints.maxLength = n` | `z.string().max(n)` | `"maxLength": n` |
| `@pattern <regex>` | `constraints.pattern = "<regex>"` | `z.string().regex(/<regex>/)` | `"pattern": "<regex>"` |
| `@format email` | `constraints.format = 'email'`<br>`constraints.email = true` | `z.string().email()` | `"format": "email"` |
| `@format uri` or `@format url` | `constraints.format = 'uri'`<br>`constraints.url = true` | `z.string().url()` | `"format": "uri"` |
| `@format uuid` | `constraints.format = 'uuid'`<br>`constraints.uuid = true` | `z.string().uuid()` | `"format": "uuid"` |
| `@format date-time` | `constraints.format = 'date-time'`<br>`constraints.datetime = true` | `z.string().datetime()` | `"format": "date-time"` |
| `@format date` | `constraints.format = 'date'` | `z.string().date()` | `"format": "date"` |
| `@format time` | `constraints.format = 'time'` | `z.string().time()` | `"format": "time"` |
| `@format duration` | `constraints.format = 'duration'` | `z.string().duration()` | `"format": "duration"` |
| `@multipleOf <n>` | `constraints.multipleOf = n` | `z.number().multipleOf(n)` | `"multipleOf": n` |
| `@default <literal>` | `constraints.default = parsedJSON` | `z.schema.default(parsedJSON)` | `"default": parsedJSON` |
| `@type <primitive>` | `constraints.type = "<primitive>"` | `z.<primitive>()` | `"type": "<primitive>"` |

#### Non-Validation JSDoc Tags (Preserved as Documentation):
Tags that do not define structural schema constraints are isolated and preserved in `EntityPropertySpec.docComment` and `ParsedJSDoc.nonTypiaTags`:
- `@description <text>`: Primary description text.
- `@deprecated [<reason>]`: Marks the property as deprecated.
- `@example <sample>`: Example payload or property value.
- `@see <reference>`: Cross-reference link or pointer.
- `@note <text>`: Developer notes and context.

---

### 5.5 Discriminated Union AST Mapping (`@discriminator`)

The `@discriminator <propertyName>` tag placed above a TypeScript interface or union type alias declares the explicit tag property for polymorphic variant dispatch.

```typescript
/**
 * Discriminated union of visual canvas elements.
 * @discriminator kind
 */
export type CanvasElement = TextCanvasElement | ShapeCanvasElement | ImageCanvasElement;
```

#### Bidirectional Mapping Pipeline:
1. **TypeScript AST $\to$ `EntitySpec`**:
   The AST adapter extracts `@discriminator kind` and populates `EntitySpec.discriminator = { propertyName: 'kind' }`.
2. **`EntitySpec` $\to$ Zod**:
   The Zod adapter emits `z.discriminatedUnion('kind', [TextCanvasElementSchema, ShapeCanvasElementSchema, ImageCanvasElementSchema])`.
3. **`EntitySpec` $\to$ OpenAPI 3.1**:
   The OpenAPI projector emits `oneOf` with `discriminator: { propertyName: 'kind', mapping: { ... } }`.

---

### 5.6 Complete Runnable Bidirectional Synchronization Example

#### Step 1: Input TypeScript Interface with JSDoc Validation Tags

```typescript
// input-interface.ts
export interface VisualLayerSpec {
  /**
   * Unique identifier of the visual layer
   * @format uuid
   * @minLength 1
   */
  id: string;

  /**
   * Layer display name in tree
   * @minLength 1
   * @maxLength 128
   */
  name: string;

  /**
   * Layer opacity fraction
   * @minimum 0
   * @maximum 1
   * @default 1
   */
  opacity: number;

  /**
   * Layer z-index order in stack
   * @exclusiveMinimum 0
   */
  zIndex: number;

  /**
   * Visual paint background color in hex
   * @pattern ^#(?:[0-9a-fA-F]{3}){1,2}$
   * @example "#ff0000"
   */
  backgroundColor?: string;
}
```

#### Step 2: Parsed Intermediate `EntitySpec` Representation

```json
{
  "id": "visuallayerspec",
  "name": "VisualLayerSpec",
  "kind": "interface",
  "properties": {
    "id": {
      "name": "id",
      "type": "string",
      "docComment": "Unique identifier of the visual layer",
      "constraints": {
        "format": "uuid",
        "uuid": true,
        "minLength": 1
      }
    },
    "name": {
      "name": "name",
      "type": "string",
      "docComment": "Layer display name in tree",
      "constraints": {
        "minLength": 1,
        "maxLength": 128
      }
    },
    "opacity": {
      "name": "opacity",
      "type": "number",
      "docComment": "Layer opacity fraction",
      "constraints": {
        "minimum": 0,
        "maximum": 1,
        "default": 1
      }
    },
    "zIndex": {
      "name": "zIndex",
      "type": "number",
      "docComment": "Layer z-index order in stack",
      "constraints": {
        "exclusiveMinimum": 0
      }
    },
    "backgroundColor": {
      "name": "backgroundColor",
      "type": "string",
      "optional": true,
      "docComment": "Visual paint background color in hex\n@example \"#ff0000\"",
      "constraints": {
        "pattern": "^#(?:[0-9a-fA-F]{3}){1,2}$"
      }
    }
  }
}
```

#### Step 3: Generated Zod Master Schema Output

```typescript
// generated-zod.ts
import { z } from 'zod';

export const VisualLayerSpecSchema = z.object({
  id: z.string().uuid().min(1).describe('Unique identifier of the visual layer'),
  name: z.string().min(1).max(128).describe('Layer display name in tree'),
  opacity: z.number().min(0).max(1).default(1).describe('Layer opacity fraction'),
  zIndex: z.number().gt(0).describe('Layer z-index order in stack'),
  backgroundColor: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/)
    .optional()
    .describe('Visual paint background color in hex\n@example "#ff0000"'),
});

export type VisualLayerSpec = z.infer<typeof VisualLayerSpecSchema>;
```

---

## 6. Schema Authoring Best Practices & Guidelines

### 6.1 Naming & Export Conventions
All schema definitions in Browser Studio must adhere to strict naming conventions:

| Category | Schema Variable Name | Inferred TypeScript Type | Example |
|---|---|---|---|
| **Domain Model** | `<Name>Schema` | `<Name>` | `SurfaceBlockSchema` $\to$ `SurfaceBlock` |
| **Versioned Model** | `<Name>V<Major>Schema` | `<Name>V<Major>` | `ResourceManifestV1Schema` $\to$ `ResourceManifestV1` |
| **RPC Request Params** | `<Method>ParamsSchema` | `<Method>Params` | `SessionHelloParamsSchema` $\to$ `SessionHelloParams` |
| **RPC Response Result** | `<Method>ResultSchema` | `<Method>Result` | `SessionHelloResultSchema` $\to$ `SessionHelloResult` |
| **MCP Input Contract** | `<Tool>InputSchema` | `<Tool>Input` | `InspectElementInputSchema` $\to$ `InspectElementInput` |
| **Discriminated Union** | `<Entity>UnionSchema` or `<Entity>Schema` | `<Entity>` | `PatchOpSchema` $\to$ `PatchOp` |

---

### 6.2 Discriminated Unions for Polymorphic Payloads
When defining polymorphic data structures (e.g. `PatchOp`, `BrowserActionStepV1`, `DevLinkMcpControlRequestV1`), always use `z.discriminatedUnion()` with a single literal discriminator field (`type`, `action`, `operation`, or `op`):

```typescript
// Correct: Discriminated Union with tag 'op'
export const UpdateParamOpSchema = z.object({
  op: z.literal('update-param'),
  paramId: z.string().min(1),
  newValue: z.string(),
  previousValue: z.string().optional(),
});

export const InsertParamOpSchema = z.object({
  op: z.literal('insert-param'),
  paramName: z.string().min(1),
  value: z.string(),
  afterParamId: z.string().optional(),
});

export const DeleteParamOpSchema = z.object({
  op: z.literal('delete-param'),
  paramId: z.string().min(1),
});

export const PatchOpSchema = z.discriminatedUnion('op', [
  UpdateParamOpSchema,
  InsertParamOpSchema,
  DeleteParamOpSchema,
]);

export type PatchOp = z.infer<typeof PatchOpSchema>;
```

#### Why `z.discriminatedUnion` is Mandatory:
1. **$O(1)$ Dispatch**: Standalone AJV generators emit direct `switch (data.op)` jump tables instead of trying all union members sequentially ($O(N)$).
2. **OpenAPI 3.1 Mapping**: Translates cleanly to `oneOf` with `discriminator: { propertyName: 'op' }`.
3. **Exhaustive Type Narrowing**: TypeScript compiler performs 100% exhaustive switch checks (`never` branch).

---

### 6.3 Strict Numeric Bounds Drafting Patterns (Inclusive vs. Exclusive)

In OpenAPI 3.0 and JSON Schema Draft 04, exclusive boundaries were expressed using a boolean flag modifier (`minimum: 0, exclusiveMinimum: true`).

In **JSON Schema Draft 2020-12** and **OpenAPI 3.1**, `exclusiveMinimum` and `exclusiveMaximum` are **strictly numeric values**. Providing a boolean value is a meta-schema validation violation and will fail `@oa-sdk/parser` lint checks.

#### Comparative Numeric Constraint Matrix:

| Mathematical Condition | Zod Master Schema Chain | JSON Schema 2020-12 / OAS 3.1 Keyword | Legacy Draft 04 / OAS 3.0 (Forbidden) |
|---|---|---|---|
| $x \ge 0$ (Non-negative float) | `z.number().min(0)` or `z.number().nonnegative()` | `{"type": "number", "minimum": 0}` | `{"minimum": 0}` |
| $n \ge 0$ (Non-negative integer) | `z.number().int().min(0)` or `.int().nonnegative()` | `{"type": "integer", "minimum": 0}` | `{"type": "integer", "minimum": 0}` |
| $x > 0$ (Strictly positive float) | `z.number().gt(0)` or `z.number().positive()` | `{"type": "number", "exclusiveMinimum": 0}` | `{"minimum": 0, "exclusiveMinimum": true}` ❌ |
| $n > 0$ (Strictly positive integer) | `z.number().int().gt(0)` or `.int().positive()` | `{"type": "integer", "exclusiveMinimum": 0}` | `{"type": "integer", "minimum": 0, "exclusiveMinimum": true}` ❌ |
| $x \le 100$ (Upper bound float) | `z.number().max(100)` or `z.number().nonpositive()` (for 0) | `{"type": "number", "maximum": 100}` | `{"maximum": 100}` |
| $x < 100$ (Strict upper bound float)| `z.number().lt(100)` or `z.number().negative()` (for 0) | `{"type": "number", "exclusiveMaximum": 100}` | `{"maximum": 100, "exclusiveMaximum": true}` ❌ |
| $0 \le x \le 1$ (Closed unit interval)| `z.number().min(0).max(1)` | `{"minimum": 0, "maximum": 1}` | `{"minimum": 0, "maximum": 1}` |
| $0 < x < 1$ (Open unit interval) | `z.number().gt(0).lt(1)` | `{"exclusiveMinimum": 0, "exclusiveMaximum": 1}` | `{"minimum": 0, "exclusiveMinimum": true, "maximum": 1, "exclusiveMaximum": true}` ❌ |
| $0 \le x < 1$ (Half-open interval) | `z.number().min(0).lt(1)` | `{"minimum": 0, "exclusiveMaximum": 1}` | `{"minimum": 0, "maximum": 1, "exclusiveMaximum": true}` ❌ |

#### Authoring Rules: DOs and DON'Ts

```typescript
// ❌ DON'T: Using custom .refine() for numeric boundaries or boolean flags
// Custom refinements cannot be statically analyzed into JSON Schema / OpenAPI bounds!
export const BadNumericBoundsSchema = z.object({
  // ❌ Cannot be projected to OpenAPI minimum/exclusiveMinimum:
  customPositive: z.number().refine((val) => val > 0, { message: 'Must be positive' }),
  // ❌ Ambiguous boundary: using .min(1) for a float when 0.1 should be valid
  pixelRatio: z.number().min(1),
  // ❌ Misinterpreting exclusive boundary in Draft 2020-12
  zeroExcluded: z.number().nonnegative(), // allows 0!
});

// ✅ DO: Using declarative Zod chain methods that compile to Draft 2020-12 / OAS 3.1 keywords
export const GoodNumericBoundsSchema = z.object({
  // Non-negative float (x >= 0): compiles to { type: 'number', minimum: 0 }
  opacity: z.number().min(0).max(1).describe('Opacity fraction [0.0, 1.0]'),
  // or equivalently:
  scale: z.number().nonnegative().describe('Scale factor >= 0.0'),

  // Strictly positive float (x > 0): compiles to { type: 'number', exclusiveMinimum: 0 }
  zoomFactor: z.number().gt(0).describe('Zoom factor strictly greater than 0.0'),
  // or equivalently:
  width: z.number().positive().describe('Width strictly greater than 0.0'),

  // Non-negative integer (n >= 0): compiles to { type: 'integer', minimum: 0 }
  startOffset: z.number().int().nonnegative().describe('0-based UTF-16 character offset'),

  // Strictly positive integer (n > 0): compiles to { type: 'integer', exclusiveMinimum: 0 }
  pageSize: z.number().int().positive().describe('Page size must be >= 1'),

  // Half-open interval [0, 1): compiles to { minimum: 0, exclusiveMaximum: 1 }
  progress: z.number().min(0).lt(1).describe('Progress fraction in range [0.0, 1.0)'),
});
```

#### Complete Runnable Code Example:

```typescript
// packages/inspector-controls/src/numeric-bounds-example.ts
import { z } from 'zod';

export const TransformControlsSchema = z.object({
  // Inclusive: 0 <= scale <= 10
  scale: z
    .number()
    .min(0)
    .max(10)
    .describe('Scale factor between 0.0 (inclusive) and 10.0 (inclusive)'),

  // Strictly positive: width > 0
  widthPx: z
    .number()
    .positive()
    .describe('Pixel width must be strictly greater than 0'),

  // Strictly positive integer: frameCount > 0, integer
  frameCount: z
    .number()
    .int()
    .positive()
    .describe('Total rendering frame count must be a positive non-zero integer'),

  // Half-open interval: 0.0 <= normalizedProgress < 1.0
  normalizedProgress: z
    .number()
    .min(0)
    .lt(1)
    .describe('Animation progress fraction in range [0.0, 1.0)'),

  // Non-negative integer index: 0, 1, 2, ...
  layerIndex: z
    .number()
    .int()
    .nonnegative()
    .describe('0-based layer index'),
});

export type TransformControls = z.infer<typeof TransformControlsSchema>;
```

---

### 6.4 Self-Referencing Recursive Schemas (`z.lazy` + Registry Cycle-Safe Projection)

When modeling hierarchical tree structures (such as `VisualTreeNode`, `SurfaceBlockTree`, or recursive expression ASTs), naive recursive type inference triggers TypeScript errors:
- **TS7022**: *'NodeSchema' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.*
- **TS2456**: *Type alias circularly references itself.*

#### Authoring Rules: DOs and DON'Ts

```typescript
// ❌ DON'T: Recursive schema without explicit interface and type annotation
// TypeScript cannot infer self-referential types without explicit typing,
// resulting in TS7022 / TS2456 errors or infinite compiler type instantiation loops!
export const BadVisualTreeNodeSchema = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    // ❌ Error TS7022: 'BadVisualTreeNodeSchema' implicitly has type 'any'
    children: z.array(BadVisualTreeNodeSchema).optional(),
  })
);

// ✅ DO: Normative 4-step pattern for self-referencing recursive models
// 1. Declare explicit recursive TypeScript interface
// 2. Explicitly annotate the schema variable with z.ZodType<T>
// 3. Wrap definition in z.lazy(() => z.object({ ... }))
// 4. Register in projection registry refs map for cycle-safe $ref emission
```

#### The Normative Pattern for Recursive Schemas:
1. **Explicit TypeScript Interface**: Define the explicit recursive interface first.
2. **Explicit `z.ZodType<T>` Annotation**: Annotate the schema variable with `z.ZodType<T>`.
3. **Wrap in `z.lazy(() => ...)`**: Lazy-evaluate the recursive child reference.
4. **Registry Registration**: Register the schema in the projection registry (`refs` map) to ensure cyclic references are converted to local `$ref` pointers (`#/$defs/<Name>` or `#/components/schemas/<Name>`) rather than causing infinite expansion during build-time serialization.

#### Complete Runnable Code Example (Recursive Tree):

```typescript
// packages/visual-ir/src/types/visual-tree.ts
import { z } from 'zod';

/**
 * Step 1: Explicit recursive TypeScript interface.
 */
export interface VisualTreeNode {
  id: string;
  type: 'frame' | 'group' | 'text' | 'shape';
  name: string;
  visible: boolean;
  children?: VisualTreeNode[];
  metadata?: Record<string, unknown>;
}

/**
 * Step 2 & 3: Annotated recursive Zod schema using z.lazy.
 */
export const VisualTreeNodeSchema: z.ZodType<VisualTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid().describe('Unique visual tree node identifier'),
    type: z.enum(['frame', 'group', 'text', 'shape']).describe('Visual node categorization'),
    name: z.string().min(1).describe('Human-readable node label'),
    visible: z.boolean().default(true).describe('Node visibility flag in viewport'),
    children: z
      .array(VisualTreeNodeSchema)
      .optional()
      .describe('Hierarchical child nodes in paint render order'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary plugin or toolchain metadata'),
  })
);

/**
 * Document root wrapping recursive nodes.
 */
export const VisualTreeDocumentSchema = z.object({
  documentId: z.string().uuid(),
  version: z.number().int().positive(),
  root: VisualTreeNodeSchema,
});
export type VisualTreeDocument = z.infer<typeof VisualTreeDocumentSchema>;
```

#### Cycle-Safe Projection Engine Mechanics:
During projection to JSON Schema Draft 2020-12 or OpenAPI 3.1:
1. The projection engine registers `VisualTreeNodeSchema` in `context.refs.set(VisualTreeNodeSchema, 'VisualTreeNode')`.
2. When converting child properties, `_converting.has(VisualTreeNodeSchema)` detects the recursion loop and immediately returns `{ $ref: "#/components/schemas/VisualTreeNode" }`.
3. This completely prevents call stack overflow and produces clean, compliant cyclic reference graphs:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://browser-studio.dev/schemas/v1/visual-tree.json",
  "title": "VisualTreeNode",
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "type": "string", "enum": ["frame", "group", "text", "shape"] },
    "name": { "type": "string", "minLength": 1 },
    "visible": { "type": "boolean", "default": true },
    "children": {
      "type": "array",
      "items": { "$ref": "#/$defs/VisualTreeNode" }
    },
    "metadata": { "type": "object", "additionalProperties": true }
  },
  "required": ["id", "type", "name", "visible"],
  "additionalProperties": false,
  "$defs": {
    "VisualTreeNode": {
      "$ref": "#"
    }
  }
}
```

#### OpenAPI 3.1 Cyclic `$ref` Validation Behavior
OpenAPI 3.1 and JSON Schema Draft 2020-12 natively support cyclic `$ref` structures within `components.schemas` and `$defs`. While legacy OpenAPI 3.0 linters occasionally flag self-referential schemas as invalid circular references (`ref-cycle`), `@oa-sdk` CLI validation (`oa-gen validate`) automatically identifies and permits valid recursive schema structures, suppressing false-positive circular reference diagnostics.

---

### 6.5 `x-surface-*` Scoping Rules (Object-Level vs. Inline Property-Level)

The Surface Engine powers non-AST live-patching and inspector interaction. Formal surface metadata extensions are declared in `@oa-sdk/openapi-projection-contract` and validated by `@oa-sdk/parser`.

#### The 5 Canonical Surface Vendor Extensions:

1. **`x-surface-anchor`**: AST synchronization and code anchor coordinates:
   - `id` (`string`, required): Unique anchor identifier.
   - `line` (`integer`, required, $\ge 1$): 1-based source line number.
   - `column` (`integer`, required, $\ge 1$): 1-based source column number.
   - `raw` (`string`, optional): Original raw source token text.
   - `commentType` (`string`, optional): `'line' | 'block' | 'doc' | string`.
2. **`x-surface-param-range`**: Non-AST character range and live-patching boundaries:
   - `targetProperty` (`string`, required in object-level scope): Primary property target for live mutations.
   - `start` (`integer`, optional, $\ge 0$): 0-based UTF-16 character start offset.
   - `end` (`integer`, optional, $\ge 0$): 0-based UTF-16 character end offset.
   - `unquotedStart` (`integer`, optional): Start offset excluding enclosing quotes.
   - `unquotedEnd` (`integer`, optional): End offset excluding enclosing quotes.
   - `supportsLivePatch` (`boolean`, optional): Enables 60fps live range patching.
   - `maxFramerateHz` (`number`, optional, $> 0$): Throttling cap for slider scrubbing (e.g. 60 or 120).
3. **`x-surface-fingerprint`**: Deterministic SHA-256 fingerprint for AST/content drift detection:
   - String matching regex `^sha256:[a-f0-9]{64}$` (e.g. `"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`).
4. **`x-surface-quote-style`**: Preferred code string literal quote style:
   - Enum: `'single' | 'double' | 'backtick' | 'none'`.
5. **`x-surface-patch-policy`**: Rebase and drift recovery strategy when editing out-of-sync documents:
   - `onDrift` (`enum`: `'abort' | 'rebase' | 'force'`, required): Action taken on baseline drift.
   - `retryLimit` (`integer`, optional, $\ge 0$): Maximum rebase retry attempts.

#### Two Distinct Scoping Tiers:

##### 1. Object-Level Scope (`targetProperty`)
Declared at the top-level of an object schema to bind multi-property live-patching coordinates (e.g. associating `name`, `nameRange`, `value`, `valueRange`, and `unquotedValue`):
- `targetProperty` (`string`, **required for object scope**): Designates which property in `properties` is the primary target for live-patch mutations.
- `supportsLivePatch` (`boolean`): Indicates whether this entity supports 60fps non-AST live range patching.
- `maxFramerateHz` (`number`): Throttling cap for slider scrubbing (e.g. 60 or 120).
- `driftCheckAlgorithm` (`enum`: `'sha256' | 'character-count' | 'none'`): Integrity verification method.

##### 2. Inline Property-Level Scope
Attached directly inside individual property definitions in `properties` to configure editor behavior for that specific property:
- `x-surface-quote-style` (`enum`: `'single' | 'double' | 'backtick' | 'none'`): Preferred code string quote style.
- `x-surface-live-patch` (`boolean`): Whether this specific property accepts live patch transactions.
- `x-surface-ui-editor` (`enum`: `'color-picker' | 'scrubber' | 'select' | 'toggle' | 'box-model' | 'text-input'`): UI inspector controller component binding.
- `x-surface-formatter` (`string`): Formatter pipe identifier (e.g. `'px'`, `'rem'`, `'hex-color'`).

#### Scoping Precedence & Governance Invariants:
1. **Precedence**: Property-level inline annotations override object-level defaults.
2. **Lint Validation**: `@oa-sdk/parser` and `oa-gen lint --categories surface` verify that any `targetProperty` declared in an object-level `x-surface-*` extension **must exist** as a defined key in the schema's `properties` map.
3. **Format Validation**: `x-surface-fingerprint` must strictly conform to `^sha256:[a-f0-9]{64}$`.

#### Complete Runnable Example with Both Scopes:

```json
{
  "SurfaceParam": {
    "type": "object",
    "required": ["id", "name", "nameRange", "value", "valueRange", "unquotedValue", "unquotedRange", "inferredType"],
    "properties": {
      "id": { "type": "string", "minLength": 1 },
      "name": { "type": "string", "minLength": 1 },
      "nameRange": { "$ref": "#/$defs/CharRange" },
      "value": {
        "type": "string",
        "description": "Formatted CSS parameter value representation",
        "x-surface-quote-style": "double",
        "x-surface-live-patch": true
      },
      "valueRange": { "$ref": "#/$defs/CharRange" },
      "unquotedValue": { "type": "string" },
      "unquotedRange": { "$ref": "#/$defs/CharRange" },
      "inferredType": {
        "type": "string",
        "enum": ["color", "dimension", "typography", "shadow", "spacing", "flex", "keyword", "raw"]
      },
      "colorFormat": {
        "type": "string",
        "enum": ["hex", "rgb", "hsl", "oklch"],
        "x-surface-ui-editor": "color-picker"
      }
    },
    "x-surface-param-range": {
      "targetProperty": "value",
      "supportsLivePatch": true,
      "maxFramerateHz": 120,
      "driftCheckAlgorithm": "sha256"
    },
    "x-surface-patch-policy": {
      "onDrift": "rebase",
      "retryLimit": 3
    },
    "x-surface-fingerprint": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

```typescript
import { z } from 'zod';
import type { SurfaceExtensionFields } from '@oa-sdk/openapi-projection-contract';

// Reusable character range schema
export const CharRangeSchema = z.object({
  start: z.number().int().nonnegative().describe('0-based UTF-16 start offset'),
  end: z.number().int().nonnegative().describe('0-based UTF-16 end offset (exclusive)'),
  length: z.number().int().nonnegative().describe('Character span length'),
});

// Zod Authoring schema for SurfaceParam
export const SurfaceParamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameRange: CharRangeSchema,
  value: z.string().describe('Formatted CSS parameter value representation'),
  valueRange: CharRangeSchema,
  unquotedValue: z.string(),
  unquotedRange: CharRangeSchema,
  inferredType: z.enum(['color', 'dimension', 'typography', 'shadow', 'spacing', 'flex', 'keyword', 'raw']),
  colorFormat: z.enum(['hex', 'rgb', 'hsl', 'oklch']).optional(),
});

export type SurfaceParam = z.infer<typeof SurfaceParamSchema>;

// OpenAPI projection metadata attaching x-surface-* vendor extensions
export const surfaceParamExtensions: SurfaceExtensionFields = {
  'x-surface-param-range': {
    targetProperty: 'value',
    supportsLivePatch: true,
    maxFramerateHz: 120,
  },
  'x-surface-patch-policy': {
    onDrift: 'rebase',
    retryLimit: 3,
  },
  'x-surface-fingerprint': 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};
```

---

### 6.6 Rich JSDoc Metadata & Description Annotations
Every property and schema must declare `.describe()` metadata. This description is preserved across JSON Schema 2020-12, OpenAPI 3.1 docs, and generated TypeScript JSDoc:

```typescript
export const WorkspaceLeaseV1Schema = z.object({
  leaseToken: z.string().uuid().describe('Unique UUIDv4 optimistic concurrency lease token'),
  scope: z.enum(['workspace', 'file']).describe('Granularity of concurrency lock'),
  targetPath: z.string().min(1).describe('Absolute or workspace-relative path locked by lease'),
  acquiredAt: z.number().int().positive().describe('Epoch millisecond timestamp when lease was granted'),
  expiresAt: z.number().int().positive().describe('Epoch millisecond timestamp when lease expires'),
  owner: z.string().min(1).describe('Identifier of the client, agent, or extension holding the lease'),
});
```

---

## 7. Mock Testing Strategy & Headless CI Verification

### 7.1 Headless CI Protocol Simulation
To test DevLink extensions, MCP tools, and session hosts without launching real Chrome browser binaries or spawning desktop host processes, tests leverage `@oa-sdk/mock-server` coupled with protocol framing stream adapters.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                HEADLESS CI TEST RUNNER                                  │
│   • Native RPC Tests (session.hello -> lease.acquire -> materialize.css)                │
│   • MCP Stdio Tool Tests (selection.select -> style.inspect -> commit.style)            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Protocol Framing)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PROTOCOL FRAMING ADAPTERS (packages/devlink-session-host/test/mock)                     │
│   1. NativeMessagingMockStream: Encodes/decodes 4-byte LE length-prefixed JSON buffers  │
│   2. McpStdioMockStream: Encodes/decodes line-delimited JSON-RPC 2.0 frames             │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ (Normalized RequestParts: POST /rpc/...)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ @oa-sdk/mock-server ENGINE (createNodeMockServer / handleRequest)                       │
│   • Validates incoming parameters & body against OpenAPI 3.1 schema (AJV 2020)          │
│   • Evaluates programmatic overrides (server.override('materializeCss', { status: 200 }))│
│   • Generates realistic mock responses matching schema definitions (generateAlgebra)    │
│   • Emits structured 422 / 409 RFC 9457 ProblemDetails errors on invalid test payloads  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Native Host Framing Adapter Example
```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server';
import { Readable, Writable } from 'node:stream';

export class NativeMessagingMockStream {
  public static encodeMessage(obj: unknown): Buffer {
    const json = JSON.stringify(obj);
    const bodyBuf = Buffer.from(json, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(bodyBuf.length, 0);
    return Buffer.concat([headerBuf, bodyBuf]);
  }

  public static decodeMessage(buffer: Buffer): unknown {
    const length = buffer.readUInt32LE(0);
    const body = buffer.subarray(4, 4 + length).toString('utf8');
    return JSON.parse(body);
  }
}
```

### 7.3 Programmatic Scenario Overrides for CI
`@oa-sdk/mock-server` allows CI tests to deterministically simulate error scenarios without complex test fixtures:

```typescript
// Simulate optimistic lease conflict error conforming to RFC 9457
mockServer.override('leaseAcquire', {
  status: 409,
  headers: { 'Content-Type': 'application/problem+json' },
  body: {
    type: 'https://browser-studio.dev/errors/lease-conflict',
    title: 'Lease Conflict',
    status: 409,
    detail: 'Target file is currently locked under lease by agent-session-42',
    instance: '/rpc/lease.acquire#conflict',
    code: 'LEASE_CONFLICT',
    details: {
      lockedUntil: Date.now() + 30000,
      currentOwner: 'agent-session-42',
    },
  },
});
```

### 7.4 The 5-Tier CI Verification Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Schema Projection & Dialect Conformance                                         │
│   Command: pnpm exec oa-gen validate                                                    │
│   Assert: All Zod schemas project to JSON Schema 2020-12 and OpenAPI 3.1 with 0 errors. │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: OA-SDK Specification Governance & Linting                                       │
│   Command: pnpm exec oa-gen lint --spec <spec> --categories surface,structure,operations│
│   Assert: Zero structural, parameter, reference, surface, or meta-schema violations.    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: Pre-Compiled Type Guard Integrity & Modular Split                               │
│   Command: pnpm exec oa-gen generate && pnpm test:guards                                │
│   Assert: Split ESM type guards reject invalid fixtures and narrow valid types.         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: Headless Native RPC & MCP CI Mock Suite                                         │
│   Command: pnpm --filter @browser-studio/devlink-session-host test:mock                 │
│   Assert: Full 17-method RPC and 14-operation MCP workflows complete in <500ms.         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 5: Extension Bundle Decoupling & CSP Audit                                         │
│   Command: pnpm exec oa-gen audit:csp --bundle dist/extension                           │
│   Assert: 0 bytes @oa-sdk/ajv/zod runtime weight; 0 eval / new Function calls.          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Developer Workflow & CLI Reference

### 8.0 Declarative Specification Management (`oa.config.ts`)

Browser Studio 및 OA SDK 모노레포는 선언적 스펙 설정 파일인 `oa.config.ts`를 통해 루트 자동 탐색, 다중 프로파일 일괄 프로젝션, 스펙 드리프트 감지, CSP 감사를 자동화합니다. 상세 내용은 [선언적 사양 설정 가이드](./declarative-spec-configuration.md)를 참조하십시오.

#### Complete Declarative Configuration Example:

```typescript
// oa.config.ts
import { defineConfig } from '@oa-sdk/codegen';

export default defineConfig({
  rootDir: '.',
  specs: [
    {
      id: 'surface-engine',
      profile: 'component-bundle',
      schemaEntry: 'packages/surface-engine/src/types/schemas.ts',
      outDir: 'artifacts/specs',
      title: 'Surface Engine Component Bundle',
      version: '1.0.0',
    },
    {
      id: 'devlink-contracts',
      profile: 'operation-contract',
      schemaEntry: 'packages/devlink-contracts/src/index.ts',
      outDir: 'artifacts/specs',
      title: 'DevLink Native RPC Operation Contract',
      version: '1.0.0',
    },
    {
      id: 'gateway-api',
      profile: 'full-api-document',
      schemaEntry: 'packages/gateway/src/schema/index.ts',
      outDir: 'artifacts/specs',
      title: 'Browser Studio Gateway REST API',
      version: '1.0.0',
    },
  ],
  guards: {
    outDir: 'dist/guards',
    split: true,
    moduleFormat: 'esm',
    auditCsp: true,
  },
});
```

#### Unified CLI Commands:
```bash
# 1. 선언된 모든 프로파일 일괄 유효성 검증 (하위 패키지 어디서나 실행 가능)
pnpm exec oa-gen validate

# 2. 선언된 모든 스펙 및 독립형 타입 가드 일괄 생성
pnpm exec oa-gen generate

# 3. TypeScript 클라이언트 및 타입 정의 생성
pnpm exec oa-gen typegen

# 4. 소스 Zod AST와 아티팩트 간 결정론적 해시 드리프트 검증 (CI 게이트)
pnpm exec oa-gen drift:check

# 5. Manifest V3 CSP 준수 여부 정적 보안 감사
pnpm exec oa-gen audit:csp --bundle dist/guards

# 6. 하위 호환성 파괴 변경 감지
pnpm exec oa-gen diff --base <old.json> --head <new.json> --fail-on-breaking
```

### 8.1 Declarative Specification Workflow (`oa.config.ts` & `oa-gen`)

The declarative specification engine in `@oa-sdk/codegen` converts domain schemas into specifications and type guards driven by `oa.config.ts`.

#### CLI Command Usage:
```bash
# Export all OpenAPI specifications, JSON Schemas, and AJV standalone type guards
pnpm exec oa-gen generate

# Validate all configured spec targets against profile rules
pnpm exec oa-gen validate

# Explicitly scope execution using project root override
pnpm exec oa-gen generate --root /path/to/project-root
```

#### Declarative Configuration Fields & CLI Options:
| Configuration Key / CLI Flag | Type | Default | Description |
|---|---|---|---|
| `rootDir` / `--root <dir>` | `string` | `findProjectRoot()` | Base directory for relative path resolution across nested packages. |
| `specs[].id` | `string` | *(required)* | Unique target identifier within `specs` array. |
| `specs[].profile` | `enum` | *(required)* | Projection profile: `'component-bundle'`, `'operation-contract'`, `'full-api-document'`. |
| `specs[].schemaEntry` | `string` | *(required)* | Path to Zod master schema entry point module. |
| `specs[].outDir` | `string` | *(required)* | Destination directory for OpenAPI & JSON Schema specification artifacts. |
| `guards.outDir` | `string` | `'dist/guards'` | Output directory for pre-compiled standalone AJV type guards. |
| `guards.split` | `boolean` | `true` | Split modular guard files (`guards/<Name>.js`, `guards/<Name>.d.ts`) alongside `index.js`. |
| `guards.moduleFormat` | `enum` | `'esm'` | Target module format: `'esm'` or `'cjs'`. |
| `guards.auditCsp` | `boolean` | `true` | Automatically run Manifest V3 CSP static AST audit on emitted guards. |

### 8.2 Adding or Modifying a Domain Schema (Step-by-Step)
When introducing a new data model or RPC method to Browser Studio:

1. **Define Master Schema**:
   Add the schema in the appropriate domain package (`packages/devlink-contracts`, `packages/surface-engine`, etc.) using Zod. Use `.describe()` annotations and strict numeric bounds (`.min(0)` vs `.positive()`).
2. **Export Schema & Type**:
   Export both `<Name>Schema` and `export type <Name> = z.infer<typeof <Name>Schema>`.
3. **Register in `oa.config.ts`**:
   Ensure the schema entry module is declared under `specs` in `oa.config.ts` with the appropriate profile (`component-bundle`, `operation-contract`, or `full-api-document`).
4. **Execute Projection Pipeline**:
   ```bash
   pnpm exec oa-gen validate
   pnpm exec oa-gen generate
   ```
5. **Verify Standalone Type Guards**:
   Verify that `dist/guards/guards/<name>.js` and `dist/guards/guards/<name>.d.ts` are generated without compiler warnings.
6. **Execute Monorepo Tests**:
   ```bash
   pnpm test
   pnpm -r typecheck
   ```

### 8.3 Troubleshooting Common Schema Errors

| Error Symptom | Root Cause | Resolution |
|---|---|---|
| `exclusiveMinimum must be number` | Zod schema used `.positive()` or `.min()` in legacy OpenAPI 3.0 mode (emitting boolean `exclusiveMinimum: true`). | Ensure `targetDialect: '2020-12'` is passed to the converter so numeric `exclusiveMinimum: 0` is emitted. |
| `Unresolved reference #/$defs/X` | OpenAPI 3.1 document references `#/$defs/X` instead of `#/components/schemas/X`. | Ensure spec projector re-maps all internal reference pointers using `remapRefsToOpenApi` to `#/components/schemas/<Name>`. |
| `Circular reference stack overflow` | Recursive schema with `z.lazy` was projected without registering in schema registry `refs` map. | Register the recursive schema instance in `refs` map before projection so cycle-breaking `$ref` is emitted. |
| `targetProperty "foo" not found` | Object-level `x-surface-param-range` specified `targetProperty: "foo"`, but `"foo"` is not in `properties`. | Add `"foo"` to `properties` or correct `targetProperty` name to match an existing property. |
| `Invalid ProblemDetails status` | Error response status code was outside the range $100 \le \text{status} \le 599$. | Ensure HTTP status is a valid 3-digit integer (e.g. 422, 409, 500). |
| `Uncaught EvalError: Refused to evaluate a string as JavaScript` | Browser extension bundle accidentally imported runtime `ajv` or `zod` schema validator. | Replace runtime schema validator with pre-compiled standalone type guard (`import { is<Name> } from '.../dist/guards/...'`). |
| `operationId must be unique` | Duplicate `operationId` across OpenAPI path operations. | Ensure each Native RPC (`sessionHello`, `materializeCss`) and MCP operation (`mcpSessionStatus`) has a unique identifier. |

---

## 9. Normative Reference Matrix & Verification Checklist

Before submitting schema changes or pull requests, verify compliance against this normative checklist:

- [ ] **SSOT**: Master schema is authored in Zod with static `z.infer` TypeScript type.
- [ ] **RFC 9457**: Error responses use `ProblemDetailsSchema` with `application/problem+json` Content-Type for 422, 409, 500.
- [ ] **Numeric Bounds**: $x \ge 0$ authored as `minimum: 0` (`.nonnegative()`); $x > 0$ authored as `exclusiveMinimum: 0` (`.positive()`).
- [ ] **Recursive Trees**: Authored using `z.ZodType<T> = z.lazy(...)` with explicit interface and registered in registry `refs`.
- [ ] **Surface Scope**: Object-level `x-surface-*` specifies valid `targetProperty`; property-level overrides are correctly scoped.
- [ ] **V3 JSDoc Tags**: TypeScript interfaces use canonical validation tags (`@minimum`, `@format`, `@discriminator`).
- [ ] **Zero Eval**: Standalone guards build with 0 `eval()`, 0 `new Function()`, and passes `oa-gen audit:csp`.
- [ ] **Clean Pipeline**: `pnpm test`, `pnpm -r typecheck`, and `pnpm exec oa-gen validate` exit with code 0.

---

## 10. Conclusion

By adhering strictly to the **4-Stage Schema Pipeline**, preserving **Zod as the Single Source of Truth**, standardizing on **RFC 9457 Problem Details**, and enforcing **Zero-Runtime-Weight Bundle Decoupling**, Browser Studio achieves enterprise-grade specification governance through `@oa-sdk/*` while delivering sub-millisecond 60fps performance and 100% Manifest V3 CSP compliance in browser extensions.
