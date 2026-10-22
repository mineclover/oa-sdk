/**
 * Keeps a package's hand-written runtime version constant in sync with its package.json.
 *
 * Changesets bumps package.json but cannot see source constants. `@oa-sdk/webmcp-peer` shipped
 * 0.2.0 while its client still announced `clientInfo.version: "0.1.0"`. `version-packages` runs
 * this script with `--write`, and CI/preflight run it as a check.
 *
 * Only `export const PACKAGE_VERSION = "..."` (in packages/<name>/src) is touched; protocol and
 * schema versions are unrelated.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')
const write = process.argv.includes('--write')
const pattern = /(export const PACKAGE_VERSION\s*=\s*)(['"])([^'"]*)\2/g
const drift: Array<{ file: string; expected: string; actual: string }> = []

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) yield* sourceFiles(path)
    else if (path.endsWith('.ts')) yield path
  }
}

for (const name of readdirSync(packagesDir).sort()) {
  const packageDir = join(packagesDir, name)
  let manifest: { version?: unknown }
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version?: unknown }
  } catch {
    continue
  }
  if (typeof manifest.version !== 'string') continue
  const srcDir = join(packageDir, 'src')
  let files: string[] = []
  try {
    files = [...sourceFiles(srcDir)]
  } catch {
    continue
  }
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    let next = source
    let changed = false
    for (const match of source.matchAll(pattern)) {
      if (match[3] === manifest.version) continue
      drift.push({ file: relative(root, file), expected: manifest.version, actual: match[3] ?? '' })
      if (write) {
        next = next.replace(match[0], `${match[1]}${match[2]}${manifest.version}${match[2]}`)
        changed = true
      }
    }
    if (changed) writeFileSync(file, next)
  }
}

if (drift.length === 0) {
  console.log('Package version constants are in sync.')
  process.exit(0)
}
for (const item of drift) {
  console.log(`${item.file}: PACKAGE_VERSION is "${item.actual}", package.json is "${item.expected}"`)
}
if (write) {
  console.log(`Updated ${drift.length} package version constant(s).`)
  process.exit(0)
}
console.error('Run `pnpm version-packages` or `node --import tsx scripts/sync-package-versions.ts --write`.')
process.exit(1)
