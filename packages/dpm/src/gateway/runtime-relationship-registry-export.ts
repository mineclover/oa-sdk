import { createRegistrySnapshot } from '../registry/registry-snapshot-factory.js'
import type {
  DpmGatewayRegistrySnapshotExportInput,
  DpmGatewayRegistrySnapshotExportResult,
} from './runtime-relationship-types.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'

export async function exportDpmRegistrySnapshotRuntime(
  input: DpmGatewayRegistrySnapshotExportInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayRegistrySnapshotExportResult>> {
  const snapshot = await input.registryRepository.exportSnapshot({
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
  })
  const result = createRegistrySnapshot({
    datasetId: snapshot.datasetId,
    registryVersion: snapshot.registryVersion,
    ...(snapshot.exportedAt ? { exportedAt: snapshot.exportedAt } : {}),
    relationships: snapshot.relationships,
  })

  return createDpmGatewayRuntimeResponse({
    operationId: 'exportDpmRegistrySnapshot',
    statusCode: 200,
    command: 'export-registry-snapshot',
    result,
  })
}
