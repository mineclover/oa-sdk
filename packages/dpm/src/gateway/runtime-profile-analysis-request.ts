import type { DpmGatewayProfileAnalysisInput } from './runtime-profile-types.js'
import type {
  DpmGatewayProfileAnalysisBaselineResolver,
  DpmGatewayProfileAnalysisRequest,
} from './runtime-profile-analysis-request-types.js'

export type {
  DpmGatewayProfileAnalysisBaselineResolver,
  DpmGatewayProfileAnalysisRequest,
  DpmGatewayProfileBaselineRef,
} from './runtime-profile-analysis-request-types.js'

export async function resolveDpmGatewayProfileAnalysisRuntimeInput(input: {
  request: DpmGatewayProfileAnalysisRequest
  profileBaselineRepository?: DpmGatewayProfileAnalysisBaselineResolver
}): Promise<DpmGatewayProfileAnalysisInput> {
  const previousProfileArtifact = await resolvePreviousProfileArtifact(input)

  return {
    profileArtifact: input.request.profileArtifact,
    ...(previousProfileArtifact ? { previousProfileArtifact } : {}),
    ...(input.request.reportId ? { reportId: input.request.reportId } : {}),
    ...(input.request.analyzedAt ? { analyzedAt: input.request.analyzedAt } : {}),
  }
}

async function resolvePreviousProfileArtifact(input: {
  request: DpmGatewayProfileAnalysisRequest
  profileBaselineRepository?: DpmGatewayProfileAnalysisBaselineResolver
}) {
  const { previousProfileArtifact, previousProfileBaseline } = input.request
  if (!previousProfileBaseline) return previousProfileArtifact
  if (previousProfileArtifact) {
    throw new Error('profile analysis request must provide either previousProfileArtifact or previousProfileBaseline, not both')
  }
  if (!input.profileBaselineRepository) {
    throw new Error('profile baseline repository is required to resolve previousProfileBaseline')
  }

  const row = await input.profileBaselineRepository.getProfileBaseline({
    baselineRef: previousProfileBaseline.baselineRef,
  })
  if (!row) {
    throw new Error(`profile baseline not found: ${previousProfileBaseline.baselineRef}`)
  }

  return row.profileArtifact
}
