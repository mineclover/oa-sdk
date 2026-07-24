import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@server("http://localhost:3001", "Local registry server")
@service(#{ title: "OpenFGA Resource Registry API" })
@info(#{ version: "0.1.0" })
@tagMetadata("system", #{ description: "Registry health and catalog visibility" })
@tagMetadata("authorization", #{ description: "Authorization checks and relationship management" })
namespace OpenFgaResourceRegistryConsumerApi;

model bearerAuth is BearerAuth;

alias ReasonCode =
  "OPENFGA_ALLOW" |
  "OPENFGA_DENY" |
  "RESOURCE_TYPE_DENY_ALL" |
  "UNREGISTERED_RESOURCE_TYPE" |
  "UNREGISTERED_OPERATION" |
  "ACTOR_TYPE_NOT_REGISTERED" |
  "AUTH_PROVIDER_ERROR";

alias DenyReasonCode =
  "OPENFGA_DENY" |
  "RESOURCE_TYPE_DENY_ALL" |
  "UNREGISTERED_RESOURCE_TYPE" |
  "UNREGISTERED_OPERATION" |
  "ACTOR_TYPE_NOT_REGISTERED" |
  "AUTH_PROVIDER_ERROR";

alias AuthorizationMode = "openfga" | "deny_all";
alias Risk = "read" | "write" | "high";

@doc("Canonical identity used by authorization requests and decisions.")
@example(#{ typeKey: "identity.user", objectId: "01J00000000000000000000001" })
model CanonicalObjectRef {
  typeKey: string;
  objectId: string;
  ...Record<never>;
}

@doc("Canonical subject reference. A userset relation is optional.")
@example(#{ typeKey: "identity.user", objectId: "01J00000000000000000000001" })
model CanonicalSubjectRef {
  typeKey: string;
  objectId: string;
  relation?: string;
  ...Record<never>;
}

@doc("A direct relationship between a subject and a resource.")
model CanonicalRelationship {
  subject: CanonicalSubjectRef;
  relation: string;
  resource: CanonicalObjectRef;
  ...Record<never>;
}

@doc("Runtime binding for one declared operation.")
model RuntimeOperationBinding {
  operationKey: string;
  decision: AuthorizationMode;
  relation?: string;
  risk: Risk;
  denyReason?: string;
  ...Record<never>;
}

model AllowedSubjectType {
  typeKey: string;
  relation?: string;
  ...Record<never>;
}

model DirectRelationBinding {
  allowedSubjectTypeKeys: AllowedSubjectType[];
  ...Record<never>;
}

@doc("Runtime-visible resource type and its authorization bindings.")
model ResourceTypeSummary {
  typeKey: string;
  version: string;
  providerTypeName: string;
  authorizationMode: AuthorizationMode;
  operations: RuntimeOperationBinding[];
  directRelations: Record<DirectRelationBinding>;
  ...Record<never>;
}

@doc("Authorization decision trace metadata.")
model DecisionTrace {
  releaseId: string;
  catalogDigest: string;
  storeId?: string;
  authorizationModelId?: string;
  providerUser?: string;
  providerObject?: string;
  ...Record<never>;
}

@doc("Stable authorization decision returned by the registry.")
@example(#{
  allowed: true,
  reasonCode: "OPENFGA_ALLOW",
  operationKey: "sales.order.read",
  actor: #{ typeKey: "identity.user", objectId: "01J00000000000000000000001" },
  resource: #{ typeKey: "sales.order", objectId: "01J00000000000000000000005" },
  relation: "can_view",
  trace: #{ releaseId: "catalog-example", catalogDigest: "sha256:catalog", storeId: "store-test", authorizationModelId: "model-test" }
})
model AuthorizationDecision {
  allowed: boolean;
  reasonCode: ReasonCode;
  operationKey: string;
  actor: CanonicalObjectRef;
  resource: CanonicalObjectRef;
  relation?: string;
  trace: DecisionTrace;
  ...Record<never>;
}

@doc("Authorization decision returned when the authorization result is denied.")
model AuthorizationDeniedDecision {
  allowed: false;
  reasonCode: DenyReasonCode;
  operationKey: string;
  actor: CanonicalObjectRef;
  resource: CanonicalObjectRef;
  relation?: string;
  trace: DecisionTrace;
  ...Record<never>;
}

@doc("Authorization check request. operationKey is catalog-owned and is not a free-form action name.")
@example(#{
  actor: #{ typeKey: "identity.user", objectId: "01J00000000000000000000001" },
  operationKey: "sales.order.read",
  resource: #{ typeKey: "sales.order", objectId: "01J00000000000000000000005" },
  context: #{ tenant: "tenant-1" }
})
model AuthorizationCheckRequest {
  actor?: CanonicalObjectRef;
  operationKey: string;
  resource: CanonicalObjectRef;
  context?: Record<unknown>;
  ...Record<never>;
}

@doc("Batch relationship write request.")
@example(#{
  relationships: #[#{
    subject: #{ typeKey: "identity.user", objectId: "01J00000000000000000000001" },
    relation: "owner",
    resource: #{ typeKey: "sales.order", objectId: "01J00000000000000000000005" }
  }]
})
model RelationshipWriteRequest {
  relationships: CanonicalRelationship[];
  ignoreDuplicates?: boolean = true;
  ...Record<never>;
}

@doc("Batch relationship delete request.")
model RelationshipDeleteRequest {
  relationships: CanonicalRelationship[];
  ignoreMissing?: boolean = true;
  ...Record<never>;
}

@doc("Stored direct relationship query.")
model RelationshipQueryRequest {
  resource: CanonicalObjectRef;
  relation?: string;
  subject?: CanonicalSubjectRef;
  @minValue(1)
  @maxValue(100)
  pageSize?: integer = 50;
  continuationToken?: string;
  ...Record<never>;
}

model Tuple {
  user: string;
  relation: string;
  object: string;
  ...Record<never>;
}

model HealthResponse {
  status: "ok";
  releaseId: string;
  modelId: string;
  ...Record<never>;
}

model ResourceTypesResponse {
  releaseId: string;
  resources: ResourceTypeSummary[];
  ...Record<never>;
}

model RelationshipWriteResponse {
  written: integer;
  tuples: Tuple[];
  ...Record<never>;
}

model RelationshipDeleteResponse {
  deleted: integer;
  tuples: Tuple[];
  ...Record<never>;
}

model RelationshipQueryResponse {
  tuples: Tuple[];
  continuationToken: string;
  ...Record<never>;
}

model Error {
  error: string;
  message?: string;
  ...Record<never>;
}

model Health200Response {
  @statusCode statusCode: 200;
  @body body: HealthResponse;
}

model ResourceTypes200Response {
  @statusCode statusCode: 200;
  @body body: ResourceTypesResponse;
}

model AuthorizationCheck200Response {
  @statusCode statusCode: 200;
  @body body: AuthorizationDecision;
}

model AuthorizationCheck403Response {
  @statusCode statusCode: 403;
  @body body: AuthorizationDeniedDecision | Error;
}

model RelationshipWrite200Response {
  @statusCode statusCode: 200;
  @body body: RelationshipWriteResponse;
}

model RelationshipDelete200Response {
  @statusCode statusCode: 200;
  @body body: RelationshipDeleteResponse;
}

model RelationshipQuery200Response {
  @statusCode statusCode: 200;
  @body body: RelationshipQueryResponse;
}

model BadRequestResponse {
  @statusCode statusCode: 400;
  @body body: Error;
}

model UnauthorizedResponse {
  @statusCode statusCode: 401;
  @body body: Error;
}

model ForbiddenResponse {
  @statusCode statusCode: 403;
  @body body: Error;
}

model ServiceUnavailableResponse {
  @statusCode statusCode: 503;
  @body body: Error;
}

@route("/health")
@get
@tag("system")
@operationId("getHealth")
@summary("Registry health")
op getHealth(): Health200Response;

@route("/resource-types")
@get
@tag("system")
@operationId("listResourceTypes")
@summary("List registered resource types")
op listResourceTypes(): ResourceTypes200Response;

@route("/authorization/check")
@post
@tag("authorization")
@useAuth(bearerAuth)
@operationId("checkAuthorization")
@summary("Evaluate an authorization operation")
op checkAuthorization(
  @body body: AuthorizationCheckRequest,
): AuthorizationCheck200Response | AuthorizationCheck403Response | BadRequestResponse | UnauthorizedResponse | ServiceUnavailableResponse;

@route("/authorization/relationships")
@post
@tag("authorization")
@useAuth(bearerAuth)
@operationId("writeRelationships")
@summary("Write direct authorization relationships")
op writeRelationships(
  @body body: RelationshipWriteRequest,
): RelationshipWrite200Response | BadRequestResponse | UnauthorizedResponse | ForbiddenResponse | ServiceUnavailableResponse;

@route("/authorization/relationships")
@delete
@tag("authorization")
@useAuth(bearerAuth)
@operationId("deleteRelationships")
@summary("Delete direct authorization relationships")
op deleteRelationships(
  @body body: RelationshipDeleteRequest,
): RelationshipDelete200Response | BadRequestResponse | UnauthorizedResponse | ForbiddenResponse | ServiceUnavailableResponse;

@route("/authorization/relationships/query")
@post
@tag("authorization")
@useAuth(bearerAuth)
@operationId("queryRelationships")
@summary("Read stored direct relationships")
op queryRelationships(
  @body body: RelationshipQueryRequest,
): RelationshipQuery200Response | BadRequestResponse | UnauthorizedResponse | ForbiddenResponse | ServiceUnavailableResponse;
