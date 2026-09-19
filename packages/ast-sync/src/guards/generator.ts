import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import standaloneCode from 'ajv/dist/standalone/index.js'
import type {
  GeneratedGuardArtifact,
  StandaloneGuardGeneratorOptions,
  StandaloneGuardTarget,
} from './types.js'

const DATE_PART =
  '(?:(?:\\d{4}-(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01]))|(?:\\d{4}-(?:0[469]|11)-(?:0[1-9]|[12]\\d|30))|(?:\\d{4}-02-(?:0[1-9]|1\\d|2[0-8]))|(?:(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29))'
const TIME_PART =
  '(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d|23:59:60)(?:\\.\\d+)?(?:[Zz]|[+-](?:[01]\\d|2[0-3])(?::?[0-5]\\d)?)?'

/**
 * Zero-runtime-dependency format validators for JSON Schema Draft 2020-12 and OpenAPI 3.1.
 * Emits pure inlinable RegExp literals and standalone predicates with 0 external require/import.
 */
const STANDALONE_FORMATS: Record<string, RegExp | boolean | { type: string; validate: (v: any) => boolean }> = {
  'date-time': new RegExp(`^${DATE_PART}[Tt\\s]${TIME_PART}$`, 'i'),
  date: new RegExp(`^${DATE_PART}$`),
  time: new RegExp(`^(?:${TIME_PART})$`, 'i'),
  'iso-date-time': new RegExp(`^${DATE_PART}[Tt\\s]${TIME_PART}$`, 'i'),
  'iso-time': new RegExp(`^(?:${TIME_PART})$`, 'i'),
  duration: /^P(?!$)(?:(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?|\d+W)$/,
  uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
  'uri-reference': /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
  'uri-template': /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
  url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
  email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
  hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[a-z0-9])?)*\.?$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
  ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
  uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
  'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
  'json-pointer-uri-fragment': /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
  'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
  byte: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  int32: true,
  int64: true,
  float: true,
  double: true,
  password: true,
  binary: true,
  regex: true,
}

const UCS2LENGTH_INLINE = `function __ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}`

const EQUAL_INLINE = `function __equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false;
    let length, i, keys;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0;)
        if (!__equal(a[i], b[i])) return false;
      return true;
    }
    keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;
    for (i = length; i-- !== 0;)
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
    for (i = length; i-- !== 0;) {
      let key = keys[i];
      if (!__equal(a[key], b[key])) return false;
    }
    return true;
  }
  return a !== a && b !== b;
}`

/**
 * Post-processes standalone JavaScript generated by Ajv to ensure:
 * 1. Clean typed function export syntax.
 * 2. Inlining of any runtime helper dependencies (ucs2length, fast-deep-equal).
 */
function resolveSchema(
  schema: unknown,
  rootDoc: Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof schema === 'string') {
    const hashIndex = schema.indexOf('#')
    const pointer = hashIndex !== -1 ? schema.slice(hashIndex) : schema

    if (pointer.startsWith('#/$defs/')) {
      const defName = pointer.slice('#/$defs/'.length)
      const defs = (rootDoc.$defs || (rootDoc as Record<string, unknown>).definitions) as Record<string, unknown> | undefined
      return (defs?.[defName] as Record<string, unknown>) ?? null
    }
    if (pointer.startsWith('#/components/schemas/')) {
      const name = pointer.slice('#/components/schemas/'.length)
      const comp = (rootDoc.components as Record<string, unknown> | undefined)?.schemas as Record<string, unknown> | undefined
      return (comp?.[name] as Record<string, unknown>) ?? null
    }
    return null
  }
  if (typeof schema === 'object' && schema !== null) {
    const s = schema as Record<string, unknown>
    if (typeof s.$ref === 'string') {
      return resolveSchema(s.$ref, rootDoc)
    }
    return s
  }
  return null
}

function buildFastPathCode(
  guardName: string,
  schema: Record<string, unknown>,
): { fnName: string; code: string } | null {
  const conds: string[] = []

  const schemaType = schema.type as string | string[] | undefined
  const isObject = schemaType === 'object' || schema.properties !== undefined || schema.required !== undefined

  if (isObject) {
    conds.push("typeof data === 'object' && data !== null && !Array.isArray(data)")

    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (typeof req === 'string') {
          conds.push(`('${req}' in data && (data)[${JSON.stringify(req)}] !== undefined)`)
        }
      }
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [prop, propSchemaRaw] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (!propSchemaRaw || typeof propSchemaRaw !== 'object') continue
        const propSchema = propSchemaRaw as Record<string, unknown>
        const pKey = `(data)[${JSON.stringify(prop)}]`

        if (propSchema.const !== undefined) {
          conds.push(`(${pKey} === ${JSON.stringify(propSchema.const)})`)
        } else if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0 && propSchema.enum.length <= 8) {
          const enumArr = JSON.stringify(propSchema.enum)
          conds.push(`(${pKey} === undefined || ${enumArr}.includes(${pKey}))`)
        }

        if (propSchema.type === 'string') {
          conds.push(`(${pKey} === undefined || typeof ${pKey} === 'string')`)
          if (typeof propSchema.minLength === 'number') {
            conds.push(`(${pKey} === undefined || (typeof ${pKey} === 'string' && ${pKey}.length >= ${propSchema.minLength}))`)
          }
        } else if (propSchema.type === 'number') {
          conds.push(`(${pKey} === undefined || (typeof ${pKey} === 'number' && !Number.isNaN(${pKey})))`)
          if (typeof propSchema.minimum === 'number') {
            conds.push(`(${pKey} === undefined || ${pKey} >= ${propSchema.minimum})`)
          }
          if (typeof propSchema.maximum === 'number') {
            conds.push(`(${pKey} === undefined || ${pKey} <= ${propSchema.maximum})`)
          }
        } else if (propSchema.type === 'integer') {
          conds.push(`(${pKey} === undefined || (typeof ${pKey} === 'number' && Number.isInteger(${pKey})))`)
          if (typeof propSchema.minimum === 'number') {
            conds.push(`(${pKey} === undefined || ${pKey} >= ${propSchema.minimum})`)
          }
          if (typeof propSchema.maximum === 'number') {
            conds.push(`(${pKey} === undefined || ${pKey} <= ${propSchema.maximum})`)
          }
        } else if (propSchema.type === 'boolean') {
          conds.push(`(${pKey} === undefined || typeof ${pKey} === 'boolean')`)
        }
      }
    }
  } else if (schemaType === 'string') {
    conds.push("typeof data === 'string'")
    if (typeof schema.minLength === 'number') {
      conds.push(`data.length >= ${schema.minLength}`)
    }
  } else if (schemaType === 'number') {
    conds.push("typeof data === 'number' && !Number.isNaN(data)")
  } else if (schemaType === 'integer') {
    conds.push("typeof data === 'number' && Number.isInteger(data)")
  } else if (schemaType === 'boolean') {
    conds.push("typeof data === 'boolean'")
  } else if (schemaType === 'array') {
    conds.push("Array.isArray(data)")
  }

  if (conds.length === 0) return null

  const fnName = `__fastValidate_${guardName}`
  const code = `function ${fnName}(data) {\n  return (\n    ${conds.join(' &&\n    ')}\n  );\n}`
  return { fnName, code }
}

function buildPolymorphicDispatch(
  guardName: string,
  schema: Record<string, unknown>,
  rootDoc: Record<string, unknown>,
  availableGuards: Set<string>,
): { tableName: string; keyProp: string; code: string; referencedGuards: string[] } | null {
  const branches = (schema.oneOf || schema.anyOf) as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(branches) || branches.length === 0) return null

  let discProp: string | undefined
  const disc = schema.discriminator as Record<string, unknown> | undefined
  if (disc && typeof disc.propertyName === 'string') {
    discProp = disc.propertyName
  }

  if (!discProp) {
    const candidateProps = ['type', 'kind', 'format', 'payloadFormat', 'event']
    for (const cand of candidateProps) {
      const allHave = branches.every(b => {
        const res = resolveSchema(b, rootDoc)
        const props = res?.properties as Record<string, unknown> | undefined
        return props?.[cand] !== undefined
      })
      if (allHave) {
        discProp = cand
        break
      }
    }
  }

  if (!discProp) return null

  const mapping: Record<string, string> = {}
  if (disc?.mapping && typeof disc.mapping === 'object') {
    for (const [key, ref] of Object.entries(disc.mapping as Record<string, string>)) {
      const targetName = ref.replace(/^.*?#\/(\$defs|components\/schemas)\//, '')
      const fnName = targetName.startsWith('is') ? targetName : `is${targetName}`
      if (availableGuards.has(fnName)) {
        mapping[key] = fnName
      }
    }
  } else {
    for (const b of branches) {
      const res = resolveSchema(b, rootDoc)
      if (!res) continue
      const props = res.properties as Record<string, unknown> | undefined
      const propSchema = props?.[discProp] as Record<string, unknown> | undefined
      const constVal = propSchema?.const ?? (Array.isArray(propSchema?.enum) ? propSchema?.enum[0] : undefined)
      if (typeof constVal === 'string' || typeof constVal === 'number') {
        const refName = typeof b.$ref === 'string'
          ? b.$ref.replace(/^.*?#\/(\$defs|components\/schemas)\//, '')
          : ((res.title || res.name) as string | undefined)
        if (refName) {
          const fnName = refName.startsWith('is') ? refName : `is${refName}`
          if (availableGuards.has(fnName)) {
            mapping[String(constVal)] = fnName
          }
        }
      }
    }
  }

  // Only emit dispatch table if all branches are mapped to known available guards
  if (Object.keys(mapping).length === 0 || Object.keys(mapping).length !== branches.length) {
    return null
  }

  const tableName = `__dispatch_${guardName}`
  const tableEntries = Object.entries(mapping)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${v}`)
    .join(',\n')
  const code = `const ${tableName} = {\n${tableEntries}\n};\n`
  const referencedGuards = Array.from(new Set(Object.values(mapping)))

  return { tableName, keyProp: discProp, code, referencedGuards }
}

/**
 * Post-processes standalone JavaScript generated by Ajv to ensure:
 * 1. Clean typed function export syntax (and optional tiered fast-path / dispatch wrapping).
 * 2. Inlining of any runtime helper dependencies (ucs2length, fast-deep-equal).
 * 3. 0 external require() calls and 0 CSP violations.
 */
function postProcessGeneratedJs(
  rawJs: string,
  extra: {
    fastPaths?: Map<string, { fnName: string; code: string }>
    dispatches?: Map<string, { tableName: string; keyProp: string; code: string; referencedGuards?: string[] }>
    tieredGuards?: Set<string>
    guardToFileBase?: Map<string, string>
    currentGuardName?: string
  } = {},
): string {
  let js = rawJs

  // 1. Transform export syntax to standard function
  js = js.replace(
    /export const (\w+) = (\w+);/g,
    (_match, name, fn) => {
      if (extra.dispatches?.has(name)) {
        const disp = extra.dispatches.get(name)!
        return `export function ${name}(data, ...args) {\n  if (typeof data !== 'object' || data === null) return false;\n  const branch = ${disp.tableName}[data[${JSON.stringify(disp.keyProp)}]];\n  if (branch) return branch(data, ...args);\n  return ${fn}(data, ...args);\n}`
      }
      if (extra.tieredGuards?.has(name) && extra.fastPaths?.has(name)) {
        const fp = extra.fastPaths.get(name)!
        return `export function ${name}Fast(data) {\n  return ${fp.fnName}(data);\n}\n\nexport function ${name}(data, ...args) {\n  if (!${fp.fnName}(data)) return false;\n  return ${fn}(data, ...args);\n}`
      }
      return `export function ${name}(data, ...args) {\n  return ${fn}(data, ...args);\n}`
    },
  )

  let needsUcs2 = false
  let needsEqual = false

  // 2. Replace require("ajv/dist/runtime/ucs2length").default
  if (js.includes('require("ajv/dist/runtime/ucs2length")')) {
    needsUcs2 = true
    js = js.replace(
      /const\s+(\w+)\s*=\s*require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g,
      'const $1 = __ucs2length;',
    )
  }

  // 3. Replace require("ajv/dist/runtime/equal").default
  if (js.includes('require("ajv/dist/runtime/equal")')) {
    needsEqual = true
    js = js.replace(
      /const\s+(\w+)\s*=\s*require\("ajv\/dist\/runtime\/equal"\)\.default;/g,
      'const $1 = __equal;',
    )
  }

  // 4. Inlining fallback for any stray require("ajv-formats/dist/formats")
  if (js.includes('require("ajv-formats/dist/formats")')) {
    for (const [fmtName, def] of Object.entries(STANDALONE_FORMATS)) {
      if (def instanceof RegExp) {
        const pattern = new RegExp(
          `const\\s+(\\w+)\\s*=\\s*require\\("ajv-formats/dist/formats"\\)\\.(?:fullFormats|fastFormats)(?:\\["${fmtName}"\\]|\\.${fmtName});`,
          'g',
        )
        js = js.replace(pattern, `const $1 = ${def.toString()};`)
      }
    }
  }

  const imports: string[] = []
  if (extra.currentGuardName && extra.dispatches?.has(extra.currentGuardName) && extra.guardToFileBase) {
    const disp = extra.dispatches.get(extra.currentGuardName)!
    if (disp.referencedGuards) {
      for (const refGuard of disp.referencedGuards) {
        if (refGuard !== extra.currentGuardName) {
          const targetBase = extra.guardToFileBase.get(refGuard) ?? (refGuard.startsWith('is') ? refGuard.slice(2) : refGuard)
          imports.push(`import { ${refGuard} } from './${targetBase}.js';`)
        }
      }
    }
  }

  // Prepend inlined helpers if referenced
  const helperDecls: string[] = []
  if (needsUcs2) helperDecls.push(UCS2LENGTH_INLINE)
  if (needsEqual) helperDecls.push(EQUAL_INLINE)

  if (extra.fastPaths) {
    for (const [name, fp] of extra.fastPaths.entries()) {
      if (extra.tieredGuards?.has(name)) {
        if (!extra.currentGuardName || extra.currentGuardName === name) {
          helperDecls.push(fp.code)
        }
      }
    }
  }
  if (extra.dispatches) {
    for (const [name, disp] of extra.dispatches.entries()) {
      if (!extra.currentGuardName || extra.currentGuardName === name) {
        helperDecls.push(disp.code)
      }
    }
  }

  const prefixParts: string[] = []
  if (imports.length > 0) prefixParts.push(imports.join('\n'))
  if (helperDecls.length > 0) prefixParts.push(helperDecls.join('\n\n'))

  if (prefixParts.length > 0) {
    if (js.startsWith('"use strict";\n') || js.startsWith('"use strict";')) {
      js = js.replace(/^"use strict";(\n)?/, `"use strict";\n\n${prefixParts.join('\n\n')}\n\n`)
    } else {
      js = `${prefixParts.join('\n\n')}\n\n${js}`
    }
  }

  return js
}

/**
 * Automatically discovers guard targets from schemaDocument defs or components if not provided.
 */
function autoDiscoverGuards(doc: Record<string, unknown>): StandaloneGuardTarget[] {
  const targets: StandaloneGuardTarget[] = []

  const defs = (doc.$defs || (doc as Record<string, unknown>).definitions) as Record<string, unknown> | undefined
  if (defs && typeof defs === 'object') {
    const prefix = doc.$defs ? '#/$defs/' : '#/definitions/'
    for (const key of Object.keys(defs)) {
      targets.push({
        name: key.startsWith('is') ? key : `is${key}`,
        typeName: key,
        schema: `${prefix}${key}`,
      })
    }
  }

  const components = (doc.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, unknown>
    | undefined
  if (components && typeof components === 'object') {
    for (const key of Object.keys(components)) {
      if (!targets.some(t => t.typeName === key)) {
        targets.push({
          name: key.startsWith('is') ? key : `is${key}`,
          typeName: key,
          schema: `#/components/schemas/${key}`,
        })
      }
    }
  }

  if (targets.length === 0) {
    const title = ((doc.title || (doc as Record<string, unknown>).name) as string | undefined) || 'Root'
    targets.push({
      name: title.startsWith('is') ? title : `is${title}`,
      typeName: (doc.title as string | undefined) || '',
      schema: doc,
    })
  }

  return targets
}

/**
 * Pre-compiles JSON Schema Draft 2020-12 and OpenAPI 3.1 schemas into pure ESM standalone validator functions
 * and TypeScript type guard declarations (.d.ts) with ZERO runtime dependencies and ZERO eval/new Function.
 */
export async function generateStandaloneGuards(
  options: StandaloneGuardGeneratorOptions,
): Promise<GeneratedGuardArtifact[]> {
  const {
    schemaDocument,
    outDir: rawOutDir,
    typeImportSpecifier,
    generateDeclarations = true,
    split = false,
    schemas,
  } = options

  const outDir = path.resolve(rawOutDir)
  let resolvedGuards = options.guards && options.guards.length > 0
    ? options.guards
    : autoDiscoverGuards(schemaDocument)

  if (schemas && schemas.length > 0) {
    const filterList = schemas.map(s => s.trim()).filter(Boolean)
    resolvedGuards = resolvedGuards.filter(guard => {
      return filterList.some(term => {
        if (guard.name === term) return true
        if (guard.typeName && guard.typeName === term) return true
        if (term.startsWith('is') && guard.typeName && guard.typeName === term.slice(2)) return true
        if (!term.startsWith('is') && guard.name === `is${term}`) return true
        if (guard.name.toLowerCase() === term.toLowerCase()) return true
        if (guard.typeName && guard.typeName.toLowerCase() === term.toLowerCase()) return true
        if (term.toLowerCase().startsWith('is') && guard.typeName && guard.typeName.toLowerCase() === term.slice(2).toLowerCase()) return true
        if (!term.toLowerCase().startsWith('is') && guard.name.toLowerCase() === `is${term.toLowerCase()}`) return true
        return false
      })
    })
  }

  if (resolvedGuards.length === 0) {
    return []
  }

  // Initialize Ajv 2020 with standalone source output configuration
  const AjvCtor: any = (Ajv2020 as any).default ?? Ajv2020
  const ajv = new AjvCtor({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  })

  // Register standalone zero-dependency formats
  for (const [name, format] of Object.entries(STANDALONE_FORMATS)) {
    ajv.addFormat(name, format)
  }

  // Register root document
  const rootDoc = { ...schemaDocument }
  const rootId = (rootDoc.$id as string | undefined) || 'urn:oa-sdk:root'
  if (!rootDoc.$id) {
    rootDoc.$id = rootId
  }
  ajv.addSchema(rootDoc)

  // Register each guard target in Ajv
  const mapping: Record<string, string> = {}
  for (const guard of resolvedGuards) {
    mapping[guard.name] = guard.name

    if (typeof guard.schema === 'string') {
      let ref = guard.schema
      if (ref.startsWith('#')) {
        ref = `${rootId}${ref}`
      }
      ajv.addSchema({ $ref: ref }, guard.name)
    } else if (typeof guard.schema === 'object' && guard.schema !== null) {
      if (guard.schema === schemaDocument || (guard.schema as Record<string, unknown>).$id === rootId) {
        ajv.addSchema({ $ref: rootId }, guard.name)
      } else {
        const customSchema = { ...guard.schema }
        const sId = (customSchema.$id as string | undefined) || `urn:oa-sdk:guard:${guard.name}`
        customSchema.$id = sId
        if (!ajv.getSchema(sId)) {
          ajv.addSchema(customSchema, guard.name)
        } else {
          ajv.addSchema({ $ref: sId }, guard.name)
        }
      }
    }
  }

  const standaloneCodeFn: any = (standaloneCode as any).default ?? standaloneCode
  const artifacts: GeneratedGuardArtifact[] = []

  const tieredGuards = new Set<string>()
  const fastPaths = new Map<string, { fnName: string; code: string }>()
  const dispatches = new Map<string, { tableName: string; keyProp: string; code: string; referencedGuards?: string[] }>()
  const availableGuards = new Set(resolvedGuards.map(g => g.name))

  for (const guard of resolvedGuards) {
    const resolved = resolveSchema(guard.schema, rootDoc)
    if (resolved) {
      if (options.tiered || guard.fastPath) {
        const fp = buildFastPathCode(guard.name, resolved)
        if (fp) {
          fastPaths.set(guard.name, fp)
          tieredGuards.add(guard.name)
        }
      }
      if (options.polymorphicDispatch === true || guard.discriminator !== undefined) {
        const disp = buildPolymorphicDispatch(guard.name, resolved, rootDoc, availableGuards)
        if (disp) {
          dispatches.set(guard.name, disp)
        }
      }
    }
  }

  if (split) {
    const guardsDir = path.join(outDir, 'guards')
    await fs.mkdir(guardsDir, { recursive: true })

    const guardToFileBase = new Map<string, string>()
    for (const g of resolvedGuards) {
      guardToFileBase.set(g.name, g.typeName?.trim() || g.name)
    }

    const indexJsLines: string[] = []
    const indexDtsLines: string[] = []

    for (const guard of resolvedGuards) {
      const fileBase = guard.typeName?.trim() || guard.name
      const rawJs: string = standaloneCodeFn(ajv, { [guard.name]: guard.name })
      const jsContent = postProcessGeneratedJs(rawJs, {
        fastPaths,
        dispatches,
        tieredGuards,
        guardToFileBase,
        currentGuardName: guard.name,
      })

      const jsFilePath = path.join(guardsDir, `${fileBase}.js`)
      await fs.writeFile(jsFilePath, jsContent, 'utf8')
      artifacts.push({
        filePath: jsFilePath,
        content: jsContent,
        kind: 'js',
      })

      if (generateDeclarations) {
        const dtsLines: string[] = []
        const tName = guard.typeName?.trim()
        if (tName && typeImportSpecifier) {
          dtsLines.push(`import type { ${tName} } from '${typeImportSpecifier}';`)
          dtsLines.push('')
        }
        if (tieredGuards.has(guard.name)) {
          dtsLines.push(`export declare function ${guard.name}Fast(data: unknown): boolean;`)
        }
        if (tName) {
          dtsLines.push(`export declare function ${guard.name}(data: unknown): data is ${tName};`)
        } else {
          dtsLines.push(`export declare function ${guard.name}(data: unknown): data is unknown;`)
        }
        const dtsContent = dtsLines.join('\n') + '\n'
        const dtsFilePath = path.join(guardsDir, `${fileBase}.d.ts`)
        await fs.writeFile(dtsFilePath, dtsContent, 'utf8')
        artifacts.push({
          filePath: dtsFilePath,
          content: dtsContent,
          kind: 'dts',
        })
      }

      indexJsLines.push(`export * from './guards/${fileBase}.js';`)
      indexDtsLines.push(`export * from './guards/${fileBase}.js';`)
    }

    // Ensure outDir exists
    await fs.mkdir(outDir, { recursive: true })

    // Ensure package.json with "type": "module" exists so Node.js resolves .js files natively as ESM in all environments
    const pkgPath = path.join(outDir, 'package.json')
    try {
      await fs.access(pkgPath)
    } catch {
      await fs.writeFile(pkgPath, JSON.stringify({ type: 'module' }, null, 2) + '\n', 'utf8')
    }

    // 1. index.js
    const indexJsPath = path.join(outDir, 'index.js')
    const indexJsContent = indexJsLines.join('\n') + '\n'
    await fs.writeFile(indexJsPath, indexJsContent, 'utf8')
    artifacts.push({
      filePath: indexJsPath,
      content: indexJsContent,
      kind: 'js',
    })

    // 2. index.d.ts
    if (generateDeclarations) {
      const indexDtsPath = path.join(outDir, 'index.d.ts')
      const indexDtsContent = indexDtsLines.join('\n') + '\n'
      await fs.writeFile(indexDtsPath, indexDtsContent, 'utf8')
      artifacts.push({
        filePath: indexDtsPath,
        content: indexDtsContent,
        kind: 'dts',
      })
    }

    return artifacts
  }

  // Monolithic mode: compile standalone ESM code
  const rawJs: string = standaloneCodeFn(ajv, mapping)
  const jsContent = postProcessGeneratedJs(rawJs, { fastPaths, dispatches, tieredGuards })

  // Generate TypeScript .d.ts declarations
  const typeImports = new Set<string>()
  const dtsDeclarations: string[] = []

  for (const guard of resolvedGuards) {
    const tName = guard.typeName?.trim()
    if (tieredGuards.has(guard.name)) {
      dtsDeclarations.push(`export declare function ${guard.name}Fast(data: unknown): boolean;`)
    }
    if (tName) {
      typeImports.add(tName)
      dtsDeclarations.push(`export declare function ${guard.name}(data: unknown): data is ${tName};`)
    } else {
      dtsDeclarations.push(`export declare function ${guard.name}(data: unknown): data is unknown;`)
    }
  }

  const dtsLines: string[] = []
  if (typeImportSpecifier && typeImports.size > 0) {
    dtsLines.push(`import type { ${Array.from(typeImports).join(', ')} } from '${typeImportSpecifier}';`)
    dtsLines.push('')
  }
  dtsLines.push(...dtsDeclarations)
  const dtsContent = dtsLines.join('\n') + '\n'

  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true })

  // Ensure package.json with "type": "module" exists so Node.js resolves .js files natively as ESM in all environments
  const pkgPath = path.join(outDir, 'package.json')
  try {
    await fs.access(pkgPath)
  } catch {
    await fs.writeFile(pkgPath, JSON.stringify({ type: 'module' }, null, 2) + '\n', 'utf8')
  }

  // 1. guards.js
  const guardsJsPath = path.join(outDir, 'guards.js')
  await fs.writeFile(guardsJsPath, jsContent, 'utf8')
  artifacts.push({
    filePath: guardsJsPath,
    content: jsContent,
    kind: 'js',
  })

  // 2. guards.d.ts
  if (generateDeclarations) {
    const guardsDtsPath = path.join(outDir, 'guards.d.ts')
    await fs.writeFile(guardsDtsPath, dtsContent, 'utf8')
    artifacts.push({
      filePath: guardsDtsPath,
      content: dtsContent,
      kind: 'dts',
    })
  }

  // 3. index.js
  const indexJsContent = `export * from './guards.js';\n`
  const indexJsPath = path.join(outDir, 'index.js')
  await fs.writeFile(indexJsPath, indexJsContent, 'utf8')
  artifacts.push({
    filePath: indexJsPath,
    content: indexJsContent,
    kind: 'js',
  })

  // 4. index.d.ts
  if (generateDeclarations) {
    const indexDtsContent = `export * from './guards.js';\n`
    const indexDtsPath = path.join(outDir, 'index.d.ts')
    await fs.writeFile(indexDtsPath, indexDtsContent, 'utf8')
    artifacts.push({
      filePath: indexDtsPath,
      content: indexDtsContent,
      kind: 'dts',
    })
  }

  return artifacts
}
