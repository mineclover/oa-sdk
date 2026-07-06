import type { DpmProfileRiskIndicator } from './analysis-signal-types.js'
import { byId } from './analysis-ordering-utils.js'
import { analyzeIdentifierLikeFieldRisks } from './analysis-risk-identifiers.js'
import { analyzeMetricRatioRisks } from './analysis-risk-metrics.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'

export function analyzeRiskIndicators(profile: DpmProfileArtifact): DpmProfileRiskIndicator[] {
  const risks = new Map<string, DpmProfileRiskIndicator>()

  for (const risk of [
    ...analyzeIdentifierLikeFieldRisks(profile),
    ...analyzeMetricRatioRisks(profile),
  ]) {
    risks.set(risk.id, risk)
  }

  return [...risks.values()].sort(byId)
}
