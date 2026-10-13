import "@typespec/http";
import "./envelopes.tsp";

namespace EwicInterop;

model ColabRunInputs {
  entityRef: string;
  revision: integer;
  contentHash: ContentHash;
  snapshotId?: string;
}

model StageCheckpoint {
  stage: string;
  timestamp: string;
  status: "ok" | "warning" | "error";
  hash?: string;
}

model StagedArtifact {
  name: string;
  path: string;
  digest: string;
}

@doc("Colab Run Packet v1 (colab-run-packet/v1)")
model ColabRunPacket {
  $schema?: "colab-run-packet/v1";
  runId: string;
  pipelineName: string;
  pipelineVersion: string;
  stage: string;
  inputs: ColabRunInputs;
  outputs?: Record<unknown>;
  checkpoints?: StageCheckpoint[];
  stagedArtifacts?: StagedArtifact[];
  status: "pending" | "running" | "completed" | "failed" | "stale";
}
