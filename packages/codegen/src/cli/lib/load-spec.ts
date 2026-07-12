import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'

export type LoadedSpec = {
  document: OasDocument
  path: string
  raw: string
}

/** spec 파일을 읽어 파싱된 객체 반환. 실패는 호출자에게 전달합니다. */
export function loadSpecWithPath(specPath: string): LoadedSpec {
  const resolved = resolve(process.cwd(), specPath)
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
