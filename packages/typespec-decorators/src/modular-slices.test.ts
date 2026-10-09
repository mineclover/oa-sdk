import type { DecoratorContext, Diagnostic, Model, Namespace, Program } from '@typespec/compiler'
import { getExtensions } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import {
  $actorInput,
  $behaviorRef,
  $eventPayload,
  $machineContext,
  BEHAVIOR_ACTOR_INPUT_EXTENSION,
  BEHAVIOR_EVENT_PAYLOAD_EXTENSION,
  BEHAVIOR_MACHINE_CONTEXT_EXTENSION,
  BEHAVIOR_REF_EXTENSION,
} from './behavior.js'
import {
  $storageCatalog,
  $storageRef,
  STORAGE_CATALOG_EXTENSION,
  STORAGE_REF_EXTENSION,
} from './storage.js'

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

describe('@oa-sdk/typespec-decorators modular slices', () => {
  it('correctly sets behavior extensions on models', () => {
    const program = createProgram()
    const context = { program } as unknown as DecoratorContext
    const model = {} as Model

    $actorInput(context, model)
    expect(getExtensions(program, model).get(BEHAVIOR_ACTOR_INPUT_EXTENSION)).toBe(true)

    $machineContext(context, model)
    expect(getExtensions(program, model).get(BEHAVIOR_MACHINE_CONTEXT_EXTENSION)).toBe(true)

    $eventPayload(context, model, 'SEEK')
    expect(getExtensions(program, model).get(BEHAVIOR_EVENT_PAYLOAD_EXTENSION)).toEqual({
      eventType: 'SEEK',
    })

    $behaviorRef(context, model, 'scene-player.v1')
    expect(getExtensions(program, model).get(BEHAVIOR_REF_EXTENSION)).toEqual({
      behaviorId: 'scene-player.v1',
    })
  })

  it('correctly sets storage extensions for Atlas catalog and column linkage', () => {
    const program = createProgram()
    const context = { program } as unknown as DecoratorContext
    const model = {} as Model
    const namespace = {} as Namespace

    $storageRef(context, model, 'users')
    expect(getExtensions(program, model).get(STORAGE_REF_EXTENSION)).toEqual({
      target: 'users',
    })

    $storageCatalog(context, namespace, 'sqlite')
    expect(getExtensions(program, namespace).get(STORAGE_CATALOG_EXTENSION)).toEqual({
      catalog: 'sqlite',
    })
  })
})
