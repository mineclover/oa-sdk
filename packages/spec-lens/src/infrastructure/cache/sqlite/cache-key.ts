import { createHash } from 'node:crypto'
import type { DefinitionTargetConfig } from '@oa-sdk/parser'
export {
  buildManifestOrTargetDigest,
  buildSpecProjectKey,
  createSpecProjectIdentity,
  digestText,
} from '../../../domain/project.js'
export type {
  SpecProjectIdentity,
  SpecProjectKeyInput,
} from '../../../domain/project.js'

export function buildTargetConfigDigest(config: DefinitionTargetConfig): string {
  const normalized = sortDeep(config)
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortDeep(v)]),
    )
  }
  return value
}
