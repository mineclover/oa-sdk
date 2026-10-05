import type { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * The pnpm workspace a project is a member of, found the way pnpm finds it.
 *
 * `oa-gen init` writes `workspace:*` for an `@oa-sdk` package only where pnpm
 * resolves it: in a project that is a member of a pnpm workspace that also has
 * that package as a member. pnpm is the package manager that needs the
 * protocol to link a workspace package, and npm rejects it outright, so the
 * rules below are pnpm's own:
 *
 * - The workspace is the nearest directory at or above the project that holds
 *   `pnpm-workspace.yaml`.
 * - Its members are the workspace root and every directory with a package
 *   manifest that the `packages` globs of that file match, minus those a `!`
 *   glob matches. Globs follow picomatch defaults: `*` and `**` do not match
 *   names starting with a dot. A file that lists no globs, such as one that
 *   only holds settings, makes the root the only member, as in pnpm 10 and
 *   later (pnpm 9 searched every directory instead, which this under-counts,
 *   so it only ever falls back to registry ranges).
 * - `node_modules` and `bower_components` never hold members.
 *
 * Symbolic links are not followed. When the workspace file cannot be read, or
 * uses glob syntax this module does not implement (extglobs, POSIX classes),
 * the project is treated as outside any workspace, so `oa-gen init` falls back
 * to registry ranges instead of guessing.
 */
export interface PnpmWorkspace {
  /** Directory holding `pnpm-workspace.yaml`. */
  root: string
  /** Names of the named member packages, each mapped to the member's directory. */
  packages: ReadonlyMap<string, string>
}

const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'
/** pnpm's member globs when `pnpm-workspace.yaml` lists none. */
const DEFAULT_PATTERNS = ['.']
const IGNORED_DIRECTORIES = new Set(['node_modules', 'bower_components'])
/** Manifest files pnpm reads a project from, in its order of precedence. */
const PROJECT_MANIFESTS = ['package.json', 'package.json5', 'package.yaml']

/** Returns the pnpm workspace that has `projectDir` as a member, or `undefined`. */
export async function findPnpmWorkspace(projectDir: string): Promise<PnpmWorkspace | undefined> {
  const project = await realpathOrResolve(projectDir)
  const root = await findWorkspaceRoot(project)
  if (root === undefined) return undefined

  const patterns = await readMemberPatterns(path.join(root, WORKSPACE_MANIFEST))
  if (patterns === undefined) return undefined

  const relative = path.relative(root, project)
  const projectSegments = relative === '' ? [] : relative.split(path.sep)
  if (!isMemberPath(patterns, projectSegments) || await readProjectName(project) === null) return undefined

  const packages = new Map<string, string>()
  for (const { directory, name } of await findMembers(root, patterns)) {
    if (name !== undefined && !packages.has(name)) packages.set(name, directory)
  }
  return { root, packages }
}

async function realpathOrResolve(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory)
  } catch {
    return path.resolve(directory)
  }
}

async function findWorkspaceRoot(start: string): Promise<string | undefined> {
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (await isFile(path.join(directory, WORKSPACE_MANIFEST))) return directory
    if (path.dirname(directory) === directory) return undefined
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Member globs

/** One path segment of a glob: `**`, or a test of a single directory name. */
type GlobSegment = '**' | ((name: string) => boolean)

interface MemberPatterns {
  include: GlobSegment[][]
  exclude: GlobSegment[][]
}

/** The member globs of a `pnpm-workspace.yaml`, or `undefined` when they cannot be read or are not supported. */
async function readMemberPatterns(file: string): Promise<MemberPatterns | undefined> {
  let manifest: unknown
  try {
    manifest = parseYaml(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
  const listed = (manifest as { packages?: unknown } | null | undefined)?.packages
  if (listed !== undefined && listed !== null
    && !(Array.isArray(listed) && listed.every(pattern => typeof pattern === 'string'))) {
    return undefined
  }
  return parseMemberPatterns(listed ?? DEFAULT_PATTERNS)
}

/** Glob syntax picomatch accepts that this module does not implement. */
const UNSUPPORTED_GLOB = /[@!+*?]\(|\[\[:/

function parseMemberPatterns(patterns: readonly string[]): MemberPatterns | undefined {
  const result: MemberPatterns = { include: [], exclude: [] }
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const glob = negated ? pattern.slice(1) : pattern
    if (UNSUPPORTED_GLOB.test(glob)) return undefined
    for (const expanded of expandBraces(glob)) {
      const segments = globSegments(expanded)
      if (segments === undefined) return undefined
      ;(negated ? result.exclude : result.include).push(segments)
    }
  }
  return result
}

/** Expands `{a,b}` alternatives into one glob each; a brace group without a comma stays literal. */
function expandBraces(glob: string): string[] {
  for (let open = 0; open < glob.length; open++) {
    if (glob[open] === '\\') {
      open++
      continue
    }
    if (glob[open] !== '{') continue
    let depth = 0
    const commas: number[] = []
    for (let index = open; index < glob.length; index++) {
      const char = glob[index]
      if (char === '\\') {
        index++
      } else if (char === '{') {
        depth++
      } else if (char === '}' && --depth === 0) {
        if (commas.length === 0) break
        const bounds = [open, ...commas, index]
        const head = glob.slice(0, open)
        const tail = glob.slice(index + 1)
        return bounds.slice(1).flatMap((end, alternative) =>
          expandBraces(head + glob.slice(bounds[alternative]! + 1, end) + tail))
      } else if (char === ',' && depth === 1) {
        commas.push(index)
      }
    }
  }
  return [glob]
}

/** Segments of `glob`, or `undefined` when one of them is not a valid pattern. */
function globSegments(glob: string): GlobSegment[] | undefined {
  const segments: GlobSegment[] = []
  for (const segment of glob.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '**') {
      segments.push('**')
      continue
    }
    const matcher = segmentMatcher(segment)
    if (matcher === undefined) return undefined
    segments.push(matcher)
  }
  return segments
}

function segmentMatcher(segment: string): ((name: string) => boolean) | undefined {
  let source = ''
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!
    const end = char === '[' ? classEnd(segment, index) : -1
    if (char === '\\' && index + 1 < segment.length) {
      source += escapeRegExp(segment[++index]!)
    } else if (char === '*') {
      source += '.*'
    } else if (char === '?') {
      source += '.'
    } else if (end !== -1) {
      const body = segment.slice(index + 1, end)
      source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
      index = end
    } else {
      source += escapeRegExp(char)
    }
  }
  let expression: RegExp
  try {
    expression = new RegExp(`^${source}$`)
  } catch {
    return undefined
  }
  // A wildcard does not match a leading dot; only a glob that spells the dot out does.
  const matchesDotNames = segment.startsWith('.')
  return name => (matchesDotNames || !name.startsWith('.')) && expression.test(name)
}

/** Index of the `]` closing the character class opened at `open`, or -1. */
function classEnd(segment: string, open: number): number {
  let start = open + 1
  if (segment[start] === '!' || segment[start] === '^') start++
  if (segment[start] === ']') start++
  return segment.indexOf(']', start)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * Whether `glob` matches the path `segments` (`whole`), or matches some path
 * strictly below it (`below`), which decides whether a directory is worth
 * searching for members.
 */
function globMatches(glob: readonly GlobSegment[], segments: readonly string[], mode: 'whole' | 'below'): boolean {
  const from = (globIndex: number, segmentIndex: number): boolean => {
    if (globIndex === glob.length) return mode === 'whole' && segmentIndex === segments.length
    if (segmentIndex === segments.length) {
      return mode === 'below' || glob.slice(globIndex).every(segment => segment === '**')
    }
    const segment = glob[globIndex]!
    if (segment === '**') {
      return from(globIndex + 1, segmentIndex)
        || (!segments[segmentIndex]!.startsWith('.') && from(globIndex, segmentIndex + 1))
    }
    return segment(segments[segmentIndex]!) && from(globIndex + 1, segmentIndex + 1)
  }
  return from(0, 0)
}

/** Whether the directory at `segments` below the workspace root is a member, if it has a manifest. */
function isMemberPath(patterns: MemberPatterns, segments: readonly string[]): boolean {
  if (segments.length === 0) return true
  if (segments.some(segment => IGNORED_DIRECTORIES.has(segment))) return false
  return patterns.include.some(glob => globMatches(glob, segments, 'whole'))
    && !patterns.exclude.some(glob => globMatches(glob, segments, 'whole'))
}

// ---------------------------------------------------------------------------
// Members

interface WorkspaceMember {
  directory: string
  /** Undefined when the manifest has no name or pnpm's JSON5 format, which is not read here. */
  name: string | undefined
}

async function findMembers(root: string, patterns: MemberPatterns): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = []
  const visit = async (directory: string, segments: string[]): Promise<void> => {
    if (isMemberPath(patterns, segments)) {
      const name = await readProjectName(directory)
      if (name !== null) members.push({ directory, name })
    }
    if (!patterns.include.some(glob => globMatches(glob, segments, 'below'))) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
      .map(entry => visit(path.join(directory, entry.name), [...segments, entry.name])))
  }
  await visit(root, [])
  return members
}

/**
 * Name declared by the project manifest in `directory`: `null` when there is
 * no manifest, `undefined` when it declares no name or cannot be read.
 */
async function readProjectName(directory: string): Promise<string | undefined | null> {
  for (const file of PROJECT_MANIFESTS) {
    let content: string
    try {
      content = await fs.readFile(path.join(directory, file), 'utf8')
    } catch {
      continue
    }
    if (file === 'package.json5') return undefined
    try {
      const manifest = (file === 'package.json' ? JSON.parse(content) : parseYaml(content)) as { name?: unknown } | null
      return typeof manifest?.name === 'string' ? manifest.name : undefined
    } catch {
      return undefined
    }
  }
  return null
}
