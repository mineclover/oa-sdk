export type ReviewOutcome = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

export type OptionalSidecarDiffLike = {
  checked: boolean
  base: string | null
  head: string | null
  changed: boolean | null
  differences: readonly unknown[]
}

export function recommendReviewOutcome(input: {
  hasBlocking: boolean
  hasAdvisory: boolean
}): ReviewOutcome {
  if (input.hasBlocking) return 'REQUEST_CHANGES'
  if (input.hasAdvisory) return 'COMMENT'
  return 'APPROVE'
}

export function isOptionalSidecarDiffIncomplete(
  review: Pick<OptionalSidecarDiffLike, 'checked' | 'base' | 'head'> | undefined,
): boolean {
  return review !== undefined
    && (review.base !== null || review.head !== null)
    && !review.checked
}

export function optionalSidecarDiffChangeCount(
  review: Pick<OptionalSidecarDiffLike, 'changed' | 'differences'> | undefined,
): number | null {
  if (review === undefined) return null
  if (review.changed === null) return null
  return review.differences.length
}
