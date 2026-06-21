import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { applyTypeSpecCompatibilitySidecar, parseTypeSpecCompatibilitySidecar } from '../cli/lib/typespec-sidecar.js'
import { loadSpecWithPath } from '../cli/lib/load-spec.js'
import { diffEndpoints, hasBreakingChanges } from '../cli/lib/openapi-breaking-diff.js'
import { validateDocument } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../..')
const rootDir = resolve(pkgDir, '../..')
const fixtureDir = resolve(rootDir, 'docs/internal/typespec-roundtrip/fixtures/authored-bundle')
const tmpBase = resolve(pkgDir, '.tmp-typespec-authored-bundle-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

describe('authored TypeSpec compatibility bundle', () => {
  it('compiles authored .tsp, restores sidecar metadata, and matches the expected OpenAPI surface', () => {
    const compile = spawnSync('pnpm', [
      'exec',
      'tsp',
      'compile',
      fixtureDir,
      '--output-dir',
      tmpDir,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    expect(compile.status, `${compile.stdout}\n${compile.stderr}`).toBe(0)

    const emittedPath = join(tmpDir, '@typespec/openapi3/openapi.yaml')
    const { document: emitted } = loadSpecWithPath(emittedPath)
    const emittedValidation = validateDocument(emitted, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })
    expect(emittedValidation.valid, emittedValidation.summary).toBe(true)

    const sidecar = parseTypeSpecCompatibilitySidecar(JSON.parse(
      readFileSync(join(fixtureDir, 'oa-sdk.typespec-compat-sidecar.json'), 'utf8'),
    ) as unknown)
    const restored = applyTypeSpecCompatibilitySidecar(emitted, sidecar)
    const restoredValidation = validateDocument(restored.document, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })
    expect(restoredValidation.valid, restoredValidation.summary).toBe(true)
    expect(restored.report.counts).toEqual({
      entries: 3,
      applied: 3,
      missingTargets: 0,
    })

    const { document: expected } = loadSpecWithPath(join(fixtureDir, 'expected.openapi.yaml'))
    expect(hasBreakingChanges(diffEndpoints(expected, restored.document))).toBe(false)

    const restoredDoc = restored.document as Record<string, any>
    expect(restoredDoc.paths['/users'].get.parameters[0].examples).toEqual({
      default: {
        dataValue: 1,
        serializedValue: 'page=1',
      },
    })
    expect(restoredDoc.paths['/users'].get.responses['200'].content['application/json'].examples).toEqual({
      default: {
        dataValue: [
          {
            id: 'usr_1',
            name: 'Alice',
          },
        ],
      },
    })
    expect(restoredDoc.components.securitySchemes.oauth2).toEqual(sidecar.entries.find(entry => entry.kind === 'security-scheme')?.value)
  })
})
