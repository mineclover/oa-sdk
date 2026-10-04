import type { OasSchema } from '@oa-sdk/parser'
import { escapeJsonPointerToken } from '@oa-sdk/parser/browser'

export const XML_SUPPORTED_SCOPE =
  'application/xml element-only scope: object child elements, repeated elements for arrays, primitive text values, and xml.name element renaming. Attributes, namespaces/prefixes, CDATA/text node modeling, nodeType values other than element, and wrapped-array XML Object semantics are not supported.'

export type XmlParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; expected?: string; received?: unknown }

export type XmlUnsupportedFeature = {
  path: string
  feature: string
  message: string
}

type XmlElementNode = {
  name: string
  children: XmlElementNode[]
  text: string
}

const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export function isXmlMediaType(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/xml'
}

export function parseXmlBody(raw: string, schema?: OasSchema): XmlParseResult {
  const unsupported = collectUnsupportedXmlFeatures(schema)
  if (unsupported.length > 0) {
    const first = unsupported[0]!
    return {
      ok: false,
      message: first.message,
      expected: XML_SUPPORTED_SCOPE,
      received: first.feature,
    }
  }

  try {
    const root = parseXmlDocument(raw)
    const expectedRoot = schema?.xml?.name
    if (expectedRoot && root.name !== expectedRoot) {
      return {
        ok: false,
        message: `XML root element '${root.name}' does not match schema xml.name '${expectedRoot}'`,
        expected: expectedRoot,
        received: root.name,
      }
    }
    return { ok: true, value: nodeToValue(root, schema) }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      expected: XML_SUPPORTED_SCOPE,
      received: raw,
    }
  }
}

export function serializeXmlBody(body: unknown, schema?: OasSchema): string {
  const rootName = xmlElementName(schema, defaultRootName(body))
  return serializeElement(rootName, body, schema, true)
}

export function collectUnsupportedXmlFeatures(
  schema: OasSchema | undefined,
  basePath = '/schema',
  seen = new WeakSet<object>(),
): XmlUnsupportedFeature[] {
  if (!schema || typeof schema !== 'object') return []
  if (seen.has(schema)) return []
  seen.add(schema)

  const features: XmlUnsupportedFeature[] = []
  const xml = schema.xml
  if (xml) {
    const xmlPath = `${basePath}/xml`
    if (xml.nodeType !== undefined && xml.nodeType !== 'element') {
      features.push({
        path: `${xmlPath}/nodeType`,
        feature: `nodeType=${xml.nodeType}`,
        message: `XML nodeType '${xml.nodeType}' is outside the supported element-only XML scope`,
      })
    }
    if (xml.attribute === true) {
      features.push({
        path: `${xmlPath}/attribute`,
        feature: 'attribute=true',
        message: 'XML attributes are outside the supported element-only XML scope',
      })
    }
    if (xml.wrapped === true) {
      features.push({
        path: `${xmlPath}/wrapped`,
        feature: 'wrapped=true',
        message: 'XML wrapped-array semantics are outside the supported XML scope',
      })
    }
    if (xml.namespace !== undefined) {
      features.push({
        path: `${xmlPath}/namespace`,
        feature: 'namespace',
        message: 'XML namespaces are outside the supported XML scope',
      })
    }
    if (xml.prefix !== undefined) {
      features.push({
        path: `${xmlPath}/prefix`,
        feature: 'prefix',
        message: 'XML namespace prefixes are outside the supported XML scope',
      })
    }
  }

  if (schema.items) features.push(...collectUnsupportedXmlFeatures(schema.items, `${basePath}/items`, seen))
  schema.prefixItems?.forEach((item, index) => {
    features.push(...collectUnsupportedXmlFeatures(item, `${basePath}/prefixItems/${index}`, seen))
  })
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    features.push(...collectUnsupportedXmlFeatures(property, `${basePath}/properties/${escapeJsonPointerToken(name)}`, seen))
  }
  for (const [name, property] of Object.entries(schema.patternProperties ?? {})) {
    features.push(...collectUnsupportedXmlFeatures(property, `${basePath}/patternProperties/${escapeJsonPointerToken(name)}`, seen))
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    features.push(...collectUnsupportedXmlFeatures(schema.additionalProperties, `${basePath}/additionalProperties`, seen))
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    schema[keyword]?.forEach((item, index) => {
      features.push(...collectUnsupportedXmlFeatures(item, `${basePath}/${keyword}/${index}`, seen))
    })
  }
  if (schema.not) features.push(...collectUnsupportedXmlFeatures(schema.not, `${basePath}/not`, seen))
  if (schema.if) features.push(...collectUnsupportedXmlFeatures(schema.if, `${basePath}/if`, seen))
  if (schema.then) features.push(...collectUnsupportedXmlFeatures(schema.then, `${basePath}/then`, seen))
  if (schema.else) features.push(...collectUnsupportedXmlFeatures(schema.else, `${basePath}/else`, seen))
  return features
}

function parseXmlDocument(raw: string): XmlElementNode {
  if (raw.includes('<![CDATA[')) throw new Error('XML CDATA sections are not supported')
  if (/<!DOCTYPE/i.test(raw)) throw new Error('XML DOCTYPE declarations are not supported')
  if (/<\?/.test(raw.replace(/^\s*<\?xml[^>]*\?>/i, ''))) {
    throw new Error('XML processing instructions are not supported')
  }

  const source = raw
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[^>]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const root: XmlElementNode = { name: '#document', children: [], text: '' }
  const stack: XmlElementNode[] = [root]
  const tokenPattern = /<[^>]+>|[^<]+/g
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(source)) !== null) {
    const token = match[0]!
    if (token.startsWith('<')) {
      readXmlTag(token, stack)
      continue
    }

    const text = token.trim()
    if (text === '') continue
    stack[stack.length - 1]!.text += decodeXmlText(text)
  }

  if (stack.length !== 1) {
    const open = stack[stack.length - 1]!
    throw new Error(`XML element '${open.name}' is missing a closing tag`)
  }
  if (root.children.length !== 1) {
    throw new Error(root.children.length === 0 ? 'XML document has no root element' : 'XML document has multiple root elements')
  }
  return root.children[0]!
}

function readXmlTag(token: string, stack: XmlElementNode[]): void {
  if (token.startsWith('</')) {
    const name = token.slice(2, -1).trim()
    assertSupportedElementName(name)
    const current = stack.pop()
    if (!current || current.name !== name) {
      throw new Error(`XML closing tag '${name}' does not match the current element`)
    }
    return
  }

  if (token.startsWith('<!')) {
    throw new Error('XML declarations other than comments are not supported')
  }

  const selfClosing = token.endsWith('/>')
  const rawName = token.slice(1, selfClosing ? -2 : -1).trim()
  if (/\s/.test(rawName)) throw new Error('XML attributes are not supported')
  assertSupportedElementName(rawName)

  const node: XmlElementNode = { name: rawName, children: [], text: '' }
  stack[stack.length - 1]!.children.push(node)
  if (!selfClosing) stack.push(node)
}

function assertSupportedElementName(name: string): void {
  if (name.includes(':')) throw new Error('XML namespaces are not supported')
  if (!XML_NAME_PATTERN.test(name)) throw new Error(`XML element name '${name}' is not supported`)
}

function nodeToValue(node: XmlElementNode, schema: OasSchema | undefined): unknown {
  const kind = getSchemaKind(schema, node)
  if (kind === 'array') return nodesToArray([node], schema)
  if (kind === 'object') return nodeToObject(node, schema)
  return coercePrimitive(node.text, schema)
}

function nodeToObject(node: XmlElementNode, schema: OasSchema | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const childGroups = groupChildrenByName(node.children)
  const consumed = new Set<string>()

  for (const [propertyName, propertySchema] of Object.entries(schema?.properties ?? {})) {
    const elementName = xmlElementName(propertySchema, propertyName)
    const children = childGroups.get(elementName)
    if (!children || children.length === 0) continue
    consumed.add(elementName)
    result[propertyName] = getSchemaKind(propertySchema) === 'array'
      ? nodesToArray(children, propertySchema)
      : children.length === 1
        ? nodeToValue(children[0]!, propertySchema)
        : children.map(child => nodeToValue(child, propertySchema))
  }

  for (const [elementName, children] of childGroups) {
    if (consumed.has(elementName)) continue
    result[elementName] = children.length === 1
      ? nodeToPlainValue(children[0]!)
      : children.map(nodeToPlainValue)
  }

  return result
}

function nodesToArray(nodes: XmlElementNode[], schema: OasSchema | undefined): unknown[] {
  const itemSchema = schema?.items
  if (nodes.length === 1 && nodes[0]!.children.length > 0) {
    const itemName = xmlElementName(itemSchema, 'item')
    const itemChildren = nodes[0]!.children.filter(child => child.name === itemName)
    if (itemChildren.length > 0) return itemChildren.map(child => nodeToValue(child, itemSchema))
  }
  return nodes.map(node => nodeToValue(node, itemSchema))
}

function nodeToPlainValue(node: XmlElementNode): unknown {
  if (node.children.length === 0) return node.text
  const groups = groupChildrenByName(node.children)
  const result: Record<string, unknown> = {}
  for (const [name, children] of groups) {
    result[name] = children.length === 1 ? nodeToPlainValue(children[0]!) : children.map(nodeToPlainValue)
  }
  return result
}

function groupChildrenByName(children: XmlElementNode[]): Map<string, XmlElementNode[]> {
  const groups = new Map<string, XmlElementNode[]>()
  for (const child of children) {
    const existing = groups.get(child.name)
    if (existing) existing.push(child)
    else groups.set(child.name, [child])
  }
  return groups
}

function serializeElement(name: string, value: unknown, schema: OasSchema | undefined, root = false): string {
  if (value === undefined || value === null) return `<${name}/>`
  if (Array.isArray(value)) {
    const itemSchema = schema?.items
    const itemName = xmlElementName(itemSchema, 'item')
    const children = value.map(item => serializeElement(itemName, item, itemSchema)).join('')
    return root ? `<${name}>${children}</${name}>` : children
  }
  if (isRecord(value)) {
    return `<${name}>${serializeObjectChildren(value, schema)}</${name}>`
  }
  return `<${name}>${escapeXmlText(String(value))}</${name}>`
}

function serializeObjectChildren(value: Record<string, unknown>, schema: OasSchema | undefined): string {
  const properties = schema?.properties ?? {}
  const orderedKeys = [
    ...Object.keys(properties).filter(key => Object.prototype.hasOwnProperty.call(value, key)),
    ...Object.keys(value).filter(key => !Object.prototype.hasOwnProperty.call(properties, key)),
  ]

  return orderedKeys.map(key => {
    const item = value[key]
    if (item === undefined) return ''
    const propertySchema = properties[key]
    const elementName = xmlElementName(propertySchema, key)
    if (Array.isArray(item)) {
      const itemSchema = propertySchema?.items
      return item.map(entry => serializeElement(elementName, entry, itemSchema)).join('')
    }
    return serializeElement(elementName, item, propertySchema)
  }).join('')
}

function getSchemaKind(schema: OasSchema | undefined, node?: XmlElementNode): 'array' | 'object' | 'primitive' {
  const type = firstSchemaType(schema)
  if (type === 'array' || schema?.items !== undefined || schema?.prefixItems !== undefined) return 'array'
  if (
    type === 'object' ||
    schema?.properties !== undefined ||
    schema?.additionalProperties !== undefined ||
    schema?.patternProperties !== undefined
  ) {
    return 'object'
  }
  if (!schema && node && node.children.length > 0) return 'object'
  return 'primitive'
}

function firstSchemaType(schema: OasSchema | undefined): string | undefined {
  const type = schema?.type
  if (Array.isArray(type)) return type.find(item => item !== 'null')
  return type
}

function coercePrimitive(value: string, schema: OasSchema | undefined): unknown {
  const type = firstSchemaType(schema)
  if (type === 'integer') {
    const number = Number(value)
    return Number.isInteger(number) ? number : value
  }
  if (type === 'number') {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  if (type === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return value
}

function xmlElementName(schema: OasSchema | undefined, fallback: string): string {
  const name = schema?.xml?.name
  return name && XML_NAME_PATTERN.test(name) && !name.includes(':') ? name : sanitizeXmlName(fallback)
}

function defaultRootName(body: unknown): string {
  if (Array.isArray(body)) return 'items'
  if (isRecord(body)) return 'response'
  return 'value'
}

function sanitizeXmlName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (XML_NAME_PATTERN.test(sanitized)) return sanitized
  return `_${sanitized || 'value'}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase()
    switch (normalized) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return '\''
      default: {
        const codePoint = normalized.startsWith('#x')
          ? Number.parseInt(normalized.slice(2), 16)
          : Number.parseInt(normalized.slice(1), 10)
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`
      }
    }
  })
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
