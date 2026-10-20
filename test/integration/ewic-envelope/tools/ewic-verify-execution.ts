import { createSchemaTool, type ToolContext } from '../../../../packages/tools/src/index.js'
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
      description: 'The authenticated actor requesting verification (must match a transport-bound ctx.meta.actorId when one is present)',
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

/**
 * The actor to authorize. A transport that authenticates callers binds the
 * identity into `ctx.meta.actorId`; that binding wins, and an input `actorId`
 * that contradicts it is treated as a spoofing attempt (`undefined` -> deny).
 * Without a transport binding the input `actorId` is used as-is, so a host that
 * exposes this tool must bind `ctx.meta.actorId` for the ACL check to be trusted.
 */
function resolveActorId(ctx: ToolContext, inputActorId: string): string | undefined {
  const bound = ctx.meta?.['actorId']
  if (typeof bound !== 'string') return inputActorId
  return bound === inputActorId ? bound : undefined
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
    execute: async (ctx, input) => {
      const { execution } = input
      const unavailable: ExecutionSnapshotVerificationResult = { status: 'unavailable' }

      const actorId = resolveActorId(ctx, input.actorId)
      if (actorId === undefined) return unavailable

      try {
        // 1. Authorize before any verification: the actor must be allowed to read
        //    the workflow and every pinned envelope. Deny and not-found share one
        //    response, and no current hash is computed or returned for a denied actor.
        for (const uri of [execution.workflowRef, ...Object.keys(execution.resolvedRefs)]) {
          const envelope = await port.readSourceEnvelope(uri)
          if (!envelope) return unavailable
          if (!(await port.canReadEnvelope(actorId, envelope))) return unavailable
        }

        // 2. Verify each referenced entity snapshot against its pinned state
        const resolvers: Record<string, { snapshotId: string; contentHash: string }> = {}

        for (const [uri, pinned] of Object.entries(execution.resolvedRefs)) {
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
        }

        return verifyExecutionSnapshot(execution, resolvers)
      } catch {
        // Conceal provider exceptions (ACL, read and verification failures) as unavailable
        return unavailable
      }
    },
  })
}
