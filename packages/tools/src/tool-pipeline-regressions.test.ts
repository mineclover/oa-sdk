import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createToolContext } from './context.js'
import { runCliAnythingArgv } from './cli-anything.js'
import { hydrateToolsFromOpenApi } from './openapi-hydrator.js'
import { registerToolsOnMcpUse } from './mcp-use.js'
import { FileSessionStore, type AnyPipelineToolHandler, type ElicitationContext } from './reserved-interfaces.js'
import { toStandardSchemaWithJson } from './standard-schema.js'

const directories: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-tool-regression-'))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function bundle(handler: AnyPipelineToolHandler, metadata: Record<string, unknown> = {}, stateDir = tempDir()) {
  return hydrateToolsFromOpenApi({
    openapi: '3.2.0',
    info: { title: 'Regression', version: '1' },
    paths: {
      '/change': { post: {
        operationId: 'change',
        'x-oa-sdk-tool': { stage: 'apply', cliGroup: 'project', cliCommand: 'change', ...metadata },
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { projectId: { type: 'string' } },
        } } } },
        responses: { '200': { description: 'OK' } },
      } },
    },
  }, { change: handler }, { stateDir })
}

describe('destructive confirmation', () => {
  it.each(['two-phase', 'single-phase'])('blocks %s MCP mutation when the host cannot elicit', async (kind) => {
    let mutations = 0
    const commit = async () => ({ count: ++mutations })
    const hydrated = bundle(kind === 'two-phase' ? { plan: async () => ({}), commit } : commit, { destructive: true })
    const surface = registerToolsOnMcpUse({ tool: () => undefined }, hydrated, { includeReservedTools: false })
    const result = await surface.invokeTool('project_change', { projectId: 'p' }, {})
    expect(result.isError).toBe(true)
    expect(mutations).toBe(0)
    expect(hydrated.sessionStore.readSession('p').undoStack).toHaveLength(0)
  })

  it.each([
    { action: 'decline' as const },
    { action: 'cancel' as const },
    { action: 'accept' as const },
    { action: 'accept' as const, data: { confirm: false } },
    { action: 'accept' as const, data: { confirm: 'true' } },
  ])('requires an affirmative boolean response: %j', async (response) => {
    let mutations = 0
    const hydrated = bundle({ plan: async () => ({}), commit: async () => ++mutations }, { destructive: true })
    const ctx: ElicitationContext = { ...createToolContext(), elicit: async () => response }
    expect((await hydrated.tools[0]!.execute(ctx, { projectId: 'p' })).passed).toBe(false)
    expect(mutations).toBe(0)
  })

  it('allows dry-run without confirmation and commits after explicit confirmation or accepted elicitation', async () => {
    let mutations = 0
    const hydrated = bundle({ plan: async () => ({ preview: true }), commit: async () => ++mutations }, { destructive: true })
    const tool = hydrated.tools[0]!
    await tool.execute(createToolContext(), { projectId: 'p', dryRun: true })
    expect(mutations).toBe(0)
    await tool.execute(createToolContext(), { projectId: 'p', confirm: true })
    const accepted: ElicitationContext = {
      ...createToolContext(), elicit: async () => ({ action: 'accept', data: { confirm: true } }),
    }
    await tool.execute(accepted, { projectId: 'p' })
    expect(mutations).toBe(2)
  })

  it('exposes --confirm on the CLI and rejects an unconfirmed invocation', async () => {
    let mutations = 0
    const hydrated = bundle({ plan: async () => ({}), commit: async () => ({ count: ++mutations }) }, { destructive: true })
    const denied = await runCliAnythingArgv(hydrated, ['project', 'change', '--project-id', 'p', '--json'])
    expect(denied.exitCode).toBe(1)
    expect(mutations).toBe(0)
    const accepted = await runCliAnythingArgv(hydrated, ['project', 'change', '--project-id', 'p', '--confirm', '--json'])
    expect(accepted.exitCode).toBe(0)
    expect(mutations).toBe(1)
  })
})

describe('commit serialization', () => {
  it.each(['two-phase', 'single-phase'])('serializes %s commits and snapshots across independent stores', async (kind) => {
    let counter = 0
    let active = 0
    let maxActive = 0
    const stateDir = tempDir()
    const commit = async () => {
      const before = counter
      maxActive = Math.max(maxActive, ++active)
      await new Promise(resolve => setTimeout(resolve, 30))
      counter = before + 1
      active--
      return { counter }
    }
    const handler = kind === 'two-phase'
      ? { plan: async () => ({}), commit, captureState: async () => ({ counter }) }
      : commit
    const first = bundle(handler, {}, stateDir)
    const second = bundle(handler, {}, stateDir)
    await Promise.all([first, second].map(b => b.tools[0]!.execute(createToolContext(), { projectId: 'same' })))
    expect(maxActive).toBe(1)
    expect(counter).toBe(2)
    const session = first.sessionStore.readSession('same')
    expect(session.undoStack.map(s => s.afterState)).toEqual([{ counter: 1 }, { counter: 2 }])
    expect(session.undoStack[1]!.beforeState).toEqual({ counter: 1 })
    expect((await first.sessionStore.undo('same')).session.currentState).toEqual({ counter: 1 })
    expect((await second.sessionStore.redo('same')).session.currentState).toEqual({ counter: 2 })
  })

  it('releases the lock after a failed commit without creating a snapshot', async () => {
    let fail = true
    const hydrated = bundle({
      plan: async () => ({}),
      commit: async () => { if (fail) throw new Error('commit failed'); return { done: true } },
    })
    await expect(hydrated.tools[0]!.execute(createToolContext(), { projectId: 'p' })).rejects.toThrow('commit failed')
    expect(hydrated.sessionStore.readSession('p').undoStack).toHaveLength(0)
    fail = false
    await hydrated.tools[0]!.execute(createToolContext(), { projectId: 'p' })
    expect(hydrated.sessionStore.readSession('p').undoStack).toHaveLength(1)
  })

  it('keeps exclusive locking when snapshots are disabled', async () => {
    let counter = 0
    const hydrated = bundle({ plan: async () => ({}), commit: async () => {
      const before = counter
      await new Promise(resolve => setTimeout(resolve, 30))
      return { counter: counter = before + 1 }
    } }, { undoSnapshot: false })
    await Promise.all([1, 2].map(() => hydrated.tools[0]!.execute(createToolContext(), { projectId: 'p' })))
    expect(counter).toBe(2)
    expect(hydrated.sessionStore.readSession('p').undoStack).toHaveLength(0)
  })
})

describe('domain session restore', () => {
  function restorableBundle(stateDir: string, state: { value: number }, options?: { failRestore?: boolean }) {
    let restoreCalls = 0
    const hydrated = bundle(
      {
        plan: async () => ({ value: state.value + 1 }),
        captureState: async () => ({ value: state.value }),
        commit: async () => {
          state.value += 1
          return { value: state.value }
        },
        restoreState: async (_ctx, _projectId, target) => {
          restoreCalls += 1
          if (options?.failRestore) throw new Error('domain restore failed')
          state.value = Number(target.value)
        },
      },
      {},
      stateDir,
    )
    return { hydrated, getRestoreCalls: () => restoreCalls }
  }

  it('restores the domain through the MCP session undo/redo surface', async () => {
    const state = { value: 0 }
    const { hydrated, getRestoreCalls } = restorableBundle(tempDir(), state)
    const surface = registerToolsOnMcpUse({ tool: () => undefined }, hydrated)

    await surface.invokeTool('project_change', { projectId: 'p' })
    expect(state.value).toBe(1)
    const undone = await surface.invokeTool('session_undo', { projectId: 'p' })
    expect(undone.isError).toBeUndefined()
    expect(undone.structuredContent.undone).toBe(true)
    expect(state.value).toBe(0)
    const redone = await surface.invokeTool('session_redo', { projectId: 'p' })
    expect(redone.isError).toBeUndefined()
    expect(redone.structuredContent.redone).toBe(true)
    expect(state.value).toBe(1)
    expect(getRestoreCalls()).toBe(2)
  })

  it('restores the domain through the CLI session undo surface', async () => {
    const state = { value: 0 }
    const { hydrated, getRestoreCalls } = restorableBundle(tempDir(), state)
    const applied = await runCliAnythingArgv(hydrated, ['project', 'change', '--project-id', 'p', '--json'])
    expect(applied.exitCode).toBe(0)
    expect(state.value).toBe(1)
    const undone = await runCliAnythingArgv(hydrated, ['session', 'undo', 'p', '--json'])
    expect(undone.exitCode).toBe(0)
    expect(state.value).toBe(0)
    expect(getRestoreCalls()).toBe(1)
  })

  it('keeps the history entry when domain restoration fails', async () => {
    const state = { value: 0 }
    const { hydrated } = restorableBundle(tempDir(), state, { failRestore: true })
    const surface = registerToolsOnMcpUse({ tool: () => undefined }, hydrated)
    await surface.invokeTool('project_change', { projectId: 'p' })
    const result = await surface.invokeTool('session_undo', { projectId: 'p' })
    expect(result.isError).toBe(true)
    expect(hydrated.sessionStore.readSession('p').undoStack).toHaveLength(1)
    expect(hydrated.sessionStore.readSession('p').redoStack).toHaveLength(0)
    expect(state.value).toBe(1)
  })
})

describe('Standard Schema parser semantics', () => {
  it('preserves Zod refinement failures through every validation entry point', async () => {
    const schema = toStandardSchemaWithJson(z.string().refine(value => value === 'allowed'))
    expect(schema.safeParse('denied').success).toBe(false)
    expect(schema.validate('denied')).toBe(false)
    expect(() => schema.parse('denied')).toThrow()
    expect((await schema['~standard'].validate('denied')).issues).toBeDefined()
    expect(schema.parse('allowed')).toBe('allowed')
    expect(schema['~standard'].jsonSchema.input()).toMatchObject({ type: 'string' })
  })

  it('returns transformed values from Zod and custom parsers', async () => {
    const schema = toStandardSchemaWithJson(z.string().trim())
    expect(schema.safeParse(' value ')).toEqual({ success: true, data: 'value' })
    expect(schema.parse(' value ')).toBe('value')
    expect(await schema['~standard'].validate(' value ')).toEqual({ value: 'value' })
    const custom = toStandardSchemaWithJson({ type: 'string', parse: (v: unknown) => {
      if (typeof v !== 'string') throw new Error('expected a string')
      return v.toUpperCase()
    } })
    expect(custom.parse('abc')).toBe('ABC')
    expect(custom.safeParse(42).success).toBe(false)
  })

  it('applies an optional guard to the parsed output without bypassing the schema', () => {
    const schema = toStandardSchemaWithJson(z.string().trim(), undefined, (value): value is string => value === 'ok')
    expect(schema.parse(' ok ')).toBe('ok')
    expect(schema.safeParse('bad').success).toBe(false)
    const guarded = toStandardSchemaWithJson({ type: 'string', minLength: 3 }, undefined, (v): v is string => typeof v === 'string')
    expect(guarded.safeParse('a').success).toBe(false)
  })

  it('still validates JSON component references', () => {
    const schema = toStandardSchemaWithJson({ $ref: '#/components/schemas/Name' }, { Name: { type: 'string', minLength: 2 } })
    expect(schema.safeParse('a').success).toBe(false)
    expect(schema.parse('ab')).toBe('ab')
  })
})

describe('project session isolation', () => {
  const change = (owner: string) => ({ operationId: 'change', summary: owner, afterState: { owner } })

  it('isolates formerly colliding IDs, unicode IDs and their undo histories', async () => {
    const store = new FileSessionStore(tempDir())
    const ids = ['team/a', 'team_a', 'team:a', '팀/a', '\ud800', '\ud801']
    for (const id of ids) await store.recordMutation(id, change(id))
    for (const id of ids) expect(store.readSession(id).currentState).toEqual({ owner: id })
    await store.undo(ids[0]!)
    expect(store.readSession(ids[0]!).currentState).toEqual({})
    expect(store.readSession(ids[1]!).undoStack).toHaveLength(1)
    await store.redo(ids[0]!)
    expect(store.readSession(ids[0]!).currentState).toEqual({ owner: ids[0] })
  })

  it.each(['.', '..', '', '   '])('rejects invalid ID %j before creating session files', async (id) => {
    const root = tempDir()
    const store = new FileSessionStore(root)
    expect(() => store.readSession(id)).toThrow(/project/i)
    await expect(store.recordMutation(id, change('bad'))).rejects.toThrow(/project/i)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('reads matching legacy sessions, migrates on mutation and rejects legacy identity mismatches', async () => {
    const root = tempDir()
    const dir = path.join(root, '.cli-anything/sessions/team_a')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
      schemaVersion: 'cli-anything-session/v1', projectId: 'team/a', updatedAt: new Date().toISOString(),
      currentState: { owner: 'legacy' }, undoStack: [], redoStack: [],
    }))
    const store = new FileSessionStore(root)
    expect(store.readSession('team/a').currentState).toEqual({ owner: 'legacy' })
    expect(() => store.readSession('team_a')).toThrow(/project/i)
    await store.recordMutation('team/a', change('new'))
    expect((await store.undo('team/a')).session.currentState).toEqual({ owner: 'legacy' })
    expect((await store.redo('team/a')).session.currentState).toEqual({ owner: 'new' })
    fs.rmSync(dir, { recursive: true })
    expect(store.readSession('team/a').currentState).toEqual({ owner: 'new' })
  })

  it('rejects a stored identity mismatch before committing domain changes', async () => {
    const root = tempDir()
    const store = new FileSessionStore(root)
    await store.recordMutation('p', change('p'))
    const sessionsDir = path.join(root, '.cli-anything/sessions')
    const dir = fs.readdirSync(sessionsDir)[0]!
    const file = path.join(sessionsDir, dir, 'session.json')
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...record, projectId: 'someone-else' }))
    let commits = 0
    const hydrated = bundle({ plan: async () => ({}), commit: async () => ++commits }, {}, root)
    await expect(hydrated.tools[0]!.execute(createToolContext(), { projectId: 'p' })).rejects.toThrow(/project ID mismatch/)
    expect(commits).toBe(0)
    expect(fs.existsSync(path.join(sessionsDir, dir, 'session.lock'))).toBe(false)
  })
})
