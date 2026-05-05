/**
 * v0.13 — surface kind helpers.
 *
 * Single source for "what kind is this domain" + filters for kind-specific
 * processing. Imported by validate, coverage, bind, generate-tests, propose.
 *
 * Default kind: 'openapi-http' — backward-compat for matrices written before v0.13.
 */

import type { DomainMatrix, SurfaceKind } from './types.js'

export const DEFAULT_KIND: SurfaceKind = 'openapi-http'

/** All valid surface kinds — keep in sync with the `SurfaceKind` union in types.ts. */
export const KIND_VALUES: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  'openapi-http',
  'cli-tool',
  'library-api',
  'event-stream',
])

/** True iff `value` is a valid SurfaceKind literal. */
export function isValidKind(value: unknown): value is SurfaceKind {
  return typeof value === 'string' && KIND_VALUES.has(value as SurfaceKind)
}

/**
 * Resolve a domain's surface kind, defaulting to `openapi-http`.
 *
 * Note: returns the raw value even if invalid — callers that need safety
 * should pre-validate with `isValidKind()`. Validate.ts checks this with rule #22.
 */
export function domainKind(matrix: DomainMatrix): SurfaceKind {
  return matrix.metadata?.kind ?? DEFAULT_KIND
}

/** True iff the domain's surface is HTTP — only kind that participates in OpenAPI bindings/drift/coverage. */
export function isHttpDomain(matrix: DomainMatrix): boolean {
  return domainKind(matrix) === 'openapi-http'
}

/** Filter to `openapi-http` matrices — used by bind, drift detection, generate-tests, coverage. */
export function httpDomainsOnly(domains: DomainMatrix[]): DomainMatrix[] {
  return domains.filter(isHttpDomain)
}
