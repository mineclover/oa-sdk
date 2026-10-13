import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createJsonSchemaValidator } from '@oa-sdk/tools'
import type {
  EntitySourceEnvelope,
  EntityDerivedEnvelope,
  ColabRunPacket,
  ExecutionContent,
  ExecutionSnapshotVerificationResult,
} from '../contracts/ewic-types.js'
import { computeEnvelopeContentHash } from '../canonical/canonical-json.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const schemaDir = join(__dirname, '../schema/json-schema')

function loadSchema(name: string) {
  return JSON.parse(readFileSync(join(schemaDir, name), 'utf-8'))
}

const sourceEnvelopeSchema = loadSchema('entity-source.schema.json')
const derivedEnvelopeSchema = loadSchema('entity-derived.schema.json')
const colabRunPacketSchema = loadSchema('colab-run-packet.schema.json')

const sourceValidator = createJsonSchemaValidator<EntitySourceEnvelope>(sourceEnvelopeSchema)
const derivedValidator = createJsonSchemaValidator<EntityDerivedEnvelope>(derivedEnvelopeSchema)
const colabValidator = createJsonSchemaValidator<ColabRunPacket>(colabRunPacketSchema)

export interface ValidationOutput<T> {
  ok: boolean
  value?: T
  issues: string[]
}

/**
 * Validate an EntitySourceEnvelope against JSON Schema Draft 2020-12
 * and EWIC identity invariants.
 */
export function validateEntitySourceEnvelope(value: unknown): ValidationOutput<EntitySourceEnvelope> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['ENVELOPE_NOT_AN_OBJECT'] }
  }

  const result = sourceValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  const env = value as Partial<EntitySourceEnvelope>

  // Invariant 1: revisionId must match `${id}@${revision}`
  if (env.identity) {
    const expectedRevisionId = `${env.identity.id}@${env.identity.revision}`
    if (env.identity.revisionId !== expectedRevisionId) {
      issues.push(`REVISION_ID_MISMATCH: expected ${expectedRevisionId}, got ${env.identity.revisionId}`)
    }

    // Invariant 2: kind must be one of the 6 canonical kinds
    const validKinds = new Set(['spec', 'framework', 'resource', 'workflow', 'execution', 'evidence'])
    if (!validKinds.has(env.identity.kind)) {
      issues.push(`INVALID_ENTITY_KIND: ${env.identity.kind}`)
    }
  }

  // Invariant 3: Provenance SSOT must have non-empty path
  if (env.provenance?.ssot) {
    if (!env.provenance.ssot.path || env.provenance.ssot.path.trim().length === 0) {
      issues.push('SSOT_PATH_EMPTY')
    }
  }

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? (value as EntitySourceEnvelope) : undefined,
    issues,
  }
}

/**
 * Validate an EntityDerivedEnvelope against JSON Schema Draft 2020-12.
 */
export function validateEntityDerivedEnvelope(value: unknown): ValidationOutput<EntityDerivedEnvelope> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['DERIVED_ENVELOPE_NOT_AN_OBJECT'] }
  }

  const result = derivedValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? (value as EntityDerivedEnvelope) : undefined,
    issues,
  }
}

/**
 * Validate a ColabRunPacket against JSON Schema Draft 2020-12.
 */
export function validateColabRunPacket(value: unknown): ValidationOutput<ColabRunPacket> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['COLAB_RUN_PACKET_NOT_AN_OBJECT'] }
  }

  const result = colabValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  return {
    ok: issues.length === 0,
    value: issues.length === 0 ? (value as ColabRunPacket) : undefined,
    issues,
  }
}

/**
 * Verify RFC 8785 canonical digest readback for an EntitySourceEnvelope.
 */
export function verifyCanonicalDigest(envelope: EntitySourceEnvelope): {
  valid: boolean
  calculated: string
  declared: string
} {
  const calculated = computeEnvelopeContentHash({ content: envelope.content })
  const declared = envelope.identity.contentHash
  return {
    valid: calculated === declared,
    calculated,
    declared,
  }
}

/**
 * Verify snapshot reproducibility for an execution envelope.
 * Compares pinned workflowRef and resolvedRefs snapshots against currently resolved states.
 */
export function verifyExecutionSnapshot(
  execution: ExecutionContent,
  currentResolvers: Record<string, { snapshotId: string; contentHash: string }>
): ExecutionSnapshotVerificationResult {
  const driftedRefs: Array<{
    refUri: string
    expectedHash: string
    actualHash: string
  }> = []

  for (const [refUri, pinned] of Object.entries(execution.resolvedRefs)) {
    const current = currentResolvers[refUri]
    if (!current) {
      return { status: 'unavailable' }
    }
    if (current.contentHash !== pinned.contentHash || current.snapshotId !== pinned.snapshotId) {
      driftedRefs.push({
        refUri,
        expectedHash: pinned.contentHash,
        actualHash: current.contentHash,
      })
    }
  }

  if (driftedRefs.length > 0) {
    return {
      status: 'stale',
      reason: `Snapshot drift detected in ${driftedRefs.length} referenced entity snapshots.`,
      driftedRefs,
    }
  }

  return {
    status: 'reproducible',
    workflowRef: execution.workflowRef,
    resolvedCount: Object.keys(execution.resolvedRefs).length,
  }
}

/**
 * Verify that unknown / custom fields are preserved through an adapter round-trip.
 */
export function verifyUnknownFieldsPreservation(
  original: Record<string, unknown>,
  roundTripped: Record<string, unknown>,
  checkKeys?: string[]
): { lossless: boolean; differences: string[] } {
  const differences: string[] = []
  const keysToCheck = checkKeys ?? Object.keys(original)

  for (const key of keysToCheck) {
    if (!(key in roundTripped)) {
      differences.push(`Missing key: ${key}`)
    } else if (JSON.stringify(original[key]) !== JSON.stringify(roundTripped[key])) {
      differences.push(
        `Value mismatch for ${key}: expected ${JSON.stringify(original[key])}, got ${JSON.stringify(
          roundTripped[key]
        )}`
      )
    }
  }

  return {
    lossless: differences.length === 0,
    differences,
  }
}
