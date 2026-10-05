export type BuiltCliStatus = 'missing' | 'stale' | 'current' | 'unchecked'

export interface BuiltCliCheck {
  /** false when the built file is missing or older than a build input. */
  readonly ok: boolean
  /** `unchecked`: running under turbo, which owns freshness through the build task. */
  readonly status: BuiltCliStatus
  readonly message: string
  /** Package-relative build inputs modified after the build, newest first. */
  readonly changedInputs: readonly string[]
}

export interface BuiltCliCheckOptions {
  readonly packageRoot: string
  /** Package-relative path of the built file. Defaults to `dist/cli/index.js`. */
  readonly builtFile?: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface ResolvedBuildInputs {
  readonly repoRoot: string
  /** The build task's input globs after package configuration; empty means every file. */
  readonly inputs: readonly string[]
}

export function checkBuiltCli(options: BuiltCliCheckOptions): BuiltCliCheck
export function builtCliInputs(packageRoot: string): string[]
export function distShapingFiles(packageRoot: string): string[]
export function resolveBuildInputs(packageRoot: string): ResolvedBuildInputs
