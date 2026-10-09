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

