export const TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS = [
  'oa-sdk.typespec-extensions.v1',
  'oa-sdk.typespec-extensions.v2',
  'oa-sdk.typespec-extensions.v3',
  'oa-sdk.typespec-extensions.v4',
  'oa-sdk.typespec-extensions.v5',
] as const

export type TypeSpecOpenApiExtensionSchemaVersion =
  typeof TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS[number]

const TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSION_SET = new Set<string>(
  TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS,
)

export function isTypeSpecOpenApiExtensionSchemaVersion(
  value: unknown,
): value is TypeSpecOpenApiExtensionSchemaVersion {
  return typeof value === 'string'
    && TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSION_SET.has(value)
}

export function formatTypeSpecOpenApiExtensionSchemaVersions(): string {
  const values = TYPESPEC_OPENAPI_EXTENSION_SCHEMA_VERSIONS
  return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`
}
