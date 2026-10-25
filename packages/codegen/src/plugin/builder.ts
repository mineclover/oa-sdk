import { statSync, watch, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  OasDocument,
  OasOperation,
  OasParameter,
  OasParameterIn,
  OasReference,
  OasRequestBody,
  OasResponse,
  OasSchema,
} from '@oa-sdk/parser'
import { assertPipelinePurpose } from '../pipeline-purpose.js'
import {
  absolutizeTspInput,
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
  type TypeSpecCompilerResult,
} from './compiler.js'
import { validateTspConfig } from './config.js'
import { runTspPluginPipeline, type TspPipelineResult } from './runner.js'
import type { TspConfig, TspPluginEntry } from './types.js'

/**
 * Normalized parameter introspection metadata from TypeSpec.
 */
export interface TspIntrospectedParameter {
  name: string
  /** Parameter location; 'querystring' is the OpenAPI 3.2 whole-query-string parameter */
  in: OasParameterIn
  required: boolean
  description?: string | undefined
  type?: string | undefined
}

/**
 * Normalized response introspection metadata from TypeSpec.
 */
export interface TspIntrospectedResponse {
  statusCode: string
  description?: string | undefined
  contentType?: string | undefined
  schemaName?: string | undefined
  isError: boolean
}

/**
 * Introspected operation metadata representing an endpoint declared in TypeSpec.
 */
export interface TspIntrospectedOperation {
  id: string
  method: string
  path: string
  summary?: string | undefined
  description?: string | undefined
  deprecated: boolean
  tags: string[]
  parameters: TspIntrospectedParameter[]
  requestBody?: {
    required: boolean
    contentType?: string | undefined
    schemaName?: string | undefined
    description?: string | undefined
  } | undefined
  responses: TspIntrospectedResponse[]
  errorStatusMap: Record<string, string>
  wireFormat: 'json' | 'protobuf' | 'msgpack'
}

/**
 * Introspected property metadata for a TypeSpec model.
 */
export interface TspIntrospectedModelProperty {
  name: string
  type: string
  required: boolean
  format?: string | undefined
  description?: string | undefined
  constraints?: {
    minimum?: number | undefined
    maximum?: number | undefined
    minLength?: number | undefined
    maxLength?: number | undefined
    pattern?: string | undefined
    enumValues?: unknown[] | undefined
  } | undefined
}

/**
 * Introspected schema model declared in TypeSpec.
 */
export interface TspIntrospectedModel {
  name: string
  description?: string | undefined
  properties: TspIntrospectedModelProperty[]
}

/**
 * Comprehensive introspection report of a TypeSpec project.
 */
export interface TspIntrospectionReport {
  entrypoint: string
  openApiVersion: '3.0.0' | '3.1.0' | '3.2.0'
  title: string
  version: string
  description?: string | undefined
  routesCount: number
  sourceFiles: string[]
  operations: TspIntrospectedOperation[]
  models: TspIntrospectedModel[]
  tags: string[]
}

/**
 * Configuration options for initializing a TspProjectBuilder.
 */
export interface CreateTspBuilderOptions {
  /** Base directory for relative `input`/`output` paths in build(), introspect() and watch(). Default: process.cwd() */
  cwd?: string | undefined
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
}

/**
 * Event payload emitted when a watched TypeSpec file changes.
 */
export interface TspWatchEvent {
  eventType: 'change' | 'rename'
  filePath: string
  /** Pipeline result of the rebuild (undefined when buildOnChange is false or the rebuild threw) */
  result?: TspPipelineResult | undefined
  /** Error thrown by the rebuild, e.g. a TypeSpec compilation failure */
  error?: unknown
}

/**
 * Options for builder watch mode.
 */
export interface TspWatchOptions {
  /** If true, automatically rebuilds pipeline on change. Default: true */
  buildOnChange?: boolean | undefined
  /** Debounce delay in milliseconds. Default: 150 */
  debounceMs?: number | undefined
}

/**
 * Active watcher handle that can be cleanly stopped.
 */
export interface TspWatcherHandle {
  unwatch(): void
}

const INTROSPECTED_VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'query'] as const

function isReference(value: object): value is OasReference {
  return '$ref' in value && typeof value.$ref === 'string'
}

/**
 * Resolves a value that may be a local component reference (`#/components/<section>/<name>`),
 * following reference chains. Returns undefined for unresolvable or external references.
 */
function resolveComponentRef<T extends object>(
  value: T | OasReference | undefined,
  section: Readonly<Record<string, T | OasReference>> | undefined,
  prefix: string,
): T | undefined {
  const seen = new Set<string>()
  let current = value
  while (current && isReference(current)) {
    const ref = current.$ref
    if (!ref.startsWith(prefix) || seen.has(ref)) return undefined
    seen.add(ref)
    current = section?.[decodeURIComponent(ref.slice(prefix.length)).replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return current
}

function schemaTypeName(type: string | string[] | undefined): string | undefined {
  return Array.isArray(type) ? type.join(' | ') : type
}

function contentTypes(content: Record<string, unknown> | undefined): string[] {
  return Object.keys(content ?? {})
}

function extractWireFormat(
  requestBody: OasRequestBody | undefined,
  responses: readonly OasResponse[],
): 'json' | 'protobuf' | 'msgpack' {
  const allContentTypes = [
    ...contentTypes(requestBody?.content),
    ...responses.flatMap(response => contentTypes(response.content)),
  ]
  if (allContentTypes.some(c => c.includes('protobuf') || c.includes('x-protobuf'))) return 'protobuf'
  if (allContentTypes.some(c => c.includes('msgpack') || c.includes('x-msgpack'))) return 'msgpack'
  return 'json'
}

function resolveSchemaRefName(schema: OasSchema | undefined): string | undefined {
  if (!schema) return undefined
  if (typeof schema.$ref === 'string') {
    return schema.$ref.replace('#/components/schemas/', '')
  }
  return schema.title ?? schemaTypeName(schema.type)
}

function firstMediaSchema(
  content: OasRequestBody['content'] | undefined,
): { contentType: string | undefined; schema: OasSchema | undefined } {
  const contentType = Object.keys(content ?? {})[0]
  const media = contentType ? content?.[contentType] : undefined
  return { contentType, schema: media && !isReference(media) ? media.schema : undefined }
}

function introspectOperation(
  document: OasDocument,
  openApiPath: string,
  verb: (typeof INTROSPECTED_VERBS)[number],
  op: OasOperation,
): TspIntrospectedOperation {
  const components = document.components

  const parameters: TspIntrospectedParameter[] = []
  for (const rawParam of op.parameters ?? []) {
    const p: OasParameter | undefined = resolveComponentRef(rawParam, components?.parameters, '#/components/parameters/')
    if (!p) continue
    parameters.push({
      name: p.name,
      in: p.in,
      required: p.required === true,
      description: p.description,
      type: schemaTypeName(p.schema?.type) ?? (p.schema?.$ref ? resolveSchemaRefName(p.schema) : 'unknown'),
    })
  }

  const body = resolveComponentRef(op.requestBody, components?.requestBodies, '#/components/requestBodies/')
  let requestBody: TspIntrospectedOperation['requestBody'] = undefined
  if (body) {
    const { contentType, schema } = firstMediaSchema(body.content)
    requestBody = {
      required: body.required === true,
      contentType,
      schemaName: resolveSchemaRefName(schema),
      description: body.description,
    }
  }

  const responses: TspIntrospectedResponse[] = []
  const resolvedResponses: OasResponse[] = []
  const errorStatusMap: Record<string, string> = {}
  for (const [code, rawResponse] of Object.entries(op.responses ?? {})) {
    const res = resolveComponentRef(rawResponse, components?.responses, '#/components/responses/')
    if (!res) continue
    resolvedResponses.push(res)
    const { contentType, schema } = firstMediaSchema(res.content)
    const schemaName = resolveSchemaRefName(schema)
    const isError = /^[45]\d{2}$/.test(code) || code === 'default'

    responses.push({
      statusCode: code,
      description: res.description,
      contentType,
      schemaName,
      isError,
    })

    if (isError && schemaName) {
      errorStatusMap[code] = schemaName
    }
  }

  return {
    id: op.operationId ?? `${verb}_${openApiPath.replace(/[{}/]/g, '_')}`,
    method: verb.toUpperCase(),
    path: openApiPath,
    summary: op.summary,
    description: op.description,
    deprecated: op.deprecated === true,
    tags: op.tags ?? [],
    parameters,
    requestBody,
    responses,
    errorStatusMap,
    wireFormat: extractWireFormat(body, resolvedResponses),
  }
}

function introspectModels(document: OasDocument): TspIntrospectedModel[] {
  const models: TspIntrospectedModel[] = []
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    const requiredList = schema.required ?? []
    const properties: TspIntrospectedModelProperty[] = []
    for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
      properties.push({
        name: propName,
        type: schemaTypeName(propSchema.type) ?? resolveSchemaRefName(propSchema) ?? 'unknown',
        required: requiredList.includes(propName),
        format: propSchema.format,
        description: propSchema.description,
        constraints: {
          minimum: propSchema.minimum ?? propSchema.exclusiveMinimum,
          maximum: propSchema.maximum ?? propSchema.exclusiveMaximum,
          minLength: propSchema.minLength,
          maxLength: propSchema.maxLength,
          pattern: propSchema.pattern,
          enumValues: propSchema.enum,
        },
      })
    }
    models.push({ name, description: schema.description, properties })
  }
  return models
}

/**
 * TypeSpec Project Builder Platform
 *
 * Provides transparent programmatic introspection, fluent plugin assembly,
 * in-memory compilation caching, and live watch reloading.
 */
export class TspProjectBuilder {
  private readonly rawInput: string | TspConfig
  private readonly options?: CreateTspBuilderOptions | undefined
  private readonly plugins: TspPluginEntry[] = []
  private cachedCompilerResult?: TypeSpecCompilerResult | undefined
  private cachedReport?: TspIntrospectionReport | undefined

  constructor(inputOrConfig: string | TspConfig, options?: CreateTspBuilderOptions | undefined) {
    this.rawInput = inputOrConfig
    this.options = options

    if (typeof inputOrConfig === 'object' && inputOrConfig !== null && Array.isArray(inputOrConfig.plugins)) {
      this.plugins.push(...inputOrConfig.plugins)
    }
  }

  /**
   * Registers a plugin into the builder pipeline using fluent chaining.
   */
  public use(plugin: TspPluginEntry): this {
    if (plugin) {
      this.plugins.push(plugin)
    }
    return this
  }

  /**
   * Returns a copy of the registered plugins array.
   */
  public getPlugins(): readonly TspPluginEntry[] {
    return [...this.plugins]
  }

  /**
   * Returns the normalized configuration object.
   */
  public getConfig(): TspConfig {
    const baseConfig: TspConfig = typeof this.rawInput === 'string'
      ? { input: this.rawInput }
      : { ...this.rawInput }

    return validateTspConfig({
      ...baseConfig,
      openApiVersion: this.options?.openApiVersion ?? baseConfig.openApiVersion ?? '3.2.0',
      plugins: this.plugins,
    })
  }

  /**
   * Performs in-memory compilation and extracts an introspection report
   * of all declared models, operations, parameters, constraints, and error mappings.
   */
  public async introspect(forceFresh = false): Promise<TspIntrospectionReport> {
    if (this.cachedReport && !forceFresh) {
      return this.cachedReport
    }

    const config = this.getConfig()
    const entrypoint = this.resolveEntrypoint(config)
    const openApiVersion = config.openApiVersion ?? '3.2.0'

    const compilerResult = await compileTypeSpecInMemory(entrypoint, {
      oldProgram: forceFresh ? undefined : this.cachedCompilerResult?.program,
      openApiVersion,
    })
    this.cachedCompilerResult = compilerResult

    const { document, routesCount, sourceFiles } = compilerResult
    assertPipelinePurpose(document, config.purpose)
    const operations: TspIntrospectedOperation[] = []
    const tagsSet = new Set<string>()

    for (const [openApiPath, pathItem] of Object.entries(document.paths ?? {})) {
      if (isReference(pathItem)) continue
      for (const verb of INTROSPECTED_VERBS) {
        const op = pathItem[verb]
        if (!op) continue
        const introspected = introspectOperation(document, openApiPath, verb, op)
        for (const tag of introspected.tags) tagsSet.add(tag)
        operations.push(introspected)
      }
    }

    const models = introspectModels(document)

    this.cachedReport = {
      entrypoint,
      openApiVersion,
      title: document.info?.title ?? '',
      version: document.info?.version ?? '0.0.0',
      description: document.info?.description,
      routesCount,
      sourceFiles,
      operations,
      models,
      tags: Array.from(tagsSet).sort(),
    }

    return this.cachedReport
  }

  /**
   * Retrieves all operations declared in the TypeSpec project.
   */
  public async getOperations(): Promise<readonly TspIntrospectedOperation[]> {
    const report = await this.introspect()
    return report.operations
  }

  /**
   * Retrieves all models declared in the TypeSpec project.
   */
  public async getModels(): Promise<readonly TspIntrospectedModel[]> {
    const report = await this.introspect()
    return report.models
  }

  /**
   * Finds a specific operation by its ID or path.
   */
  public async getOperation(idOrPath: string): Promise<TspIntrospectedOperation | undefined> {
    const ops = await this.getOperations()
    return ops.find(o => o.id === idOrPath || o.path === idOrPath)
  }

  /**
   * Finds a specific model by its name.
   */
  public async getModel(name: string): Promise<TspIntrospectedModel | undefined> {
    const models = await this.getModels()
    return models.find(m => m.name === name)
  }

  /**
   * Executes the complete plugin pipeline for all registered plugins.
   */
  public async build(overrideConfig?: Partial<TspConfig>): Promise<TspPipelineResult> {
    const config = this.getConfig()
    // getConfig() fills both output aliases with the default, so an override of either alias must
    // replace both (`output` wins when both are given, as in validateTspConfig).
    const overrideOutput = overrideConfig?.output ?? overrideConfig?.outputDir
    const mergedConfig: TspConfig = {
      ...config,
      ...overrideConfig,
      ...(overrideOutput !== undefined ? { output: overrideOutput, outputDir: overrideOutput } : {}),
      plugins: overrideConfig?.plugins ?? this.plugins,
    }

    // Always compile the (possibly overridden) input: the cached program is only an incremental hint,
    // never a substitute document, so edits made after introspect() are picked up.
    return runTspPluginPipeline(mergedConfig, {
      cwd: this.options?.cwd,
      oldProgram: this.cachedCompilerResult?.program,
    })
  }

  /**
   * Resolves the configured input to the TypeSpec entrypoint, relative to the builder's `cwd`.
   */
  private resolveEntrypoint(config: TspConfig): string {
    return resolveTypeSpecEntrypoint(absolutizeTspInput(config.input, this.options?.cwd ?? process.cwd()))
  }

  /**
   * Watches the TypeSpec entrypoint and its directory for file edits,
   * automatically re-introspecting or rebuilding on change.
   */
  public watch(
    listener: (event: TspWatchEvent) => void | Promise<void>,
    watchOptions?: TspWatchOptions,
  ): TspWatcherHandle {
    const config = this.getConfig()
    const entrypoint = this.resolveEntrypoint(config)
    const targetDir = statSync(entrypoint).isDirectory() ? entrypoint : dirname(entrypoint)
    const debounceMs = watchOptions?.debounceMs ?? 150
    const buildOnChange = watchOptions?.buildOnChange !== false

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let isClosed = false

    const watcher: FSWatcher = watch(targetDir, { recursive: true }, (eventType, filename) => {
      if (isClosed || !filename) return
      if (!filename.endsWith('.tsp')) return

      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(async () => {
        if (isClosed) return
        // The sources changed: neither the report nor the compiled document may be served again.
        this.cachedReport = undefined
        this.cachedCompilerResult = undefined

        const fullPath = resolve(targetDir, filename)
        let result: TspPipelineResult | undefined = undefined
        let error: unknown = undefined

        if (buildOnChange) {
          try {
            result = await this.build()
          } catch (err) {
            // Compilation failures throw (they are not pipeline diagnostics); hand them to the listener.
            error = err
          }
        }

        try {
          await listener({
            eventType,
            filePath: fullPath,
            result,
            ...(error !== undefined ? { error } : {}),
          })
        } catch {
          // Listener error suppression
        }
      }, debounceMs)
    })

    return {
      unwatch: () => {
        isClosed = true
        if (debounceTimer) clearTimeout(debounceTimer)
        watcher.close()
      },
    }
  }
}

/**
 * Creates a high-level TypeSpec Project Builder instance.
 *
 * @param inputOrConfig File path to .tsp entrypoint, directory, or TspConfig object.
 * @param options Builder options (cwd, openApiVersion).
 */
export function createTspBuilder(
  inputOrConfig: string | TspConfig,
  options?: CreateTspBuilderOptions,
): TspProjectBuilder {
  return new TspProjectBuilder(inputOrConfig, options)
}
