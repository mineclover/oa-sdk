import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  directorySnapshotDifferences,
  preservingDirectory,
  snapshotDirectory,
} from './lib/directory-snapshot.js'
import {
  parseSchemaRollbackArgs,
  runSchemaRollbackCheck,
  SCHEMA_ARTIFACT_DIRECTORY,
  schemaRollbackSteps,
  validateReusedTypeSpecReport,
} from './schema-rollback-check.js'

const root = resolve(import.meta.dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-schema-rollback-report-'))

try {
  const reportPath = join(directory, 'report.json')
  const validReport = {
    schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1',
    validation: {
      emitted: { valid: true },
      restored: { valid: true },
      expected: { valid: true },
    },
    gates: {
      compatibilitySidecar: 'pass',
      emittedValidation: 'pass',
      restoredValidation: 'pass',
      expectedValidation: 'pass',
      provenance: 'pass',
      expectedDiff: 'pass',
    },
    provenance: { valid: true },
  }
  writeFileSync(reportPath, `${JSON.stringify(validReport)}\n`, 'utf8')

  assert.equal(parseSchemaRollbackArgs([]), undefined)
  assert.equal(parseSchemaRollbackArgs(['--typespec-report', reportPath]), reportPath)
  assert.equal(parseSchemaRollbackArgs(['--', '--typespec-report', reportPath]), reportPath)
  assert.throws(() => parseSchemaRollbackArgs(['--skip-typespec']), /Unknown schema rollback option/)
  assert.throws(() => parseSchemaRollbackArgs(['--typespec-report']), /requires a file path/)
  assert.doesNotThrow(() => validateReusedTypeSpecReport(reportPath))

  writeFileSync(reportPath, `${JSON.stringify({
    ...validReport,
    gates: { ...validReport.gates, provenance: 'fail' },
  })}\n`, 'utf8')
  assert.throws(
    () => validateReusedTypeSpecReport(reportPath),
    /does not satisfy every production gate/,
  )

  console.log('Schema rollback report reuse tests passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}

// The guarded directory holds every committed spec artifact the rollback
// pipeline writes (packages/schemas `downgrade:3.1`).
{
  const trackedArtifacts = execFileSync('git', ['ls-files', '--', relative(root, SCHEMA_ARTIFACT_DIRECTORY)], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  for (const artifact of ['.merged.3.1.yaml', '.merged.3.1.meta.json']) {
    assert.ok(
      trackedArtifacts.includes(relative(root, join(SCHEMA_ARTIFACT_DIRECTORY, artifact))),
      `${artifact} is a committed artifact below ${SCHEMA_ARTIFACT_DIRECTORY}`,
    )
  }
  assert.deepEqual(schemaRollbackSteps('report.json').map(step => step.args), [['schema:validate:openapi']])
  assert.deepEqual(schemaRollbackSteps(undefined).map(step => step.args), [['schema:typespec-check'], ['schema:validate:openapi']])
}

// The rollback check leaves the artifact directory byte-identical, whatever
// its steps write there and whether they pass or fail.
const artifactFixture = mkdtempSync(join(tmpdir(), 'oa-sdk-schema-rollback-artifacts-'))
try {
  const artifacts = join(artifactFixture, 'src')
  mkdirSync(join(artifacts, '.builder'), { recursive: true })
  mkdirSync(join(artifacts, 'fragments/empty'), { recursive: true })
  writeFileSync(join(artifacts, '.merged.3.1.yaml'), 'openapi: 3.1.0\ninfo: { title: typespec build }\n')
  writeFileSync(join(artifacts, '.merged.3.1.meta.json'), '{"source":".merged.yaml"}')
  writeFileSync(join(artifacts, '.merged.yaml'), 'openapi: 3.2.0\n')
  writeFileSync(join(artifacts, '.builder/typespec-bundle-report.json'), '{}\n')
  writeFileSync(join(artifacts, 'run.sh'), '#!/bin/sh\n')
  chmodSync(join(artifacts, 'run.sh'), 0o755)
  symlinkSync('.merged.yaml', join(artifacts, 'current.yaml'))
  const before = snapshotDirectory(artifacts)

  /** What the rollback pipeline does to the directory: rebuild, downgrade, and leave diagnostics. */
  const rollbackBuild = () => {
    writeFileSync(join(artifacts, '.merged.yaml'), 'openapi: 3.2.0\ninfo: { title: rollback build }\n')
    writeFileSync(join(artifacts, '.merged.3.1.yaml'), 'openapi: 3.1.0\ninfo: { title: rollback build }\n')
    rmSync(join(artifacts, '.merged.3.1.meta.json'), { force: true })
    writeFileSync(join(artifacts, '.builder/local-api.diagnostics.json'), '[]\n')
    mkdirSync(join(artifacts, '.projected/nested'), { recursive: true })
    writeFileSync(join(artifacts, '.projected/nested/out.yaml'), 'x: 1\n')
    rmSync(join(artifacts, 'fragments/empty'), { recursive: true, force: true })
    chmodSync(join(artifacts, 'run.sh'), 0o644)
    rmSync(join(artifacts, 'current.yaml'), { force: true })
    symlinkSync('.merged.3.1.yaml', join(artifacts, 'current.yaml'))
  }

  const ran: string[][] = []
  await runSchemaRollbackCheck(schemaRollbackSteps(undefined), async step => {
    ran.push(step.args)
    rollbackBuild()
  }, artifacts)
  assert.deepEqual(ran, [['schema:typespec-check'], ['schema:validate:openapi']])
  assert.deepEqual(directorySnapshotDifferences(artifacts, before), [])
  assert.equal(readFileSync(join(artifacts, '.merged.3.1.yaml'), 'utf8'), 'openapi: 3.1.0\ninfo: { title: typespec build }\n')
  assert.equal(statSync(join(artifacts, 'run.sh')).mode & 0o777, 0o755)
  assert.ok(!existsSync(join(artifacts, '.builder/local-api.diagnostics.json')))
  assert.ok(!existsSync(join(artifacts, '.projected')))

  // A failing gate still restores, and its error surfaces.
  await assert.rejects(
    runSchemaRollbackCheck(schemaRollbackSteps('report.json'), async () => {
      rollbackBuild()
      throw new Error('Command failed with exit code 1: pnpm schema:validate:openapi')
    }, artifacts),
    /Command failed with exit code 1: pnpm schema:validate:openapi/,
  )
  assert.deepEqual(directorySnapshotDifferences(artifacts, before), [])

  // The difference report names every path that changed.
  rollbackBuild()
  assert.deepEqual(directorySnapshotDifferences(artifacts, before), [
    '.builder/local-api.diagnostics.json',
    '.merged.3.1.meta.json',
    '.merged.3.1.yaml',
    '.merged.yaml',
    '.projected',
    '.projected/nested',
    '.projected/nested/out.yaml',
    'current.yaml',
    'fragments/empty',
    'run.sh',
  ])
  await preservingDirectory(artifacts, async () => undefined)
  assert.equal(directorySnapshotDifferences(artifacts, before).length, 10, 'a preserve keeps the state it started from')

  console.log('Schema rollback artifact restore tests passed')
} finally {
  rmSync(artifactFixture, { recursive: true, force: true })
}
