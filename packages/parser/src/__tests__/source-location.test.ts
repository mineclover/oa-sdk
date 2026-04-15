import { describe, expect, it } from 'vitest'
import { createSourceLocationIndex, createYamlSourceLocationIndex } from '../source-location.js'

describe('source location index', () => {
  it('maps YAML JSON Pointers to root fields, nested schema keys, and array items', () => {
    const index = createYamlSourceLocationIndex([
      'openapi: 3.2.0',
      'info:',
      '  title: Location API',
      '  version: 1.0.0',
      'tags:',
      '  - name: users',
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        id:',
      '          type: string',
      '',
    ].join('\n'), { filePath: 'api.yaml' })

    expect(index.lookup('#/openapi')).toMatchObject({
      filePath: 'api.yaml',
      pointer: '#/openapi',
      line: 1,
      column: 1,
    })
    expect(index.lookup('/components/schemas/User/properties/id/type')).toMatchObject({
      pointer: '#/components/schemas/User/properties/id/type',
      line: 13,
      column: 11,
    })
    expect(index.lookup('#/tags/0')).toMatchObject({
      pointer: '#/tags/0',
      line: 6,
      column: 5,
    })
  })

  it('leaves JSON documents without YAML-only source metadata', () => {
    const index = createSourceLocationIndex('{"openapi":"3.2.0"}', {
      filePath: 'api.json',
      syntax: 'auto',
    })

    expect(index.entries()).toEqual([])
    expect(index.lookup('#/openapi')).toBeUndefined()
  })
})
