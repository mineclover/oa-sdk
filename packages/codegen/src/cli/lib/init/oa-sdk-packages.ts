/**
 * Specifiers `oa-gen init` writes for `@oa-sdk` packages.
 *
 * Target and archetype profiles name the `@oa-sdk` packages a scaffold needs;
 * which specifier installs them depends on where the project lives, so it is
 * decided here, once, for every package init recommends:
 *
 * - `workspace:*` when the project is a member of a pnpm workspace that has the
 *   package as a member (see common/pnpm-workspace.ts). The workspace protocol
 *   resolves nowhere else, and npm rejects it outright.
 * - Otherwise, for a package published to the registry, the releases
 *   compatible (`^`) with the version this build of codegen was built and
 *   tested against (built-against-versions.ts), or `latest` when the source
 *   runs without that build-time record.
 * - A private package has no other source, so outside such a workspace it is
 *   not written at all and init reports it instead.
 */
import { BUILT_AGAINST_VERSIONS, builtAgainstRange } from '../built-against-versions.js'
import type { CompanionPackageName } from '../companion-packages.js'
import { findPnpmWorkspace } from './common/pnpm-workspace.js'

/**
 * `@oa-sdk` packages `oa-gen init` may recommend, with where a project outside
 * a workspace containing them installs them from: the npm `registry`, or
 * nowhere, for a package that stays private to the oa-sdk `workspace`.
 *
 * Every companion package is listed, from the registry: init recommends the
 * companions its scaffold loads, and the install command `oa-gen` prints for
 * a missing companion names the same range init writes for it.
 */
export const OA_SDK_INIT_PACKAGES = {
  '@oa-sdk/codegen': 'registry',
  '@oa-sdk/core': 'registry',
  '@oa-sdk/router': 'registry',
  '@oa-sdk/client': 'registry',
  '@oa-sdk/mock-server': 'registry',
  '@oa-sdk/personas': 'workspace',
} as const satisfies Readonly<Record<`@oa-sdk/${string}`, 'registry' | 'workspace'>>
  & Readonly<Record<CompanionPackageName, 'registry'>>

export type OaSdkPackageName = keyof typeof OA_SDK_INIT_PACKAGES

/**
 * `@oa-sdk` packages `oa-gen` tells a project to install from the registry,
 * at the releases compatible with the version this build of codegen was built
 * against (built-against-versions.ts): every package `oa-gen init` writes a
 * registry range for, which includes every companion package `oa-gen` prints
 * an install command for, and codegen itself.
 *
 * A codegen release is only usable once each of these versions can be
 * installed, so the release exporter checks the versions a packed codegen
 * embeds for every package listed here.
 */
export const REGISTRY_OA_SDK_PACKAGES: readonly OaSdkPackageName[] = Object.freeze(
  (Object.keys(OA_SDK_INIT_PACKAGES) as OaSdkPackageName[])
    .filter(name => OA_SDK_INIT_PACKAGES[name] === 'registry'),
)

/** Specifier of a package pnpm links from the project's own workspace. */
export const WORKSPACE_SPECIFIER = 'workspace:*'

/** Registry specifier of a package whose built-against version this build does not know. */
export const UNPINNED_SPECIFIER = 'latest'

/** Where a project installs `@oa-sdk` packages from. */
export interface OaSdkPackageSources {
  /** Packages pnpm links from the workspace the project is a member of. */
  workspacePackages: ReadonlySet<string>
  /** Versions this build of codegen was built against, keyed by package name. */
  versions: Readonly<Record<string, string>>
}

/** Sources of a project that no workspace provides `@oa-sdk` packages to: the registry only. */
export const REGISTRY_SOURCES: OaSdkPackageSources = Object.freeze({
  workspacePackages: new Set<string>(),
  versions: BUILT_AGAINST_VERSIONS,
})

/** How `oa-gen init` lists one `@oa-sdk` package: with a specifier, or not at all, for `reason`. */
export type OaSdkPackageResolution =
  | { name: OaSdkPackageName; specifier: string }
  | { name: OaSdkPackageName; specifier?: undefined; reason: string }

/** An `@oa-sdk` package the scaffold would use but the project cannot install where it lives. */
export interface UnavailableOaSdkPackage {
  name: OaSdkPackageName
  reason: string
}

export function resolveOaSdkPackage(
  name: OaSdkPackageName,
  sources: OaSdkPackageSources = REGISTRY_SOURCES,
): OaSdkPackageResolution {
  if (sources.workspacePackages.has(name)) return { name, specifier: WORKSPACE_SPECIFIER }
  if (OA_SDK_INIT_PACKAGES[name] === 'workspace') {
    return {
      name,
      reason: 'private package, not published to the registry; only a pnpm workspace that contains it can install it',
    }
  }
  return { name, specifier: builtAgainstRange(name, sources.versions) ?? UNPINNED_SPECIFIER }
}

/** Where the project in `projectDir` installs `@oa-sdk` packages from. */
export async function findOaSdkPackageSources(
  projectDir: string,
  versions: Readonly<Record<string, string>> = BUILT_AGAINST_VERSIONS,
): Promise<OaSdkPackageSources> {
  const workspace = await findPnpmWorkspace(projectDir)
  return {
    workspacePackages: new Set(workspace?.packages.keys() ?? []),
    versions,
  }
}
