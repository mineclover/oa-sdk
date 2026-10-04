import { describe, expect, it } from 'vitest'
import {
  WorkspaceSyncer,
  WorkspaceTreeLattice,
  createRemoteTransportCapability,
  type FileChunkCue,
} from '../src/index.js'

describe('@oa-sdk/collab-workspace — Real-Time Collaborative Workspace', () => {
  describe('1. Semi-Lattice Non-Destructive Merging', () => {
    it('merges non-overlapping human and AI edits commutatively (A ⊔ B === B ⊔ A)', () => {
      const latticeA = new WorkspaceTreeLattice()
      const latticeB = new WorkspaceTreeLattice()

      const humanCue: FileChunkCue = {
        id: 'src/App.tsx#L0',
        filePath: 'src/App.tsx',
        lineIndex: 0,
        content: '// Author: Human Developer',
        crdt: { clientId: 'client:human:dev1', updatedAt: 1000 },
      }

      const aiCue: FileChunkCue = {
        id: 'src/App.tsx#L1',
        filePath: 'src/App.tsx',
        lineIndex: 1,
        content: 'export function App() { return <div>AI Component</div> }',
        crdt: { clientId: 'client:ai:gemini', updatedAt: 1001 },
      }

      // Order 1: Human then AI
      latticeA.mergeChunk(humanCue)
      latticeA.mergeChunk(aiCue)

      // Order 2: AI then Human
      latticeB.mergeChunk(aiCue)
      latticeB.mergeChunk(humanCue)

      expect(latticeA.getFileContent('src/App.tsx')).toBe(
        '// Author: Human Developer\nexport function App() { return <div>AI Component</div> }',
      )
      expect(latticeB.getFileContent('src/App.tsx')).toBe(latticeA.getFileContent('src/App.tsx'))
    })

    it('resolves simultaneous same-line edits via total order comparator deterministically', () => {
      const lattice = new WorkspaceTreeLattice()

      const editOlder: FileChunkCue = {
        id: 'src/utils.ts#L0',
        filePath: 'src/utils.ts',
        lineIndex: 0,
        content: 'const x = 10;',
        crdt: { clientId: 'client:human:dev1', updatedAt: 1000 },
      }

      const editNewer: FileChunkCue = {
        id: 'src/utils.ts#L0',
        filePath: 'src/utils.ts',
        lineIndex: 0,
        content: 'const x = 20; // AI optimized',
        crdt: { clientId: 'client:ai:gemini', updatedAt: 2000 },
      }

      lattice.mergeChunk(editOlder)
      lattice.mergeChunk(editNewer)

      expect(lattice.getFileContent('src/utils.ts')).toBe('const x = 20; // AI optimized')
    })
  })

  describe('2. AI Co-Editor Actor & Intent-Lock Workflow', () => {
    it('manages intent locking and prevents overlapping concurrent edits', () => {
      const lattice = new WorkspaceTreeLattice()

      const syncer = new WorkspaceSyncer({
        rootPath: '/project',
        workspaceId: 'ws_1',
        clientId: 'client:human:dev1',
        role: 'human',
      })

      const ai1 = syncer.createAiEditor('claude', 'Claude 3.7')
      const ai2 = syncer.createAiEditor('gemini', 'Gemini 3.8')

      // AI1 acquires lock on lines 10..20
      const lock1 = ai1.acquireIntent('src/service.ts', { startLine: 10, endLine: 20 }, 'Writing database query')
      expect(lock1).not.toBeNull()
      expect(syncer.getActiveLocks()).toHaveLength(1)

      // AI2 attempts to acquire lock on overlapping lines 15..25 -> should be rejected
      const lock2 = ai2.acquireIntent('src/service.ts', { startLine: 15, endLine: 25 }, 'Writing logger')
      expect(lock2).toBeNull()

      // AI2 acquires lock on non-overlapping lines 30..40 -> should succeed
      const lock3 = ai2.acquireIntent('src/service.ts', { startLine: 30, endLine: 40 }, 'Writing logger')
      expect(lock3).not.toBeNull()
      expect(syncer.getActiveLocks()).toHaveLength(2)

      // AI1 streams edits and finishes
      ai1.streamLineEdit('src/service.ts', 10, 'export async function query() {}')
      ai1.completeIntent(lock1!.id)

      expect(syncer.getActiveLocks()).toHaveLength(1)
      expect(syncer.getActiveLocks()[0]!.clientId).toBe('client:ai:gemini')
    })

    it('streams micro-deltas into the shared workspace alongside human typing', () => {
      const syncer = new WorkspaceSyncer({
        rootPath: '/project',
        workspaceId: 'ws_1',
        clientId: 'client:human:alice',
        role: 'human',
      })

      // Human creates initial structure
      syncer.applyHumanEdit('src/card.tsx', 'import React from "react"\n\nexport const Card = () => null')

      // AI acquires intent lock on lines 2..4 to implement the Card body
      const ai = syncer.createAiEditor('copilot', 'AI Designer')
      const lock = ai.acquireIntent('src/card.tsx', { startLine: 2, endLine: 4 }, 'Render wireframe card body')
      expect(lock).not.toBeNull()

      // AI streams new lines
      ai.streamBlockEdit('src/card.tsx', 2, [
        'export const Card = () => {',
        '  return <div className="card-container"><h3>Wireframe Title</h3></div>',
        '}',
      ])
      ai.completeIntent(lock!.id)

      const merged = syncer.getFileContent('src/card.tsx')
      expect(merged).toBe(
        'import React from "react"\n\nexport const Card = () => {\n  return <div className="card-container"><h3>Wireframe Title</h3></div>\n}',
      )

      // Verify presences
      const presences = syncer.getPresences()
      expect(presences.some((p) => p.role === 'human')).toBe(true)
      expect(presences.some((p) => p.role === 'ai')).toBe(true)
    })
  })

  describe('3. Untrusted ingress and lock authorization', () => {
    it('rejects traversal, malformed CRDT coordinates, and unauthenticated remote chunks', () => {
      const lattice = new WorkspaceTreeLattice()
      expect(() => lattice.setFileContent('../secrets.txt', 'x', 'client:human:a')).toThrow()
      expect(() => lattice.mergeChunk({
        id: 'src/a.ts#L-1', filePath: 'src/a.ts', lineIndex: -1, content: 'x',
        crdt: { clientId: 'client:remote:a', updatedAt: 1 },
      })).toThrow()

      const syncer = new WorkspaceSyncer({
        rootPath: '/project', workspaceId: 'ws_1', clientId: 'client:human:a', role: 'human',
        allowedRemoteClientIds: ['client:remote:a'],
      })
      const cue: FileChunkCue = {
        id: 'src/a.ts#L0', filePath: 'src/a.ts', lineIndex: 0, content: 'x',
        crdt: { clientId: 'client:remote:a', updatedAt: Date.now() },
      }
      const capability = createRemoteTransportCapability()
      expect(() => syncer.ingestRemoteChunk(cue, { workspaceId: 'wrong', clientId: 'client:remote:a', capability })).toThrow()
      expect(syncer.ingestRemoteChunk(cue, { workspaceId: 'ws_1', clientId: 'client:remote:a', capability })).toBe(true)
    })

    it('requires an owned IntentLock before an AI can write', () => {
      const syncer = new WorkspaceSyncer({ rootPath: '/project', workspaceId: 'ws_1', clientId: 'client:human:a', role: 'human' })
      const ai = syncer.createAiEditor('agent')
      expect(() => ai.streamLineEdit('src/a.ts', 0, 'unsafe')).toThrow(/IntentLock/)
      const lock = ai.acquireIntent('src/a.ts', { startLine: 1, endLine: 1 }, 'safe')
      expect(lock).not.toBeNull()
      expect(() => ai.streamLineEdit('src/a.ts', 0, 'outside')).toThrow(/IntentLock/)
      expect(() => ai.streamLineEdit('src/a.ts', 1, 'safe')).not.toThrow()
    })

    it('uses a stable content tie-breaker for equal CRDT metadata', () => {
      const a = new WorkspaceTreeLattice()
      const b = new WorkspaceTreeLattice()
      const left: FileChunkCue = { id: 'src/a.ts#L0', filePath: 'src/a.ts', lineIndex: 0, content: 'a', crdt: { clientId: 'client:x', updatedAt: 1 } }
      const right: FileChunkCue = { ...left, content: 'z' }
      a.mergeChunk(left); a.mergeChunk(right)
      b.mergeChunk(right); b.mergeChunk(left)
      expect(a.getFileContent('src/a.ts')).toBe('z')
      expect(b.getFileContent('src/a.ts')).toBe('z')
    })

    it('rejects remote replays and bounds sparse rendering', () => {
      const syncer = new WorkspaceSyncer({
        rootPath: '/project', workspaceId: 'ws_1', clientId: 'client:human:a', role: 'human',
        limits: { maxRenderLines: 10 },
      })
      const cue: FileChunkCue = {
        id: 'src/a.ts#L0', filePath: 'src/a.ts', lineIndex: 0, content: 'x',
        crdt: { clientId: 'client:remote:a', updatedAt: Date.now(), seq: 1 },
      }
      const source = { workspaceId: 'ws_1', clientId: 'client:remote:a', capability: createRemoteTransportCapability() }
      expect(syncer.ingestRemoteChunk(cue, source)).toBe(true)
      expect(syncer.ingestRemoteChunk(cue, source)).toBe(false)

      const lattice = new WorkspaceTreeLattice({ maxRenderLines: 10 })
      lattice.mergeChunk({ ...cue, lineIndex: 10, id: 'src/a.ts#L10', crdt: { ...cue.crdt, seq: 2, updatedAt: Date.now() } })
      expect(() => lattice.getFileContent('src/a.ts')).toThrow(/sparse file render limit/)
    })

    it('requires monotonic lock renewals and enforces a bounded TTL', () => {
      const lattice = new WorkspaceTreeLattice()
      const now = Date.now()
      const lock: any = {
        id: 'lock_1', clientId: 'client:ai:a', role: 'ai', filePath: 'src/a.ts', range: { startLine: 0, endLine: 0 },
        intent: 'edit', status: 'active', createdAt: now, expiresAt: now + 1000, version: 0,
      }
      expect(lattice.setLock(lock)).toBe(true)
      expect(lattice.setLock({ ...lock })).toBe(false)
      expect(lattice.renewLock('lock_1', 'client:ai:a', 1000)?.version).toBe(1)
      expect(() => lattice.setLock({ ...lock, id: 'lock_2', expiresAt: now + 301_000 })).toThrow(/TTL/)
    })
  })
})
