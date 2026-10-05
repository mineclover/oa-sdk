/**
 * @oa-sdk/core — Project Root Discovery
 *
 * Implements hierarchical upward project root discovery adhering to 6-tier precedence:
 * 1. Explicit CLI argument (--root / --project-root / explicitRoot)
 * 2. Environment variable (OA_PROJECT_ROOT)
 * 3. Spec configuration file (oa.config.ts, oa.config.mjs, oa.config.json, .oarc.json)
 * 4. Monorepo workspace marker (pnpm-workspace.yaml, turbo.json, lerna.json, package.json with workspaces)
 * 5. Version control marker (.git)
 * 6. Fallback (process.cwd())
 *
 * Submodule Traversal Invariant:
 * In monorepos containing git submodules (e.g. browser-mapper within browser-studio),
 * config files (Rule 3) take precedence across the entire ancestor hierarchy before
 * stopping at nested submodule workspace (Rule 4) or VCS (Rule 5) markers.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const DEFAULT_CONFIG_FILES: readonly string[] = [
  'oa.config.ts',
  'oa.config.mjs',
  'oa.config.json',
  '.oarc.json',
]

export const DEFAULT_WORKSPACE_FILES: readonly string[] = [
  'pnpm-workspace.yaml',
  'turbo.json',
  'lerna.json',
  'package.json',
]

export const DEFAULT_VCS_DIRS: readonly string[] = [
  '.git',
]

export const DEFAULT_ENV_VAR_NAME = 'OA_PROJECT_ROOT'

export interface ProjectRootMarkers {
  configFiles?: string[] | undefined
  workspaceFiles?: string[] | undefined
  vcsDirs?: string[] | undefined
}

export interface FindProjectRootOptions {
  cwd?: string | undefined
  explicitRoot?: string | undefined
  envVarName?: string | undefined
  markers?: ProjectRootMarkers | undefined
}


export type RootResolutionReason =
  | 'explicit'
  | 'env'
  | 'config'
  | 'workspace'
  | 'vcs'
  | 'fallback'

export interface ProjectRootDetail {
  root: string
  tier: 1 | 2 | 3 | 4 | 5 | 6
  reason: RootResolutionReason
  matchedMarker?: string
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The workspace declaration of a package.json manifest: npm/yarn/bun use a
 * `workspaces` array, Yarn classic also accepts `{ packages: [...] }`.
 */
const PackageWorkspacesSchema = {
  parse(value: unknown): { declaresWorkspaces: boolean } {
    if (!isJsonObject(value)) return { declaresWorkspaces: false }
    const workspaces = value.workspaces
    return {
      declaresWorkspaces: Array.isArray(workspaces) || (isJsonObject(workspaces) && Array.isArray(workspaces.packages)),
    }
  },
}

/**
 * Checks whether a package.json file defines a monorepo workspace.
 */
function isWorkspacePackageJson(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return false
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return PackageWorkspacesSchema.parse(JSON.parse(content)).declaresWorkspaces
  } catch {
    return false
  }
}

/**
 * Computes the ancestor hierarchy starting from startDir up to the filesystem root.
 */
function getAncestors(startDir: string): string[] {
  const ancestors: string[] = []
  let current = path.resolve(startDir)

  while (true) {
    ancestors.push(current)
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return ancestors
}

/**
 * Resolves project root with rich diagnostic metadata (tier, reason, matched marker).
 */
export function findProjectRootDetail(
  optionsOrCwd?: FindProjectRootOptions | string,
  explicitRoot?: string,
): ProjectRootDetail {
  let cwd: string
  let explicit: string | undefined
  let envVarName: string = DEFAULT_ENV_VAR_NAME
  let markers: ProjectRootMarkers | undefined

  if (typeof optionsOrCwd === 'string') {
    cwd = optionsOrCwd
    explicit = explicitRoot
  } else if (optionsOrCwd && typeof optionsOrCwd === 'object') {
    cwd = optionsOrCwd.cwd ?? process.cwd()
    explicit = optionsOrCwd.explicitRoot ?? explicitRoot
    if (optionsOrCwd.envVarName) {
      envVarName = optionsOrCwd.envVarName
    }
    markers = optionsOrCwd.markers
  } else {
    cwd = process.cwd()
    explicit = explicitRoot
  }

  const resolvedCwd = path.resolve(cwd)

  // -------------------------------------------------------------------------
  // Tier 1: Explicit argument override (--root, --project-root, explicitRoot)
  // -------------------------------------------------------------------------
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const resolvedExplicit = path.resolve(resolvedCwd, explicit.trim())
    try {
      if (fs.existsSync(resolvedExplicit) && fs.statSync(resolvedExplicit).isFile()) {
        return {
          root: path.dirname(resolvedExplicit),
          tier: 1,
          reason: 'explicit',
          matchedMarker: path.basename(resolvedExplicit),
        }
      }
    } catch {
      // Ignore stat error and use resolved path
    }
    return {
      root: resolvedExplicit,
      tier: 1,
      reason: 'explicit',
    }
  }

  // -------------------------------------------------------------------------
  // Tier 2: Environment variable override (OA_PROJECT_ROOT)
  // -------------------------------------------------------------------------
  const envVal = process.env[envVarName]
  if (typeof envVal === 'string' && envVal.trim() !== '') {
    const resolvedEnv = path.resolve(resolvedCwd, envVal.trim())
    try {
      if (fs.existsSync(resolvedEnv) && fs.statSync(resolvedEnv).isFile()) {
        return {
          root: path.dirname(resolvedEnv),
          tier: 2,
          reason: 'env',
          matchedMarker: path.basename(resolvedEnv),
        }
      }
    } catch {
      // Ignore stat error and use resolved path
    }
    return {
      root: resolvedEnv,
      tier: 2,
      reason: 'env',
      matchedMarker: envVarName,
    }
  }

  const ancestors = getAncestors(resolvedCwd)

  // -------------------------------------------------------------------------
  // Tier 3: Spec configuration file candidates
  // Checked ACROSS THE ENTIRE ANCESTOR TREE before workspace/VCS markers
  // to satisfy the submodule traversal invariant.
  // -------------------------------------------------------------------------
  const configFiles = markers?.configFiles ?? DEFAULT_CONFIG_FILES
  for (const dir of ancestors) {
    for (const candidate of configFiles) {
      const candidatePath = path.join(dir, candidate)
      try {
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          return {
            root: dir,
            tier: 3,
            reason: 'config',
            matchedMarker: candidate,
          }
        }
      } catch {
        // Ignore permission / stat errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tier 4: Monorepo workspace markers
  // -------------------------------------------------------------------------
  const workspaceFiles = markers?.workspaceFiles ?? DEFAULT_WORKSPACE_FILES
  for (const dir of ancestors) {
    for (const candidate of workspaceFiles) {
      const candidatePath = path.join(dir, candidate)
      try {
        if (candidate === 'package.json') {
          if (isWorkspacePackageJson(candidatePath)) {
            return {
              root: dir,
              tier: 4,
              reason: 'workspace',
              matchedMarker: candidate,
            }
          }
        } else if (fs.existsSync(candidatePath)) {
          return {
            root: dir,
            tier: 4,
            reason: 'workspace',
            matchedMarker: candidate,
          }
        }
      } catch {
        // Ignore permission / stat errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tier 5: Version control markers (.git directory or submodule pointer file)
  // -------------------------------------------------------------------------
  const vcsDirs = markers?.vcsDirs ?? DEFAULT_VCS_DIRS
  for (const dir of ancestors) {
    for (const candidate of vcsDirs) {
      const candidatePath = path.join(dir, candidate)
      try {
        if (fs.existsSync(candidatePath)) {
          return {
            root: dir,
            tier: 5,
            reason: 'vcs',
            matchedMarker: candidate,
          }
        }
      } catch {
        // Ignore permission / stat errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tier 6: Fallback to cwd
  // -------------------------------------------------------------------------
  return {
    root: resolvedCwd,
    tier: 6,
    reason: 'fallback',
  }
}

/**
 * Finds the project root directory adhering to 6-tier precedence.
 *
 * @param optionsOrCwd Options object or starting directory string
 * @param explicitRoot Optional explicit root override if first argument was cwd
 * @returns Absolute normalized path to the project root
 */
export function findProjectRoot(
  optionsOrCwd?: FindProjectRootOptions | string,
  explicitRoot?: string,
): string {
  return findProjectRootDetail(optionsOrCwd, explicitRoot).root
}
