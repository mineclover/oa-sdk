import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseSchemaRollbackArgs,
  validateReusedTypeSpecReport,
} from './schema-rollback-check.js'

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
