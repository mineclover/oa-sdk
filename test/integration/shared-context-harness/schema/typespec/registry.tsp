import "@typespec/http";
import "./collaboration.tsp";
import "./management.tsp";

namespace SharedContextHarness;

@pattern("^[A-Za-z0-9_.-]+\\.json$")
scalar JsonFileName extends string;

model CollaborationLinks {
  @pattern("^https://github\\.com/")
  designPullRequest: string;
  @pattern("^https://github\\.com/")
  projectIssue: string;
}

model RegistryCollaborationItem {
  collaborationId: CollaborationId;
  @minLength(1)
  title: string;
  kind: "cross-project-collaboration";
  status: LifecycleStatus;
  architectureStatus: ArchitectureStatus;
  ownerScope: OwnerScope;
  folderId: DriveFolderId;
  managementPath: JsonFileName;
  manifestPath: JsonFileName;
  participantWorkspaceIds: WorkspaceId[];
  externalRepositoryRefs: string[];
  links: CollaborationLinks;
}

@doc("Collaboration Registry v0.1")
model CollaborationsRegistry {
  schemaVersion: "0.1.0";
  recordType: "collaborations-registry";
  registryScope: OwnerScope;
  @minLength(1)
  scopePolicy: string;
  collaborations: RegistryCollaborationItem[];
}
