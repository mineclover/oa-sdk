import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'
import type { InputObservation } from './input-observations.js'

export type LoadedSpec = {
  document: OasDocument
  path: string
  raw: string
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
    return { document, path: resolved, raw }
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
  return (await loadSpecDocument(specPath, rootDir, false)).loaded
}

/** A loaded spec with every file-system observation loading it depended on. */
export type RecordedSpecLoad = {
  loaded: LoadedSpec
  /**
   * The spec file's content (with the text parsed), or, for TypeSpec, every
   * observation the compilation made (see `compileTypeSpecInMemory`).
   * External `$ref` documents are not included.
   */
  inputs: InputObservation[]
}

/** `loadSpecDocumentAsync`, recording the inputs loading depended on (for `--incremental`). */
export function loadSpecRecordingInputs(specPath: string, rootDir?: string): Promise<RecordedSpecLoad> {
  return loadSpecDocument(specPath, rootDir, true)
}

async function loadSpecDocument(specPath: string, rootDir: string | undefined, recordInputs: boolean): Promise<RecordedSpecLoad> {
  const resolved = resolve(rootDir ?? process.cwd(), specPath)
  if (resolved.endsWith('.tsp')) {
    const { compileTypeSpecInMemory } = await import('./typespec-mock-compiler.js')
    const result = await compileTypeSpecInMemory(resolved, { recordInputs })
    const { stringifyOpenApiYaml } = await import('./openapi-collect.js')
    const raw = stringifyOpenApiYaml(result.document)
    return { loaded: { document: result.document, path: resolved, raw }, inputs: result.inputs ?? [] }
  }
  const loaded = loadSpecWithPath(specPath, rootDir)
  return { loaded, inputs: [{ kind: 'content', path: loaded.path, consumed: { text: loaded.raw } }] }
}
