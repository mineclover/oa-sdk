import type { ReviewBundle } from './review-bundle.js'
import type { ReviewReport } from './review-report.js'

export type ReviewBehaviorDecisionSignal = 'approve' | 'comment' | 'request-changes'

export type ReviewBehaviorReasonFields<TRecommendation extends string = string> = {
  recommendation: TRecommendation
  reasonCount: number
  reasons: string[]
}

export type ReviewBehaviorDiffFields = {
  breakingChanges: number
  nonBreakingChanges: number
}

export type ReviewBehaviorValidationFields = {
  validationErrors: number
  validationWarnings: number
  validationInfos: number
}

export type ReviewBehaviorCheckedState = {
  artifactChecked: boolean
  artifactFresh: boolean | null
  provenanceChecked: boolean
  provenanceChanges: number | null
  metadataRegistryChecked: boolean
  metadataRegistryChanges: number | null
  checksIncomplete: boolean
}

export type ReviewBundleBehaviorIncludedState = {
  artifactChecked: boolean
  artifactFresh: boolean | null
  runtimeDriftIncluded: boolean
  runtimeDrift: boolean | null
  provenanceChecked: boolean
  provenanceChanges: number | null
  inventoryIncluded: boolean
  compositionIncluded: boolean
  metadataRegistryIncluded: boolean
  metadataRegistryChecked: boolean
  metadataRegistryValid: boolean | null
  metadataRegistryChanges: number | null
  duplicateReviewIncluded: boolean
  duplicateReviewValid: boolean | null
  checksIncomplete: boolean
}

export type ReviewBehaviorResult =
  & ReviewBehaviorReasonFields<ReviewReport['recommendation']>
  & ReviewBehaviorDiffFields
  & ReviewBehaviorValidationFields
  & ReviewBehaviorCheckedState

export type ReviewBundleBehaviorResult =
  & ReviewBehaviorReasonFields<ReviewBundle['summary']['recommendation']>
  & ReviewBehaviorDiffFields
  & ReviewBundleBehaviorIncludedState

export function recommendationDecisionSignal(
  recommendation: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES',
): ReviewBehaviorDecisionSignal {
  if (recommendation === 'APPROVE') return 'approve'
  if (recommendation === 'COMMENT') return 'comment'
  return 'request-changes'
}

export function recommendationDecisionReason(
  recommendation: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES',
): string {
  if (recommendation === 'APPROVE') {
    return 'review found no blocking issues and all required checks are satisfied'
  }
  if (recommendation === 'COMMENT') {
    return 'review found non-blocking changes or incomplete optional checks'
  }
  return 'review found blocking changes that require follow-up'
}

export function bundleRecommendationDecisionReason(
  recommendation: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES',
): string {
  if (recommendation === 'APPROVE') {
    return 'bundle summary found no blocking review sections'
  }
  if (recommendation === 'COMMENT') {
    return 'bundle summary found only non-blocking or incomplete review sections'
  }
  return 'bundle summary found blocking review sections'
}

export function createReviewBehaviorReasonFields(
  input: {
    recommendation: ReviewReport['recommendation']
    reasonCount: number
    reasons: string[]
  },
): ReviewBehaviorReasonFields<ReviewReport['recommendation']> {
  return {
    recommendation: input.recommendation,
    reasonCount: input.reasonCount,
    reasons: input.reasons,
  }
}

export function createReviewBehaviorDiffFields(
  input: {
    breakingChanges: number
    nonBreakingChanges: number
  },
): ReviewBehaviorDiffFields {
  return {
    breakingChanges: input.breakingChanges,
    nonBreakingChanges: input.nonBreakingChanges,
  }
}

export function createReviewValidationFields(
  input: {
    validationErrors: number
    validationWarnings: number
    validationInfos: number
  },
): ReviewBehaviorValidationFields {
  return {
    validationErrors: input.validationErrors,
    validationWarnings: input.validationWarnings,
    validationInfos: input.validationInfos,
  }
}

export function createReviewCheckedState(
  input: {
    artifactChecked: boolean
    artifactFresh: boolean | null
    provenanceChecked: boolean
    provenanceChanges: number | null
    metadataRegistryChecked: boolean
    metadataRegistryChanges: number | null
    checksIncomplete: boolean
  },
): ReviewBehaviorCheckedState {
  return {
    artifactChecked: input.artifactChecked,
    artifactFresh: input.artifactFresh,
    provenanceChecked: input.provenanceChecked,
    provenanceChanges: input.provenanceChanges,
    metadataRegistryChecked: input.metadataRegistryChecked,
    metadataRegistryChanges: input.metadataRegistryChanges,
    checksIncomplete: input.checksIncomplete,
  }
}

export function createReviewBundleIncludedState(
  input: {
    artifactChecked: boolean
    artifactFresh: boolean | null
    runtimeDriftIncluded: boolean
    runtimeDrift: boolean | null
    provenanceChecked: boolean
    provenanceChanges: number | null
    inventoryIncluded: boolean
    compositionIncluded: boolean
    metadataRegistryIncluded: boolean
    metadataRegistryChecked: boolean
    metadataRegistryValid: boolean | null
    metadataRegistryChanges: number | null
    duplicateReviewIncluded: boolean
    duplicateReviewValid: boolean | null
    checksIncomplete: boolean
  },
): ReviewBundleBehaviorIncludedState {
  return {
    artifactChecked: input.artifactChecked,
    artifactFresh: input.artifactFresh,
    runtimeDriftIncluded: input.runtimeDriftIncluded,
    runtimeDrift: input.runtimeDrift,
    provenanceChecked: input.provenanceChecked,
    provenanceChanges: input.provenanceChanges,
    inventoryIncluded: input.inventoryIncluded,
    compositionIncluded: input.compositionIncluded,
    metadataRegistryIncluded: input.metadataRegistryIncluded,
    metadataRegistryChecked: input.metadataRegistryChecked,
    metadataRegistryValid: input.metadataRegistryValid,
    metadataRegistryChanges: input.metadataRegistryChanges,
    duplicateReviewIncluded: input.duplicateReviewIncluded,
    duplicateReviewValid: input.duplicateReviewValid,
    checksIncomplete: input.checksIncomplete,
  }
}

export function createReviewBehaviorResult(
  report: ReviewReport,
): ReviewBehaviorResult {
  return {
    ...createReviewBehaviorReasonFields({
      recommendation: report.recommendation,
      reasonCount: report.summary.reasonCount,
      reasons: report.summary.reasons,
    }),
    ...createReviewBehaviorDiffFields({
      breakingChanges: report.summary.breakingChanges,
      nonBreakingChanges: report.summary.nonBreakingChanges,
    }),
    ...createReviewValidationFields({
      validationErrors: report.summary.validationErrors,
      validationWarnings: report.summary.validationWarnings,
      validationInfos: report.summary.validationInfos,
    }),
    ...createReviewCheckedState({
      artifactChecked: report.artifact.checked,
      artifactFresh: report.summary.artifactFresh,
      provenanceChecked: report.provenance.checked,
      provenanceChanges: report.summary.provenanceChanges,
      metadataRegistryChecked: report.metadataRegistry.checked,
      metadataRegistryChanges: report.summary.metadataRegistryChanges,
      checksIncomplete: report.summary.checksIncomplete,
    }),
  }
}

export function createReviewBundleBehaviorResult(
  bundle: ReviewBundle,
): ReviewBundleBehaviorResult {
  return {
    ...createReviewBehaviorReasonFields({
      recommendation: bundle.summary.recommendation,
      reasonCount: bundle.summary.reasons.length,
      reasons: bundle.summary.reasons,
    }),
    ...createReviewBehaviorDiffFields({
      breakingChanges: bundle.summary.breakingChanges,
      nonBreakingChanges: bundle.summary.nonBreakingChanges,
    }),
    ...createReviewBundleIncludedState({
      artifactChecked: bundle.summary.artifactChecked,
      artifactFresh: bundle.summary.artifactFresh,
      runtimeDriftIncluded: bundle.summary.runtimeDriftIncluded,
      runtimeDrift: bundle.summary.runtimeDrift,
      provenanceChecked: bundle.summary.provenanceChecked,
      provenanceChanges: bundle.summary.provenanceChanges,
      inventoryIncluded: bundle.summary.inventoryIncluded,
      compositionIncluded: bundle.summary.compositionIncluded,
      metadataRegistryIncluded: bundle.summary.metadataRegistryIncluded,
      metadataRegistryChecked: bundle.summary.metadataRegistryChecked,
      metadataRegistryValid: bundle.summary.metadataRegistryValid,
      metadataRegistryChanges: bundle.summary.metadataRegistryChanges,
      duplicateReviewIncluded: bundle.summary.duplicateReviewIncluded,
      duplicateReviewValid: bundle.summary.duplicateReviewValid,
      checksIncomplete: bundle.summary.checksIncomplete,
    }),
  }
}
