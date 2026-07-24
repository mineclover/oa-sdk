/**
 * Validate the repository's documentation/spec governance loader.
 *
 * The loader is intentionally small, but its paths are operational inputs for
 * agents and maintainers. Catching stale paths here prevents the declared
 * reading order from silently becoming fiction.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import YAML from 'yaml'

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStrings(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    issues.push(`${label} must be an array of strings`)
    return []
  }
  return value as string[]
}

const root = resolve(process.cwd())
const loaderPath = resolve(root, '.ai/spec-loader.yaml')
const issues: string[] = []

if (!existsSync(loaderPath)) {
  issues.push('.ai/spec-loader.yaml is missing')
} else {
  let document: unknown
  try {
    document = YAML.parse(readFileSync(loaderPath, 'utf8'))
  } catch (error) {
    issues.push(`cannot parse .ai/spec-loader.yaml: ${error instanceof Error ? error.message : String(error)}`)
    document = undefined
  }

  if (!isRecord(document)) {
    issues.push('.ai/spec-loader.yaml must contain a mapping')
  } else {
    if (document.schemaVersion !== 'oa-sdk.spec-loader.v1') {
      issues.push('schemaVersion must be oa-sdk.spec-loader.v1')
    }

    const governance = document.governance
    if (!isRecord(governance)) {
      issues.push('governance must be a mapping')
    } else {
      const governanceRoot = governance.root
      const entrypoint = governance.entrypoint
      if (typeof governanceRoot !== 'string') issues.push('governance.root must be a string')
      if (typeof entrypoint !== 'string') issues.push('governance.entrypoint must be a string')

      const required = asStrings(governance.required, 'governance.required', issues)
      if (typeof entrypoint === 'string' && !required.includes(entrypoint)) {
        issues.push('governance.required must include governance.entrypoint')
      }
    }

    const sourceOfTruth = isRecord(document.sourceOfTruth) ? document.sourceOfTruth : undefined
    if (!sourceOfTruth) issues.push('sourceOfTruth must be a mapping')

    const conditional = isRecord(document.conditional) ? document.conditional : undefined
    if (!conditional) issues.push('conditional must be a mapping')

    const declaredPaths: string[] = []
    if (isRecord(governance)) {
      if (typeof governance.root === 'string') declaredPaths.push(governance.root)
      if (typeof governance.entrypoint === 'string') declaredPaths.push(governance.entrypoint)
      declaredPaths.push(...asStrings(governance.required, 'governance.required', issues))
    }
    if (sourceOfTruth) {
      for (const [key, value] of Object.entries(sourceOfTruth)) {
        if (typeof value !== 'string') issues.push(`sourceOfTruth.${key} must be a string`)
        else declaredPaths.push(value)
      }
    }
    if (conditional) {
      for (const [key, value] of Object.entries(conditional)) {
        declaredPaths.push(...asStrings(value, `conditional.${key}`, issues))
      }
    }
    if (typeof document.changeProcedure !== 'string') {
      issues.push('changeProcedure must be a string')
    } else {
      declaredPaths.push(document.changeProcedure)
    }

    for (const declared of declaredPaths) {
      const base = declared.split('*', 1)[0].replace(/\/$/, '')
      if (!base || !existsSync(resolve(root, base))) {
        issues.push(`loader path does not exist: ${declared}`)
      }
    }
  }
}

if (issues.length > 0) {
  console.error('Spec governance check failed:\n')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exitCode = 1
} else {
  console.log('Spec governance OK: loader schema and declared paths are valid.')
}
