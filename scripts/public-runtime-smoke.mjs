#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { consumerProbeSource } from './lib/public-import-probe.mjs'
import {
  collectManifestTargets,
  consumerPeerDependencies,
  declaredOptionalPeerImports,
  publicNodeEngineIssue,
} from './lib/public-manifest.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const supportedRuntimeMajors = [22, 24, 26]
const OPTIONAL_PEER_CONSUMER = 'optional-peer-consumer'

const [mode, directoryArgument, expectedMajorArgument] = process.argv.slice(2)
assert(mode === 'prepare' || mode === 'verify', 'usage: public-runtime-smoke.mjs <prepare|verify> <directory> [expected-node-major]')
assert(directoryArgument, 'runtime smoke directory is required')

const smokeDirectory = resolve(directoryArgument)
if (mode === 'prepare') prepare(smokeDirectory)
else await verify(smokeDirectory, expectedMajorArgument)

function prepare(directory) {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'release artifacts must be prepared with the Node >=24 development toolchain')
  assert(!existsSync(directory) || readdirSync(directory).length === 0, `prepare directory must be empty: ${directory}`)

  const tarballDirectory = join(directory, 'tarballs')
  const consumerDirectory = join(directory, 'consumer')
  mkdirSync(tarballDirectory, { recursive: true })

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
    packedPackages.push({ name, archive: basename(archive), manifest: packedManifest })
  }

  // `consumer` gets what a consumer's package manager installs with the packed
  // packages: their dependencies and required peers, not their optional peers.
  // Every public entry point must import there, except the ones release-policy.json
  // declares under optionalPeerEntryPoints. Those are imported in
  // `optional-peer-consumer`, which also has the optional peers they declare.
  const archives = packedPackages.map(entry => join(tarballDirectory, entry.archive))
  const manifests = packedPackages.map(entry => entry.manifest)
  const optionalPeerImports = packedPackages.flatMap(({ name }) =>
    declaredOptionalPeerImports(policy.optionalPeerEntryPoints, name))
  installConsumer(consumerDirectory, consumerPeerDependencies(manifests), archives)
  if (optionalPeerImports.length > 0) {
    const optionalPeers = [...new Set(optionalPeerImports.flatMap(({ peers }) => peers))]
    installConsumer(
      join(directory, OPTIONAL_PEER_CONSUMER),
      consumerPeerDependencies(manifests, { optionalPeers }),
      archives,
    )
  }

  const installed = packedPackages.map(({ name }) => {
    const manifestPath = join(consumerDirectory, 'node_modules', ...name.split('/'), 'package.json')
    const manifest = readJson(manifestPath)
    return {
      name,
      specifiers: publicImportSpecifiers(name, manifest),
    }
  })
  const publicSpecifiers = new Set(installed.flatMap(entry => entry.specifiers))
  for (const { specifier } of optionalPeerImports) {
    assert(publicSpecifiers.has(specifier), `optionalPeerEntryPoints declares ${specifier}, which is not a public entry point`)
  }
  writeJson(join(directory, 'runtime-smoke.json'), {
    preparedWithNode: process.versions.node,
    supportedRuntimeMajors,
    packages: installed.map(({ name, specifiers }) => ({ name, specifiers })),
    optionalPeerImports,
  })

  console.log(
    `Public runtime smoke prepared with Node ${process.versions.node}: ` +
      `${installed.length} packed packages, ${publicSpecifiers.size} public imports ` +
      `(${optionalPeerImports.length} that need optional peers).`,
  )
}

/** Installs the packed `archives` into a new consumer at `directory`, with `dependencies` (the peers it adds). */
function installConsumer(directory, dependencies, archives) {
  mkdirSync(directory, { recursive: true })
  writeJson(join(directory, 'package.json'), {
    name: 'oa-sdk-public-runtime-smoke-consumer',
    private: true,
    type: 'module',
    dependencies,
  })
  // With --legacy-peer-deps npm installs no peer itself: `dependencies` names
  // the ones this consumer gets.
  runIsolatedNpm([
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    ...archives,
  ], directory)
}

async function verify(directory, expectedMajorValue) {
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
  assert(Array.isArray(metadata.optionalPeerImports), 'runtime smoke metadata has no optionalPeerImports list')
  const optionalPeerSpecifiers = new Set(metadata.optionalPeerImports.map(({ specifier }) => specifier))

  // Without optional peers, every entry point imports but the declared ones,
  // which fail for want of the optional peers they declare.
  runImportProbe(consumerDirectory, {
    imports: specifiers.filter(specifier => !optionalPeerSpecifiers.has(specifier)),
    withoutOptionalPeers: metadata.optionalPeerImports,
  })
  if (optionalPeerSpecifiers.size > 0) {
    runImportProbe(join(directory, OPTIONAL_PEER_CONSUMER), { imports: [...optionalPeerSpecifiers] })
  }

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
  // The `mock` script of an `oa-gen init` scaffold, served by the @oa-sdk/mock-server companion.
  await smokeMockServer(cliPath, specPath, consumerDirectory)

  console.log(
    `Public runtime compatibility OK on Node ${process.versions.node}: ` +
      `${metadata.packages.length} packages, ${specifiers.length} public imports, oa-gen CLI.`,
  )
}

/** Runs the public import probe (scripts/lib/public-import-probe.mjs) with `plan` inside `consumerDirectory`. */
function runImportProbe(consumerDirectory, plan) {
  const probePath = join(consumerDirectory, 'runtime-probe.mjs')
  writeFileSync(probePath, consumerProbeSource(plan), 'utf8')
  run(process.execPath, [probePath], consumerDirectory)
}

/**
 * Starts `oa-gen mock` on a free port, requests the spec's `/health` operation
 * and stops the server.
 */
async function smokeMockServer(cliPath, specPath, cwd) {
  const server = spawn(process.execPath, [cliPath, 'mock', '--spec', specPath, '--port', '0'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(server, 'exit')
  let output = ''
  try {
    const url = await new Promise((resolveUrl, reject) => {
      const timeout = setTimeout(() => reject(new Error(`oa-gen mock did not start within 30s:\n${output}`)), 30_000)
      server.stdout.setEncoding('utf8').on('data', chunk => {
        output += chunk
        const started = /running at: (http:\/\/\S+)/.exec(output)
        if (started) {
          clearTimeout(timeout)
          resolveUrl(started[1])
        }
      })
      server.stderr.setEncoding('utf8').on('data', chunk => {
        output += chunk
      })
      exited.then(([code, signal]) => {
        clearTimeout(timeout)
        reject(new Error(`oa-gen mock exited (${signal ?? code}) before serving:\n${output}`))
      }, error => {
        clearTimeout(timeout)
        reject(error)
      })
    })
    const response = await fetch(new URL('health', `${url.replace(/\/$/, '')}/`))
    assert.equal(response.status, 200, `oa-gen mock answered GET /health with ${response.status}`)
    const body = await response.json()
    assert.equal(typeof body?.ok, 'boolean', `oa-gen mock answered GET /health with ${JSON.stringify(body)}`)
    console.log(`oa-gen mock served GET /health at ${url}.`)
  } finally {
    const forceKill = setTimeout(() => server.kill('SIGKILL'), 10_000)
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
    // A spawn failure already rejected the start above with its error.
    await exited.catch(() => undefined).finally(() => clearTimeout(forceKill))
  }
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
  const issue = publicNodeEngineIssue(manifest)
  assert(issue === undefined, `${name}: ${issue}`)
}

function assertManifestTargetsExist(packageDirectory, manifest, name) {
  for (const target of collectManifestTargets(manifest)) {
    assert(manifestTargetExists(packageDirectory, target), `${name}: build output is missing manifest target ${target}`)
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
    assert(archiveManifestTargetExists(files, target), `${name}: packed archive is missing manifest target ${target}`)
  }
}

function manifestTargetExists(packageDirectory, target) {
  if (!target.includes('*')) return existsSync(join(packageDirectory, target))
  const wildcard = target.indexOf('*')
  const prefix = target.slice(0, target.lastIndexOf('/', wildcard) + 1)
  return existsSync(join(packageDirectory, prefix))
}

function archiveManifestTargetExists(files, target) {
  if (!target.includes('*')) return files.has(`package/${target}`)
  const [prefix, ...suffixParts] = target.split('*')
  const suffix = suffixParts.join('*')
  return [...files].some(file => file.startsWith(`package/${prefix}`) && file.endsWith(suffix))
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
