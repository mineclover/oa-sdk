/**
 * check-cli-spec.ts
 *
 * Validates the language-neutral CLI ECS manifest and checks it has not drifted
 * from the typed oa-gen governance manifest used by the TS CLI implementation.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { commands as oaGenCommands } from '../packages/codegen/src/cli/commands.js'
import { oaGenGovernanceManifest } from '../packages/codegen/src/cli/spec/oa-gen-governance.js'
import { OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1 } from '../packages/codegen/src/cli/lib/artifact-compatibility-policy.js'
import { REF_PROJECTION_ARTIFACT_SCHEMA_V1 } from '../packages/codegen/src/cli/lib/ref-projection-artifact-schema.js'
import type { Command } from '../packages/codegen/src/cli/lib/types.js'

type CliCommandManifest = {
  version: 1
  namespace: string
  commands: CliCommandEntity[]
}

type CliCommandEntity = {
  id: string
  kind: 'command'
  name: string
  summary: string
  components: {
    options: CliOptionComponent[]
    inputs: CliInputComponent[]
    checks: string[]
    reports: Array<{ formats: string[]; schema: string }>
    exitPolicy: { success: string[]; failure: string[] }
  }
}

type CliOptionComponent = {
  name: string
  type: string
  required?: boolean
  multiple?: boolean
  short?: string
  positional?: boolean
  position?: number
  description: string
}

type CliInputComponent = {
  name: string
  kind: string
  required: boolean
  option?: string
}

const root = resolve(process.cwd())
const schemaPath = join(root, 'docs/cli-spec/cli-command.schema.json')
const artifactCompatibilityPolicyPath = join(root, 'docs/cli-spec/oa-sdk-artifact-compatibility-policy.v1.json')
// JSON Schemas of artifacts that oa-gen emits, mirrored for non-TypeScript readers.
const artifactSchemaMirrors = [
  {
    docsPath: join(root, 'docs/cli-spec/oa-sdk.ref-projection.v1.schema.json'),
    schema: REF_PROJECTION_ARTIFACT_SCHEMA_V1,
    label: 'REF_PROJECTION_ARTIFACT_SCHEMA_V1',
  },
] as const
const manifestSpecs = [
  {
    label: 'oa-gen',
    docsPath: join(root, 'docs/cli-spec/oa-gen.governance.json'),
    mirror: oaGenGovernanceManifest,
    mirrorLabel: 'oaGenGovernanceManifest',
  },
  {
    label: 'oa-contract',
    docsPath: join(root, 'docs/cli-spec/oa-contract.governance.json'),
    mirrorPath: join(
      root,
      'templates/python-interface-monorepo/packages/interface-cli/src/oa_interface_cli/cli_spec.json',
    ),
    mirrorLabel: 'oa_interface_cli/cli_spec.json',
  },
] as const

const undocumentedOaGenCommands = new Set([
  'init',
  'generate',
  'typegen',
  'lint',
  'audit:csp',
  'drift:check',
  'drift:live',
  'mock',
  'tsp diff',
  'tsp-diff',
  'tsp-scaffold',
  'generate-zod',
  'generate:zod',
  'generate:guards',
  'generate:drizzle',
  'generate:client',
  'client',
  'pack:client',
  'pack-client',
  'audit:shape',
])

const universalGlobalOptions = new Set([
  'root',
  'project-root',
])

const allowedUndocumentedOptions = new Map<string, Set<string>>([
  ['validate', new Set(['profile', 'config'])],
])


function main(): void {
  const issues: string[] = []
  if (!existsSync(schemaPath)) {
    issues.push(`missing schema: ${relative(root, schemaPath)}`)
  }

  let commandCount = 0
  for (const spec of manifestSpecs) {
    if (!existsSync(spec.docsPath)) {
      issues.push(`${spec.label}: missing manifest: ${relative(root, spec.docsPath)}`)
      continue
    }

    const manifest = readJson(spec.docsPath)
    validateManifest(manifest, issues)
    commandCount += manifest.commands.length

    const mirror = 'mirror' in spec ? spec.mirror : readMirror(spec.mirrorPath)
    if (stableJson(manifest) !== stableJson(mirror)) {
      issues.push(
        `${relative(root, spec.docsPath)} drifted from ${spec.mirrorLabel}`,
      )
    }
    if (spec.label === 'oa-gen') compareTsCommandImplementation(manifest, oaGenCommands, issues)
  }

  if (!existsSync(artifactCompatibilityPolicyPath)) {
    issues.push(`missing artifact compatibility policy: ${relative(root, artifactCompatibilityPolicyPath)}`)
  } else if (stableJson(readAnyJson(artifactCompatibilityPolicyPath)) !== stableJson(OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1)) {
    issues.push(`${relative(root, artifactCompatibilityPolicyPath)} drifted from OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1`)
  }

  for (const mirror of artifactSchemaMirrors) {
    if (!existsSync(mirror.docsPath)) {
      issues.push(`missing artifact schema: ${relative(root, mirror.docsPath)}`)
    } else if (stableJson(readAnyJson(mirror.docsPath)) !== stableJson(mirror.schema)) {
      issues.push(`${relative(root, mirror.docsPath)} drifted from ${mirror.label}`)
    }
  }

  if (issues.length > 0) {
    console.error('CLI spec check failed:\n')
    for (const issue of issues) console.error(`- ${issue}`)
    process.exit(1)
  }

  console.log(`CLI spec OK: ${manifestSpecs.length} manifests, ${commandCount} command entities.`)
}

function compareTsCommandImplementation(
  manifest: CliCommandManifest,
  commands: Command[],
  issues: string[],
): void {
  const commandByName = new Map(commands.map(command => [command.name, command]))
  const manifestCommandNames = new Set(manifest.commands.map(command => command.name))
  for (const manifestCommand of manifest.commands) {
    const implementation = commandByName.get(manifestCommand.name)
    if (!implementation) {
      issues.push(`oa-gen:${manifestCommand.name}: command is missing from TS implementation`)
      continue
    }
    const manifestOptions = new Map(manifestCommand.components.options.map(option => [option.name, option]))
    const implementationOptions = new Map(Object.entries(implementation.options))

    for (const optionName of manifestOptions.keys()) {
      const manifestOption = manifestOptions.get(optionName)!
      const implementationOption = implementationOptions.get(optionName)
      if (!implementationOption) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} is missing from TS implementation`)
        continue
      }
      if (implementationOption.type !== manifestOption.type) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} type drift`)
      }
      if (Boolean(implementationOption.required) !== Boolean(manifestOption.required)) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} required drift`)
      }
      if (implementationOption.multiple !== manifestOption.multiple) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} multiple drift`)
      }
      if (implementationOption.short !== manifestOption.short) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} short flag drift`)
      }
      if (implementationOption.description !== manifestOption.description) {
        issues.push(`oa-gen:${manifestCommand.name}: option ${optionName} description drift`)
      }
    }

    for (const optionName of implementationOptions.keys()) {
      if (manifestOptions.has(optionName)) continue

      if (universalGlobalOptions.has(optionName)) {
        const globalOpt = implementationOptions.get(optionName)!
        if (globalOpt.type !== 'string') {
          issues.push(`oa-gen:${manifestCommand.name}: global option ${optionName} type must be string`)
        }
        if (globalOpt.required) {
          issues.push(`oa-gen:${manifestCommand.name}: global option ${optionName} must not be required`)
        }
        continue
      }

      if (allowedUndocumentedOptions.get(manifestCommand.name)?.has(optionName)) continue

      issues.push(`oa-gen:${manifestCommand.name}: TS implementation has undocumented option ${optionName}`)
    }
  }


  for (const implementationName of commandByName.keys()) {
    if (manifestCommandNames.has(implementationName)) continue
    if (undocumentedOaGenCommands.has(implementationName)) continue
    issues.push(`oa-gen:${implementationName}: command is missing from governance manifest`)
  }
}

function readJson(filePath: string): CliCommandManifest {
  return JSON.parse(readFileSync(filePath, 'utf8')) as CliCommandManifest
}

function readMirror(filePath: string): CliCommandManifest {
  if (!existsSync(filePath)) {
    throw new Error(`missing mirror manifest: ${relative(root, filePath)}`)
  }
  return readJson(filePath)
}

function readAnyJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function validateManifest(manifest: CliCommandManifest, issues: string[]): void {
  if (manifest.version !== 1) issues.push('manifest.version must be 1')
  if (!nonEmptyString(manifest.namespace)) issues.push('manifest.namespace is required')
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    issues.push('manifest.commands must be a non-empty array')
    return
  }

  const ids = new Set<string>()
  for (const command of manifest.commands) {
    const label = command.id || '<missing-id>'
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(command.id)) {
      issues.push(`${label}: command id must be kebab-case`)
    }
    if (ids.has(command.id)) issues.push(`${label}: duplicate command id`)
    ids.add(command.id)
    if (command.kind !== 'command') issues.push(`${label}: kind must be "command"`)
    if (!nonEmptyString(command.name)) issues.push(`${label}: name is required`)
    if (!nonEmptyString(command.summary)) issues.push(`${label}: summary is required`)

    const optionNames = new Set<string>()
    const positionalIndexes = new Set<number>()
    for (const option of command.components.options) {
      if (!nonEmptyString(option.name)) issues.push(`${label}: option name is required`)
      if (optionNames.has(option.name)) issues.push(`${label}: duplicate option ${option.name}`)
      optionNames.add(option.name)
      if (option.type !== 'string' && option.type !== 'boolean') {
        issues.push(`${label}: option ${option.name} has invalid type`)
      }
      if (!nonEmptyString(option.description)) {
        issues.push(`${label}: option ${option.name} description is required`)
      }
      if (option.positional) {
        if (option.short) issues.push(`${label}: positional option ${option.name} must not have short flag`)
        if (option.position === undefined) {
          issues.push(`${label}: positional option ${option.name} must declare position`)
        } else if (positionalIndexes.has(option.position)) {
          issues.push(`${label}: duplicate positional index ${option.position}`)
        } else {
          positionalIndexes.add(option.position)
        }
      }
    }

    for (const input of command.components.inputs) {
      if (input.option && !optionNames.has(input.option)) {
        issues.push(`${label}: input ${input.name} references missing option ${input.option}`)
      }
    }

    const success = new Set(command.components.exitPolicy.success)
    const failure = new Set(command.components.exitPolicy.failure)
    for (const recommendation of success) {
      if (failure.has(recommendation)) {
        issues.push(`${label}: exitPolicy recommendation ${recommendation} is both success and failure`)
      }
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  )
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

main()
