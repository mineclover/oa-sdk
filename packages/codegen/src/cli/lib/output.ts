import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** output 경로가 있으면 파일 기록 + 메시지, 없으면 stdout. */
export function writeOutput(outputPath: string | undefined, content: string, label?: string): void {
  if (outputPath) {
    const outPath = resolve(process.cwd(), outputPath)
    writeFileSync(outPath, content, 'utf8')
    console.log(`✅ ${label ?? '생성 완료'}: ${outPath}`)
  } else {
    process.stdout.write(content)
  }
}
