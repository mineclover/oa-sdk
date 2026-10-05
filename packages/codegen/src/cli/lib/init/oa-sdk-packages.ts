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
import { z } from 'zod'
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

// ---------------------------------------------------------------------------
// Entries package.json already has

/** Sections of package.json whose entries a package manager installs. */
export const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number]

const DependencyEntries = z.record(z.string(), z.unknown()).optional()

const ManifestDependencies = z.object({
  dependencies: DependencyEntries,
  devDependencies: DependencyEntries,
  optionalDependencies: DependencyEntries,
  peerDependencies: DependencyEntries,
})

/**
 * An `@oa-sdk` entry of package.json that the project cannot install where it
 * lives, with what to do instead: `remove` it, or `replace` its specifier
 * with `replacement`, the registry specifier `oa-gen init` would write, which
 * is `undefined` for a package this build of codegen has no version of.
 */
export interface UninstallableOaSdkEntry {
  name: string
  section: DependencySection
  specifier: string
  reason: string
  fix: { action: 'remove' } | { action: 'replace'; replacement: string | undefined }
}

/**
 * The `@oa-sdk` entries of `packageJson` (the text of a package.json) that
 * the project cannot install from `sources`:
 *
 * - a private package (`workspace` in `OA_SDK_INIT_PACKAGES`), whatever its
 *   specifier, outside a workspace that has it: no registry has it, so the
 *   entry has to be removed. `oa-gen init` leaves such a package out, but an
 *   entry an earlier init wrote stays, and `--force` does not remove it.
 * - any other package specified with the `workspace:` protocol outside a
 *   workspace that has it: pnpm cannot resolve it there and npm rejects the
 *   protocol, so the entry has to name a registry version instead.
 *
 * A JSON value other than an object with dependency maps has no entries;
 * text that is not JSON throws.
 */
export function findUninstallableOaSdkEntries(
  packageJson: string,
  sources: OaSdkPackageSources = REGISTRY_SOURCES,
): UninstallableOaSdkEntry[] {
  const manifest = ManifestDependencies.safeParse(JSON.parse(packageJson))
  if (!manifest.success) return []
  const entries: UninstallableOaSdkEntry[] = []
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(manifest.data[section] ?? {})) {
      if (!name.startsWith('@oa-sdk/') || typeof specifier !== 'string' || sources.workspacePackages.has(name)) continue
      const resolution = isOaSdkInitPackage(name) ? resolveOaSdkPackage(name, sources) : undefined
      if (resolution !== undefined && resolution.specifier === undefined) {
        entries.push({ name, section, specifier, reason: resolution.reason, fix: { action: 'remove' } })
      } else if (specifier.startsWith('workspace:')) {
        entries.push({
          name,
          section,
          specifier,
          reason: `the workspace: protocol resolves only in a pnpm workspace that has ${name} as a member`,
          fix: { action: 'replace', replacement: resolution?.specifier ?? builtAgainstRange(name, sources.versions) },
        })
      }
    }
  }
  return entries
}

function isOaSdkInitPackage(name: string): name is OaSdkPackageName {
  return Object.hasOwn(OA_SDK_INIT_PACKAGES, name)
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
