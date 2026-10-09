import "@typespec/http";
import "./collaboration.tsp";
import "./reference.tsp";

namespace SharedContextHarness;

enum LifecycleStatus {
  active: "active",
  maintenance: "maintenance",
  archived: "archived",
}

enum ArchitectureStatus {
  proposed: "proposed",
  accepted: "accepted",
  historical: "historical",
}

model DesignPullRequestRef {
  provider: "github";
  @pattern("^https://github\\.com/")
  nativeUrl: string;
  @minLength(1)
  stateAtRegistration: string;
}

model WorkstreamEntry {
  @minLength(1)
  id: string;
  @minLength(1)
  title: string;
  ownerWorkspaceId?: WorkspaceId;
  ownerRepository?: string;
  @pattern("^https://github\\.com/")
  externalIssueUrl: string;
  @minLength(1)
  observedIssueState: string;
}

enum MilestoneState {
  planned: "planned",
  partiallyObserved: "partially-observed",
  verified: "verified",
  blocked: "blocked",
}

model MilestoneEntry {
  @minLength(1)
  id: string;
  @minLength(1)
  label: string;
  state: MilestoneState;
}

model VerificationReceipt {
  @minLength(1)
  remoteFolderReadback: string;
  @minLength(1)
  remoteManifestReadback: string;
  @minLength(1)
  runtimeAclIntegrationTest: string;
  @minLength(1)
  runtimeSourceAccessIntegrationTest: string;
  @minLength(1)
  note: string;
}

@doc("Collaboration Management Projection v0.1")
model CollaborationManagementProjection {
  schemaVersion: "0.1.0";
  recordType: "collaboration-management-projection";
  collaborationId: CollaborationId;
  workspaceKind: "cross-project-collaboration";
  lifecycleStatus: LifecycleStatus;
  architectureStatus: ArchitectureStatus;
  @minLength(1)
  managementBasis: string;
  ownerScope: OwnerScope;
  registeredParticipantWorkspaceIds: WorkspaceId[];
  unregisteredSourceRepositories: string[];
  sourceReferenceIds: ReferenceId[];
  @minLength(1)
  primaryRepository: string;
  designPullRequest: DesignPullRequestRef;
  workstreams: WorkstreamEntry[];
  milestones: MilestoneEntry[];
  verification: VerificationReceipt;
}
