import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { createRequire } from 'node:module'
import { generateCrdtHandlerContract, generateCrdtRouter } from '@oa-sdk/router'
import { generateCrdtClient, generateCrdtHooks } from '@oa-sdk/client'
import { ARTIFACT_KINDS } from '../config.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: SUBPROCESS_TEST_BUDGET_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err: any) {
    throw new Error(`tsc failed:\nSTDOUT:\n${err.stdout}\nSTDERR:\n${err.stderr}`)
  }
}

const tmpDir = resolve(__dirname, '../../.tmp-crdt-pipeline-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const collaborativeDocSpec = {
  openapi: '3.2.0',
  info: { title: 'Collaborative Workspace API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      DocumentWorkspace: {
        type: 'object',
        'x-oa-sdk-crdt-entity': {
          partitionKey: 'docId',
          compaction: 'checkpoint-squash',
          strategy: 'delta-sharded',
        },
        properties: {
          docId: { type: 'string' },
          title: {
            type: 'string',
            'x-oa-sdk-crdt': {
              type: 'lww-register',
              resolution: 'last-write-wins',
              role: 'value',
            },
          },
          body: {
            type: 'string',
            'x-oa-sdk-crdt': {
              type: 'text-sequence',
              engine: 'y-text',
              role: 'value',
            },
          },
          upvotes: {
            type: 'integer',
            'x-oa-sdk-crdt': {
              type: 'pn-counter',
              role: 'value',
            },
          },
        },
      },
    },
  },
}

describe('CRDT Codegen Pipeline Integration', () => {
  it('registers crdt artifact kinds in ARTIFACT_KINDS', () => {
    expect(ARTIFACT_KINDS).toContain('crdt-contract')
    expect(ARTIFACT_KINDS).toContain('crdt-router')
    expect(ARTIFACT_KINDS).toContain('crdt-client')
    expect(ARTIFACT_KINDS).toContain('crdt-hooks')
  })

  it('generates a complete 4-tier CRDT suite that compiles cleanly under tsc --strict', () => {
    // 1. Contract
    const contractCode = generateCrdtHandlerContract(collaborativeDocSpec as any, {
      banner: true,
      contractName: 'DocWorkspaceCrdtHandlers',
    })
    expect(contractCode).toContain('export interface DocumentWorkspaceCrdtHandler')
    expect(contractCode).toContain('export interface DocWorkspaceCrdtHandlers')

    // 2. Router (Hono)
    const routerCode = generateCrdtRouter(collaborativeDocSpec as any, {
      target: 'hono',
      contractImport: './doc.crdt.contract.js',
      contractName: 'DocWorkspaceCrdtHandlers',
      banner: true,
    })
    expect(routerCode).toContain('registerCrdtRoutes')
    expect(routerCode).toContain('/ws/document-workspace/:docId')

    // 3. Client SDK
    const clientCode = generateCrdtClient(collaborativeDocSpec as any, {
      banner: true,
    })
    expect(clientCode).toContain('createDocumentWorkspaceCrdtClient')
    expect(clientCode).toContain('export class CrdtRoomSession')

    // 4. React Hooks
    const hooksCode = generateCrdtHooks(collaborativeDocSpec as any, {
      clientImport: './doc.crdt.client.js',
      reactImport: './ambient-react.js',
      banner: true,
    })
    expect(hooksCode).toContain('useCrdtRoom')
    expect(hooksCode).toContain('useCrdtField')
    expect(hooksCode).toContain('useDocumentWorkspaceSession')

    // Ambient React mock for typecheck
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

    // Mock ambient Hono for typecheck
    const ambientHono = `
export interface Hono<E = any> {
  get(path: string, ...handlers: any[]): this
}
export function upgradeWebSocket(callback: (c: any) => any): any {
  return callback
}
`

    // Usage file integrating everything
    const usageCode = `
import type { DocWorkspaceCrdtHandlers, CrdtSessionContext } from './doc.crdt.contract.js'
import { registerCrdtRoutes } from './doc.crdt.router.js'
import { createDocumentWorkspaceCrdtClient } from './doc.crdt.client.js'
import { useDocumentWorkspaceSession, useCrdtField } from './doc.crdt.hooks.js'
import type { Hono } from 'hono'

// Server handlers
export const serverHandlers: DocWorkspaceCrdtHandlers = {
  documentWorkspace: {
    async onConnect(ctx: CrdtSessionContext) {
      return { allowed: true }
    },
    async loadSnapshot(roomId: string) {
      return new Uint8Array([10, 20, 30])
    },
    async saveSnapshot(roomId: string, snapshot: Uint8Array) {},
  },
}

export function setupServer(app: Hono) {
  registerCrdtRoutes(app, serverHandlers)
}

// Client usage
export const clientSession = createDocumentWorkspaceCrdtClient('doc-42', {
  wsUrl: 'wss://api.example.com/ws',
})

export function CollaborativeDocView() {
  const { isConnected, isSynced, data } = useDocumentWorkspaceSession(clientSession)
  const [title, setTitle] = useCrdtField(clientSession, 'title')
  return { isConnected, isSynced, title, setTitle, data }
}
`

    writeFileSync(resolve(tmpDir, 'doc.crdt.contract.ts'), contractCode, 'utf8')
    writeFileSync(resolve(tmpDir, 'doc.crdt.router.ts'), routerCode, 'utf8')
    writeFileSync(resolve(tmpDir, 'doc.crdt.client.ts'), clientCode, 'utf8')
    writeFileSync(resolve(tmpDir, 'doc.crdt.hooks.ts'), hooksCode, 'utf8')
    writeFileSync(resolve(tmpDir, 'ambient-react.ts'), ambientReact, 'utf8')
    writeFileSync(resolve(tmpDir, 'hono.ts'), ambientHono, 'utf8')
    mkdirSync(resolve(tmpDir, 'hono'), { recursive: true })
    writeFileSync(resolve(tmpDir, 'hono/ws.ts'), ambientHono, 'utf8')
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
          paths: {
            hono: ['./hono.ts'],
            'hono/ws': ['./hono/ws.ts'],
          },
        },
        include: ['./*.ts'],
      }),
      'utf8',
    )

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})
