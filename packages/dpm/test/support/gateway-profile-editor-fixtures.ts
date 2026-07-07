import {
  profileArtifact,
  profileCoordinate,
  relationshipHint,
} from './gateway-profile-fixtures.js'

export const invalidProfileAnalysisRequestPayload = {
  profileArtifact: {},
}

export const invalidProfileAnalysisRequestUnsafeShapePayload = {
  profileArtifact: {
    ...profileArtifact,
    nodes: [
      {
        ...profileArtifact.nodes[0]!,
        shape: {
          rawSample: 'C-001',
        },
      },
      ...profileArtifact.nodes.slice(1),
    ],
  },
}

export const invalidProfileAnalysisResponsePayload = {
  analysisReport: {
    kind: 'dpm.profile.analysis-report.v1',
    reportId: 'profile-analysis:orders.created',
  },
}

type InvalidProfileProposalReviewRequestPayloadCase =
  readonly [string, Record<string, unknown>]

export const invalidProfileProposalReviewRequestPayloadCases = [
  ['raw evidence patch', {
    proposalId: relationshipHint.id,
    status: 'accepted',
    reviewedBy: 'privacy-reviewer',
    reason: 'reviewed against catalog evidence',
    rawPatch: { evidenceSources: {} },
  }],
  ['profile artifact overwrite', {
    proposalId: relationshipHint.id,
    status: 'accepted',
    reviewedBy: 'privacy-reviewer',
    reason: 'reviewed against catalog evidence',
    profileArtifact,
  }],
  ['pre-decision relationship hint status', {
    proposalId: relationshipHint.id,
    status: 'review',
    reviewedBy: 'privacy-reviewer',
    reason: 'reviewed against catalog evidence',
  }],
  ['duplicate body proposal id', {
    proposalId: relationshipHint.id,
    status: 'accepted',
    reviewedBy: 'privacy-reviewer',
    reason: 'reviewed against catalog evidence',
    coordinate: profileCoordinate,
    relationshipHint,
  }],
] as const satisfies readonly InvalidProfileProposalReviewRequestPayloadCase[]
