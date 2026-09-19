import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateStandaloneGuards } from '../src/guards/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

describe('Polymorphic Dispatch in Split Mode (split: true)', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-ast-sync-split-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('generates relative imports and polymorphic dispatch tables in individual split files', async () => {
    const schemaDoc = {
      $id: 'urn:test:split-events',
      $defs: {
        EmailPayload: {
          type: 'object',
          required: ['type', 'to'],
          properties: {
            type: { const: 'email' },
            to: { type: 'string' },
          },
        },
        SmsPayload: {
          type: 'object',
          required: ['type', 'phone'],
          properties: {
            type: { const: 'sms' },
            phone: { type: 'string' },
          },
        },
        EventNotification: {
          oneOf: [
            { $ref: '#/$defs/EmailPayload' },
            { $ref: '#/$defs/SmsPayload' },
          ],
          discriminator: {
            propertyName: 'type',
            mapping: {
              email: '#/$defs/EmailPayload',
              sms: '#/$defs/SmsPayload',
            },
          },
        },
      },
    }

    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      split: true,
      tiered: true,
      polymorphicDispatch: true,
      generateDeclarations: true,
    })

    // Should create guards directory with individual files and root index
    const eventFile = artifacts.find(a => a.filePath.endsWith('EventNotification.js'))
    const emailFile = artifacts.find(a => a.filePath.endsWith('EmailPayload.js'))
    const smsFile = artifacts.find(a => a.filePath.endsWith('SmsPayload.js'))
    const rootIndex = artifacts.find(a => a.filePath.endsWith(path.join(tmpDir, 'index.js')))

    expect(eventFile).toBeDefined()
    expect(emailFile).toBeDefined()
    expect(smsFile).toBeDefined()
    expect(rootIndex).toBeDefined()

    // EventNotification.js should import branch guards and have __dispatch table
    const eventJs = eventFile!.content
    expect(eventJs).toContain("import { isEmailPayload } from './EmailPayload.js';")
    expect(eventJs).toContain("import { isSmsPayload } from './SmsPayload.js';")
    expect(eventJs).toContain('const __dispatch_isEventNotification = {')
    expect(eventJs).toContain('"email": isEmailPayload')
    expect(eventJs).toContain('"sms": isSmsPayload')
    expect(eventJs).toContain('const branch = __dispatch_isEventNotification[data["type"]];')

    // Root index should re-export everything
    expect(rootIndex!.content).toContain("export * from './guards/EventNotification.js';")
    expect(rootIndex!.content).toContain("export * from './guards/EmailPayload.js';")
    expect(rootIndex!.content).toContain("export * from './guards/SmsPayload.js';")

    // Dynamically test imported root index
    const indexUrl = new URL(`file://${rootIndex!.filePath}`).href
    const mod = await import(indexUrl)

    expect(typeof mod.isEventNotification).toBe('function')
    expect(typeof mod.isEmailPayload).toBe('function')
    expect(typeof mod.isSmsPayload).toBe('function')

    // Runtime validation through polymorphic dispatch
    expect(mod.isEventNotification({ type: 'email', to: 'test@example.com' })).toBe(true)
    expect(mod.isEventNotification({ type: 'sms', phone: '010-1234-5678' })).toBe(true)
    expect(mod.isEventNotification({ type: 'email', to: 123 })).toBe(false)
    expect(mod.isEventNotification({ type: 'unknown' })).toBe(false)
    expect(mod.isEventNotification(null)).toBe(false)
  })
})
