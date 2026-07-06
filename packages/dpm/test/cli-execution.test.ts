import { describe, expect, it } from 'vitest'

import { runDpmCli } from '../src/cli/index.js'
import {
  cliCatalogPath,
  cliManifestPath,
  cliRegistryPath,
  parseCliStdout,
} from './support/cli-fixtures.js'

describe('DPM CLI execution commands', () => {
  it('compiles and dry-runs fixture triplets with deterministic JSON output', async () => {
    const compile = await runDpmCli([
      'compile',
      '--manifest',
      cliManifestPath,
      '--catalog',
      cliCatalogPath,
      '--registry',
      cliRegistryPath,
    ])
    const compiled = parseCliStdout(compile.stdout)

    expect(compile.exitCode).toBe(0)
    expect(compiled.command).toBe('compile')
    expect(compiled.result.ok).toBe(true)
    expect(compiled.result.plan.stale).toBe(false)
    expect(compiled.result.plan.relationshipSteps.map((step: any) => step.name)).toEqual(['rel_orders_customer'])

    const dryRun = await runDpmCli([
      'dry-run',
      '--manifest',
      cliManifestPath,
      '--catalog',
      cliCatalogPath,
      '--registry',
      cliRegistryPath,
    ])
    const report = parseCliStdout(dryRun.stdout)

    expect(dryRun.exitCode).toBe(0)
    expect(report.command).toBe('dry-run')
    expect(report.result.kind).toBe('dpm.dry-run-report.v1')
    expect(report.result.impact).toMatchObject({
      namespaces: 1,
      relationships: 1,
      columns: 2,
      piiColumns: 2,
    })
    expect(JSON.stringify(report)).not.toContain('C-001')
  })
})
