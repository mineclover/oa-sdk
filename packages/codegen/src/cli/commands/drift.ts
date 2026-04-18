import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type DriftOutputFormat = 'json' | 'markdown' | 'text'

const driftSpec = commandById(oaGenGovernanceManifest, 'drift')

export const drift: Command = {
  name: driftSpec.name,
  description: driftSpec.summary,
  options: {
    'runtime-openapi': {
      type: 'string',
      required: true,
      description: optionDescription(driftSpec, 'runtime-openapi'),
    },
    'managed-openapi': {
      type: 'string',
      required: true,
      description: optionDescription(driftSpec, 'managed-openapi'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(driftSpec, 'format'),
    },
  },
  async run(args) {
    const runtime = loadSpecWithPath(str(args, 'runtime-openapi'))
    const managed = loadSpecWithPath(str(args, 'managed-openapi'))
    const issues = diffOpenApiDocuments(managed.document, runtime.document)
    const payload = {
      drift: issues.length > 0,
      runtime: runtime.path,
      managed: managed.path,
      issues,
    }
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      console.log(JSON.stringify(payload, null, 2))
    } else if (format === 'markdown') {
      console.log(driftMarkdown(issues))
    } else if (issues.length === 0) {
      console.log('No OpenAPI runtime drift detected.')
    } else {
      for (const issue of issues) {
        console.log(`${issue.kind} ${issue.pointer} - ${issue.message}`)
      }
    }

    if (issues.length > 0) process.exit(1)
  },
}

function readFormat(format: string | undefined): DriftOutputFormat {
  if (format === undefined) return 'text'
  if (format === 'json' || format === 'markdown' || format === 'text') return format
  throw new Error(`unsupported drift format: ${format}`)
}

function driftMarkdown(issues: OpenApiNormalizedDiffEntry[]): string {
  if (issues.length === 0) return '## OpenAPI Runtime Drift\n\nNo OpenAPI runtime drift detected.'
  return [
    '## OpenAPI Runtime Drift',
    '',
    '| Kind | Pointer | Detail |',
    '| --- | --- | --- |',
    ...issues.map(issue => (
      `| ${cell(issue.kind)} | ${cell(issue.pointer)} | ${cell(issue.message)} |`
    )),
  ].join('\n')
}

function cell(value: unknown): string {
  return String(value).replace(/\n/g, ' ').replace(/\|/g, '\\|')
}
