import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  isTypeSpecOpenApiExtensionSchemaVersion,
  TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS,
} from '../cli/lib/typespec-extension-schema-version.js'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-extension-version-'))

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('TypeSpec OpenAPI extension schema versions', () => {
  it('uses one runtime taxonomy for every supported version', () => {
    for (const version of TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS) {
      expect(isTypeSpecOpenApiExtensionSchemaVersion(version)).toBe(true)
    }
    expect(isTypeSpecOpenApiExtensionSchemaVersion('oa-sdk.typespec-extensions.v6')).toBe(false)
  })

  it('allows the repository migration CLI to target the production v5 vocabulary', () => {
    const sidecarPath = join(workspace, 'oa-sdk.typespec-compat-sidecar.json')
    const reportPath = join(workspace, 'report.json')
    writeFileSync(sidecarPath, `${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      counts: {
        entries: 0,
        parameterExamples: 0,
        responseMediaExamples: 0,
        securitySchemes: 0,
      },
      entries: [],
    }, null, 2)}\n`)

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      join(repoRoot, 'scripts/typespec-sidecar-to-extensions.ts'),
      '--',
      '--sidecar',
      sidecarPath,
      '--extension-schema-version',
      'oa-sdk.typespec-extensions.v5',
      '--report',
      reportPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      extensionSchemaVersion: 'oa-sdk.typespec-extensions.v5',
    })
  })
})
