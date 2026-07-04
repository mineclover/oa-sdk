import { createHash } from 'node:crypto'

import { validateDpmProfileArtifactSchema } from './schema.js'
import type {
  DpmProfileArtifact,
  DpmProfileCaptureMode,
  DpmProfileDiagnostic,
  DpmProfileSourceKind,
} from './types.js'

export const DPM_PROFILE_CONNECTOR_RESULT_KIND = 'dpm.profile.connector-result.v1' as const

export const DPM_PROFILE_CONNECTOR_STATUSES = [
  'completed',
  'completed_with_warnings',
  'failed',
] as const

export const DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS = [
  'source',
  'evidence_source',
  'node',
  'edge',
  'metric',
  'diagnostic',
] as const

export type DpmProfileConnectorStatus = typeof DPM_PROFILE_CONNECTOR_STATUSES[number]
export type DpmProfileConnectorEvidenceKind = typeof DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS[number]

export type DpmProfileConnectorCapabilities = {
  connectorId: string
  connectorVersion: string
  sourceKinds: DpmProfileSourceKind[]
  captureModes: DpmProfileCaptureMode[]
  supportedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
  skippedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
}

export type DpmProfileConnectorFreshness = {
  runHash: string
  profileVersionHash?: string
  sourceVersionHashes?: Record<string, string>
}

export type DpmProfileConnectorResult = {
  kind: typeof DPM_PROFILE_CONNECTOR_RESULT_KIND
  connectorId: string
  connectorVersion: string
  sourceKind: DpmProfileSourceKind
  captureMode: DpmProfileCaptureMode
  status: DpmProfileConnectorStatus
  capabilities: DpmProfileConnectorCapabilities
  observedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
  diagnostics: DpmProfileDiagnostic[]
  freshness: DpmProfileConnectorFreshness
  profileArtifact?: DpmProfileArtifact
}

export type DpmProfileConnectorResultInput = Omit<DpmProfileConnectorResult, 'kind' | 'freshness'>

export type DpmProfileConnectorValidationResult = {
  valid: boolean
  diagnostics: DpmProfileDiagnostic[]
}

export function normalizeDpmProfileConnectorResult(input: DpmProfileConnectorResultInput): DpmProfileConnectorResult {
  const structural = {
    kind: DPM_PROFILE_CONNECTOR_RESULT_KIND,
    connectorId: input.connectorId,
    connectorVersion: input.connectorVersion,
    sourceKind: input.sourceKind,
    captureMode: input.captureMode,
    status: input.status,
    capabilities: copyCapabilities(input.capabilities),
    observedEvidenceKinds: [...input.observedEvidenceKinds].sort(),
    diagnostics: input.diagnostics.map(copyDiagnostic).sort(byDiagnostic),
    ...(input.profileArtifact ? { profileArtifact: input.profileArtifact } : {}),
  }

  return {
    ...structural,
    freshness: {
      runHash: computeDpmProfileConnectorRunHash(structural),
      ...(input.profileArtifact ? { profileVersionHash: input.profileArtifact.freshness.versionHash } : {}),
      ...(input.profileArtifact?.freshness.sourceVersionHashes
        ? { sourceVersionHashes: sortStringMap(input.profileArtifact.freshness.sourceVersionHashes) }
        : {}),
    },
  }
}

export function computeDpmProfileConnectorRunHash(
  input: Omit<DpmProfileConnectorResult, 'freshness'> | DpmProfileConnectorResultInput,
): string {
  const structural = 'kind' in input
    ? input
    : {
        kind: DPM_PROFILE_CONNECTOR_RESULT_KIND,
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

  return `sha256:${createHash('sha256').update(stableStringify(structural)).digest('hex')}`
}

export function validateDpmProfileConnectorResult(
  result: DpmProfileConnectorResult,
): DpmProfileConnectorValidationResult {
  const diagnostics: DpmProfileDiagnostic[] = []

  if (result.capabilities.connectorId !== result.connectorId || result.capabilities.connectorVersion !== result.connectorVersion) {
    diagnostics.push(connectorDiagnostic(
      'CONN101',
      `Connector result identity must match capability metadata for ${result.connectorId}.`,
      result.connectorId,
    ))
  }

  if (!result.capabilities.sourceKinds.includes(result.sourceKind)) {
    diagnostics.push(connectorDiagnostic(
      'CONN102',
      `Connector ${result.connectorId} does not support source kind ${result.sourceKind}.`,
      result.connectorId,
    ))
  }

  if (!result.capabilities.captureModes.includes(result.captureMode)) {
    diagnostics.push(connectorDiagnostic(
      'CONN103',
      `Connector ${result.connectorId} does not support capture mode ${result.captureMode}.`,
      result.connectorId,
    ))
  }

  const unsupportedEvidenceKinds = result.observedEvidenceKinds.filter(kind =>
    !result.capabilities.supportedEvidenceKinds.includes(kind) ||
    result.capabilities.skippedEvidenceKinds.includes(kind),
  )
  if (unsupportedEvidenceKinds.length > 0) {
    diagnostics.push(connectorDiagnostic(
      'CONN104',
      `Connector ${result.connectorId} claimed unsupported observed evidence kinds: ${unsupportedEvidenceKinds.join(', ')}.`,
      result.connectorId,
    ))
  }

  if (result.status === 'failed' && result.diagnostics.length === 0) {
    diagnostics.push(connectorDiagnostic(
      'CONN105',
      `Failed connector result ${result.connectorId} must include at least one diagnostic.`,
      result.connectorId,
    ))
  }

  if (result.status !== 'failed' && !result.profileArtifact) {
    diagnostics.push(connectorDiagnostic(
      'CONN106',
      `Completed connector result ${result.connectorId} must include a profile artifact.`,
      result.connectorId,
    ))
  }

  if (result.profileArtifact) {
    const artifactSchemaResult = validateDpmProfileArtifactSchema(result.profileArtifact)
    if (!artifactSchemaResult.valid) {
      diagnostics.push(connectorDiagnostic(
        'CONN107',
        `Connector ${result.connectorId} emitted an invalid profile artifact.`,
        result.connectorId,
      ))
    }

    const mismatchedSource = result.profileArtifact.sources.find(source =>
      source.connectorId !== result.connectorId || source.connectorVersion !== result.connectorVersion,
    )
    if (mismatchedSource) {
      diagnostics.push(connectorDiagnostic(
        'CONN108',
        `Profile source ${mismatchedSource.id} does not match connector result identity ${result.connectorId}.`,
        result.connectorId,
      ))
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}

function copyCapabilities(capabilities: DpmProfileConnectorCapabilities): DpmProfileConnectorCapabilities {
  return {
    connectorId: capabilities.connectorId,
    connectorVersion: capabilities.connectorVersion,
    sourceKinds: [...capabilities.sourceKinds].sort(),
    captureModes: [...capabilities.captureModes].sort(),
    supportedEvidenceKinds: [...capabilities.supportedEvidenceKinds].sort(),
    skippedEvidenceKinds: [...capabilities.skippedEvidenceKinds].sort(),
  }
}

function copyDiagnostic(diagnostic: DpmProfileDiagnostic): DpmProfileDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.connectorId ? { connectorId: diagnostic.connectorId } : {}),
    ...(diagnostic.coordinate ? { coordinate: { ...diagnostic.coordinate } } : {}),
    ...(diagnostic.evidenceIds ? { evidenceIds: [...diagnostic.evidenceIds].sort() } : {}),
  }
}

function connectorDiagnostic(code: DpmProfileDiagnostic['code'], message: string, connectorId: string): DpmProfileDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    connectorId,
    coordinate: {
      kind: 'manual_import',
      path: connectorId,
    },
  }
}

function byDiagnostic(left: DpmProfileDiagnostic, right: DpmProfileDiagnostic): number {
  return `${left.severity}.${left.code}.${left.message}`.localeCompare(`${right.severity}.${right.code}.${right.message}`)
}

function sortStringMap(input: Readonly<Record<string, string>>): Record<string, string> {
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
