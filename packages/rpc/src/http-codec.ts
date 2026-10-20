/**
 * OpenAPI parameter and body (de)serialization for the REST binding of RPC procedures.
 *
 * Follows the OpenAPI `style`/`explode` rules: `simple`, `label`, `matrix` for path parameters,
 * `form`, `spaceDelimited`, `pipeDelimited`, `deepObject` for query parameters, `simple` for
 * headers and `form` for cookies. A `content`-based parameter is serialized with its media type.
 */

import type { OasSchema } from '@oa-sdk/parser'
import type { RpcParameterBinding } from '@oa-sdk/surface-ir'
import { RpcError } from './errors.js'
import type { RpcContract, RpcProcedure } from './types.js'

/** A decoded key and value, and the value as it appeared on the wire. */
type Pair = [key: string, value: string, raw: string]

const RESERVED_CHARACTER = /^[:/?#[\]@!$&'()*+,;=]$/

export function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(';')[0]!.trim().toLowerCase()
  return essence === 'application/json' || essence.endsWith('+json')
}

function mediaEssence(mediaType: string): string {
  return mediaType.split(';')[0]!.trim().toLowerCase()
}

function styleOf(binding: RpcParameterBinding): string {
  return binding.style ?? (binding.in === 'path' || binding.in === 'header' ? 'simple' : 'form')
}

function explodeOf(binding: RpcParameterBinding): boolean {
  return binding.explode ?? styleOf(binding) === 'form'
}

function encode(value: string, allowReserved = false): string {
  if (!allowReserved) return encodeURIComponent(value)
  return Array.from(value, character => RESERVED_CHARACTER.test(character) ? character : encodeURIComponent(character)).join('')
}

function scalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

function contentValue(value: unknown, contentType: string): string {
  return isJsonMediaType(contentType) ? JSON.stringify(value) : scalar(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function definedEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(([, entry]) => entry !== undefined)
}

// ─── Client side: input → HTTP request ──────────────────────────────────────

export function serializePathParameter(binding: RpcParameterBinding, value: unknown): string {
  const enc = (entry: unknown): string => encode(scalar(entry), binding.allowReserved)
  const name = binding.field
  const style = styleOf(binding)
  const explode = explodeOf(binding)
  if (binding.contentType !== undefined) return encode(contentValue(value, binding.contentType))

  if (Array.isArray(value)) {
    const items = value.map(enc)
    if (style === 'label') return `.${items.join(explode ? '.' : ',')}`
    if (style === 'matrix') return explode ? items.map(item => `;${name}=${item}`).join('') : `;${name}=${items.join(',')}`
    return items.join(',')
  }
  if (isPlainObject(value)) {
    const entries = definedEntries(value)
    const pairs = entries.map(([key, entry]) => `${enc(key)}=${enc(entry)}`)
    const flat = entries.flatMap(([key, entry]) => [enc(key), enc(entry)])
    if (style === 'label') return `.${explode ? pairs.join('.') : flat.join(',')}`
    if (style === 'matrix') return explode ? pairs.map(pair => `;${pair}`).join('') : `;${name}=${flat.join(',')}`
    return explode ? pairs.join(',') : flat.join(',')
  }
  if (style === 'label') return `.${enc(value)}`
  if (style === 'matrix') return `;${name}=${enc(value)}`
  return enc(value)
}

/** Serialized `name=value` query pieces of one parameter. */
export function serializeQueryParameter(binding: RpcParameterBinding, value: unknown): string[] {
  const enc = (entry: unknown): string => encode(scalar(entry), binding.allowReserved)
  const name = encodeURIComponent(binding.field)
  const style = styleOf(binding)
  const explode = explodeOf(binding)
  if (binding.contentType !== undefined) return [`${name}=${encode(contentValue(value, binding.contentType))}`]

  if (Array.isArray(value)) {
    const items = value.map(enc)
    if (style === 'spaceDelimited') return [`${name}=${items.join('%20')}`]
    if (style === 'pipeDelimited') return [`${name}=${items.join('|')}`]
    return explode ? items.map(item => `${name}=${item}`) : [`${name}=${items.join(',')}`]
  }
  if (isPlainObject(value)) {
    const entries = definedEntries(value)
    if (style === 'deepObject') {
      return entries.map(([key, entry]) => `${encodeURIComponent(`${binding.field}[${key}]`)}=${enc(entry)}`)
    }
    if (explode) return entries.map(([key, entry]) => `${enc(key)}=${enc(entry)}`)
    return [`${name}=${entries.flatMap(([key, entry]) => [enc(key), enc(entry)]).join(',')}`]
  }
  return [`${name}=${enc(value)}`]
}

export function serializeHeaderParameter(binding: RpcParameterBinding, value: unknown): string {
  if (binding.contentType !== undefined) return contentValue(value, binding.contentType)
  if (Array.isArray(value)) return value.map(scalar).join(',')
  if (isPlainObject(value)) {
    const entries = definedEntries(value)
    return explodeOf(binding)
      ? entries.map(([key, entry]) => `${key}=${scalar(entry)}`).join(',')
      : entries.flatMap(([key, entry]) => [key, scalar(entry)]).join(',')
  }
  return scalar(value)
}

/** Serialized `name=value` cookie pieces of one parameter. */
export function serializeCookieParameter(binding: RpcParameterBinding, value: unknown): string[] {
  const enc = (entry: unknown): string => encodeURIComponent(scalar(entry))
  const name = binding.field
  if (binding.contentType !== undefined) return [`${name}=${encodeURIComponent(contentValue(value, binding.contentType))}`]
  const explode = explodeOf(binding)
  if (Array.isArray(value)) {
    return explode ? value.map(item => `${name}=${enc(item)}`) : [`${name}=${value.map(enc).join(',')}`]
  }
  if (isPlainObject(value)) {
    const entries = definedEntries(value)
    return explode
      ? entries.map(([key, entry]) => `${key}=${enc(entry)}`)
      : [`${name}=${entries.flatMap(([key, entry]) => [enc(key), enc(entry)]).join(',')}`]
  }
  return [`${name}=${enc(value)}`]
}

export function serializeQuerystringParameter(binding: RpcParameterBinding, value: unknown): string {
  if (binding.contentType !== undefined && isJsonMediaType(binding.contentType)) {
    return encodeURIComponent(JSON.stringify(value))
  }
  if (!isPlainObject(value)) return encodeURIComponent(scalar(value))
  const pieces: string[] = []
  for (const [key, entry] of definedEntries(value)) {
    for (const item of Array.isArray(entry) ? entry : [entry]) {
      pieces.push(`${encodeURIComponent(key)}=${encodeURIComponent(scalar(item))}`)
    }
  }
  return pieces.join('&')
}

export type EncodedBody = { body: BodyInit; contentType?: string }

export function encodeBody(value: unknown, mediaType: string): EncodedBody {
  const essence = mediaEssence(mediaType)
  if (isJsonMediaType(essence)) return { body: JSON.stringify(value), contentType: mediaType }
  if (essence === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams()
    for (const [key, entry] of isPlainObject(value) ? definedEntries(value) : []) {
      for (const item of Array.isArray(entry) ? entry : [entry]) params.append(key, scalar(item))
    }
    return { body: params, contentType: mediaType }
  }
  if (essence === 'multipart/form-data') {
    const form = new FormData()
    for (const [key, entry] of isPlainObject(value) ? definedEntries(value) : []) {
      for (const item of Array.isArray(entry) ? entry : [entry]) {
        if (item instanceof Blob) form.append(key, item)
        else form.append(key, scalar(item))
      }
    }
    // fetch sets the multipart boundary itself.
    return { body: form }
  }
  if (essence.startsWith('text/')) return { body: scalar(value), contentType: mediaType }
  if (isBinaryBody(value)) return { body: value as BodyInit, contentType: mediaType }
  return { body: JSON.stringify(value), contentType: 'application/json' }
}

function isBinaryBody(value: unknown): boolean {
  return typeof value === 'string'
    || value instanceof Blob
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
}

/** Splits a call input into the URL path, query string, headers and body of the procedure's HTTP route. */
export function buildHttpRequestParts(procedure: RpcProcedure, input: Record<string, unknown>): {
  path: string
  query: string
  headers: Record<string, string>
  body?: EncodedBody
} {
  const bindings = new Map(procedure.http.parameters.map(binding => [binding.field, binding]))
  const query: string[] = []
  const cookies: string[] = []
  const headers: Record<string, string> = {}

  const path = procedure.http.path.replace(/\{([^}]+)\}/g, (_, field: string) => {
    const binding = bindings.get(field)
    const value = input[field]
    if (!binding || value === undefined || value === null) {
      throw new RpcError('INVALID_INPUT', `Missing path parameter "${field}" for ${procedure.name}.`)
    }
    const segment = serializePathParameter(binding, value)
    // An empty segment (`/users/`) matches the parent route once a trailing slash is ignored, and
    // URL resolution turns dot segments into another route: either would call another procedure.
    if (segment === '' || /^(?:\.|%2e){1,2}$/i.test(segment)) {
      throw new RpcError(
        'INVALID_INPUT',
        `Path parameter "${field}" of ${procedure.name} cannot be empty or a dot segment ("${segment}").`,
      )
    }
    return segment
  })

  for (const binding of procedure.http.parameters) {
    const value = input[binding.field]
    if (value === undefined || binding.in === 'path') continue
    if (binding.in === 'query') query.push(...serializeQueryParameter(binding, value))
    else if (binding.in === 'querystring') query.push(serializeQuerystringParameter(binding, value))
    else if (binding.in === 'header') headers[binding.field] = serializeHeaderParameter(binding, value)
    else cookies.push(...serializeCookieParameter(binding, value))
  }
  if (cookies.length > 0) headers.cookie = cookies.join('; ')

  const bodyBinding = procedure.http.body
  let body: EncodedBody | undefined
  if (bodyBinding?.mode === 'field') {
    const value = input[bodyBinding.field]
    if (value !== undefined) body = encodeBody(value, bodyBinding.mediaType)
  } else if (bodyBinding?.mode === 'spread') {
    const fields = Object.fromEntries(Object.entries(input).filter(([field, value]) => !bindings.has(field) && value !== undefined))
    if (bodyBinding.required || Object.keys(fields).length > 0) body = encodeBody(fields, bodyBinding.mediaType)
  }

  return {
    path,
    query: query.join('&'),
    headers,
    ...(body === undefined ? {} : { body }),
  }
}

/** Reads a response or request body by its content type; empty bodies read as `undefined`. */
export async function readBody(message: Request | Response): Promise<unknown> {
  const contentType = message.headers.get('content-type') ?? ''
  const essence = mediaEssence(contentType)
  if (isJsonMediaType(essence)) {
    const text = await message.text()
    if (text === '') return undefined
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new RpcError('PARSE_ERROR', 'Body is not valid JSON.', { cause: error })
    }
  }
  if (essence === 'application/x-www-form-urlencoded') {
    return pairsToObject(parsePairs(await message.text()))
  }
  if (essence === 'multipart/form-data') {
    const form = await message.formData()
    const result: Record<string, unknown> = {}
    form.forEach((value, key) => appendField(result, key, value))
    return result
  }
  if (essence.startsWith('text/')) {
    const text = await message.text()
    return text === '' ? undefined : text
  }
  const bytes = new Uint8Array(await message.arrayBuffer())
  return bytes.byteLength === 0 ? undefined : bytes
}

// ─── Server side: HTTP request → input ──────────────────────────────────────

type ValueKind = 'array' | 'object' | 'primitive'

/**
 * Defines an own enumerable property. Keys decoded from a request may be `__proto__`, which plain
 * assignment would turn into a prototype change instead of data.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export class SchemaResolver {
  constructor(private readonly schemas: RpcContract['schemas']) {}

  resolve(schema: OasSchema | undefined): OasSchema {
    let current = schema ?? {}
    const seen = new Set<string>()
    while (typeof current.$ref === 'string' && !seen.has(current.$ref)) {
      seen.add(current.$ref)
      const match = current.$ref.match(/^#\/components\/schemas\/(.+)$/)
      const target = match?.[1] === undefined ? undefined : this.schemas[unescapePointerToken(match[1])]
      if (!target) break
      current = target
    }
    return current
  }

  /** The schema and the members of its `allOf`, `anyOf`, and `oneOf`, resolved and flattened. */
  private branches(schema: OasSchema | undefined, seen: Set<OasSchema> = new Set()): OasSchema[] {
    const resolved = this.resolve(schema)
    if (seen.has(resolved)) return []
    seen.add(resolved)
    const members = [...(resolved.allOf ?? []), ...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])]
    return [resolved, ...members.flatMap(member => this.branches(member, seen))]
  }

  private types(schema: OasSchema | undefined): string[] {
    return [...new Set(this.branches(schema).flatMap(typesOf))]
  }

  kind(schema: OasSchema | undefined): ValueKind {
    const types = this.types(schema)
    if (types.includes('array')) return 'array'
    if (types.includes('object') || this.branches(schema).some(branch => branch.properties !== undefined)) return 'object'
    return 'primitive'
  }

  /** Converts a raw string to the number or boolean the schema asks for; other values stay strings. */
  coerce(raw: string, schema: OasSchema | undefined): unknown {
    const types = this.types(schema)
    if (types.includes('string')) return raw
    if ((types.includes('integer') || types.includes('number')) && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
      return Number(raw)
    }
    if (types.includes('boolean') && (raw === 'true' || raw === 'false')) return raw === 'true'
    if (types.includes('null') && raw === 'null') return null
    return raw
  }

  itemSchema(schema: OasSchema | undefined): OasSchema | undefined {
    return this.branches(schema).find(branch => branch.items !== undefined)?.items
  }

  /** Property names the schema declares. */
  propertyNames(schema: OasSchema | undefined): string[] {
    return [...new Set(this.branches(schema).flatMap(branch => Object.keys(branch.properties ?? {})))]
  }

  /** Whether the schema accepts properties it does not declare. */
  allowsAdditional(schema: OasSchema | undefined): boolean {
    const branches = this.branches(schema)
    return branches.some(branch => branch.additionalProperties !== undefined && branch.additionalProperties !== false)
      || branches.every(branch => branch.properties === undefined)
  }

  propertySchema(schema: OasSchema | undefined, property: string): OasSchema | undefined {
    for (const branch of this.branches(schema)) {
      if (branch.properties && Object.hasOwn(branch.properties, property)) return branch.properties[property]
    }
    for (const branch of this.branches(schema)) {
      if (typeof branch.additionalProperties === 'object') return branch.additionalProperties
    }
    return undefined
  }

  coerceObject(raw: Record<string, unknown>, schema: OasSchema | undefined): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) {
      const propertySchema = this.propertySchema(schema, key)
      // A repeated form field is collected into an array only once it occurs twice.
      const items = Array.isArray(value) ? value : this.kind(propertySchema) === 'array' ? [value] : undefined
      setOwn(result, key, items !== undefined
        ? items.map(item => typeof item === 'string' ? this.coerce(item, this.itemSchema(propertySchema) ?? propertySchema) : item)
        : typeof value === 'string' ? this.coerce(value, propertySchema) : value)
    }
    return result
  }
}

function typesOf(schema: OasSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type
  if (typeof schema.type === 'string') return [schema.type]
  const values = schema.enum ?? (schema.const === undefined ? [] : [schema.const])
  return [...new Set(values.map(value => value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value))]
}

function unescapePointerToken(token: string): string {
  return decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~')
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Decodes a form-urlencoded piece, where `+` is a space. */
function decodeForm(value: string): string {
  return decodeComponent(value.replace(/\+/g, ' '))
}

/** Parses `a=1&b=2` into pairs of decoded key, decoded value, and the still-encoded value. */
export function parsePairs(search: string): Pair[] {
  const source = search.startsWith('?') ? search.slice(1) : search
  if (source === '') return []
  return source.split('&').filter(piece => piece !== '').map(piece => {
    const index = piece.indexOf('=')
    const key = index === -1 ? piece : piece.slice(0, index)
    const raw = index === -1 ? '' : piece.slice(index + 1)
    return [decodeForm(key), decodeForm(raw), raw]
  })
}

function appendField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (!Object.hasOwn(target, key)) setOwn(target, key, value)
  else if (Array.isArray(target[key])) (target[key] as unknown[]).push(value)
  else setOwn(target, key, [target[key], value])
}

function pairsToObject(pairs: readonly Pair[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of pairs) appendField(result, key, value)
  return result
}

/**
 * Decodes a delimited parameter value. The value is split while still encoded, so an encoded
 * delimiter inside an item stays part of it; `decode` then undoes the encoding of each piece.
 */
function decodeDelimited(
  raw: string,
  kind: ValueKind,
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
  options: { separator: string | RegExp; pairSeparator?: string; decode: (value: string) => string },
): unknown {
  const { separator, pairSeparator, decode } = options
  if (kind === 'primitive') return resolver.coerce(decode(raw), schema)
  const parts = raw === '' ? [] : raw.split(separator).map(part => part.trim())
  if (kind === 'array') {
    return parts.map(item => resolver.coerce(decode(item), resolver.itemSchema(schema)))
  }
  const result: Record<string, unknown> = {}
  const assign = (rawKey: string, rawValue: string): void => {
    const key = decode(rawKey)
    setOwn(result, key, resolver.coerce(decode(rawValue), resolver.propertySchema(schema, key)))
  }
  if (pairSeparator !== undefined) {
    for (const part of parts) {
      const index = part.indexOf(pairSeparator)
      if (index !== -1) assign(part.slice(0, index), part.slice(index + 1))
    }
  } else {
    for (let index = 0; index + 1 < parts.length; index += 2) assign(parts[index]!, parts[index + 1]!)
  }
  return result
}

const identity = (value: string): string => value

export function deserializePathParameter(
  binding: RpcParameterBinding,
  raw: string,
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
): unknown {
  if (binding.contentType !== undefined) return parseContent(decodeComponent(raw), binding.contentType)
  const style = styleOf(binding)
  const explode = explodeOf(binding)
  const kind = resolver.kind(schema)

  const pairSeparator = kind === 'object' && explode ? { pairSeparator: '=' } : {}

  if (style === 'label') {
    const body = raw.startsWith('.') ? raw.slice(1) : raw
    return decodeDelimited(body, kind, schema, resolver, { separator: explode ? '.' : ',', ...pairSeparator, decode: decodeComponent })
  }
  if (style === 'matrix') {
    if (kind === 'object' && explode) {
      return decodeDelimited(raw.replace(/^;/, ''), kind, schema, resolver, { separator: ';', pairSeparator: '=', decode: decodeComponent })
    }
    if (kind === 'array' && explode) {
      const items = raw.split(';').filter(piece => piece !== '').map(piece => piece.slice(piece.indexOf('=') + 1))
      return items.map(item => resolver.coerce(decodeComponent(item), resolver.itemSchema(schema)))
    }
    const prefix = `;${binding.field}=`
    const body = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
    return decodeDelimited(body, kind, schema, resolver, { separator: ',', decode: decodeComponent })
  }
  return decodeDelimited(raw, kind, schema, resolver, { separator: ',', ...pairSeparator, decode: decodeComponent })
}

/**
 * Collects a form-exploded object: its declared properties, plus, when the schema accepts more,
 * every pair whose key no other parameter of the operation claims.
 */
function explodedObject(
  pairs: readonly Pair[],
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
  claimed: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const declared = new Set(resolver.propertyNames(schema))
  const additional = resolver.allowsAdditional(schema)
  // `name[key]` belongs to the deepObject parameter `name`.
  const isClaimed = (key: string): boolean => claimed.has(key) || claimed.has(key.replace(/\[[^\]]*\]$/, ''))
  const result: Record<string, unknown> = {}
  for (const [key, value] of pairs) {
    if (Object.hasOwn(result, key)) continue
    if (declared.has(key) || (additional && !isClaimed(key))) {
      setOwn(result, key, resolver.coerce(value, resolver.propertySchema(schema, key)))
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function deserializeQueryParameter(
  binding: RpcParameterBinding,
  pairs: readonly Pair[],
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
  claimed: ReadonlySet<string> = new Set(),
): unknown {
  const name = binding.field
  const matches = pairs.filter(([key]) => key === name)
  const values = matches.map(([, value]) => value)
  if (binding.contentType !== undefined) {
    return values[0] === undefined ? undefined : parseContent(values[0], binding.contentType)
  }
  const style = styleOf(binding)
  const explode = explodeOf(binding)
  const kind = resolver.kind(schema)
  const firstRaw = matches[0]?.[2]

  if (kind === 'array') {
    if (firstRaw === undefined) return undefined
    const itemSchema = resolver.itemSchema(schema)
    if (style === 'form' && explode) return values.map(value => resolver.coerce(value, itemSchema))
    const separator = style === 'spaceDelimited' ? /%20|\+| / : style === 'pipeDelimited' ? '|' : ','
    return decodeDelimited(firstRaw, kind, schema, resolver, { separator, decode: decodeForm })
  }
  if (kind === 'object') {
    if (style === 'deepObject') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of pairs) {
        const match = key.match(/^(.*)\[([^\]]*)\]$/)
        if (match?.[1] !== name) continue
        setOwn(result, match[2]!, resolver.coerce(value, resolver.propertySchema(schema, match[2]!)))
      }
      return Object.keys(result).length === 0 ? undefined : result
    }
    if (explode) return explodedObject(pairs, schema, resolver, claimed)
    if (firstRaw === undefined) return undefined
    return decodeDelimited(firstRaw, kind, schema, resolver, { separator: ',', decode: decodeForm })
  }
  return values[0] === undefined ? undefined : resolver.coerce(values[0], schema)
}

export function deserializeHeaderParameter(
  binding: RpcParameterBinding,
  raw: string | null,
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
): unknown {
  if (raw === null) return undefined
  if (binding.contentType !== undefined) return parseContent(raw, binding.contentType)
  const kind = resolver.kind(schema)
  return decodeDelimited(raw, kind, schema, resolver, {
    separator: ',',
    ...(kind === 'object' && explodeOf(binding) ? { pairSeparator: '=' } : {}),
    decode: identity,
  })
}

/** Parses a `Cookie` header into pairs of name, decoded value, and the still-encoded value. */
export function parseCookies(header: string | null): Pair[] {
  if (!header) return []
  return header.split(';').map(piece => piece.trim()).filter(piece => piece !== '').map(piece => {
    const index = piece.indexOf('=')
    if (index === -1) return [piece, '', '']
    const raw = piece.slice(index + 1)
    return [piece.slice(0, index), decodeComponent(raw), raw]
  })
}

export function deserializeCookieParameter(
  binding: RpcParameterBinding,
  cookies: readonly Pair[],
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
  claimed: ReadonlySet<string> = new Set(),
): unknown {
  const matches = cookies.filter(([key]) => key === binding.field)
  const values = matches.map(([, value]) => value)
  if (binding.contentType !== undefined) {
    return values[0] === undefined ? undefined : parseContent(values[0], binding.contentType)
  }
  const kind = resolver.kind(schema)
  const firstRaw = matches[0]?.[2]
  if (kind === 'array') {
    if (firstRaw === undefined) return undefined
    if (explodeOf(binding)) return values.map(item => resolver.coerce(item, resolver.itemSchema(schema)))
    return decodeDelimited(firstRaw, kind, schema, resolver, { separator: ',', decode: decodeComponent })
  }
  if (kind === 'object') {
    if (explodeOf(binding)) return explodedObject(cookies, schema, resolver, claimed)
    if (firstRaw === undefined) return undefined
    return decodeDelimited(firstRaw, kind, schema, resolver, { separator: ',', decode: decodeComponent })
  }
  return values[0] === undefined ? undefined : resolver.coerce(values[0], schema)
}

export function deserializeQuerystringParameter(
  binding: RpcParameterBinding,
  search: string,
  schema: OasSchema | undefined,
  resolver: SchemaResolver,
): unknown {
  const source = search.startsWith('?') ? search.slice(1) : search
  if (source === '') return undefined
  if (binding.contentType !== undefined && isJsonMediaType(binding.contentType)) {
    return parseContent(decodeComponent(source), binding.contentType)
  }
  return resolver.coerceObject(pairsToObject(parsePairs(source)), schema)
}

function parseContent(raw: string, contentType: string): unknown {
  if (!isJsonMediaType(contentType)) return raw
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new RpcError('BAD_REQUEST', 'Parameter is not valid JSON.', { cause: error })
  }
}

/** Encodes a handler result as a response body of the given media type. */
export function encodeResponseBody(value: unknown, mediaType: string | undefined): EncodedBody | undefined {
  if (value === undefined) return undefined
  if (mediaType === undefined || isJsonMediaType(mediaType)) {
    return { body: JSON.stringify(value), contentType: mediaType ?? 'application/json' }
  }
  return encodeBody(value, mediaType)
}
