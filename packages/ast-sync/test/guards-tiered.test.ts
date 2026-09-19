import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateStandaloneGuards } from '../src/guards/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

describe('Tiered Validation & Polymorphic Dispatch in Standalone Guards', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-ast-sync-tiered-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('generates Tier 1 Fast-Path validation predicates when tiered: true', async () => {
    const schemaDoc = {
      $id: 'urn:test:chunk-envelope',
      $defs: {
        ChunkHeader: {
          type: 'object',
          required: ['seq', 'chunkSize', 'format'],
          properties: {
            seq: { type: 'integer', minimum: 0 },
            chunkSize: { type: 'integer', minimum: 1 },
            format: { const: 'ui-action@v1' },
          },
        },
      },
    }

    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      tiered: true,
      generateDeclarations: true,
    })

    const guardsJs = artifacts.find(a => a.filePath.endsWith('guards.js'))
    const guardsDts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))
    expect(guardsJs).toBeDefined()
    expect(guardsDts).toBeDefined()

    const js = guardsJs!.content
    const dts = guardsDts!.content

    // Expect fast-path function and Fast export
    expect(js).toContain('function __fastValidate_isChunkHeader(data)')
    expect(js).toContain('export function isChunkHeaderFast(data)')
    expect(js).toContain('if (!__fastValidate_isChunkHeader(data)) return false')
    expect(dts).toContain('export declare function isChunkHeaderFast(data: unknown): boolean;')
    expect(dts).toContain('export declare function isChunkHeader(data: unknown): data is ChunkHeader;')

    // Dynamically import generated guard and execute runtime tests
    const moduleUrl = new URL(`file://${guardsJs!.filePath}`).href
    const mod = await import(moduleUrl)

    // Valid object
    const valid = { seq: 0, chunkSize: 1024, format: 'ui-action@v1' }
    expect(mod.isChunkHeaderFast(valid)).toBe(true)
    expect(mod.isChunkHeader(valid)).toBe(true)

    // Missing required field
    const missingSeq = { chunkSize: 1024, format: 'ui-action@v1' }
    expect(mod.isChunkHeaderFast(missingSeq)).toBe(false)
    expect(mod.isChunkHeader(missingSeq)).toBe(false)

    // Non-integer seq
    const invalidSeq = { seq: -5, chunkSize: 1024, format: 'ui-action@v1' }
    expect(mod.isChunkHeaderFast(invalidSeq)).toBe(false)
    expect(mod.isChunkHeader(invalidSeq)).toBe(false)

    // Wrong const
    const wrongFormat = { seq: 1, chunkSize: 1024, format: 'other' }
    expect(mod.isChunkHeaderFast(wrongFormat)).toBe(false)
    expect(mod.isChunkHeader(wrongFormat)).toBe(false)

    // Non-object
    expect(mod.isChunkHeaderFast(null)).toBe(false)
    expect(mod.isChunkHeaderFast('string')).toBe(false)
    expect(mod.isChunkHeaderFast([1, 2])).toBe(false)
  })

  it('generates O(1) polymorphic dispatch table for discriminated union schemas', async () => {
    const schemaDoc = {
      $id: 'urn:test:polymorphic-stream',
      $defs: {
        UiAction: {
          type: 'object',
          required: ['payloadFormat', 'actionId'],
          properties: {
            payloadFormat: { const: 'ui-action@v1' },
            actionId: { type: 'string' },
          },
        },
        TimeSeries: {
          type: 'object',
          required: ['payloadFormat', 'values'],
          properties: {
            payloadFormat: { const: 'time-series@v1' },
            values: { type: 'array', items: { type: 'number' } },
          },
        },
        PayloadEvent: {
          discriminator: {
            propertyName: 'payloadFormat',
            mapping: {
              'ui-action@v1': '#/$defs/UiAction',
              'time-series@v1': '#/$defs/TimeSeries',
            },
          },
          oneOf: [
            { $ref: '#/$defs/UiAction' },
            { $ref: '#/$defs/TimeSeries' },
          ],
        },
      },
    }

    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      polymorphicDispatch: true,
      generateDeclarations: true,
    })

    const guardsJs = artifacts.find(a => a.filePath.endsWith('guards.js'))
    expect(guardsJs).toBeDefined()
    const js = guardsJs!.content

    // Expect dispatch table definition
    expect(js).toContain('const __dispatch_isPayloadEvent = {')
    expect(js).toContain('"ui-action@v1": isUiAction')
    expect(js).toContain('"time-series@v1": isTimeSeries')
    expect(js).toContain('__dispatch_isPayloadEvent[data["payloadFormat"]]')

    // Dynamically test dispatch behavior
    const moduleUrl = new URL(`file://${guardsJs!.filePath}`).href
    const mod = await import(moduleUrl)

    const uiEvent = { payloadFormat: 'ui-action@v1', actionId: 'click_btn' }
    const timeEvent = { payloadFormat: 'time-series@v1', values: [1.2, 3.4] }
    const unknownEvent = { payloadFormat: 'unknown@v1', data: 123 }

    expect(mod.isPayloadEvent(uiEvent)).toBe(true)
    expect(mod.isPayloadEvent(timeEvent)).toBe(true)
    expect(mod.isPayloadEvent(unknownEvent)).toBe(false)
  })
})
