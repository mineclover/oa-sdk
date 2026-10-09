import "@typespec/http";
import "./collaboration.tsp";
import "./reference.tsp";

namespace SharedContextHarness;

@pattern("^[a-f0-9]{64}$")
scalar Sha256Hash extends string;

model ReferenceIndexItem {
  referenceId: ReferenceId;
  fileId: DriveFolderId;
  contentSha256: Sha256Hash;
  @minLength(1)
  ownerRef: string;
  @minLength(8)
  sourceSnapshotId: string;
}

@doc("Collaboration Reference Index v0.1")
model CollaborationReferenceIndex {
  schemaVersion: "0.1.0";
  recordType: "collaboration-reference-index";
  collaborationId: CollaborationId;
  parentFolderId: DriveFolderId;
  @minLength(1)
  registrationPolicy: string;
  references: ReferenceIndexItem[];
}
