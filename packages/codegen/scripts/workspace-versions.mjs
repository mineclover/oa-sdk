import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/**
 * Versions of the workspace packages that the package in `packageDirectory`
 * declares with the `workspace:` protocol, keyed by package name.
 *
 * Each version is read from the package linked into `node_modules`, which is
 * the copy the package is built and tested against. The build embeds this map
 * (tsup.config.ts) so that `oa-gen` can name the companion package ranges it
 * supports in a published install, where the workspace no longer exists.
 */
export function readWorkspaceDependencyVersions(packageDirectory) {
  const manifest = readJson(join(packageDirectory, 'package.json'))
  const names = new Set()
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (typeof specifier === 'string' && specifier.startsWith('workspace:')) names.add(name)
    }
  }

  const versions = {}
  for (const name of [...names].sort()) {
    const linked = readJson(join(packageDirectory, 'node_modules', name, 'package.json'))
    if (linked.name !== name || typeof linked.version !== 'string' || linked.version === '') {
      throw new Error(`${manifest.name}: the workspace package linked as ${name} has no usable name and version`)
    }
    versions[name] = linked.version
  }
  return versions
}

/**
 * Build-time constant for tsup and Vitest: `__OA_SDK_WORKSPACE_VERSIONS__`
 * becomes the JSON text of `readWorkspaceDependencyVersions(packageDirectory)`.
 *
 * The constant is a string literal, not an object: esbuild inlines a string at
 * each use, while an object-valued constant becomes a shared module that every
 * chunk of the bundle initialises.
 */
export function workspaceVersionsDefine(packageDirectory) {
  const json = JSON.stringify(readWorkspaceDependencyVersions(packageDirectory))
  return { __OA_SDK_WORKSPACE_VERSIONS__: JSON.stringify(json) }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
