import type { DecoratorContext, Diagnostic, Model, ModelProperty, Operation, Program } from '@typespec/compiler'
import { getExtensions, setExtension } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import {
  $crdt,
  $crdtEntity,
  $oaUseResponseComponent,
  $personaCapability,
  $pseudonymize,
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_PERSONA_TRAITS,
} from './decorators.js'

const componentRefsExtension = 'x-oa-sdk-operation-component-refs'
const personaTraitsExtension = 'x-oa-sdk-persona-traits'
const dpmProjectionExtension = 'x-oa-sdk-dpm-projection'
const crdtExtension = 'x-oa-sdk-crdt'
const crdtEntityExtension = 'x-oa-sdk-crdt-entity'

describe('$oaUseResponseComponent', () => {
  it('emits and merges only response-component references by status code', () => {
    const program = createProgram()
    const operation = {} as Operation
    const context = { program } as unknown as DecoratorContext

    setExtension(program, operation, componentRefsExtension, {
      parameters: [{ name: 'limit', ref: '#/components/parameters/Limit' }],
    })
    $oaUseResponseComponent(context, operation, '400', 'BadRequest')
    $oaUseResponseComponent(context, operation, '422', 'UnprocessableEntity')
    $oaUseResponseComponent(context, operation, '400', 'OtherBadRequest')

    expect(getExtensions(program, operation).get(componentRefsExtension)).toEqual({
      parameters: [{ name: 'limit', ref: '#/components/parameters/Limit' }],
      responses: [
        { statusCode: '400', ref: '#/components/responses/BadRequest' },
        { statusCode: '422', ref: '#/components/responses/UnprocessableEntity' },
      ],
    })
  })
})

describe('$personaCapability', () => {
  it('validates and emits single and multiple traits sorted and deduplicated', () => {
    const program = createProgram()
    const operation = {} as Operation
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $personaCapability(context, operation, 'pagination', 'filter-by-role')
    $personaCapability(context, operation, 'batch', 'pagination')

    expect(getExtensions(program, operation).get(personaTraitsExtension)).toEqual([
      'batch',
      'filter-by-role',
      'pagination',
    ])
  })

  it('rejects unknown persona capability trait and emits diagnostic', () => {
    const program = createProgram()
    const operation = {} as Operation
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $personaCapability(context, operation, 'invalid-skill-trait')

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-persona-trait')
    expect(getExtensions(program, operation).get(personaTraitsExtension)).toBeUndefined()
  })

  it('accepts all 24 canonical capability traits from skill.yaml', () => {
    expect(VALID_PERSONA_TRAITS.size).toBe(24)
    for (const trait of VALID_PERSONA_TRAITS) {
      const program = createProgram()
      const operation = {} as Operation
      const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext
      $personaCapability(context, operation, trait)
      expect(program.diagnostics).toHaveLength(0)
      expect(getExtensions(program, operation).get(personaTraitsExtension)).toEqual([trait])
    }
  })
})

describe('$pseudonymize', () => {
  it('emits valid dpm projection with role, pii, and relationship', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'mask', 'direct_identifier', true)

    expect(getExtensions(program, property).get(dpmProjectionExtension)).toEqual({
      transform: 'mask',
      role: 'direct_identifier',
      pii: true,
    })
  })

  it('emits relationship_token with foreign_identifier and relationship', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'relationship_token', 'foreign_identifier', true, 'rel_order_customer')

    expect(getExtensions(program, property).get(dpmProjectionExtension)).toEqual({
      transform: 'relationship_token',
      role: 'foreign_identifier',
      pii: true,
      relationship: 'rel_order_customer',
    })
  })

  it('rejects invalid transform', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'magic_anonymize')

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-pseudonymize-rule')
    expect(getExtensions(program, property).get(dpmProjectionExtension)).toBeUndefined()
  })

  it('rejects invalid role', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'mask', 'not_a_valid_role')

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-pseudonymize-rule')
  })

  it('enforces SAF001: direct_identifier cannot use keep transform', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'keep', 'direct_identifier')

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-pseudonymize-rule')
    expect(program.diagnostics[0]?.message).toContain('SAF001')
    expect(getExtensions(program, property).get(dpmProjectionExtension)).toBeUndefined()
  })

  it('enforces SAF002: pii foreign_identifier requires relationship reference', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'hash', 'foreign_identifier', true)

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-pseudonymize-rule')
    expect(program.diagnostics[0]?.message).toContain('SAF002')
    expect(getExtensions(program, property).get(dpmProjectionExtension)).toBeUndefined()
  })

  it('enforces SAF010: pii field cannot use keep transform', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $pseudonymize(context, property, 'keep', 'business_identifier', true)

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-pseudonymize-rule')
    expect(program.diagnostics[0]?.message).toContain('SAF010')
    expect(getExtensions(program, property).get(dpmProjectionExtension)).toBeUndefined()
  })
})

describe('$crdt', () => {
  it('emits valid x-oa-sdk-crdt extension payload for LWW register', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdt(context, property, {
      type: 'lww-register',
      resolution: 'last-write-wins',
      role: 'value',
    })

    expect(program.diagnostics).toHaveLength(0)
    expect(getExtensions(program, property).get(crdtExtension)).toEqual({
      type: 'lww-register',
      resolution: 'last-write-wins',
      role: 'value',
    })
  })

  it('emits valid x-oa-sdk-crdt extension payload for text sequence with engine', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdt(context, property, {
      type: 'text-sequence',
      engine: 'fugue',
    })

    expect(program.diagnostics).toHaveLength(0)
    expect(getExtensions(program, property).get(crdtExtension)).toEqual({
      type: 'text-sequence',
      engine: 'fugue',
    })
  })

  it('reports diagnostic on invalid CRDT type', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdt(context, property, {
      type: 'invalid-crdt',
    })

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-crdt-rule')
    expect(program.diagnostics[0]?.message).toContain('Invalid CRDT type "invalid-crdt"')
    expect(getExtensions(program, property).get(crdtExtension)).toBeUndefined()
  })

  it('reports diagnostic on invalid resolution', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdt(context, property, {
      type: 'lww-register',
      resolution: 'invalid-resolution',
    })

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-crdt-rule')
    expect(program.diagnostics[0]?.message).toContain('Invalid CRDT resolution')
    expect(getExtensions(program, property).get(crdtExtension)).toBeUndefined()
  })

  it('reports diagnostic on invalid engine', () => {
    const program = createProgram()
    const property = {} as ModelProperty
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdt(context, property, {
      type: 'text-sequence',
      engine: 'unknown-engine',
    })

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-crdt-rule')
    expect(program.diagnostics[0]?.message).toContain('Invalid CRDT engine')
    expect(getExtensions(program, property).get(crdtExtension)).toBeUndefined()
  })
})

describe('$crdtEntity', () => {
  it('emits valid x-oa-sdk-crdt-entity extension payload', () => {
    const program = createProgram()
    const model = {} as Model
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdtEntity(context, model, {
      partitionKey: 'trackId',
      timeRange: { from: 'fromFrame', to: 'toFrame' },
      compaction: 'checkpoint-squash',
      strategy: 'delta-sharded',
    })

    expect(program.diagnostics).toHaveLength(0)
    expect(getExtensions(program, model).get(crdtEntityExtension)).toEqual({
      partitionKey: 'trackId',
      timeRange: { from: 'fromFrame', to: 'toFrame' },
      compaction: 'checkpoint-squash',
      strategy: 'delta-sharded',
    })
  })

  it('reports diagnostic on invalid compaction', () => {
    const program = createProgram()
    const model = {} as Model
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext

    $crdtEntity(context, model, {
      partitionKey: 'trackId',
      compaction: 'invalid-compaction',
    })

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toContain('invalid-crdt-entity-rule')
    expect(program.diagnostics[0]?.message).toContain('Invalid CRDT compaction')
    expect(getExtensions(program, model).get(crdtEntityExtension)).toBeUndefined()
  })
})

interface MockProgram extends Program {
  diagnostics: Diagnostic[]
}

function createProgram(): MockProgram {
  const stateMaps = new Map<symbol, Map<unknown, unknown>>()
  const diagnostics: Diagnostic[] = []
  return {
    diagnostics,
    stateMap(key: symbol) {
      let map = stateMaps.get(key)
      if (!map) {
        map = new Map()
        stateMaps.set(key, map)
      }
      return map
    },
    reportDiagnostic(diagnostic: Diagnostic) {
      diagnostics.push(diagnostic)
    },
  } as unknown as MockProgram
}
