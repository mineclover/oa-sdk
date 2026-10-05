import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stringify } from 'yaml'

const pkgDir = resolve(__dirname, '../..')
const rootDir = resolve(pkgDir, '../..')
let tmpDir = ''

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = ''
})

describe('typespec roundtrip semantic-loss gate', () => {
  it('fails querystring loss by default while retaining the report', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-roundtrip-loss-'))
    const specPath = join(tmpDir, 'querystring.yaml')
    const reportPath = join(tmpDir, 'roundtrip-report.json')
    writeFileSync(specPath, stringify({
      openapi: '3.2.0',
      info: { title: 'Querystring API', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [{
              name: 'rawQuery',
              in: 'querystring',
              required: true,
              schema: { type: 'string' },
            }],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    }), 'utf8')

    const result = spawnSync('pnpm', [
      'typespec:roundtrip',
      '--',
      '--spec',
      specPath,
      '--report',
      reportPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: SUBPROCESS_TEST_BUDGET_MS,
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
    expect(result.stderr).toContain('blocked by unaccepted export diagnostics')
    expect(existsSync(reportPath)).toBe(true)
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      gates: { exportDiagnostics: string }
      diagnostics: Array<{ code: string; policy: { accepted: boolean; disposition: string } }>
    }
    expect(report.gates.exportDiagnostics).toBe('fail')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'parameter/querystring-unsupported',
      policy: expect.objectContaining({ accepted: false, disposition: 'contract-bearing' }),
    }))
  })
})
