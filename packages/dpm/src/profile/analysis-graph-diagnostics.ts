import type { DpmProfileArtifact } from './profile-artifact-types.js'
import type { DpmProfileDiagnostic } from './profile-diagnostic-types.js'

export function createDpmProfileAnalysisGraphDiagnostics(
  profile: DpmProfileArtifact,
): DpmProfileDiagnostic[] {
  const diagnostics: DpmProfileDiagnostic[] = []
  const sourceIds = new Set(profile.sources.map(source => source.id))
  const evidenceIds = new Set(Object.keys(profile.evidenceSources))
  const nodeIds = new Set(profile.nodes.map(node => node.id))
  const edgeIds = new Set(profile.edges.map(edge => edge.id))
  const graphSubjectIds = new Set([...nodeIds, ...edgeIds])

  diagnostics.push(...duplicateIdDiagnostics('node', profile.nodes.map(node => node.id)))
  diagnostics.push(...duplicateIdDiagnostics('edge', profile.edges.map(edge => edge.id)))
  diagnostics.push(...duplicateIdDiagnostics('metric', profile.metrics.map(metric => metric.id)))

  for (const edge of profile.edges) {
    const missingNodeIds = [edge.fromNodeId, edge.toNodeId].filter(nodeId => !nodeIds.has(nodeId))
    if (missingNodeIds.length > 0) {
      diagnostics.push(profileGraphDiagnostic(
        'PROF302',
        `Profile edge ${edge.id} references missing node ids: ${missingNodeIds.join(', ')}.`,
        `profileArtifact.edges.${edge.id}`,
      ))
    }

    diagnostics.push(...missingEvidenceDiagnostics(
      `edge ${edge.id}`,
      `profileArtifact.edges.${edge.id}`,
      edge.evidenceIds,
      evidenceIds,
    ))
  }

  for (const metric of profile.metrics) {
    if (!graphSubjectIds.has(metric.subjectId)) {
      diagnostics.push(profileGraphDiagnostic(
        'PROF304',
        `Profile metric ${metric.id} references missing graph subject ${metric.subjectId}.`,
        `profileArtifact.metrics.${metric.id}`,
      ))
    }

    diagnostics.push(...missingEvidenceDiagnostics(
      `metric ${metric.id}`,
      `profileArtifact.metrics.${metric.id}`,
      metric.evidenceIds,
      evidenceIds,
    ))
  }

  for (const diagnostic of profile.diagnostics) {
    diagnostics.push(...missingEvidenceDiagnostics(
      `diagnostic ${diagnostic.code}`,
      `profileArtifact.diagnostics.${diagnostic.code}`,
      diagnostic.evidenceIds ?? [],
      evidenceIds,
    ))
  }

  for (const [evidenceId, evidenceSource] of Object.entries(profile.evidenceSources).sort(byEntryKey)) {
    const sourceId = evidenceSource.coordinate.sourceId
    if (sourceId && !sourceIds.has(sourceId)) {
      diagnostics.push(profileGraphDiagnostic(
        'PROF305',
        `Profile evidence source ${evidenceId} references missing source ${sourceId}.`,
        `profileArtifact.evidenceSources.${evidenceId}`,
      ))
    }
  }

  for (const node of profile.nodes) {
    const sourceId = node.coordinate.sourceId
    if (sourceId && !sourceIds.has(sourceId)) {
      diagnostics.push(profileGraphDiagnostic(
        'PROF305',
        `Profile node ${node.id} references missing source ${sourceId}.`,
        `profileArtifact.nodes.${node.id}`,
      ))
    }
  }

  return diagnostics
}

function duplicateIdDiagnostics(
  kind: 'node' | 'edge' | 'metric',
  ids: readonly string[],
): DpmProfileDiagnostic[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }

  return [...duplicates].sort().map(id =>
    profileGraphDiagnostic(
      'PROF303',
      `Profile artifact contains duplicate ${kind} id ${id}.`,
      `profileArtifact.${kind}s.${id}`,
    )
  )
}

function missingEvidenceDiagnostics(
  ownerLabel: string,
  ownerPath: string,
  ownerEvidenceIds: readonly string[],
  evidenceIds: ReadonlySet<string>,
): DpmProfileDiagnostic[] {
  const missingEvidenceIds = ownerEvidenceIds.filter(evidenceId => !evidenceIds.has(evidenceId))
  if (missingEvidenceIds.length === 0) return []

  return [profileGraphDiagnostic(
    'PROF306',
    `Profile ${ownerLabel} references missing evidence ids: ${[...missingEvidenceIds].sort().join(', ')}.`,
    ownerPath,
  )]
}

function profileGraphDiagnostic(
  code: DpmProfileDiagnostic['code'],
  message: string,
  path: string,
): DpmProfileDiagnostic {
  return {
    severity: 'warning',
    code,
    message,
    coordinate: {
      kind: 'manual_import',
      path,
    },
  }
}

function byEntryKey(
  left: readonly [string, unknown],
  right: readonly [string, unknown],
): number {
  return left[0].localeCompare(right[0])
}
