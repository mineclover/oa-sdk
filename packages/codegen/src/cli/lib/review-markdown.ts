export function formatSidecarDiffLines<TDifference extends { kind: unknown; pointer: unknown }>(input: {
  report: {
    checked: boolean
    base: string | null
    head: string | null
    changed: boolean | null
    summary: string
    differences: TDifference[]
  }
  markdownText: (value: unknown) => string
  markdownCode: (value: unknown) => string
  getBaseCell: (difference: TDifference) => string
  getHeadCell: (difference: TDifference) => string
}): string[] {
  const { report, markdownText, markdownCode, getBaseCell, getHeadCell } = input

  if (!report.checked) {
    return [report.summary === 'not checked' ? 'Not checked.' : markdownText(report.summary)]
  }

  const lines = [
    `- Base: \`${markdownCode(report.base)}\``,
    `- Head: \`${markdownCode(report.head)}\``,
    `- Status: **${report.changed ? 'changed' : 'unchanged'}** - ${markdownText(report.summary)}`,
  ]
  if (report.differences.length === 0) return lines

  lines.push(
    '',
    '| Kind | Pointer | Base | Head |',
    '| --- | --- | --- | --- |',
    ...report.differences.map(difference => (
      `| ${markdownText(difference.kind)} | \`${markdownCode(difference.pointer)}\` | ${getBaseCell(difference)} | ${getHeadCell(difference)} |`
    )),
  )
  return lines
}

export function markdownText(value: unknown): string {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

export function markdownCode(value: unknown): string {
  return markdownText(value).replace(/`/g, '\\`')
}

export function formatChangeLines<TChange extends { code: unknown; endpoint: unknown; detail: unknown }>(
  changes: readonly TChange[],
): string[] {
  if (changes.length === 0) return ['None.']
  return changes.map(change => (
    `- \`${markdownCode(change.code)}\` \`${markdownCode(change.endpoint)}\` - ${markdownText(change.detail)}`
  ))
}

export function formatArtifactDifferenceLines<TDifference extends { kind: unknown; pointer: unknown; message: unknown }>(
  differences: readonly TDifference[],
  options: {
    heading?: string
  } = {},
): string[] {
  const lines = differences.map(difference => (
    `- ${markdownText(difference.kind)} \`${markdownCode(difference.pointer)}\`: ${markdownText(difference.message)}`
  ))
  if (options.heading === undefined) return lines
  return [options.heading, ...lines]
}

export function formatArtifactFreshnessLines(input: {
  checked: boolean
  artifact?: string | null
  fresh?: boolean | null
  summary: string
  differences: ReadonlyArray<{ kind: unknown; pointer: unknown; message: unknown }>
  uncheckedLines?: string[]
  differenceHeading?: string
}): string[] {
  if (!input.checked) {
    return input.uncheckedLines ?? [markdownText(input.summary)]
  }

  const lines = [
    `- \`${markdownCode(input.artifact)}\`: **${input.fresh ? 'fresh' : 'stale'}** - ${markdownText(input.summary)}`,
  ]
  if (input.differences.length > 0) {
    const differenceLines = formatArtifactDifferenceLines(input.differences, {
      ...(input.differenceHeading !== undefined ? { heading: input.differenceHeading } : {}),
    })
    if (input.differenceHeading !== undefined) {
      lines.push('', ...differenceLines)
    } else {
      lines.push(...differenceLines)
    }
  }
  return lines
}
