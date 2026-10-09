import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createJsonSchemaValidator } from '@oa-sdk/tools'
import type {
  CollaborationManifest,
  SourceReference,
  CollaborationReferenceIndex,
  CollaborationManagementProjection,
  CollaborationsRegistry,
} from '../contracts/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const schemaDir = join(__dirname, '../schema/json-schema')

function loadJson(name: string) {
  return JSON.parse(readFileSync(join(schemaDir, name), 'utf-8'))
}

const collaborationSchema = loadJson('collaboration.schema.json')
const referenceSchema = loadJson('reference.schema.json')
const referenceIndexSchema = loadJson('reference-index.schema.json')
const managementSchema = loadJson('collaboration-management.schema.json')
const registrySchema = loadJson('collaborations-registry.schema.json')

const manifestValidator = createJsonSchemaValidator<CollaborationManifest>(collaborationSchema)
const refValidator = createJsonSchemaValidator<SourceReference>(referenceSchema)
const indexValidator = createJsonSchemaValidator<CollaborationReferenceIndex>(referenceIndexSchema)
const managementValidator = createJsonSchemaValidator<CollaborationManagementProjection>(managementSchema)
const registryValidator = createJsonSchemaValidator<CollaborationsRegistry>(registrySchema)

export interface ValidationOutput<T> {
  ok: boolean
  value?: T
  issues: string[]
}

const GITHUB_SHA = /^[a-f0-9]{40}$/i
const FORBIDDEN_SNAPSHOTS = new Set(['latest', 'main', 'master', 'working-tree', '<verified-commit-sha>'])

export function validateCollaborationManifest(value: unknown): ValidationOutput<CollaborationManifest> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['MANIFEST_NOT_AN_OBJECT'] }
  }

  const result = manifestValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  const m = value as Partial<CollaborationManifest>
  if (m.storage && m.storage.folderIds) {
    const f = m.storage.folderIds
    const folderIds = [f.discussions, f.proposals, f.decisions, f.references, f.distributions].filter(Boolean)
    if (new Set(folderIds).size !== folderIds.length) {
      issues.push('DUPLICATE_CATEGORY_FOLDER_IDS')
    }
    if (m.storage.rootFolderId && folderIds.includes(m.storage.rootFolderId)) {
      issues.push('ROOT_FOLDER_REUSED_IN_CATEGORIES')
    }
  }

  if (Array.isArray(m.participants)) {
    const seen = new Set<string>()
    for (const p of m.participants) {
      if (p?.workspaceId) {
        if (seen.has(p.workspaceId)) {
          issues.push('DUPLICATE_PARTICIPANT_WORKSPACE_ID')
          break
        }
        seen.add(p.workspaceId)
      }
    }
  }

  return issues.length === 0
    ? { ok: true, value: value as CollaborationManifest, issues: [] }
    : { ok: false, issues }
}

export function validateSourceReference(value: unknown): ValidationOutput<SourceReference> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['REFERENCE_NOT_AN_OBJECT'] }
  }

  const result = refValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  const r = value as Partial<SourceReference>
  if (r.source && r.source.snapshot) {
    const sId = r.source.snapshot.id
    if (typeof sId === 'string') {
      if (FORBIDDEN_SNAPSHOTS.has(sId.toLowerCase())) {
        issues.push('SNAPSHOT_ID_NON_CANONICAL')
      }
      if (r.source.provider === 'github' && r.source.snapshot.kind === 'immutable') {
        if (!GITHUB_SHA.test(sId)) {
          issues.push('GITHUB_IMMUTABLE_REQUIRES_40_HEX_SHA')
        }
      }
    }
  }

  return issues.length === 0
    ? { ok: true, value: value as SourceReference, issues: [] }
    : { ok: false, issues }
}

export function validateReferenceIndex(value: unknown): ValidationOutput<CollaborationReferenceIndex> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['INDEX_NOT_AN_OBJECT'] }
  }

  const result = indexValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  const idx = value as Partial<CollaborationReferenceIndex>
  if (Array.isArray(idx.references)) {
    const seenRefs = new Set<string>()
    for (const item of idx.references) {
      if (item?.referenceId) {
        if (seenRefs.has(item.referenceId)) {
          issues.push('DUPLICATE_REFERENCE_INDEX_ENTRY')
          break
        }
        seenRefs.add(item.referenceId)
      }
    }
  }

  return issues.length === 0
    ? { ok: true, value: value as CollaborationReferenceIndex, issues: [] }
    : { ok: false, issues }
}

export function validateManagementProjection(value: unknown): ValidationOutput<CollaborationManagementProjection> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['MANAGEMENT_NOT_AN_OBJECT'] }
  }

  const result = managementValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  return issues.length === 0
    ? { ok: true, value: value as CollaborationManagementProjection, issues: [] }
    : { ok: false, issues }
}

export function validateCollaborationsRegistry(value: unknown): ValidationOutput<CollaborationsRegistry> {
  const issues: string[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: ['REGISTRY_NOT_AN_OBJECT'] }
  }

  const result = registryValidator.validate(value)
  if (!result.success) {
    issues.push(result.error)
  }

  return issues.length === 0
    ? { ok: true, value: value as CollaborationsRegistry, issues: [] }
    : { ok: false, issues }
}
