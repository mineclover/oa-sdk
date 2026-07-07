import type { DpmProfileConnectorResult } from './connector-types.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

export function addDpmProfileConnectorGraphDiagnostics(
  diagnostics: DpmProfileDiagnostic[],
  result: DpmProfileConnectorResult,
): void {
  const profile = result.profileArtifact
  if (!profile) return

  const sourceIds = new Set(profile.sources.map(source => source.id))
  const evidenceIds = new Set(Object.keys(profile.evidenceSources))
  const nodeIds = new Set(profile.nodes.map(node => node.id))
  const edgeIds = new Set(profile.edges.map(edge => edge.id))
  const graphSubjectIds = new Set([...nodeIds, ...edgeIds])

  addDuplicateIdDiagnostics(diagnostics, result, 'node', profile.nodes.map(node => node.id))
  addDuplicateIdDiagnostics(diagnostics, result, 'edge', profile.edges.map(edge => edge.id))
  addDuplicateIdDiagnostics(diagnostics, result, 'metric', profile.metrics.map(metric => metric.id))

  for (const edge of profile.edges) {
    const missingNodeIds = [edge.fromNodeId, edge.toNodeId].filter(nodeId => !nodeIds.has(nodeId))
    if (missingNodeIds.length > 0) {
      diagnostics.push(graphDiagnostic(
        'CONN110',
        `Profile edge ${edge.id} references missing node ids: ${missingNodeIds.join(', ')}.`,
        result.connectorId,
        `profileArtifact.edges.${edge.id}`,
      ))
    }

    addMissingEvidenceDiagnostics(diagnostics, result, `edge ${edge.id}`, `profileArtifact.edges.${edge.id}`, edge.evidenceIds, evidenceIds)
  }

  for (const metric of profile.metrics) {
    if (!graphSubjectIds.has(metric.subjectId)) {
      diagnostics.push(graphDiagnostic(
        'CONN112',
        `Profile metric ${metric.id} references missing graph subject ${metric.subjectId}.`,
        result.connectorId,
        `profileArtifact.metrics.${metric.id}`,
      ))
    }

    addMissingEvidenceDiagnostics(
      diagnostics,
      result,
      `metric ${metric.id}`,
      `profileArtifact.metrics.${metric.id}`,
      metric.evidenceIds,
      evidenceIds,
    )
  }

  for (const diagnostic of profile.diagnostics) {
    addMissingEvidenceDiagnostics(
      diagnostics,
      result,
      `diagnostic ${diagnostic.code}`,
      `profileArtifact.diagnostics.${diagnostic.code}`,
      diagnostic.evidenceIds ?? [],
      evidenceIds,
    )
  }

  for (const evidenceId of Object.keys(profile.evidenceSources).sort()) {
    const sourceId = profile.evidenceSources[evidenceId]?.coordinate.sourceId
    if (sourceId && !sourceIds.has(sourceId)) {
      diagnostics.push(graphDiagnostic(
        'CONN113',
        `Profile evidence source ${evidenceId} references missing source ${sourceId}.`,
        result.connectorId,
        `profileArtifact.evidenceSources.${evidenceId}`,
      ))
    }
  }

  for (const node of profile.nodes) {
    const sourceId = node.coordinate.sourceId
    if (sourceId && !sourceIds.has(sourceId)) {
      diagnostics.push(graphDiagnostic(
        'CONN113',
        `Profile node ${node.id} references missing source ${sourceId}.`,
        result.connectorId,
        `profileArtifact.nodes.${node.id}`,
      ))
    }
  }
}

function addDuplicateIdDiagnostics(
  diagnostics: DpmProfileDiagnostic[],
  result: DpmProfileConnectorResult,
  kind: 'node' | 'edge' | 'metric',
  ids: readonly string[],
): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }

  for (const id of [...duplicates].sort()) {
    diagnostics.push(graphDiagnostic(
      'CONN109',
      `Profile artifact contains duplicate ${kind} id ${id}.`,
      result.connectorId,
      `profileArtifact.${kind}s.${id}`,
    ))
  }
}

function addMissingEvidenceDiagnostics(
  diagnostics: DpmProfileDiagnostic[],
  result: DpmProfileConnectorResult,
  ownerLabel: string,
  ownerPath: string,
  ownerEvidenceIds: readonly string[],
  evidenceIds: ReadonlySet<string>,
): void {
  const missingEvidenceIds = ownerEvidenceIds.filter(evidenceId => !evidenceIds.has(evidenceId))
  if (missingEvidenceIds.length === 0) return

  diagnostics.push(graphDiagnostic(
    'CONN111',
    `Profile ${ownerLabel} references missing evidence ids: ${[...missingEvidenceIds].sort().join(', ')}.`,
    result.connectorId,
    ownerPath,
  ))
}

function graphDiagnostic(
  code: DpmProfileDiagnostic['code'],
  message: string,
  connectorId: string,
  path: string,
): DpmProfileDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    connectorId,
    coordinate: {
      kind: 'manual_import',
      path: `${connectorId}.${path}`,
    },
  }
}
