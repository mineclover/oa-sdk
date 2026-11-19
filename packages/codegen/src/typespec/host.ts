import type { CompilerHost } from '@typespec/compiler'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NODE_MODULES_SEG_RE = /^(.*[/\\]node_modules)[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)(?:[/\\](.*))?$/
const codegenRequire = createRequire(import.meta.url)

function isMissingFsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'MODULE_NOT_FOUND'
}

function findBundledPackageDir(pkgName: string): string | null {
  try {
    const pkgJson = codegenRequire.resolve(`${pkgName}/package.json`)
    return dirname(pkgJson)
  } catch {
    // Fallback walk from this module's directory in case package.json is not exported
    let cur = dirname(fileURLToPath(import.meta.url))
    while (true) {
      const candidate = join(cur, 'node_modules', ...pkgName.split('/'))
      if (existsSync(join(candidate, 'package.json'))) {
        return candidate
      }
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
    return null
  }
}

/**
 * Wraps a TypeSpec `CompilerHost` so standard `@typespec/*` (and `@oa-sdk/*`) libraries
 * bundled with `@oa-sdk/codegen` act as a fallback when a caller compiles a `.tsp` file
 * outside a project with local `node_modules` (or under strict pnpm isolation).
 *
 * Consumer-local packages always win first: fallback triggers only when `baseHost` reports ENOENT.
 */
export function createTypeSpecFallbackHost(baseHost: CompilerHost): CompilerHost {
  const packageDirCache = new Map<string, string | null>()

  const resolveFallbackPath = (targetPath: string): string | null => {
    const abs = resolve(targetPath)
    const match = NODE_MODULES_SEG_RE.exec(abs)
    if (!match) return null
    const rawPkg = match[2]!.replace(/\\/g, '/')
    const subPath = match[3] ? match[3].replace(/\\/g, '/') : ''

    let pkgDir = packageDirCache.get(rawPkg)
    if (pkgDir === undefined) {
      pkgDir = findBundledPackageDir(rawPkg)
      packageDirCache.set(rawPkg, pkgDir)
    }
    if (!pkgDir) return null
    return subPath ? resolve(pkgDir, ...subPath.split('/')) : pkgDir
  }

  return {
    ...baseHost,
    async readFile(targetPath) {
      try {
        return await baseHost.readFile(targetPath)
      } catch (error) {
        if (!isMissingFsError(error)) throw error
        const fallback = resolveFallbackPath(targetPath)
        if (!fallback) throw error
        return baseHost.readFile(fallback)
      }
    },
    async stat(targetPath) {
      try {
        return await baseHost.stat(targetPath)
      } catch (error) {
        if (!isMissingFsError(error)) throw error
        const fallback = resolveFallbackPath(targetPath)
        if (!fallback) throw error
        return baseHost.stat(fallback)
      }
    },
    async realpath(targetPath) {
      try {
        return await baseHost.realpath(targetPath)
      } catch (error) {
        if (!isMissingFsError(error)) throw error
        const fallback = resolveFallbackPath(targetPath)
        if (!fallback) throw error
        return baseHost.realpath(fallback)
      }
    },
    async readDir(targetPath) {
      try {
        return await baseHost.readDir(targetPath)
      } catch (error) {
        if (!isMissingFsError(error)) throw error
        const fallback = resolveFallbackPath(targetPath)
        if (!fallback) throw error
        return baseHost.readDir(fallback)
      }
    },
  }
}
