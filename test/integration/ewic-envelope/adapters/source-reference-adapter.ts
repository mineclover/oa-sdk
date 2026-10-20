import type {
  EntitySourceEnvelope,
  ResourceContent,
  EntitySSOT,
} from '../contracts/ewic-types.js'
import type {
  SourceReference,
  ReferenceIndexItem,
} from '../../shared-context-harness/contracts/types.js'
import { computeEnvelopeContentHash } from '../canonical/canonical-json.js'

type SourceProvider = SourceReference['source']['provider']

/** Every `source.provider` the Issue #2 reference schema allows (reference.schema.json). */
const SOURCE_PROVIDERS: readonly SourceProvider[] = ['github', 'drive', 'nes', 'semantic', 'web']

function isSourceProvider(value: unknown): value is SourceProvider {
  return typeof value === 'string' && (SOURCE_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Fallback mapping for envelopes that carry no `_originalSourceReference`
 * side-channel. The EWIC SSOT provider enum has no `semantic` / `web`
 * members (both map to `local`), so this direction is lossy for them.
 */
function providerFromSsot(provider: EntitySSOT['provider']): SourceProvider {
  if (provider === 'github') return 'github'
  if (provider === 'nes') return 'nes'
  return 'drive'
}

export interface SourceReferenceAdapterOptions {
  parentChain?: string[]
  fileId?: string
  createdAt?: string
  status?: 'draft' | 'published' | 'deprecated'
  revision?: number
}

/**
 * Adapter between Issue #2 SourceReference / ReferenceIndexItem and EWIC v0.1 EntitySourceEnvelope<ResourceContent>.
 * Strictly preserves:
 * - Drive fileId, revision, contentHash, parentChain, locator
 * - The original `source.provider` (including `semantic` / `web`, which the EWIC
 *   SSOT enum collapses to `local`) via the `_originalSourceReference` side-channel
 * - Forward-compatible unknown fields in both directions (lossless round-trip)
 *
 * The round trip is lossless for envelopes produced by `toResourceEnvelope`.
 * An envelope that arrives without `_originalSourceReference` is restored from
 * its SSOT fields alone, where `local` cannot be told apart and maps to `drive`.
 */
export class SourceReferenceAdapter {
  /**
   * Convert a SourceReference + optional ReferenceIndexItem into an EWIC Resource EntitySourceEnvelope.
   */
  static toResourceEnvelope(
    ref: SourceReference & Record<string, unknown>,
    indexItem?: ReferenceIndexItem,
    options: SourceReferenceAdapterOptions = {}
  ): EntitySourceEnvelope<ResourceContent> {
    const parentChain = options.parentChain ?? (indexItem ? ['root', 'collab-context-harness', 'references'] : undefined)
    const fileId = options.fileId ?? indexItem?.fileId ?? (ref.fileId as string | undefined)
    const revision = options.revision ?? 1

    // Map provider
    let ssotProvider: EntitySSOT['provider'] = 'google_drive'
    if (ref.source.provider === 'github') ssotProvider = 'github'
    else if (ref.source.provider === 'nes') ssotProvider = 'nes'
    else if (ref.source.provider === 'drive') ssotProvider = 'google_drive'
    else ssotProvider = 'local'

    // Determine media type from nativeRef
    const nativeRef = ref.source.nativeRef
    let mediaType = 'application/octet-stream'
    if (nativeRef.endsWith('.md')) mediaType = 'text/markdown'
    else if (nativeRef.endsWith('.json')) mediaType = 'application/json'
    else if (nativeRef.endsWith('.yaml') || nativeRef.endsWith('.yml')) mediaType = 'application/yaml'
    else if (nativeRef.endsWith('.tsp')) mediaType = 'application/typespec'

    const locator = (ref.locator as string | undefined) ?? (fileId ? `drive://${fileId}` : `git://${nativeRef}`)

    const content: ResourceContent = {
      uri: nativeRef,
      mediaType,
      locator,
      summary: (ref.summary as string | undefined) ?? `Managed resource reference for ${ref.referenceId}`,
      contentDigest: indexItem?.contentSha256 ? `sha256:${indexItem.contentSha256}` : `sha256:${ref.source.snapshot.id}`,
      fileId,
      parentChain,
    }

    const contentHash = computeEnvelopeContentHash({ content })

    const id = `ent_${ref.referenceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const namespace = ref.collaborationId.replace(/[^a-z0-9.]/g, '.')

    // Collect unknown fields from ref to preserve forward compatibility
    const knownKeys = new Set([
      'schemaVersion',
      'referenceId',
      'collaborationId',
      'ownerRef',
      'requiredScopeRef',
      'provenance',
      'source',
      'fileId',
      'locator',
      'summary',
    ])

    const extraFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(ref)) {
      if (!knownKeys.has(key)) {
        extraFields[key] = value
      }
    }

    const envelope: EntitySourceEnvelope<ResourceContent> = {
      $schema: 'entity-source/v1',
      identity: {
        id,
        kind: 'resource',
        namespace,
        slug: ref.referenceId,
        revision,
        revisionId: `${id}@${revision}`,
        status: options.status ?? 'published',
        contentHash,
      },
      provenance: {
        ssot: {
          provider: ssotProvider,
          fileId,
          path: nativeRef,
          parentChain,
          locator,
          revision: ref.source.snapshot.id,
        },
        createdAt: options.createdAt ?? '2026-10-09T00:00:00.000Z',
        createdBy: ref.ownerRef,
        parentRevision: null,
      },
      content,
      refs: [],
      // Preserve unknown fields directly at envelope root and/or in metadata
      ...extraFields,
      _originalSourceReference: {
        schemaVersion: ref.schemaVersion,
        requiredScopeRef: ref.requiredScopeRef,
        provenance: ref.provenance,
        sourceKind: ref.source.snapshot.kind,
        sourceProvider: ref.source.provider,
      },
    }

    return envelope
  }

  /**
   * Convert an EWIC Resource EntitySourceEnvelope back to a SourceReference.
   * Completely restores unknown fields; the provider comes from the
   * `_originalSourceReference` side-channel when present, else from the SSOT.
   */
  static fromResourceEnvelope(
    envelope: EntitySourceEnvelope<ResourceContent>
  ): SourceReference & Record<string, unknown> {
    const orig = (envelope._originalSourceReference as Record<string, unknown> | undefined) ?? {}
    const ssot = envelope.provenance.ssot

    const provider: SourceProvider = isSourceProvider(orig.sourceProvider)
      ? orig.sourceProvider
      : providerFromSsot(ssot.provider)

    // Extract any extra top-level unknown fields on the envelope
    const envelopeReservedKeys = new Set([
      '$schema',
      'identity',
      'provenance',
      'content',
      'refs',
      '_originalSourceReference',
    ])

    const extraFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(envelope)) {
      if (!envelopeReservedKeys.has(key)) {
        extraFields[key] = value
      }
    }

    const result: SourceReference & Record<string, unknown> = {
      schemaVersion: (orig.schemaVersion as '0.1.0') ?? '0.1.0',
      referenceId: envelope.identity.slug,
      collaborationId: envelope.identity.namespace.replace(/\./g, '-'),
      ownerRef: envelope.provenance.createdBy,
      requiredScopeRef: (orig.requiredScopeRef as string) ?? `scope:${envelope.identity.namespace}`,
      provenance: (orig.provenance as SourceReference['provenance']) ?? 'source-reference',
      source: {
        provider,
        nativeRef: ssot.path,
        snapshot: {
          kind: (orig.sourceKind as 'immutable' | 'working') ?? 'immutable',
          id: (ssot.revision as string) ?? envelope.content.contentDigest.replace('sha256:', ''),
        },
      },
      ...extraFields,
    }

    if (ssot.fileId) {
      result.fileId = ssot.fileId
    }
    if (ssot.locator) {
      result.locator = ssot.locator
    }

    return result
  }
}
