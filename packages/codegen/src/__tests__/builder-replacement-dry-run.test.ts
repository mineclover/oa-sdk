import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract'
import { buildSpec } from '../cli/lib/build-spec.js'
import { diffOpenApiDocuments } from '../cli/lib/openapi-normalized-diff.js'

const pkgDir = resolve(__dirname, '../..')
const repoRoot = resolve(pkgDir, '../..')
const schemasSrcDir = join(repoRoot, 'packages/schemas/src')
const currentMergedPath = join(schemasSrcDir, '.merged.yaml')
const tmpBase = resolve(pkgDir, '.tmp-builder-replacement-dry-run-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('definition builder replacement dry-run', () => {
  it('builds the replacement candidate, validates consumers, and leaves .merged.yaml unchanged', () => {
    const before = readFileSync(currentMergedPath, 'utf8')
    const outputPath = join(tmpDir, '.builder', 'local-parity-api.yaml')
    const diagnosticsPath = join(tmpDir, '.builder', 'local-parity-api.diagnostics.json')
    const collisionReportPath = join(tmpDir, '.builder', 'local-parity-api.collisions.json')

    const result = buildSpec({
      targetPath: join(schemasSrcDir, 'targets/local-parity-api.yaml'),
      fragmentsDir: join(schemasSrcDir, 'fragments'),
      outputPath,
      diagnosticsPath,
      collisionReportPath,
    })
    const after = readFileSync(currentMergedPath, 'utf8')
    const currentMerged = parseYaml(before) as Record<string, unknown>

    expect(result.valid).toBe(true)
    expect(result.summary.errors).toBe(0)
    expect(result.summary.outputPath).toBe(resolve(outputPath))
    expect(resolve(outputPath)).not.toBe(resolve(currentMergedPath))
    expect(hash(after)).toBe(hash(before))
    expect(after).toBe(before)
    expect(diffOpenApiDocuments(currentMerged, result.document)).toEqual([])
    expect(validateOpenApiProjection(result.projection)).toEqual({ valid: true, diagnostics: [] })

    expect(existsSync(outputPath)).toBe(true)
    expect(existsSync(diagnosticsPath)).toBe(true)
    expect(existsSync(collisionReportPath)).toBe(true)
    expect(JSON.parse(readFileSync(diagnosticsPath, 'utf8'))).toEqual(expect.objectContaining({
      valid: true,
      summary: expect.objectContaining({ errors: 0 }),
    }))
    expect(JSON.parse(readFileSync(collisionReportPath, 'utf8'))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canonicalId: 'securityScheme:shared/common/BearerAuth',
        severity: 'warning',
      }),
    ]))
  })
})

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
