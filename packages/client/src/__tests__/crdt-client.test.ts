import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import {
  LwwJsonAdapter,
  generateCrdtClient,
  generateCrdtHooks,
  extractCrdtEntitiesFromDoc,
} from '../index.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const tmpDir = resolve(__dirname, '../../.tmp-crdt-client-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const sampleCrdtSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Collaborative Workspace API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      TimelineCue: {
        type: 'object',
        'x-oa-sdk-crdt-entity': {
          partitionKey: 'trackId',
          compaction: 'checkpoint-squash',
          strategy: 'delta-sharded',
        },
        properties: {
          id: { type: 'string' },
          trackId: { type: 'string' },
          text: {
            type: 'string',
            'x-oa-sdk-crdt': {
              type: 'lww-register',
              resolution: 'last-write-wins',
              role: 'value',
            },
          },
          deleted: {
            type: 'boolean',
            'x-oa-sdk-crdt': {
              type: 'flag',
              role: 'tombstone',
            },
          },
        },
      },
    },
  },
} as unknown as OasDocument

describe('CRDT Client SDK & React Hooks Generation', () => {
  describe('LwwJsonAdapter', () => {
    it('applies local field mutations and computes state vectors', () => {
      const adapter = new LwwJsonAdapter<{ title: string; count: number }>('actor-1')
      adapter.createDoc()

      adapter.updateField('title', 'Initial Title')
      adapter.updateField('count', 42)

      const state = adapter.getState()
      expect(state.title).toBe('Initial Title')
      expect(state.count).toBe(42)

      const vectorJson = adapter.encodeStateVector()
      const vector = JSON.parse(vectorJson as string)
      expect(typeof vector.title).toBe('number')
      expect(typeof vector.count).toBe('number')
    })

    it('resolves concurrent updates deterministically via LWW timestamp and actorId', () => {
      const nodeA = new LwwJsonAdapter<{ content: string }>('actor-a')
      const nodeB = new LwwJsonAdapter<{ content: string }>('actor-b')

      nodeA.createDoc()
      nodeB.createDoc()

      const updateA = nodeA.updateField('content', 'Written by A')
      const updateB = nodeB.updateField('content', 'Written by B')

      // Cross-apply updates
      nodeA.applyUpdate(updateB)
      nodeB.applyUpdate(updateA)

      // Both must converge to the exact same state
      expect(nodeA.getState().content).toBe(nodeB.getState().content)
    })

    it('computes diffs accurately based on peer state vector', () => {
      const nodeA = new LwwJsonAdapter<{ f1: string; f2: string }>('actor-a')
      nodeA.createDoc()
      nodeA.updateField('f1', 'hello')
      nodeA.updateField('f2', 'world')

      // Peer with empty vector receives both fields
      const diff1 = JSON.parse(nodeA.encodeDiff('{}') as string)
      expect(diff1.f1.value).toBe('hello')
      expect(diff1.f2.value).toBe('world')

      // Peer with current vector receives no fields
      const currentVector = nodeA.encodeStateVector()
      const diff2 = JSON.parse(nodeA.encodeDiff(currentVector) as string)
      expect(Object.keys(diff2)).toHaveLength(0)
    })
  })

  describe('generateCrdtClient', () => {
    it('generates typed CrdtRoomSession and entity client factories', () => {
      const clientSource = generateCrdtClient(sampleCrdtSpec)

      expect(clientSource).toContain('export class CrdtRoomSession')
      expect(clientSource).toContain('createTimelineCueCrdtClient')
      expect(clientSource).toContain('DefaultLwwJsonAdapter')
      expect(clientSource).toContain('connect(): void')
      expect(clientSource).toContain('disconnect(): void')
      expect(clientSource).toContain('updateField(field: string, value: unknown): void')
    })
  })

  describe('generateCrdtHooks', () => {
    it('generates React hooks useCrdtRoom, useCrdtField, useCrdtAwareness', () => {
      const hooksSource = generateCrdtHooks(sampleCrdtSpec, {
        clientImport: './crdt.client.js',
      })

      expect(hooksSource).toContain('useCrdtRoom')
      expect(hooksSource).toContain('useCrdtField')
      expect(hooksSource).toContain('useCrdtAwareness')
      expect(hooksSource).toContain('useTimelineCueSession')
    })
  })

  describe('Strict TypeScript Compilation', () => {
    it('compiles generated client and hooks under tsc --strict with ambient React and WebSocket', () => {
      const clientSource = generateCrdtClient(sampleCrdtSpec)
      const hooksSource = generateCrdtHooks(sampleCrdtSpec, {
        clientImport: './crdt.client.js',
        reactImport: './ambient-react.js',
      })

      const ambientReact = `
export function useState<T>(init: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] {
  const val = typeof init === 'function' ? (init as () => T)() : init
  return [val, () => {}]
}
export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void {}
export function useCallback<T extends Function>(fn: T, deps?: unknown[]): T {
  return fn
}
`

      const usageCode = `
import { createTimelineCueCrdtClient, type CrdtClientConfig } from './crdt.client.js'
import { useCrdtRoom, useCrdtField, useTimelineCueSession } from './crdt.hooks.js'

const config: CrdtClientConfig = {
  wsUrl: 'wss://example.com/ws',
}

export const session = createTimelineCueCrdtClient('track-101', config)

export function Component() {
  const { isConnected, isSynced, data } = useTimelineCueSession(session)
  const [text, setText] = useCrdtField(session, 'text')
  return { isConnected, isSynced, text, setText, data }
}
`

      writeFileSync(resolve(tmpDir, 'crdt.client.ts'), clientSource, 'utf8')
      writeFileSync(resolve(tmpDir, 'crdt.hooks.ts'), hooksSource, 'utf8')
      writeFileSync(resolve(tmpDir, 'ambient-react.ts'), ambientReact, 'utf8')
      writeFileSync(resolve(tmpDir, 'usage.ts'), usageCode, 'utf8')
      writeFileSync(
        resolve(tmpDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ['./*.ts'],
        }),
        'utf8',
      )

      expect(() => runTsc(tmpDir)).not.toThrow()
    }, 25_000)
  })
})
