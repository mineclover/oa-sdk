import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  formatTypeSpecOpenApiExtensionSchemaVersions,
  isTypeSpecOpenApiExtensionSchemaVersion,
  TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS,
} from '../cli/lib/typespec-extension-schema-version.js'
import { parseTypeSpecBundleManifest } from '../cli/lib/typespec-bundle-manifest.js'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-extension-version-'))

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('TypeSpec OpenAPI extension schema versions', () => {
  it('supports v5 only and formats the manifest validation contract precisely', () => {
    expect(TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS).toEqual([
      'oa-sdk.typespec-extensions.v5',
    ])
    expect(isTypeSpecOpenApiExtensionSchemaVersion('oa-sdk.typespec-extensions.v5')).toBe(true)
    for (const version of [1, 2, 3, 4]) {
      expect(isTypeSpecOpenApiExtensionSchemaVersion(`oa-sdk.typespec-extensions.v${version}`)).toBe(false)
    }
    expect(isTypeSpecOpenApiExtensionSchemaVersion('oa-sdk.typespec-extensions.v6')).toBe(false)
    expect(formatTypeSpecOpenApiExtensionSchemaVersions()).toBe('oa-sdk.typespec-extensions.v5')
  })

  it('uses v5 when the repository migration CLI omits an extension version', () => {
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

  it.each([1, 2, 3, 4])('rejects retired v%i in the migration CLI', (version) => {
    const sidecarPath = join(workspace, `retired-v${version}-sidecar.json`)
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
      `oa-sdk.typespec-extensions.v${version}`,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--extension-schema-version must be oa-sdk.typespec-extensions.v5')
  })

  it.each([1, 2, 3, 4])('rejects retired v%i bundle manifests', (version) => {
    expect(() => parseTypeSpecBundleManifest({
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      entrypoint: 'main.tsp',
      compatibility: {
        openapiVersion: '3.2.0',
        oaSdkExtensionSchemaVersion: `oa-sdk.typespec-extensions.v${version}`,
      },
    })).toThrow('compatibility.oaSdkExtensionSchemaVersion must be oa-sdk.typespec-extensions.v5')
  })
})
