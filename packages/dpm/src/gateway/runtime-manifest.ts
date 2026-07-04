import { createPostgresCatalogSnapshot } from '../catalog/postgres.js'
import type { CatalogSnapshot, PostgresCatalogSnapshotInput } from '../catalog/types.js'
import { compileDpmPlan, type DpmCompileResult } from '../compiler/compile.js'
import { createDpmDryRunReport, type DpmDryRunReport } from '../dry-run/report.js'
import { validateDpmManifest } from '../validator/manifest.js'
import type { DpmValidationResult } from '../validator/diagnostics.js'
import type {
  DpmGatewayRuntimeManifestInput,
  DpmGatewayRuntimeResponse,
} from './runtime.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'

export async function validateDpmManifestRuntime(
  input: DpmGatewayRuntimeManifestInput,
): Promise<DpmGatewayRuntimeResponse<DpmValidationResult>> {
  const result = validateDpmManifest({
    manifest: input.manifest,
    catalog: resolveCatalogSnapshot(input.catalog),
    registry: input.registry,
    phase: 'validate',
  })

  return createDpmGatewayRuntimeResponse({
    operationId: 'validateDpmManifest',
    statusCode: result.summary.errors > 0 ? 400 : 200,
    command: 'validate',
    result,
  })
}

export async function compileDpmManifestRuntime(
  input: DpmGatewayRuntimeManifestInput,
): Promise<DpmGatewayRuntimeResponse<DpmCompileResult>> {
  const result = compileDpmPlan({
    manifest: input.manifest,
    catalog: resolveCatalogSnapshot(input.catalog),
    registry: input.registry,
    phase: 'compile',
  })

  return createDpmGatewayRuntimeResponse({
    operationId: 'compileDpmManifest',
    statusCode: result.ok ? 200 : 400,
    command: 'compile',
    result,
  })
}

export async function dryRunDpmManifestRuntime(
  input: DpmGatewayRuntimeManifestInput,
): Promise<DpmGatewayRuntimeResponse<DpmCompileResult | DpmDryRunReport>> {
  const compiled = compileDpmPlan({
    manifest: input.manifest,
    catalog: resolveCatalogSnapshot(input.catalog),
    registry: input.registry,
    phase: 'dry_run',
  })
  if (!compiled.ok) {
    return createDpmGatewayRuntimeResponse({
      operationId: 'dryRunDpmManifest',
      statusCode: 400,
      command: 'dry-run',
      result: compiled,
    })
  }

  return createDpmGatewayRuntimeResponse({
    operationId: 'dryRunDpmManifest',
    statusCode: 200,
    command: 'dry-run',
    result: createDpmDryRunReport({
      plan: compiled.plan,
      ...(input.estimatedRows ? { estimatedRows: input.estimatedRows } : {}),
    }),
  })
}

function resolveCatalogSnapshot(catalog: CatalogSnapshot | PostgresCatalogSnapshotInput): CatalogSnapshot {
  if (isCatalogSnapshot(catalog)) return catalog
  return createPostgresCatalogSnapshot(catalog)
}

function isCatalogSnapshot(catalog: CatalogSnapshot | PostgresCatalogSnapshotInput): catalog is CatalogSnapshot {
  return 'kind' in catalog && catalog.kind === 'dpm.catalog.snapshot.v1'
}
