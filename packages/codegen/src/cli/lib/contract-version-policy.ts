import {
  classifyBreakingChanges,
  type DiffResult,
} from './openapi-breaking-diff.js'

export type SemanticVersion = {
  major: number
  minor: number
  patch: number
}

export type ContractVersionPolicyResult = {
  pass: boolean
  reason: string
  breakingChangeCount: number
}

const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match = SEMANTIC_VERSION_PATTERN.exec(value)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function evaluateContractVersionPolicy(input: {
  baseVersion: string
  headVersion: string
  diff: DiffResult
}): ContractVersionPolicyResult {
  const breakingChangeCount = classifyBreakingChanges(input.diff).length
  const base = parseSemanticVersion(input.baseVersion)
  const head = parseSemanticVersion(input.headVersion)

  if (!base) {
    return {
      pass: false,
      reason: `Base API contract version is not a stable SemVer value: ${input.baseVersion}.`,
      breakingChangeCount,
    }
  }
  if (!head) {
    return {
      pass: false,
      reason: `Head API contract version is not a stable SemVer value: ${input.headVersion}.`,
      breakingChangeCount,
    }
  }
  if (compareSemanticVersions(head, base) < 0) {
    return {
      pass: false,
      reason: `API contract version must not decrease: ${input.baseVersion} -> ${input.headVersion}.`,
      breakingChangeCount,
    }
  }
  if (breakingChangeCount === 0) {
    return {
      pass: true,
      reason: 'No breaking API changes detected.',
      breakingChangeCount,
    }
  }

  if (base.major === 0) {
    const pass = head.major === 0 && head.minor > base.minor
    return {
      pass,
      reason: pass
        ? `Breaking API changes are covered by the pre-1.0 minor bump: ${input.baseVersion} -> ${input.headVersion}.`
        : `Breaking API changes require a pre-1.0 minor bump: ${input.baseVersion} -> 0.${base.minor + 1}.0 or later.`,
      breakingChangeCount,
    }
  }

  const pass = head.major > base.major
  return {
    pass,
    reason: pass
      ? `Breaking API changes are covered by the major bump: ${input.baseVersion} -> ${input.headVersion}.`
      : `Breaking API changes require a major bump: ${input.baseVersion} -> ${base.major + 1}.0.0 or later.`,
    breakingChangeCount,
  }
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}
