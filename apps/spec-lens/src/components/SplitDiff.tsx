import { useTranslation } from 'react-i18next'

// Line-level side-by-side diff renderer (no CDN dependency)

type DiffLine =
  | { type: 'equal';  content: string }
  | { type: 'delete'; content: string }
  | { type: 'insert'; content: string }

type AlignedRow =
  | { type: 'equal';   content: string }
  | { type: 'change';  left: string | null; right: string | null }

// ── LCS-based line diff ─────────────────────────────────────────────────

const LCS_LINE_LIMIT = 2000

function diffLines(original: string, modified: string): DiffLine[] {
  const a = original === '' ? [] : original.split('\n')
  const b = modified === '' ? [] : modified.split('\n')

  // Fall back to a flat diff for large inputs to avoid O(n²) freeze
  if (a.length + b.length > LCS_LINE_LIMIT) {
    return [
      ...a.map(content => ({ type: 'delete' as const, content })),
      ...b.map(content => ({ type: 'insert' as const, content })),
    ]
  }

  const m = a.length
  const n = b.length

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack — push then reverse to avoid O(n²) unshift
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'equal', content: a[i - 1]! })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: 'insert', content: b[j - 1]! })
      j--
    } else {
      result.push({ type: 'delete', content: a[i - 1]! })
      i--
    }
  }
  return result.reverse()
}

// ── Pair consecutive delete+insert as "change" rows ────────────────────

function toAlignedRows(ops: DiffLine[]): AlignedRow[] {
  const rows: AlignedRow[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]!
    if (op.type === 'equal') {
      rows.push({ type: 'equal', content: op.content })
      i++
    } else if (op.type === 'delete') {
      // peek ahead for matching inserts
      const deletes: string[] = [op.content]
      let j = i + 1
      while (j < ops.length && ops[j]!.type === 'delete') {
        deletes.push(ops[j]!.content)
        j++
      }
      const inserts: string[] = []
      while (j < ops.length && ops[j]!.type === 'insert') {
        inserts.push(ops[j]!.content)
        j++
      }
      const maxLen = Math.max(deletes.length, inserts.length)
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          type: 'change',
          left: deletes[k] ?? null,
          right: inserts[k] ?? null,
        })
      }
      i = j
    } else {
      // orphan insert (no preceding delete)
      rows.push({ type: 'change', left: null, right: op.content })
      i++
    }
  }
  return rows
}

// ── Word-level inline highlight (within a changed line) ─────────────────

function highlightWords(
  text: string,
  against: string,
  side: 'left' | 'right',
): React.ReactNode[] {
  const wordsA = text.split(/(\s+)/)
  const wordsB = against.split(/(\s+)/)
  const setB = new Set(wordsB)
  return wordsA.map((word, i) => {
    const changed = !setB.has(word) && word.trim() !== ''
    return changed ? (
      <mark
        key={i}
        style={{
          background: side === 'left' ? 'var(--diff-del-word)' : 'var(--diff-add-word)',
          color: 'inherit',
          borderRadius: 2,
        }}
      >
        {word}
      </mark>
    ) : (
      <span key={i}>{word}</span>
    )
  })
}

// ── Component ──────────────────────────────────────────────────────────

export function SplitDiff({
  original,
  modified,
  kind,
}: {
  original: string
  modified: string
  kind: 'added' | 'removed' | 'changed'
}) {
  const { t } = useTranslation()
  const ops = diffLines(original, modified)
  const rows = toAlignedRows(ops)

  const leftLineNos = computeLineNumbers(rows, 'left')
  const rightLineNos = computeLineNumbers(rows, 'right')

  return (
    <div style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: '20px', overflow: 'auto' }}>
      <Panel
        title={t('splitBefore')}
        side="left"
        rows={rows}
        lineNos={leftLineNos}
        hidden={kind === 'added'}
        notExistLabel={t('splitNotExistBefore')}
      />
      <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
      <Panel
        title={t('splitAfter')}
        side="right"
        rows={rows}
        lineNos={rightLineNos}
        hidden={kind === 'removed'}
        notExistLabel={t('splitNoLongerExists')}
      />
    </div>
  )
}

function Panel({
  title,
  side,
  rows,
  lineNos,
  hidden,
  notExistLabel,
}: {
  title: string
  side: 'left' | 'right'
  rows: AlignedRow[]
  lineNos: (number | null)[]
  hidden: boolean
  notExistLabel: string
}) {
  const isLeft = side === 'left'
  const accentColor = isLeft ? 'var(--red)' : 'var(--green)'
  const accentBg = isLeft ? 'var(--diff-del-header)' : 'var(--diff-add-header)'

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div
        style={{
          padding: '4px 12px',
          background: accentBg,
          borderBottom: `1px solid ${accentColor}33`,
          color: accentColor,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          flexShrink: 0,
        }}
      >
        {title}
      </div>

      {/* Lines */}
      <div style={{ overflow: 'auto' }}>
        {hidden ? (
          <div style={{ padding: '16px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
            — {notExistLabel}
          </div>
        ) : (
          rows.map((row, i) => (
            <DiffRow
              key={i}
              row={row}
              side={side}
              lineNo={lineNos[i] ?? null}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DiffRow({
  row,
  side,
  lineNo,
}: {
  row: AlignedRow
  side: 'left' | 'right'
  lineNo: number | null
}) {
  const isLeft = side === 'left'

  if (row.type === 'equal') {
    return (
      <div style={{ display: 'flex', background: 'transparent' }}>
        <LineNo n={lineNo} />
        <span style={{ padding: '0 12px 0 4px', color: 'var(--text-muted)', flex: 1, whiteSpace: 'pre', overflow: 'hidden' }}>
          &nbsp;{row.content}
        </span>
      </div>
    )
  }

  const content = isLeft ? row.left : row.right
  const other = isLeft ? row.right : row.left
  const isPresent = content !== null
  const isChanged = row.left !== null && row.right !== null  // both sides exist → real change

  const bgColor = isPresent
    ? isLeft ? 'var(--diff-del-bg)' : 'var(--diff-add-bg)'
    : 'var(--diff-empty-bg)'

  const prefix = isPresent
    ? isLeft ? '−' : '+'
    : ' '

  const prefixColor = isLeft ? 'var(--red)' : 'var(--green)'

  return (
    <div style={{ display: 'flex', background: bgColor }}>
      <LineNo n={isPresent ? lineNo : null} />
      <span
        style={{
          padding: '0 4px',
          color: prefixColor,
          fontWeight: 700,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {prefix}
      </span>
      <span style={{ flex: 1, padding: '0 8px 0 0', whiteSpace: 'pre', overflow: 'hidden' }}>
        {isPresent && isChanged && other !== null
          ? highlightWords(content, other, side)
          : isPresent
            ? content
            : <span style={{ color: 'var(--text-muted)' }}>&nbsp;</span>}
      </span>
    </div>
  )
}

function LineNo({ n }: { n: number | null }) {
  return (
    <span
      style={{
        width: 36,
        textAlign: 'right',
        paddingRight: 8,
        color: 'var(--text-muted)',
        flexShrink: 0,
        userSelect: 'none',
        fontSize: 11,
      }}
    >
      {n ?? ''}
    </span>
  )
}

function computeLineNumbers(rows: AlignedRow[], side: 'left' | 'right'): (number | null)[] {
  let n = 1
  return rows.map(row => {
    if (row.type === 'equal') return n++
    const present = side === 'left' ? row.left !== null : row.right !== null
    return present ? n++ : null
  })
}
