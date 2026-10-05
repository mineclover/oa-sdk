import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliPath = join(packageRoot, 'dist/cli/index.js')
assertBuiltCliIsCurrent()

const directory = await mkdtemp(join(tmpdir(), 'oa-mock-cli-'))
const specPath = join(directory, 'openapi.yaml')
// The spec spans three files: `/users/{id}` is a path item in paths/user.yaml,
// whose response schema is in schemas.yaml.
await writeFile(specPath, `openapi: 3.2.0
info:
  title: Built CLI smoke
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
  /users/{id}:
    $ref: ./paths/user.yaml
`)
await mkdir(join(directory, 'paths'))
await writeFile(join(directory, 'paths/user.yaml'), `parameters:
  - { name: id, in: path, required: true, schema: { type: string } }
get:
  operationId: getUser
  responses:
    "200":
      description: OK
      content:
        application/json:
          schema: { $ref: "../schemas.yaml#/User" }
`)
await writeFile(join(directory, 'schemas.yaml'), `User:
  type: object
  required: [id]
  properties:
    id: { type: string }
`)

try {
  const result = await runBuiltCli(cliPath, specPath)
  assert.equal(result.code, 0, result.stderr || `oa-mock exited with ${String(result.code)}`)
  assert.match(result.stdout, /Mock server: http:\/\/127\.0\.0\.1:\d+/)
  assert.match(result.stdout, new RegExp(`spec: ${escapeRegExp(specPath)}`))
  assert.equal(result.userResponse.status, 200, 'GET /users/u1 from the path item in paths/user.yaml')
  assert.equal(typeof result.userResponse.body?.id, 'string', 'GET /users/u1 body follows schemas.yaml#/User')
  process.stdout.write('✅ built oa-mock CLI loaded a YAML spec split across files, validated it, served an operation of another file, and stopped\n')
} finally {
  await rm(directory, { recursive: true, force: true })
}

function runBuiltCli(command, spec) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [command, '--spec', spec, '--port', '0'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let userResponse
    let requestError
    let stopRequested = false
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`built CLI smoke timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 10_000)

    /** Requests an operation of the spec's other file from the running server, then stops it. */
    const requestThenStop = async url => {
      try {
        const response = await fetch(`${url}/users/u1`)
        const text = await response.text()
        userResponse = { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
      } catch (error) {
        requestError = error
      } finally {
        child.kill('SIGTERM')
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      const url = /Mock server: (\S+)\n/.exec(stdout)?.[1]
      if (!stopRequested && url) {
        stopRequested = true
        void requestThenStop(url)
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      if (requestError) {
        reject(new Error(`request to the built CLI failed: ${String(requestError)}\nstderr:\n${stderr}`))
        return
      }
      resolvePromise({ code, stdout, stderr, userResponse: userResponse ?? { status: undefined } })
    })
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// This smoke runs the dist/ already on disk and never builds it. test:ci is meant to run through
// turbo (`turbo run test:ci`): there test:ci depends on this package's build task, which builds
// dist/, or restores it from cache, for the current content of every build input. Run directly,
// nothing builds first, so fall back to modification times and require the built CLI to be newer
// than every file that shapes dist/.
function assertBuiltCliIsCurrent() {
  const remedy = 'Run test:ci through turbo (`pnpm exec turbo run test:ci --filter=@oa-sdk/mock-server`), '
    + 'which builds this package and its workspace dependencies first, '
    + 'or rebuild it with `pnpm --filter @oa-sdk/mock-server build`.'
  const builtCli = relative(packageRoot, cliPath)
  if (!existsSync(cliPath)) fail(`built CLI is missing: ${builtCli}. ${remedy}`)

  // turbo sets TURBO_HASH in the environment of every task it runs. Its build dependency keys
  // dist/ on file content; modification times would only add false alarms there, because a cache
  // hit leaves dist/ untouched when it already holds that build's output.
  if (process.env.TURBO_HASH) {
    process.stdout.write(`${builtCli} comes from the turbo build task test:ci depends on\n`)
    return
  }

  const builtAt = statSync(cliPath).mtimeMs
  const inputs = buildInputs()
  const newer = inputs
    .map(file => ({ file, modifiedAt: statSync(file).mtimeMs }))
    .filter(input => input.modifiedAt > builtAt)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .map(input => relative(packageRoot, input.file))
  if (newer.length > 0) {
    const shown = newer.slice(0, 5).join(', ') + (newer.length > 5 ? `, and ${newer.length - 5} more` : '')
    fail(`built CLI ${builtCli} is stale: ${newer.length} build input(s) changed after it was built (${shown}). ${remedy}`)
  }
  process.stdout.write(`${builtCli} is newer than its ${inputs.length} build inputs\n`)
}

// The files that shape dist/: the manifest, the tsup and TypeScript configuration, and src/ minus
// the test-only files (__tests__/, fixtures/, *.test.*) that turbo.json also leaves out of the
// build inputs, so editing a test never marks dist/ stale. Hidden entries (editor swap files,
// .DS_Store) are never imported by an entry point and are skipped too.
function buildInputs() {
  const files = readdirSync(packageRoot)
    .filter(name => /^(package\.json|tsup\.config\.[cm]?[jt]s|tsconfig.*\.json)$/.test(name))
    .map(name => join(packageRoot, name))
  collectSources(join(packageRoot, 'src'), files)
  return files
}

function collectSources(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'fixtures') collectSources(path, files)
    } else if (!entry.name.includes('.test.')) {
      files.push(path)
    }
  }
}

function fail(message) {
  process.stderr.write(`oa-mock CLI smoke: ${message}\n`)
  process.exit(1)
}
