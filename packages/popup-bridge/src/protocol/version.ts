import { BridgeError } from './errors.js'

/** Wire protocol version this package speaks (`major.minor`). */
export const PROTOCOL_VERSION = '1.0'

export type VersionTuple = readonly [major: number, minor: number, patch: number]

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const PROTOCOL = /^(\d+)\.(\d+)$/

/** Parses `major.minor.patch`; prereleases and build metadata are not part of the convention. */
export function parseVersion(version: string): VersionTuple {
  const match = SEMVER.exec(version)
  if (!match) throw new TypeError(`Invalid version "${version}": expected major.minor.patch`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    const delta = a[i]! - b[i]!
    if (delta !== 0) return delta
  }
  return 0
}

type Comparator = { min: VersionTuple; below?: VersionTuple }

/**
 * Supported ranges: `*`, an exact `x.y.z`, `^x.y.z` (same left-most non-zero part), `~x.y.z`
 * (same minor), and `>=x.y.z`.
 */
function parseRange(range: string): Comparator {
  const trimmed = range.trim()
  if (trimmed === '*') return { min: [0, 0, 0] }
  if (trimmed.startsWith('>=')) return { min: parseVersion(trimmed.slice(2).trim()) }
  if (trimmed.startsWith('^')) {
    const min = parseVersion(trimmed.slice(1))
    const [major, minor, patch] = min
    const below: VersionTuple = major > 0 ? [major + 1, 0, 0] : minor > 0 ? [0, minor + 1, 0] : [0, 0, patch + 1]
    return { min, below }
  }
  if (trimmed.startsWith('~')) {
    const min = parseVersion(trimmed.slice(1))
    return { min, below: [min[0], min[1] + 1, 0] }
  }
  const exact = parseVersion(trimmed)
  return { min: exact, below: [exact[0], exact[1], exact[2] + 1] }
}

/** Throws a `TypeError` when `range` is not in the supported grammar. */
export function assertVersionRange(range: string): void {
  parseRange(range)
}

export function satisfies(version: string, range: string): boolean {
  const candidate = parseVersion(version)
  const { min, below } = parseRange(range)
  return compareVersions(candidate, min) >= 0 && (below === undefined || compareVersions(candidate, below) < 0)
}

function parseProtocol(version: string): readonly [number, number] {
  const match = PROTOCOL.exec(version)
  if (!match) throw new TypeError(`Invalid protocol version "${version}": expected major.minor`)
  return [Number(match[1]), Number(match[2])]
}

/**
 * Picks the highest protocol version both peers support. Versions are exact `major.minor`
 * strings; a peer that sends a malformed entry simply does not offer it.
 */
export function negotiateProtocol(ours: readonly string[], theirs: readonly string[]): string {
  const theirSet = new Set(theirs)
  const common = ours.filter(version => theirSet.has(version) && PROTOCOL.test(version))
  if (common.length === 0) {
    throw new BridgeError('PROTOCOL_INCOMPATIBLE', 'No common protocol version', {
      data: { supported: [...ours], offered: [...theirs] },
    })
  }
  return common.reduce((best, version) => {
    const [bm, bn] = parseProtocol(best)
    const [vm, vn] = parseProtocol(version)
    return vm > bm || (vm === bm && vn > bn) ? version : best
  })
}
