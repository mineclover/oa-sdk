import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'

export type TypeSpecOpenApiExtensionSchemaVersion =
  | 'oa-sdk.typespec-extensions.v1'
  | 'oa-sdk.typespec-extensions.v2'
  | 'oa-sdk.typespec-extensions.v3'
  | 'oa-sdk.typespec-extensions.v4'
  | 'oa-sdk.typespec-extensions.v5'

export type TypeSpecBundleManifest = {
  schemaVersion: 'oa-sdk.typespec-bundle.v1'
  entrypoint: string
  sidecar?: string
  expectedOpenapi?: string
  compatibility?: {
    openapiVersion?: string
    sidecarSchemaVersion?: string
    oaSdkExtensionSchemaVersion?: TypeSpecOpenApiExtensionSchemaVersion
  }
}

export type TypeSpecBundleManifestPaths = {
  entrypointPath: string
  sidecarPath?: string
  expectedOpenapiPath?: string
}

export function createTypeSpecBundleManifest(input: {
  manifestPath: string
  entrypointPath: string
  sidecarPath: string
  expectedOpenapiPath?: string
}): TypeSpecBundleManifest {
  return {
    schemaVersion: 'oa-sdk.typespec-bundle.v1',
    entrypoint: toBundleRelativePath(input.manifestPath, input.entrypointPath, 'entrypoint'),
    sidecar: toBundleRelativePath(input.manifestPath, input.sidecarPath, 'sidecar'),
    ...(input.expectedOpenapiPath
      ? { expectedOpenapi: toBundleRelativePath(input.manifestPath, input.expectedOpenapiPath, 'expectedOpenapi') }
      : {}),
    compatibility: {
      openapiVersion: '3.2.0',
      sidecarSchemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
    },
  }
}

export function parseTypeSpecBundleManifest(value: unknown, path = '<memory>'): TypeSpecBundleManifest {
  const errors: string[] = []
  if (!isRecord(value)) {
    throw new Error(`invalid TypeSpec bundle manifest ${path}: expected object`)
  }
  if (value.schemaVersion !== 'oa-sdk.typespec-bundle.v1') {
    errors.push('schemaVersion must be oa-sdk.typespec-bundle.v1')
  }
  const entrypoint = readManifestRelativePath(value, 'entrypoint', errors)
  const sidecar = readOptionalManifestRelativePath(value, 'sidecar', errors)
  const expectedOpenapi = readOptionalManifestRelativePath(value, 'expectedOpenapi', errors)
  let compatibility: TypeSpecBundleManifest['compatibility']
  if (value.compatibility !== undefined) {
    if (!isRecord(value.compatibility)) {
      errors.push('compatibility must be an object')
    } else {
      const openapiVersion = optionalString(value.compatibility, 'openapiVersion', errors)
      const sidecarSchemaVersion = optionalString(value.compatibility, 'sidecarSchemaVersion', errors)
      const oaSdkExtensionSchemaVersion = optionalString(value.compatibility, 'oaSdkExtensionSchemaVersion', errors)
      compatibility = {
        ...(openapiVersion ? { openapiVersion } : {}),
        ...(sidecarSchemaVersion ? { sidecarSchemaVersion } : {}),
        ...(oaSdkExtensionSchemaVersion
          ? { oaSdkExtensionSchemaVersion: oaSdkExtensionSchemaVersion as TypeSpecOpenApiExtensionSchemaVersion }
          : {}),
      }
      if (sidecarSchemaVersion && sidecarSchemaVersion !== 'oa-sdk.typespec-compat-sidecar.v1') {
        errors.push('compatibility.sidecarSchemaVersion must be oa-sdk.typespec-compat-sidecar.v1')
      }
      if (oaSdkExtensionSchemaVersion && !isTypeSpecOpenApiExtensionSchemaVersion(oaSdkExtensionSchemaVersion)) {
        errors.push('compatibility.oaSdkExtensionSchemaVersion must be oa-sdk.typespec-extensions.v1, oa-sdk.typespec-extensions.v2, oa-sdk.typespec-extensions.v3, oa-sdk.typespec-extensions.v4, or oa-sdk.typespec-extensions.v5')
      }
    }
  }
  if (!sidecar && !compatibility?.oaSdkExtensionSchemaVersion) {
    errors.push('sidecar-less TypeSpec bundle manifests must declare compatibility.oaSdkExtensionSchemaVersion')
  }
  if (errors.length > 0 || !entrypoint) {
    throw new Error(`invalid TypeSpec bundle manifest ${path}: ${errors.join('; ')}`)
  }
  return {
    schemaVersion: 'oa-sdk.typespec-bundle.v1',
    entrypoint,
    ...(sidecar ? { sidecar } : {}),
    ...(expectedOpenapi ? { expectedOpenapi } : {}),
    ...(compatibility ? { compatibility } : {}),
  }
}

export function resolveTypeSpecBundleManifestPaths(
  manifest: TypeSpecBundleManifest,
  manifestPath: string,
): TypeSpecBundleManifestPaths {
  const manifestBase = dirname(manifestPath)
  return {
    entrypointPath: resolveBundlePath(manifestBase, manifest.entrypoint, 'entrypoint'),
    ...(manifest.sidecar ? { sidecarPath: resolveBundlePath(manifestBase, manifest.sidecar, 'sidecar') } : {}),
    ...(manifest.expectedOpenapi
      ? { expectedOpenapiPath: resolveBundlePath(manifestBase, manifest.expectedOpenapi, 'expectedOpenapi') }
      : {}),
  }
}

function toBundleRelativePath(manifestPath: string, targetPath: string, key: string): string {
  const relativePath = relative(dirname(manifestPath), targetPath).split('\\').join('/')
  const errors: string[] = []
  validateManifestRelativePath(relativePath, key, errors)
  if (errors.length > 0) {
    throw new Error(`cannot write TypeSpec bundle manifest: ${errors.join('; ')}`)
  }
  return relativePath
}

function resolveBundlePath(basePath: string, path: string, key: string): string {
  const errors: string[] = []
  validateManifestRelativePath(path, key, errors)
  if (errors.length > 0) throw new Error(errors.join('; '))
  return resolve(basePath, path)
}

function readManifestRelativePath(record: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${key} must be a non-empty relative path`)
    return undefined
  }
  validateManifestRelativePath(value, key, errors)
  return value
}

function readOptionalManifestRelativePath(record: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  if (record[key] === undefined) return undefined
  return readManifestRelativePath(record, key, errors)
}

function optionalString(record: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`compatibility.${key} must be a non-empty string`)
    return undefined
  }
  return value
}

function isTypeSpecOpenApiExtensionSchemaVersion(value: string): value is TypeSpecOpenApiExtensionSchemaVersion {
  return value === 'oa-sdk.typespec-extensions.v1'
    || value === 'oa-sdk.typespec-extensions.v2'
    || value === 'oa-sdk.typespec-extensions.v3'
    || value === 'oa-sdk.typespec-extensions.v4'
    || value === 'oa-sdk.typespec-extensions.v5'
}

function validateManifestRelativePath(path: string, key: string, errors: string[]): void {
  const normalized = normalize(path)
  if (isAbsolute(path) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) {
    errors.push(`${key} must stay inside the TypeSpec bundle directory`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
