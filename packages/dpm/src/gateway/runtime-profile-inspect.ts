import type {
  DpmGatewayProfileInspectionInput,
  DpmGatewayProfileInspectionResult,
} from './runtime-profile-types.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'

export async function inspectDpmProfileRuntime(
  input: DpmGatewayProfileInspectionInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileInspectionResult>> {
  return createDpmGatewayRuntimeResponse({
    operationId: 'inspectDpmProfile',
    statusCode: 200,
    command: 'inspect-profile',
    result: {
      profileArtifact: input.profileArtifact,
      nodeCount: input.profileArtifact.nodes.length,
      edgeCount: input.profileArtifact.edges.length,
      metricCount: input.profileArtifact.metrics.length,
      diagnostics: [...input.profileArtifact.diagnostics],
    },
  })
}
