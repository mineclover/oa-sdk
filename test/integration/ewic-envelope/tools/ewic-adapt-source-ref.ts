import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import { SourceReferenceAdapter } from '../adapters/source-reference-adapter.js'
import type { SourceReference } from '../../shared-context-harness/contracts/types.js'
import type { EntitySourceEnvelope, ResourceContent } from '../contracts/ewic-types.js'

export const AdaptSourceRefInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    direction: {
      type: 'string',
      enum: ['ref-to-envelope', 'envelope-to-ref'],
      description: 'Direction of adapter transformation',
    },
    payload: {
      type: 'object',
      description: 'Input SourceReference or EntitySourceEnvelope payload',
    },
    options: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        parentChain: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: true,
    },
  },
  required: ['direction', 'payload'],
  additionalProperties: false,
}

export interface AdaptSourceRefResult {
  status: 'success' | 'failed'
  result?: Record<string, unknown>
  error?: string
}

export function createAdaptSourceRefTool() {
  return createSchemaTool<
    {
      direction: 'ref-to-envelope' | 'envelope-to-ref'
      payload: Record<string, unknown>
      options?: { fileId?: string; parentChain?: string[] }
    },
    AdaptSourceRefResult
  >({
    name: 'ewic_adapt_source_reference',
    description: 'Transform between Shared Context SourceReference and EWIC Resource EntitySourceEnvelope preserving Drive fileId/locator/parentChain and unknown fields.',
    category: 'ewic',
    schema: AdaptSourceRefInputSchema,
    execute: async (_ctx, input) => {
      const { direction, payload, options } = input

      try {
        if (direction === 'ref-to-envelope') {
          const envelope = SourceReferenceAdapter.toResourceEnvelope(
            payload as unknown as SourceReference,
            undefined,
            options
          )
          return { status: 'success', result: envelope as unknown as Record<string, unknown> }
        }

        if (direction === 'envelope-to-ref') {
          const ref = SourceReferenceAdapter.fromResourceEnvelope(
            payload as unknown as EntitySourceEnvelope<ResourceContent>
          )
          return { status: 'success', result: ref as unknown as Record<string, unknown> }
        }

        return { status: 'failed', error: 'INVALID_DIRECTION' }
      } catch (err: unknown) {
        return {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  })
}
