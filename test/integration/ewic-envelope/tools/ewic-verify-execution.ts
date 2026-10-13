import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import type { EwicEnvelopePort } from '../contracts/ports.js'
import type {
  ExecutionContent,
  ExecutionSnapshotVerificationResult,
} from '../contracts/ewic-types.js'
import { verifyExecutionSnapshot } from '../validator/ewic-validator.js'

export const VerifyExecutionInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    actorId: {
      type: 'string',
      description: 'The authenticated actor requesting verification',
    },
    execution: {
      type: 'object',
      properties: {
        workflowRef: { type: 'string' },
        resolvedRefs: { type: 'object' },
        inputDigest: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['workflowRef', 'resolvedRefs', 'inputDigest', 'status'],
    },
  },
  required: ['actorId', 'execution'],
  additionalProperties: false,
}

export function createVerifyExecutionTool(port: EwicEnvelopePort) {
  return createSchemaTool<
    { actorId: string; execution: ExecutionContent },
    ExecutionSnapshotVerificationResult
  >({
    name: 'ewic_verify_execution',
    description: 'Verify execution snapshot reproducibility by checking pinned workflowRef and resolvedRefs against the trusted provider boundary.',
    category: 'ewic',
    schema: VerifyExecutionInputSchema,
    execute: async (_ctx, input) => {
      const { actorId, execution } = input

      // Verify each referenced entity
      const resolvers: Record<string, { snapshotId: string; contentHash: string }> = {}

      for (const [uri, pinned] of Object.entries(execution.resolvedRefs)) {
        try {
          const snapshotCheck = await port.verifySnapshot(uri, pinned.contentHash, pinned.snapshotId)
          if (!snapshotCheck.match) {
            return {
              status: 'stale',
              reason: `Snapshot for ${uri} has drifted from pinned execution record.`,
              driftedRefs: [
                {
                  refUri: uri,
                  expectedHash: pinned.contentHash,
                  actualHash: snapshotCheck.currentHash,
                },
              ],
            }
          }
          resolvers[uri] = {
            snapshotId: snapshotCheck.currentSnapshotId ?? pinned.snapshotId,
            contentHash: snapshotCheck.currentHash,
          }
        } catch {
          // Conceal provider exceptions as unavailable
          return { status: 'unavailable' }
        }
      }

      return verifyExecutionSnapshot(execution, resolvers)
    },
  })
}
