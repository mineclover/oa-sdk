import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { OasDocument, OasParameter, OasResponse, OasSchema } from '@oa-sdk/parser'
import type { Program } from '@typespec/compiler'
import { compileTypeSpecInMemory, resolveTypeSpecEntrypoint, type TypeSpecCompilerResult } from './compiler.js'
import { validateTspConfig } from './config.js'
import { runTspPluginPipeline, type TspPipelineResult } from './runner.js'
import type { TspConfig, TspPluginEntry } from './types.js'

/**
 * Normalized parameter introspection metadata from TypeSpec.
 */
export interface TspIntrospectedParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
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
  cwd?: string | undefined
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
}

/**
 * Event payload emitted when a watched TypeSpec file changes.
 */
export interface TspWatchEvent {
  eventType: 'change' | 'rename'
  filePath: string
  result?: TspPipelineResult | undefined
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

function extractWireFormat(op: any): 'json' | 'protobuf' | 'msgpack' {
  const reqContent = Object.keys(op.requestBody?.content ?? {})
  const resContent = Object.values(op.responses ?? {}).flatMap((r: any) => Object.keys(r?.content ?? {}))
  const allContentTypes = [...reqContent, ...resContent]
  if (allContentTypes.some(c => c.includes('protobuf') || c.includes('x-protobuf'))) return 'protobuf'
  if (allContentTypes.some(c => c.includes('msgpack') || c.includes('x-msgpack'))) return 'msgpack'
  return 'json'
}

function resolveSchemaRefName(schema: any): string | undefined {
  if (!schema) return undefined
  if (typeof schema.$ref === 'string') {
    return schema.$ref.replace('#/components/schemas/', '')
  }
  return schema.title ?? schema.type
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
    const entrypoint = resolveTypeSpecEntrypoint(config.input)
    const openApiVersion = config.openApiVersion ?? '3.2.0'

    const compilerResult = await compileTypeSpecInMemory(entrypoint, {
      oldProgram: forceFresh ? undefined : this.cachedCompilerResult?.program,
      openApiVersion,
    })
    this.cachedCompilerResult = compilerResult

    const { document, routesCount, sourceFiles } = compilerResult
    const operations: TspIntrospectedOperation[] = []
    const tagsSet = new Set<string>()

    const paths = (document.paths ?? {}) as Record<string, any>
    const verbs = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'query']

    for (const [openApiPath, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue

      for (const verb of verbs) {
        if (!(verb in pathItem)) continue
        const op = pathItem[verb]
        if (!op || typeof op !== 'object') continue

        const id = op.operationId ?? `${verb}_${openApiPath.replace(/[{}/]/g, '_')}`
        const tags = Array.isArray(op.tags) ? op.tags : []
        for (const t of tags) tagsSet.add(t)

        const parameters: TspIntrospectedParameter[] = []
        const rawParams = Array.isArray(op.parameters) ? op.parameters : []
        for (const p of rawParams) {
          if (!p || typeof p !== 'object') continue
          parameters.push({
            name: p.name ?? '',
            in: p.in ?? 'query',
            required: p.required === true,
            description: p.description,
            type: p.schema?.type ?? (p.schema?.$ref ? resolveSchemaRefName(p.schema) : 'unknown'),
          })
        }

        let requestBody: TspIntrospectedOperation['requestBody'] = undefined
        if (op.requestBody && typeof op.requestBody === 'object') {
          const contents = op.requestBody.content ?? {}
          const firstContentType = Object.keys(contents)[0]
          const bodySchema = firstContentType ? contents[firstContentType]?.schema : undefined
          requestBody = {
            required: op.requestBody.required === true,
            contentType: firstContentType,
            schemaName: resolveSchemaRefName(bodySchema),
            description: op.requestBody.description,
          }
        }

        const responses: TspIntrospectedResponse[] = []
        const errorStatusMap: Record<string, string> = {}
        const rawResponses = (op.responses ?? {}) as Record<string, any>

        for (const [code, res] of Object.entries(rawResponses)) {
          if (!res || typeof res !== 'object') continue
          const resContents = res.content ?? {}
          const resContentType = Object.keys(resContents)[0]
          const resSchema = resContentType ? resContents[resContentType]?.schema : undefined
          const schemaName = resolveSchemaRefName(resSchema)
          const isError = /^[45]\d{2}$/.test(code) || code === 'default'

          responses.push({
            statusCode: code,
            description: res.description,
            contentType: resContentType,
            schemaName,
            isError,
          })

          if (isError && schemaName) {
            errorStatusMap[code] = schemaName
          }
        }

        operations.push({
          id,
          method: verb.toUpperCase(),
          path: openApiPath,
          summary: op.summary,
          description: op.description,
          deprecated: op.deprecated === true,
          tags,
          parameters,
          requestBody,
          responses,
          errorStatusMap,
          wireFormat: extractWireFormat(op),
        })
      }
    }

    const models: TspIntrospectedModel[] = []
    const rawSchemas = (document.components?.schemas ?? {}) as Record<string, any>

    for (const [name, schema] of Object.entries(rawSchemas)) {
      if (!schema || typeof schema !== 'object') continue

      const properties: TspIntrospectedModelProperty[] = []
      const rawProps = (schema.properties ?? {}) as Record<string, any>
      const requiredList = Array.isArray(schema.required) ? schema.required : []

      for (const [propName, propSchema] of Object.entries(rawProps)) {
        if (!propSchema || typeof propSchema !== 'object') continue

        properties.push({
          name: propName,
          type: propSchema.type ?? resolveSchemaRefName(propSchema) ?? 'unknown',
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

      models.push({
        name,
        description: schema.description,
        properties,
      })
    }

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
    const mergedConfig: TspConfig = {
      ...config,
      ...overrideConfig,
      plugins: overrideConfig?.plugins ?? this.plugins,
    }

    return runTspPluginPipeline(mergedConfig, {
      cwd: this.options?.cwd,
      program: this.cachedCompilerResult?.program,
      document: this.cachedCompilerResult?.document,
    })
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
    const entrypoint = resolveTypeSpecEntrypoint(config.input)
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
        this.cachedReport = undefined

        const fullPath = resolve(targetDir, filename)
        let result: TspPipelineResult | undefined = undefined

        if (buildOnChange) {
          try {
            result = await this.build()
          } catch {
            // Error captured in pipeline diagnostics
          }
        }

        try {
          await listener({
            eventType: eventType as 'change' | 'rename',
            filePath: fullPath,
            result,
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
