import { createSchemaTool } from '../../../../packages/tools/src/index.js'
import type { SharedContextHarnessPort } from '../contracts/ports.js'
import {
  validateCollaborationManifest,
  validateSourceReference,
} from '../validator/context-harness-validator.js'
import type { ResolveSharedReferenceResult } from '../contracts/types.js'

export const ResolveReferenceInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    collaborationId: {
      type: 'string',
      description: 'The unique collaboration identifier (e.g. collab-context-harness)',
      pattern: '^collab-[a-z0-9]+(-[a-z0-9]+)*$',
    },
    referenceId: {
      type: 'string',
      description: 'The registered reference ID (e.g. ref-oa-sdk)',
      pattern: '^ref-[a-z0-9]+(-[a-z0-9]+)*$',
    },
    actorId: {
      type: 'string',
      description: 'The authenticated actor requesting source resolution',
      minLength: 1,
    },
  },
  required: ['collaborationId', 'referenceId', 'actorId'],
  additionalProperties: false,
}

export function createResolveReferenceTool(port: SharedContextHarnessPort) {
  return createSchemaTool<
    { collaborationId: string; referenceId: string; actorId: string },
    ResolveSharedReferenceResult
  >({
    name: 'collab_resolve_reference',
    description: 'Resolve a shared source reference with trusted boundary ACL check, snapshot parity, and fail-closed error concealment.',
    category: 'collaboration',
    schema: ResolveReferenceInputSchema,
    execute: async (_ctx, input) => {
      const { collaborationId, referenceId, actorId } = input
      const unavailable: ResolveSharedReferenceResult = { status: 'unavailable' }

      // 1. Boundary check: Collaboration Manifest existence & schema validity
      const manifest = await port.readCollaboration(collaborationId)
      if (!manifest) return unavailable

      const manifestCheck = validateCollaborationManifest(manifest)
      if (!manifestCheck.ok) return unavailable

      // 2. Boundary check: Actor permission on collaboration root
      try {
        const canReadCollab = await port.canReadCollaboration(actorId, manifest)
        if (!canReadCollab) return unavailable
      } catch {
        return unavailable
      }

      // 3. Boundary check: Reference card existence & schema validity
      const reference = await port.readReference(collaborationId, referenceId)
      if (!reference) return unavailable

      const refCheck = validateSourceReference(reference)
      if (!refCheck.ok || reference.collaborationId !== manifest.collaborationId) {
        return unavailable
      }

      // 4. Anti-spoofing registration check: Must be registered in central reference index
      try {
        const isRegistered = await port.isRegisteredReference(manifest, reference)
        if (!isRegistered) return unavailable
      } catch {
        return unavailable
      }

      // 5. Source boundary check: Actor permission on native source repository
      try {
        const canReadSource = await port.canReadSource(actorId, reference)
        if (!canReadSource) return unavailable
      } catch {
        return unavailable
      }

      // 6. Read source material safely and compare snapshot invariant
      try {
        const material = await port.readSource(reference)
        if (!material || typeof material.content !== 'string' || !material.snapshotId) {
          return unavailable
        }

        // Stale snapshot detection: Pinned commit / revision mismatch
        if (material.snapshotId !== reference.source.snapshot.id) {
          return { status: 'stale' }
        }

        return {
          status: 'resolved',
          referenceId: reference.referenceId,
          snapshotId: material.snapshotId,
          content: material.content,
          provenance: reference.provenance,
        }
      } catch {
        // Conceal provider exceptions, secret paths, or auth tokens
        return unavailable
      }
    },
  })
}
