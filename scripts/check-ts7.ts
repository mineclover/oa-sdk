/**
 * Run the latest toolchain lane without replacing the stable TypeScript 5
 * compiler used by ordinary workspace builds and declaration emission.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'packages/ttsc-compile-fixture')
const fixtureRequire = createRequire(join(fixtureDir, 'package.json'))
const ttscPackagePath = fixtureRequire.resolve('ttsc/package.json')
const ttscPackage = JSON.parse(readFileSync(ttscPackagePath, 'utf8')) as {
  bin?: { ttsc?: string }
}
const ttscBin = ttscPackage.bin?.ttsc

if (!ttscBin) throw new Error('ttsc package does not expose a ttsc executable.')

const ttscEntrypoint = join(dirname(ttscPackagePath), ttscBin)
const corePackages = [
  'core',
  'openapi-projection-contract',
  'spec-lens-contract',
  'typespec-decorators',
  'parser',
  'codegen',
  'spec-lens',
] as const

for (const packageName of corePackages) {
  const project = join(root, 'packages', packageName, 'tsconfig.json')
  if (!existsSync(project)) throw new Error(`missing TS 7 project config: ${project}`)

  console.log(`\n[ts7] ${packageName}`)
  const result = spawnSync(process.execPath, [ttscEntrypoint, '--noEmit', '--project', project], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`\nTS 7/ttsc source compatibility OK: ${corePackages.length} Core TypeScript packages.`)
