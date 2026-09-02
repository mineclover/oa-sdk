import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import standaloneCode from 'ajv/dist/standalone/index.js'
import addFormats from 'ajv-formats'
import type {
  GeneratedGuardArtifact,
  StandaloneGuardGeneratorOptions,
  StandaloneGuardTarget,
} from './types.js'

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
  } = options

  const outDir = path.resolve(rawOutDir)
  const resolvedGuards = options.guards && options.guards.length > 0
    ? options.guards
    : autoDiscoverGuards(schemaDocument)

  // Initialize Ajv 2020 with standalone source output configuration
  const AjvCtor: any = (Ajv2020 as any).default ?? Ajv2020
  const ajv = new AjvCtor({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  })

  const addFormatsFn: any = (addFormats as any).default ?? addFormats
  addFormatsFn(ajv)

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

  // Compile standalone ESM code
  const standaloneCodeFn: any = (standaloneCode as any).default ?? standaloneCode
  const rawJs: string = standaloneCodeFn(ajv, mapping)

  // Transform "export const isFoo = validate20;" into explicit "export function isFoo(data, ...args) { ... }"
  const jsContent = rawJs.replace(
    /export const (\w+) = (\w+);/g,
    'export function $1(data, ...args) {\n  return $2(data, ...args);\n}',
  )

  // Generate TypeScript .d.ts declarations
  const typeImports = new Set<string>()
  const dtsDeclarations: string[] = []

  for (const guard of resolvedGuards) {
    const tName = guard.typeName?.trim()
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

  const artifacts: GeneratedGuardArtifact[] = []

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
