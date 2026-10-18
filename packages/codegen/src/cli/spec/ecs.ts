export type CliEntityKind = 'command'

/** Check kinds a command may declare; `docs/cli-spec/cli-command.schema.json` mirrors this list (enforced by `check:cli-spec`). */
export const CLI_CHECK_KINDS = [
  'artifact-freshness',
  'behavior-query',
  'breaking-diff',
  'composition',
  'duplicate-review',
  'head-validation',
  'inventory',
  'metadata-registry',
  'parallel-evidence',
  'parallel-evidence-metrics',
  'runtime-drift',
  'target-coverage',
  'typespec-bundle-check',
  'typespec-sidecar-restore',
  'typespec-sidecar-stability',
] as const

export type CliCheckKind = (typeof CLI_CHECK_KINDS)[number]

/** Input kinds a command may declare; `docs/cli-spec/cli-command.schema.json` mirrors this list (enforced by `check:cli-spec`). */
export const CLI_INPUT_KINDS = [
  'behavior-store',
  'composition-report',
  'contract-document',
  'definition-fragments',
  'definition-target',
  'duplicate-review-report',
  'metadata-registry-report',
  'module-reference',
  'openapi-artifact',
  'openapi-document',
  'openapi-provenance',
  'parallel-evidence-metrics',
  'runtime-drift-report',
  'runtime-openapi',
  'ttsc-provenance',
  'typespec-bundle-manifest',
  'typespec-compatibility-sidecar',
  'typespec-document',
  'typespec-project',
  'typespec-provenance',
] as const

export type CliInputKind = (typeof CLI_INPUT_KINDS)[number]

export type CliOutputFormat = 'human' | 'json' | 'markdown' | 'text'

export type CliRecommendation = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

export type CliOptionComponent = {
  name: string
  type: 'boolean' | 'string'
  required?: boolean
  multiple?: boolean
  short?: string
  positional?: boolean
  position?: number
  description: string
}

export type CliInputComponent = {
  name: string
  kind: CliInputKind
  required: boolean
  option?: string
}

export type CliReportComponent = {
  formats: CliOutputFormat[]
  schema: string
}

export type CliExitPolicyComponent = {
  success: CliRecommendation[]
  failure: CliRecommendation[]
}

export type CliCommandEntity = {
  id: string
  kind: CliEntityKind
  name: string
  summary: string
  components: {
    options: CliOptionComponent[]
    inputs: CliInputComponent[]
    checks: CliCheckKind[]
    reports: CliReportComponent[]
    exitPolicy: CliExitPolicyComponent
  }
}

export type CliCommandManifest = {
  version: 1
  namespace: string
  commands: CliCommandEntity[]
}

export function commandById(
  manifest: CliCommandManifest,
  id: string,
): CliCommandEntity {
  const command = manifest.commands.find(item => item.id === id)
  if (!command) throw new Error(`Missing CLI command spec: ${id}`)
  return command
}

export function optionDescription(
  command: CliCommandEntity,
  name: string,
): string {
  const option = command.components.options.find(item => item.name === name)
  if (!option) throw new Error(`Missing option ${name} in CLI command spec ${command.id}`)
  return option.description
}
