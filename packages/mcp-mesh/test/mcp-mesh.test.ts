import { describe, expect, it } from 'vitest'
import {
  MeshRouter,
  SkillRegistry,
  type DomainSkillDefinition,
  type McpSessionInstance,
} from '../src/index.js'
import { defineTool } from '@oa-sdk/tools'
import { z } from 'zod'

describe('@oa-sdk/mcp-mesh — Multi-MCP Hub & Domain Skill Invariant', () => {
  describe('1. 1:N Domain Skill vs Session Instance Mapping (Wireframe Pattern)', () => {
    it('maintains 1 canonical DomainSkill when multiple sessions connect for the same domain', () => {
      const registry = new SkillRegistry()

      // Peer 1: wireframe-local (Tab 1)
      const peer1 = {
        alias: 'wireframe-local',
        id: 'session_tab_1',
        title: 'Framebook Wireframe Studio',
        cachedTools: [
          { name: 'storyboard_page_create', description: 'Create page' },
          { name: 'storyboard_screen_read', description: 'Read screen' },
        ],
      }

      // Hydrate Peer 1
      const { skill: skill1, session: session1 } = registry.hydratePeerSession(peer1)
      expect(skill1.domain).toBe('wireframe')
      expect(registry.listDomainSkills()).toHaveLength(1)
      expect(registry.getSessionsForDomain('wireframe')).toHaveLength(1)

      // Peer 2: wireframe-session-2 (Tab 2)
      const peer2 = {
        alias: 'wireframe-session-2',
        id: 'session_tab_2',
        title: 'Framebook Wireframe Studio 2',
        cachedTools: [
          { name: 'storyboard_page_create', description: 'Create page' },
          { name: 'storyboard_layers_group', description: 'Group layers' },
        ],
      }

      // Hydrate Peer 2
      const { skill: skill2, session: session2 } = registry.hydratePeerSession(peer2)

      // CRITICAL INVARIANT: Domain skill count MUST remain 1!
      expect(registry.listDomainSkills()).toHaveLength(1)
      expect(skill2.domain).toBe('wireframe')
      expect(skill1).toBe(skill2)

      // Both sessions bound to 'wireframe'
      const sessions = registry.getSessionsForDomain('wireframe')
      expect(sessions).toHaveLength(2)
      expect(sessions.map((s) => s.sessionId)).toContain('session_tab_1')
      expect(sessions.map((s) => s.sessionId)).toContain('session_tab_2')

      // Tools merged cleanly without duplicates (page_create, screen_read, layers_group)
      expect(skill1.tools.map((t) => t.name)).toEqual([
        'storyboard_page_create',
        'storyboard_screen_read',
        'storyboard_layers_group',
      ])
    })

    it('routes tool calls dynamically to the active session instance', async () => {
      const registry = new SkillRegistry()
      const calls: Array<{ session: string; tool: string; args: any }> = []

      const sessionA: McpSessionInstance = {
        sessionId: 'session_A',
        domain: 'wireframe',
        alias: 'wireframe-local',
        transportType: 'p2p-webrtc',
        status: 'active',
        callTool: async (tool, args) => {
          calls.push({ session: 'session_A', tool, args })
          return { handledBy: 'session_A' }
        },
      }

      const sessionB: McpSessionInstance = {
        sessionId: 'session_B',
        domain: 'wireframe',
        alias: 'wireframe-tab-2',
        transportType: 'p2p-webrtc',
        status: 'active',
        callTool: async (tool, args) => {
          calls.push({ session: 'session_B', tool, args })
          return { handledBy: 'session_B' }
        },
      }

      const wireframeSkill: DomainSkillDefinition = {
        domain: 'wireframe',
        name: 'Wireframe Domain',
        version: '1.0.0',
        description: 'Wireframe operations',
        tools: [
          defineTool({
            name: 'storyboard_page_create',
            description: 'Create page',
            inputSchema: z.object({ title: z.string() }),
            execute: async () => ({}),
          }),
        ],
      }

      registry.registerDomainSkill(wireframeSkill)
      registry.bindSession(sessionA)
      registry.bindSession(sessionB)

      const router = new MeshRouter(registry)

      // Initially, active session is sessionA
      expect(registry.getActiveSession('wireframe')?.sessionId).toBe('session_A')
      const res1 = await router.dispatchTool('wireframe__storyboard_page_create', { title: 'Home' })
      expect(res1).toEqual({ handledBy: 'session_A' })

      // Switch active session to sessionB
      registry.setActiveSession('wireframe', 'session_B')
      expect(registry.getActiveSession('wireframe')?.sessionId).toBe('session_B')
      const res2 = await router.dispatchTool('storyboard_page_create', { title: 'Settings' })
      expect(res2).toEqual({ handledBy: 'session_B' })

      expect(calls).toEqual([
        { session: 'session_A', tool: 'storyboard_page_create', args: { title: 'Home' } },
        { session: 'session_B', tool: 'storyboard_page_create', args: { title: 'Settings' } },
      ])
    })
  })

  describe('2. Multi-MCP Routing & Meta-Skills', () => {
    it('aggregates multiple domains and enforces meta-skill readiness', async () => {
      const registry = new SkillRegistry()
      const router = new MeshRouter(registry)

      // Register wireframe domain with session
      registry.registerDomainSkill({
        domain: 'wireframe',
        name: 'Wireframe Domain',
        version: '1.0.0',
        description: 'Wireframe Studio',
        tools: [
          defineTool({
            name: 'get_screens',
            description: 'Get all screens',
            inputSchema: z.object({}),
            execute: async () => ({ screens: ['Home', 'Profile'] }),
          }),
        ],
      })
      registry.bindSession({
        sessionId: 'wf_1',
        domain: 'wireframe',
        alias: 'wireframe-local',
        transportType: 'p2p-webrtc',
        status: 'active',
        callTool: async () => ({ screens: ['Home', 'Profile'] }),
      })

      // Register git domain without active session initially
      registry.registerDomainSkill({
        domain: 'git',
        name: 'Git Domain',
        version: '1.0.0',
        description: 'Git operations',
        tools: [
          defineTool({
            name: 'commit',
            description: 'Commit changes',
            inputSchema: z.object({ message: z.string() }),
            execute: async () => ({ commitHash: 'abc1234' }),
          }),
        ],
      })

      // Register Meta-Skill requiring both wireframe and git
      router.registerMetaSkill({
        name: 'storyboard-versioning-workflow',
        version: '1.0.0',
        description: 'Exports wireframe and commits to git',
        requiresDomains: ['wireframe', 'git'],
        instructions: 'Export wireframe and commit',
      })

      // Check readiness -> git missing
      const check1 = router.checkMetaSkillReadiness('storyboard-versioning-workflow')
      expect(check1.ready).toBe(false)
      expect(check1.missingDomains).toEqual(['git'])

      // Bind git session
      registry.bindSession({
        sessionId: 'git_1',
        domain: 'git',
        alias: 'local-git',
        transportType: 'stdio',
        status: 'active',
        callTool: async () => ({ commitHash: 'abc1234' }),
      })

      // Check readiness again -> ready!
      const check2 = router.checkMetaSkillReadiness('storyboard-versioning-workflow')
      expect(check2.ready).toBe(true)
      expect(check2.missingDomains).toEqual([])

      // Test aggregated tools list
      const aggregated = router.getAggregatedTools()
      const toolNames = aggregated.map((t) => t.name)
      expect(toolNames).toContain('wireframe__get_screens')
      expect(toolNames).toContain('git__commit')
    })
  })

  describe('3. Dispatch authorization and session safety', () => {
    it('rejects malformed namespaced calls, invalid input, and ambiguous bare names', async () => {
      const registry = new SkillRegistry()
      const router = new MeshRouter(registry)
      const tool = defineTool({
        name: 'run', description: 'Run', inputSchema: z.object({ value: z.string() }), execute: async () => ({}),
      })
      registry.registerDomainSkill({ domain: 'alpha', name: 'Alpha', version: '1', description: 'a', tools: [tool] })
      registry.registerDomainSkill({ domain: 'beta', name: 'Beta', version: '1', description: 'b', tools: [tool] })
      const session = (id: string, domain: string): McpSessionInstance => ({
        sessionId: id, domain, alias: id, transportType: 'stdio', status: 'active', callTool: async () => ({ id }),
      })
      registry.bindSession(session('a', 'alpha')); registry.bindSession(session('b', 'beta'))
      await expect(router.dispatchTool('run', { value: 'x' })).rejects.toThrow(/no active session/)
      await expect(router.dispatchTool('alpha__run', { value: 1 })).rejects.toThrow(/Invalid input/)
      await expect(router.dispatchTool('alpha__missing', {})).rejects.toThrow(/no active session/)
      expect(router.resolveRoute('alpha__run__extra')).toBeNull()
    })

    it('does not retain a replaced session in the old domain and ignores idle sessions', () => {
      const registry = new SkillRegistry()
      registry.registerDomainSkill({ domain: 'alpha', name: 'Alpha', version: '1', description: 'a', tools: [] })
      registry.registerDomainSkill({ domain: 'beta', name: 'Beta', version: '1', description: 'b', tools: [] })
      const base = { alias: 's', transportType: 'stdio' as const, status: 'idle' as const, callTool: async () => ({}) }
      registry.bindSession({ ...base, sessionId: 's', domain: 'alpha' })
      registry.bindSession({ ...base, sessionId: 's', domain: 'beta', status: 'active' })
      expect(registry.getSessionsForDomain('alpha')).toHaveLength(0)
      expect(registry.getActiveSession('alpha')).toBeNull()
      expect(registry.getActiveSession('beta')?.sessionId).toBe('s')
    })

    it('emits bare aliases only for tools unique across domains', () => {
      const registry = new SkillRegistry()
      const shared = defineTool({ name: 'run', description: 'Run', inputSchema: z.object({}), execute: async () => ({}) })
      const unique = defineTool({ name: 'inspect', description: 'Inspect', inputSchema: z.object({}), execute: async () => ({}) })
      registry.registerDomainSkill({ domain: 'alpha', name: 'Alpha', version: '1', description: 'a', tools: [shared, unique] })
      registry.registerDomainSkill({ domain: 'beta', name: 'Beta', version: '1', description: 'b', tools: [shared] })
      registry.bindSession({ sessionId: 'a', domain: 'alpha', alias: 'a', transportType: 'stdio', status: 'active', callTool: async () => ({}) })
      registry.bindSession({ sessionId: 'b', domain: 'beta', alias: 'b', transportType: 'stdio', status: 'active', callTool: async () => ({}) })

      const names = new MeshRouter(registry).getAggregatedTools().map((tool) => tool.name)
      expect(names).toContain('alpha__run')
      expect(names).toContain('beta__run')
      expect(names).not.toContain('run')
      expect(names).toContain('inspect')
    })
  })
})

