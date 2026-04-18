import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import { parse as parseYaml } from 'yaml'
import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type DriftOutputFormat = 'json' | 'markdown' | 'text'

const driftSpec = commandById(oaGenGovernanceManifest, 'drift')

export type RuntimeFetchInfo = {
  url: string
  redirected?: boolean
  finalUrl?: string
  status?: number
  statusText?: string
  contentType?: string
  error?: string
}

export type DriftFailure = {
  code: 'drift-check-failed'
  message: string
}

export type RuntimeOpenApiFetch = typeof fetch

export const drift: Command = {
  name: driftSpec.name,
  description: driftSpec.summary,
  options: {
    'runtime-openapi': {
      type: 'string',
      description: optionDescription(driftSpec, 'runtime-openapi'),
    },
    'runtime-openapi-url': {
      type: 'string',
      description: optionDescription(driftSpec, 'runtime-openapi-url'),
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
    const managed = loadSpecWithPath(str(args, 'managed-openapi'))
    const runtimeInput: { runtimePath?: string; runtimeUrl?: string } = {}
    const runtimePath = optStr(args, 'runtime-openapi')
    const runtimeUrl = optStr(args, 'runtime-openapi-url')
    if (runtimePath !== undefined) runtimeInput.runtimePath = runtimePath
    if (runtimeUrl !== undefined) runtimeInput.runtimeUrl = runtimeUrl
    const runtime = await loadRuntimeOpenApi(runtimeInput)
    const format = readFormat(optStr(args, 'format'))

    if ('failure' in runtime) {
      const payload = {
        drift: true,
        status: 'drift-check-failed',
        runtime: runtime.source,
        managed: managed.path,
        issues: [],
        failure: runtime.failure,
        ...(runtime.fetch ? { runtimeFetch: runtime.fetch } : {}),
      }
      writeDriftFailure(payload, format)
      process.exit(1)
    }

    const issues = diffOpenApiDocuments(managed.document, runtime.document)
    const payload = {
      drift: issues.length > 0,
      status: 'ok',
      runtime: runtime.path,
      managed: managed.path,
      issues,
      ...(runtime.fetch ? { runtimeFetch: runtime.fetch } : {}),
    }

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

async function loadRuntimeOpenApi(options: {
  runtimePath?: string
  runtimeUrl?: string
}): Promise<
  | { document: Record<string, unknown>; path: string; source: string; fetch?: RuntimeFetchInfo }
  | { source: string; failure: DriftFailure; fetch?: RuntimeFetchInfo }
> {
  if (options.runtimePath && options.runtimeUrl) {
    throw new Error('use only one of --runtime-openapi or --runtime-openapi-url')
  }
  if (!options.runtimePath && !options.runtimeUrl) {
    throw new Error('missing required runtime input: --runtime-openapi or --runtime-openapi-url')
  }
  if (options.runtimePath) {
    const loaded = loadSpecWithPath(options.runtimePath)
    return {
      document: loaded.document,
      path: loaded.path,
      source: loaded.path,
    }
  }

  return fetchRuntimeOpenApi(options.runtimeUrl!)
}

export async function fetchRuntimeOpenApi(
  url: string,
  fetcher: RuntimeOpenApiFetch = fetch,
): Promise<
  | { document: Record<string, unknown>; path: string; source: string; fetch: RuntimeFetchInfo }
  | { source: string; failure: DriftFailure; fetch: RuntimeFetchInfo }
> {
  const fetchInfo: RuntimeFetchInfo = { url }
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json, application/yaml, text/yaml, */*' },
    })
    fetchInfo.redirected = response.redirected
    fetchInfo.finalUrl = response.url
    fetchInfo.status = response.status
    fetchInfo.statusText = response.statusText
    const contentType = response.headers.get('content-type')
    if (contentType !== null) fetchInfo.contentType = contentType

    if (!response.ok) {
      return failedRuntimeFetch(
        url,
        fetchInfo,
        `runtime OpenAPI URL returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      )
    }

    const raw = await response.text()
    try {
      const document = parseRuntimeOpenApi(raw, fetchInfo.contentType, response.url)
      return {
        document,
        path: response.url,
        source: url,
        fetch: fetchInfo,
      }
    } catch (error) {
      return failedRuntimeFetch(
        url,
        fetchInfo,
        `runtime OpenAPI URL response could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } catch (error) {
    fetchInfo.error = error instanceof Error ? error.message : String(error)
    return failedRuntimeFetch(url, fetchInfo, `runtime OpenAPI URL fetch failed: ${fetchInfo.error}`)
  }
}

function failedRuntimeFetch(
  url: string,
  fetchInfo: RuntimeFetchInfo,
  message: string,
): { source: string; failure: DriftFailure; fetch: RuntimeFetchInfo } {
  return {
    source: url,
    failure: {
      code: 'drift-check-failed',
      message,
    },
    fetch: fetchInfo,
  }
}

function parseRuntimeOpenApi(raw: string, contentType: string | undefined, url: string): Record<string, unknown> {
  const parsed = shouldParseJson(contentType, url) ? JSON.parse(raw) : parseYaml(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('runtime OpenAPI document must be an object')
  }
  return parsed as Record<string, unknown>
}

function shouldParseJson(contentType: string | undefined, url: string): boolean {
  return contentType?.includes('json') === true || /\.json(?:[?#]|$)/.test(url)
}

function writeDriftFailure(
  payload: {
    failure: DriftFailure
    runtimeFetch?: RuntimeFetchInfo
  },
  format: DriftOutputFormat,
): void {
  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (format === 'markdown') {
    console.log([
      '## OpenAPI Runtime Drift',
      '',
      `**${payload.failure.code}**: ${payload.failure.message}`,
      ...(payload.runtimeFetch
        ? [
            '',
            `- URL: ${payload.runtimeFetch.url}`,
            `- Final URL: ${payload.runtimeFetch.finalUrl ?? 'n/a'}`,
            `- HTTP status: ${payload.runtimeFetch.status ?? 'n/a'}`,
            `- Redirected: ${payload.runtimeFetch.redirected ?? 'n/a'}`,
          ]
        : []),
    ].join('\n'))
    return
  }
  console.log(`${payload.failure.code} - ${payload.failure.message}`)
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
