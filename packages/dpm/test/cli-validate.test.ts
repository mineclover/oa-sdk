import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runDpmCli } from '../src/cli/index.js'
import {
  cliCatalogPath,
  cliManifestPath,
  cliRegistryPath,
  parseCliStdout,
} from './support/cli-fixtures.js'

describe('DPM CLI validate command', () => {
  it('validates fixture triplets as machine-readable JSON without DB access', async () => {
    const result = await runDpmCli([
      'validate',
      '--manifest',
      cliManifestPath,
      '--catalog',
      cliCatalogPath,
      '--registry',
      cliRegistryPath,
    ])
    const output = parseCliStdout(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(output.command).toBe('validate')
    expect(output.result.valid).toBe(true)
    expect(output.result.summary).toEqual({ errors: 0, warnings: 1, infos: 0 })
    expect(output.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toEqual(['SAF007'])
  })

  it('exits non-zero for blocking REL/SAF diagnostics', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'oa-dpm-cli-'))
    const manifest = JSON.parse(readFileSync(cliManifestPath, 'utf8')) as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }
    const invalidManifestPath = join(tempDir, 'invalid-manifest.json')
    writeFileSync(invalidManifestPath, JSON.stringify(manifest, null, 2))

    const result = await runDpmCli([
      'validate',
      '--manifest',
      invalidManifestPath,
      '--catalog',
      cliCatalogPath,
      '--registry',
      cliRegistryPath,
    ])
    const output = parseCliStdout(result.stdout)

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
      cliCatalogPath,
      '--registry',
      cliRegistryPath,
    ])
    const output = parseCliStdout(result.stdout)

    expect(result.exitCode).toBe(1)
    expect(output.result.valid).toBe(false)
    expect(output.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SYN001')
  })
})
