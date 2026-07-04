import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runDpmCli } from '../src/cli/index.js'

const demoRoot = new URL('../examples/customer-orders/', import.meta.url)
const manifestPath = join(demoRoot.pathname, 'manifest.json')
const catalogPath = join(demoRoot.pathname, 'catalog.snapshot.json')
const registryPath = join(demoRoot.pathname, 'relationship-registry.yaml')
const estimatedRowsPath = join(demoRoot.pathname, 'estimated-rows.json')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

function parseStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

describe('DPM customer orders demo', () => {
  it('ships a runnable primary-use demo surface', () => {
    expect(existsSync(join(demoRoot.pathname, 'README.md'))).toBe(true)
    expect(existsSync(join(demoRoot.pathname, 'run-demo.mjs'))).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(catalogPath)).toBe(true)
    expect(existsSync(registryPath)).toBe(true)
    expect(existsSync(estimatedRowsPath)).toBe(true)
  })

  it('runs the documented primary demo command', () => {
    const result = spawnSync('corepack', ['pnpm', 'run', 'demo'], {
      cwd: packageRoot,
      encoding: 'utf8',
    })
    const marker = '{\n  "demo": "dpm.customer-orders"'
    const outputStart = result.stdout.indexOf(marker)
    const output = outputStart >= 0 ? JSON.parse(result.stdout.slice(outputStart)) : undefined

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(output?.steps.every((step: Record<string, unknown>) => step.status === 'pass')).toBe(true)
  })

  it('validates, compiles, and dry-runs the demo without touching a source DB', async () => {
    const validate = await runDpmCli([
      'validate',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
    ])
    const validated = parseStdout(validate.stdout)

    expect(validate.exitCode).toBe(0)
    expect(validated.result.summary).toEqual({ errors: 0, warnings: 0, infos: 0 })

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
    expect(compiled.result.ok).toBe(true)
    expect(compiled.result.plan.stale).toBe(false)
    expect(compiled.result.plan.namespaceBindings).toEqual([
      expect.objectContaining({
        namespace: 'customer',
        relationships: ['rel_orders_customer'],
        columns: ['public.customers.customer_no', 'public.orders.customer_no'],
      }),
    ])

    const dryRun = await runDpmCli([
      'dry-run',
      '--manifest',
      manifestPath,
      '--catalog',
      catalogPath,
      '--registry',
      registryPath,
      '--estimated-rows',
      estimatedRowsPath,
    ])
    const dryRunReport = parseStdout(dryRun.stdout)

    expect(dryRun.exitCode).toBe(0)
    expect(dryRunReport.result.impact).toEqual({
      namespaces: 1,
      relationships: 1,
      columns: 2,
      piiColumns: 2,
      estimatedRows: 7000,
    })
    expect(dryRunReport.result.rawValuesIncluded).toBe(false)
  })
})
