/**
 * Versions of the `@oa-sdk` packages this build of codegen was built and tested
 * against.
 *
 * The packages are versioned independently of codegen, and a published install
 * contains neither the workspace nor, for packages codegen only loads on demand,
 * the packages themselves. This table is therefore the one record, inside a
 * published codegen, of which release of each package matches it: install
 * hints for companion packages (companion-packages.ts) and the specifiers
 * `oa-gen init` writes (init/oa-sdk-packages.ts) both read it.
 */

/**
 * JSON text of the versions, embedded by the build (tsup.config.ts) and by the
 * test runner (vitest.config.ts); see scripts/workspace-versions.mjs.
 */
declare const __OA_SDK_WORKSPACE_VERSIONS__: string | undefined

/**
 * Versions of the `@oa-sdk` packages this build of codegen was built and tested
 * against, keyed by package name: codegen itself and every workspace package it
 * depends on, companion packages included. Empty when the source runs without
 * the build-time constant, e.g. through a plain TypeScript loader.
 */
export const BUILT_AGAINST_VERSIONS: Readonly<Record<string, string>> = Object.freeze(
  typeof __OA_SDK_WORKSPACE_VERSIONS__ === 'string'
    ? JSON.parse(__OA_SDK_WORKSPACE_VERSIONS__) as Record<string, string>
    : {},
)

/**
 * The versions of `packageName` this build of codegen supports: releases
 * compatible (`^`) with the version it was built and tested against, or
 * `undefined` when that version is unknown.
 */
export function builtAgainstRange(
  packageName: string,
  versions: Readonly<Record<string, string>> = BUILT_AGAINST_VERSIONS,
): string | undefined {
  const version = versions[packageName]
  return version === undefined ? undefined : `^${version}`
}
