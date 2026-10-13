/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and EWIC envelope hashing.
 * Re-exports the authoritative centralized canonical hashing functions from @oa-sdk/surface-ir.
 */
export {
  canonicalJsonStringify,
  computeCanonicalHash,
} from '@oa-sdk/surface-ir'

import { computeCanonicalHash } from '@oa-sdk/surface-ir'

/**
 * Compute semantic content hash for an entity source envelope.
 * Excludes volatile provenance time/paths and derived metadata, as dictated by EWIC v0.1.
 */
export function computeEnvelopeContentHash(envelope: { content: unknown }): string {
  return computeCanonicalHash(envelope.content)
}

/**
 * Compute semantic entity hash across identity stable fields + content + refs.
 */
export function computeSemanticEntityHash(envelope: {
  identity: {
    id: string
    kind: string
    namespace: string
    slug: string
    revision: number
  }
  content: unknown
  refs?: unknown[]
}): string {
  return computeCanonicalHash({
    id: envelope.identity.id,
    kind: envelope.identity.kind,
    namespace: envelope.identity.namespace,
    slug: envelope.identity.slug,
    revision: envelope.identity.revision,
    content: envelope.content,
    refs: envelope.refs ?? [],
  })
}
