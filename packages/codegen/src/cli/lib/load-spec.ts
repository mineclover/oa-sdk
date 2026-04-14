import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'

/** spec 파일을 읽어 파싱된 객체 반환. 존재하지 않으면 에러 메시지 후 exit. */
export function loadSpec(specPath: string): OasDocument {
  const resolved = resolve(process.cwd(), specPath)
  try {
    const raw = readFileSync(resolved, 'utf8')
    return (specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as OasDocument
  } catch (err) {
    console.error(`스펙 파일 읽기 실패: ${resolved}`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
