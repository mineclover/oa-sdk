/**
 * Manifest rules every public distribution candidate must meet, shared by the
 * release policy check (scripts/check-release-policy.ts), which reads the
 * source manifests, and the public runtime smoke
 * (scripts/public-runtime-smoke.mjs), which also reads the packed ones. A
 * manifest that breaks a rule fails the policy check locally, before the
 * runtime lane packs anything.
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
 * Peer dependencies a consumer of the packages with these `manifests` must
 * install itself, keyed by name: every peer, optional ones included, that is
 * not one of the packages, so that every public entry point can be imported.
 * A consumer installing with `--legacy-peer-deps` gets none of them otherwise.
 * Peers several packages declare get a range satisfying all of them.
 */
export function externalPeerDependencies(manifests) {
  const names = new Set(manifests.map(manifest => manifest.name))
  const ranges = new Map()
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (names.has(peer)) continue
      const declared = ranges.get(peer) ?? new Set()
      declared.add(typeof range === 'string' && range.trim() !== '' ? range.trim() : '*')
      ranges.set(peer, declared)
    }
  }
  return Object.fromEntries([...ranges].sort(([left], [right]) => left.localeCompare(right)).map(([peer, declared]) => {
    const distinct = [...declared].filter(range => range !== '*')
    if (distinct.length <= 1) return [peer, distinct[0] ?? '*']
    // Space-separated comparators intersect; a union (`||`) or hyphen range cannot be joined that way.
    if (distinct.some(range => range.includes('||') || / - /.test(range))) {
      throw new Error(`peer dependency ${peer} has ranges that cannot be combined: ${distinct.join(', ')}`)
    }
    return [peer, distinct.join(' ')]
  }))
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
