export const namespace = 'OaSdkTypeSpec'

// ── Persona Capability Traits (from packages/personas/src/traits/skill.yaml) ──
export const VALID_PERSONA_TRAITS: ReadonlySet<string> = new Set([
  // request-shape (5)
  'pagination',
  'filter-by-role',
  'filter-by-status',
  'full-text-search',
  'batch',
  // response-shape (3)
  'sse-stream',
  'etag-supported',
  'partial-response',
  // lifecycle (3)
  'idempotent',
  'retryable',
  'cacheable',
  // observability (3)
  'audit-emission',
  'metrics-emission',
  'trace-context',
  // security (5)
  'pii-visible-admin',
  'pii-masked-default',
  'pseudonymized',
  'signed-response',
  'mtls',
  // integration (5)
  'webhook-source',
  'webhook-target',
  'oauth-scope-aware',
  'rate-limit-honored',
  'idempotency-key-required',
])

// ── DPM Transforms & Roles (from packages/dpm schema & safety validators) ─────
export const VALID_DPM_TRANSFORMS: ReadonlySet<string> = new Set([
  'keep',
  'redact',
  'mask',
  'null',
  'hash',
  'generalize',
  'relationship_token',
  'polymorphic_relationship_token',
])

export const VALID_DPM_ROLES: ReadonlySet<string> = new Set([
  'direct_identifier',
  'foreign_identifier',
  'business_identifier',
  'business_metric',
  'unstructured_text',
  'code_lookup',
])

// ── CRDT Semantic Types, Resolutions & Engines ──────────────────────────────
export const VALID_CRDT_TYPES: ReadonlySet<string> = new Set([
  'lww-register',
  'pn-counter',
  'or-set',
  'text-sequence',
  'flag',
])

export const VALID_CRDT_RESOLUTIONS: ReadonlySet<string> = new Set([
  'last-write-wins',
  'vector-clock',
  'multi-value',
  'timestamp-desc',
  'timestamp-asc',
])

export const VALID_CRDT_ENGINES: ReadonlySet<string> = new Set([
  'fugue',
  'yata',
  'y-text',
  'automerge',
  'lww',
])

export const VALID_CRDT_ROLES: ReadonlySet<string> = new Set([
  'tombstone',
  'actor',
  'timestamp',
  'value',
])

export const VALID_CRDT_COMPACTIONS: ReadonlySet<string> = new Set([
  'checkpoint-squash',
  'none',
  'tombstone-gc',
])

// ── Wire Compression & Protobuf / RPC ────────────────────────────────────────
export const VALID_WIRE_FORMATS: ReadonlySet<string> = new Set([
  'protobuf',
  'msgpack',
  'json',
  'raw-binary',
])

export const VALID_RPC_STREAMING: ReadonlySet<string> = new Set([
  'none',
  'client',
  'server',
  'bidirectional',
])

export const VALID_PROTOBUF_SCALAR_TYPES: ReadonlySet<string> = new Set([
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'float',
  'double',
  'bool',
  'string',
  'bytes',
])

export const PROTOBUF_EXTENSION = 'x-oa-sdk-protobuf'
export const PROTOBUF_FIELD_EXTENSION = 'x-oa-sdk-protobuf-field'
export const RPC_EXTENSION = 'x-oa-sdk-rpc'
export const WIRE_FORMAT_EXTENSION = 'x-oa-sdk-wire-format'

// ── Chunk Stream Transmission & Memory Presets ──────────────────────────────
export const CHUNK_STREAM_EXTENSION = 'x-oa-sdk-chunk-stream'

export const CHUNK_STREAM_PRESET_BYTES: Readonly<Record<string, number>> = {
  'ultra-low-latency': 1460,
  'optimal-web': 7168,
  'standard-buffer': 8192,
  'initcwnd-burst': 14336,
  'large-payload': 65536,
  'heavy-media': 262144,
  'bulk-data': 1048576,
}

export const VALID_CHUNK_STREAM_PRESETS: ReadonlySet<string> = new Set(
  Object.keys(CHUNK_STREAM_PRESET_BYTES),
)

export const CHUNK_MEMORY_PRESET_BYTES: Readonly<Record<string, number>> = {
  mobile: 64 * 1024 * 1024,
  standard: 128 * 1024 * 1024,
  highperf: 256 * 1024 * 1024,
}

export const VALID_CHUNK_MEMORY_PRESETS: ReadonlySet<string> = new Set(
  Object.keys(CHUNK_MEMORY_PRESET_BYTES),
)

export const VALID_CHUNK_STREAM_MODES: ReadonlySet<string> = new Set([
  'adaptive',
  'eager',
  'manual',
])

// ── Specification Traceability & Lineage (`@traceId`, `@replaces`, `@requirement`, `@evidence`, `@intent`, `@derivedFrom`) ──
export const TRACE_EXTENSION = 'x-oa-sdk-trace'
export const EVIDENCE_EXTENSION = 'x-oa-sdk-evidence'
export const INTENT_EXTENSION = 'x-oa-sdk-intent'
export const DERIVED_FROM_EXTENSION = 'x-oa-sdk-derived-from'
export const VALID_TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
export const VALID_REPLACES_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,255}$/
export const VALID_REQUIREMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/
export const VALID_INTENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
export const VALID_DOC_ANCHOR_PATTERN = /^[^\s#]+(?:#[^\s#]+)?$/

// ── CLI-Anything × mcp-use Tool Pipeline Decorator Set (`@toolGroup`, `@pipeline*`, `@oaTool`, `@positional`, `@cliFlag`, `@mcpSurface`, `@tableAdapter`) ──
export const TOOL_EXTENSION = 'x-oa-sdk-tool'
export const TOOL_GROUP_EXTENSION = 'x-oa-sdk-tool-group'
export const RESERVED_MCP_INTERFACES_EXTENSION = 'x-oa-sdk-reserved-interfaces'
export const POSITIONAL_EXTENSION = 'x-oa-sdk-positional'
export const CLI_FLAG_EXTENSION = 'x-oa-sdk-cli-flag'
export const MCP_SURFACE_EXTENSION = 'x-oa-sdk-mcp-surface'
export const TABLE_ADAPTER_EXTENSION = 'x-oa-sdk-table-adapter'

export const VALID_TOOL_IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/

export const VALID_PIPELINE_STAGES: ReadonlySet<string> = new Set([
  'inspect',
  'plan',
  'apply',
  'destructive',
  'verify',
  'handoff',
  'custom',
])

export const VALID_EXECUTION_MODELS: ReadonlySet<string> = new Set([
  'single-phase',
  'plan-only',
  'two-phase-commit',
  'two-phase-elicit-commit',
  'verification-gate',
  'handoff-bridge',
])

export const VALID_SESSION_LOCKS: ReadonlySet<string> = new Set([
  'none',
  'shared-read',
  'exclusive-file',
])

export const VALID_RESERVED_MCP_INTERFACES: ReadonlySet<string> = new Set([
  'session',
  'dry-run-elicit',
  'preview-bundle',
  'handoff-envelope',
  'sep-2640-skills',
])

export const VALID_MCP_VISIBILITIES: ReadonlySet<string> = new Set([
  'model',
  'app',
])

export const VALID_TABLE_ADAPTER_KINDS: ReadonlySet<string> = new Set([
  'calc',
  'writer',
  'impress',
  'markdown',
  'tabular-ops',
  'visual-dom',
])

export interface PipelineStagePresetConfig {
  readonly stage: string
  readonly readOnly: boolean
  readonly destructive: boolean
  readonly idempotent: boolean
  readonly openWorld: boolean
  readonly dryRunSupport: boolean
  readonly sessionLock: string
  readonly undoSnapshot: boolean
  readonly executionModel: string
  readonly requiresPreviewBundle: boolean
  readonly requiresHandoffEnvelope: boolean
}

export const PIPELINE_STAGE_PRESETS: Readonly<Record<string, PipelineStagePresetConfig>> = {
  inspect: {
    stage: 'inspect',
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: false,
    sessionLock: 'none',
    undoSnapshot: false,
    executionModel: 'single-phase',
    requiresPreviewBundle: false,
    requiresHandoffEnvelope: false,
  },
  plan: {
    stage: 'plan',
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: true,
    sessionLock: 'shared-read',
    undoSnapshot: false,
    executionModel: 'plan-only',
    requiresPreviewBundle: true,
    requiresHandoffEnvelope: false,
  },
  apply: {
    stage: 'apply',
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: true,
    sessionLock: 'exclusive-file',
    undoSnapshot: true,
    executionModel: 'two-phase-commit',
    requiresPreviewBundle: true,
    requiresHandoffEnvelope: false,
  },
  destructive: {
    stage: 'destructive',
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
    dryRunSupport: true,
    sessionLock: 'exclusive-file',
    undoSnapshot: true,
    executionModel: 'two-phase-elicit-commit',
    requiresPreviewBundle: true,
    requiresHandoffEnvelope: false,
  },
  verify: {
    stage: 'verify',
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: false,
    sessionLock: 'shared-read',
    undoSnapshot: false,
    executionModel: 'verification-gate',
    requiresPreviewBundle: false,
    requiresHandoffEnvelope: false,
  },
  handoff: {
    stage: 'handoff',
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: false,
    sessionLock: 'shared-read',
    undoSnapshot: false,
    executionModel: 'handoff-bridge',
    requiresPreviewBundle: true,
    requiresHandoffEnvelope: true,
  },
  custom: {
    stage: 'custom',
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
    dryRunSupport: false,
    sessionLock: 'none',
    undoSnapshot: false,
    executionModel: 'single-phase',
    requiresPreviewBundle: false,
    requiresHandoffEnvelope: false,
  },
}

