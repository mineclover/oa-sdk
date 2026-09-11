/**
 * Transitive tsconfig universe helpers backed by genuine @oa-sdk/spec-lens.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  computeTsconfigUniverse,
  computeTsconfigUniverseDigest,
  createEmptyTsconfigUniverse,
  parseJsonc,
  stripJsonComments,
  removeTrailingCommas,
  buildSpecProjectKey,
} from '@oa-sdk/spec-lens'
import type {
  ContractConfigDigest,
  ContractConfigUniverse,
  SpecProjectKeyInput,
  ConfigurationClosure,
} from '@oa-sdk/spec-lens'

export {
  computeTsconfigUniverse,
  computeTsconfigUniverseDigest,
  createEmptyTsconfigUniverse,
  parseJsonc,
  stripJsonComments,
  removeTrailingCommas,
  buildSpecProjectKey,
}

export type {
  ContractConfigDigest,
  ContractConfigUniverse,
  SpecProjectKeyInput,
  ConfigurationClosure,
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export interface VirtualFileSystem {
  readFile(filePath: string): string
  fileExists(filePath: string): boolean
}

/**
 * Executes @oa-sdk/spec-lens computeTsconfigUniverse against on-disk or virtual file systems.
 */
export function computeTsconfigUniverseFromFs(
  rootTsconfigPath: string,
  vfs?: VirtualFileSystem,
  repoRoot = '/',
): ContractConfigUniverse {
  if (!vfs) {
    const res = computeTsconfigUniverse(rootTsconfigPath, repoRoot)
    if (!res) throw new Error(`computeTsconfigUniverse returned undefined for ${rootTsconfigPath}`)
    return res
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-vfs-tsconfig-'))
  try {
    const written = new Set<string>()

    // Check if vfs has internal map
    const internalMap = (vfs as any).map as Map<string, string> | undefined
    if (internalMap && internalMap instanceof Map) {
      for (const [filePath, content] of internalMap.entries()) {
        const cleanRel = filePath.startsWith('/') ? filePath.slice(1) : filePath
        const targetPath = path.join(tempDir, cleanRel)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, content, 'utf8')
        written.add(filePath)
      }
    }

    // Traverse recursively from root if not already written
    const queue = [rootTsconfigPath]
    while (queue.length > 0) {
      const current = queue.shift()!
      const norm = current.startsWith('/') ? current : '/' + current
      if (written.has(norm)) continue
      written.add(norm)

      if (!vfs.fileExists(norm)) continue
      const content = vfs.readFile(norm)
      const cleanRel = norm.startsWith('/') ? norm.slice(1) : norm
      const targetPath = path.join(tempDir, cleanRel)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, content, 'utf8')

      try {
        const parsed = parseJsonc(content)
        const dir = path.dirname(norm)
        if (parsed.extends) {
          const extList = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends]
          for (const ext of extList) {
            if (typeof ext === 'string') {
              const resPath = path.resolve(dir, ext.endsWith('.json') ? ext : `${ext}.json`)
              queue.push(resPath)
            }
          }
        }
        if (Array.isArray(parsed.references)) {
          for (const ref of parsed.references) {
            if (ref && typeof ref.path === 'string') {
              let resPath = path.resolve(dir, ref.path)
              if (!resPath.endsWith('.json')) {
                resPath = path.join(resPath, 'tsconfig.json')
              }
              queue.push(resPath)
            }
          }
        }
      } catch {
        // Ignore parse error
      }
    }

    const cleanRoot = rootTsconfigPath.startsWith('/') ? rootTsconfigPath.slice(1) : rootTsconfigPath
    const targetRoot = path.join(tempDir, cleanRoot)
    const universe = computeTsconfigUniverse(targetRoot, tempDir)
    if (!universe) {
      throw new Error(`computeTsconfigUniverse returned undefined for ${targetRoot}`)
    }
    return universe
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
