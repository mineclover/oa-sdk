import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createSourceLocationIndex,
  type SourceLocation,
  type SourceLocationIndex,
} from '@oa-sdk/parser'
import type { WorkspaceSourceLocationRecord } from '../../workspace-index.js'

export type CliSourceLocationSeed = {
  filePath: string
  raw: string
}

export interface CliSourceLocationResolver {
  lookup(filePath: string, pointer: string): SourceLocation | undefined
  list(filePath: string): WorkspaceSourceLocationRecord[]
}

export function createCliSourceLocationResolver(seed?: CliSourceLocationSeed): CliSourceLocationResolver {
  const indexes = new Map<string, SourceLocationIndex>()

  if (seed) {
    const filePath = resolve(seed.filePath)
    indexes.set(filePath, createSourceLocationIndex(seed.raw, { filePath }))
  }

  function getIndex(filePath: string): SourceLocationIndex | undefined {
    const resolvedPath = resolve(filePath)
    if (indexes.has(resolvedPath)) return indexes.get(resolvedPath)
    if (!existsSync(resolvedPath)) return undefined

    let index: SourceLocationIndex
    try {
      const raw = readFileSync(resolvedPath, 'utf8')
      index = createSourceLocationIndex(raw, { filePath: resolvedPath })
    } catch {
      index = createSourceLocationIndex('', { filePath: resolvedPath, syntax: 'json' })
    }
    indexes.set(resolvedPath, index)
    return index
  }

  return {
    lookup(filePath: string, pointer: string): SourceLocation | undefined {
      return getIndex(filePath)?.lookup(pointer)
    },
    list(filePath: string): WorkspaceSourceLocationRecord[] {
      return (getIndex(filePath)?.entries() ?? []).map(location => ({
        filePath: location.filePath ?? resolve(filePath),
        pointer: location.pointer,
        line: location.line,
        column: location.column,
      }))
    },
  }
}
