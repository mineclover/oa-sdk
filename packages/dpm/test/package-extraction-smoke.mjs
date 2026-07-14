import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const fixturePath = fileURLToPath(new URL('./external-consumer-fixture.mjs', import.meta.url))
const tempDir = mkdtempSync(join(tmpdir(), 'oa-sdk-dpm-extraction-'))
const packageArchiveDir = join(tempDir, 'archive')
const packedPackageDir = join(tempDir, 'packed-package')
const consumerDir = join(tempDir, 'consumer')
const packageInstallDir = join(consumerDir, 'node_modules', '@oa-sdk', 'dpm')

try {
  mkdirSync(packageArchiveDir, { recursive: true })
  mkdirSync(packedPackageDir, { recursive: true })
  const packResult = JSON.parse(execFileSync('npm', [
    'pack',
    '--json',
    '--pack-destination',
    packageArchiveDir,
  ], {
    cwd: packageDir,
    encoding: 'utf8',
  }))
  const archiveName = packResult[0]?.filename
  if (!archiveName) throw new Error('npm pack did not return an archive filename')

  execFileSync('tar', [
    '-xzf',
    join(packageArchiveDir, archiveName),
    '--strip-components=1',
    '-C',
    packedPackageDir,
  ])
  execFileSync('corepack', [
    'pnpm',
    'deploy',
    '--legacy',
    '--filter',
    '@oa-sdk/dpm',
    '--prod',
    consumerDir,
  ], {
    cwd: packageDir,
    stdio: 'ignore',
  })
  rmSync(join(consumerDir, 'dist'), { recursive: true, force: true })
  cpSync(join(packedPackageDir, 'dist'), join(consumerDir, 'dist'), { recursive: true })
  copyFileSync(join(packedPackageDir, 'package.json'), join(consumerDir, 'package.json'))
  copyFileSync(join(packedPackageDir, 'README.md'), join(consumerDir, 'README.md'))
  mkdirSync(join(consumerDir, 'node_modules', '@oa-sdk'), { recursive: true })
  rmSync(packageInstallDir, { recursive: true, force: true })
  symlinkSync('../../..', packageInstallDir, 'dir')
  copyFileSync(fixturePath, join(consumerDir, 'consumer.mjs'))

  const manifest = JSON.parse(readFileSync(join(consumerDir, 'package.json'), 'utf8'))
  if (manifest.name !== '@oa-sdk/dpm') throw new Error('packed package name does not match @oa-sdk/dpm')
  if (!manifest.exports?.['./data'] || !manifest.exports?.['./relationship']) {
    throw new Error('packed package is missing the public data/relationship subpaths')
  }

  const output = execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: consumerDir,
    encoding: 'utf8',
  }).trim()
  const result = JSON.parse(output)
  if (result.status !== 'ok') throw new Error('external consumer fixture did not complete')
  console.log(JSON.stringify({
    status: 'ok',
    archive: archiveName,
    consumer: result,
  }, null, 2))
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
