/**
 * Manifest rules every public distribution candidate must meet, shared by the
 * release policy check (scripts/check-release-policy.ts), which reads the
 * source manifests, and the public runtime smoke
 * (scripts/public-runtime-smoke.mjs), which also reads the packed ones. A
 * manifest that breaks a rule fails the policy check locally, before the
 * runtime lane packs anything. The runtime smoke and the release exporter's
 * consumer smoke (scripts/export-release-artifacts.ts) also share how a
 * consumer of the packed packages installs their peers.
 */

/** Oldest Node.js major release the public packages support (the runtime smoke matrix floor). */
export const PUBLIC_NODE_MAJOR_FLOOR = 22

/**
 * Why `manifest` does not declare the public Node.js floor, or `undefined`
 * when it does: `engines.node` must be `>=22` (minor and patch optional).
 */
export function publicNodeEngineIssue(manifest) {
  const range = manifest?.engines?.node
  if (typeof range !== 'string') return 'engines.node is required'
  const match = /^\s*>=\s*(\d+)(?:\.\d+)?(?:\.\d+)?\s*$/.exec(range)
  if (!match || Number(match[1]) !== PUBLIC_NODE_MAJOR_FLOOR) {
    return `engines.node must retain the public Node >=${PUBLIC_NODE_MAJOR_FLOOR} floor, received ${range}`
  }
  return undefined
}

/**
 * Peer dependencies a consumer of the packages with these `manifests` installs
 * next to them, keyed by name. These are the peers that at least one of the
 * packages requires (not marked optional in `peerDependenciesMeta`) and that is
 * not itself one of the packages: npm and pnpm install those for a consumer,
 * but not the optional ones. The smokes install with `--legacy-peer-deps`, so
 * they add these themselves, and leave optional peers out as a consumer's
 * package manager does: an entry point that imports an optional peer then
 * fails unless `optionalPeerEntryPoints` in release-policy.json declares it.
 * `optionalPeers` names the optional peers to add as well, for the consumer
 * that imports those declared entry points.
 *
 * A peer several packages declare gets a range satisfying all of their
 * declarations, optional ones included, as an installed optional peer must
 * satisfy its range too.
 */
export function consumerPeerDependencies(manifests, { optionalPeers = [] } = {}) {
  const names = new Set(manifests.map(manifest => manifest.name))
  const ranges = new Map()
  const required = new Set()
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (names.has(peer)) continue
      const declared = ranges.get(peer) ?? new Set()
      declared.add(typeof range === 'string' && range.trim() !== '' ? range.trim() : '*')
      ranges.set(peer, declared)
      if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) required.add(peer)
    }
  }
  for (const peer of optionalPeers) {
    if (!ranges.has(peer)) throw new Error(`${peer} is not a peer dependency of these packages`)
  }
  const installed = [...new Set([...required, ...optionalPeers])].sort((left, right) => left.localeCompare(right))
  return Object.fromEntries(installed.map(peer => [peer, combinedRange(peer, ranges.get(peer))]))
}

function combinedRange(peer, declared) {
  const distinct = [...declared].filter(range => range !== '*')
  if (distinct.length <= 1) return distinct[0] ?? '*'
  // Space-separated comparators intersect; a union (`||`) or hyphen range cannot be joined that way.
  if (distinct.some(range => range.includes('||') || / - /.test(range))) {
    throw new Error(`peer dependency ${peer} has ranges that cannot be combined: ${distinct.join(', ')}`)
  }
  return distinct.join(' ')
}

/** The import specifier of `subpath` (`.` or `./name`) of the package `packageName`. */
export function entryPointSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//, '')}`
}

/**
 * Entry points of `packageName` that `optionalPeerEntryPoints` (the
 * release-policy.json field: package name -> export subpath -> optional peers
 * it imports) declares, as import specifiers with the optional peers each
 * needs.
 */
export function declaredOptionalPeerImports(optionalPeerEntryPoints, packageName) {
  return Object.entries(optionalPeerEntryPoints?.[packageName] ?? {}).map(([subpath, peers]) => ({
    specifier: entryPointSpecifier(packageName, subpath),
    peers: [...peers],
  }))
}

/**
 * Why `entryPoints`, the optionalPeerEntryPoints declaration (export subpath ->
 * optional peers it imports) of the package with `manifest`, does not match
 * that manifest. The root entry point may not import an optional peer, every
 * subpath must be one of its exports, and every peer one of its optional peers:
 * a required peer is always installed, so it needs no declaration.
 */
export function optionalPeerEntryPointIssues(manifest, entryPoints) {
  const issues = []
  const exportSubpaths = manifest?.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? new Set(Object.keys(manifest.exports))
    : new Set(['.'])
  for (const [subpath, declared] of Object.entries(entryPoints ?? {})) {
    const peers = Array.isArray(declared) ? declared : []
    if (subpath === '.') {
      issues.push(`the root entry point must import without optional peers (declared: ${peers.join(', ')}); move what needs them to a subpath`)
      continue
    }
    if (!exportSubpaths.has(subpath)) {
      issues.push(`optional peer entry point ${subpath} is not one of its exports`)
      continue
    }
    for (const peer of peers) {
      if (typeof manifest?.peerDependencies?.[peer] !== 'string') {
        issues.push(`optional peer entry point ${subpath} declares ${peer}, which is not one of its peer dependencies`)
      } else if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) {
        issues.push(`optional peer entry point ${subpath} declares ${peer}, a required peer that every consumer installs; drop it from the declaration`)
      }
    }
  }
  return issues
}

/** Package-relative files the entry points of `manifest` name (`main`, `module`, `types`, `exports`, `bin`). */
export function collectManifestTargets(manifest) {
  const targets = new Set()
  for (const field of ['main', 'module', 'types', 'exports', 'bin']) addRelativeTargets(targets, manifest?.[field])
  return [...targets].sort()
}

/**
 * Entry point targets of `manifest` that its `files` list does not include,
 * so that the packed artifact would not contain them. A package without a
 * `files` list packs every file. An entry is a file or a directory; a glob
 * entry is taken to cover the whole directory before its first wildcard, and
 * negated (`!`) entries are not evaluated, so that only a target no entry can
 * include is reported. The runtime smoke checks the packed archive itself.
 */
export function manifestTargetsOutsideFiles(manifest) {
  const files = manifest?.files
  if (!Array.isArray(files)) return []
  const entries = files
    .filter(entry => typeof entry === 'string' && !entry.startsWith('!'))
    .map(filesEntryPath)
  return collectManifestTargets(manifest).filter(target =>
    !entries.some(entry => entry === '' || target === entry || target.startsWith(`${entry}/`)))
}

/** The path a `files` entry includes: itself, or for a glob the directory before its first wildcard. */
function filesEntryPath(entry) {
  const path = stripRelativePrefix(entry)
  const wildcard = path.search(/[*?[{]/)
  const literal = wildcard === -1 ? path : path.slice(0, path.lastIndexOf('/', wildcard) + 1)
  return literal.replace(/\/+$/, '')
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

function stripRelativePrefix(value) {
  return value.startsWith('./') ? value.slice(2) : value
}
