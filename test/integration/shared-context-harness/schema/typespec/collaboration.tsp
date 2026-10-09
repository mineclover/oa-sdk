import "@typespec/http";

namespace SharedContextHarness;

@pattern("^[A-Za-z0-9_-]{12,}$")
scalar DriveFolderId extends string;

@pattern("^collab-[a-z0-9]+(-[a-z0-9]+)*$")
scalar CollaborationId extends string;

@pattern("^ws-[a-z0-9-]+$")
scalar WorkspaceId extends string;

enum OwnerScopeType {
  personal: "personal",
  organization: "organization",
}

model OwnerScope {
  type: OwnerScopeType;
  @minLength(1)
  id: string;
}

model FolderIds {
  discussions: DriveFolderId;
  proposals: DriveFolderId;
  decisions: DriveFolderId;
  references: DriveFolderId;
  distributions: DriveFolderId;
}

model CollaborationStorage {
  rootFolderId: DriveFolderId;
  folderIds: FolderIds;
}

enum ParticipantContribution {
  source: "source",
  consumer: "consumer",
  reviewer: "reviewer",
}

model CollaborationParticipant {
  workspaceId: WorkspaceId;
  contribution: ParticipantContribution;
}

@doc("Shared Collaboration Manifest v0.1")
model CollaborationManifest {
  schemaVersion: "0.1.0";
  collaborationId: CollaborationId;
  @minLength(1)
  title: string;
  ownerScope: OwnerScope;
  storage: CollaborationStorage;
  @minLength(1)
  governingPolicyRef: string;
  @minItems(1)
  @maxItems(64)
  participants: CollaborationParticipant[];
}
