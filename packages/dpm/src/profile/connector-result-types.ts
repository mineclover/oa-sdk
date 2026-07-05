import type {
  DpmProfileArtifact,
  DpmProfileDiagnostic,
} from './profile-artifact-types.js'
import type {
  DpmProfileCaptureMode,
  DpmProfileSourceKind,
} from './profile-taxonomy.js'
import type { DpmProfileConnectorCapabilities } from './connector-capability-types.js'
import type { DpmProfileConnectorFreshness } from './connector-freshness-types.js'
import {
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  type DpmProfileConnectorEvidenceKind,
  type DpmProfileConnectorStatus,
} from './connector-taxonomy.js'

export type DpmProfileConnectorResult = {
  kind: typeof DPM_PROFILE_CONNECTOR_RESULT_KIND
  connectorId: string
  connectorVersion: string
  sourceKind: DpmProfileSourceKind
  captureMode: DpmProfileCaptureMode
  status: DpmProfileConnectorStatus
  capabilities: DpmProfileConnectorCapabilities
  observedEvidenceKinds: DpmProfileConnectorEvidenceKind[]
  diagnostics: DpmProfileDiagnostic[]
  freshness: DpmProfileConnectorFreshness
  profileArtifact?: DpmProfileArtifact
}

export type DpmProfileConnectorResultInput = Omit<DpmProfileConnectorResult, 'kind' | 'freshness'>
