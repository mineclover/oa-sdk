/**
 * @fileoverview Intent-Unit Module: Phase D Implementation Contract Canary & Phase E Scrap Trigger Detector
 * @intent INTENT-OA-CONTRACT-CANARY
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-04
 */

export type FrictionSignalKind =
  | 'signature-deviation'
  | 'escape-hatch'
  | 'lock-reflex'
  | 'workaround-marker'

export type FrictionSignal = {
  kind: FrictionSignalKind
  line: number
  snippet: string
  message: string
}

export type ContractCanaryOptions = {
  implementationSource: string
  language?: 'typescript' | 'python' | 'auto'
  contractedOperations?: readonly string[]
  contractedModels?: readonly string[]
  scrapThreshold?: number
}

export type ContractCanaryReport = {
  passed: boolean
  scrapRequired: boolean
  totalFrictionSignals: number
  unimplementedStubCount: number
  signatureDeviations: FrictionSignal[]
  escapeHatches: FrictionSignal[]
  lockReflexes: FrictionSignal[]
  workaroundMarkers: FrictionSignal[]
  recommendation: 'proceed' | 'fix-contract-violation' | 'scrap-and-redesign-tsp'
}

export type DetachedEvidenceReport = {
  valid: boolean
  discoveredAnchors: string[]
  missingAnchors: string[]
  inlineHtmlAnchorWarnings: string[]
}

const ESCAPE_HATCH_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /:\s*any\b/, label: 'TypeScript `: any` type escape hatch' },
  { regex: /\bas\s+any\b/, label: 'TypeScript `as any` cast escape hatch' },
  { regex: /\bas\s+unknown\s+as\b/, label: 'TypeScript double cast `as unknown as` escape hatch' },
  { regex: /@ts-ignore\b|@ts-expect-error\b/, label: 'TypeScript compiler suppression directive' },
  { regex: /:\s*Any\b/, label: 'Python `: Any` type escape hatch' },
  { regex: /\bcast\s*\(/, label: 'Python `typing.cast()` escape hatch' },
  { regex: /#\s*type:\s*ignore\b/, label: 'Python `# type: ignore` suppression' },
]

const LOCK_REFLEX_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /\bthreading\.R?Lock\s*\(/, label: 'Python `threading.Lock` synchronization reflex' },
  { regex: /\basyncio\.Lock\s*\(/, label: 'Python `asyncio.Lock` synchronization reflex' },
  { regex: /\bnew\s+(?:Mutex|RWLock|Semaphore)\s*\(/, label: 'In-process Lock/Mutex synchronization reflex' },
]

const WORKAROUND_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /(?:\/\/|#)\s*(?:workaround|HACK|FIXME|TEMP_PATCH)\b/i, label: 'Stacked workaround/HACK marker' },
]

const STUB_PATTERNS: ReadonlyArray<RegExp> = [
  /throw\s+new\s+Error\(\s*["']not implemented["']\s*\)/i,
  /raise\s+NotImplementedError\(\s*["']not implemented["']\s*\)/i,
]

/**
 * Evaluates an implementation file against its `.tsp` contract during Phase D (`Implement`)
 * and triggers Phase E (`Scrap` -> return to `.tsp` Arena candidates) when $\ge 2$ combined
 * friction signals accumulate (`IUD-06`).
 */
export function checkImplementationContract(options: ContractCanaryOptions): ContractCanaryReport {
  const {
    implementationSource,
    contractedOperations = [],
    contractedModels = [],
    scrapThreshold = 2,
  } = options

  const signatureDeviations: FrictionSignal[] = []
  const escapeHatches: FrictionSignal[] = []
  const lockReflexes: FrictionSignal[] = []
  const workaroundMarkers: FrictionSignal[] = []
  let unimplementedStubCount = 0

  const lines = implementationSource.split(/\r?\n/)

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? ''
    const lineNumber = idx + 1

    for (const stubRe of STUB_PATTERNS) {
      if (stubRe.test(line)) {
        unimplementedStubCount++
      }
    }

    for (const pat of ESCAPE_HATCH_PATTERNS) {
      if (pat.regex.test(line)) {
        escapeHatches.push({
          kind: 'escape-hatch',
          line: lineNumber,
          snippet: line.trim(),
          message: pat.label,
        })
      }
    }

    for (const pat of LOCK_REFLEX_PATTERNS) {
      if (pat.regex.test(line)) {
        lockReflexes.push({
          kind: 'lock-reflex',
          line: lineNumber,
          snippet: line.trim(),
          message: pat.label,
        })
      }
    }

    for (const pat of WORKAROUND_PATTERNS) {
      if (pat.regex.test(line)) {
        workaroundMarkers.push({
          kind: 'workaround-marker',
          line: lineNumber,
          snippet: line.trim(),
          message: pat.label,
        })
      }
    }
  }

  for (const opName of contractedOperations) {
    const snakeOp = opName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    const hasCamel = new RegExp(`\\b${escapeRegExp(opName)}\\s*\\(`).test(implementationSource)
    const hasSnake = new RegExp(`\\b${escapeRegExp(snakeOp)}\\s*\\(`).test(implementationSource)
    if (!hasCamel && !hasSnake) {
      signatureDeviations.push({
        kind: 'signature-deviation',
        line: 1,
        snippet: opName,
        message: `Contracted operation "${opName}" (or "${snakeOp}") is missing from implementation.`,
      })
    }
  }

  for (const modelName of contractedModels) {
    const hasModel = new RegExp(`\\b${escapeRegExp(modelName)}\\b`).test(implementationSource)
    if (!hasModel) {
      signatureDeviations.push({
        kind: 'signature-deviation',
        line: 1,
        snippet: modelName,
        message: `Contracted model "${modelName}" is missing from implementation.`,
      })
    }
  }

  const totalFrictionSignals =
    signatureDeviations.length +
    escapeHatches.length +
    lockReflexes.length +
    workaroundMarkers.length

  const scrapRequired = totalFrictionSignals >= scrapThreshold
  const passed = totalFrictionSignals === 0 && unimplementedStubCount === 0

  const recommendation = scrapRequired
    ? 'scrap-and-redesign-tsp'
    : passed
      ? 'proceed'
      : 'fix-contract-violation'

  return {
    passed,
    scrapRequired,
    totalFrictionSignals,
    unimplementedStubCount,
    signatureDeviations,
    escapeHatches,
    lockReflexes,
    workaroundMarkers,
    recommendation,
  }
}

/**
 * Validates detached evidence review Markdown documents (`evidence/*.md`) for required
 * `#anchor` targets using code-fence masking and 3-way anchor classification (`IUD-02`, `ANCH-10`).
 */
export function validateDetachedEvidenceMarkdown(
  markdownContent: string,
  requiredAnchors: readonly string[],
): DetachedEvidenceReport {
  const discovered = new Set<string>()
  const inlineHtmlAnchorWarnings: string[] = []
  const lines = markdownContent.split(/\r?\n/)
  let inFence = false

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? ''
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const htmlMatch = /<a\s+[^>]*?\b(?:id|name)=["']([^"']+)["']/i.exec(line)
    if (htmlMatch?.[1]) {
      const id = htmlMatch[1].trim()
      discovered.add(id)
      inlineHtmlAnchorWarnings.push(
        `Line ${idx + 1}: Inline HTML anchor "#${id}" is recognized for compatibility only; prefer {#${id}} heading syntax.`,
      )
    }

    const headingMatch = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line)
    if (!headingMatch?.[1]) continue

    let rawHeading = headingMatch[1]
    const customMatch = /\{#([A-Za-z0-9._:-]+)\}\s*$/.exec(rawHeading)
    if (customMatch?.[1]) {
      discovered.add(customMatch[1])
      rawHeading = rawHeading.slice(0, customMatch.index).trim()
    }

    const cleanSlug = rawHeading
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
    if (cleanSlug) {
      discovered.add(cleanSlug)
    }
  }

  const missingAnchors = requiredAnchors
    .map(a => a.replace(/^#/, ''))
    .filter(a => !discovered.has(a))

  return {
    valid: missingAnchors.length === 0,
    discoveredAnchors: [...discovered].sort(),
    missingAnchors,
    inlineHtmlAnchorWarnings,
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
