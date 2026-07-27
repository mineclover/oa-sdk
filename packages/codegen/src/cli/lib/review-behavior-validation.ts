import type {
  BehaviorRegistryComponents,
  BehaviorRegistryValidationIssue,
} from './behavior-registry.js'
import {
  issue,
  readBoolean,
  readDecisionSignal,
  readNullableBoolean,
  readNullableNumber,
  readNumber,
  readSidecarPairState,
  readString,
  readStringArray,
} from './behavior-validation-utils.js'

export type ReviewBehaviorCommandName = 'review' | 'review-bundle'

const recommendationByDecisionSignal = {
  approve: 'APPROVE',
  comment: 'COMMENT',
  'request-changes': 'REQUEST_CHANGES',
} as const

export function validateReviewBehaviorComponents(input: {
  commandName: ReviewBehaviorCommandName
  components: BehaviorRegistryComponents
}): BehaviorRegistryValidationIssue[] {
  const issues: BehaviorRegistryValidationIssue[] = []
  const signal = readDecisionSignal(input.components)
  if (signal === undefined) return issues

  if (signal === 'exception') {
    if (readString(input.components.result, 'errorMessage') === undefined) {
      issues.push(issue(
        'components.result.errorMessage',
        `${input.commandName} exception decision requires result.errorMessage`,
      ))
    }
    return issues
  }

  const expectedRecommendation = recommendationByDecisionSignal[
    signal as keyof typeof recommendationByDecisionSignal
  ]
  if (
    expectedRecommendation !== undefined
    && readString(input.components.result, 'recommendation') !== expectedRecommendation
  ) {
    issues.push(issue(
      'components.result.recommendation',
      `${input.commandName} decision ${signal} requires result.recommendation=${expectedRecommendation}`,
    ))
  }

  issues.push(
    ...validateRecommendationReasonFields(input),
    ...validateReviewSidecarRelations(input),
  )
  return issues
}

function validateRecommendationReasonFields(input: {
  commandName: ReviewBehaviorCommandName
  components: BehaviorRegistryComponents
}): BehaviorRegistryValidationIssue[] {
  const issues: BehaviorRegistryValidationIssue[] = []
  const reasonCount = readNumber(input.components.result, 'reasonCount')
  const reasons = readStringArray(input.components.result, 'reasons')
  if (reasonCount !== undefined && reasons !== undefined && reasonCount !== reasons.length) {
    issues.push(issue(
      'components.result.reasonCount',
      `${input.commandName} result.reasonCount must match reasons.length`,
    ))
  }

  const recommendation = readString(input.components.result, 'recommendation')
  if (recommendation !== undefined && reasons !== undefined) {
    if (recommendation === 'APPROVE' && reasons.length !== 0) {
      issues.push(issue(
        'components.result.reasons',
        `${input.commandName} APPROVE recommendation requires an empty reasons array`,
      ))
    }
    if (recommendation !== 'APPROVE' && reasons.length === 0) {
      issues.push(issue(
        'components.result.reasons',
        `${input.commandName} non-APPROVE recommendation requires at least one reason`,
      ))
    }
  }

  return issues
}

function validateReviewSidecarRelations(input: {
  commandName: ReviewBehaviorCommandName
  components: BehaviorRegistryComponents
}): BehaviorRegistryValidationIssue[] {
  const issues: BehaviorRegistryValidationIssue[] = []
  const hasArtifactPath = readString(input.components.input, 'artifactPath') !== undefined
  const artifactChecked = readBoolean(input.components.result, 'artifactChecked')
  if (artifactChecked !== undefined && artifactChecked !== hasArtifactPath) {
    issues.push(issue(
      'components.result.artifactChecked',
      `${input.commandName} result.artifactChecked must reflect artifactPath presence`,
    ))
  }
  if (hasArtifactPath && readNullableBoolean(input.components.result, 'artifactFresh') === null) {
    issues.push(issue(
      'components.result.artifactFresh',
      `${input.commandName} with artifactPath requires result.artifactFresh`,
    ))
  }

  const provenancePathState = readSidecarPairState(input.components, 'baseProvenancePath', 'headProvenancePath')
  const provenanceChecked = readBoolean(input.components.result, 'provenanceChecked')
  if (provenanceChecked !== undefined && provenanceChecked !== (provenancePathState === 'complete')) {
    issues.push(issue(
      'components.result.provenanceChecked',
      `${input.commandName} result.provenanceChecked must reflect provenance sidecar completeness`,
    ))
  }
  if (provenancePathState === 'complete' && readNullableNumber(input.components.result, 'provenanceChanges') === null) {
    issues.push(issue(
      'components.result.provenanceChanges',
      `${input.commandName} with both provenance paths requires result.provenanceChanges`,
    ))
  }
  if (provenancePathState === 'partial' && readBoolean(input.components.result, 'checksIncomplete') !== true) {
    issues.push(issue(
      'components.result.checksIncomplete',
      `${input.commandName} with partial provenance sidecars requires checksIncomplete=true`,
    ))
  }

  if (input.commandName === 'review-bundle') {
    const hasTypeSpecProvenance = readString(input.components.input, 'typeSpecProvenancePath') !== undefined
    const hasTtscProvenance = readString(input.components.input, 'ttscProvenancePath') !== undefined
    if (hasTypeSpecProvenance !== hasTtscProvenance) {
      issues.push(issue(
        'components.input',
        'review-bundle parallel evidence requires both typeSpecProvenancePath and ttscProvenancePath',
      ))
    }
    const parallelEvidenceIncluded = readBoolean(input.components.result, 'parallelEvidenceIncluded')
    if (parallelEvidenceIncluded !== undefined
      && parallelEvidenceIncluded !== (hasTypeSpecProvenance && hasTtscProvenance)) {
      issues.push(issue(
        'components.result.parallelEvidenceIncluded',
        'review-bundle result.parallelEvidenceIncluded must reflect complete parallel evidence inputs',
      ))
    }
  }

  const metadataPathState = readSidecarPairState(input.components, 'baseMetadataRegistryPath', 'headMetadataRegistryPath')
  const metadataChecked = readBoolean(input.components.result, 'metadataRegistryChecked')
  if (metadataChecked !== undefined && metadataChecked !== (metadataPathState === 'complete')) {
    issues.push(issue(
      'components.result.metadataRegistryChecked',
      `${input.commandName} result.metadataRegistryChecked must reflect metadata registry sidecar completeness`,
    ))
  }
  if (metadataPathState === 'complete' && readNullableNumber(input.components.result, 'metadataRegistryChanges') === null) {
    issues.push(issue(
      'components.result.metadataRegistryChanges',
      `${input.commandName} with both metadata registry paths requires result.metadataRegistryChanges`,
    ))
  }
  if (metadataPathState === 'partial' && readBoolean(input.components.result, 'checksIncomplete') !== true) {
    issues.push(issue(
      'components.result.checksIncomplete',
      `${input.commandName} with partial metadata registry sidecars requires checksIncomplete=true`,
    ))
  }

  return issues
}
