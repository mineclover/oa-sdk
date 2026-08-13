/**
 * Cross-repository evidence only: export the Bun Graph DB fixed table
 * operation contract and consume it through OA SDK's parser, generators,
 * routers, client, and mock server. Bun Graph DB stays standalone; this is an
 * opt-in monorepo verification command rather than a runtime dependency.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const graphDbRoot = join(root, 'references', 'bun-graph-db')
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-bun-graph-db-downstream-'))
const artifact = join(workspace, 'project_tasks.operation-contract.openapi.json')

try {
  if (!existsSync(join(graphDbRoot, 'package.json'))) {
    throw new Error(
      'Bun Graph DB submodule is unavailable. Run git submodule update --init --recursive before graph-db:downstream-check.',
    )
  }

  await run('bun', [
    'run',
    'projection:export',
    '--',
    '--out',
    workspace,
    '--strict',
  ], graphDbRoot)

  await run('bun', [
    'run',
    'contract:typespec:model-check',
    '--',
    '--compiler',
    join(root, 'node_modules', '.bin', 'tsp'),
  ], graphDbRoot)

  await run(process.execPath, [
    '--import',
    'tsx',
    'scripts/schema-typespec-downstream-check.ts',
    '--spec',
    artifact,
  ], root)

  console.log(`Bun Graph DB operation-contract downstream check passed: ${artifact}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolveRun()
      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit ${code ?? 'unknown'}`}`))
    })
  })
}
