import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  compile,
  NodeHost,
  getSourceLocation,
  type Program,
} from '@typespec/compiler'

const execFileAsync = promisify(execFile)

export interface ResolvedTypeSpecProgram {
  program: Program
  entrypoint: string
  cleanup: () => Promise<void>
}

function findRepoRoot(startDir: string): string {
  let curr = path.resolve(startDir)
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, '.git'))) {
      return curr
    }
    curr = path.dirname(curr)
  }
  return path.resolve(startDir)
}

function checkCompilationErrors(program: Program, ref: string): void {
  const errors = program.diagnostics.filter(d => d.severity === 'error')
  if (errors.length > 0) {
    const messages = errors.map(d => {
      const loc = d.target ? getSourceLocation(d.target) : undefined
      const locStr = loc
        ? `${loc.file.path}:${loc.file.getLineAndCharacterOfPosition(loc.pos).line + 1}`
        : ''
      return `[${d.code}] ${locStr} ${d.message}`
    })
    throw new Error(`TypeSpec compilation failed for "${ref}":\n${messages.join('\n')}`)
  }
}

async function isGitRef(ref: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd })
    return true
  } catch {
    return false
  }
}

export async function resolveTypeSpecProgramRef(
  ref: string,
  projectRoot: string = process.cwd(),
  fallbackPath?: string,
): Promise<ResolvedTypeSpecProgram> {
  const invocationCwd = process.cwd()
  const repoRoot = findRepoRoot(projectRoot)

  // 1. Check if ref is a local file or directory
  const candidates = [
    path.resolve(invocationCwd, ref),
    path.resolve(projectRoot, ref),
    path.resolve(repoRoot, ref),
  ]

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      const stat = fsSync.statSync(candidate)
      let entrypoint = candidate
      if (stat.isDirectory()) {
        const mainTsp = path.join(candidate, 'main.tsp')
        const tspConfig = path.join(candidate, 'tspconfig.yaml')
        if (fsSync.existsSync(mainTsp)) {
          entrypoint = mainTsp
        } else if (fsSync.existsSync(tspConfig)) {
          entrypoint = candidate
        }
      }

      const program = await compile(NodeHost, entrypoint, { noEmit: true })
      checkCompilationErrors(program, ref)

      return {
        program,
        entrypoint,
        cleanup: async () => {},
      }
    }
  }

  // 2. Check if ref is a git ref
  // Syntax can be "ref" or "ref:subpath"
  let gitRefPart = ref
  let subpathPart: string | undefined

  const colonIdx = ref.indexOf(':')
  if (colonIdx !== -1) {
    const potentialRef = ref.slice(0, colonIdx)
    const potentialSubpath = ref.slice(colonIdx + 1)
    if (await isGitRef(potentialRef, repoRoot)) {
      gitRefPart = potentialRef
      subpathPart = potentialSubpath
    }
  }

  const validGit = await isGitRef(gitRefPart, repoRoot)
  if (!validGit) {
    throw new Error(
      `Unable to resolve TypeSpec reference "${ref}": path does not exist and is not a valid git reference.`,
    )
  }

  // Create temporary extraction workspace
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-tsp-diff-'))

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    // Extract git archive to tempDir
    // Using git archive | tar -x -C
    await execFileAsync('sh', ['-c', `git archive "${gitRefPart}" | tar -x -C "${tempDir}"`], {
      cwd: repoRoot,
    })

    // Symlink root node_modules if present
    const rootNodeModules = path.join(repoRoot, 'node_modules')
    if (fsSync.existsSync(rootNodeModules)) {
      await fs.symlink(rootNodeModules, path.join(tempDir, 'node_modules'), 'dir').catch(() => {})
    }

    // Also symlink package-level node_modules (e.g. packages/schemas/node_modules)
    const packagesDir = path.join(repoRoot, 'packages')
    if (fsSync.existsSync(packagesDir)) {
      const packageNames = await fs.readdir(packagesDir).catch(() => [] as string[])
      for (const pkg of packageNames) {
        const pkgNodeModules = path.join(packagesDir, pkg, 'node_modules')
        if (fsSync.existsSync(pkgNodeModules)) {
          const targetDir = path.join(tempDir, 'packages', pkg)
          await fs.mkdir(targetDir, { recursive: true }).catch(() => {})
          await fs.symlink(pkgNodeModules, path.join(targetDir, 'node_modules'), 'dir').catch(() => {})
        }
      }
    }

    // Determine entrypoint in tempDir
    let entrypoint: string | undefined

    if (subpathPart) {
      entrypoint = path.join(tempDir, subpathPart)
    } else if (fallbackPath) {
      const relFallback = path.isAbsolute(fallbackPath)
        ? path.relative(repoRoot, fallbackPath)
        : fallbackPath
      const candidateFallback = path.join(tempDir, relFallback)
      if (fsSync.existsSync(candidateFallback)) {
        entrypoint = candidateFallback
      }
    }

    if (!entrypoint || !fsSync.existsSync(entrypoint)) {
      const standardCandidates = [
        path.join(tempDir, 'packages/schemas/typespec/main.tsp'),
        path.join(tempDir, 'packages/schemas/typespec'),
        path.join(tempDir, 'main.tsp'),
      ]
      for (const sc of standardCandidates) {
        if (fsSync.existsSync(sc)) {
          entrypoint = sc
          break
        }
      }
    }

    if (!entrypoint || !fsSync.existsSync(entrypoint)) {
      // Find any main.tsp recursively
      const findMainTsp = async (dir: string): Promise<string | undefined> => {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const found = await findMainTsp(fullPath)
            if (found) return found
          } else if (entry.name === 'main.tsp') {
            return fullPath
          }
        }
        return undefined
      }

      entrypoint = await findMainTsp(tempDir)
    }

    if (!entrypoint || !fsSync.existsSync(entrypoint)) {
      throw new Error(
        `Could not locate TypeSpec entrypoint (main.tsp) in git reference "${ref}".`,
      )
    }

    const program = await compile(NodeHost, entrypoint, { noEmit: true })
    checkCompilationErrors(program, ref)

    return {
      program,
      entrypoint,
      cleanup,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}
