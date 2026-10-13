import "@typespec/http";
import "./envelopes.tsp";

namespace EwicInterop;

model SpecContent {
  title: string;
  purpose: string;
  sections?: Array<{
    id: string;
    title: string;
    content: string;
  }>;
  requirements?: Array<{
    id: string;
    statement: string;
    level?: string;
  }>;
  invariants?: string[];
  acceptanceCriteria?: string[];
}

model FrameworkContent {
  name: string;
  version: string;
  capabilities: string[];
  constraints?: string[];
  interfaces?: string[];
}

model ResourceContent {
  uri: string;
  mediaType: string;
  locator: string;
  summary?: string;
  contentDigest: string;
  license?: string;
  fileId?: string;
  parentChain?: string[];
}

model WorkflowMachine {
  schema: "xstate.v5-compatible-subset";
  id: string;
  version: string;
  initial: string;
  type: string;
  contextSchema?: Record<unknown>;
  contextDefaults?: Record<unknown>;
  states: Record<unknown>;
  guards?: Array<{
    name: string;
    params?: Record<unknown>;
  }>;
  actions?: Array<{
    name: string;
    params?: Record<unknown>;
  }>;
  invokes?: Array<{
    src: string;
    id?: string;
  }>;
  meta?: {
    visual?: {
      layout?: string;
      direction?: string;
    };
  };
}

model WorkflowContent {
  contract?: Record<unknown>;
  machine: WorkflowMachine;
  imports?: string[];
  sideEffectsPolicy?: string;
}

model ResolvedRefSnapshot {
  snapshotId: string;
  contentHash: string;
}

model ExecutionContent {
  workflowRef: string;
  resolvedRefs: Record<ResolvedRefSnapshot>;
  inputDigest: string;
  status: "pending" | "running" | "completed" | "failed";
  steps?: Array<{
    stepId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    timestamp: string;
  }>;
  outputs?: Record<unknown>;
  evidenceRefs?: string[];
}

model EvidenceContent {
  claim: string;
  value: unknown;
  confidence: float32;
  method: string;
  observedAt: string;
  sourceRefs: string[];
  artifactRefs?: string[];
}
