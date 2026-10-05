/**
 * Records what the TypeSpec compiler learns from the file system through its
 * host, so `--incremental` can tell whether a compilation would still see the
 * same inputs.
 *
 * Every host read is recorded, not only the sources the program ended up with:
 * how an import resolves (which `node_modules` directory exists, what a
 * `package.json` says about `tspMain`/`exports`, where a symlink points) is as
 * much an input as the source text. A linked library that is re-pointed, or
 * whose manifest names another main file, changes these observations even when
 * every previously loaded source file is unchanged.
 */
import type { CompilerHost } from '@typespec/compiler'
import { resolve } from 'node:path'
import { isMissingPathError, type FileEntryKind, type InputObservation } from './input-observations.js'

export type CompilerHostRecording = {
  /** The host to compile with; it delegates to the wrapped host. */
  host: CompilerHost
  /** Observations made through `host` so far, in call order (with repeats). */
  readonly observations: readonly InputObservation[]
  /** JS files the compiler imported through `host` (library and decorator entries). */
  readonly jsImports: ReadonlySet<string>
}

export function recordCompilerHostInputs(base: CompilerHost): CompilerHostRecording {
  const observations: InputObservation[] = []
  const jsImports = new Set<string>()

  const host: CompilerHost = {
    ...base,
    async readFile(path) {
      const filePath = resolve(path)
      try {
        const file = await base.readFile(path)
        observations.push({ kind: 'content', path: filePath, consumed: { text: file.text } })
        return file
      } catch (error) {
        observations.push(isMissingPathError(error)
          ? { kind: 'content', path: filePath, consumed: { absent: true } }
          : { kind: 'content', path: filePath, unverified: 'unreadable' })
        throw error
      }
    },
    async stat(path) {
      const filePath = resolve(path)
      try {
        const stats = await base.stat(path)
        const value: FileEntryKind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'
        observations.push({ kind: 'entry', path: filePath, value })
        return stats
      } catch (error) {
        observations.push({ kind: 'entry', path: filePath, value: isMissingPathError(error) ? 'absent' : 'unreadable' })
        throw error
      }
    },
    async realpath(path) {
      const filePath = resolve(path)
      try {
        const realPath = await base.realpath(path)
        observations.push({ kind: 'realpath', path: filePath, value: realPath })
        return realPath
      } catch (error) {
        observations.push(isMissingPathError(error)
          ? { kind: 'realpath', path: filePath, value: null }
          : { kind: 'realpath', path: filePath, unverified: 'unresolvable' })
        throw error
      }
    },
    async readDir(path) {
      observations.push({ kind: 'entry', path: resolve(path), unverified: 'directory listing not tracked' })
      return base.readDir(path)
    },
    async readUrl(url) {
      observations.push({ kind: 'content', path: url, unverified: 'remote input' })
      return base.readUrl(url)
    },
    async getJsImport(path) {
      jsImports.add(resolve(path))
      return base.getJsImport(path)
    },
  }

  return { host, observations, jsImports }
}
