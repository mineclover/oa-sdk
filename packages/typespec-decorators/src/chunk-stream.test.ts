import { Numeric, type DecoratorContext, type Diagnostic, type Operation, type Program } from '@typespec/compiler'
import { getExtensions } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import {
  $chunkStream,
  CHUNK_STREAM_EXTENSION,
  VALID_CHUNK_MEMORY_PRESETS,
  VALID_CHUNK_STREAM_MODES,
  VALID_CHUNK_STREAM_PRESETS,
} from './chunk-stream.js'

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

function applyChunkStream(options: Record<string, unknown> | undefined) {
  const program = createProgram()
  const operation = {} as Operation
  const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext
  $chunkStream(context, operation, options)
  return {
    diagnostics: program.diagnostics,
    extension: getExtensions(program, operation).get(CHUNK_STREAM_EXTENSION),
  }
}

const MiB = 1024 * 1024

describe('$chunkStream resolved config parity with defineChunkStreamConfig', () => {
  it('derives maxL1MemoryBytes as half of the resident budget by default', () => {
    const { diagnostics, extension } = applyChunkStream({})

    expect(diagnostics).toHaveLength(0)
    expect(extension).toEqual({
      schemaVersion: 1,
      preset: 'optimal-web',
      targetChunkBytes: 7168,
      memoryPreset: 'standard',
      maxResidentBytes: 128 * MiB,
      maxL1MemoryBytes: 64 * MiB,
      payloadFormat: 'ui-action@v1',
      fps: 30,
      chunkFrames: 30,
      mode: 'adaptive',
      lookaheadFrames: 60,
      retentionFrames: 30,
    })
    // Key order follows ResolvedChunkStreamConfig.
    expect(Object.keys(extension as object)).toEqual([
      'schemaVersion',
      'preset',
      'targetChunkBytes',
      'memoryPreset',
      'maxResidentBytes',
      'maxL1MemoryBytes',
      'payloadFormat',
      'fps',
      'chunkFrames',
      'mode',
      'lookaheadFrames',
      'retentionFrames',
    ])
  })

  it('honours explicit byte overrides instead of the preset table', () => {
    const { diagnostics, extension } = applyChunkStream({
      preset: 'heavy-media',
      memoryPreset: 'highperf',
      fps: 60,
      targetChunkBytes: 4096,
      maxResidentBytes: MiB,
    })

    expect(diagnostics).toHaveLength(0)
    expect(extension).toMatchObject({
      preset: 'heavy-media',
      memoryPreset: 'highperf',
      targetChunkBytes: 4096,
      maxResidentBytes: MiB,
      maxL1MemoryBytes: MiB / 2,
      fps: 60,
      chunkFrames: 60,
      lookaheadFrames: 120,
      retentionFrames: 60,
    })

    const explicitL1 = applyChunkStream({ memoryPreset: 'mobile', maxL1MemoryBytes: 8 * MiB })
    expect(explicitL1.diagnostics).toHaveLength(0)
    expect(explicitL1.extension).toMatchObject({ maxResidentBytes: 64 * MiB, maxL1MemoryBytes: 8 * MiB })
  })

  it('reads TypeSpec Numeric values for every numeric option', () => {
    const { diagnostics, extension } = applyChunkStream({
      targetChunkBytes: Numeric('2048'),
      maxResidentBytes: Numeric('4194304'),
      fps: Numeric('24'),
      chunkFrames: Numeric('12'),
      lookaheadFrames: Numeric('48'),
      retentionFrames: Numeric('0'),
    })

    expect(diagnostics).toHaveLength(0)
    expect(extension).toMatchObject({
      targetChunkBytes: 2048,
      maxResidentBytes: 4 * MiB,
      maxL1MemoryBytes: 2 * MiB,
      fps: 24,
      chunkFrames: 12,
      lookaheadFrames: 48,
      retentionFrames: 0,
    })
  })

  it.each([
    ['targetChunkBytes', 0, 'targetChunkBytes must be a positive integer (received: 0).'],
    ['targetChunkBytes', 1.5, 'targetChunkBytes must be a positive integer (received: 1.5).'],
    ['maxResidentBytes', -1, 'maxResidentBytes must be a positive integer (received: -1).'],
    ['maxL1MemoryBytes', '1024', 'maxL1MemoryBytes must be a positive integer (received: "1024").'],
    ['fps', null, 'fps must be a positive integer (received: null).'],
    ['fps', 0, 'fps must be a positive integer (received: 0).'],
    ['chunkFrames', 2.5, 'chunkFrames must be a positive integer (received: 2.5).'],
    ['lookaheadFrames', -5, 'lookaheadFrames must be a positive integer (received: -5).'],
    ['lookaheadFrames', 0, 'lookaheadFrames must be a positive integer (received: 0).'],
    ['retentionFrames', 2.7, 'retentionFrames must be a non-negative integer (received: 2.7).'],
    ['retentionFrames', -1, 'retentionFrames must be a non-negative integer (received: -1).'],
    ['targetChunkBytes', Numeric('1e400'), `targetChunkBytes must be a positive integer (received: ${Numeric('1e400').toString()}).`],
    ['maxResidentBytes', Numeric('9007199254740993'), 'maxResidentBytes must be a positive integer (received: 9007199254740993).'],
  ])('reports %s = %s and emits no extension', (key, value, message) => {
    const { diagnostics, extension } = applyChunkStream({ [key]: value })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-chunk-stream-rule')
    expect(diagnostics[0]?.message).toBe(message)
    expect(extension).toBeUndefined()
  })

  it('accepts every documented string option value', () => {
    const { diagnostics, extension } = applyChunkStream({
      preset: 'bulk-data',
      memoryPreset: 'mobile',
      mode: 'eager',
      payloadFormat: 'storyboard@v2',
    })

    expect(diagnostics).toHaveLength(0)
    expect(extension).toMatchObject({
      preset: 'bulk-data',
      targetChunkBytes: 1048576,
      memoryPreset: 'mobile',
      maxResidentBytes: 64 * MiB,
      mode: 'eager',
      payloadFormat: 'storyboard@v2',
    })
  })

  const presets = [...VALID_CHUNK_STREAM_PRESETS].join(', ')
  const memoryPresets = [...VALID_CHUNK_MEMORY_PRESETS].join(', ')
  const modes = [...VALID_CHUNK_STREAM_MODES].join(', ')

  it.each([
    ['preset', 5, `preset must be one of: ${presets} (received: 5).`],
    ['preset', 'realtime-crdt', `Unknown chunk stream preset "realtime-crdt". Expected one of: ${presets}.`],
    ['memoryPreset', null, `memoryPreset must be one of: ${memoryPresets} (received: null).`],
    ['memoryPreset', 'huge', `Unknown chunk memory preset "huge". Expected one of: ${memoryPresets}.`],
    ['mode', true, `mode must be one of: ${modes} (received: true).`],
    ['mode', 'lazy', `Unknown chunk stream mode "lazy". Expected one of: ${modes}.`],
    ['payloadFormat', 5, 'payloadFormat must be a string (received: 5).'],
    ['payloadFormat', null, 'payloadFormat must be a string (received: null).'],
    ['payloadFormat', Object.create(null), 'payloadFormat must be a string (received: [object Object]).'],
  ])('reports %s = %s instead of falling back to the default', (key, value, message) => {
    const { diagnostics, extension } = applyChunkStream({ [key]: value })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-chunk-stream-rule')
    expect(diagnostics[0]?.message).toBe(message)
    expect(extension).toBeUndefined()
  })

  it('uses every default when the options argument is omitted', () => {
    const omitted = applyChunkStream(undefined)
    expect(omitted.diagnostics).toHaveLength(0)
    expect(omitted.extension).toEqual(applyChunkStream({}).extension)
  })

  it.each([
    ['a string', 'optimal-web', '@chunkStream options must be an object (received: "optimal-web").'],
    ['null', null, '@chunkStream options must be an object (received: null).'],
    ['an array', [1, 2], '@chunkStream options must be an object (received: 1,2).'],
  ])('reports an options argument that is %s', (_label, value, message) => {
    const program = createProgram()
    const operation = {} as Operation
    const context = { program, getArgumentTarget: () => undefined } as unknown as DecoratorContext
    // TypeSpec passes `valueof unknown` through unchanged, so a non-object reaches the decorator at runtime.
    Reflect.apply($chunkStream, undefined, [context, operation, value])

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.code).toBe('@oa-sdk/typespec-decorators/invalid-chunk-stream-rule')
    expect(program.diagnostics[0]?.message).toBe(message)
    expect(getExtensions(program, operation).get(CHUNK_STREAM_EXTENSION)).toBeUndefined()
  })
})
