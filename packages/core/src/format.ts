/**
 * 생성된 TypeScript 코드의 최소 정렬
 *
 * `{` / `}` 블록 기반 인덴트 레벨 추적.
 * prettier/biome 없이도 읽을 수 있는 출력을 보장.
 */

export function formatGeneratedTs(code: string, indent = '  '): string {
  const lines = code.split('\n')
  const result: string[] = []
  let level = 0

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) { result.push(''); continue }

    const opens = (trimmed.match(/\{/g) ?? []).length + (trimmed.match(/\(/g) ?? []).length
    const closes = (trimmed.match(/\}/g) ?? []).length + (trimmed.match(/\)/g) ?? []).length

    // } 로 시작하면 레벨 감소 먼저
    if (trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')')) {
      level = Math.max(0, level - 1)
    }

    // 이미 정렬된 top-level 문 (export, import, //) 은 레벨 0
    if (level === 0 || trimmed.startsWith('export ') || trimmed.startsWith('import ') || trimmed.startsWith('//')) {
      result.push(trimmed)
    } else {
      result.push(indent.repeat(level) + trimmed)
    }

    // Net brace/paren delta 로 다음 줄 레벨 조정
    const delta = opens - closes
    if (delta > 0) {
      level += delta
    } else if (delta < 0 && !(trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')'))) {
      level = Math.max(0, level + delta)
    }
  }

  return result.join('\n')
}
