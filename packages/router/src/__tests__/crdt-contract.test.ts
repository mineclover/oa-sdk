import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { OasDocument } from '@oa-sdk/parser'
import {
  generateCrdtHandlerContract,
  generateCrdtRouter,
  extractCrdtEntities,
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

const tmpDir = resolve(__dirname, '../../.tmp-crdt-router-test')

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

describe('CRDT Handler Contract & Router Generation', () => {
  it('extracts CRDT entity and field metadata accurately', () => {
    const entities = extractCrdtEntities(sampleCrdtSpec)
    expect(entities).toHaveLength(1)
    const entity = entities[0]
    expect(entity).toBeDefined()
    if (!entity) return
    expect(entity.name).toBe('TimelineCue')
    expect(entity.partitionKey).toBe('trackId')
    expect(entity.compaction).toBe('checkpoint-squash')
    expect(entity.fields['text']?.type).toBe('lww-register')
    expect(entity.fields['deleted']?.type).toBe('flag')
  })

  it('generates pure TypeScript CRDT handler contracts', () => {
    const contractSource = generateCrdtHandlerContract(sampleCrdtSpec, {
      contractName: 'WorkspaceCrdtHandlers',
    })

    expect(contractSource).toContain('export interface TimelineCueCrdtHandler<TAuth = unknown>')
    expect(contractSource).toContain('loadSnapshot?(roomId: string, ctx: CrdtSessionContext<TAuth>): Promise<Uint8Array | null>')
    expect(contractSource).toContain('saveSnapshot?(roomId: string, snapshot: Uint8Array, ctx: CrdtSessionContext<TAuth>): Promise<void>')
    expect(contractSource).toContain('appendUpdates?(roomId: string, updates: Uint8Array[], ctx: CrdtSessionContext<TAuth>): Promise<void>')
    expect(contractSource).toContain('onAwareness?(roomId: string, peerId: string, presence: unknown, ctx: CrdtSessionContext<TAuth>): void')
    expect(contractSource).toContain('export interface WorkspaceCrdtHandlers<TAuth = unknown>')
    expect(contractSource).toContain('timelineCue?: TimelineCueCrdtHandler<TAuth> | undefined')
  })

  it('generates framework WebSocket routers for Hono, Fastify, Elysia, and Express', () => {
    const honoRouter = generateCrdtRouter(sampleCrdtSpec, {
      target: 'hono',
      contractImport: './crdt.contract.js',
    })
    expect(honoRouter).toContain('registerCrdtRoutes')
    expect(honoRouter).toContain('upgradeWebSocket')
    expect(honoRouter).toContain('/ws/timeline-cue/:trackId')

    const fastifyRouter = generateCrdtRouter(sampleCrdtSpec, {
      target: 'fastify',
      contractImport: './crdt.contract.js',
    })
    expect(fastifyRouter).toContain('crdtRouterPlugin')
    expect(fastifyRouter).toContain('websocket: true')

    const elysiaRouter = generateCrdtRouter(sampleCrdtSpec, {
      target: 'elysia',
      contractImport: './crdt.contract.js',
    })
    expect(elysiaRouter).toContain('.ws(')

    const expressRouter = generateCrdtRouter(sampleCrdtSpec, {
      target: 'express',
      contractImport: './crdt.contract.js',
    })
    expect(expressRouter).toContain('wss.on(\'connection\'')
  })

  it('compiles CRDT contracts and concrete handlers cleanly under tsc --strict', () => {
    const contractSource = generateCrdtHandlerContract(sampleCrdtSpec, {
      contractName: 'WorkspaceCrdtHandlers',
    })

    const concreteHandlerSource = `
import type {
  WorkspaceCrdtHandlers,
  TimelineCueCrdtHandler,
  CrdtSessionContext,
} from './crdt.contract.js'

export const handlers: WorkspaceCrdtHandlers = {
  timelineCue: {
    async onConnect(ctx: CrdtSessionContext) {
      return { allowed: true, auth: { userId: ctx.peerId } }
    },
    async loadSnapshot(roomId: string) {
      return new Uint8Array([1, 2, 3])
    },
    async saveSnapshot(roomId: string, snapshot: Uint8Array) {
      // persist to db
    },
    async appendUpdates(roomId: string, updates: Uint8Array[]) {
      // append log
    },
    onAwareness(roomId: string, peerId: string, presence: unknown) {
      // ephemeral
    },
    async onDisconnect(roomId: string, peerId: string) {
      // cleanup
    },
  },
}
`

    writeFileSync(resolve(tmpDir, 'crdt.contract.ts'), contractSource, 'utf8')
    writeFileSync(resolve(tmpDir, 'handlers.ts'), concreteHandlerSource, 'utf8')
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
        include: ['./crdt.contract.ts', './handlers.ts'],
      }),
      'utf8',
    )

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})
