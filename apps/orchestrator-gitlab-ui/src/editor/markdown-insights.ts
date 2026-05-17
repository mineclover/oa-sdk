export interface MarkdownTaskInsight {
  readonly line: number
  readonly marker: '[ ]' | '[x]' | '[X]' | '[~]'
  readonly text: string
}

export interface MarkdownReferenceInsight {
  readonly kind: 'issue' | 'mergeRequest'
  readonly reference: string
}

export interface MarkdownInsights {
  readonly references: MarkdownReferenceInsight[]
  readonly tasks: MarkdownTaskInsight[]
}

export function analyzeMarkdown(markdown: string): MarkdownInsights {
  return {
    references: extractReferences(markdown),
    tasks: extractTasks(markdown),
  }
}

export function isGitLabTaskMarkdown(markdown: string): boolean {
  return markdown.split(/\r?\n/).some(line => parseTaskLine(line, 1) !== undefined)
}

function extractTasks(markdown: string): MarkdownTaskInsight[] {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => parseTaskLine(line, index + 1))
    .filter((task): task is MarkdownTaskInsight => task !== undefined)
}

function parseTaskLine(line: string, lineNumber: number): MarkdownTaskInsight | undefined {
  const match = /^(\s*)(?:[-+*]|\d+[.)])\s+(\[[ xX~]\])\s+(.*)$/.exec(line)
  if (match === null) return undefined
  return {
    line: lineNumber,
    marker: match[2] as MarkdownTaskInsight['marker'],
    text: (match[3] ?? '').trim(),
  }
}

function extractReferences(markdown: string): MarkdownReferenceInsight[] {
  const references = new Map<string, MarkdownReferenceInsight>()
  for (const match of markdown.matchAll(/(^|[\s([{,;])([#!])(\d+)\b/g)) {
    const sigil = match[2]
    const id = match[3]
    if (sigil === undefined || id === undefined) continue
    const reference = `${sigil}${id}`
    references.set(reference, {
      kind: sigil === '#' ? 'issue' : 'mergeRequest',
      reference,
    })
  }
  return [...references.values()]
}
