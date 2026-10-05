import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'

export type LoadedSpec = {
  document: OasDocument
  path: string
  raw: string
  /**
   * Files read to produce `document`: the spec itself, or every file the
   * TypeSpec compiler loaded (sources and JS library entries, which may live in
   * installed packages). External `$ref` documents are not included.
   */
  inputFiles: string[]
  /** Text the loader parsed, keyed by file in `inputFiles` (JS entries are imported, so they have none). */
  inputTexts: ReadonlyMap<string, string>
}

/** spec 파일을 읽어 파싱된 객체 반환. 실패는 호출자에게 전달합니다. */
export function loadSpecWithPath(specPath: string, rootDir?: string): LoadedSpec {
  const resolved = resolve(rootDir ?? process.cwd(), specPath)
  if (resolved.endsWith('.tsp')) {
    throw new Error(
      `TypeSpec (.tsp) 파일은 비동기 컴파일러를 통해 로드해야 합니다: ${resolved}\n비동기 API (loadSpecDocumentAsync) 또는 --tsp 옵션을 사용하세요.`,
    )
  }
  try {
    const raw = readFileSync(resolved, 'utf8')
    const document = (specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as OasDocument
    return { document, path: resolved, raw, inputFiles: [resolved], inputTexts: new Map([[resolved, raw]]) }
  } catch (err) {
    throw new Error(`스펙 파일 읽기 실패: ${resolved}\n${err instanceof Error ? err.message : String(err)}`)
  }
}

/** spec 파일을 읽어 파싱된 객체 반환. */
export function loadSpec(specPath: string): OasDocument {
  return loadSpecWithPath(specPath).document
}

/**
 * spec 파일을 비동기로 로드하여 파싱된 OAS 문서 객체 반환.
 * .tsp 파일인 경우 @typespec/compiler를 통해 인메모리로 컴파일 후 OAS 문서를 반환합니다.
 */
export async function loadSpecDocumentAsync(specPath: string, rootDir?: string): Promise<LoadedSpec> {
  const resolved = resolve(rootDir ?? process.cwd(), specPath)
  if (resolved.endsWith('.tsp')) {
    const { compileTypeSpecInMemory } = await import('./typespec-mock-compiler.js')
    const result = await compileTypeSpecInMemory(resolved)
    const { stringifyOpenApiYaml } = await import('./openapi-collect.js')
    const raw = stringifyOpenApiYaml(result.document)
    return {
      document: result.document,
      path: resolved,
      raw,
      inputFiles: result.inputFiles,
      inputTexts: result.sourceTexts,
    }
  }
  return loadSpecWithPath(specPath, rootDir)
}
