import { describe, expect, it } from 'vitest'

import { createDpmGatewayRuntime } from '../src/index.js'
import { runDpmCli } from '../src/cli/index.js'
import {
  catalogPath,
  createRuntimeInput,
  manifestPath,
  parseStdout,
  registryPath,
} from './support/gateway-runtime-fixtures.js'

describe('DPM gateway manifest runtime adapter', () => {
  it('serves validate with the same machine-readable body as the CLI', async () => {
    const runtime = createDpmGatewayRuntime()
    const response = await runtime.validateDpmManifest(createRuntimeInput())
    const cli = await runDpmCli([
      'validate',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual(parseStdout(cli.stdout))
  })

  it('serves compile and dry-run with CLI-equivalent payloads without source DB access', async () => {
    const runtime = createDpmGatewayRuntime()
    const input = createRuntimeInput()

    const compile = await runtime.compileDpmManifest(input)
    const cliCompile = await runDpmCli([
      'compile',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(compile.statusCode).toBe(200)
    expect(compile.body).toEqual(parseStdout(cliCompile.stdout))

    const dryRun = await runtime.dryRunDpmManifest(input)
    const cliDryRun = await runDpmCli([
      'dry-run',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])

    expect(dryRun.statusCode).toBe(200)
    expect(dryRun.body).toEqual(parseStdout(cliDryRun.stdout))
    expect(JSON.stringify(dryRun.body)).not.toContain('C-001')
  })

  it('returns blocking diagnostics as a structured runtime response', async () => {
    const runtime = createDpmGatewayRuntime()
    const input = createRuntimeInput()
    const manifest = input.manifest as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }

    const response = await runtime.validateDpmManifest({
      ...input,
      manifest,
    })

    expect(response.statusCode).toBe(400)
    expect(response.body.command).toBe('validate')
    expect(response.body.result.valid).toBe(false)
    expect(response.body.result.diagnostics.map((diagnostic: any) => diagnostic.code)).toContain('SAF001')
  })
})
