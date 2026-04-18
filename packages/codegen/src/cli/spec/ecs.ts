export type CliEntityKind = 'command'

export type CliCheckKind =
  | 'artifact-freshness'
  | 'breaking-diff'
  | 'composition'
  | 'duplicate-review'
  | 'head-validation'
  | 'inventory'
  | 'runtime-drift'
  | 'target-coverage'

export type CliInputKind =
  | 'contract-document'
  | 'composition-report'
  | 'definition-fragments'
  | 'definition-target'
  | 'duplicate-review-report'
  | 'module-reference'
  | 'openapi-artifact'
  | 'openapi-document'
  | 'openapi-provenance'
  | 'runtime-drift-report'
  | 'runtime-openapi'

export type CliOutputFormat = 'human' | 'json' | 'markdown' | 'text'

export type CliRecommendation = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

export type CliOptionComponent = {
  name: string
  type: 'boolean' | 'string'
  required?: boolean
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
