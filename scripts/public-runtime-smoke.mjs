#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const supportedRuntimeMajors = [22, 24, 26]

const [mode, directoryArgument, expectedMajorArgument] = process.argv.slice(2)
assert(mode === 'prepare' || mode === 'verify', 'usage: public-runtime-smoke.mjs <prepare|verify> <directory> [expected-node-major]')
assert(directoryArgument, 'runtime smoke directory is required')

const smokeDirectory = resolve(directoryArgument)
if (mode === 'prepare') prepare(smokeDirectory)
else verify(smokeDirectory, expectedMajorArgument)

function prepare(directory) {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'release artifacts must be prepared with the Node >=24 development toolchain')
  assert(!existsSync(directory) || readdirSync(directory).length === 0, `prepare directory must be empty: ${directory}`)

  const tarballDirectory = join(directory, 'tarballs')
  const consumerDirectory = join(directory, 'consumer')
  mkdirSync(tarballDirectory, { recursive: true })
  mkdirSync(consumerDirectory, { recursive: true })

  const policy = readJson(join(root, 'docs/internal/release-policy.json'))
  const candidates = policy.distributionCandidates
  assert(Array.isArray(candidates) && candidates.length > 0, 'release policy has no distribution candidates')

  const workspaces = readWorkspacePackages()
  const packedPackages = []
  for (const name of candidates) {
    const workspace = workspaces.get(name)
    assert(workspace, `distribution candidate does not resolve to a workspace: ${name}`)
    const { directory: packageDirectory, manifest } = workspace
    assert(manifest.private === false, `${name}: distribution candidate must be public`)
    assertSupportsNode22(manifest, name)
    assertManifestTargetsExist(packageDirectory, manifest, name)

    const previousArchives = new Set(readdirSync(tarballDirectory))
    run('pnpm', ['pack', '--pack-destination', tarballDirectory], packageDirectory)
    const archives = readdirSync(tarballDirectory)
      .filter(file => file.endsWith('.tgz') && !previousArchives.has(file))
    assert.equal(archives.length, 1, `${name}: expected exactly one packed archive`)

    const archive = join(tarballDirectory, archives[0])
    const packedManifest = JSON.parse(runCapture('tar', ['-xOf', archive, 'package/package.json'], root))
    assert.equal(packedManifest.name, name, `${name}: packed manifest name changed`)
    assertSupportsNode22(packedManifest, name)
    assert(!containsWorkspaceProtocol(packedManifest), `${name}: packed manifest retains a workspace: dependency`)
    assertPackedTargetsExist(archive, packedManifest, name)
    packedPackages.push({ name, archive: basename(archive) })
  }

  writeJson(join(consumerDirectory, 'package.json'), {
    name: 'oa-sdk-public-runtime-smoke-consumer',
    private: true,
    type: 'module',
  })
  runIsolatedNpm([
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    ...packedPackages.map(entry => join(tarballDirectory, entry.archive)),
  ], consumerDirectory)

  const installed = packedPackages.map(({ name }) => {
    const manifestPath = join(consumerDirectory, 'node_modules', ...name.split('/'), 'package.json')
    const manifest = readJson(manifestPath)
    return {
      name,
      specifiers: publicImportSpecifiers(name, manifest),
    }
  })
  writeJson(join(directory, 'runtime-smoke.json'), {
    preparedWithNode: process.versions.node,
    supportedRuntimeMajors,
    packages: installed.map(({ name, specifiers }) => ({ name, specifiers })),
  })

  console.log(
    `Public runtime smoke prepared with Node ${process.versions.node}: ` +
      `${installed.length} packed packages, ${installed.flatMap(entry => entry.specifiers).length} public imports.`,
  )
}

function verify(directory, expectedMajorValue) {
  const expectedMajor = Number(expectedMajorValue)
  assert(supportedRuntimeMajors.includes(expectedMajor), `expected Node major must be one of ${supportedRuntimeMajors.join(', ')}`)
  const actualMajor = Number(process.versions.node.split('.')[0])
  assert.equal(actualMajor, expectedMajor, `runtime matrix selected Node ${actualMajor}, expected Node ${expectedMajor}`)

  const metadata = readJson(join(directory, 'runtime-smoke.json'))
  assert.deepEqual(metadata.supportedRuntimeMajors, supportedRuntimeMajors)
  assert(
    Number(String(metadata.preparedWithNode).split('.')[0]) >= 24,
    `consumer must be prepared with the Node >=24 development toolchain, received ${metadata.preparedWithNode}`,
  )
  const consumerDirectory = join(directory, 'consumer')
  const specifiers = metadata.packages.flatMap(entry => entry.specifiers)
  assert(specifiers.length > 0, 'runtime smoke metadata has no public imports')

  const probePath = join(consumerDirectory, 'runtime-probe.mjs')
  writeFileSync(
    probePath,
    `import assert from 'node:assert/strict'\n` +
      `const specifiers = ${JSON.stringify(specifiers)}\n` +
      `for (const specifier of specifiers) {\n` +
      `  const surface = await import(specifier)\n` +
      `  assert(Object.keys(surface).length > 0, \`\${specifier} has no runtime exports\`)\n` +
      `}\n` +
      `console.log(\`Imported \${specifiers.length} public root/subpath surfaces.\`)\n`,
    'utf8',
  )
  run(process.execPath, [probePath], consumerDirectory)

  const codegenDirectory = join(consumerDirectory, 'node_modules', '@oa-sdk', 'codegen')
  const codegenManifest = readJson(join(codegenDirectory, 'package.json'))
  const cliTarget = codegenManifest.bin?.['oa-gen']
  assert(typeof cliTarget === 'string', '@oa-sdk/codegen: oa-gen bin target is missing')
  const cliPath = join(codegenDirectory, stripRelativePrefix(cliTarget))
  assert(existsSync(cliPath), `@oa-sdk/codegen: oa-gen bin target does not exist: ${cliTarget}`)

  const help = runCapture(process.execPath, [cliPath, '--help'], consumerDirectory)
  assert(help.includes('validate') && help.includes('typegen'), 'oa-gen --help is missing validate/typegen')

  const specPath = join(consumerDirectory, 'runtime.openapi.json')
  const generatedPath = join(consumerDirectory, `generated-types-node-${actualMajor}.ts`)
  writeJson(specPath, {
    openapi: '3.2.0',
    info: { title: 'Public runtime compatibility', version: '1.0.0' },
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: {
            200: {
              description: 'Healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Health: {
          type: 'object',
          required: ['ok'],
          properties: { ok: { type: 'boolean' } },
        },
      },
    },
  })
  run(process.execPath, [cliPath, 'validate', '--spec', specPath, '--require-32'], consumerDirectory)
  run(process.execPath, [cliPath, 'typegen', '--spec', specPath, '--output', generatedPath], consumerDirectory)
  assert(readFileSync(generatedPath, 'utf8').includes('export type Health'), 'oa-gen typegen produced no Health type')

  console.log(
    `Public runtime compatibility OK on Node ${process.versions.node}: ` +
      `${metadata.packages.length} packages, ${specifiers.length} public imports, oa-gen CLI.`,
  )
}

function readWorkspacePackages() {
  const packages = new Map()
  for (const base of ['packages', 'apps']) {
    const baseDirectory = join(root, base)
    if (!existsSync(baseDirectory)) continue
    for (const entry of readdirSync(baseDirectory).sort()) {
      const directory = join(baseDirectory, entry)
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath)
      if (typeof manifest.name === 'string') packages.set(manifest.name, { directory, manifest })
    }
  }
  return packages
}

function assertSupportsNode22(manifest, name) {
  const range = manifest.engines?.node
  assert(typeof range === 'string', `${name}: engines.node is required`)
  const match = /^\s*>=\s*(\d+)(?:\.\d+)?(?:\.\d+)?\s*$/.exec(range)
  assert(match && Number(match[1]) === 22, `${name}: engines.node must retain the public Node >=22 floor, received ${range}`)
}

function assertManifestTargetsExist(packageDirectory, manifest, name) {
  for (const target of collectManifestTargets(manifest)) {
    assert(existsSync(join(packageDirectory, target)), `${name}: build output is missing manifest target ${target}`)
  }
}

function assertPackedTargetsExist(archive, manifest, name) {
  const files = new Set(
    runCapture('tar', ['-tzf', archive], root)
      .trim()
      .split('\n')
      .filter(Boolean),
  )
  for (const target of collectManifestTargets(manifest)) {
    assert(files.has(`package/${target}`), `${name}: packed archive is missing manifest target ${target}`)
  }
}

function collectManifestTargets(manifest) {
  const targets = new Set()
  for (const field of ['main', 'module', 'types', 'exports', 'bin']) addRelativeTargets(targets, manifest[field])
  return [...targets].sort()
}

function addRelativeTargets(targets, value) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) targets.add(stripRelativePrefix(value))
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) addRelativeTargets(targets, entry)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) addRelativeTargets(targets, entry)
  }
}

function publicImportSpecifiers(packageName, manifest) {
  const packageExports = manifest.exports
  if (typeof packageExports === 'string' || !packageExports || typeof packageExports !== 'object') {
    return [packageName]
  }
  return Object.keys(packageExports)
    .filter(subpath => (subpath === '.' || subpath.startsWith('./')) && !subpath.includes('*') && subpath !== './package.json')
    .map(subpath => subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`)
    .sort()
}

function containsWorkspaceProtocol(value) {
  if (typeof value === 'string') return value.startsWith('workspace:')
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol)
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsWorkspaceProtocol))
}

function stripRelativePrefix(value) {
  return value.startsWith('./') ? value.slice(2) : value
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function run(executable, args, cwd) {
  execFileSync(executable, args, { cwd, stdio: 'inherit' })
}

function runCapture(executable, args, cwd) {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function runIsolatedNpm(args, cwd) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('npm_config_') || normalized.startsWith('pnpm_config_')) delete environment[key]
  }
  execFileSync('npm', args, { cwd, env: environment, stdio: 'inherit' })
}
