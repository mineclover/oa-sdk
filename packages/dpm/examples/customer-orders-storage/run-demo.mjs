#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  POSTGRES_CATALOG_PROFILE_SQL,
  compileDpmPlan,
  createDpmDryRunReport,
  createDpmJobRepository,
  createDpmReportRepository,
  createDpmRegistryRepository,
  profilePostgresCatalog,
  validateDpmManifest,
} from '../../dist/index.js'

const demoDir = dirname(fileURLToPath(import.meta.url))

const manifest = readJson('manifest.json')
const catalogRows = readJson('catalog-profile-rows.json')
const registryRows = readJson('relationship-registry-rows.json')
const estimatedRows = readJson('estimated-rows.json')
const jobRows = new Map()
const reportRows = new Map()
const steps = []

const catalog = await recordStep('profile catalog rows through explicit query client', async () => {
  const queryCalls = []
  const catalog = await profilePostgresCatalog({
    database: 'commerce',
    capturedAt: '2026-07-01T00:00:00.000Z',
    schemas: ['public'],
    client: {
      async query(sql, params) {
        queryCalls.push({ sql, params })
        return catalogRows
      },
    },
  })
  assertEqual(queryCalls[0]?.sql, POSTGRES_CATALOG_PROFILE_SQL, 'profile SQL')
  assertEqual(JSON.stringify(queryCalls[0]?.params), JSON.stringify([['public']]), 'profile params')
  manifest.catalog.version_hash = catalog.freshness.versionHash
  return {
    value: catalog,
    summary: {
      tables: catalog.tables.map(table => table.table),
      catalogVersionHash: catalog.freshness.versionHash,
      sourceDbMutation: 'none',
    },
  }
})

const registry = await recordStep('export approved registry snapshot from storage rows', async () => {
  const repository = createDpmRegistryRepository({
    listRelationshipRows(request) {
      return registryRows.filter(row =>
        row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
      )
    },
  })
  const snapshot = await repository.exportSnapshot({
    datasetId: manifest.relationship_registry.dataset_id,
    registryVersion: manifest.relationship_registry.registry_version,
    exportedAt: '2026-07-01T00:00:00.000Z',
  })
  return {
    value: snapshot,
    summary: {
      approvedRelationships: snapshot.approvedRelationships.map(relationship => relationship.name),
      nonExecutable: snapshot.nonExecutableRelationships.length,
    },
  }
})

const validation = await recordStep('validate storage-backed manifest', async () => {
  const result = validateDpmManifest({ manifest, catalog, registry })
  assertEqual(result.summary.errors, 0, 'validate errors')
  return {
    value: result,
    summary: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
    },
  }
})

const compiled = await recordStep('compile storage-backed plan', async () => {
  const result = compileDpmPlan({ manifest, catalog, registry })
  assertEqual(result.ok, true, 'compile ok')
  assertEqual(result.plan.stale, false, 'plan stale')
  return {
    value: result,
    summary: {
      planIdentity: result.plan.identity,
      freshness: result.plan.freshness,
    },
  }
})

const dryRun = await recordStep('persist dry-run impact and retrieve gateway report', async () => {
  const report = createDpmDryRunReport({
    plan: compiled.plan,
    estimatedRows,
    sampleValues: {
      customer_no: 'C-001',
    },
  })
  const jobRepository = createDpmJobRepository({
    upsertJob(row) {
      jobRows.set(row.jobId, row)
    },
    getJob(request) {
      return jobRows.get(request.jobId)
    },
  })
  const reportRepository = createDpmReportRepository({
    upsertReport(row) {
      reportRows.set(row.jobId, row)
    },
    getValidationReport(request) {
      return reportRows.get(request.jobId)
    },
  })
  const job = await jobRepository.saveJob({
    jobId: 'job_storage_demo_001',
    operation: 'dry_run',
    status: 'completed',
    datasetId: compiled.plan.datasetId,
    manifestId: compiled.plan.manifestId,
    planIdentity: compiled.plan.identity,
    freshness: compiled.plan.freshness,
    diagnostics: validation.diagnostics,
    validationReportRef: 'dpm-report:job_storage_demo_001',
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:00:01.000Z',
  })
  const stored = await reportRepository.saveReport({
    jobId: job.jobId,
    status: 'completed',
    validationReportRef: job.validationReportRef,
    diagnostics: validation.diagnostics,
    planIdentity: compiled.plan.identity,
    freshness: compiled.plan.freshness,
    impact: report.impact,
    categories: report.categories,
    createdAt: '2026-07-01T00:00:01.000Z',
    rawSamples: {
      customer_no: 'C-001',
    },
  })
  const jobReport = await reportRepository.getJobReport({ jobId: job.jobId })
  return {
    value: { report, stored, jobReport },
    summary: {
      impact: report.impact,
      rawValuesIncluded: report.rawValuesIncluded,
      storedImpact: stored.impact,
      jobReport,
    },
  }
})

const output = {
  demo: 'dpm.customer-orders-storage',
  description: 'Fixture-backed DPM storage integration without source DB mutation.',
  sourceDbMutation: 'none',
  persistedRawValues: false,
  steps,
  report: dryRun.jobReport,
}
assertNoUnsafePayload(output)
console.log(`${JSON.stringify(output, null, 2)}\n`)

async function recordStep(name, run) {
  const result = await run()
  const summary = result && typeof result === 'object' && 'summary' in result ? result.summary : result
  steps.push({
    name,
    status: 'pass',
    summary,
  })
  return result && typeof result === 'object' && 'value' in result ? result.value : result
}

function readJson(name) {
  return JSON.parse(readFileSync(join(demoDir, name), 'utf8'))
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function assertNoUnsafePayload(value) {
  const serialized = JSON.stringify(value)
  for (const unsafe of ['C-001', 'source-secret', 'vault-secret', 'tokenReverseLookup']) {
    if (serialized.includes(unsafe)) {
      throw new Error(`unsafe payload leaked into storage demo output: ${unsafe}`)
    }
  }
}
