/**
 * @oa-sdk/mcp-mesh — CLI Integration & Invariant Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMeshCli } from '../src/cli/index.js'
import { SkillRegistry } from '../src/skill-registry.js'
import { MeshRouter } from '../src/mesh-router.js'
import { defineTool } from '@oa-sdk/tools'

describe('oa-mesh CLI Suite', () => {
  let logOutput: string[] = []
  let errorOutput: string[] = []
  const originalLog = console.log
  const originalError = console.error

  beforeEach(() => {
    logOutput = []
    errorOutput = []
    console.log = (...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '))
    }
    console.error = (...args: unknown[]) => {
      errorOutput.push(args.map(String).join(' '))
    }
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
  })

  it('initializes with expected command structure', () => {
    const cli = createMeshCli()
    expect(cli.name()).toBe('oa-mesh')
    const commandNames = cli.commands.map((c) => c.name())
    expect(commandNames).toContain('peer')
    expect(commandNames).toContain('skill')
    expect(commandNames).toContain('collab')
    expect(commandNames).toContain('call')
    expect(commandNames).toContain('mesh')
    expect(cli.options.some((option) => option.long === '--auth-token')).toBe(true)
  })

  it('skill list displays 1:N Domain Skill invariant in JSON format', async () => {
    const registry = new SkillRegistry()
    const router = new MeshRouter(registry)

    // Register canonical Domain Skill
    registry.registerDomainSkill({
      domain: 'wireframe',
      name: 'Wireframe Studio',
      version: '1.0.0',
      description: 'Unified wireframe toolset',
      tools: [
        defineTool({
          name: 'screen_create',
          description: 'Create a wireframe screen',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
          execute: async () => ({ ok: true }),
        }),
      ],
    })

    // Bind 2 sessions to the SAME wireframe domain
    registry.bindSession({
      sessionId: 'sess-1',
      domain: 'wireframe',
      alias: 'wireframe-local',
      transportType: 'bridge-http',
      status: 'active',
      callTool: async () => ({ created: true }),
    })
    registry.bindSession({
      sessionId: 'sess-2',
      domain: 'wireframe',
      alias: 'wireframe-tab-2',
      transportType: 'p2p-webrtc',
      status: 'idle',
      callTool: async () => ({ created: true }),
    })

    const cli = createMeshCli({ registry, router })
    await cli.parseAsync(['node', 'oa-mesh', '-o', 'json', 'skill', 'list'])

    const output = logOutput.join('\n')
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1) // Only 1 DomainSkill!
    expect(parsed[0].domain).toBe('wireframe')
    expect(parsed[0].toolsCount).toBe(1)
    expect(parsed[0].sessions.length).toBe(2) // 2 bound session instances!
    expect(parsed[0].sessions[0].alias).toBe('wireframe-local')
    expect(parsed[0].sessions[0].isActive).toBe(true)
    expect(parsed[0].sessions[1].alias).toBe('wireframe-tab-2')
    expect(parsed[0].sessions[1].isActive).toBe(false)
  })

  it('skill inspect outputs domain schema and instructions', async () => {
    const registry = new SkillRegistry()
    registry.registerDomainSkill({
      domain: 'database',
      name: 'Database Operations',
      version: '2.0.0',
      description: 'Database query domain',
      instructions: 'Always use parameterized SQL queries.',
      tools: [
        defineTool({
          name: 'query_run',
          description: 'Run SQL query',
          inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
          execute: async () => ({ rows: [] }),
        }),
      ],
    })

    const cli = createMeshCli({ registry })
    await cli.parseAsync(['node', 'oa-mesh', '-o', 'json', 'skill', 'inspect', 'database'])

    const output = logOutput.join('\n')
    const parsed = JSON.parse(output)
    expect(parsed.domain).toBe('database')
    expect(parsed.instructions).toBe('Always use parameterized SQL queries.')
    expect(parsed.tools.length).toBe(1)
    expect(parsed.tools[0].name).toBe('query_run')
  })

  it('call command dispatches tool through router with key=val args', async () => {
    const registry = new SkillRegistry()
    const router = new MeshRouter(registry)

    const callMock = vi.fn().mockResolvedValue({ id: 'page-101', title: 'Home' })

    registry.registerDomainSkill({
      domain: 'wireframe',
      name: 'Wireframe',
      version: '1.0.0',
      description: 'Wireframe',
      tools: [
        defineTool({
          name: 'page_add',
          description: 'Add page',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
          execute: async (_ctx, input) => callMock(input),
        }),
      ],
    })

    registry.bindSession({
      sessionId: 's-1',
      domain: 'wireframe',
      alias: 'wireframe-local',
      transportType: 'bridge-http',
      status: 'active',
      callTool: callMock,
    })

    const cli = createMeshCli({ registry, router })
    await cli.parseAsync(['node', 'oa-mesh', '-o', 'json', 'call', 'wireframe__page_add', 'title=Home'])

    expect(callMock).toHaveBeenCalledWith('page_add', { title: 'Home' })
    const output = logOutput.join('\n')
    const parsed = JSON.parse(output)
    expect(parsed.id).toBe('page-101')
  })

  it('call command accepts a JSON object argument and reports malformed JSON and routing errors', async () => {
    const registry = new SkillRegistry()
    const router = new MeshRouter(registry)
    const callMock = vi.fn().mockResolvedValue({ ok: true })
    registry.registerDomainSkill({
      domain: 'wireframe',
      name: 'Wireframe',
      version: '1.0.0',
      description: 'Wireframe',
      tools: [
        defineTool({
          name: 'page_add',
          description: 'Add page',
          inputSchema: { type: 'object', properties: { title: { type: 'string' }, order: { type: 'number' } } },
          execute: async (_ctx, input) => callMock(input),
        }),
      ],
    })
    registry.bindSession({
      sessionId: 's-1',
      domain: 'wireframe',
      alias: 'wireframe-local',
      transportType: 'bridge-http',
      status: 'active',
      callTool: callMock,
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      await createMeshCli({ registry, router }).parseAsync(['node', 'oa-mesh', '-o', 'json', 'call', 'wireframe__page_add', '{"title":"Home","order":2}'])
      expect(callMock).toHaveBeenCalledWith('page_add', { title: 'Home', order: 2 })

      await createMeshCli({ registry, router }).parseAsync(['node', 'oa-mesh', 'call', 'wireframe__page_add', '{"title":}'])
      expect(errorOutput).toContain('Tool execution failed: Invalid JSON arguments: {"title":}')

      await createMeshCli({ registry, router }).parseAsync(['node', 'oa-mesh', 'call', 'missing__tool'])
      expect(errorOutput.at(-1)).toBe('Tool execution failed: Cannot route tool "missing__tool": no active session found for its domain')
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      exit.mockRestore()
    }
  })

  it('mesh status and meta check verify readiness across domains', async () => {
    const registry = new SkillRegistry()
    const router = new MeshRouter(registry)

    // Register 1 of 2 required domains
    registry.registerDomainSkill({
      domain: 'wireframe',
      name: 'Wireframe',
      version: '1.0.0',
      description: 'Wireframe',
      tools: [],
    })
    registry.bindSession({
      sessionId: 's-1',
      domain: 'wireframe',
      alias: 'wireframe-local',
      transportType: 'bridge-http',
      status: 'active',
      callTool: async () => ({}),
    })

    // Register Meta-Skill requiring wireframe AND git
    router.registerMetaSkill({
      name: 'wireframe_to_pr',
      version: '1.0.0',
      description: 'Convert wireframe to PR',
      requiresDomains: ['wireframe', 'git'],
      instructions: 'Export wireframe and open git pull request',
    })

    const cli = createMeshCli({ registry, router })
    await cli.parseAsync(['node', 'oa-mesh', '-o', 'json', 'mesh', 'meta', 'check', 'wireframe_to_pr'])

    const output = logOutput.join('\n')
    const readiness = JSON.parse(output)
    expect(readiness.ready).toBe(false)
    expect(readiness.missingDomains).toContain('git')
  })

  it('collab status reports active lattice and presence state', async () => {
    const cli = createMeshCli()
    await cli.parseAsync(['node', 'oa-mesh', '-o', 'json', 'collab', 'status'])

    const output = logOutput.join('\n')
    const parsed = JSON.parse(output)
    expect(parsed.collabEngine).toBe('@oa-sdk/collab-workspace')
    expect(parsed.semiLatticeJoin).toBe('active')
  })
})
