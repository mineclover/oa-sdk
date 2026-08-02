import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

@doc("게시된 World Model artifact의 정확한 식별자")
model ModelRef {
  @minLength(1)
  modelId: string;
  @minLength(1)
  version: string;
  @minLength(1)
  semanticFingerprint: string;
}

@doc("World에 고정할 실행 provider 조합의 정확한 식별자")
model ExecutionProfileRef {
  @minLength(1)
  profileId: string;
  @minLength(1)
  version: string;
  @minLength(1)
  semanticFingerprint: string;
}

@doc("선택 가능한 실행 profile의 공개 요약")
model ExecutionProfileSummary {
  profile: ExecutionProfileRef;
  persistenceRecovery: "volatile" | "snapshot-journal" | "durable-outbox";
  numericSemantics: "fixed-decimal" | "rational" | "strict-binary-float";
  decisionRandom: "counter-derived" | "seeded-stream";
  commitIsolation: "single-writer" | "optimistic-revision-cas" | "serializable-transaction";
  conformanceProfiles: string[];
}

@doc("새 World bootstrap 요청. 생성 뒤 ModelRef와 ExecutionProfileRef는 normal Stimulus로 바꿀 수 없습니다.")
model CreateWorldRequest {
  @format("uuid")
  worldId: string;
  modelRef: ModelRef;
  executionProfile: ExecutionProfileRef;
  @doc("모델이 해석하는 초기 scenario/configuration reference")
  @minLength(1)
  bootstrapSpecRef: string;
  @doc("선택적 replay seed material. 없으면 provider가 생성한 값을 WorldControlState에 고정합니다.")
  runSeedMaterial?: string;
}

@doc("World의 public control head. Domain Property와 raw StateObject graph는 포함하지 않습니다.")
model WorldHead {
  @format("uuid")
  worldId: string;
  modelRef: ModelRef;
  executionProfile: ExecutionProfileRef;
  @minValue(0)
  revision: int64;
  @doc("모델이 선언한 형식으로 직렬화한 현재 logical time")
  logicalTime: string;
  lifecycle: "created" | "active" | "inactive" | "ended";
}

@doc("외부 Action 의도를 SimulationAgenda에 넣기 위한 typed envelope. role/parameter의 상세 contract는 World의 PublishedModel이 검증합니다.")
model SubmitActionRequest {
  @format("uuid")
  stimulusId: string;
  @minLength(1)
  actionTypeId: string;
  @doc("ActionRoleDefinition stable ID에서 active Entity UUID로의 binding")
  roles: Record<string>;
  @doc("ActionParameterDefinition stable ID에서 typed JSON value로의 binding")
  parameters?: Record<unknown>;
  correlationId?: string;
  causationId?: string;
}

@doc("Agenda가 받아들인 Stimulus. 이 응답은 Transaction commit 성공을 뜻하지 않습니다.")
model StimulusAccepted {
  @format("uuid")
  stimulusId: string;
  @format("uuid")
  worldId: string;
  status: "accepted" | "duplicate";
  @minValue(0)
  acceptedAtRevision: int64;
  acceptedLogicalTime: string;
}

@doc("현재 logical time에서 target instant까지 전진하는 요청")
model AdvanceToLogicalTime {
  kind: "to-logical-time";
  targetLogicalTime: string;
}

@doc("현재 logical time에서 duration만큼 전진하는 요청")
model AdvanceByLogicalDuration {
  kind: "by-duration";
  duration: string;
}

@doc("TimeAdvanceRequest envelope. 한 요청은 target instant 또는 duration 중 하나만 가집니다.")
model SubmitTimeAdvanceRequest {
  @format("uuid")
  stimulusId: string;
  request: AdvanceToLogicalTime | AdvanceByLogicalDuration;
  correlationId?: string;
  causationId?: string;
}

@doc("특정 source revision에서 materialize한 semantic projection")
model ProjectionEnvelope {
  @format("uuid")
  worldId: string;
  modelRef: ModelRef;
  @minValue(0)
  sourceRevision: int64;
  @minLength(1)
  projectionId: string;
  @doc("PublishedModel이 선언한 projection result의 typed JSON representation")
  value: unknown;
}

@doc("같은 revision에서 함께 읽어야 하는 semantic projection bundle")
model ProjectionBundleEnvelope {
  @format("uuid")
  worldId: string;
  modelRef: ModelRef;
  @minValue(0)
  sourceRevision: int64;
  @minLength(1)
  bundleId: string;
  status: "complete" | "incomplete" | "stale";
  projections: ProjectionEnvelope[];
}

model ListExecutionProfiles200Response {
  @statusCode statusCode: 200;
  @body body: { items: ExecutionProfileSummary[]; };
}

model ListExecutionProfiles401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model CreateWorld201Response {
  @statusCode statusCode: 201;
  @body body: WorldHead;
}

model CreateWorld400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

model CreateWorld401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model CreateWorld409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

model CreateWorld422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

model GetWorldHead200Response {
  @statusCode statusCode: 200;
  @body body: WorldHead;
}

model GetWorldHead401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model GetWorldHead404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

model SubmitAction202Response {
  @statusCode statusCode: 202;
  @body body: StimulusAccepted;
}

model SubmitAction400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

model SubmitAction401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model SubmitAction404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

model SubmitAction409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

model SubmitAction422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

model SubmitTimeAdvance202Response {
  @statusCode statusCode: 202;
  @body body: StimulusAccepted;
}

model SubmitTimeAdvance400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

model SubmitTimeAdvance401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model SubmitTimeAdvance404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

model SubmitTimeAdvance409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

model SubmitTimeAdvance422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

model GetProjection200Response {
  @statusCode statusCode: 200;
  @body body: ProjectionEnvelope;
}

model GetProjection401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model GetProjection404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

model GetProjection422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

model GetProjectionBundle200Response {
  @statusCode statusCode: 200;
  @body body: ProjectionBundleEnvelope;
}

model GetProjectionBundle401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

model GetProjectionBundle404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

model GetProjectionBundle422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@summary("선택 가능한 실행 profile 목록")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("listExecutionProfiles")
@route("/world-model/execution-profiles")
@get
op listExecutionProfiles(): ListExecutionProfiles200Response | ListExecutionProfiles401Response;

@summary("새 World bootstrap")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("createWorld")
@route("/worlds")
@post
op createWorld(@body body: CreateWorldRequest): CreateWorld201Response | CreateWorld400Response | CreateWorld401Response | CreateWorld409Response | CreateWorld422Response;

@summary("World control head 조회")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("getWorldHead")
@route("/worlds/{worldId}")
@get
op getWorldHead(@path @format("uuid") worldId: string): GetWorldHead200Response | GetWorldHead401Response | GetWorldHead404Response;

@summary("Action stimulus 제출")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("submitWorldAction")
@route("/worlds/{worldId}/actions")
@post
op submitWorldAction(@path @format("uuid") worldId: string, @body body: SubmitActionRequest): SubmitAction202Response | SubmitAction400Response | SubmitAction401Response | SubmitAction404Response | SubmitAction409Response | SubmitAction422Response;

@summary("Logical time advance stimulus 제출")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("submitWorldTimeAdvance")
@route("/worlds/{worldId}/time-advances")
@post
op submitWorldTimeAdvance(@path @format("uuid") worldId: string, @body body: SubmitTimeAdvanceRequest): SubmitTimeAdvance202Response | SubmitTimeAdvance400Response | SubmitTimeAdvance401Response | SubmitTimeAdvance404Response | SubmitTimeAdvance409Response | SubmitTimeAdvance422Response;

@summary("Revision-pinned semantic projection 조회")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("getWorldProjection")
@route("/worlds/{worldId}/projections/{projectionId}")
@get
op getWorldProjection(
  @path @format("uuid") worldId: string,
  @path projectionId: string,
  @query @minValue(0) revision?: int64,
): GetProjection200Response | GetProjection401Response | GetProjection404Response | GetProjection422Response;

@summary("Revision-pinned semantic projection bundle 조회")
@tag("world-model")
@useAuth(bearerAuth)
@operationId("getWorldProjectionBundle")
@route("/worlds/{worldId}/projection-bundles/{bundleId}")
@get
op getWorldProjectionBundle(
  @path @format("uuid") worldId: string,
  @path bundleId: string,
  @query @minValue(0) revision?: int64,
): GetProjectionBundle200Response | GetProjectionBundle401Response | GetProjectionBundle404Response | GetProjectionBundle422Response;
