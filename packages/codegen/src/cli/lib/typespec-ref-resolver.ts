import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  compile,
  NodeHost,
  getSourceLocation,
  type Program,
} from '@typespec/compiler'

const execFileAsync = promisify(execFile)

/**
 * What a TypeSpec reference resolved to.
 * - `path`: a file or directory in the file system (working tree, CI checkout).
 * - `git`: an entry point inside a commit, extracted with `git archive`.
 */
export type ResolvedTypeSpecSource =
  | { kind: 'path'; entrypoint: string }
  | { kind: 'git'; rev: string; commit: string; entry: string }

export interface ResolvedTypeSpecProgram {
  program: Program
  /** Absolute path that was compiled (inside a temporary extraction directory for git references). */
  entrypoint: string
  /**
   * Entry point relative to the repository root with `/` separators, or `undefined` when the
   * source lies outside the repository. A git reference without a path reuses this value from
   * the other side of a diff.
   */
  repoRelativeEntry: string | undefined
  source: ResolvedTypeSpecSource
  cleanup: () => Promise<void>
}

/**
 * Entry point suggested for a git reference given without a path (`HEAD` rather than `HEAD:main.tsp`).
 * `origin` names where the path came from and appears in the error when the commit lacks it.
 */
interface TypeSpecEntryHint {
  path: string
  origin: string
}

/** Where relative references are read from. */
export interface TypeSpecRefLocation {
  /** Project root; also the starting point for finding the git repository. */
  projectRoot: string
  /** Directory the command was invoked from; relative paths are tried here first. */
  cwd: string
}

export interface ResolvedTypeSpecDiffSources {
  base: ResolvedTypeSpecProgram
  head: ResolvedTypeSpecProgram
  /** Set when base and head resolve to the same source, explaining that the diff compares it with itself. */
  sameSourceNotice: string | undefined
  cleanup: () => Promise<void>
}

type ParsedTypeSpecRef =
  | { kind: 'path'; ref: string; entrypoint: string }
  | { kind: 'git'; ref: string; rev: string; commit: string; subpath: string | undefined }

/** Fixed locations tried, in order, before searching a commit for a single `main.tsp`. */
const CONVENTIONAL_GIT_ENTRIES = [
  'packages/schemas/typespec/main.tsp',
  'packages/schemas/typespec',
  'main.tsp',
]

function findRepoRoot(startDir: string): string {
  let curr = path.resolve(startDir)
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, '.git'))) {
      return curr
    }
    curr = path.dirname(curr)
  }
  return path.resolve(startDir)
}

function checkCompilationErrors(program: Program, ref: string): void {
  const errors = program.diagnostics.filter(d => d.severity === 'error')
  if (errors.length > 0) {
    const messages = errors.map(d => {
      const loc = d.target ? getSourceLocation(d.target) : undefined
      const locStr = loc
        ? `${loc.file.path}:${loc.file.getLineAndCharacterOfPosition(loc.pos).line + 1}`
        : ''
      return `[${d.code}] ${locStr} ${d.message}`
    })
    throw new Error(`TypeSpec compilation failed for "${ref}":\n${messages.join('\n')}`)
  }
}

/** Returns the full commit SHA `ref` names, or `undefined` when it is not a commit-ish in `cwd`'s repository. */
async function resolveGitCommit(ref: string, cwd: string): Promise<string | undefined> {
  // A leading dash would be read as a git option rather than a revision.
  if (ref.length === 0 || ref.startsWith('-')) return undefined
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd })
    const commit = stdout.trim()
    return commit.length > 0 ? commit : undefined
  } catch {
    return undefined
  }
}

function realpathOrSelf(target: string): string {
  try {
    return fsSync.realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

/** `target` relative to `root` with `/` separators, or `undefined` when `target` is outside `root`. */
function containedRelativePath(root: string, target: string): string | undefined {
  const relative = path.relative(realpathOrSelf(root), realpathOrSelf(target))
  if (relative === '') return '.'
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return undefined
  }
  return toPosix(relative)
}

/**
 * Normalizes a repository-relative path (`<ref>:<path>` or an entry hint) and rejects paths that
 * leave the repository, so joining it to an extraction directory can never reach another directory.
 */
function normalizeRepoPath(repoPath: string, context: string): string {
  const normalized = path.posix.normalize(repoPath.replace(/\\/g, '/'))
  if (
    path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(repoPath)
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new Error(`${context}: "${repoPath}" must be a path inside the repository, relative to its root.`)
  }
  return normalized.endsWith('/') && normalized.length > 1 ? normalized.slice(0, -1) : normalized
}

/** A directory stands for its `main.tsp`, or for itself when it holds a `tspconfig.yaml` (or nothing usable). */
function directoryEntrypoint(candidate: string): string {
  if (!fsSync.statSync(candidate).isDirectory()) return candidate
  const mainTsp = path.join(candidate, 'main.tsp')
  return fsSync.existsSync(mainTsp) ? mainTsp : candidate
}

async function parseTypeSpecRef(
  ref: string,
  location: TypeSpecRefLocation,
  repoRoot: string,
): Promise<ParsedTypeSpecRef> {
  // 1. A local file or directory wins over a git ref of the same name. A relative path is read from
  //    the invocation directory first, as the shell would, then from the project and repository roots.
  const candidates = [
    path.resolve(location.cwd, ref),
    path.resolve(location.projectRoot, ref),
    path.resolve(repoRoot, ref),
  ]
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return { kind: 'path', ref, entrypoint: directoryEntrypoint(candidate) }
    }
  }

  // 2. A git ref, either "<ref>" or "<ref>:<path>".
  const colonIdx = ref.indexOf(':')
  if (colonIdx !== -1) {
    const rev = ref.slice(0, colonIdx)
    const commit = await resolveGitCommit(rev, repoRoot)
    if (commit) {
      const rawSubpath = ref.slice(colonIdx + 1)
      const subpath = rawSubpath.length > 0
        ? normalizeRepoPath(rawSubpath, `Invalid TypeSpec reference "${ref}"`)
        : undefined
      return { kind: 'git', ref, rev, commit, subpath }
    }
  }

  const commit = await resolveGitCommit(ref, repoRoot)
  if (!commit) {
    throw new Error(
      `Unable to resolve TypeSpec reference "${ref}": path does not exist and is not a valid git reference.`,
    )
  }
  return { kind: 'git', ref, rev: ref, commit, subpath: undefined }
}

/** The repository-relative entry point a reference names by itself, without looking inside a commit. */
function explicitRepoEntry(parsed: ParsedTypeSpecRef, repoRoot: string): string | undefined {
  if (parsed.kind === 'path') return containedRelativePath(repoRoot, parsed.entrypoint)
  return parsed.subpath
}

async function extractCommit(commit: string, repoRoot: string, tempDir: string): Promise<void> {
  // The archive is written next to (not inside) the extraction directory so it can never shadow a tracked file.
  const archivePath = `${tempDir}.tar`
  try {
    await execFileAsync('git', ['archive', '--format=tar', `--output=${archivePath}`, commit], { cwd: repoRoot })
    await execFileAsync('tar', ['-xf', archivePath, '-C', tempDir])
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => {})
  }
}

async function linkNodeModules(repoRoot: string, tempDir: string): Promise<void> {
  // TypeSpec library imports resolve from the extracted files, so borrow the working tree's installs.
  const rootNodeModules = path.join(repoRoot, 'node_modules')
  if (fsSync.existsSync(rootNodeModules)) {
    await fs.symlink(rootNodeModules, path.join(tempDir, 'node_modules'), 'dir').catch(() => {})
  }

  // Also package-level node_modules (e.g. packages/schemas/node_modules)
  const packagesDir = path.join(repoRoot, 'packages')
  if (fsSync.existsSync(packagesDir)) {
    const packageNames = await fs.readdir(packagesDir).catch(() => [] as string[])
    for (const pkg of packageNames) {
      const pkgNodeModules = path.join(packagesDir, pkg, 'node_modules')
      if (fsSync.existsSync(pkgNodeModules)) {
        const targetDir = path.join(tempDir, 'packages', pkg)
        await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
        await fs.symlink(pkgNodeModules, path.join(targetDir, 'node_modules'), 'dir').catch(() => {})
      }
    }
  }
}

/** Every `main.tsp` in the extracted tree, skipping `node_modules`, dot directories and symlinks. */
async function findMainTspFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && entry.name === 'main.tsp') {
        found.push(fullPath)
      }
    }
  }
  await walk(root)
  return found
}

/**
 * Picks the entry point for a git reference given without a path: the hinted path when there is one
 * (it must exist in the commit), otherwise a conventional location, otherwise the only `main.tsp`.
 * Anything less certain is an error that asks for `<ref>:<path>` instead of guessing.
 */
async function discoverGitEntry(
  parsed: Extract<ParsedTypeSpecRef, { kind: 'git' }>,
  tempDir: string,
  hint: TypeSpecEntryHint | undefined,
): Promise<string> {
  const askForPath = `Pass the entry point explicitly as ${parsed.rev}:<path>.`

  if (hint) {
    const hinted = normalizeRepoPath(hint.path, `Invalid entry point from ${hint.origin}`)
    const candidate = path.join(tempDir, hinted)
    if (!fsSync.existsSync(candidate)) {
      throw new Error(
        `Cannot determine the TypeSpec entry point for git reference "${parsed.ref}": `
        + `"${hinted}" (the ${hint.origin} entry point) does not exist in commit ${parsed.commit.slice(0, 12)}. ${askForPath}`,
      )
    }
    return directoryEntrypoint(candidate)
  }

  for (const conventional of CONVENTIONAL_GIT_ENTRIES) {
    const candidate = path.join(tempDir, conventional)
    if (fsSync.existsSync(candidate)) return directoryEntrypoint(candidate)
  }

  const mainFiles = await findMainTspFiles(tempDir)
  if (mainFiles.length === 1) return mainFiles[0]!
  if (mainFiles.length === 0) {
    throw new Error(
      `Could not locate TypeSpec entrypoint (main.tsp) in git reference "${parsed.ref}". ${askForPath}`,
    )
  }
  const listed = mainFiles.map(file => toPosix(path.relative(tempDir, file)))
  throw new Error(
    `Cannot determine the TypeSpec entry point for git reference "${parsed.ref}": `
    + `found ${listed.length} main.tsp files (${listed.join(', ')}). ${askForPath}`,
  )
}

async function materializeTypeSpecRef(
  parsed: ParsedTypeSpecRef,
  repoRoot: string,
  hint: TypeSpecEntryHint | undefined,
): Promise<ResolvedTypeSpecProgram> {
  if (parsed.kind === 'path') {
    const program = await compile(NodeHost, parsed.entrypoint, { noEmit: true })
    checkCompilationErrors(program, parsed.ref)
    return {
      program,
      entrypoint: parsed.entrypoint,
      repoRelativeEntry: containedRelativePath(repoRoot, parsed.entrypoint),
      source: { kind: 'path', entrypoint: realpathOrSelf(parsed.entrypoint) },
      cleanup: async () => {},
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-tsp-diff-'))
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    await extractCommit(parsed.commit, repoRoot, tempDir)

    // The entry point is chosen from the commit's own files, before node_modules links add directories.
    let entrypoint: string
    if (parsed.subpath !== undefined) {
      const candidate = path.join(tempDir, parsed.subpath)
      if (!fsSync.existsSync(candidate)) {
        throw new Error(
          `TypeSpec entry point "${parsed.subpath}" does not exist in git reference "${parsed.rev}" `
          + `(commit ${parsed.commit.slice(0, 12)}).`,
        )
      }
      entrypoint = directoryEntrypoint(candidate)
    } else {
      entrypoint = await discoverGitEntry(parsed, tempDir, hint)
    }

    const entry = toPosix(path.relative(tempDir, entrypoint)) || '.'
    await linkNodeModules(repoRoot, tempDir)
    const program = await compile(NodeHost, entrypoint, { noEmit: true })
    checkCompilationErrors(program, parsed.ref)

    return {
      program,
      entrypoint,
      repoRelativeEntry: entry,
      source: { kind: 'git', rev: parsed.rev, commit: parsed.commit, entry },
      cleanup,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

/**
 * Resolves one TypeSpec reference: a `.tsp` file, a directory, a git ref or `<ref>:<path>`.
 * `entryHint` is the repository-relative entry point to use for a git ref given without a path
 * (an absolute path inside the repository is accepted; one outside it is ignored).
 */
export async function resolveTypeSpecProgramRef(
  ref: string,
  projectRoot: string = process.cwd(),
  entryHint?: string,
): Promise<ResolvedTypeSpecProgram> {
  const repoRoot = findRepoRoot(projectRoot)
  const parsed = await parseTypeSpecRef(ref, { projectRoot, cwd: process.cwd() }, repoRoot)
  const hintPath = entryHint === undefined
    ? undefined
    : path.isAbsolute(entryHint) ? containedRelativePath(repoRoot, entryHint) : entryHint
  const hint = hintPath === undefined ? undefined : { path: hintPath, origin: 'requested' }
  return materializeTypeSpecRef(parsed, repoRoot, hint)
}

function describeSameSource(
  base: ResolvedTypeSpecProgram,
  head: ResolvedTypeSpecProgram,
  repoRoot: string,
  cwd: string,
): string | undefined {
  if (base.source.kind === 'git' && head.source.kind === 'git') {
    if (base.source.commit !== head.source.commit || base.source.entry !== head.source.entry) return undefined
    const workingTreeEntry = path.relative(
      realpathOrSelf(cwd),
      path.join(realpathOrSelf(repoRoot), head.source.entry),
    ) || '.'
    return `Note: --base and --head both resolve to commit ${base.source.commit.slice(0, 12)} `
      + `(${base.source.entry}), so this compares that commit with itself. A git reference reads committed `
      + `content only; to include uncommitted changes, pass the working-tree path as --head `
      + `(e.g. --head ${workingTreeEntry}).`
  }
  if (base.source.kind === 'path' && head.source.kind === 'path') {
    if (base.source.entrypoint !== head.source.entrypoint) return undefined
    return `Note: --base and --head both resolve to ${base.source.entrypoint}, so this compares it with itself.`
  }
  return undefined
}

/**
 * Resolves the two sides of `oa-gen tsp diff`. A git ref given without a path takes its entry point
 * from the other side (the same repository-relative path, read from its own commit): `--head HEAD`
 * reuses the base entry point, and `--base origin/main` reuses the head's file or `<ref>:<path>`.
 */
export async function resolveTypeSpecDiffSources(
  baseRef: string,
  headRef: string,
  location: Partial<TypeSpecRefLocation> = {},
): Promise<ResolvedTypeSpecDiffSources> {
  const cwd = location.cwd ?? process.cwd()
  const resolvedLocation: TypeSpecRefLocation = { cwd, projectRoot: location.projectRoot ?? cwd }
  const repoRoot = findRepoRoot(resolvedLocation.projectRoot)
  const baseParsed = await parseTypeSpecRef(baseRef, resolvedLocation, repoRoot)
  const headParsed = await parseTypeSpecRef(headRef, resolvedLocation, repoRoot)

  const headEntry = explicitRepoEntry(headParsed, repoRoot)
  const base = await materializeTypeSpecRef(
    baseParsed,
    repoRoot,
    headEntry === undefined ? undefined : { path: headEntry, origin: '--head' },
  )

  let head: ResolvedTypeSpecProgram
  try {
    head = await materializeTypeSpecRef(
      headParsed,
      repoRoot,
      base.repoRelativeEntry === undefined ? undefined : { path: base.repoRelativeEntry, origin: '--base' },
    )
  } catch (err) {
    await base.cleanup()
    throw err
  }

  return {
    base,
    head,
    sameSourceNotice: describeSameSource(base, head, repoRoot, cwd),
    cleanup: async () => {
      await base.cleanup()
      await head.cleanup()
    },
  }
}
