import type {
  EntitySourceEnvelope,
  FrameworkContent,
  SpecContent,
} from '../contracts/ewic-types.js'
import type { CollaborationManifest } from '../../shared-context-harness/contracts/types.js'
import { computeEnvelopeContentHash } from '../canonical/canonical-json.js'

export interface CollaborationManifestAdapterOptions {
  fileId?: string
  parentChain?: string[]
  createdAt?: string
  revision?: number
}

/**
 * Adapter between Issue #2 CollaborationManifest and EWIC v0.1 EntitySourceEnvelope<FrameworkContent>.
 * Preserves storage folder IDs, participants, policies, and unknown fields.
 */
export class CollaborationManifestAdapter {
  static toFrameworkEnvelope(
    manifest: CollaborationManifest & Record<string, unknown>,
    options: CollaborationManifestAdapterOptions = {}
  ): EntitySourceEnvelope<FrameworkContent> {
    const fileId = options.fileId ?? (manifest.fileId as string | undefined) ?? manifest.storage.rootFolderId
    const parentChain = options.parentChain ?? ['root', manifest.storage.rootFolderId]
    const revision = options.revision ?? 1

    const content: FrameworkContent = {
      name: manifest.title,
      version: manifest.schemaVersion,
      capabilities: manifest.participants.map(
        (p) => `${p.workspaceId}:${p.contribution}`
      ),
      constraints: [
        `governingPolicy:${manifest.governingPolicyRef}`,
        `ownerScope:${manifest.ownerScope.type}:${manifest.ownerScope.id}`,
      ],
      interfaces: [
        `discussions:${manifest.storage.folderIds.discussions}`,
        `proposals:${manifest.storage.folderIds.proposals}`,
        `decisions:${manifest.storage.folderIds.decisions}`,
        `references:${manifest.storage.folderIds.references}`,
        `distributions:${manifest.storage.folderIds.distributions}`,
      ],
    }

    const contentHash = computeEnvelopeContentHash({ content })
    const id = `ent_${manifest.collaborationId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const namespace = `collab.${manifest.collaborationId.replace(/[^a-z0-9.]/g, '.')}`

    // Extract unknown fields
    const knownKeys = new Set([
      'schemaVersion',
      'collaborationId',
      'title',
      'ownerScope',
      'storage',
      'governingPolicyRef',
      'participants',
      'fileId',
    ])

    const extraFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(manifest)) {
      if (!knownKeys.has(key)) {
        extraFields[key] = value
      }
    }

    return {
      $schema: 'entity-source/v1',
      identity: {
        id,
        kind: 'framework',
        namespace,
        slug: manifest.collaborationId,
        revision,
        revisionId: `${id}@${revision}`,
        status: 'published',
        contentHash,
      },
      provenance: {
        ssot: {
          provider: 'google_drive',
          fileId,
          path: `drive://${manifest.storage.rootFolderId}/collaboration.json`,
          parentChain,
          locator: `drive://${manifest.storage.rootFolderId}/collaboration.json`,
          revision: '1',
        },
        createdAt: options.createdAt ?? '2026-10-09T00:00:00.000Z',
        createdBy: `scope:${manifest.ownerScope.id}`,
        parentRevision: null,
      },
      content,
      refs: [],
      ...extraFields,
      _originalCollaborationManifest: {
        schemaVersion: manifest.schemaVersion,
        ownerScope: manifest.ownerScope,
        storage: manifest.storage,
        governingPolicyRef: manifest.governingPolicyRef,
        participants: manifest.participants,
      },
    }
  }

  static fromFrameworkEnvelope(
    envelope: EntitySourceEnvelope<FrameworkContent>
  ): CollaborationManifest & Record<string, unknown> {
    const orig = (envelope._originalCollaborationManifest as Record<string, unknown> | undefined) ?? {}

    const envelopeReservedKeys = new Set([
      '$schema',
      'identity',
      'provenance',
      'content',
      'refs',
      '_originalCollaborationManifest',
    ])

    const extraFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(envelope)) {
      if (!envelopeReservedKeys.has(key)) {
        extraFields[key] = value
      }
    }

    return {
      schemaVersion: (orig.schemaVersion as '0.1.0') ?? '0.1.0',
      collaborationId: envelope.identity.slug,
      title: envelope.content.name,
      ownerScope: (orig.ownerScope as CollaborationManifest['ownerScope']) ?? {
        type: 'personal',
        id: envelope.provenance.createdBy.replace('scope:', ''),
      },
      storage: (orig.storage as CollaborationManifest['storage']) ?? {
        rootFolderId: envelope.provenance.ssot.fileId ?? '1h_CjCUEaOUaKzImXqbmbRS0AGkPdmkiB',
        folderIds: {
          discussions: '1QfLPR36r-HhzSgFSvKUGHE_iCy34n037',
          proposals: '1f8NUu_WOyPZyNazI7vp8zVHerVE9hGrR',
          decisions: '1toU6quLNUy5f_XY-KJhH2_1vleoQ9HdR',
          references: '13kImqWVGEzPeuUD2x4b1bH9lPcqXBUv5',
          distributions: '1EeZ1UOhc-LNRGroFdZD1X06WpL2BS-ld',
        },
      },
      governingPolicyRef: (orig.governingPolicyRef as string) ?? 'policy-v1',
      participants: (orig.participants as CollaborationManifest['participants']) ?? [],
      ...extraFields,
    }
  }
}
