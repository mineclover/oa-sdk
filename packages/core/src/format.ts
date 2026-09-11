/**
 * 생성된 TypeScript 코드의 최소 정렬
 *
 * `{` / `}` 및 복합 호출 블록 기반 인덴트 레벨 추적.
 * prettier/biome 없이도 읽을 수 있는 출력을 보장.
 */

export function formatGeneratedTs(code: string, indent = '  '): string {
  const lines = code.split('\n')
  const result: string[] = []
  let level = 0
  let inBlockComment = false

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) { result.push(''); continue }

    const { opens, closes, leadingCloses, blockComment } = countStructuralDelimiters(trimmed, inBlockComment)
    inBlockComment = blockComment

    // 라인 시작 부분의 닫는 괄호 수만큼 먼저 레벨 감소
    if (leadingCloses > 0) {
      level = Math.max(0, level - leadingCloses)
    }

    // 이미 정렬된 top-level 문 (export, import, //) 은 레벨 0
    if (level === 0 || trimmed.startsWith('export ') || trimmed.startsWith('import ') || trimmed.startsWith('//')) {
      if (trimmed.startsWith('export ') || trimmed.startsWith('import ') || trimmed.startsWith('//')) {
        if (!inBlockComment && level <= 0) level = 0
      }
      result.push(trimmed)
    } else {
      result.push(indent.repeat(level) + trimmed)
    }

    // 선두 닫는 괄호를 제외한 잔여 delta로 다음 줄 레벨 조정
    const remainingDelta = opens - (closes - leadingCloses)
    level = Math.max(0, level + remainingDelta)
  }

  return result.join('\n')
}

function countStructuralDelimiters(line: string, startsInBlockComment: boolean): {
  opens: number
  closes: number
  leadingCloses: number
  blockComment: boolean
} {
  let blockComment = startsInBlockComment
  let quote: '"' | "'" | '`' | null = null

  let clean = ''
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    const next = line[index + 1]

    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index++ }
      continue
    }
    if (quote) {
      if (char === '\\') { index++; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '/' && next === '/') break
    if (char === '/' && next === '*') { blockComment = true; index++; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    clean += char
  }

  const normalized = clean
    .replace(/\(\s*\{/g, '{')
    .replace(/\(\s*\[/g, '[')
    .replace(/\}\s*\)/g, '}')
    .replace(/\]\s*\)/g, ']')

  let opens = 0
  let closes = 0
  for (const char of normalized) {
    if (char === '{' || char === '(' || char === '[') opens++
    if (char === '}' || char === ')' || char === ']') closes++
  }

  const matchLeading = clean.trim().match(/^([}\]\)]+)/)
  let leadingCloses = 0
  if (matchLeading && matchLeading[1]) {
    const leadNorm = matchLeading[1]
      .replace(/\}\s*\)/g, '}')
      .replace(/\]\s*\)/g, ']')
    for (const c of leadNorm) {
      if (c === '}' || c === ')' || c === ']') leadingCloses++
    }
  }

  return { opens, closes, leadingCloses, blockComment }
}
