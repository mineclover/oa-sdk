import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import type { SharedContextHarnessPort } from '../contracts/ports.js'
import {
  validateCollaborationManifest,
  validateReferenceIndex,
} from '../validator/context-harness-validator.js'
import type { CollaborationBootstrapResult } from '../contracts/types.js'

export const BootstrapInputSchema = {
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
      description: 'The authenticated actor requesting bootstrap',
      minLength: 1,
    },
  },
  required: ['collaborationId', 'actorId'],
  additionalProperties: false,
}

export function createBootstrapTool(port: SharedContextHarnessPort) {
  return createSchemaTool<
    { collaborationId: string; actorId: string },
    CollaborationBootstrapResult
  >({
    name: 'collab_bootstrap',
    description: 'Bootstrap collaboration context by loading and validating the collaboration manifest and reference index in read-only mode.',
    category: 'collaboration',
    schema: BootstrapInputSchema,
    execute: async (_ctx, input) => {
      const { collaborationId, actorId } = input
      const manifest = await port.readCollaboration(collaborationId)
      if (!manifest) {
        return { status: 'unavailable', collaborationId }
      }

      const manifestValidation = validateCollaborationManifest(manifest)
      if (!manifestValidation.ok) {
        return { status: 'unavailable', collaborationId }
      }

      let canRead = false
      try {
        canRead = await port.canReadCollaboration(actorId, manifest)
      } catch {
        return { status: 'unavailable', collaborationId }
      }

      if (!canRead) {
        return { status: 'unavailable', collaborationId }
      }

      const refIndex = await port.readReferenceIndex(collaborationId)
      let references = []
      if (refIndex) {
        const indexValidation = validateReferenceIndex(refIndex)
        if (indexValidation.ok) {
          references = refIndex.references
        }
      }

      return {
        status: 'ready',
        collaborationId: manifest.collaborationId,
        title: manifest.title,
        manifest,
        references,
      }
    },
  })
}
