import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cliPath = join(packageRoot, 'dist/cli/index.js')
assert.equal(existsSync(cliPath), true, `built CLI is missing: ${cliPath}`)

const directory = await mkdtemp(join(tmpdir(), 'oa-mock-cli-'))
const specPath = join(directory, 'openapi.yaml')
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
`)

try {
  const result = await runBuiltCli(cliPath, specPath)
  assert.equal(result.code, 0, result.stderr || `oa-mock exited with ${String(result.code)}`)
  assert.match(result.stdout, /Mock server: http:\/\/127\.0\.0\.1:\d+/)
  assert.match(result.stdout, new RegExp(`spec: ${escapeRegExp(specPath)}`))
  process.stdout.write('✅ built oa-mock CLI loaded YAML, validated it, started, and stopped\n')
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
    let stopRequested = false
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`built CLI smoke timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (!stopRequested && stdout.includes('Mock server:')) {
        stopRequested = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
