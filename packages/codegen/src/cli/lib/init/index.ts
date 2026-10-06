import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  TARGET_PROFILES,
  getTargetProfile,
  detectTargetProfile,
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
} from './targets/index.js'
import {
  ARCHETYPE_PROFILES,
  getArchetypeProfile,
  detectArchetypeProfile,
  MvpArchetypeProfile,
  MicroserviceArchetypeProfile,
  EnterpriseArchetypeProfile,
} from './archetypes/index.js'
import {
  composeInitConfig,
  composeInitCoreConfig,
  composeInitCompanionPackages,
  composeInitScripts,
  composeInitDependencies,
  composeInitPackagePatches,
  getOutputRoutingSnippet,
  oaGenCommandsIn,
} from './composer.js'
import {
  promptTargetSelection,
  promptArchetypeSelection,
  promptRoutingSelection,
  isInteractiveSession,
} from './interactive.js'
import { detectSchemas } from './common/schema-detector.js'
import { patchPackageJson } from './common/package-patcher.js'
import { findPnpmWorkspace } from './common/pnpm-workspace.js'
import {
  CONTRACT_BASELINE_PATH,
  isContractBaselineSkip,
  isSpecDocumentPath,
  writeContractBaseline,
} from './common/contract-baseline.js'
import {
  generatedArtifactPaths,
  readExistingConfig,
  retainedSpecEntry,
} from './common/existing-config.js'
import {
  DEFAULT_SCHEMA_ENTRY,
  SCAFFOLD_OUT_DIR,
  oaGenScript,
  schemaEntryOf,
  scriptPath,
} from './common/scripts.js'
import {
  OA_SDK_INIT_PACKAGES,
  REGISTRY_OA_SDK_PACKAGES,
  REGISTRY_SOURCES,
  UNPINNED_SPECIFIER,
  WORKSPACE_SPECIFIER,
  findOaSdkPackageSources,
  findUninstallableOaSdkEntries,
  resolveOaSdkPackage,
} from './oa-sdk-packages.js'
import type {
  InitOptions,
  InitResult,
  TargetFrameworkId,
  TargetProfile,
  TargetGenerateOptions,
  DetectedSchemaItem,
  PackagePatchResult,
  LifecycleArchetypeId,
  OutputRoutingPreset,
} from './types.js'
import type { ArchetypeProfile } from './archetypes/types.js'
import type { UnavailableOaSdkPackage, UninstallableOaSdkEntry } from './oa-sdk-packages.js'

export * from './types.js'
export type { ComposedDependencies } from './composer.js'
export type { PnpmWorkspace } from './common/pnpm-workspace.js'
export type {
  ContractBaselinePlan,
  ContractBaselineResult,
  ContractBaselineSkip,
} from './common/contract-baseline.js'
export type { ExistingConfig, ExistingSpecTarget, ScriptSpecEntry } from './common/existing-config.js'
export type {
  DependencySection,
  OaSdkPackageName,
  OaSdkPackageResolution,
  OaSdkPackageSources,
  UnavailableOaSdkPackage,
  UninstallableOaSdkEntry,
} from './oa-sdk-packages.js'
export type {
  ArchetypeProfile,
  ArchetypeGenerateOptions,
  ArchetypeConfigSnippet,
  ArchetypeDetectionResult,
} from './archetypes/types.js'
export {
  TARGET_PROFILES,
  getTargetProfile,
  detectTargetProfile,
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
  ARCHETYPE_PROFILES,
  getArchetypeProfile,
  detectArchetypeProfile,
  MvpArchetypeProfile,
  MicroserviceArchetypeProfile,
  EnterpriseArchetypeProfile,
  composeInitConfig,
  composeInitCoreConfig,
  composeInitCompanionPackages,
  composeInitScripts,
  composeInitDependencies,
  composeInitPackagePatches,
  getOutputRoutingSnippet,
  oaGenCommandsIn,
  promptTargetSelection,
  promptArchetypeSelection,
  promptRoutingSelection,
  isInteractiveSession,
  detectSchemas,
  patchPackageJson,
  findPnpmWorkspace,
  CONTRACT_BASELINE_PATH,
  isContractBaselineSkip,
  isSpecDocumentPath,
  writeContractBaseline,
  generatedArtifactPaths,
  readExistingConfig,
  retainedSpecEntry,
  DEFAULT_SCHEMA_ENTRY,
  SCAFFOLD_OUT_DIR,
  oaGenScript,
  schemaEntryOf,
  scriptPath,
  OA_SDK_INIT_PACKAGES,
  REGISTRY_OA_SDK_PACKAGES,
  REGISTRY_SOURCES,
  UNPINNED_SPECIFIER,
  WORKSPACE_SPECIFIER,
  findOaSdkPackageSources,
  findUninstallableOaSdkEntries,
  resolveOaSdkPackage,
}

/**
 * Master Onboarding Engine Orchestrator
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const shouldPrompt = !options.yes && options.interactive !== false && isInteractiveSession()

  // 1. Resolve target framework profile
  let targetId: TargetFrameworkId
  let matchedProfile: TargetProfile

  if (options.target) {
    targetId = options.target.toLowerCase().trim() as TargetFrameworkId
    matchedProfile = getTargetProfile(targetId)
  } else {
    const detected = await detectTargetProfile(cwd)
    if (shouldPrompt) {
      targetId = await promptTargetSelection(detected.profile.id, detected.confidence)
      matchedProfile = getTargetProfile(targetId)
    } else {
      matchedProfile = detected.profile
      targetId = matchedProfile.id
    }
  }

  // 2. Resolve lifecycle archetype profile
  let matchedArchetype: ArchetypeProfile
  let archetypeId: LifecycleArchetypeId

  if (options.archetype) {
    matchedArchetype = getArchetypeProfile(options.archetype)
    archetypeId = matchedArchetype.id
  } else if (shouldPrompt) {
    const detectedArch = await detectArchetypeProfile(cwd)
    archetypeId = await promptArchetypeSelection(detectedArch.profile.id)
    matchedArchetype = getArchetypeProfile(archetypeId)
  } else {
    matchedArchetype = getArchetypeProfile('mvp')
    archetypeId = 'mvp'
  }

  // 2.5 Resolve output path routing preset
  let routingPreset: OutputRoutingPreset
  if (options.routing) {
    routingPreset = options.routing.toLowerCase().trim() as OutputRoutingPreset
  } else if (shouldPrompt) {
    routingPreset = await promptRoutingSelection('default')
  } else {
    routingPreset = 'default'
  }

  // 3. The project's oa.config.ts: init keeps it unless --force, and reads it either way, for the
  // spec it records and the documents `oa-gen generate` wrote for it.
  const configPath = path.join(cwd, 'oa.config.ts')
  const existingConfig = await fs.access(configPath).then(
    () => readExistingConfig(cwd, configPath),
    () => undefined,
  )
  const retainConfig = existingConfig !== undefined && !options.force

  // 4. The spec entry point of the scaffold. The scripts run beside the oa.config.ts the project
  // ends up with, so a kept one decides it; a new one records the given, detected or default spec.
  let primarySchema: DetectedSchemaItem | undefined
  let specEntryUnavailable: string | undefined

  if (retainConfig) {
    const specEntry = retainedSpecEntry(existingConfig, cwd, options.spec)
    if ('schema' in specEntry) primarySchema = specEntry.schema
    else specEntryUnavailable = specEntry.unavailable
  } else if (options.spec) {
    primarySchema = {
      type: 'openapi-yaml',
      kind: 'openapi-yaml',
      filePath: options.spec,
      path: path.resolve(cwd, options.spec),
      relativePath: options.spec,
      confidence: 1.0,
      score: 100,
      description: `Explicitly provided specification: ${options.spec}`,
    }
  } else {
    const detectedList = await detectSchemas(cwd, { generatedPaths: generatedArtifactPaths(existingConfig) })
    primarySchema = detectedList[0] ?? {
      type: 'openapi-yaml',
      kind: 'openapi-yaml',
      filePath: DEFAULT_SCHEMA_ENTRY,
      path: path.resolve(cwd, DEFAULT_SCHEMA_ENTRY),
      relativePath: DEFAULT_SCHEMA_ENTRY,
      confidence: 0.5,
      score: 50,
      description: 'Default suggested OpenAPI YAML specification',
    }
  }

  const targetGenOptions: TargetGenerateOptions = {
    cwd,
    frameworkId: targetId,
    runtime: matchedProfile.defaultRuntime,
    detectedSchema: primarySchema,
    specEntryUnavailable,
    routing: routingPreset,
    oaSdkSources: await findOaSdkPackageSources(cwd),
  }

  // 5. Generate oa.config.ts content via composer
  let configFileCreated = false
  if (!options.dryRun && !retainConfig) {
    await fs.writeFile(configPath, composeInitConfig(matchedProfile, matchedArchetype, targetGenOptions), 'utf-8')
    configFileCreated = true
  }

  // 6. Non-destructively patch package.json if present
  let patchResult: PackagePatchResult | undefined
  let unavailablePackages: UnavailableOaSdkPackage[] | undefined
  let uninstallableEntries: UninstallableOaSdkEntry[] | undefined
  const pkgPath = path.join(cwd, 'package.json')
  let packageJsonPatched = false

  try {
    const pkgRaw = await fs.readFile(pkgPath, 'utf-8')
    const patches = composeInitPackagePatches(matchedProfile, matchedArchetype, targetGenOptions)

    patchResult = patchPackageJson(pkgRaw, {
      scripts: patches.scripts,
      dependencies: patches.dependencies,
      devDependencies: patches.devDependencies,
      force: options.force,
    })
    unavailablePackages = patches.unavailable
    // Entries the patch keeps (existing ones, without --force) or never touches (packages init
    // no longer writes) can still be ones the project cannot install where it lives.
    uninstallableEntries = findUninstallableOaSdkEntries(patchResult.patchedContent, targetGenOptions.oaSdkSources)

    if (!options.dryRun && patchResult.modified) {
      await fs.writeFile(pkgPath, patchResult.patchedContent, 'utf-8')
      packageJsonPatched = true
    }
  } catch {
    // package.json does not exist or unreadable, skip patch
  }

  // 7. Create the contract baseline the archetype's scripts compare the spec with, unless the
  // project has one: it records a release, so only the project moves it (its baseline:update script).
  const baselinePlan = matchedArchetype.getContractBaseline?.({ ...targetGenOptions, archetypeId })
  const contractBaseline = baselinePlan === undefined || isContractBaselineSkip(baselinePlan)
    ? baselinePlan
    : await writeContractBaseline(cwd, baselinePlan, { dryRun: options.dryRun })

  return {
    targetId,
    archetypeId,
    routing: routingPreset,
    runtime: matchedProfile.defaultRuntime,
    configPath,
    patchResult,
    detectedSchema: primarySchema,
    configFileCreated,
    packageJsonPatched,
    packageJsonPath: pkgPath,
    unavailablePackages,
    uninstallableEntries,
    contractBaseline,
    dryRun: options.dryRun ?? false,
  }
}
