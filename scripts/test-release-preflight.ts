import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  draftReleasePreflightGates,
  parseReleasePreflightArgs,
  releasePreflightGates,
} from './release-preflight.js'

assert.deepEqual(parseReleasePreflightArgs([]), { allowDirty: false })
assert.deepEqual(parseReleasePreflightArgs(['--allow-dirty']), { allowDirty: true })
assert.deepEqual(parseReleasePreflightArgs(['--', '--allow-dirty']), { allowDirty: true })
assert.throws(() => parseReleasePreflightArgs(['--unknown']), /unknown option/)
assert.throws(() => parseReleasePreflightArgs(['--allow-dirty', '--allow-dirty']), /duplicate option/)

assert.deepEqual(
  draftReleasePreflightGates.map(gate => gate.label),
  ['check:docs', 'check:package-versions', 'check:spec-governance', 'check:release-policy'],
)
assert.deepEqual(
  releasePreflightGates.map(gate => gate.label),
  [
    'build:core',
    'check:docs',
    'check:package-versions',
    'check:spec-governance',
    'check:release-policy',
    'schema:validate',
    'schema:downstream-check',
    'typecheck:core',
    'test:core:ci',
    'codegen smoke:pack',
  ],
)
assert.ok(!draftReleasePreflightGates.some(gate => gate.label === 'schema:validate'))
assert.ok(!draftReleasePreflightGates.some(gate => gate.label === 'test:core:ci'))

const packageScripts = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  scripts?: Record<string, unknown>
}
assert.match(
  String(packageScripts.scripts?.['schema:validate']),
  /schema:prepare-openapi/,
  'schema:validate must prepare all workspace build dependencies for a fresh checkout',
)

console.log('Release preflight mode tests passed.')
