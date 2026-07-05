import type { DpmProfileAnalysisCoverage } from './analysis-types.js'
import {
  countBy,
  roundRatio,
} from './analysis-utils.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'

export function analyzeCoverage(profile: DpmProfileArtifact): DpmProfileAnalysisCoverage {
  const measuredNodeIds = new Set(profile.metrics.map(metric => metric.subjectId))

  return {
    sourceKindCounts: countBy(profile.sources, source => source.kind),
    nodeKindCounts: countBy(profile.nodes, node => node.kind),
    metricKindCounts: countBy(profile.metrics, metric => metric.kind),
    measuredNodeCount: measuredNodeIds.size,
    measuredNodeRatio: profile.nodes.length > 0 ? roundRatio(measuredNodeIds.size / profile.nodes.length) : 0,
  }
}
