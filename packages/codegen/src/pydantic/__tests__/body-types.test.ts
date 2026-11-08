import { describe, expect, it } from 'vitest'
import { buildPydanticModels } from '../index.js'

describe('P2e body media types', () => {
  it('renders form, binary, text and streaming aliases', () => {
    const result = buildPydanticModels({
      openapi: '3.2.0', info: { title: 'body-types', version: '1' },
      paths: { '/upload': { post: {
        operationId: 'upload',
        requestBody: { required: true, content: {
          'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, files: { type: 'array', items: { type: 'string', contentMediaType: 'application/octet-stream' } }, image: { type: 'string', contentMediaType: 'image/png' } } } },
          'text/plain': { schema: { type: 'string' } },
        } },
        responses: { '200': { description: 'events', content: { 'text/event-stream': { itemSchema: { type: 'object', required: ['kind'], properties: { kind: { const: 'ok' } } } }, 'application/jsonl': { schema: { type: 'array', items: { type: 'string' } } } } } },
      } }, '/stream': { post: {
        operationId: 'upStream', requestBody: { content: { 'application/x-ndjson': { itemSchema: { type: 'integer' } } } },
        responses: { '200': { description: 'stream', content: { 'application/x-ndjson': { itemSchema: { type: 'integer' } }, 'text/event-stream': { itemSchema: { type: 'string' } } } } },
      } }, '/raw': { post: {
        operationId: 'raw', requestBody: { content: { 'text/plain': {} } },
        responses: { '200': { description: 'bytes', content: { 'application/octet-stream': {} } } },
      } } },
    })
    const source = result.files.find(file => file.path.endsWith('operations.py'))?.content ?? ''
    expect(source).toContain('class UploadBody(BaseModel):')
    expect(source).toContain('file: bytes')
    expect(source).toContain('files: list[bytes]')
    expect(source).toContain('image: bytes')
    expect(source).toContain('UploadResponseJsonlItem')
    expect(source).toContain('streams={"200:application/jsonl": True, "200:text/event-stream": True}')
    expect(source).toContain('"UpStream": OperationSpec')
    expect(source).toContain('"body:application/x-ndjson": True')
    expect(source).toContain('UpStreamBodyItem')
    expect(source).toContain('UpStreamResponseXNdjsonItem')
    expect(source).toContain('RawBody: TypeAlias = str')
    expect(source).toContain('RawResponse: TypeAlias = bytes')
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'pydantic/media-type-unsupported')).toBe(false)
  })

  it('recognizes discriminated envelope variants', () => {
    const result = buildPydanticModels({
      openapi: '3.2.0', info: { title: 'envelope', version: '1' },
      components: { schemas: { Envelope: { oneOf: [
        { type: 'object', required: ['kind', 'value'], properties: { kind: { const: 'a' }, value: { type: 'string' } } },
        { type: 'object', required: ['kind', 'value'], properties: { kind: { const: 'b' }, value: { type: 'integer' } } },
      ], discriminator: { propertyName: 'kind' } } } },
    })
    expect(result.source).toContain('Field(discriminator="kind")')
    expect(result.source).toContain('Literal["a"]')
    expect(result.source).toContain('Literal["b"]')
  })
})
