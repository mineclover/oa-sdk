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

/** Resolve a domain's surface kind, defaulting to `openapi-http`. */
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
