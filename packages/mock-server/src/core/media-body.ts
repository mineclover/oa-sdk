import type { OasMediaType, OasSchema, Referenceable } from '@oa-sdk/parser'
import { generator } from './generate.js'

export type MediaTypeLike = { example?: unknown; examples?: unknown; schema?: unknown } | undefined

export type PickedMediaType = {
  contentType: string
  mediaType: MediaTypeLike
}

export function pickFirstMediaType(
  content: Record<string, Referenceable<OasMediaType>> | undefined,
  fallbackContentType = 'application/json',
): PickedMediaType {
  if (!content) return { contentType: fallbackContentType, mediaType: undefined }

  for (const [contentType, mediaType] of Object.entries(content)) {
    if (mediaType && typeof mediaType === 'object' && '$ref' in mediaType) continue
    return { contentType, mediaType: mediaType as MediaTypeLike }
  }

  return { contentType: fallbackContentType, mediaType: undefined }
}

export function resolveExampleOnly(mediaType: MediaTypeLike): unknown {
  if (!mediaType) return null
  if (mediaType.examples && typeof mediaType.examples === 'object') {
    const first = Object.values(mediaType.examples)[0] as { value?: unknown; dataValue?: unknown } | undefined
    const body = first && 'dataValue' in first ? first.dataValue : first?.value
    if (body !== undefined) return body
  }
  if (mediaType.example !== undefined) return mediaType.example
  return null
}

export function resolveMediaTypeBody(mediaType: MediaTypeLike): unknown {
  if (!mediaType) return null
  if (mediaType.examples && typeof mediaType.examples === 'object') {
    const first = Object.values(mediaType.examples)[0] as { value?: unknown; dataValue?: unknown } | undefined
    const body = first && 'dataValue' in first ? first.dataValue : first?.value
    if (body !== undefined) return body
  }
  if (mediaType.example !== undefined) return mediaType.example
  const schema = mediaType.schema as OasSchema | undefined
  if (!schema) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  return generator.fold(schema)
}
