import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import type { SharedContextHarnessPort } from '../contracts/ports.js'
import {
  validateCollaborationManifest,
  validateManagementProjection,
} from '../validator/context-harness-validator.js'
import type { CollaborationManagementProjection } from '../contracts/types.js'

export const QueryManagementInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    collaborationId: {
      type: 'string',
      description: 'The unique collaboration identifier (e.g. collab-context-harness)',
      pattern: '^collab-[a-z0-9]+(-[a-z0-9]+)*$',
    },
    actorId: {
      type: 'string',
      description: 'The authenticated actor querying workstream management',
      minLength: 1,
    },
  },
  required: ['collaborationId', 'actorId'],
  additionalProperties: false,
}

export type QueryManagementOutput =
  | {
      status: 'ready'
      collaborationId: string
      management: CollaborationManagementProjection
    }
  | { status: 'unavailable' }

export function createQueryManagementTool(port: SharedContextHarnessPort) {
  return createSchemaTool<
    { collaborationId: string; actorId: string },
    QueryManagementOutput
  >({
    name: 'collab_query_management',
    description: 'Query collaboration workstream, milestone, and verification status projection in read-only mode.',
    category: 'collaboration',
    schema: QueryManagementInputSchema,
    execute: async (_ctx, input) => {
      const { collaborationId, actorId } = input
      const unavailable: QueryManagementOutput = { status: 'unavailable' }

      // Fail closed: a thrown provider error is concealed as `unavailable`.
      try {
        const manifest = await port.readCollaboration(collaborationId)
        if (!manifest) return unavailable

        const manifestCheck = validateCollaborationManifest(manifest)
        if (!manifestCheck.ok) return unavailable

        const canRead = await port.canReadCollaboration(actorId, manifest)
        if (!canRead) return unavailable

        const management = await port.readManagementProjection(collaborationId)
        if (!management) return unavailable

        const managementCheck = validateManagementProjection(management)
        if (!managementCheck.ok) return unavailable

        return {
          status: 'ready',
          collaborationId,
          management,
        }
      } catch {
        return unavailable
      }
    },
  })
}
