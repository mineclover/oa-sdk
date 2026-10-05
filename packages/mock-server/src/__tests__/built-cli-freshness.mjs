import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, matchesGlob, relative, sep } from 'node:path'

const TURBO_DEFAULT = '$TURBO_DEFAULT$'
const TURBO_EXTENDS = '$TURBO_EXTENDS$'
const TURBO_ROOT_PREFIX = '$TURBO_ROOT$/'
// turbo hashes these for every task, even when the task's inputs exclude them.
const ALWAYS_HASHED = new Set(['package.json', 'turbo.json'])
const DIST_SHAPING_ROOT_FILE = /^(package\.json|tsup\.config\.[cm]?[jt]s|tsconfig.*\.json)$/

// The built-CLI smoke runs the dist/ already on disk and never builds it. test:ci is meant to run
// through turbo (`turbo run test:ci`), where test:ci depends on the package's build task, which
// builds dist/, or restores it from cache, for the current content of every build input. Run
// directly, nothing builds first, so this falls back to modification times and requires the built
// file to be newer than every build input that shapes dist/.
export function checkBuiltCli({ packageRoot, builtFile = 'dist/cli/index.js', env = process.env }) {
  const packageName = readJson(join(packageRoot, 'package.json')).name
  const remedy = `Run test:ci through turbo (\`pnpm exec turbo run test:ci --filter=${packageName}\`), `
    + 'which builds this package and its workspace dependencies first, '
    + `or rebuild it with \`pnpm --filter ${packageName} build\`.`
  const builtPath = join(packageRoot, builtFile)
  if (!existsSync(builtPath)) {
    return result(false, 'missing', `built CLI is missing: ${builtFile}. ${remedy}`)
  }

  // turbo sets TURBO_HASH in the environment of every task it runs, and nothing in that
  // environment says whether the run includes this package's build task. When it does, the build
  // keys dist/ on file content, and modification times would only add false alarms: a cache hit
  // leaves dist/ untouched when it already holds that build's output. `turbo run --only` drops the
  // build dependency, so there dist/ is used exactly as it is on disk.
  if (env.TURBO_HASH) {
    return result(true, 'unchecked', `${builtFile}: modification-time check skipped under turbo (TURBO_HASH is set). `
      + `It is current only if this turbo run built ${packageName}: test:ci depends on that build task, `
      + `but \`turbo run --only\` drops the dependency and uses ${builtFile} as it is on disk.`)
  }

  const builtAt = statSync(builtPath).mtimeMs
  const inputs = builtCliInputs(packageRoot)
  const changedInputs = inputs
    .map(file => ({ file, modifiedAt: statSync(join(packageRoot, file)).mtimeMs }))
    .filter(input => input.modifiedAt > builtAt)
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.file.localeCompare(right.file))
    .map(input => input.file)
  if (changedInputs.length > 0) {
    const shown = changedInputs.slice(0, 5).join(', ')
      + (changedInputs.length > 5 ? `, and ${changedInputs.length - 5} more` : '')
    return result(false, 'stale', `built CLI ${builtFile} is stale: ${changedInputs.length} build input(s) changed `
      + `after it was built (${shown}). ${remedy}`, changedInputs)
  }
  return result(true, 'current', `${builtFile} is newer than its ${inputs.length} build inputs`)
}

// The files that shape dist/ and that turbo also counts as build inputs, as package-relative POSIX
// paths. Which test-only files to leave out comes from turbo.json, so editing a file the build
// task's inputs exclude never marks dist/ stale here either.
export function builtCliInputs(packageRoot) {
  const { repoRoot, inputs } = resolveBuildInputs(packageRoot)
  const packageDirectory = relative(repoRoot, packageRoot).split(sep).join('/')
  return distShapingFiles(packageRoot).filter(file => isTurboInput(file, inputs, packageDirectory))
}

// The manifest, the tsup and TypeScript configuration, and every file under src/. Hidden entries
// (editor swap files, .DS_Store) are never imported by an entry point and are skipped.
export function distShapingFiles(packageRoot) {
  const files = readdirSync(packageRoot).filter(name => DIST_SHAPING_ROOT_FILE.test(name))
  collectFiles(packageRoot, 'src', files)
  return files.sort()
}

// The build task's `inputs` as turbo resolves them for this package. A root `<package>#build` task
// replaces the generic `build` task; a package turbo.json (`"extends": ["//"]`) replaces the
// inherited inputs, or appends to them where it lists `$TURBO_EXTENDS$`. An empty list means every
// file in the package is an input.
export function resolveBuildInputs(packageRoot) {
  const repoRoot = findRepoRoot(packageRoot)
  const packageName = readJson(join(packageRoot, 'package.json')).name
  const rootTasks = readJson(join(repoRoot, 'turbo.json')).tasks ?? {}
  let inputs = (rootTasks[`${packageName}#build`] ?? rootTasks.build)?.inputs ?? []
  const packageConfig = join(packageRoot, 'turbo.json')
  if (existsSync(packageConfig)) {
    const ownInputs = readJson(packageConfig).tasks?.build?.inputs
    if (ownInputs) {
      const inherited = inputs
      inputs = ownInputs.flatMap(glob => (glob === TURBO_EXTENDS ? inherited : [glob]))
    }
  }
  return { repoRoot, inputs }
}

function isTurboInput(file, inputs, packageDirectory) {
  if (ALWAYS_HASHED.has(file) || inputs.length === 0) return true
  const matches = glob => (glob.startsWith(TURBO_ROOT_PREFIX)
    ? matchesGlob(`${packageDirectory}/${file}`, glob.slice(TURBO_ROOT_PREFIX.length))
    : matchesGlob(file, glob))
  const included = inputs.some(glob => !glob.startsWith('!') && (glob === TURBO_DEFAULT || matches(glob)))
  return included && !inputs.some(glob => glob.startsWith('!') && matches(glob.slice(1)))
}

// The repository root is the nearest directory above the package that holds the root turbo.json.
function findRepoRoot(packageRoot) {
  for (let directory = dirname(packageRoot); ; directory = dirname(directory)) {
    if (existsSync(join(directory, 'turbo.json'))) return directory
    if (dirname(directory) === directory) {
      throw new Error(`no root turbo.json above ${packageRoot}, so its build inputs are unknown`)
    }
  }
}

function collectFiles(packageRoot, directory, files) {
  const absolute = join(packageRoot, directory)
  if (!existsSync(absolute)) return
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) collectFiles(packageRoot, path, files)
    else files.push(path)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function result(ok, status, message, changedInputs = []) {
  return { ok, status, message, changedInputs }
}
