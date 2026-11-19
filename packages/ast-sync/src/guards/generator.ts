import { existsSync, readFileSync } from 'node:fs'
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
const STANDALONE_FORMATS: Record<string, RegExp | boolean> = {
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
const STANDALONE_ERROR_TYPE_TS =
  'ReadonlyArray<{ readonly instancePath: string; readonly schemaPath: string; readonly keyword: string; readonly params?: Record<string, unknown>; readonly message?: string }>'

const packageJsonModuleValidator = {
  safeParse(value: unknown): { type?: string } | null {
    if (value === null || typeof value !== 'object') return null
    return 'type' in value && typeof value.type === 'string'
      ? { type: value.type }
      : {}
  },
}

/**
 * Walks parent directories from `startDir` looking for the nearest `package.json`
 * and returns `true` iff it declares `"type": "module"`.
 */
export function hasAncestorModulePackage(startDir: string): boolean {
  let cur = path.resolve(startDir)
  while (true) {
    const candidate = path.join(cur, 'package.json')
    if (existsSync(candidate)) {
      try {
        const parsed = packageJsonModuleValidator.safeParse(JSON.parse(readFileSync(candidate, 'utf8')))
        return parsed?.type === 'module'
      } catch {
        return false
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) return false
    cur = parent
  }
}

function resolveGuardStem(guardName: string): string {
  const match = /^is([A-Z_$].*)$/.exec(guardName)
  return match ? match[1]! : guardName
}

function renderAssertionJsForGuard(guardName: string, stem: string): string {
  return [
    `export function validate${stem}(data) {`,
    `  if (${guardName}(data)) {`,
    '    return { valid: true, data, errors: null };',
    '  }',
    `  return { valid: false, errors: ${guardName}.errors ?? [] };`,
    '}',
    '',
    `export function assert${stem}(data) {`,
    `  if (!${guardName}(data)) {`,
    `    const errs = ${guardName}.errors ?? [];`,
    "    const details = errs.map((e, i) => `  ${i + 1}. Path: \"${e.instancePath || '/'}\" | Keyword: \"${e.keyword}\" | Issue: ${e.message || 'validation failed'}`).join('\\n');",
    `    throw new TypeError(\`[StandaloneGuard] Data failed validation against ${stem}\${details ? ':\\n' + details : ''}\`);`,
    '  }',
    '}',
  ].join('\n')
}

function renderGuardDtsEntries(
  guardName: string,
  targetType: string | undefined,
  options: { isTiered: boolean; includeAssertions: boolean; usedStems: Set<string> },
): string[] {
  const typeRef = targetType || 'unknown'
  const lines: string[] = []
  if (options.isTiered) {
    lines.push(`export declare function ${guardName}Fast(data: unknown): boolean;`)
  }
  lines.push(`export declare function ${guardName}(data: unknown): data is ${typeRef};`)
  lines.push(
    `export declare namespace ${guardName} {`,
    `  let errors: ${STANDALONE_ERROR_TYPE_TS} | null | undefined;`,
    '}',
  )
  if (options.includeAssertions) {
    const stem = resolveGuardStem(guardName)
    if (!options.usedStems.has(stem)) {
      options.usedStems.add(stem)
      lines.push(
        `export declare function validate${stem}(data: unknown): { readonly valid: true; readonly data: ${typeRef}; readonly errors: null } | { readonly valid: false; readonly errors: ${STANDALONE_ERROR_TYPE_TS} };`,
      )
      lines.push(`export declare function assert${stem}(data: unknown): asserts data is ${typeRef};`)
    }
  }
  return lines
}

function postProcessGeneratedJs(
  rawJs: string,
  extra: {
    fastPaths?: Map<string, { fnName: string; code: string }>
    dispatches?: Map<string, { tableName: string; keyProp: string; code: string; referencedGuards?: string[] }>
    tieredGuards?: Set<string>
    guardToFileBase?: Map<string, string>
    currentGuardName?: string
    includeAssertions?: boolean
    exportedGuardNames?: readonly string[]
  } = {},
): string {
  let js = rawJs
  const exportedInFile: string[] = []

  // 1. Transform export syntax to standard function and preserve AJV `.errors`
  js = js.replace(
    /export const ([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*);/g,
    (_match, name, fn) => {
      exportedInFile.push(name)
      if (extra.dispatches?.has(name)) {
        const disp = extra.dispatches.get(name)!
        return [
          `export function ${name}(data, ...args) {`,
          `  if (typeof data !== 'object' || data === null) {`,
          `    ${name}.errors = [{ instancePath: '', schemaPath: '#/type', keyword: 'type', message: 'must be object' }];`,
          '    return false;',
          '  }',
          `  const branch = ${disp.tableName}[data[${JSON.stringify(disp.keyProp)}]];`,
          '  if (branch) {',
          '    const ok = branch(data, ...args);',
          `    ${name}.errors = ok ? null : (branch.errors ?? null);`,
          '    return ok;',
          '  }',
          `  const ok = ${fn}(data, ...args);`,
          `  ${name}.errors = ok ? null : (${fn}.errors ?? null);`,
          '  return ok;',
          '}',
        ].join('\n')
      }
      if (extra.tieredGuards?.has(name) && extra.fastPaths?.has(name)) {
        const fp = extra.fastPaths.get(name)!
        return [
          `export function ${name}Fast(data) {`,
          `  return ${fp.fnName}(data);`,
          '}',
          '',
          `export function ${name}(data, ...args) {`,
          `  if (!${fp.fnName}(data)) {`,
          `    ${name}.errors = [{ instancePath: '', schemaPath: '#/fastPath', keyword: 'fastPath', message: 'failed fast-path structural check' }];`,
          '    return false;',
          '  }',
          `  const ok = ${fn}(data, ...args);`,
          `  ${name}.errors = ok ? null : (${fn}.errors ?? null);`,
          '  return ok;',
          '}',
        ].join('\n')
      }
      return [
        `export function ${name}(data, ...args) {`,
        `  const ok = ${fn}(data, ...args);`,
        `  ${name}.errors = ok ? null : (${fn}.errors ?? null);`,
        '  return ok;',
        '}',
      ].join('\n')
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

  if (extra.includeAssertions) {
    const targets = extra.exportedGuardNames ?? exportedInFile
    const usedStems = new Set<string>()
    const assertionBlocks: string[] = []
    for (const guardName of targets) {
      const stem = resolveGuardStem(guardName)
      if (usedStems.has(stem)) continue
      usedStems.add(stem)
      assertionBlocks.push(renderAssertionJsForGuard(guardName, stem))
    }
    if (assertionBlocks.length > 0) {
      js = `${js.trimEnd()}\n\n${assertionBlocks.join('\n\n')}\n`
    }
  }

  return js
}

/**
 * Turns a schema/type name into a JavaScript identifier that Ajv can export.
 *
 * Component names may contain characters that are legal in an OpenAPI components map but not in
 * an identifier (e.g. TypeSpec namespace-qualified `OaSdkTypeSpec.StandardError`). Ajv rejects
 * such export names outright (`CodeGen: invalid export name`), so the guard name is normalized
 * while `typeName` keeps the original spelling for the `data is ...` declaration.
 */
function toGuardIdentifier(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_$]+/g, '_')
  const prefixed = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
  return prefixed.length > 0 ? prefixed : 'isValue'
}

/** Encode one RFC 6901 token for use inside a URI fragment. */
function schemaPointerToken(name: string): string {
  return encodeURIComponent(name.replace(/~/g, '~0').replace(/\//g, '~1'))
}

/**
 * The importable root of a (possibly qualified) type reference.
 * `OaSdkTypeSpec.StandardError` is imported as its namespace `OaSdkTypeSpec` and used as
 * `OaSdkTypeSpec.StandardError`, because `import type { A.B }` is not valid TypeScript.
 */
function typeImportRoot(typeName: string): string {
  const dot = typeName.indexOf('.')
  return dot === -1 ? typeName : typeName.slice(0, dot)
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
        name: toGuardIdentifier(key.startsWith('is') ? key : `is${key}`),
        typeName: key,
        schema: `${prefix}${schemaPointerToken(key)}`,
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
          name: toGuardIdentifier(key.startsWith('is') ? key : `is${key}`),
          typeName: key,
          schema: `#/components/schemas/${schemaPointerToken(key)}`,
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
    includeAssertions = false,
    writePackageJson = 'auto',
    split = false,
    schemas,
  } = options

  const outDir = path.resolve(rawOutDir)
  const writeFile = async (filePath: string, content: string): Promise<void> => {
    if (options.dryRun) return
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
  }
  const ensurePackage = async (): Promise<void> => {
    if (options.dryRun || writePackageJson === false) return
    if (writePackageJson !== true && hasAncestorModulePackage(outDir)) return
    await fs.mkdir(outDir, { recursive: true })
    const pkgPath = path.join(outDir, 'package.json')
    try {
      await fs.access(pkgPath)
    } catch {
      await fs.writeFile(pkgPath, JSON.stringify({ type: 'module' }, null, 2) + '\n', 'utf8')
    }
  }
  const declarationType = (guard: StandaloneGuardTarget): string | undefined => {
    const name = guard.typeName?.trim()
    return name ? options.typeNames?.[name] ?? name : undefined
  }
  let resolvedGuards = options.guards && options.guards.length > 0
    ? options.guards
    : autoDiscoverGuards(schemaDocument)

  // Normalize custom guard names too, and keep the post-normalization names unique
  // (`A.B` and `A_B` would otherwise collide on the same export).
  const usedGuardNames = new Set<string>()
  resolvedGuards = resolvedGuards.map(guard => {
    const base = toGuardIdentifier(guard.name)
    let name = base
    let suffix = 2
    while (usedGuardNames.has(name)) {
      name = `${base}_${suffix++}`
    }
    usedGuardNames.add(name)
    return { ...guard, name }
  })

  if (schemas && schemas.length > 0) {
    const filterList = schemas.map(s => s.trim()).filter(Boolean)
    resolvedGuards = resolvedGuards.filter(guard => {
      return filterList.some(rawTerm => {
        const term = toGuardIdentifier(rawTerm)
        if (guard.name === term) return true
        if (guard.typeName && guard.typeName === rawTerm) return true
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
  const ajv = new Ajv2020({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  })

  // Register standalone zero-dependency formats
  for (const [name, format] of Object.entries(STANDALONE_FORMATS)) {
    // `false` disables a format in this table; Ajv only accepts `true` or a validator.
    if (format === false) continue
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

    const guardToFileBase = new Map<string, string>()
    const usedFileBases = new Set<string>()
    for (const g of resolvedGuards) {
      const base = toGuardIdentifier(g.typeName?.trim() || g.name)
      let fileBase = base
      let suffix = 2
      // Keep outputs distinct on case-insensitive filesystems as well.
      while (usedFileBases.has(fileBase.toLowerCase())) fileBase = `${base}_${suffix++}`
      usedFileBases.add(fileBase.toLowerCase())
      guardToFileBase.set(g.name, fileBase)
    }

    const indexJsLines: string[] = []
    const indexDtsLines: string[] = []

    for (const guard of resolvedGuards) {
      const fileBase = guardToFileBase.get(guard.name)!
      const rawJs: string = standaloneCode(ajv, { [guard.name]: guard.name })
      const jsContent = postProcessGeneratedJs(rawJs, {
        fastPaths,
        dispatches,
        tieredGuards,
        guardToFileBase,
        currentGuardName: guard.name,
        includeAssertions,
        exportedGuardNames: [guard.name],
      })

      const jsFilePath = path.join(guardsDir, `${fileBase}.js`)
      await writeFile(jsFilePath, jsContent)
      artifacts.push({
        filePath: jsFilePath,
        content: jsContent,
        kind: 'js',
      })

      if (generateDeclarations) {
        const dtsLines: string[] = []
        const tName = declarationType(guard)
        if (tName && typeImportSpecifier) {
          dtsLines.push(`import type { ${typeImportRoot(tName)} } from '${typeImportSpecifier}';`)
          dtsLines.push('')
        }
        dtsLines.push(
          ...renderGuardDtsEntries(guard.name, tName, {
            isTiered: tieredGuards.has(guard.name),
            includeAssertions,
            usedStems: new Set<string>(),
          }),
        )
        const dtsContent = dtsLines.join('\n') + '\n'
        const dtsFilePath = path.join(guardsDir, `${fileBase}.d.ts`)
        await writeFile(dtsFilePath, dtsContent)
        artifacts.push({
          filePath: dtsFilePath,
          content: dtsContent,
          kind: 'dts',
        })
      }

      indexJsLines.push(`export * from './guards/${fileBase}.js';`)
      indexDtsLines.push(`export * from './guards/${fileBase}.js';`)
    }

    await ensurePackage()

    // 1. index.js
    const indexJsPath = path.join(outDir, 'index.js')
    const indexJsContent = indexJsLines.join('\n') + '\n'
    await writeFile(indexJsPath, indexJsContent)
    artifacts.push({
      filePath: indexJsPath,
      content: indexJsContent,
      kind: 'js',
    })

    // 2. index.d.ts
    if (generateDeclarations) {
      const indexDtsPath = path.join(outDir, 'index.d.ts')
      const indexDtsContent = indexDtsLines.join('\n') + '\n'
      await writeFile(indexDtsPath, indexDtsContent)
      artifacts.push({
        filePath: indexDtsPath,
        content: indexDtsContent,
        kind: 'dts',
      })
    }

    return artifacts
  }

  // Monolithic mode: compile standalone ESM code
  const rawJs: string = standaloneCode(ajv, mapping)
  const jsContent = postProcessGeneratedJs(rawJs, {
    fastPaths,
    dispatches,
    tieredGuards,
    includeAssertions,
    exportedGuardNames: resolvedGuards.map(g => g.name),
  })

  // Generate TypeScript .d.ts declarations
  const typeImports = new Set<string>()
  const dtsDeclarations: string[] = []
  const usedAssertionStems = new Set<string>()

  for (const guard of resolvedGuards) {
    const tName = declarationType(guard)
    if (tName) {
      typeImports.add(typeImportRoot(tName))
    }
    dtsDeclarations.push(
      ...renderGuardDtsEntries(guard.name, tName, {
        isTiered: tieredGuards.has(guard.name),
        includeAssertions,
        usedStems: usedAssertionStems,
      }),
    )
  }

  const dtsLines: string[] = []
  if (typeImportSpecifier && typeImports.size > 0) {
    dtsLines.push(`import type { ${Array.from(typeImports).join(', ')} } from '${typeImportSpecifier}';`)
    dtsLines.push('')
  }
  dtsLines.push(...dtsDeclarations)
  const dtsContent = dtsLines.join('\n') + '\n'

  await ensurePackage()

  // 1. guards.js
  const guardsJsPath = path.join(outDir, 'guards.js')
  await writeFile(guardsJsPath, jsContent)
  artifacts.push({
    filePath: guardsJsPath,
    content: jsContent,
    kind: 'js',
  })

  // 2. guards.d.ts
  if (generateDeclarations) {
    const guardsDtsPath = path.join(outDir, 'guards.d.ts')
    await writeFile(guardsDtsPath, dtsContent)
    artifacts.push({
      filePath: guardsDtsPath,
      content: dtsContent,
      kind: 'dts',
    })
  }

  // 3. index.js
  const indexJsContent = `export * from './guards.js';\n`
  const indexJsPath = path.join(outDir, 'index.js')
  await writeFile(indexJsPath, indexJsContent)
  artifacts.push({
    filePath: indexJsPath,
    content: indexJsContent,
    kind: 'js',
  })

  // 4. index.d.ts
  if (generateDeclarations) {
    const indexDtsContent = `export * from './guards.js';\n`
    const indexDtsPath = path.join(outDir, 'index.d.ts')
    await writeFile(indexDtsPath, indexDtsContent)
    artifacts.push({
      filePath: indexDtsPath,
      content: indexDtsContent,
      kind: 'dts',
    })
  }

  return artifacts
}
