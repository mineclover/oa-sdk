import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runDpmCli } from '../src/cli/index.js'

const fixturesRoot = new URL('./fixtures/', import.meta.url)
const manifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
const catalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
const registryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')

function parseStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

describe('DPM CLI', () => {
  it('validates fixture triplets as machine-readable JSON without DB access', async () => {
    const result = await runDpmCli([
      'validate',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const output = parseStdout(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(output.command).toBe('validate')
    expect(output.result.valid).toBe(true)
    expect(output.result.summary).toEqual({ errors: 0, warnings: 1, infos: 0 })
    expect(output.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toEqual(['SAF007'])
  })

  it('exits non-zero for blocking REL/SAF diagnostics', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'oa-dpm-cli-'))
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }
    const invalidManifestPath = join(tempDir, 'invalid-manifest.json')
    writeFileSync(invalidManifestPath, JSON.stringify(manifest, null, 2))

    const result = await runDpmCli([
      'validate',
      '--manifest',
      invalidManifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const output = parseStdout(result.stdout)

    expect(result.exitCode).toBe(1)
    expect(output.result.valid).toBe(false)
    expect(output.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SAF001')
  })

  it('exits non-zero when the manifest fails the JSON Schema gate', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'oa-dpm-cli-schema-'))
    const malformedManifestPath = join(tempDir, 'malformed-manifest.json')
    writeFileSync(malformedManifestPath, JSON.stringify({
      scope: {
        include_tables: ['public.customers'],
      },
      relationships: [],
      columns: [],
      quality_gates: [
        {
          name: 'relationship_drift',
        },
      ],
    }, null, 2))

    const result = await runDpmCli([
      'validate',
      '--manifest',
      malformedManifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const output = parseStdout(result.stdout)

    expect(result.exitCode).toBe(1)
    expect(output.result.valid).toBe(false)
    expect(output.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SYN001')
  })

  it('compiles and dry-runs fixture triplets with deterministic JSON output', async () => {
    const compile = await runDpmCli([
      'compile',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const compiled = parseStdout(compile.stdout)

    expect(compile.exitCode).toBe(0)
    expect(compiled.command).toBe('compile')
    expect(compiled.result.ok).toBe(true)
    expect(compiled.result.plan.stale).toBe(false)
    expect(compiled.result.plan.relationshipSteps.map((step: any) => step.name)).toEqual(['rel_orders_customer'])

    const dryRun = await runDpmCli([
      'dry-run',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const report = parseStdout(dryRun.stdout)

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
