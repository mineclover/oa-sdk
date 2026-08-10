import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packageDirectory = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-codegen-pack-'))

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temporaryDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit',
  })

  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error(`expected one packed archive, received ${archives.length}`)

  const archive = join(temporaryDirectory, archives[0])
  const files = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(file => file.replace(/^package\//, '')))
  const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))

  const expected = new Set(['package.json', 'README.md', 'LICENSE'])
  for (const entry of Object.values(manifest.exports)) {
    expected.add(stripRelativePrefix(entry.import))
    expected.add(stripRelativePrefix(entry.types))
  }
  for (const entry of Object.values(manifest.bin ?? {})) expected.add(stripRelativePrefix(entry))

  const missing = [...expected].filter(file => !files.has(file))
  const outsideBoundary = [...files].filter(file => file !== 'package.json' && file !== 'README.md' && file !== 'LICENSE' && !file.startsWith('dist/'))
  const workspaceDependency = Object.entries({
    ...(packedManifest.dependencies ?? {}),
    ...(packedManifest.optionalDependencies ?? {}),
    ...(packedManifest.peerDependencies ?? {}),
  }).find(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))

  if (missing.length > 0) throw new Error(`packed oa-gen is missing expected files: ${missing.join(', ')}`)
  if (outsideBoundary.length > 0) throw new Error(`packed oa-gen has files outside its boundary: ${outsideBoundary.join(', ')}`)
  if (workspaceDependency) throw new Error(`packed oa-gen retains workspace protocol: ${workspaceDependency[0]}=${workspaceDependency[1]}`)

  console.log(`OA Gen pack smoke OK: ${files.size} files, no workspace protocols`)
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

function stripRelativePrefix(value) {
  return value.startsWith('./') ? value.slice(2) : value
}
