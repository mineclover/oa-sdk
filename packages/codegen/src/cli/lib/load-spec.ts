import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'

export type LoadedSpec = {
  document: OasDocument
  path: string
}

/** spec 파일을 읽어 파싱된 객체 반환. 존재하지 않으면 에러 메시지 후 exit. */
export function loadSpecWithPath(specPath: string): LoadedSpec {
  const resolved = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolved, 'utf8')
    const document = (specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as OasDocument
    return { document, path: resolved }
  } catch (err) {
    console.error(`스펙 파일 읽기 실패: ${resolved}`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

/** spec 파일을 읽어 파싱된 객체 반환. 존재하지 않으면 에러 메시지 후 exit. */
export function loadSpec(specPath: string): OasDocument {
  return loadSpecWithPath(specPath).document
}
