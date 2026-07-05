import { createHash } from 'node:crypto'

import type {
  DpmProfileConnectorResult,
  DpmProfileConnectorResultInput,
} from './connector-types.js'

export function createDpmProfileConnectorHashInput(
  input: DpmProfileConnectorResultInput,
  kind: DpmProfileConnectorResult['kind'],
): Omit<DpmProfileConnectorResult, 'freshness'> {
  return {
    kind,
    connectorId: input.connectorId,
    connectorVersion: input.connectorVersion,
    sourceKind: input.sourceKind,
    captureMode: input.captureMode,
    status: input.status,
    capabilities: input.capabilities,
    observedEvidenceKinds: input.observedEvidenceKinds,
    diagnostics: input.diagnostics,
    ...(input.profileArtifact ? { profileArtifact: input.profileArtifact } : {}),
  }
}

export function computeDpmProfileConnectorStructuralHash(
  input: Omit<DpmProfileConnectorResult, 'freshness'>,
): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

export function sortDpmProfileConnectorSourceVersionHashes(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(input).sort()) {
    const value = input[key]
    if (value) sorted[key] = value
  }
  return sorted
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
