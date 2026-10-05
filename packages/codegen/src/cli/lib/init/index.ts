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

export * from './types.js'
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

  // 3. Discover schema files across directory tree
  const detectedList = await detectSchemas(cwd)
  let primarySchema: DetectedSchemaItem | undefined

  if (options.spec) {
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
  } else if (detectedList.length > 0) {
    primarySchema = detectedList[0]
  } else {
    primarySchema = {
      type: 'openapi-yaml',
      kind: 'openapi-yaml',
      filePath: 'openapi.yaml',
      path: path.resolve(cwd, 'openapi.yaml'),
      relativePath: 'openapi.yaml',
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
    routing: routingPreset,
  }

  // 4. Generate oa.config.ts content via composer
  const configContent = composeInitConfig(matchedProfile, matchedArchetype, targetGenOptions)

  const configPath = path.join(cwd, 'oa.config.ts')
  let configFileCreated = false

  if (!options.dryRun) {
    const configExists = await fs.access(configPath).then(() => true).catch(() => false)
    if (!configExists || options.force) {
      await fs.writeFile(configPath, configContent, 'utf-8')
      configFileCreated = true
    }
  }

  // 5. Non-destructively patch package.json if present
  let patchResult: PackagePatchResult | undefined
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

    if (!options.dryRun && patchResult.modified) {
      await fs.writeFile(pkgPath, patchResult.patchedContent, 'utf-8')
      packageJsonPatched = true
    }
  } catch {
    // package.json does not exist or unreadable, skip patch
  }

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
    dryRun: options.dryRun ?? false,
  }
}
