import type {
  EntitySourceEnvelope,
  EntityIdentity,
  EntityProvenance,
  EntityReferenceItem,
  SpecContent,
  FrameworkContent,
  ResourceContent,
  WorkflowContent,
  ExecutionContent,
  EvidenceContent,
  EntityKind,
} from '../contracts/ewic-types.js'
import { computeEnvelopeContentHash } from '../canonical/canonical-json.js'

export interface EnvelopeCreationOptions<TContent = Record<string, unknown>> {
  id: string
  namespace: string
  slug: string
  revision?: number
  status?: 'draft' | 'published' | 'deprecated'
  ssot: {
    provider: 'google_drive' | 'github' | 'local' | 'nes'
    fileId?: string
    path: string
    parentChain?: string[]
    locator?: string
    revision?: string
  }
  createdBy: string
  createdAt?: string
  content: TContent
  refs?: EntityReferenceItem[]
  extraEnvelopeFields?: Record<string, unknown>
}

/**
 * Universal Factory and Adapter for the 6 EWIC Entity Kinds:
 * - spec
 * - framework
 * - resource
 * - workflow
 * - execution
 * - evidence
 */
export class KindAdapters {
  /**
   * Base creator that enforces:
   * 1. Deterministic canonical RFC 8785 contentHash computation.
   * 2. Lossless unknown-field preservation.
   * 3. Revision format: revisionId = `${id}@${revision}`.
   */
  static createEnvelope<TContent = Record<string, unknown>>(
    kind: EntityKind,
    options: EnvelopeCreationOptions<TContent>
  ): EntitySourceEnvelope<TContent> {
    const revision = options.revision ?? 1
    const contentHash = computeEnvelopeContentHash({ content: options.content })

    const identity: EntityIdentity = {
      id: options.id,
      kind,
      namespace: options.namespace,
      slug: options.slug,
      revision,
      revisionId: `${options.id}@${revision}`,
      status: options.status ?? 'published',
      contentHash,
    }

    const provenance: EntityProvenance = {
      ssot: options.ssot,
      createdAt: options.createdAt ?? new Date().toISOString(),
      createdBy: options.createdBy,
      parentRevision: null,
    }

    return {
      $schema: 'entity-source/v1',
      identity,
      provenance,
      content: options.content,
      refs: options.refs ?? [],
      ...(options.extraEnvelopeFields ?? {}),
    }
  }

  static createSpecEnvelope(
    options: EnvelopeCreationOptions<SpecContent>
  ): EntitySourceEnvelope<SpecContent> {
    return this.createEnvelope<SpecContent>('spec', options)
  }

  static createFrameworkEnvelope(
    options: EnvelopeCreationOptions<FrameworkContent>
  ): EntitySourceEnvelope<FrameworkContent> {
    return this.createEnvelope<FrameworkContent>('framework', options)
  }

  static createResourceEnvelope(
    options: EnvelopeCreationOptions<ResourceContent>
  ): EntitySourceEnvelope<ResourceContent> {
    return this.createEnvelope<ResourceContent>('resource', options)
  }

  static createWorkflowEnvelope(
    options: EnvelopeCreationOptions<WorkflowContent>
  ): EntitySourceEnvelope<WorkflowContent> {
    return this.createEnvelope<WorkflowContent>('workflow', options)
  }

  static createExecutionEnvelope(
    options: EnvelopeCreationOptions<ExecutionContent>
  ): EntitySourceEnvelope<ExecutionContent> {
    return this.createEnvelope<ExecutionContent>('execution', options)
  }

  static createEvidenceEnvelope(
    options: EnvelopeCreationOptions<EvidenceContent>
  ): EntitySourceEnvelope<EvidenceContent> {
    return this.createEnvelope<EvidenceContent>('evidence', options)
  }
}
