/**
 * DTO contracts for Shared Context Collaboration Harness
 * Grounded in JSON Schema Draft 2020-12 and TypeSpec models.
 */

export interface OwnerScope {
  type: 'organization' | 'personal'
  id: string
}

export interface FolderIds {
  discussions: string
  proposals: string
  decisions: string
  references: string
  distributions: string
}

export interface CollaborationStorage {
  rootFolderId: string
  folderIds: FolderIds
}

export interface CollaborationParticipant {
  workspaceId: string
  contribution: 'source' | 'consumer' | 'reviewer'
}

export interface CollaborationManifest {
  schemaVersion: '0.1.0'
  collaborationId: string
  title: string
  ownerScope: OwnerScope
  storage: CollaborationStorage
  governingPolicyRef: string
  participants: CollaborationParticipant[]
}

export interface SnapshotInfo {
  kind: 'working' | 'immutable'
  id: string
}

export interface SourceCardReference {
  provider: 'github' | 'drive' | 'nes' | 'semantic' | 'web'
  nativeRef: string
  snapshot: SnapshotInfo
}

export interface SourceReference {
  schemaVersion: '0.1.0'
  referenceId: string
  collaborationId: string
  ownerRef: string
  requiredScopeRef: string
  provenance: 'source-reference' | 'agent-analysis' | 'human-assertion'
  source: SourceCardReference
}

export interface ReferenceIndexItem {
  referenceId: string
  fileId: string
  contentSha256: string
  ownerRef: string
  sourceSnapshotId: string
}

export interface CollaborationReferenceIndex {
  schemaVersion: '0.1.0'
  recordType: 'collaboration-reference-index'
  collaborationId: string
  parentFolderId: string
  registrationPolicy: string
  references: ReferenceIndexItem[]
}

export interface DesignPullRequestRef {
  provider: 'github'
  nativeUrl: string
  stateAtRegistration: string
}

export interface WorkstreamEntry {
  id: string
  title: string
  ownerWorkspaceId?: string
  ownerRepository?: string
  externalIssueUrl: string
  observedIssueState: string
}

export interface MilestoneEntry {
  id: string
  label: string
  state: 'planned' | 'partially-observed' | 'verified' | 'blocked'
}

export interface VerificationReceipt {
  remoteFolderReadback: string
  remoteManifestReadback: string
  runtimeAclIntegrationTest: string
  runtimeSourceAccessIntegrationTest: string
  note: string
}

export interface CollaborationManagementProjection {
  schemaVersion: '0.1.0'
  recordType: 'collaboration-management-projection'
  collaborationId: string
  workspaceKind: 'cross-project-collaboration'
  lifecycleStatus: 'active' | 'maintenance' | 'archived'
  architectureStatus: 'proposed' | 'accepted' | 'historical'
  managementBasis: string
  ownerScope: OwnerScope
  registeredParticipantWorkspaceIds: string[]
  unregisteredSourceRepositories: string[]
  sourceReferenceIds: string[]
  primaryRepository: string
  designPullRequest: DesignPullRequestRef
  workstreams: WorkstreamEntry[]
  milestones: MilestoneEntry[]
  verification: VerificationReceipt
}

export interface RegistryCollaborationItem {
  collaborationId: string
  title: string
  kind: 'cross-project-collaboration'
  status: 'active' | 'maintenance' | 'archived'
  architectureStatus: 'proposed' | 'accepted' | 'historical'
  ownerScope: OwnerScope
  folderId: string
  managementPath: string
  manifestPath: string
  participantWorkspaceIds: string[]
  externalRepositoryRefs: string[]
  links: {
    designPullRequest: string
    projectIssue: string
  }
}

export interface CollaborationsRegistry {
  schemaVersion: '0.1.0'
  recordType: 'collaborations-registry'
  registryScope: OwnerScope
  scopePolicy: string
  collaborations: RegistryCollaborationItem[]
}

/** Output contract for resolving shared references */
export type ResolveSharedReferenceResult =
  | {
      status: 'resolved'
      referenceId: string
      snapshotId: string
      content: string
      provenance: 'source-reference' | 'agent-analysis' | 'human-assertion'
    }
  | { status: 'stale' }
  | { status: 'unavailable' }

/** Output contract for bootstrap */
export interface CollaborationBootstrapResult {
  status: 'ready' | 'unavailable'
  collaborationId: string
  title?: string
  manifest?: CollaborationManifest
  references?: ReferenceIndexItem[]
}
