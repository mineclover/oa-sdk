import type { DecoratorContext, Operation, Program } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import { $oaUseResponseComponent } from './decorators.js'

const extensionName = 'x-oa-sdk-operation-component-refs'

describe('$oaUseResponseComponent', () => {
  it('emits and merges only response-component references by status code', () => {
    const program = createProgram()
    const operation = {} as Operation
    const context = { program } as DecoratorContext

    setExtension(program, operation, extensionName, {
      parameters: [{ name: 'limit', ref: '#/components/parameters/Limit' }],
    })
    $oaUseResponseComponent(context, operation, '400', 'BadRequest')
    $oaUseResponseComponent(context, operation, '422', 'UnprocessableEntity')
    $oaUseResponseComponent(context, operation, '400', 'OtherBadRequest')

    expect(getExtensions(program, operation).get(extensionName)).toEqual({
      parameters: [{ name: 'limit', ref: '#/components/parameters/Limit' }],
      responses: [
        { statusCode: '400', ref: '#/components/responses/BadRequest' },
        { statusCode: '422', ref: '#/components/responses/UnprocessableEntity' },
      ],
    })
  })
})

function createProgram(): Program {
  const stateMaps = new Map<symbol, Map<unknown, unknown>>()
  return {
    stateMap(key: symbol) {
      let map = stateMaps.get(key)
      if (!map) {
        map = new Map()
        stateMaps.set(key, map)
      }
      return map
    },
  } as unknown as Program
}
