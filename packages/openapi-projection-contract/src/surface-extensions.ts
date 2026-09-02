export const OPENAPI_SURFACE_ANCHOR_EXTENSION = 'x-surface-anchor' as const
export const OPENAPI_SURFACE_PARAM_RANGE_EXTENSION = 'x-surface-param-range' as const
export const OPENAPI_SURFACE_FINGERPRINT_EXTENSION = 'x-surface-fingerprint' as const
export const OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION = 'x-surface-quote-style' as const
export const OPENAPI_SURFACE_PATCH_POLICY_EXTENSION = 'x-surface-patch-policy' as const

export const OPENAPI_SURFACE_EXTENSION_NAMES = [
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
] as const

export type OpenApiSurfaceExtensionName = typeof OPENAPI_SURFACE_EXTENSION_NAMES[number]

export const SURFACE_QUOTE_STYLES = ['single', 'double', 'backtick', 'none'] as const
export type SurfaceQuoteStyle = typeof SURFACE_QUOTE_STYLES[number]

export const SURFACE_PATCH_POLICY_ON_DRIFT_VALUES = ['abort', 'rebase', 'force'] as const
export type SurfacePatchPolicyOnDrift = typeof SURFACE_PATCH_POLICY_ON_DRIFT_VALUES[number]

export interface SurfaceAnchorMetadata {
  id: string
  line: number
  column: number
  raw?: string
  commentType?: 'line' | 'block' | 'doc' | string
}

export interface SurfaceParamRangeMetadata {
  targetProperty?: string
  start?: number
  end?: number
  unquotedStart?: number
  unquotedEnd?: number
  supportsLivePatch?: boolean
  maxFramerateHz?: number
}

export interface SurfacePatchPolicyMetadata {
  onDrift: SurfacePatchPolicyOnDrift
  retryLimit?: number
}

export interface SurfaceExtensionFields {
  [OPENAPI_SURFACE_ANCHOR_EXTENSION]?: SurfaceAnchorMetadata
  [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]?: SurfaceParamRangeMetadata
  [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]?: string
  [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]?: SurfaceQuoteStyle
  [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]?: SurfacePatchPolicyMetadata
}

export function isOpenApiSurfaceExtensionName(value: unknown): value is OpenApiSurfaceExtensionName {
  return typeof value === 'string' && (OPENAPI_SURFACE_EXTENSION_NAMES as readonly string[]).includes(value)
}

export function isSurfaceQuoteStyle(value: unknown): value is SurfaceQuoteStyle {
  return typeof value === 'string' && (SURFACE_QUOTE_STYLES as readonly string[]).includes(value)
}

export function isSurfaceFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

export function isSurfaceAnchorMetadata(value: unknown): value is SurfaceAnchorMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.line === 'number' &&
    Number.isFinite(candidate.line) &&
    candidate.line >= 1 &&
    typeof candidate.column === 'number' &&
    Number.isFinite(candidate.column) &&
    candidate.column >= 1 &&
    (candidate.raw === undefined || typeof candidate.raw === 'string') &&
    (candidate.commentType === undefined || typeof candidate.commentType === 'string')
  )
}

export function isSurfaceParamRangeMetadata(value: unknown): value is SurfaceParamRangeMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.targetProperty !== undefined && (typeof candidate.targetProperty !== 'string' || candidate.targetProperty.length === 0)) {
    return false
  }
  if (candidate.start !== undefined && (typeof candidate.start !== 'number' || candidate.start < 0 || !Number.isFinite(candidate.start))) {
    return false
  }
  if (candidate.end !== undefined && (typeof candidate.end !== 'number' || candidate.end < 0 || !Number.isFinite(candidate.end))) {
    return false
  }
  if (candidate.unquotedStart !== undefined && (typeof candidate.unquotedStart !== 'number' || candidate.unquotedStart < 0 || !Number.isFinite(candidate.unquotedStart))) {
    return false
  }
  if (candidate.unquotedEnd !== undefined && (typeof candidate.unquotedEnd !== 'number' || candidate.unquotedEnd < 0 || !Number.isFinite(candidate.unquotedEnd))) {
    return false
  }
  if (candidate.supportsLivePatch !== undefined && typeof candidate.supportsLivePatch !== 'boolean') {
    return false
  }
  if (candidate.maxFramerateHz !== undefined && (typeof candidate.maxFramerateHz !== 'number' || candidate.maxFramerateHz <= 0 || !Number.isFinite(candidate.maxFramerateHz))) {
    return false
  }
  return true
}

export function isSurfacePatchPolicyMetadata(value: unknown): value is SurfacePatchPolicyMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.onDrift !== 'string' || !(SURFACE_PATCH_POLICY_ON_DRIFT_VALUES as readonly string[]).includes(candidate.onDrift)) {
    return false
  }
  if (candidate.retryLimit !== undefined && (typeof candidate.retryLimit !== 'number' || candidate.retryLimit < 0 || !Number.isFinite(candidate.retryLimit))) {
    return false
  }
  return true
}
