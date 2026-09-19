import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateStandaloneGuards } from '../standalone-guards/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

describe('@oa-sdk/codegen Polymorphic Dispatch and Tiered Guard Pipeline', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-poly-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('projects schema with discriminator into O(1) dispatch table through codegen pipeline', async () => {
    const schemaDoc = {
      $id: 'urn:oa-sdk:chunk-stream:pipeline',
      $defs: {
        ActionPayload: {
          type: 'object',
          required: ['payloadFormat', 'action'],
          properties: {
            payloadFormat: { const: 'ui-action@v1' },
            action: { type: 'string' },
          },
        },
        TimeSeriesPayload: {
          type: 'object',
          required: ['payloadFormat', 'points'],
          properties: {
            payloadFormat: { const: 'time-series@v1' },
            points: { type: 'array', items: { type: 'number' } },
          },
        },
        StreamItem: {
          discriminator: {
            propertyName: 'payloadFormat',
          },
          oneOf: [
            { $ref: '#/$defs/ActionPayload' },
            { $ref: '#/$defs/TimeSeriesPayload' },
          ],
        },
      },
    }

    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      polymorphicDispatch: true,
      tiered: true,
    })

    const guardsJs = artifacts.find(a => a.filePath.endsWith('guards.js'))
    expect(guardsJs).toBeDefined()
    const content = guardsJs!.content

    expect(content).toContain('const __dispatch_isStreamItem = {')
    expect(content).toContain('"ui-action@v1": isActionPayload')
    expect(content).toContain('"time-series@v1": isTimeSeriesPayload')
    expect(content).toContain('__dispatch_isStreamItem[data["payloadFormat"]]')

    // Runtime import verification
    const mod = await import(new URL(`file://${guardsJs!.filePath}`).href)
    expect(mod.isStreamItem({ payloadFormat: 'ui-action@v1', action: 'click' })).toBe(true)
    expect(mod.isStreamItem({ payloadFormat: 'time-series@v1', points: [1, 2, 3] })).toBe(true)
    expect(mod.isStreamItem({ payloadFormat: 'unknown@v1', action: 'none' })).toBe(false)
  })
})
