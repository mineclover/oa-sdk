import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import {
  validateEntitySourceEnvelope,
  validateEntityDerivedEnvelope,
  validateColabRunPacket,
  verifyCanonicalDigest,
} from '../validator/ewic-validator.js'
import type { EntitySourceEnvelope, EntityDerivedEnvelope, ColabRunPacket } from '../contracts/ewic-types.js'

export const ValidateEnvelopeInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['source', 'derived', 'colab-run'],
      description: 'The type of envelope or packet to validate',
    },
    envelope: {
      type: 'object',
      description: 'The raw JSON envelope payload',
    },
  },
  required: ['type', 'envelope'],
  additionalProperties: false,
}

export interface ValidateEnvelopeResult {
  valid: boolean
  issues?: string[]
  digestVerification?: {
    valid: boolean
    calculated: string
    declared: string
  }
}

export function createValidateEnvelopeTool() {
  return createSchemaTool<
    { type: 'source' | 'derived' | 'colab-run'; envelope: Record<string, unknown> },
    ValidateEnvelopeResult
  >({
    name: 'ewic_validate_envelope',
    description: 'Validate an EWIC source envelope, derived envelope, or Colab run packet against Draft 2020-12 and canonical digest invariants.',
    category: 'ewic',
    schema: ValidateEnvelopeInputSchema,
    execute: async (_ctx, input) => {
      const { type, envelope } = input

      if (type === 'source') {
        const validation = validateEntitySourceEnvelope(envelope)
        if (!validation.ok) {
          return { valid: false, issues: validation.issues }
        }
        let digestCheck: ReturnType<typeof verifyCanonicalDigest>
        try {
          digestCheck = verifyCanonicalDigest(envelope as unknown as EntitySourceEnvelope)
        } catch (error) {
          // Content with no RFC 8785 form (e.g. a lone surrogate) cannot carry a valid digest.
          if (error instanceof TypeError) {
            return { valid: false, issues: ['CONTENT_NOT_CANONICAL_JSON'] }
          }
          throw error
        }
        return {
          valid: digestCheck.valid,
          issues: digestCheck.valid ? undefined : ['CANONICAL_DIGEST_MISMATCH'],
          digestVerification: digestCheck,
        }
      }

      if (type === 'derived') {
        const validation = validateEntityDerivedEnvelope(envelope)
        return {
          valid: validation.ok,
          issues: validation.ok ? undefined : validation.issues,
        }
      }

      if (type === 'colab-run') {
        const validation = validateColabRunPacket(envelope)
        return {
          valid: validation.ok,
          issues: validation.ok ? undefined : validation.issues,
        }
      }

      return { valid: false, issues: ['UNKNOWN_TYPE'] }
    },
  })
}
