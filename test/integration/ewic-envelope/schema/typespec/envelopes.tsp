import "@typespec/http";

namespace EwicInterop;

enum EntityKind {
  spec: "spec",
  framework: "framework",
  resource: "resource",
  workflow: "workflow",
  execution: "execution",
  evidence: "evidence",
}

enum EntityStatus {
  draft: "draft",
  published: "published",
  deprecated: "deprecated",
}

enum EntityRelationType {
  contains: "contains",
  implements: "implements",
  depends_on: "depends_on",
  invokes: "invokes",
  reads: "reads",
  writes: "writes",
  produces: "produces",
  references: "references",
  supersedes: "supersedes",
}

@pattern("^ent_[a-zA-Z0-9_-]+$")
scalar EntityId extends string;

@pattern("^[a-z0-9]+(\\.[a-z0-9]+)*$")
scalar EntityNamespace extends string;

@pattern("^[a-z0-9]+(-[a-z0-9]+)*$")
scalar EntitySlug extends string;

@pattern("^sha256:[a-f0-9]{64}$")
scalar ContentHash extends string;

model EntityIdentity {
  id: EntityId;
  kind: EntityKind;
  "namespace": EntityNamespace;
  slug: EntitySlug;
  @minValue(1)
  revision: integer;
  revisionId: string;
  status: EntityStatus;
  contentHash: ContentHash;
}

enum SSOTProvider {
  google_drive: "google_drive",
  github: "github",
  local: "local",
  nes: "nes",
}

model EntitySSOT {
  provider: SSOTProvider;
  fileId?: string;
  path: string;
  parentChain?: string[];
  locator?: string;
  revision?: string;
}

model EntityProvenance {
  ssot: EntitySSOT;
  createdAt: string;
  createdBy: string;
  parentRevision?: integer | null;
}

model EntityReferenceItem {
  uri: string;
  relation: EntityRelationType;
  resolvedContentHash?: ContentHash;
  status?: string;
  metadata?: Record<unknown>;
}

@doc("EWIC Source Envelope v1 (entity-source/v1)")
model EntitySourceEnvelope {
  $schema: "entity-source/v1";
  identity: EntityIdentity;
  provenance: EntityProvenance;
  content: Record<unknown>;
  refs: EntityReferenceItem[];
}

model DerivedPipeline {
  runId: string;
  name: string;
  version: string;
  pass: string;
}

model DerivedSearch {
  normalizedTextHash: string;
  title: string;
  tags: string[];
  facets: Record<unknown>;
  indexKeys: string[];
}

model DerivedGraphEdge {
  source: string;
  target: string;
  relation: string;
  status: string;
  confidence?: float32;
}

model DerivedGraph {
  node: Record<unknown>;
  edges: DerivedGraphEdge[];
}

model EmbeddingModelInfo {
  provider: string;
  name: string;
  version: string;
}

model DerivedEmbedding {
  purpose: string;
  "model": EmbeddingModelInfo;
  dimensions: integer;
  dtype: string;
  metric: string;
  encoding: string;
  vectorRef: string;
  sourceFields: string[];
  sourceRevision: string;
  contentHash: string;
  generatedAt: string;
  stale: boolean;
}

model DerivedViz {
  node: Record<unknown>;
  layout: Record<unknown>;
  states: Record<unknown>;
  edgeLabels: boolean;
}

@doc("EWIC Derived Envelope v1 (entity-derived/v1)")
model EntityDerivedEnvelope {
  $schema: "entity-derived/v1";
  entityRef: string;
  sourceContentHash: ContentHash;
  pipeline: DerivedPipeline;
  search: DerivedSearch;
  graph: DerivedGraph;
  embeddings: DerivedEmbedding[];
  viz: DerivedViz;
}
