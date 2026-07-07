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
  if (previousProfileBaseline.baselineRef && previousProfileBaseline.selectionStrategy) {
    throw new Error('profile analysis previousProfileBaseline must provide either baselineRef or selectionStrategy, not both')
  }
  if (previousProfileBaseline.selectionStrategy) {
    return resolveSelectedPreviousProfileArtifact(input)
  }
  if (!previousProfileBaseline.baselineRef) {
    throw new Error('profile analysis previousProfileBaseline must provide baselineRef or selectionStrategy')
  }
  if (previousProfileBaseline.limit !== undefined) {
    throw new Error('profile analysis previousProfileBaseline limit requires selectionStrategy')
  }

  const row = await input.profileBaselineRepository.getProfileBaseline({
    baselineRef: previousProfileBaseline.baselineRef,
  })
  if (!row) {
    throw new Error(`profile baseline not found: ${previousProfileBaseline.baselineRef}`)
  }

  return row.profileArtifact
}

async function resolveSelectedPreviousProfileArtifact(input: {
  request: DpmGatewayProfileAnalysisRequest
  profileBaselineRepository?: DpmGatewayProfileAnalysisBaselineResolver
}) {
  const previousProfileBaseline = input.request.previousProfileBaseline
  if (previousProfileBaseline?.selectionStrategy !== 'latest_previous') {
    throw new Error(`unsupported profile baseline selection strategy: ${previousProfileBaseline?.selectionStrategy}`)
  }
  if (!input.profileBaselineRepository?.selectPreviousProfileBaseline) {
    throw new Error('profile baseline selector is required to resolve previousProfileBaseline selectionStrategy')
  }

  const row = await input.profileBaselineRepository.selectPreviousProfileBaseline({
    profileArtifact: input.request.profileArtifact,
    ...(previousProfileBaseline.limit !== undefined ? { limit: previousProfileBaseline.limit } : {}),
  })
  if (!row) {
    throw new Error('profile baseline selection did not find a previous baseline: latest_previous')
  }

  return row.profileArtifact
}
