/**
 * v0.4 — persona-driven mock client.
 *
 * Two layers:
 *
 *   1. **Simulator** — `act(personaId, operationId)` returns the resolved
 *      response without HTTP. Useful for contract verification in unit tests.
 *
 *   2. **HTTP adapter** — `applyTo(mockServer, personaId)` calls the existing
 *      mock-server's `override(operationId, response)` API for every operation
 *      this persona claims, so that real HTTP requests served by mock-server
 *      return the persona's expected response.
 *
 * The HTTP adapter is structurally typed against the mock-server interface so
 * this package does not need a hard dependency on @oa-sdk/mock-server.
 */

import type { MinimalOpenApiDoc } from './bind.js'
import { isHttpDomain } from './kind.js'
import { listPersonasForOperation, resolvePersonaResponse } from './resolver.js'
import type { ResolvedPersonaResponse } from './resolver.js'
import type { DomainMatrix } from './types.js'

/** Structural shape of `createNodeMockServer` — only the methods we use. */
export interface MockServerLike {
  override(operationId: string, response: { status: number; body?: unknown; headers?: Record<string, string> }): void
  clearOverride(operationId: string): void
  clearOverrides(): void
}

export interface PersonaMockClient {
  /**
   * Pure simulation — return what the persona expects to receive when it
   * invokes the operation. Returns null if the persona does not claim this
   * operation, has no expects, or the operation lacks a matching response.
   */
  act(personaId: string, operationId: string): ResolvedPersonaResponse | null

  /**
   * List personas (by id) that claim the given operationId. Useful for tests
   * that want to enumerate all roleplay variants of an endpoint.
   */
  personasFor(operationId: string): string[]

  /**
   * Push the persona's expected responses onto a mock-server via override().
   * Every operationId in the persona's `maps_to` is overridden with the
   * resolved (status, body, headers).
   *
   * Returns the operationIds that were successfully overridden.
   */
  applyTo(server: MockServerLike, personaId: string): string[]

  /**
   * Switch the mock-server's overrides from one persona to another atomically.
   * Clears all existing overrides first, then applies the new persona.
   */
  switchTo(server: MockServerLike, personaId: string): string[]
}

export interface CreatePersonaMockClientOptions {
  spec: MinimalOpenApiDoc
  domains: DomainMatrix[]
}

export function createPersonaMockClient(options: CreatePersonaMockClientOptions): PersonaMockClient {
  return {
    act(personaId, operationId) {
      return resolvePersonaResponse(personaId, operationId, options)
    },

    personasFor(operationId) {
      return listPersonasForOperation(operationId, options.domains).map(p => p.id)
    },

    applyTo(server, personaId) {
      const applied: string[] = []
      // v0.13: only HTTP domains carry operationIds the mock-server can override.
      // CLI / library / event-stream personas have synthetic ids — silently no-op.
      const ownerMatrix = options.domains.find(m => m.personas.some(p => p.id === personaId))
      if (!ownerMatrix || !isHttpDomain(ownerMatrix)) return applied
      const personaEntry = ownerMatrix.personas.find(p => p.id === personaId)
      if (!personaEntry) return applied

      const ids = personaEntry.outcome?.maps_to ?? []
      for (const opId of ids) {
        const resolved = resolvePersonaResponse(personaId, opId, options)
        if (!resolved) continue
        server.override(opId, {
          status: resolved.status,
          ...(resolved.body !== null ? { body: resolved.body } : {}),
          ...(resolved.headers && Object.keys(resolved.headers).length > 0
            ? { headers: stringifyHeaders(resolved.headers) }
            : {}),
        })
        applied.push(opId)
      }
      return applied
    },

    switchTo(server, personaId) {
      server.clearOverrides()
      return this.applyTo(server, personaId)
    },
  }
}

/** OpenAPI response.headers values are objects with schema/example etc. — extract a flat string map. */
function stringifyHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, def] of Object.entries(headers)) {
    if (typeof def === 'object' && def !== null) {
      const obj = def as Record<string, unknown>
      const example = obj['example'] ?? (obj['schema'] as Record<string, unknown> | undefined)?.['example']
      if (example !== undefined) out[name] = String(example)
    }
  }
  return out
}
