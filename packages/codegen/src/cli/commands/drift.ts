import { resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, optStrArray, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { parse as parseYaml } from 'yaml'
import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'
import {
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../lib/behavior-recorder.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type DriftOutputFormat = 'json' | 'markdown' | 'text'

const driftSpec = commandById(oaGenGovernanceManifest, 'drift')

export type RuntimeFetchInfo = {
  url: string
  requestHeaders?: string[]
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
export type RuntimeHeaderInput = {
  name: string
  value: string
}

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
    'runtime-header': {
      type: 'string',
      multiple: true,
      description: optionDescription(driftSpec, 'runtime-header'),
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
    'behavior-log': {
      type: 'string',
      description: 'append-only behavior JSONL 출력 파일 경로',
    },
    'behavior-db': {
      type: 'string',
      description: 'append-only behavior SQLite DB 파일 경로',
    },
  },
  async run(args) {
    // File arguments are resolved once, against the same directory loadSpecWithPath reads from,
    // and every behavior record and report uses these values. A relative argument and the
    // absolute path of the same file therefore produce the same input, target and identity.
    const managedPath = resolve(str(args, 'managed-openapi'))
    const managed = loadSpecWithPath(managedPath)
    const runtimeInput: { runtimePath?: string; runtimeUrl?: string } = {}
    const runtimePathArg = optStr(args, 'runtime-openapi')
    const runtimePath = runtimePathArg === undefined ? undefined : resolve(runtimePathArg)
    const runtimeUrl = optStr(args, 'runtime-openapi-url')
    if (runtimePath !== undefined) runtimeInput.runtimePath = runtimePath
    if (runtimeUrl !== undefined) runtimeInput.runtimeUrl = runtimeUrl
    const runtimeHeaders = parseRuntimeHeaders(optStrArray(args, 'runtime-header'))
    const behaviorInput = {
      ...(runtimePath !== undefined ? { runtimePath } : {}),
      ...(runtimeUrl !== undefined ? { runtimeUrl } : {}),
      managedPath,
      ...(runtimeHeaders.length > 0 ? { runtimeHeaders: runtimeHeaders.map(header => header.name) } : {}),
    }
    const format = readFormat(optStr(args, 'format'))
    const behaviorLogPath = optStr(args, 'behavior-log')
    const behaviorDbPath = optStr(args, 'behavior-db')
    const behaviorRecorder = createBehaviorRecorderFromOptions({
      ...(behaviorLogPath !== undefined ? { jsonlPath: behaviorLogPath } : {}),
      ...(behaviorDbPath !== undefined ? { sqlitePath: behaviorDbPath } : {}),
    })
    const startedAt = Date.now()

    try {
      const runtime = await loadRuntimeOpenApi(runtimeInput, {
        headers: runtimeHeaders,
      })

      if ('failure' in runtime) {
        const targetKey = `${managedPath}|${runtime.source}`
        const payload = {
          drift: true,
          status: 'drift-check-failed',
          runtime: runtime.source,
          managed: managedPath,
          issues: [],
          failure: runtime.failure,
          ...(runtime.fetch ? { runtimeFetch: runtime.fetch } : {}),
        }
        await behaviorRecorder.record(createBehaviorRecord({
          behaviorType: 'sync_runtime_openapi',
          status: 'failed',
          components: {
            actor: {
              actorType: 'system',
              actorId: 'oa-gen',
            },
            target: {
              targetType: 'runtime-openapi',
              targetKey,
              managedPath,
              runtimeSource: runtime.source,
            },
            input: behaviorInput,
            context: {
              command: 'drift',
              source: 'cli',
            },
            decision: {
              primarySignal: 'fetch-failure',
              decisionReason: 'runtime OpenAPI could not be fetched or parsed',
            },
            result: {
              drift: true,
              status: 'drift-check-failed',
              failureCode: runtime.failure.code,
              failureMessage: runtime.failure.message,
            },
            audit: {
              cwd: process.cwd(),
              pid: process.pid,
            },
            metrics: {
              durationMs: Date.now() - startedAt,
            },
          },
        }))
        writeDriftFailure(payload, format)
        behaviorRecorder.close?.()
        throw new CliExitError(1)
      }

      const issues = diffOpenApiDocuments(managed.document, runtime.document)
      const payload = {
        drift: issues.length > 0,
        status: 'ok',
        runtime: runtime.path,
        managed: managedPath,
        issues,
        ...(runtime.fetch ? { runtimeFetch: runtime.fetch } : {}),
      }
      const targetKey = `${managedPath}|${runtime.path}`

      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'sync_runtime_openapi',
        status: issues.length > 0 ? 'failed' : 'succeeded',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'runtime-openapi',
            targetKey,
            managedPath,
            runtimePath: runtime.path,
          },
          input: behaviorInput,
          context: {
            command: 'drift',
            source: 'cli',
          },
          decision: {
            primarySignal: issues.length > 0 ? 'drift-detected' : 'no-drift',
            decisionReason: issues.length > 0
              ? 'managed and runtime OpenAPI documents differ'
              : 'managed and runtime OpenAPI documents match',
          },
          result: {
            drift: issues.length > 0,
            status: 'ok',
            issueCount: issues.length,
            issueKinds: issues.map(issue => issue.kind),
          },
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))

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

      behaviorRecorder.close?.()
      if (issues.length > 0) throw new CliExitError(1)
    } catch (error) {
      if (error instanceof CliExitError) throw error
      const targetKey = `${managedPath}|${runtimePath ?? runtimeUrl ?? 'unknown-runtime'}`
      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'sync_runtime_openapi',
        status: 'failed',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'runtime-openapi',
            targetKey,
            managedPath,
            ...(runtimePath !== undefined ? { runtimePath } : {}),
            ...(runtimeUrl !== undefined ? { runtimeSource: runtimeUrl } : {}),
          },
          input: behaviorInput,
          context: {
            command: 'drift',
            source: 'cli',
          },
          decision: {
            primarySignal: 'runtime-error',
            decisionReason: 'drift command raised an exception before producing a diff report',
          },
          result: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))
      behaviorRecorder.close?.()
      throw error
    }
  },
}

export const driftLive: Command = {
  ...drift,
  name: 'drift:live',
  description: 'Live runtime HTTP endpoint OpenAPI drift check against managed OpenAPI spec',
}

async function loadRuntimeOpenApi(
  options: {
    runtimePath?: string
    runtimeUrl?: string
  },
  fetchOptions: {
    headers?: readonly RuntimeHeaderInput[]
  } = {},
): Promise<
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

  return fetchRuntimeOpenApi(options.runtimeUrl!, fetch, fetchOptions)
}

export async function fetchRuntimeOpenApi(
  url: string,
  fetcher: RuntimeOpenApiFetch = fetch,
  options: {
    headers?: readonly RuntimeHeaderInput[]
  } = {},
): Promise<
  | { document: Record<string, unknown>; path: string; source: string; fetch: RuntimeFetchInfo }
  | { source: string; failure: DriftFailure; fetch: RuntimeFetchInfo }
> {
  const fetchInfo: RuntimeFetchInfo = { url }
  if (options.headers !== undefined && options.headers.length > 0) {
    fetchInfo.requestHeaders = options.headers.map(header => header.name.toLowerCase()).sort()
  }
  try {
    const requestHeaders = new Headers({ accept: 'application/json, application/yaml, text/yaml, */*' })
    for (const header of options.headers ?? []) requestHeaders.set(header.name, header.value)
    const response = await fetcher(url, {
      headers: requestHeaders,
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

function parseRuntimeHeaders(values: readonly string[]): RuntimeHeaderInput[] {
  return values.map(parseRuntimeHeader)
}

function parseRuntimeHeader(value: string): RuntimeHeaderInput {
  const separator = value.indexOf(':')
  if (separator <= 0) {
    throw new Error(`invalid --runtime-header value: ${value}. Expected "Header-Name: value".`)
  }
  const name = value.slice(0, separator).trim()
  const headerValue = value.slice(separator + 1).trim()
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new Error(`invalid --runtime-header name: ${name}`)
  }
  if (headerValue.length === 0) {
    throw new Error(`invalid --runtime-header value for ${name}: value must be non-empty`)
  }
  return { name, value: headerValue }
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
