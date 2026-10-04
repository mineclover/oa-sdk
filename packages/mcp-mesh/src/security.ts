/** Boundary validation for untrusted peer manifests and tool invocations. */
import { validateToolInput, type ToolDefinition } from '@oa-sdk/tools'
import type { DomainSkillDefinition, McpSessionInstance, MetaSkillDefinition, SkillPackage } from './types.js'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function validateMeshIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.includes('__') || RESERVED_KEYS.has(value)) {
    throw new Error(`${label} contains unsupported characters`)
  }
  return value
}

function validateSchemaObject(schema: unknown, path = 'inputSchema'): void {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema)) {
    for (const value of schema) validateSchemaObject(value, path)
    return
  }
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`${path} contains a reserved key`)
    validateSchemaObject(value, `${path}.${key}`)
  }
}

export function validateToolDefinition(tool: ToolDefinition): ToolDefinition {
  if (!tool || typeof tool !== 'object') throw new TypeError('tool definition is required')
  validateMeshIdentifier(tool.name, 'tool name')
  if (typeof tool.description !== 'string' || tool.description.length > 16_384) throw new Error('tool description is invalid')
  validateSchemaObject(tool.inputSchema)
  return tool
}

export function validateDomainSkill(skill: DomainSkillDefinition): DomainSkillDefinition {
  if (!skill || typeof skill !== 'object') throw new TypeError('domain skill is required')
  validateMeshIdentifier(skill.domain, 'domain')
  if (typeof skill.name !== 'string' || skill.name.length === 0 || skill.name.length > 512) throw new Error('skill name is invalid')
  if (typeof skill.version !== 'string' || skill.version.length === 0 || skill.version.length > 128) throw new Error('skill version is invalid')
  if (typeof skill.description !== 'string' || skill.description.length > 16_384) throw new Error('skill description is invalid')
  if (skill.instructions !== undefined && (typeof skill.instructions !== 'string' || skill.instructions.length > 64_000)) throw new Error('skill instructions are invalid')
  if (!Array.isArray(skill.tools)) throw new TypeError('skill tools must be an array')
  const names = new Set<string>()
  for (const tool of skill.tools) {
    validateToolDefinition(tool)
    if (names.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`)
    names.add(tool.name)
  }
  validateWorkspaceRules(skill.workspaceRules)
  return skill
}

export function validateWorkspaceRules(rules: DomainSkillDefinition['workspaceRules']): void {
  if (!rules) return
  if (rules.allowedPaths !== undefined) {
    if (!Array.isArray(rules.allowedPaths)) throw new TypeError('workspace allowedPaths must be an array')
    for (const path of rules.allowedPaths) {
      if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.includes('..')) {
        throw new Error('workspace allowedPaths contains an unsafe path')
      }
    }
  }
  if (rules.readOnly !== undefined && typeof rules.readOnly !== 'boolean') throw new Error('workspace readOnly must be boolean')
}

export function validateSession(session: McpSessionInstance): McpSessionInstance {
  if (!session || typeof session !== 'object') throw new TypeError('session is required')
  validateMeshIdentifier(session.sessionId, 'session id')
  validateMeshIdentifier(session.domain, 'session domain')
  validateMeshIdentifier(session.alias, 'session alias')
  if (!['p2p-webrtc', 'bridge-http', 'stdio', 'http-stateless'].includes(session.transportType)) throw new Error('session transport is invalid')
  if (!['active', 'idle', 'disconnected'].includes(session.status)) throw new Error('session status is invalid')
  if (typeof session.callTool !== 'function') throw new TypeError('session callTool must be a function')
  return session
}

export function validateMetaSkill(meta: MetaSkillDefinition): MetaSkillDefinition {
  if (!meta || typeof meta !== 'object') throw new TypeError('meta skill is required')
  validateMeshIdentifier(meta.name, 'meta skill name')
  if (typeof meta.version !== 'string' || meta.version.length === 0) throw new Error('meta skill version is invalid')
  if (typeof meta.description !== 'string' || meta.description.length > 16_384) throw new Error('meta skill description is invalid')
  if (!Array.isArray(meta.requiresDomains) || meta.requiresDomains.length === 0) throw new Error('meta skill requires domains')
  const domains = new Set<string>()
  for (const domain of meta.requiresDomains) {
    validateMeshIdentifier(domain, 'required domain')
    if (domains.has(domain)) throw new Error(`duplicate required domain: ${domain}`)
    domains.add(domain)
  }
  if (typeof meta.instructions !== 'string' || meta.instructions.length > 64_000) throw new Error('meta skill instructions are invalid')
  return meta
}

export function assertToolInput(tool: ToolDefinition, input: unknown): Record<string, unknown> {
  const result = validateToolInput(tool.inputSchema, input ?? {})
  if (!result.success) throw new Error(`Invalid input for tool "${tool.name}": ${result.error}`)
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error(`Input for tool "${tool.name}" must be an object`)
  return result.data as Record<string, unknown>
}

/** Validate a peer package before it is converted into executable tools. */
export function validatePeerPackage(peer: SkillPackage): SkillPackage {
  validateMeshIdentifier(peer.domain, 'peer domain')
  if (typeof peer.name !== 'string' || peer.name.length === 0) throw new Error('peer name is invalid')
  if (!Array.isArray(peer.tools)) throw new TypeError('peer tools must be an array')
  for (const tool of peer.tools) {
    validateMeshIdentifier(tool.name, 'peer tool name')
    if (typeof tool.description !== 'string' || tool.description.length > 16_384) throw new Error('peer tool description is invalid')
    validateSchemaObject(tool.inputSchema)
  }
  validateWorkspaceRules(peer.workspaceRules)
  return peer
}
