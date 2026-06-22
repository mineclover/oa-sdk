import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
} from '../cli/lib/typespec-sidecar.js'
import { loadSpecWithPath } from '../cli/lib/load-spec.js'
import { diffEndpoints, hasBreakingChanges } from '../cli/lib/openapi-breaking-diff.js'
import { validateDocument } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../..')
const rootDir = resolve(pkgDir, '../..')
const fixtureDir = resolve(rootDir, 'docs/internal/typespec-roundtrip/fixtures/authored-bundle')
const extensionFixtureDir = resolve(rootDir, 'docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle')
const representativeFixtureDir = resolve(rootDir, 'docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle')
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
  it('checks the authored .tsp + sidecar bundle through its manifest', () => {
    const reportPath = join(tmpDir, 'bundle-report.json')
    const check = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest',
      join(fixtureDir, 'oa-sdk.typespec-bundle.json'),
      '--fail-on-breaking',
      '--report',
      reportPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>
    expect(report.bundle).toEqual({
      source: 'manifest',
      compatibilitySource: 'sidecar',
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      compatibility: {
        openapiVersion: '3.2.0',
        sidecarSchemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
      },
    })
    expect(report.paths.manifest).toBe(join(fixtureDir, 'oa-sdk.typespec-bundle.json'))
    expect(report.paths.entrypoint).toBe(join(fixtureDir, 'main.tsp'))
    expect(report.paths.sidecar).toBe(join(fixtureDir, 'oa-sdk.typespec-compat-sidecar.json'))
    expect(report.paths.expectedOpenapi).toBe(join(fixtureDir, 'expected.openapi.yaml'))
    expect(report.gates).toEqual({
      compatibilitySidecar: 'pass',
      restoredValidation: 'pass',
      expectedDiff: 'pass',
    })
  })

  it('checks a sidecar-less authored .tsp bundle using OA SDK TypeSpec extension metadata', () => {
    const reportPath = join(tmpDir, 'extension-bundle-report.json')
    const restoredPath = join(tmpDir, 'extension-restored.yaml')
    const check = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest',
      join(extensionFixtureDir, 'oa-sdk.typespec-bundle.json'),
      '--fail-on-breaking',
      '--report',
      reportPath,
      '--output',
      restoredPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>
    expect(report.bundle).toEqual({
      source: 'manifest',
      compatibilitySource: 'typespec-extensions',
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      compatibility: {
        openapiVersion: '3.2.0',
        oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v1',
      },
    })
    expect(report.paths.manifest).toBe(join(extensionFixtureDir, 'oa-sdk.typespec-bundle.json'))
    expect(report.paths.entrypoint).toBe(join(extensionFixtureDir, 'main.tsp'))
    expect(report.paths.sidecar).toBeUndefined()
    expect(report.gates).toEqual({
      compatibilitySidecar: 'pass',
      restoredValidation: 'pass',
      expectedDiff: 'pass',
    })
    expect(report.counts.compatibilitySidecar).toEqual({
      entries: 3,
      parameterExamples: 1,
      responseMediaExamples: 1,
      securitySchemes: 1,
    })

    const { document: restored } = loadSpecWithPath(restoredPath)
    const restoredDoc = restored as Record<string, any>
    expect(restoredDoc['x-oa-sdk-security-schemes']).toBeUndefined()
    expect(restoredDoc.paths['/users'].get['x-oa-sdk-operation-examples']).toBeUndefined()
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
    expect(restoredDoc.components.securitySchemes.oauth2.flows.authorizationCode.scopes).toEqual({
      'read:users': 'Read users',
    })
  })

  it('checks the representative sidecar-less authored .tsp bundle', () => {
    const reportPath = join(tmpDir, 'representative-bundle-report.json')
    const restoredPath = join(tmpDir, 'representative-restored.yaml')
    const check = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest',
      join(representativeFixtureDir, 'oa-sdk.typespec-bundle.json'),
      '--fail-on-breaking',
      '--report',
      reportPath,
      '--output',
      restoredPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>
    expect(report.bundle).toEqual({
      source: 'manifest',
      compatibilitySource: 'typespec-extensions',
      schemaVersion: 'oa-sdk.typespec-bundle.v1',
      compatibility: {
        openapiVersion: '3.2.0',
        oaSdkExtensionSchemaVersion: 'oa-sdk.typespec-extensions.v1',
      },
    })
    expect(report.counts).toMatchObject({
      emittedOperations: 3,
      restoredOperations: 3,
      expectedOperations: 3,
      compatibilitySidecar: {
        entries: 6,
        parameterExamples: 2,
        responseMediaExamples: 3,
        securitySchemes: 1,
      },
      restore: {
        entries: 6,
        applied: 6,
        missingTargets: 0,
      },
      sidecarStability: {
        expectedEntries: 6,
        actualEntries: 6,
        expectedSatisfied: 6,
        actualCovered: 6,
        missingExpected: 0,
        unexpectedActual: 0,
        valueMismatches: 0,
      },
    })
    expect(report.gates).toEqual({
      compatibilitySidecar: 'pass',
      restoredValidation: 'pass',
      expectedDiff: 'pass',
    })

    const { document: restored } = loadSpecWithPath(restoredPath)
    const restoredDoc = restored as Record<string, any>
    expect(restoredDoc['x-oa-sdk-security-schemes']).toBeUndefined()
    expect(restoredDoc.paths['/users'].get['x-oa-sdk-operation-examples']).toBeUndefined()
    expect(restoredDoc.paths['/users'].post['x-oa-sdk-operation-examples']).toBeUndefined()
    expect(restoredDoc.paths['/users/{id}/reports'].post['x-oa-sdk-operation-examples']).toBeUndefined()
    expect(restoredDoc.paths['/users'].get.parameters[0].examples.default).toEqual({
      dataValue: 1,
      serializedValue: 'page=1',
    })
    expect(restoredDoc.paths['/users'].get.responses['200'].content['application/json'].examples.default.dataValue.total).toBe(1)
    expect(restoredDoc.components.securitySchemes.oauth2.flows.authorizationCode.scopes).toEqual({
      read: 'Read access',
      write: 'Write access',
    })
    expect(restoredDoc.paths['/users'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/CreateUserRequest')
    expect(restoredDoc.components.schemas.Error.properties.details.items.anyOf).toEqual([
      { $ref: '#/components/schemas/ValidationError' },
      { $ref: '#/components/schemas/ErrorMeta' },
    ])
  })

  it('rejects a sidecar-less manifest without an OA SDK TypeSpec extension schema declaration', () => {
    const bundleDir = join(tmpDir, 'extension-bundle-without-schema-version')
    cpSync(extensionFixtureDir, bundleDir, { recursive: true })
    const manifestPath = join(bundleDir, 'oa-sdk.typespec-bundle.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    delete manifest.compatibility.oaSdkExtensionSchemaVersion
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const check = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest',
      manifestPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })

    expect(check.status).not.toBe(0)
    expect(`${check.stdout}\n${check.stderr}`).toContain(
      'sidecar-less TypeSpec bundle manifests must declare compatibility.oaSdkExtensionSchemaVersion',
    )
  })

  it('rejects a manifest entrypoint that diverges from the TypeSpec project config', () => {
    const bundleDir = join(tmpDir, 'bundle')
    cpSync(fixtureDir, bundleDir, { recursive: true })
    copyFileSync(join(bundleDir, 'main.tsp'), join(bundleDir, 'alternate.tsp'))
    const manifestPath = join(bundleDir, 'oa-sdk.typespec-bundle.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      entrypoint: 'alternate.tsp',
    }, null, 2)}\n`)

    const check = spawnSync('pnpm', [
      'typespec:bundle-check',
      '--',
      '--manifest',
      manifestPath,
    ], {
      cwd: rootDir,
      encoding: 'utf8',
    })

    expect(check.status).not.toBe(0)
    expect(`${check.stdout}\n${check.stderr}`).toContain('manifest entrypoint alternate.tsp does not match')
  })

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
    const reExtractedSidecar = createTypeSpecCompatibilitySidecar(restored.document)
    expect(compareTypeSpecCompatibilitySidecars(sidecar, reExtractedSidecar).counts).toEqual({
      expectedEntries: 3,
      actualEntries: 3,
      expectedSatisfied: 3,
      actualCovered: 3,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
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
