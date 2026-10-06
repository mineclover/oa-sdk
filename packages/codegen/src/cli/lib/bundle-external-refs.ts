import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { appendJsonPointer, formatJsonPointer, isRelativeRef, parseJsonPointer } from '@oa-sdk/parser'

/**
 * The type of OpenAPI object at a position of a document, as far as it decides what the fields next
 * to a `$ref` there mean. `other` is any position outside these objects: `info`, an extension, the
 * value of an example.
 */
type ObjectKind =
  | 'document'
  | 'components'
  | 'paths'
  | 'pathItem'
  | 'operation'
  | 'responses'
  | 'response'
  | 'parameter'
  | 'requestBody'
  | 'header'
  | 'mediaType'
  | 'encoding'
  | 'example'
  | 'link'
  | 'callback'
  | 'securityScheme'
  | 'schema'
  | 'other'

/** What a value holds: an object of a kind, or a map from names to them. An array holds them as items. */
type Shape = ObjectKind | { map: ObjectKind }

/**
 * The fields of each kind of object that hold OpenAPI objects, in Swagger 2.0 and OpenAPI 3.0 to
 * 3.2. Any other field, an `x-` extension among them, is `other`.
 */
const FIELDS: Readonly<Record<ObjectKind, Readonly<Record<string, Shape>>>> = {
  document: {
    paths: 'paths',
    webhooks: { map: 'pathItem' },
    components: 'components',
    // Swagger 2.0
    definitions: { map: 'schema' },
    parameters: { map: 'parameter' },
    responses: { map: 'response' },
  },
  components: {
    schemas: { map: 'schema' },
    responses: { map: 'response' },
    parameters: { map: 'parameter' },
    examples: { map: 'example' },
    requestBodies: { map: 'requestBody' },
    headers: { map: 'header' },
    securitySchemes: { map: 'securityScheme' },
    links: { map: 'link' },
    callbacks: { map: 'callback' },
    pathItems: { map: 'pathItem' },
    mediaTypes: { map: 'mediaType' },
  },
  paths: {},
  pathItem: {
    get: 'operation',
    put: 'operation',
    post: 'operation',
    delete: 'operation',
    options: 'operation',
    head: 'operation',
    patch: 'operation',
    trace: 'operation',
    query: 'operation',
    additionalOperations: { map: 'operation' },
    parameters: 'parameter',
  },
  operation: {
    parameters: 'parameter',
    requestBody: 'requestBody',
    responses: 'responses',
    callbacks: { map: 'callback' },
  },
  responses: {},
  response: {
    headers: { map: 'header' },
    content: { map: 'mediaType' },
    links: { map: 'link' },
    // Swagger 2.0
    schema: 'schema',
  },
  parameter: { schema: 'schema', content: { map: 'mediaType' }, examples: { map: 'example' } },
  requestBody: { content: { map: 'mediaType' } },
  header: { schema: 'schema', content: { map: 'mediaType' }, examples: { map: 'example' } },
  mediaType: {
    schema: 'schema',
    itemSchema: 'schema',
    examples: { map: 'example' },
    encoding: { map: 'encoding' },
    prefixEncoding: 'encoding',
    itemEncoding: 'encoding',
  },
  encoding: {
    headers: { map: 'header' },
    encoding: { map: 'encoding' },
    prefixEncoding: 'encoding',
    itemEncoding: 'encoding',
  },
  example: {},
  link: {},
  callback: {},
  securityScheme: {},
  schema: {
    properties: { map: 'schema' },
    patternProperties: { map: 'schema' },
    dependentSchemas: { map: 'schema' },
    dependencies: { map: 'schema' },
    $defs: { map: 'schema' },
    definitions: { map: 'schema' },
    additionalProperties: 'schema',
    unevaluatedProperties: 'schema',
    propertyNames: 'schema',
    items: 'schema',
    prefixItems: 'schema',
    additionalItems: 'schema',
    unevaluatedItems: 'schema',
    contains: 'schema',
    contentSchema: 'schema',
    allOf: 'schema',
    anyOf: 'schema',
    oneOf: 'schema',
    not: 'schema',
    if: 'schema',
    then: 'schema',
    else: 'schema',
  },
  other: {},
}

/** The kind of the patterned fields of the objects that have them, other than `x-` extensions. */
const PATTERNED_FIELDS: Readonly<Partial<Record<ObjectKind, ObjectKind>>> = {
  paths: 'pathItem',
  responses: 'response',
  callback: 'pathItem',
}

/**
 * The objects a Reference Object stands for, each with the fields of a Reference Object that
 * override its own and the OpenAPI 3.x minor version since which they do: a Reference Object has
 * `summary` and `description` since 3.1, which have no effect on an object without that field (the
 * Response Object has a `summary` since 3.2). Any other field of a Reference Object is ignored.
 */
const REFERENCE_OVERRIDES: Readonly<Partial<Record<ObjectKind, Readonly<Record<string, number>>>>> = {
  parameter: { description: 1 },
  requestBody: { description: 1 },
  response: { description: 1, summary: 2 },
  header: { description: 1 },
  mediaType: {},
  example: { summary: 1, description: 1 },
  link: { description: 1 },
  callback: {},
  securityScheme: { description: 1 },
}

/** Keywords next to a schema's `$ref` that override those of its target, besides `x-` extensions (OpenAPI 3.1+). */
const SCHEMA_OVERRIDE_FIELDS = new Set(['summary', 'description'])

/** Where a `$ref` points: a JSON pointer into one file. */
interface RefTarget {
  file: string
  pointer: string
}

/** A `$ref` as written: its value, the file it is written in, and the output pointer it is bundled at. */
interface RefSite {
  ref: string
  file: string
  at: string
}

/**
 * `document`, read from the file `entryPath`, as one self-contained document: every `$ref` to
 * another file (a path relative to the file the ref is written in, with or without a JSON pointer
 * fragment) is replaced by a copy of what it names, so the document means the same wherever it is
 * written and whatever later happens to the files it referred to. `oa-gen normalize` writes this,
 * and `oa-gen diff` compares this, so a change made in a referenced file is a change of the spec.
 *
 * - A `components` entry that is just a `$ref` to another file gets the copy, and every other `$ref`
 *   to the same target refers to that entry (`#/components/...`).
 * - Any other `$ref` to another file is replaced by the copy in place, and the fields next to it
 *   keep the meaning they have for the type of object at that position:
 *   - next to a Path Item's `$ref` they are fields of the path item, set on the copy over its own
 *     (in every version, as the parser's dereference does);
 *   - next to a Schema Object's `$ref`, `summary`, `description` and `x-` extensions override those
 *     of the copy and other keywords apply with it, through `allOf`;
 *   - next to a Reference Object (a parameter, response, request body, header, media type,
 *     example, link, callback or security scheme), `summary` and `description` override those of
 *     the copy where its type has that field, and any other field is ignored, so dropped;
 *   - in OpenAPI 3.0 and Swagger 2.0, which ignore the fields next to a schema's `$ref` or a
 *     Reference Object, they are dropped;
 *   - anywhere else (an extension, an example value) they are set on the copy, as the parser's
 *     dereference does.
 * - A `$ref` inside a copy that leads back to a target being copied refers to that copy (recursion).
 * - A `$ref` into the entry document is a fragment (`#...`): one written in another file, or naming
 *   the entry file, becomes one. A `$ref` to a URL is kept as written, and not followed.
 * - A `$ref` that stays one keeps the fields next to it as written, as they mean the same there.
 *
 * Throws when a referenced file cannot be read or does not contain the target.
 */
export function bundleExternalRefs(document: Record<string, unknown>, entryPath: string): Record<string, unknown> {
  return new ExternalRefBundler(document, resolve(entryPath)).bundle()
}

class ExternalRefBundler {
  private readonly documents = new Map<string, unknown>()
  /**
   * Targets with a `components` entry of the entry document that is just a `$ref` to them, with
   * the output pointer of that entry, which holds their copy.
   */
  private readonly homes = new Map<string, string>()
  /** Targets being copied, with the pointer of their copy in the output: refs to them are recursion. */
  private readonly copying = new Map<string, string>()
  /** The OpenAPI 3.x minor version of the document: -1 for Swagger 2.0, Infinity when it names none. */
  private readonly minorVersion: number

  constructor(
    private readonly document: Record<string, unknown>,
    private readonly entryFile: string,
  ) {
    this.documents.set(entryFile, document)
    this.minorVersion = openApiMinorVersion(document)
  }

  bundle(): Record<string, unknown> {
    this.findComponentHomes()
    return this.visit(this.document, 'document', '', this.entryFile) as Record<string, unknown>
  }

  private findComponentHomes(): void {
    const components = this.document.components
    if (!isRecord(components)) return
    for (const [section, entries] of Object.entries(components)) {
      if (!isRecord(entries)) continue
      for (const [name, entry] of Object.entries(entries)) {
        if (!isRecord(entry) || typeof entry.$ref !== 'string' || Object.keys(entry).length !== 1) continue
        const at = formatJsonPointer(['components', section, name])
        const target = this.locate({ ref: entry.$ref, file: this.entryFile, at })
        if (target === undefined || target.file === this.entryFile) continue
        const key = targetKey(target)
        if (!this.homes.has(key)) this.homes.set(key, at)
      }
    }
  }

  /** The output for `value`, written in `file`, which holds `shape`, placed at the JSON pointer `at` of the output. */
  private visit(value: unknown, shape: Shape, at: string, file: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => this.visit(item, shape, appendJsonPointer(at, index), file))
    if (!isRecord(value)) return value
    if (typeof value.$ref === 'string') return this.visitRef(value, value.$ref, shape, at, file)
    return this.visitFields(value, shape, at, file)
  }

  /** The output for the fields of `value`, an object (or a map) that holds `shape`. */
  private visitFields(value: Record<string, unknown>, shape: Shape, at: string, file: string): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const childShape = typeof shape === 'string' ? fieldShape(shape, key) : shape.map
      output[key] = this.visit(child, childShape, appendJsonPointer(at, key), file)
    }
    return output
  }

  private visitRef(value: Record<string, unknown>, ref: string, shape: Shape, at: string, file: string): unknown {
    const site: RefSite = { ref, file, at }
    const target = this.locate(site)
    // A ref to a URL is not followed.
    if (target === undefined) return this.visitFields(value, shape, at, file)
    if (target.file === this.entryFile) {
      // A fragment-only ref of the entry document stays as written; one naming the entry file by
      // name, or written in another file, becomes a fragment, as the bundle may be written elsewhere.
      const local = file === this.entryFile && ref.startsWith('#') ? ref : `#${target.pointer}`
      return { ...this.visitFields(value, shape, at, file), $ref: local }
    }

    const key = targetKey(target)
    const existing = this.copying.get(key) ?? this.homeOtherThan(key, at)
    if (existing !== undefined) return { ...this.visitFields(value, shape, at, file), $ref: `#${existing}` }

    const { $ref: _ref, ...fields } = value
    if (shape === 'schema') return this.replaceSchemaRef(site, target, fields)
    const kept = this.keptFields(shape, fields)
    const copy = this.copy(site, target, shape, at)
    if (Object.keys(kept).length === 0 || !isRecord(copy)) return copy
    return { ...copy, ...this.visitFields(kept, shape, at, file) }
  }

  /**
   * The copy of the target of the Schema Object `$ref` at `site`, with the keywords next to it,
   * `fields`. OpenAPI 3.0 and Swagger 2.0 ignore them. Since OpenAPI 3.1 (JSON Schema 2020-12) they
   * apply with the ref: annotations override those of the copy, other keywords apply through `allOf`.
   */
  private replaceSchemaRef(site: RefSite, target: RefTarget, fields: Record<string, unknown>): unknown {
    const { at, file } = site
    const names = Object.keys(fields)
    if (names.length === 0 || this.minorVersion < 1) return this.copy(site, target, 'schema', at)

    const visited = this.visitFields(fields, 'schema', at, file)
    if (names.every(isSchemaOverrideField)) {
      const copy = this.copy(site, target, 'schema', at)
      if (isRecord(copy)) return { ...copy, ...visited }
    }
    const allOf = visited.allOf === undefined ? [] : Array.isArray(visited.allOf) ? visited.allOf : [visited.allOf]
    const copy = this.copy(site, target, 'schema', appendJsonPointer(appendJsonPointer(at, 'allOf'), allOf.length))
    return { ...visited, allOf: [...allOf, copy] }
  }

  /**
   * The fields next to a `$ref` at a position that holds `shape` (other than a schema) that keep a
   * meaning once the copy of its target replaces the `$ref`, and so are set on the copy: the
   * overrides of a Reference Object, or all of them anywhere else (a Path Item's are its fields).
   */
  private keptFields(shape: Shape, fields: Record<string, unknown>): Record<string, unknown> {
    const overrides = typeof shape === 'string' ? REFERENCE_OVERRIDES[shape] : undefined
    if (overrides === undefined) return fields
    return Object.fromEntries(Object.entries(fields).filter(([name]) => {
      const since = Object.hasOwn(overrides, name) ? overrides[name] : undefined
      return since !== undefined && since <= this.minorVersion
    }))
  }

  /** The output pointer of the `components` entry that holds the copy of `key`, unless it is `at`. */
  private homeOtherThan(key: string, at: string): string | undefined {
    const home = this.homes.get(key)
    return home === at ? undefined : home
  }

  /** A copy of the target of the ref at `site`, which holds `shape`, placed at `at`, with the refs in it bundled. */
  private copy(site: RefSite, target: RefTarget, shape: Shape, at: string): unknown {
    const content = this.read(site, target)
    const key = targetKey(target)
    this.copying.set(key, at)
    try {
      return this.visit(content, shape, at, target.file)
    } finally {
      this.copying.delete(key)
    }
  }

  /** Where the ref at `site` points; undefined for a URL. */
  private locate(site: RefSite): RefTarget | undefined {
    const { ref, file } = site
    const hash = ref.indexOf('#')
    const filePart = hash === -1 ? ref : ref.slice(0, hash)
    if (filePart !== '' && !isRelativeRef(ref)) return undefined

    const fragment = hash === -1 ? '' : ref.slice(hash + 1)
    let tokens: string[] | undefined
    try {
      tokens = parseJsonPointer(decodeURIComponent(fragment))
    } catch {
      tokens = undefined
    }
    if (tokens === undefined) {
      // A plain-name fragment (`#name`) is an anchor inside the document: kept, never copied.
      if (filePart === '' && file === this.entryFile) return { file, pointer: fragment }
      throw this.error(site, `"#${fragment}" is not a JSON pointer`)
    }
    return { file: filePart === '' ? file : resolve(dirname(file), filePart), pointer: formatJsonPointer(tokens) }
  }

  /** The target of the ref at `site`. */
  private read(site: RefSite, target: RefTarget): unknown {
    let document = this.documents.get(target.file)
    if (document === undefined) {
      try {
        const raw = readFileSync(target.file, 'utf8')
        document = target.file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
      } catch (error) {
        throw this.error(site, `cannot read ${this.display(target.file)}: ${errorMessage(error)}`, error)
      }
      this.documents.set(target.file, document)
    }

    let current = document
    for (const token of parseJsonPointer(target.pointer) ?? []) {
      if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
        throw this.error(site, `${this.display(target.file)} has nothing at #${target.pointer}`)
      }
      current = (current as Record<string, unknown>)[token]
    }
    return current
  }

  private error(site: RefSite, reason: string, cause?: unknown): Error {
    return new Error(
      `$ref "${site.ref}" in ${this.display(site.file)} (at #${site.at} of the bundled document): ${reason}`,
      cause === undefined ? undefined : { cause },
    )
  }

  /** `file` relative to the directory of the entry document, as messages name it. */
  private display(file: string): string {
    return relative(dirname(this.entryFile), file) || file
  }
}

function targetKey(target: RefTarget): string {
  return `${target.file}#${target.pointer}`
}

/** What the field `key` of an object of `kind` holds. */
function fieldShape(kind: ObjectKind, key: string): Shape {
  const fields = FIELDS[kind]
  const shape = Object.hasOwn(fields, key) ? fields[key] : undefined
  if (shape !== undefined) return shape
  const patterned = PATTERNED_FIELDS[kind]
  return patterned !== undefined && !key.startsWith('x-') ? patterned : 'other'
}

/**
 * The OpenAPI 3.x minor version `document` names: -1 for Swagger 2.0 (or an OpenAPI version before
 * 3), Infinity for a later major version or none.
 */
function openApiMinorVersion(document: Record<string, unknown>): number {
  if (document.swagger !== undefined) return -1
  const version = typeof document.openapi === 'string' ? /^(\d+)\.(\d+)/.exec(document.openapi) : null
  if (version === null) return Infinity
  const major = Number(version[1])
  if (major !== 3) return major < 3 ? -1 : Infinity
  return Number(version[2])
}

function isSchemaOverrideField(field: string): boolean {
  return SCHEMA_OVERRIDE_FIELDS.has(field) || field.startsWith('x-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
