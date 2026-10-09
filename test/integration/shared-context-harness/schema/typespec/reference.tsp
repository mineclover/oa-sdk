import "@typespec/http";
import "./collaboration.tsp";

namespace SharedContextHarness;

@pattern("^ref-[a-z0-9]+(-[a-z0-9]+)*$")
scalar ReferenceId extends string;

enum ProvenanceType {
  sourceReference: "source-reference",
  agentAnalysis: "agent-analysis",
  humanAssertion: "human-assertion",
}

enum SourceProvider {
  github: "github",
  drive: "drive",
  nes: "nes",
  semantic: "semantic",
  web: "web",
}

enum SnapshotKind {
  working: "working",
  immutable: "immutable",
}

model SnapshotInfo {
  kind: SnapshotKind;
  @minLength(8)
  id: string;
}

model SourceCardReference {
  provider: SourceProvider;
  @minLength(1)
  nativeRef: string;
  snapshot: SnapshotInfo;
}

@doc("Collaboration Source Reference Card v0.1")
model SourceReference {
  schemaVersion: "0.1.0";
  referenceId: ReferenceId;
  collaborationId: CollaborationId;
  @minLength(1)
  ownerRef: string;
  @minLength(1)
  requiredScopeRef: string;
  provenance: ProvenanceType;
  source: SourceCardReference;
}
